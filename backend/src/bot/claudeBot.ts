import { prisma } from "../lib/prisma.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTurn, getHistory, type Turn } from "./conversationStore.js";
import { findAvailableSlots, createAppointment, attachDepositPaymentLink, SlotUnavailableError, OutsideBusinessHoursError, type AvailableSlot } from "../booking/availability.js";
import { getPaymentProvider } from "../lib/payments/index.js";
import { parseBookingTime, parseDateString, dayOfWeekForDate, instantPartsInTz, zonedDateParts } from "../lib/timezone.js";
import { notifyWaitlist } from "../lib/waitlist.js";
import { decryptSecret } from "../lib/crypto.js";
import { syncAppointmentToCalendar, deleteCalendarEvent } from "../lib/googleCalendar.js";
import { captureError } from "../lib/errorMonitoring.js";
import { logClaudeUsage } from "../lib/usageLedger.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { toPublicUploadUrl } from "../lib/storage.js";
import { getAiProvider, ProviderCallError, type GenericTool, type GenericTurn } from "./providers/index.js";

// Which LLM backend actually answers a message is resolved per-business (Business.aiProvider) in
// handleIncomingMessage below — this file's tool definitions/loop are provider-agnostic; see
// bot/providers/ for the Anthropic/OpenAI/DeepSeek adapters.

/**
 * Every customer-facing reply uses the smart tier.
 *
 * This used to default to the cheap tier (Haiku) for everything — the previous "simple message"
 * regex was dead code, since both branches returned "cheap". That produced a steady trickle of
 * invented Hebrew words in real conversations ("יתאשר" instead of "יאשר", "משתניים" — literally
 * "variables" — instead of "מהשתיים"), which no amount of prompt wording fixed, because it's a
 * model-capability limit rather than an instruction-following one: Hebrew morphology is simply
 * weaker on the small model.
 *
 * The tradeoff is lopsided. Measured spend was well under ₪1/month per business at Haiku rates,
 * so the smart tier costs a few extra agorot a month — while malformed Hebrew is visible to the
 * business's own customers and makes the business look unprofessional. Quality wins.
 *
 * hadToolError is kept as a parameter (rather than dropped) because the escalation path in the
 * tool loop still calls this, and a future cheap tier for non-Hebrew businesses would want it.
 */
function chooseTier(_messageText: string, _hadToolError: boolean): "cheap" | "smart" {
  return "smart";
}

const tools: GenericTool[] = [
  {
    name: "check_availability",
    description: "Find open appointment slots for a given service on a given date. If the customer requests a longer session (e.g. multiple hours), pass durationMin. If the customer asks for a specific staff member by name, pass staffName to only show that person's open times.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the service, matching a known service name from the system prompt" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        durationMin: { type: "number", description: "Optional override for session length in minutes (e.g. 120 for 2 hours)" },
        staffName: { type: "string", description: "Optional — only set if the customer explicitly asked for a specific staff member by name" },
      },
      required: ["serviceName", "date"],
    },
  },
  {
    name: "book_appointment",
    description: "Book a slot. Only call this after the customer has explicitly chosen a specific time from check_availability results AND you know their name (ask for it first if not already known from CRM context). If the business requires a deposit, this does NOT confirm the booking — it returns depositRequired:true with a paymentUrl; the slot is held but the customer must pay within holdMinutes or it's released.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        startTime: { type: "string", description: "ISO 8601 start time, must come from a prior check_availability result" },
        customerName: { type: "string", description: "Customer's first name — required. Ask the customer for their name before calling this tool if it isn't already known." },
        durationMin: { type: "number", description: "Same durationMin passed to check_availability, if any" },
        staffName: { type: "string", description: "Same staffName passed to check_availability, if the customer requested a specific staff member" },
      },
      required: ["serviceName", "startTime", "customerName"],
    },
  },
  {
    name: "list_my_appointments",
    description: "List this customer's upcoming confirmed appointments.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of this customer's upcoming appointments.",
    input_schema: {
      type: "object",
      properties: {
        startTime: { type: "string", description: "ISO 8601 start time of the appointment to cancel, from list_my_appointments" },
      },
      required: ["startTime"],
    },
  },
  {
    name: "reschedule_appointment",
    description: "Move an existing appointment to a new time in one step. Verify the new slot is free with check_availability first, then call this. The old appointment is cancelled and the new one booked atomically.",
    input_schema: {
      type: "object",
      properties: {
        oldStartTime: { type: "string", description: "ISO 8601 start time of the current appointment, from list_my_appointments" },
        newStartTime: { type: "string", description: "Exact new slot start time from check_availability" },
        serviceName: { type: "string", description: "Service name (defaults to the existing appointment's service if omitted)" },
        durationMin: { type: "number", description: "Optional duration override in minutes" },
        staffName: { type: "string", description: "Only set if the customer wants a different staff member than the original booking — otherwise the original staff assignment carries over automatically." },
      },
      required: ["oldStartTime", "newStartTime"],
    },
  },
  {
    name: "add_to_waitlist",
    description: "Add the customer to the waitlist for a service when no slots are available.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        customerName: { type: "string", description: "Customer's name if known" },
      },
      required: ["serviceName"],
    },
  },
  {
    name: "send_photos",
    description:
      "Send the customer photos of a specific service/unit as real WhatsApp images. Use when they ask to see photos, or ask what a unit looks like. Only works for services that actually have photos configured.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the service/unit whose photos to send, matching a known service name" },
      },
      required: ["serviceName"],
    },
  },
  {
    name: "request_human_followup",
    description: "Alert the salon owner to follow up with this customer. Use for complaints, complex requests, or anything the bot cannot handle.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        customerName: { type: "string", description: "Customer's name if known" },
      },
      required: ["reason"],
    },
  },
];

// Tool used only in "inquiry" booking mode (e.g. B&B): instead of booking a slot, the bot collects
// what the customer wants and alerts the owner to call them back to finalize. No slot engine involved.
const requestBookingCallbackTool: GenericTool = {
  name: "request_booking_callback",
  description:
    "Use when the customer wants to book/reserve and this business handles bookings by callback (not live). Collect and pass the details you have; the owner is alerted to call the customer back to confirm. Do NOT claim the booking is confirmed — only that the owner will call back.",
  input_schema: {
    type: "object",
    properties: {
      details: { type: "string", description: "What the customer wants: dates/nights, unit/service, number of guests, and any preferences — as much as is known." },
      customerName: { type: "string", description: "Customer's name if known" },
    },
    required: ["details"],
  },
};

// Inquiry mode exposes only info + handoff tools — no check_availability/book_appointment/etc.,
// since there is no live booking engine for these verticals.
const inquiryTools: GenericTool[] = [
  requestBookingCallbackTool,
  // A guest asking to see the unit is the single most common request in this mode.
  tools.find((t) => t.name === "send_photos")!,
  tools.find((t) => t.name === "request_human_followup")!,
];

export interface BotResult {
  text: string;
  offeredSlots?: AvailableSlot[];
  /** Photos to send as separate WhatsApp image messages after the text reply. */
  photos?: { url: string; caption?: string }[];
  /** True when this reply opened the conversation — nothing had been said before it. Lets the
   * webhook dress the first message up (greeting button) without guessing. */
  isFirstReply?: boolean;
}

/**
 * Resolves a customer-provided staff name to a StaffMember id. Returns:
 * - { staffId: undefined } if no name was given (no preference — any staff member is fine)
 * - { staffId } if resolved
 * - { error } if the name doesn't match anyone, listing real staff names so the model can retry
 */
/** Strips quotes, punctuation and vertical-type prefixes so `צימר "תאנה"` and `תאנה` compare equal. */
export function normalizeServiceName(name: string): string {
  return name
    // The literal hyphen stays first in the class — anywhere else it would form a character range
    // with its neighbours and silently strip most of the alphabet.
    .replace(/[-"'״׳`()[\]–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Resolves a customer/model-supplied service name to a real Service.
 *
 * Exact matching was too strict in practice. Owners name their units things like `צימר "תאנה"` or
 * `"תמר" - יחידה משפחתית`, while both the customer and the model refer to them by the bare name
 * ("תאנה"). That mismatch made every tool call on those services fail with "Unknown service" even
 * though the name was perfectly recognizable — so this falls back to a containment match on
 * punctuation-stripped names, and only accepts it when exactly one service matches (an ambiguous
 * abbreviation must stay an error rather than silently picking the wrong unit).
 */
async function findServiceByName(businessId: string, rawName: string | undefined) {
  const services = await prisma.service.findMany({ where: { businessId } });
  const query = normalizeServiceName(rawName ?? "");
  if (!query) return { services };
  const exact = services.find((s) => normalizeServiceName(s.name) === query);
  if (exact) return { service: exact, services };
  const partial = services.filter((s) => {
    const n = normalizeServiceName(s.name);
    return n.includes(query) || query.includes(n);
  });
  if (partial.length === 1) return { service: partial[0], services };
  return { services };
}

/** The standard "couldn't resolve that name" payload, listing the real names so the model can retry. */
function unknownServiceError(services: { name: string }[]): string {
  return JSON.stringify({ error: "Unknown service", availableServices: services.map((s) => s.name) });
}

async function resolveStaffId(businessId: string, staffName: string | undefined): Promise<{ staffId?: string; error?: string }> {
  if (!staffName) return {};
  const match = await prisma.staffMember.findFirst({
    where: { businessId, name: { equals: staffName, mode: "insensitive" } },
  });
  if (match) return { staffId: match.id };
  const all = await prisma.staffMember.findMany({ where: { businessId }, select: { name: true } });
  return { error: JSON.stringify({ error: "Unknown staff member", availableStaff: all.map((s) => s.name) }) };
}

async function runTool(
  businessId: string,
  customerPhone: string,
  name: string,
  input: Record<string, unknown>,
  lastOfferedSlots: { value?: AvailableSlot[] },
  lastPhotos: { value?: { url: string; caption?: string }[] }
): Promise<string> {
  if (name === "check_availability") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);
    const staffResolution = await resolveStaffId(businessId, input.staffName as string | undefined);
    if (staffResolution.error) return staffResolution.error;

    const slots = await findAvailableSlots(
      businessId,
      service.id,
      new Date(input.date as string),
      input.durationMin as number | undefined,
      staffResolution.staffId
    );
    lastOfferedSlots.value = slots.slice(0, 6);
    // Provide the correct Hebrew weekday so the model doesn't miscompute it.
    const heDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const { year, month, day } = parseDateString(input.date as string);
    const dow = dayOfWeekForDate(year, month, day);
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const tz = biz.timezone || "Asia/Jerusalem";
    // Slot startTime/endTime are UTC ISO strings — converting those to a local HH:MM display is
    // exactly the kind of timezone arithmetic the model tends to get wrong (e.g. inventing times
    // like "24:30"). Pre-compute the local time label here so the model only ever has to echo it.
    const slotsWithLocalTime = lastOfferedSlots.value.map((s) => ({
      ...s,
      localTime: new Date(s.startTime).toLocaleTimeString("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
    }));
    return JSON.stringify({
      date: input.date,
      dayOfWeek: `יום ${heDays[dow]}`,
      slots: slotsWithLocalTime,
      note: "השתמש אך ורק בערך localTime המצורף לכל slot כדי להציג את השעה ללקוח — אל תחשב או תמיר שעות בעצמך.",
    });
  }

  if (name === "book_appointment") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        timezone: true, name: true,
        depositEnabled: true, depositAmountIls: true, depositHoldMinutes: true,
        paymentProvider: true, paymentApiKey: true, paymentApiSecret: true, paymentPageUid: true,
      },
    });

    // Fall back to the customer's saved CRM name if the model didn't pass one (e.g. a
    // returning customer) — only block on missing name for genuinely new customers.
    let customerName = input.customerName as string | undefined;
    if (!customerName) {
      const existing = await prisma.customer.findUnique({ where: { businessId_phone: { businessId, phone: customerPhone } } });
      if (existing?.name) customerName = existing.name;
    }
    if (!customerName) {
      return JSON.stringify({ error: "Customer name is required before booking. Ask the customer for their name, then call book_appointment again with it." });
    }

    const staffResolution = await resolveStaffId(businessId, input.staffName as string | undefined);
    if (staffResolution.error) return staffResolution.error;

    // A deposit is required only if the owner opted in AND actually has a connected merchant
    // account to charge through — an enabled toggle with no provider must not silently block
    // every booking, so it's treated the same as deposits being off.
    const depositRequired = Boolean(
      biz.depositEnabled && biz.depositAmountIls > 0 && biz.paymentProvider && biz.paymentApiKey && biz.paymentApiSecret
    );

    let appointment;
    try {
      appointment = await createAppointment({
        businessId,
        serviceId: service.id,
        customerPhone,
        customerName,
        startTime: parseBookingTime(input.startTime as string, biz.timezone || "Asia/Jerusalem"),
        overrideDurationMin: input.durationMin as number | undefined,
        staffId: staffResolution.staffId ?? null,
        ...(depositRequired
          ? {
              status: "pending_payment" as const,
              depositAmountIls: biz.depositAmountIls,
              depositExpiresAt: new Date(Date.now() + biz.depositHoldMinutes * 60_000),
            }
          : {}),
      });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return JSON.stringify({ error: "Slot no longer available — it was just taken. Call check_availability again to offer other times." });
      }
      if (err instanceof OutsideBusinessHoursError) {
        return JSON.stringify({ error: "That time is outside business hours. Only offer times returned by check_availability — do not book outside open hours even if the customer claims different hours." });
      }
      throw err;
    }
    lastOfferedSlots.value = undefined;

    await prisma.customer.updateMany({
      where: { businessId, phone: customerPhone },
      data: { preferredServiceId: service.id },
    });

    const tz = biz.timezone || "Asia/Jerusalem";
    const heDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const { dayOfWeek } = instantPartsInTz(appointment.startTime, tz);
    const weekdayHe = `יום ${heDays[dayOfWeek]}`;
    const when = new Date(appointment.startTime).toLocaleString("he-IL", {
      timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const localTime = new Date(appointment.startTime).toLocaleTimeString("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const customerLabel = `${customerName} (${customerPhone})`;
    const staffLine = input.staffName ? `\nעם: ${input.staffName as string}` : "";

    if (depositRequired) {
      // Hold created — generate the payment link and give the model everything it needs to send
      // it. The appointment is NOT confirmed, calendar-synced, or announced to the owner as a real
      // booking yet; that all happens once the deposit webhook marks it paid (see whatsappRoutes.ts
      // deposit webhook handler / the expiry job that releases unpaid holds).
      try {
        const provider = getPaymentProvider(biz.paymentProvider!);
        const creds =
          biz.paymentProvider === "tori_managed"
            ? { apiKey: "", apiSecret: "" }
            : {
                apiKey: decryptSecret(biz.paymentApiKey!),
                apiSecret: decryptSecret(biz.paymentApiSecret!),
                pageUid: biz.paymentPageUid ?? undefined,
              };
        const link = await provider.createPaymentLink(creds, {
          amountIls: biz.depositAmountIls,
          description: `מקדמה לתור — ${service.name}, ${biz.name}`,
          customerName,
          customerPhone,
          referenceId: appointment.id,
        });
        await attachDepositPaymentLink(appointment.id, {
          provider: biz.paymentProvider!,
          paymentUrl: link.paymentUrl,
          providerRef: link.providerTransactionId,
        });
        return JSON.stringify({
          booked: false,
          depositRequired: true,
          depositAmountIls: biz.depositAmountIls,
          paymentUrl: link.paymentUrl,
          holdMinutes: biz.depositHoldMinutes,
          dayOfWeek: weekdayHe,
          localTime,
          staffName: input.staffName ?? undefined,
        });
      } catch (err) {
        // Payment link generation failed — release the hold immediately rather than leaving a
        // dead pending_payment row blocking the slot for depositHoldMinutes with no way to pay it.
        console.error("Deposit payment link creation failed:", err);
        captureError(err, { businessId, phase: "deposit_link" });
        await prisma.appointment.delete({ where: { id: appointment.id } }).catch(() => {});
        return JSON.stringify({ error: "Could not generate a payment link right now. Apologize to the customer and offer to try again in a moment, or suggest they call the business directly." });
      }
    }

    notifyOwner(businessId, `📅 הזמנה חדשה!\nלקוח: ${customerLabel}\nשירות: ${service.name}\nמועד: ${weekdayHe} ${when}${staffLine}`);

    syncAppointmentToCalendar(businessId, {
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      serviceName: service.name,
      customerName,
      customerPhone,
    })
      .then((eventId) => {
        if (eventId) return prisma.appointment.update({ where: { id: appointment.id }, data: { calendarEventId: eventId } });
      })
      .catch((err) => console.error("Calendar sync failed:", err));

    // Return the authoritative weekday + local time so the model's confirmation matches the real date.
    return JSON.stringify({
      booked: true,
      dayOfWeek: weekdayHe,
      localTime,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      staffName: input.staffName ?? undefined,
    });
  }

  if (name === "list_my_appointments") {
    const appointments = await prisma.appointment.findMany({
      where: { businessId, status: "confirmed", customer: { phone: customerPhone }, startTime: { gte: new Date() } },
      include: { service: true },
      orderBy: { startTime: "asc" },
    });
    return JSON.stringify({
      appointments: appointments.map((a) => ({ service: a.service.name, startTime: a.startTime })),
    });
  }

  if (name === "cancel_appointment") {
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const target = parseBookingTime(input.startTime as string, biz.timezone || "Asia/Jerusalem");
    const appointment = await prisma.appointment.findFirst({
      where: { businessId, status: "confirmed", customer: { phone: customerPhone }, startTime: target },
      include: { service: true },
    });
    if (!appointment) return JSON.stringify({ error: "No matching appointment found" });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "cancelled" } });
    if (appointment.calendarEventId) {
      deleteCalendarEvent(businessId, appointment.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
    }
    // Offer the freed slot to anyone waiting for this service.
    notifyWaitlist(businessId, appointment.serviceId, appointment.service.name, appointment.startTime).catch((err) =>
      console.error("[waitlist] Notification failed:", err)
    );
    return JSON.stringify({ cancelled: true });
  }

  if (name === "reschedule_appointment") {
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const tz = biz.timezone || "Asia/Jerusalem";
    const oldTarget = parseBookingTime(input.oldStartTime as string, tz);
    const existing = await prisma.appointment.findFirst({
      where: { businessId, status: "confirmed", customer: { phone: customerPhone }, startTime: oldTarget },
      include: { service: true, customer: true },
    });
    if (!existing) return JSON.stringify({ error: "No matching appointment found to reschedule" });

    const serviceName = (input.serviceName as string | undefined) ?? existing.service.name;
    const { service, services } = await findServiceByName(businessId, serviceName);
    if (!service) return unknownServiceError(services);

    // Carry over the original staff assignment unless the customer explicitly asked for someone
    // else — otherwise a reschedule would silently drop who they booked with.
    let staffId: string | null | undefined = existing.staffId;
    if (input.staffName) {
      const staffResolution = await resolveStaffId(businessId, input.staffName as string);
      if (staffResolution.error) return staffResolution.error;
      staffId = staffResolution.staffId ?? null;
    }

    // Cancel the old one first so its slot doesn't block the new booking, then book the new time.
    await prisma.appointment.update({ where: { id: existing.id }, data: { status: "cancelled" } });
    if (existing.calendarEventId) {
      deleteCalendarEvent(businessId, existing.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
    }
    try {
      const customerName = (input.customerName as string | undefined) ?? existing.customer.name ?? undefined;
      const appointment = await createAppointment({
        businessId,
        serviceId: service.id,
        customerPhone,
        customerName,
        startTime: parseBookingTime(input.newStartTime as string, tz),
        overrideDurationMin: input.durationMin as number | undefined,
        staffId,
      });
      lastOfferedSlots.value = undefined;

      // Same "sync then persist the event id" pattern as book_appointment — never blocks the
      // reply on the calendar call, and previously this branch didn't sync to calendar at all.
      syncAppointmentToCalendar(businessId, {
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        serviceName: service.name,
        customerName,
        customerPhone,
      })
        .then((eventId) => {
          if (eventId) return prisma.appointment.update({ where: { id: appointment.id }, data: { calendarEventId: eventId } });
        })
        .catch((err) => console.error("Calendar sync failed:", err));

      return JSON.stringify({ rescheduled: true, startTime: appointment.startTime, endTime: appointment.endTime });
    } catch (err) {
      // New slot was taken or invalid — restore the original so the customer isn't left with nothing.
      await prisma.appointment.update({ where: { id: existing.id }, data: { status: "confirmed" } });
      if (err instanceof SlotUnavailableError) {
        return JSON.stringify({ error: "New slot no longer available; original appointment kept. Offer other times." });
      }
      if (err instanceof OutsideBusinessHoursError) {
        return JSON.stringify({ error: "New time is outside business hours; original appointment kept. Offer times from check_availability only." });
      }
      throw err;
    }
  }

  if (name === "add_to_waitlist") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);

    const customer = await prisma.customer.upsert({
      where: { businessId_phone: { businessId, phone: customerPhone } },
      update: input.customerName ? { name: input.customerName as string } : {},
      create: { businessId, phone: customerPhone, name: input.customerName as string | undefined },
    });
    await prisma.waitlistEntry.create({ data: { businessId, customerId: customer.id, serviceId: service.id } });
    return JSON.stringify({ addedToWaitlist: true, service: service.name });
  }

  if (name === "request_booking_callback") {
    const label = (input.customerName as string | undefined) ?? customerPhone;
    const notified = await notifyOwner(
      businessId,
      `📞 בקשת הזמנה חדשה — יש לחזור ללקוח!\nלקוח: ${label}\nטלפון לחזרה: ${customerPhone}\nוואטסאפ: https://wa.me/${customerPhone.replace(/\D/g, "")}\nפרטים: ${input.details}`
    );
    if (!notified) {
      // Kept in English deliberately: this is a control-flow instruction the model reasons about
      // ("don't promise a callback"), not text meant to reach the customer verbatim — unlike
      // tellCustomer below, there's no live-translation step to worry about here.
      return JSON.stringify({
        notified: false,
        error:
          "No owner notification phone is configured, so the owner was NOT alerted. Do NOT promise the customer a callback. Apologize that booking isn't available right now and, if a contact/address is known, suggest they reach the business directly.",
      });
    }
    // Give the customer a direct wa.me line to the owner too, so they don't have to wait passively
    // for the callback — the inquiry vertical's whole model is "bot informs, humans close".
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { notificationPhone: true } });
    const ownerWaLink = biz?.notificationPhone ? `https://wa.me/${biz.notificationPhone.replace(/\D/g, "")}` : null;
    // tellCustomer is meant to reach the customer close to verbatim, so it's handed over already
    // in Hebrew (this business's default language) instead of English — asking the model to
    // compose or paraphrase a live translation on a short customer-facing sentence is exactly what
    // produced garbled Hebrew before ("בחצי דרך" out of "message them right away"). If the customer
    // is writing in English, the model still translates this cleanly on its own (Hebrew→English is
    // far more reliable for it than the reverse) per the "answer in the customer's language" rule
    // in the system prompt.
    return JSON.stringify({
      notified: true,
      ownerWhatsappLink: ownerWaLink,
      tellCustomer:
        "בעל העסק יחזור אליך בהקדם לאישור סופי." +
        (ownerWaLink ? ` אפשר גם לכתוב לו ישירות בוואטסאפ: ${ownerWaLink}` : ""),
    });
  }

  if (name === "send_photos") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);
    if (service.imageUrls.length === 0) {
      // Told plainly so the model apologizes instead of inventing a link or claiming it sent something.
      return JSON.stringify({
        sent: false,
        error: `No photos are configured for "${service.name}". Tell the customer there are no photos available for it and offer to describe it instead. Do NOT invent or paste any image link.`,
      });
    }
    // The images themselves are sent by the webhook layer after the text reply — the model only
    // needs to know they're on the way so it can write a one-line lead-in.
    lastPhotos.value = service.imageUrls.map((url, i) => ({
      // WhatsApp fetches these from its own servers, so a URL pointing at the wrong host is a
      // silent delivery failure rather than a visible error.
      url: toPublicUploadUrl(url),
      caption: i === 0 ? service.name : undefined,
    }));
    return JSON.stringify({
      sent: true,
      count: service.imageUrls.length,
      tellCustomer: "התמונות נשלחות עכשיו — כתוב משפט קצר שמלווה אותן, בלי לצרף קישורים.",
    });
  }

  if (name === "request_human_followup") {
    const label = (input.customerName as string | undefined) ?? customerPhone;
    const notified = await notifyOwner(businessId, `🙋 לקוח ${label} ביקש המשך טיפול אנושי:\n${input.reason}`);
    if (!notified) {
      const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { address: true, name: true } });
      return JSON.stringify({
        notified: false,
        error: "No owner notification phone is configured for this business, so no one was actually alerted. Do NOT tell the customer someone will call them. Instead apologize that live handoff isn't set up yet, and if an address/contact is known suggest they reach the salon directly.",
        businessName: biz?.name,
      });
    }
    return JSON.stringify({ notified: true, tellCustomer: "העברתי את זה לבעל העסק — הוא יחזור אליך בהקדם." });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

// Anthropic's own status is retried once on transient failures — a customer waiting mid-chat
// benefits far more from one quick retry than from an instant "the bot is down" reply.
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 529]);
const RETRY_DELAY_MS = 700;

/** Logs the real token usage the provider reported for this call — never estimated. Failure to
 * log must never take down a live bot reply, so it's swallowed after being reported to error
 * monitoring. Kept as "claude usage" bucket (kind:"claude" in usageLedger) regardless of which
 * provider actually ran — it's the app's one LLM-cost bucket, not an Anthropic-specific label;
 * see usageLedger.ts's per-model pricing table, which already covers every provider's models. */
async function recordUsage(
  businessId: string,
  customerPhone: string,
  providerKey: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number }
) {
  try {
    await logClaudeUsage({ businessId, customerPhone, provider: providerKey, model, ...usage });
  } catch (err) {
    console.error("[bot] Failed to record AI usage:", err);
    captureError(err, { businessId, customerPhone, model, phase: "usage logging" });
  }
}

/**
 * Rewrites Markdown emphasis into WhatsApp's own markup before a reply goes out.
 *
 * WhatsApp bolds with a single asterisk (*bold*), not Markdown's double — so `**text**` reaches
 * the customer with literal asterisks around it. The system prompt says this, but models emit
 * Markdown out of habit often enough that a prompt rule alone isn't a guarantee, and this is
 * customer-visible on every price list. Deterministic post-processing is, so it belongs here
 * rather than relying on instruction-following.
 */
export function toWhatsAppFormatting(text: string): string {
  return (
    text
      // **bold** / __bold__ -> *bold*. Non-greedy, no newlines inside, so it can't swallow the
      // gap between two separately-bolded items on different lines.
      .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
      .replace(/__([^_\n]+)__/g, "*$1*")
      // Markdown headings have no WhatsApp equivalent — bold the line instead of leaving "## ".
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
  );
}

/** Calendar day in the business's timezone, as YYYY-MM-DD. */
function dayIsoInTz(date: Date, timezone: string | null): string {
  const p = zonedDateParts(date, timezone || "Asia/Jerusalem");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Marks history turns that were written on an earlier day with the date they were written.
 *
 * The system prompt states today's date, but a WhatsApp thread is never reset — a customer who
 * wrote "אפשר מחר ב-5?" last Tuesday leaves that sentence in the history forever, and the model
 * reads it as a message from today. That produces bookings on the wrong date and answers that
 * contradict the calendar. Stamping only the stale turns keeps today's turns untouched, so the
 * common case (a conversation inside one day) is byte-identical to before and stays cacheable.
 */
function stampIfStale(turn: Turn, timezone: string | null): string {
  if (!turn.at) return turn.content;
  const turnDay = dayIsoInTz(turn.at, timezone);
  if (turnDay === dayIsoInTz(new Date(), timezone)) return turn.content;
  return `[נכתב ב-${turnDay}] ${turn.content}`;
}

const AI_UNAVAILABLE_HE = "מצטער, הבוט אינו זמין כרגע. נסה שוב בעוד כמה דקות, או צור קשר ישיר עם העסק.";

export async function handleIncomingMessage(businessId: string, customerPhone: string, messageText: string): Promise<BotResult> {
  const system = await buildSystemPrompt(businessId, customerPhone);
  const history = await getHistory(businessId, customerPhone);

  // "inquiry" businesses (e.g. B&B) have no live booking engine — the bot answers info and hands
  // booking intent to the owner, so it gets a reduced tool set with no slot/booking tools.
  const biz = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { bookingModel: true, aiProvider: true, aiModel: true, timezone: true, aiTemperature: true },
  });
  const activeTools = biz.bookingModel === "inquiry" ? inquiryTools : tools;
  const provider = getAiProvider(biz.aiProvider);

  const turns: GenericTurn[] = [
    ...history.map((t: Turn) => ({ role: t.role, text: stampIfStale(t, biz.timezone) }) as GenericTurn),
    { role: "user", text: messageText },
  ];

  const lastOfferedSlots: { value?: AvailableSlot[] } = {};
  const lastPhotos: { value?: { url: string; caption?: string }[] } = {};
  let hadToolError = false;
  // Tracks whether the most recent book/reschedule attempt actually failed and hasn't since
  // been followed by a success — guards against the model claiming "booked!" in its final
  // reply when the underlying tool call actually errored out (e.g. slot taken in the meantime).
  let unconfirmedBookingFailure: string | null = null;
  let tier = chooseTier(messageText, false);
  let model = provider.resolveModel(tier, biz.aiModel);

  console.log(`[bot] provider=${provider.key} model=${model} business=${businessId} phone=${customerPhone} msg="${messageText.slice(0, 80)}"`);

  async function call(currentModel: string) {
    const res = await provider.send({
      model: currentModel,
      system,
      tools: activeTools,
      turns,
      // null (the default) means "use the app default" — see DEFAULT_TEMPERATURE.
      temperature: biz.aiTemperature ?? undefined,
    });
    await recordUsage(businessId, customerPhone, provider.key, currentModel, res.usage);
    return res;
  }

  let response;
  try {
    response = await call(model);
  } catch (err) {
    // Fall back to the cheap tier before giving up. The smart tier used to be unreachable (the old
    // chooseTier returned "cheap" on every path), so making it the default put every reply behind a
    // model that had never actually served production traffic — and anything account-level, like the
    // model not being enabled on this API key, then took the bot down completely rather than
    // degrading it. A worse reply beats no reply.
    const fallbackModel = provider.resolveModel("cheap", biz.aiModel);
    const canFallBack = fallbackModel !== model;
    console.error(
      `[bot] ${provider.key} call failed on ${model}${canFallBack ? ` — falling back to ${fallbackModel}` : ""}:`,
      err instanceof ProviderCallError ? err.message : err
    );
    captureError(err, { businessId, customerPhone, model, provider: provider.key });

    if (!canFallBack) return { text: AI_UNAVAILABLE_HE };
    try {
      model = fallbackModel;
      tier = "cheap";
      response = await call(model);
    } catch (fallbackErr) {
      console.error(`[bot] fallback to ${model} also failed:`, fallbackErr instanceof ProviderCallError ? fallbackErr.message : fallbackErr);
      captureError(fallbackErr, { businessId, customerPhone, model, provider: provider.key, phase: "cheap fallback" });
      return { text: AI_UNAVAILABLE_HE };
    }
  }

  let toolLoopCount = 0;
  while (response.stopReason === "tool_use") {
    if (++toolLoopCount > 8) break; // safety guard — raised slightly since open-ended availability requests now scan multiple days

    const toolResults: { toolCallId: string; content: string }[] = [];
    for (const tc of response.toolCalls) {
      console.log(`[bot] tool=${tc.name} input=${JSON.stringify(tc.input)}`);
      let result: string;
      try {
        result = await runTool(businessId, customerPhone, tc.name, tc.input, lastOfferedSlots, lastPhotos);
      } catch (toolErr) {
        console.error(`[bot] tool ${tc.name} threw:`, toolErr);
        result = JSON.stringify({ error: String(toolErr) });
      }
      console.log(`[bot] tool=${tc.name} result=${result.slice(0, 200)}`);

      // If a tool returned an error and we're still on the cheap tier, escalate for the retry —
      // but only if the business hasn't pinned a specific model override, in which case there's
      // no cheap/smart pair to escalate between. Currently inert: chooseTier always returns
      // "smart" (see its comment), so there's nothing to escalate from. Kept because it's the
      // correct behavior the moment any cheap tier is reintroduced.
      if (result.includes('"error"') && tier === "cheap" && !biz.aiModel) {
        hadToolError = true;
        tier = "smart";
        model = provider.resolveModel(tier, biz.aiModel);
        console.log(`[bot] tool error detected — escalating to ${model}`);
      }

      if (tc.name === "book_appointment" || tc.name === "reschedule_appointment") {
        unconfirmedBookingFailure = result.includes('"error"') ? result : null;
      }

      toolResults.push({ toolCallId: tc.id, content: result });
    }

    turns.push({ role: "assistant", text: response.text || undefined, toolCalls: response.toolCalls });
    turns.push({ role: "user", toolResults });

    try {
      response = await call(model);
    } catch (err) {
      console.error(`[bot] ${provider.key} call failed (tool loop):`, err instanceof ProviderCallError ? err.message : err);
      captureError(err, { businessId, customerPhone, model, provider: provider.key, phase: "tool loop" });
      return { text: AI_UNAVAILABLE_HE };
    }
  }

  let replyText = response.text;

  // The model can (rarely) generate a confident "booked!" reply even though the last
  // book/reschedule tool call actually returned an error — e.g. the slot was taken in the
  // instant between offering it and confirming. Force one corrective round so the customer is
  // never told a booking succeeded when nothing was actually saved.
  if (unconfirmedBookingFailure) {
    console.warn("[bot] Booking attempt failed but wasn't retried — forcing an honest reply");
    turns.push({ role: "assistant", text: response.text || undefined, toolCalls: response.toolCalls });
    turns.push({
      role: "user",
      text: `(מערכתי: ניסיון הקביעה/שינוי האחרון נכשל בפועל (${unconfirmedBookingFailure}) — שום תור לא נשמר. אל תגיד ללקוח שהתור נקבע. הסבר לו בקצרה שהמועד לא זמין/קרתה תקלה, והצע לבדוק זמינות אחרת או לנסות שוב.)`,
    });
    try {
      const corrected = await call(model);
      if (corrected.text) replyText = corrected.text;
    } catch (err) {
      console.error("Corrective booking-failure call failed:", err);
    }
  }

  // The model sometimes ends a tool-use turn with no accompanying text (e.g. right after a
  // successful booking). An empty reply here is doubly bad: the customer sees nothing, AND
  // storing an empty assistant turn in history would break the *next* API call (some providers
  // reject empty text content), which is what caused "have to ask twice" — the following message
  // would silently fail and fall back to the generic error text. Nudge the model once for an
  // actual reply instead of ever sending/storing blank content.
  if (!replyText) {
    console.warn("[bot] Model returned empty text after tool use — requesting a follow-up summary");
    turns.push({ role: "assistant", text: response.text || undefined, toolCalls: response.toolCalls });
    turns.push({ role: "user", text: "(תן ללקוח סיכום קצר של מה שקרה כרגע, במשפט אחד.)" });
    try {
      const followUp = await call(model);
      replyText = followUp.text;
    } catch (err) {
      console.error("Follow-up summary call failed:", err);
    }
  }
  if (!replyText) replyText = "בוצע! ✅"; // last-resort guarantee — never send/store an empty message
  replyText = toWhatsAppFormatting(replyText);

  await appendTurn(businessId, customerPhone, { role: "user", content: messageText });
  await appendTurn(businessId, customerPhone, { role: "assistant", content: replyText });

  if (hadToolError) {
    console.log(`[bot] escalated to ${model} for this turn (tool error recovery)`);
  }

  return {
    text: replyText,
    offeredSlots: lastOfferedSlots.value,
    photos: lastPhotos.value,
    isFirstReply: history.length === 0,
  };
}
