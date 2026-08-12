import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A phone booking has to leave the customer something in writing.
 *
 * bookAppointmentWithSideEffects alerted the owner and synced the calendar, and sent the customer
 * nothing. On WhatsApp that was invisible — the bot's own reply is the confirmation — so the gap
 * only opened when the phone line did: the voice agent reads a time aloud, the call ends, and the
 * caller is holding a time they heard once for a business whose address they were also told once.
 *
 * The channel distinction is the point of these tests. Sending on both channels would double every
 * WhatsApp booking with a duplicate.
 */

const mockPrisma = {
  business: { findUnique: vi.fn() },
  appointment: { update: vi.fn() },
};
const sendWithTemplateFallback = vi.fn(async () => "sent" as const);
const createAppointment = vi.fn();
const notifyOwner = vi.fn(async () => true);

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (s: string) => `dec:${s}` }));
vi.mock("./availability.js", () => ({
  createAppointment: (...a: unknown[]) => createAppointment(...a),
  SlotUnavailableError: class extends Error {},
  OutsideBusinessHoursError: class extends Error {},
}));
vi.mock("../lib/googleCalendar.js", () => ({
  syncAppointmentToCalendar: vi.fn(async () => null),
  deleteCalendarEvent: vi.fn(async () => {}),
}));
vi.mock("../lib/waitlist.js", () => ({ notifyWaitlist: vi.fn(async () => {}) }));
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));
vi.mock("../lib/scheduledMessages.js", () => ({
  sendWithTemplateFallback: (...a: unknown[]) => sendWithTemplateFallback(...(a as [])),
}));

const { bookAppointmentWithSideEffects } = await import("./actions.js");

const START = new Date("2026-08-20T09:00:00.000Z");

function book(source?: "whatsapp" | "voice") {
  return bookAppointmentWithSideEffects({
    businessId: "biz1",
    serviceId: "svc1",
    serviceName: "תספורת",
    customerPhone: "972501234567",
    customerName: "רועי כהן",
    startTime: START,
    ownerAlertPrefix: "📞 הזמנה חדשה",
    source,
  });
}

/** The confirmation is fire-and-forget, so it lands a microtask after the booking resolves. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("booking confirmation to the customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAppointment.mockResolvedValue({ id: "appt1", startTime: START, endTime: START });
    mockPrisma.business.findUnique.mockResolvedValue({
      name: "מספרת רונית",
      address: "הרצל 5, חיפה",
      whatsappPhoneNumberId: "pn1",
      whatsappAccessToken: "enc",
    });
    sendWithTemplateFallback.mockResolvedValue("sent");
  });

  it("writes to a customer who booked by phone", async () => {
    await book("voice");
    await settle();
    expect(sendWithTemplateFallback).toHaveBeenCalledOnce();
    const [, common, text, template, params] = sendWithTemplateFallback.mock.calls[0] as unknown[] as [
      string, { to: string }, string, { name: string }, string[]
    ];
    expect(common.to).toBe("972501234567");
    expect(text).toContain("תספורת");
    expect(text).toContain("מספרת רונית");
    // The address is the other thing a caller only heard spoken aloud.
    expect(text).toContain("הרצל 5, חיפה");
    // Params must match the documented order in whatsappTemplates.ts, or the template renders the
    // service where the name belongs.
    expect(params[0]).toBe("רועי");
    expect(params[1]).toBe("תספורת");
    expect(params[3]).toBe("מספרת רונית");
    expect(template.name).toBeTruthy();
  });

  it("stays quiet for a WhatsApp booking, which the bot already confirmed in-thread", async () => {
    await book("whatsapp");
    await settle();
    expect(sendWithTemplateFallback).not.toHaveBeenCalled();
  });

  it("stays quiet when no source is given, rather than messaging customers by surprise", async () => {
    // Every existing caller predates this parameter. A default that sends would have turned a
    // refactor into an unannounced message to every customer of every business.
    await book();
    await settle();
    expect(sendWithTemplateFallback).not.toHaveBeenCalled();
  });

  it("still returns the appointment when the confirmation cannot be delivered", async () => {
    // The caller has already hung up and the slot is taken. A booking must never fail because a
    // message did — that would lose a real appointment over a notification.
    sendWithTemplateFallback.mockRejectedValue(new Error("WhatsApp is down"));
    await expect(book("voice")).resolves.toMatchObject({ id: "appt1" });
    await settle();
  });

  it("does not attempt a send for a business with no WhatsApp connected", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ name: "עסק", address: null, whatsappPhoneNumberId: null, whatsappAccessToken: null });
    await book("voice");
    await settle();
    expect(sendWithTemplateFallback).not.toHaveBeenCalled();
  });
});
