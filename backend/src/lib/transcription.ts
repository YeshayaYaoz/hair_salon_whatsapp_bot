/**
 * Voice-note transcription for the WhatsApp bot. Entirely optional — if OPENAI_API_KEY isn't
 * set, callers should treat transcription as unavailable and fall back gracefully (matching the
 * codebase's existing pattern for optional integrations).
 *
 * The Anthropic/Claude API has no audio-transcription endpoint, so this uses OpenAI's Whisper
 * API purely for speech-to-text; the resulting text is then handled by the normal Claude-powered
 * bot pipeline exactly as if the customer had typed it.
 */

const GRAPH_VERSION = "v20.0";

export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not set — voice transcription is unavailable");
    this.name = "TranscriptionNotConfiguredError";
  }
}

/** Downloads WhatsApp media (e.g. a voice note) given its media id. Two-step Graph API fetch. */
async function downloadWhatsAppMedia(mediaId: string, accessToken: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) throw new Error(`Failed to fetch WhatsApp media metadata (${metaRes.status}): ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as { url: string; mime_type: string };

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) throw new Error(`Failed to download WhatsApp media file (${fileRes.status})`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type };
}

/** Transcribes raw audio bytes via OpenAI's Whisper API. Returns the transcript text. */
async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TranscriptionNotConfiguredError();

  // WhatsApp voice notes are typically audio/ogg; codecs=opus. Extension doesn't need to be
  // exact — Whisper infers format from the file content, the name just needs a plausible one.
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : "bin";
  const form = new FormData();
  // Buffer's type declares an ArrayBufferLike (which could in theory be a SharedArrayBuffer),
  // but Buffer.from()/fetch() always produce a real ArrayBuffer in practice — safe to assert.
  const bytes = new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
  form.append("file", new Blob([bytes], { type: mimeType }), `voice.${ext}`);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper transcription failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { text: string };
  return body.text.trim();
}

/**
 * Downloads and transcribes a WhatsApp voice note in one step. Throws
 * TranscriptionNotConfiguredError if OPENAI_API_KEY isn't set — callers should catch this
 * specifically to show a "can't listen to voice messages yet" reply rather than a generic error.
 */
export async function transcribeWhatsAppVoiceNote(mediaId: string, whatsappAccessToken: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new TranscriptionNotConfiguredError();
  const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId, whatsappAccessToken);
  return transcribeAudio(buffer, mimeType);
}
