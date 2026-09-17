import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWhatsAppMessage, sendWhatsAppTemplate, setSendObserver, WhatsAppSendError } from "./whatsappClient.js";

/**
 * The ledger's completeness rests on one property of the client: every send reports its outcome
 * to the observer, accepted or refused, and no call site can opt out. These pin that property —
 * and that a broken observer cannot break a send.
 */
const fetchMock = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const refused = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });
const common = { phoneNumberId: "pn-1", accessToken: "tok", to: "972501111111" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setSendObserver(null);
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("send observer", () => {
  it("reports an accepted text send with its message id, under the payload type when unlabelled", async () => {
    const seen = vi.fn();
    setSendObserver(seen);
    fetchMock.mockResolvedValueOnce(ok({ messages: [{ id: "wamid.1" }] }));

    await sendWhatsAppMessage({ ...common, text: "היי" });
    await settle();

    expect(seen).toHaveBeenCalledWith({ phoneNumberId: "pn-1", to: "972501111111", kind: "text", templateName: undefined, messageId: "wamid.1" });
  });

  it("carries a caller's label and a template's name", async () => {
    const seen = vi.fn();
    setSendObserver(seen);
    fetchMock.mockResolvedValueOnce(ok({ messages: [{ id: "wamid.2" }] }));

    await sendWhatsAppTemplate({ ...common, kind: "reminder", templateName: "reminder_he", languageCode: "he", bodyParams: [] });
    await settle();

    expect(seen.mock.calls[0][0]).toMatchObject({ kind: "reminder", templateName: "reminder_he", messageId: "wamid.2" });
  });

  it("reports a refusal with Meta's code, then still throws to the caller", async () => {
    const seen = vi.fn();
    setSendObserver(seen);
    fetchMock.mockResolvedValueOnce(refused(400, { error: { code: 131047, message: "Re-engagement" } }));

    await expect(sendWhatsAppMessage({ ...common, text: "היי" })).rejects.toBeInstanceOf(WhatsAppSendError);
    await settle();

    expect(seen.mock.calls[0][0].refused).toMatchObject({ status: 400, code: 131047 });
    expect(seen.mock.calls[0][0].messageId).toBeUndefined();
  });

  it("does not let a failing observer fail the send", async () => {
    setSendObserver(() => { throw new Error("ledger down"); });
    fetchMock.mockResolvedValueOnce(ok({ messages: [{ id: "wamid.3" }] }));

    await expect(sendWhatsAppMessage({ ...common, text: "היי" })).resolves.toEqual({ messageId: "wamid.3" });
  });

  it("does not let a rejecting async observer fail the send either", async () => {
    setSendObserver(async () => { throw new Error("ledger down"); });
    fetchMock.mockResolvedValueOnce(ok({ messages: [{ id: "wamid.4" }] }));

    await expect(sendWhatsAppMessage({ ...common, text: "היי" })).resolves.toEqual({ messageId: "wamid.4" });
    await settle();
  });
});
