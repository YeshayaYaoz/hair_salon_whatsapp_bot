import { describe, it, expect, beforeEach, vi } from "vitest";

describe("transcribeWhatsAppVoiceNote", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it("throws TranscriptionNotConfiguredError immediately when OPENAI_API_KEY is unset, without attempting any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transcribeWhatsAppVoiceNote, TranscriptionNotConfiguredError } = await import("./transcription.js");

    await expect(transcribeWhatsAppVoiceNote("media123", "wa-token")).rejects.toThrow(TranscriptionNotConfiguredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("downloads media and transcribes it when OPENAI_API_KEY is configured", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { transcribeWhatsAppVoiceNote } = await import("./transcription.js");

    const fetchMock = vi.fn()
      // 1. media metadata lookup
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://cdn.example/media123", mime_type: "audio/ogg" }),
      })
      // 2. actual media download
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })
      // 3. Whisper transcription
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "  אני רוצה לקבוע תור  " }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeWhatsAppVoiceNote("media123", "wa-token");

    expect(result).toBe("אני רוצה לקבוע תור"); // trimmed
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Third call is the Whisper request, authenticated with the OpenAI key, not the WhatsApp token.
    const whisperCall = fetchMock.mock.calls[2];
    expect(whisperCall[0]).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((whisperCall[1].headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("surfaces a clear error if the WhatsApp media download fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { transcribeWhatsAppVoiceNote } = await import("./transcription.js");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" }));

    await expect(transcribeWhatsAppVoiceNote("bad-media", "wa-token")).rejects.toThrow(/media metadata/i);
  });
});
