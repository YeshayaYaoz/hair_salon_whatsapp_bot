/**
 * Reading a WhatsApp verification code out of the call Meta placed to a provisioned number.
 *
 * A number we issue is a VoIP line pointed at Cartesia, so an SMS to it may never arrive — but a
 * verification CALL is answered by the voice agent, and Cartesia keeps the recording. The code is
 * in that audio.
 *
 * This is the same logic scripts/cartesia-code.ts runs by hand, moved here so the server can do it
 * unattended. Every hard-won rule in it is load-bearing and was paid for on a live number:
 *
 *   - Whisper on the recording, not the agent's own transcript. The agent's recognition is set to
 *     Hebrew; Meta's robot reads digits in English. A live call produced "9, זירו zero, 8" — one
 *     spoken zero in two alphabets, digits scattered over seven turns, each of Meta's three
 *     repetitions mangled differently.
 *   - The newest call only, never an older one. A stale call holds an expired code, and submitting
 *     it fails with the same "Incorrect code entered" a mis-heard code gets, burning an attempt.
 *   - The dialled and calling numbers are removed before searching. "+972559661420" contains
 *     several six-digit runs, and the first live attempt submitted a slice of the phone number.
 */

const BASE_URL = "https://api.cartesia.ai";
const API_VERSION = "2025-04-16";
const CALLS_PATH = "/agents/calls";

/** Hebrew number words, in case the agent's own transcript is ever the only thing available. */
const HEBREW_DIGITS: Record<string, string> = {
  אפס: "0", אחת: "1", אחד: "1", שתיים: "2", שניים: "2", שלוש: "3", שלושה: "3",
  ארבע: "4", ארבעה: "4", חמש: "5", חמישה: "5", שש: "6", שישה: "6",
  שבע: "7", שבעה: "7", שמונה: "8", תשע: "9", תשעה: "9",
};

export function extractCode(text: string, ignore: string[] = []): string | null {
  let working = text;
  // Remove the numbers already known to be in the payload before looking for six digits. A call
  // record carries the dialled and calling numbers, and a phone number contains several six-digit
  // runs — taking the first one returns a slice of the phone number, which Meta rejects as an
  // incorrect code and which looks identical to a mis-transcription.
  for (const raw of ignore) {
    const d = raw.replace(/\D/g, "");
    if (d.length < 6) continue;
    working = working.split(raw).join(" ");
    working = working.split(d).join(" ");
  }

  const normalized = working
    .split(/\s+/)
    .map((w) => HEBREW_DIGITS[w.replace(/[^֐-׿]/g, "")] ?? w)
    .join(" ");

  // One run at a time, never the whole string. Spaces and hyphens stay inside a run because a
  // transcriber writes the same spoken code as "482917", "4 8 2 9 1 7" or "48-29-17". Concatenating
  // every digit in the payload would splice unrelated numbers into a code nobody said.
  for (const chunk of normalized.split(/[^\d\s-]+/)) {
    const digits = chunk.replace(/[\s-]+/g, "");
    if (digits.length === 6) return digits;
  }
  return null;
}

function creds(): { apiKey: string; agentId: string } {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  const agentId = process.env.CARTESIA_AGENT_ID?.trim();
  if (!apiKey || !agentId) throw new Error("CARTESIA_API_KEY and CARTESIA_AGENT_ID are required to read a verification call");
  return { apiKey, agentId };
}

interface CartesiaCallRow {
  id?: unknown;
  start_time?: unknown;
  telephony_params?: Record<string, unknown>;
}

/** The most recent call Cartesia recorded to this number, or null. */
async function newestCallTo(e164: string): Promise<CartesiaCallRow | null> {
  const { apiKey, agentId } = creds();
  const wanted = e164.replace(/\D/g, "");
  const res = await fetch(
    `${BASE_URL}${CALLS_PATH}?agent_id=${encodeURIComponent(agentId)}&limit=20`,
    { headers: { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": API_VERSION }, signal: AbortSignal.timeout(30_000) }
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const calls = ((body?.data as unknown[]) ?? (body?.calls as unknown[]) ?? []) as CartesiaCallRow[];
  // Matched on the dialled number rather than "these digits appear somewhere": every payload is
  // full of digits and another business's call would match by accident.
  return calls.find((c) => String((c.telephony_params ?? {}).to ?? "").replace(/\D/g, "") === wanted) ?? null;
}

async function transcribeRecording(callId: string): Promise<string | null> {
  const { apiKey } = creds();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) return null;

  const res = await fetch(`${BASE_URL}${CALLS_PATH}/${encodeURIComponent(callId)}/audio`, {
    headers: { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": API_VERSION },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) return null;

  // Whisper picks its decoder off the filename, so the container has to be named rather than
  // guessed at — a wav sent as .mp3 is rejected as corrupt.
  const head = audio.subarray(0, 4).toString("binary");
  const ext = head.startsWith("RIFF") ? "wav" : head.startsWith("OggS") ? "ogg" : head.startsWith("ID3") ? "mp3" : "wav";

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
  const json = (await w.json().catch(() => ({}))) as { text?: string; error?: unknown };
  if (!w.ok || json.error) return null;
  return json.text ?? null;
}

/**
 * The code Meta just read out to this number, or null if it isn't readable yet.
 *
 * Returns null rather than throwing for "not yet": the caller polls, and a call that has not ended
 * has no recording to fetch. `maxAgeMinutes` guards against reading a previous verification
 * attempt's call — its code has expired, and submitting it burns an attempt on a code that was
 * never in play.
 */
export async function readVerificationCodeFromCall(
  e164: string,
  maxAgeMinutes = 15
): Promise<string | null> {
  const call = await newestCallTo(e164);
  if (!call) return null;

  const startedAt = String(call.start_time ?? "");
  const ageMinutes = startedAt ? (Date.now() - Date.parse(startedAt)) / 60_000 : Infinity;
  if (ageMinutes > maxAgeMinutes) return null;

  const text = await transcribeRecording(String(call.id ?? ""));
  if (!text) return null;

  const tp = (call.telephony_params ?? {}) as Record<string, unknown>;
  return extractCode(text, [String(tp.to ?? ""), String(tp.from ?? ""), e164, String(call.id ?? "")].filter(Boolean));
}
