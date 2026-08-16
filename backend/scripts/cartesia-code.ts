/**
 * Reads a verification code out of a recent Cartesia call.
 *
 * Usage (from backend/, against the environment holding CARTESIA_API_KEY):
 *   railway run npx tsx scripts/cartesia-code.ts --to +972559661420
 *   railway run npx tsx scripts/cartesia-code.ts --to +972559661420 --discover
 *
 * Meta will send a WhatsApp verification code either by SMS or by calling the number and reading it
 * aloud. An inbound SMS to a Zadarma number is billed; an inbound call is not — and the call is
 * answered by the voice agent anyway, which means the code is spoken into a transcript we can
 * fetch. So the cheap path and the automatable path are the same path.
 *
 * Cartesia's call API is not something to guess at, so `--discover` tries the plausible endpoints
 * and prints which answer. Once one is known to work the normal run uses it directly.
 *
 * The code is printed. It is single-use and expires in minutes, and it lands in a CI log — which is
 * why the workflow that runs this masks it. Do not widen that.
 */

const BASE_URL = "https://api.cartesia.ai";
const API_VERSION = "2026-03-01";
const apiKey = process.env.CARTESIA_API_KEY?.trim();
const agentId = process.env.CARTESIA_AGENT_ID?.trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function get(path: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text };
    }
  } catch (err) {
    return { status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Six consecutive digits, however they were spoken.
 *
 * Meta's robot reads the code digit by digit, so the transcript may hold "1 2 3 4 5 6", "123456",
 * or digits separated by hyphens or commas depending on how the STT segmented it. Stripping
 * non-digits from a window and taking the first run of six is more robust than matching a format.
 * The Hebrew words are here because the agent's STT is configured for Hebrew and will sometimes
 * transcribe spoken English digits into Hebrew words.
 */
const HEBREW_DIGITS: Record<string, string> = {
  אפס: "0", אחת: "1", אחד: "1", שתיים: "2", שניים: "2", שלוש: "3", שלושה: "3",
  ארבע: "4", ארבעה: "4", חמש: "5", חמישה: "5", שש: "6", שישה: "6",
  שבע: "7", שבעה: "7", שמונה: "8", תשע: "9", תשעה: "9",
};

export function extractCode(text: string, ignore: string[] = []): string | null {
  let working = text;
  // Remove the numbers already known to be in the payload before looking for six digits.
  //
  // This is the whole difficulty. A call record carries the dialled and calling numbers, and
  // "+972559661420" contains several six-digit runs — so scanning the payload and taking the first
  // one returns a slice of the phone number, which Meta rejects as an incorrect code. That is
  // exactly what happened on the first live attempt, and it looks identical to a mis-transcribed
  // code, which is the wrong thing to go and investigate.
  for (const raw of ignore) {
    const d = raw.replace(/\D/g, "");
    if (d.length < 6) continue;
    // Both as written and as bare digits: transcripts hold "+972-55-966-1420" and "972559661420".
    working = working.split(raw).join(" ");
    working = working.split(d).join(" ");
  }

  const normalized = working
    .split(/\s+/)
    .map((w) => HEBREW_DIGITS[w.replace(/[^֐-׿]/g, "")] ?? w)
    .join(" ");

  // One run at a time, never the whole string. Spaces and hyphens stay inside a run because a
  // transcriber writes the same spoken code as "482917", "4 8 2 9 1 7" or "48-29-17"; everything
  // else separates. Concatenating every digit in the payload instead would splice unrelated
  // numbers — "123" and "456" in adjacent fields become a six-digit code that nobody said, and
  // Meta rejects it with the same message a mis-heard code gets.
  for (const chunk of normalized.split(/[^\d\s-]+/)) {
    const digits = chunk.replace(/[\s-]+/g, "");
    if (digits.length === 6) return digits;
  }
  return null;
}

/**
 * Transcribes the call recording with Whisper, because the agent's own transcript cannot be trusted
 * for digits.
 *
 * Cartesia's speech recognition is configured for Hebrew, and Meta's verification robot speaks
 * English digit by digit. The result on a live call was "9, זירו zero, 8" — one spoken zero emitted
 * twice, in two alphabets — with the digits scattered over seven turns and each of Meta's three
 * repetitions mangled differently. Three plausible reconstructions, no way to choose between them,
 * and each wrong guess burns a verification attempt.
 *
 * The audio still has the code in it. Whisper is told the language is English and primed to expect
 * digits, which is exactly the case the agent's own pipeline is configured against.
 */
async function transcribeRecording(callId: string): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    console.log("OPENAI_API_KEY is not set — cannot transcribe the recording.");
    return null;
  }

  const res = await fetch(`${BASE_URL}${CALLS_PATH}/${encodeURIComponent(callId)}/audio`, {
    headers: { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": API_VERSION },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.log(`  recording for ${callId} → HTTP ${res.status}`);
    return null;
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) {
    console.log(`  recording for ${callId} is empty`);
    return null;
  }

  // Whisper picks its decoder off the filename, so the container has to be named correctly rather
  // than guessed at — a wav sent as .mp3 is rejected as corrupt.
  const head = audio.subarray(0, 4).toString("binary");
  const ext = head.startsWith("RIFF") ? "wav" : head.startsWith("OggS") ? "ogg" : head.startsWith("ID3") ? "mp3" : "wav";
  console.log(`  recording: ${audio.length} bytes, sending as .${ext}`);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), `call.${ext}`);
  form.append("model", "whisper-1");
  // Meta's robot speaks English regardless of the language the code was requested in.
  form.append("language", "en");
  form.append("prompt", "A six-digit verification code read out one digit at a time.");

  const w = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await w.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!w.ok || json.error) {
    console.log(`  Whisper failed: ${json.error?.message ?? `HTTP ${w.status}`}`);
    return null;
  }
  return json.text ?? null;
}

/** Every string in an arbitrarily-shaped payload, so a transcript is found wherever it is nested. */
function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allText(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allText(v, out);
  return out;
}

// Settled by --discover against the live account: /agents/calls is the endpoint, and it requires
// agent_id as a query parameter rather than a path segment. /calls, /agents/call-history and
// /agents/{id}/calls all 404.
const CALLS_PATH = "/agents/calls";

function callsUrl(limit: number): string {
  if (!agentId) throw new Error("CARTESIA_AGENT_ID is required — /agents/calls takes it as a query parameter");
  return `${CALLS_PATH}?agent_id=${encodeURIComponent(agentId)}&limit=${limit}`;
}

async function main() {
  // Checked here rather than at module scope: exiting during import makes the file unimportable,
  // and extractCode below is pure and worth testing on its own.
  if (!apiKey) {
    console.error("CARTESIA_API_KEY is not set in this environment.");
    process.exit(1);
  }

  if (has("discover")) {
    const r = await get(callsUrl(5));
    const shape = typeof r.body === "string" ? r.body.slice(0, 400) : JSON.stringify(r.body, null, 2).slice(0, 2500);
    console.log(`GET ${callsUrl(5)} → ${r.status}\n${shape}`);
    return;
  }

  const to = arg("to");
  if (!to) throw new Error("--to is required: the number Meta called");
  const wanted = to.replace(/\D/g, "");

  const list = await get(callsUrl(20));
  if (list.status !== 200) {
    console.log(`GET ${CALLS_PATH} → ${list.status}: ${JSON.stringify(list.body).slice(0, 300)}`);
    return;
  }

  const body = list.body as Record<string, unknown>;
  const calls = ((body?.data as unknown[]) ?? (body?.calls as unknown[]) ?? []) as Array<Record<string, unknown>>;
  if (calls.length === 0) {
    console.log("No calls on this agent yet.");
    return;
  }

  // Match on the dialled number rather than "these digits appear somewhere": every call payload is
  // full of digits, and another salon's call would match by accident.
  const mine = calls.filter((c) => {
    const tp = (c.telephony_params ?? {}) as Record<string, unknown>;
    return String(tp.to ?? "").replace(/\D/g, "") === wanted;
  });
  if (mine.length === 0) {
    console.log(`${calls.length} recent call(s), none to ${to}.`);
    console.log("Meta calls only after --request-code, and the record appears when the call ends.");
    return;
  }

  // The list carries a summary, not the words. A summary of a robot reading six digits may or may
  // not contain them, so the transcript is fetched per call — and the sub-resource is undocumented,
  // so the plausible ones are tried and the first that answers is used.
  // Whisper first when asked for: the agent's own transcript is unreliable for digits, and a wrong
  // code costs a verification attempt rather than a retry.
  if (has("whisper")) {
    // The newest call only, and never a fallback to an older one.
    //
    // Falling back is what makes this dangerous rather than merely unhelpful: when the newest
    // call's recording is not written yet, an older call is still sitting there with a code that
    // has already expired. Submitting it fails with "Incorrect code entered" — the same message a
    // mis-heard code gets — and burns an attempt on a code that was never in play.
    const call = mine[0];
    const id = String(call.id ?? "");
    const startedAt = String(call.start_time ?? "");
    const ageMin = startedAt ? (Date.now() - Date.parse(startedAt)) / 60_000 : Infinity;
    const maxAge = Number(arg("max-age-minutes") ?? 15);

    console.log(`Newest call to ${to}: ${id}, started ${startedAt} (${ageMin.toFixed(1)} min ago)`);
    if (ageMin > maxAge) {
      console.log(`That is older than ${maxAge} minutes, so its code has expired. Request a new one.`);
      return;
    }

    const text = await transcribeRecording(id);
    if (!text) {
      console.log("No recording yet for that call — Cartesia writes it after the call ends. Wait and retry.");
      return;
    }
    console.log(`  Whisper heard: ${text.slice(0, 300)}`);
    const tp = (call.telephony_params ?? {}) as Record<string, unknown>;
    const code = extractCode(text, [String(tp.to ?? ""), String(tp.from ?? ""), to, id].filter(Boolean));
    if (code) {
      console.log(`Found a six-digit code: ${code}`);
      return;
    }
    console.log("No six-digit run in that recording.");
    return;
  }

  const SUBPATHS = ["", "/transcript", "/messages", "/events"];
  // Two failed verifications in a row is the point to stop refining the extractor and look at what
  // the agent actually heard. Meta's robot speaks English into a Hebrew speech recogniser, which is
  // not a combination anything here should assume the shape of.
  if (has("dump")) {
    for (const call of mine.slice(0, 2)) {
      const id = String(call.id ?? "");
      console.log(`\n===== call ${id}  start=${String(call.start_time ?? "?")}`);
      for (const sub of [...SUBPATHS, "/recording", "/recordings", "/audio"]) {
        const detail = await get(`${CALLS_PATH}/${encodeURIComponent(id)}${sub}`);
        if (detail.status !== 200) continue;
        console.log(`--- ${sub || "(detail)"}:`);
        console.log(JSON.stringify(detail.body).slice(0, 3000));
      }
    }
    return;
  }
  for (const call of mine) {
    const id = String(call.id ?? "");
    // Newest first, and the summary is free to check before spending requests on sub-resources.
    for (const sub of SUBPATHS) {
      const detail = await get(`${CALLS_PATH}/${encodeURIComponent(id)}${sub}`);
      if (detail.status !== 200) continue;
      // Everything already known to be in this record is excluded, so what is left is what was
      // spoken.
      const tp = (call.telephony_params ?? {}) as Record<string, unknown>;
      const known = [String(tp.to ?? ""), String(tp.from ?? ""), to, id].filter(Boolean);
      const code = extractCode(allText(detail.body).join(" "), known);
      if (code) {
        console.log(`Found a six-digit code in ${CALLS_PATH}/${id}${sub}: ${code}`);
        return;
      }
      console.log(`  ${CALLS_PATH}/${id}${sub} → 200, no six-digit run in it`);
    }
  }

  console.log(`\n${mine.length} call(s) to ${to}, none carrying a readable code.`);
  console.log("If Meta has just called, wait for the call to end — the transcript is written then.");
}

// Only when run as a script. Importing this module for extractCode must not place a call.
if (process.argv[1]?.includes("cartesia-code")) {
  main().catch((err) => {
    console.error("✖", (err as Error).message);
    process.exit(1);
  });
}
