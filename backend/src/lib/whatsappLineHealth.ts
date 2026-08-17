/**
 * Asks Meta, once a day, whether each business's WhatsApp line actually works.
 *
 * The digest already had a WhatsApp check, but it read `whatsappTokenValid` — a flag we set only
 * *after* a send has already failed. By the time it flips, a customer has been ignored. And nothing
 * at all covered the failures that never produce a rejected send: a line Meta moved out of
 * CONNECTED, a quality rating sliding toward the throttle, or a business still sitting on the
 * +1 555 test number that ships with every new app and cannot reach an Israeli customer.
 *
 * None of that is visible in our own tables. Two separate times, reading a local column as if it
 * described Meta's state produced a confident wrong answer about a working customer — so the rule
 * here is that Meta is asked, and our columns are only used to find who to ask about.
 *
 * Every failure is contained: one business's broken token, timeout, or malformed response must not
 * cost the digest the other businesses' results, and must never take the server down.
 */

const GRAPH = "https://graph.facebook.com/v23.0";
const TIMEOUT_MS = 10_000;

/** The name Meta gives the sample number attached to every new app. */
const META_TEST_NUMBER_NAME = "Test Number";

export interface LineHealth {
  business: string;
  /** Null when Meta's answer says nothing is wrong. */
  problem: string | null;
}

interface GraphPhoneNumber {
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  quality_rating?: string;
}

/**
 * Turns Meta's answer into a problem description, or null when the line is healthy.
 *
 * Split out from the fetch so the judgement can be tested without a network: what counts as a
 * problem is the part worth getting right.
 */
export function describeProblem(line: GraphPhoneNumber): string | null {
  if (line.verified_name === META_TEST_NUMBER_NAME) {
    return `still on Meta's test number (${line.display_phone_number ?? "unknown"}) — it cannot message real customers`;
  }
  if (line.status && line.status !== "CONNECTED") {
    return `line is ${line.status}, not CONNECTED`;
  }
  // RED means Meta is already throttling. YELLOW is the warning before it, and it is the last point
  // at which anything can be done cheaply, so it counts.
  if (line.quality_rating === "RED" || line.quality_rating === "YELLOW") {
    return `quality rating ${line.quality_rating} — Meta throttles sending at RED`;
  }
  return null;
}

async function fetchLine(phoneNumberId: string, token: string): Promise<LineHealth["problem"]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name,status,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = json.error as { message?: string } | undefined;
    // A rejected token is the most actionable finding here: the business is connected as far as our
    // own tables know, and every send will fail until it is reconnected.
    if (error) return `Meta rejected the request — ${error.message ?? "no message"}`;
    return describeProblem(json as GraphPhoneNumber);
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "timed out" : (err as Error).message;
    return `could not reach Meta — ${reason}`;
  } finally {
    clearTimeout(timer);
  }
}

export interface CheckableBusiness {
  name: string;
  phoneNumberId: string;
  /** Already decrypted by the caller — this module never touches stored ciphertext. */
  accessToken: string;
}

/** Checks every business, returning only the ones with something wrong. */
export async function checkWhatsAppLines(businesses: CheckableBusiness[]): Promise<LineHealth[]> {
  const results = await Promise.allSettled(
    businesses.map(async (b) => ({ business: b.name, problem: await fetchLine(b.phoneNumberId, b.accessToken) }))
  );

  const problems: LineHealth[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      if (r.value.problem) problems.push(r.value);
    } else {
      // fetchLine catches its own errors, so reaching here means something unforeseen. Reported
      // rather than swallowed: a check that silently stops checking is worse than no check.
      problems.push({
        business: businesses[i].name,
        problem: `health check itself failed — ${String(r.reason)}`,
      });
    }
  }
  return problems;
}
