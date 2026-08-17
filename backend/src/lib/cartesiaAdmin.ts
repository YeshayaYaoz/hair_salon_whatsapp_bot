/**
 * Cartesia management API — assigning a phone number to the voice agent.
 *
 * Only one agent exists for the whole product, not one per salon. Everything that differs between
 * businesses (greeting, personality, services, hours, vocabulary) is fetched at call time by
 * voiceRoutes' /context, keyed off the dialled number. So onboarding a salon is not "create an
 * agent" — it is "point one more number at the agent we already have".
 *
 * That assignment is the single manual step that silently breaks a new salon's voice line: a number
 * with no agent behind it accepts the call and hangs up immediately, with nothing in our logs
 * because the call never reaches us.
 *
 * Numbers reach the account one of three ways: provisioned by Cartesia (US only, so useless for an
 * Israeli salon), imported from Twilio, or imported from a SIP trunk registered against our own
 * carrier. We use the trunk — it is the only path that puts an Israeli number on an Israeli
 * carrier's rates. Registering the trunk itself is a one-time operator step; importing each salon's
 * number afterwards is an API call, which is what this file automates.
 *
 * Deliberately narrow. This is not a general Cartesia client — it does the one thing onboarding
 * needs, and provisioning US numbers, Twilio import, and trunk registration all stay out.
 */

// The same normalization voiceRoutes matches dialled numbers with. This file had its own copy
// annotated "Mirrors voiceRoutes" — two definitions of "the same phone number" that have to agree
// for a call to route, which is exactly the kind of pair that drifts apart unnoticed.
import { normalizePhone } from "./phone.js";

const BASE_URL = "https://api.cartesia.ai";

/**
 * Pinned per Cartesia's versioning scheme: the date the integration was written and tested. Sending
 * no version, or a stale one, silently changes the error format we parse below.
 */
const API_VERSION = "2026-03-01";

export class CartesiaNotConfiguredError extends Error {
  constructor() {
    super("CARTESIA_API_KEY / CARTESIA_AGENT_ID are not set — voice number assignment is unavailable");
    this.name = "CartesiaNotConfiguredError";
  }
}

function creds(): { apiKey: string; agentId: string } {
  // Separate from CARTESIA_TOOL_SECRET, which is inbound-only: the secret Cartesia sends US when it
  // calls our tools. This key is what lets us call THEM, and it grants full account access.
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  const agentId = process.env.CARTESIA_AGENT_ID?.trim();
  if (!apiKey || !agentId) throw new CartesiaNotConfiguredError();
  return { apiKey, agentId };
}

interface CartesiaPhoneNumber {
  id: string;
  number: string;
  label?: string | null;
  agent?: { id: string; name: string } | null;
}

async function call<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    // Onboarding is interactive: the owner is watching a spinner. Better to fail fast and let them
    // retry than to hold the request open on someone else's outage.
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    // Structured JSON errors from 2026-03-01 onward; fall back to the body for anything older or
    // for an error emitted before content negotiation (a gateway 502, say).
    const body = await res.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { title?: string; message?: string };
      if (parsed.title || parsed.message) detail = [parsed.title, parsed.message].filter(Boolean).join(": ");
    } catch {
      /* not JSON — the raw body is the best detail available */
    }
    throw new Error(`Cartesia ${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
}

/** A voice an owner can pick, reduced to what the dashboard needs to render a choice. */
export interface VoiceOption {
  id: string;
  name: string;
  description: string | null;
  /** Cartesia's own presentation label. Null when a voice declares none. */
  gender: "masculine" | "feminine" | "gender_neutral" | null;
  /** Short sample the owner can play before committing. Null when Cartesia has none for this voice. */
  previewUrl: string | null;
}

interface CartesiaVoice {
  id: string;
  name: string;
  description?: string | null;
  gender?: string | null;
  language?: string | null;
  locales?: { locale: string; is_native: boolean }[] | null;
  preview_file_url?: string | null;
}

/**
 * The catalogue is identical for every salon and changes on Cartesia's release schedule, not ours,
 * so it is fetched once and reused. Without this, opening the bot settings page would put a
 * third-party API call on the critical path for every owner, every visit.
 */
let voiceCache: { at: number; voices: VoiceOption[] } | null = null;
const VOICE_CACHE_MS = 60 * 60 * 1000;

function speaksHebrew(voice: CartesiaVoice): boolean {
  // A voice's `language` is its primary one; `locales` covers the rest. Checked with a prefix rather
  // than equality because the tags are BCP-47 ("he-IL"), and a region-tagged Hebrew voice is still
  // a Hebrew voice.
  if (voice.language?.toLowerCase().startsWith("he")) return true;
  return (voice.locales ?? []).some((l) => l.locale?.toLowerCase().startsWith("he"));
}

/**
 * Hebrew-capable voices an owner can choose between.
 *
 * Filtered to Hebrew because these salons speak Hebrew to their customers, and a picker listing
 * hundreds of English voices buries the handful that would actually work. Returns an empty list
 * rather than throwing when Cartesia is unconfigured or unreachable — voice selection is optional,
 * and a settings page that fails to load because a third party is down is a worse outcome than one
 * that says the choice is unavailable right now.
 */
/**
 * The catalogue if it is already cached, otherwise nothing — never a network call.
 *
 * `/api/voice/context` runs while a caller listens to silence, and it needs the chosen voice's
 * gender to inflect the agent's Hebrew. Awaiting `listHebrewVoices()` there put an outbound request
 * to Cartesia (a 100-voice list with preview URLs) inside the path between the phone being answered
 * and the first word spoken — on every cold cache, which means after every single deploy.
 *
 * The trade is deliberate: a caller in that window gets the default feminine inflection instead of
 * seconds of dead air. The refresh is kicked off in the background so the window closes on its own,
 * and `warmVoiceCache()` on boot means it should never open in the first place.
 */
export function cachedHebrewVoices(): VoiceOption[] {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS) return restrictToOffered(voiceCache.voices);
  void listHebrewVoices().catch(() => {});
  return [];
}

/** Fills the catalogue cache at startup, off the critical path of any request. */
export function warmVoiceCache(): void {
  void listHebrewVoices().catch(() => {});
}

/**
 * The voices a business may actually choose, when the deployment restricts them.
 *
 * There are two voice agents — one masculine, one feminine — and each speaks about itself in its
 * own gender, fixed at deploy time (TORI_AGENT_GENDER in voice-agent/main.py). A salon picking any
 * other voice from Cartesia's full Hebrew catalogue would get that voice speaking the wrong
 * gender's verbs, because the number it dialled routes to one of those two agents regardless.
 *
 * Left empty, the full catalogue is offered — the restriction only exists once the two ids are
 * configured, so nothing changes for a deployment that hasn't set them.
 */
function offeredVoiceIds(): Set<string> {
  const raw = process.env.TORI_VOICE_IDS?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

function restrictToOffered(voices: VoiceOption[]): VoiceOption[] {
  const offered = offeredVoiceIds();
  return offered.size === 0 ? voices : voices.filter((v) => offered.has(v.id));
}

export async function listHebrewVoices(): Promise<VoiceOption[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS) return restrictToOffered(voiceCache.voices);

  // Deliberately not creds(): that also demands CARTESIA_AGENT_ID, which listing voices has no use
  // for. An account with a key but no agent id configured silently had an empty voice picker and,
  // since /context derives the agent's grammatical gender from this catalogue, an agent stuck
  // speaking in the feminine — two unrelated-looking symptoms from one missing variable.
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[cartesia] CARTESIA_API_KEY is not set — no voices, and no voice gender");
    return [];
  }

  let voices: VoiceOption[];
  try {
    // expand[] is what makes preview_file_url present at all; without it every voice is a name with
    // no way to hear it before choosing.
    const res = await call<{ data?: CartesiaVoice[] }>(
      "/voices?limit=100&expand[]=preview_file_url",
      apiKey
    );
    voices = (res.data ?? []).filter(speaksHebrew).map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description ?? null,
      gender:
        v.gender === "masculine" || v.gender === "feminine" || v.gender === "gender_neutral"
          ? v.gender
          : null,
      previewUrl: v.preview_file_url ?? null,
    }));
  } catch (err) {
    console.warn("[cartesia] Could not load the voice catalogue:", err instanceof Error ? err.message : err);
    return [];
  }

  // The cache holds the unfiltered catalogue so the restriction can change without a refetch.
  voiceCache = { at: Date.now(), voices };
  return restrictToOffered(voices);
}

/** Test seam — the cache would otherwise leak one test's catalogue into the next. */
export function resetVoiceCache(): void {
  voiceCache = null;
}

export interface AssignResult {
  /** False when the number was already pointed at this agent — nothing was changed. */
  changed: boolean;
  phoneNumberId: string;
  /** True when the number was absent from the account and was imported over the SIP trunk. */
  imported?: boolean;
}

export interface AssignOptions {
  /**
   * Shown against the number in Cartesia's dashboard. Passing the salon's name turns an unreadable
   * list of E.164 strings into something an operator can work with.
   */
  label?: string;
  /**
   * Whether a number Cartesia has never seen should be imported over our SIP trunk. Defaults to
   * true, which is right when an owner deliberately saved this number as their voice line.
   *
   * Pass false for numbers we inferred rather than were given. Importing one of those bills a line
   * to our trunk that our carrier does not own, on a guess.
   */
  importIfMissing?: boolean;
}

/**
 * Points a number at the shared voice agent, importing it from our SIP trunk first if Cartesia has
 * never seen it.
 *
 * Matches on the number rather than an id because that is what the owner has in front of them; the
 * id only exists inside Cartesia. Returns changed:false when it was already assigned, so a repeated
 * save is a no-op rather than a redundant write.
 */
export async function assignNumberToAgent(
  phoneNumber: string,
  { label, importIfMissing = true }: AssignOptions = {}
): Promise<AssignResult> {
  const { apiKey, agentId } = creds();
  const wanted = normalizePhone(phoneNumber);

  const list = await call<{ data?: CartesiaPhoneNumber[] }>("/agents/phone-numbers", apiKey);
  const match = (list.data ?? []).find((n) => normalizePhone(n.number) === wanted);

  if (!match) {
    if (!importIfMissing) {
      throw new Error(`+${wanted} is not in the Cartesia account, and was not imported because it was inferred rather than entered.`);
    }
    return importAndAssign(wanted, apiKey, agentId, label);
  }

  if (match.agent?.id === agentId) return { changed: false, phoneNumberId: match.id };

  await call<CartesiaPhoneNumber>(`/agents/phone-numbers/${match.id}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: agentId }),
  });

  return { changed: true, phoneNumberId: match.id };
}

/**
 * Brings a number Cartesia has never seen onto the account and points it at the agent.
 *
 * The agent is set in the import request rather than by a follow-up PATCH. Cartesia accepts
 * `agent_id` on import, and doing it in two calls would leave a window — however brief — where the
 * number is live with no agent behind it, which is the exact failure this module exists to prevent.
 *
 * Without a registered trunk there is nothing to import from, so this keeps the original error
 * rather than inventing a fallback: the number really is absent, and saying so is more useful than
 * failing somewhere further along.
 */
async function importAndAssign(
  normalizedNumber: string,
  apiKey: string,
  agentId: string,
  label?: string
): Promise<AssignResult> {
  const providerId = process.env.CARTESIA_SIP_PROVIDER_ID?.trim();
  if (!providerId) {
    throw new Error(
      `+${normalizedNumber} is not in the Cartesia account, and no SIP trunk is configured to import it from ` +
        `(CARTESIA_SIP_PROVIDER_ID is unset). Import the number in Cartesia first, then save again.`
    );
  }

  // Cartesia stores and expects E.164; normalizePhone strips to digits for comparison.
  const created = await call<CartesiaPhoneNumber>("/agents/phone-numbers", apiKey, {
    method: "POST",
    body: JSON.stringify({
      number: `+${normalizedNumber}`,
      provider: { id: providerId },
      agent_id: agentId,
      ...(label ? { label } : {}),
    }),
  });

  return { changed: true, phoneNumberId: created.id, imported: true };
}

/**
 * One live call as Cartesia recorded it.
 *
 * There is no duration field: a call is a start and an end, and the billable minutes are the
 * subtraction. `telephony_params.to` is the number the caller dialled, which is the only thing
 * that says which salon a call belongs to — one shared agent answers for all of them.
 */
export interface CartesiaCall {
  id: string;
  start_time: string;
  end_time?: string | null;
  status?: string | null;
  end_reason?: string | null;
  telephony_params?: { to?: string | null; from?: string | null; call_sid?: string | null } | null;
}

interface CallPage {
  data: CartesiaCall[];
  has_more?: boolean;
  next_page?: string | null;
}

/**
 * Every call the agent has taken since `since`, newest first.
 *
 * This is the account's own record of what it billed us for, and it is the only honest source for
 * minutes: our ledger can time a call from the ring to the last thing the model said, which
 * silently undercounts the tail, and it cannot see a call that never reached /context at all.
 *
 * The route takes the agent as a query parameter — `/agents/{id}/calls` is a 404 — and pages with
 * an opaque cursor. `maxPages` is a stop, not a preference: this runs on a timer, and an account
 * with a year of history should not turn one tick into a hundred sequential requests.
 */
export async function listAgentCalls(since: Date, maxPages = 20): Promise<CartesiaCall[]> {
  const { apiKey, agentId } = creds();
  const calls: CartesiaCall[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({ agent_id: agentId, limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const body: CallPage = await call<CallPage>(`/agents/calls?${query}`, apiKey);
    const rows = body.data ?? [];
    calls.push(...rows);

    // Newest first, so the first record older than the window means every later one is too. This
    // is what keeps a routine sync to one request no matter how long the account has existed.
    if (rows.some((c) => new Date(c.start_time).getTime() < since.getTime())) break;
    if (!body.has_more || rows.length === 0) break;
    cursor = body.next_page ?? rows[rows.length - 1]?.id ?? null;
    if (!cursor) break;
  }

  return calls.filter((c) => new Date(c.start_time).getTime() >= since.getTime());
}
