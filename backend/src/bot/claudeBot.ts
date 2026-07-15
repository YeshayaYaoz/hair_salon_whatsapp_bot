import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTurn, getHistory, type Turn } from "./conversationStore.js";
import { findAvailableSlots, createAppointment, attachDepositPaymentLink, SlotUnavailableError, OutsideBusinessHoursError, type AvailableSlot } from "../booking/availability.js";
import { getPaymentProvider } from "../lib/payments/index.js";
import { parseBookingTime, parseDateString, dayOfWeekForDate, instantPartsInTz } from "../lib/timezone.js";
import { notifyWaitlist } from "../lib/waitlist.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "../lib/crypto.js";
import { syncAppointmentToCalendar, deleteCalendarEvent } from "../lib/googleCalendar.js";
import { captureError } from "../lib/errorMonitoring.js";

// maxRetries: 0 here because we do our own retry in makeApiCall below — that lets us log each
// attempt and control the backoff explicitly, rather than relying on the SDK's opaque internal
// retry (which also doesn't cover Anthropic's own "overloaded" (529) status).
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });

const MODEL_CHEAP = "claude-haiku-4-5-20251001";
const MODEL_SMART = "claude-sonnet-5";

// Short messages with common simple patterns are handled by Haiku.
// Anything ambiguous, containing tool errors, or long enough to need reasoning goes to Sonnet.
function chooseModel(messageText: string, hadToolError: boolean): string {
  if (hadToolError) return MODEL_SMART;
  const simple = /^(היי|שלום|הי|hello|hi|בוקר טוב|ערב טוב|תודה|ok|כן|לא|מה השעות|מה הכתובת|כמה עולה|מחיר|bye|להתראות)/i;
  if (simple.test(messageText.trim()) && messageText.length < 60) return MODEL_CHEAP;
  return MODEL_CHEAP; // default to cheap; escalate only on retry
}

const tools: Anthropic.Tool[] = [
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

export interface BotResult {
  text: string;
  offeredSlots?: AvailableSlot[];
}

/** Returns true only if the owner was actually reachable and the WhatsApp send succeeded. */
async function notifyOwner(businessId: string, message: string): Promise<boolean> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
    });
    if (!business?.notificationPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
      console.warn(`[notifyOwner] business ${businessId} has no notificationPhone configured — skipping`);
      return false;
    }
    const accessToken = decryptSecret(business.whatsappAccessToken);
    await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: business.notificationPhone, text: message });
    return true;
  } catch (err) {
    console.error("Owner notification failed (non-fatal):", err);
    return false;
  }
}

/**
 * Resolves a customer-provided staff name to a StaffMember id. Returns:
 * - { staffId: undefined } if no name was given (no preference — any staff member is fine)
 * - { staffId } if resolved
 * - { error } if the name doesn't match anyone, listing real staff names so the model can retry
 */
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
  lastOfferedSlots: { value?: AvailableSlot[] }
): Promise<string> {
  if (name === "check_availability") {
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: input.serviceName as string, mode: "insensitive" } },
    });
    if (!service) {
      const all = await prisma.service.findMany({ where: { businessId }, select: { name: true } });
      return JSON.stringify({ error: "Unknown service", availableServices: all.map((s) => s.name) });
    }
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
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: input.serviceName as string, mode: "insensitive" } },
    });
    if (!service) {
      const all = await prisma.service.findMany({ where: { businessId }, select: { name: true } });
      return JSON.stringify({ error: "Unknown service", availableServices: all.map((s) => s.name) });
    }
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        timezone: true, name: true,
        depositEnabled: true, depositAmountIls: true, depositHoldMinutes: true,
        paymentProvider: true, paymentApiKey: true, paymentApiSecret: true,
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
            : { apiKey: decryptSecret(biz.paymentApiKey!), apiSecret: decryptSecret(biz.paymentApiSecret!) };
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
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: serviceName, mode: "insensitive" } },
    });
    if (!service) return JSON.stringify({ error: "Unknown service" });

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
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: input.serviceName as string, mode: "insensitive" } },
    });
    if (!service) return JSON.stringify({ error: "Unknown service" });

    const customer = await prisma.customer.upsert({
      where: { businessId_phone: { businessId, phone: customerPhone } },
      update: input.customerName ? { name: input.customerName as string } : {},
      create: { businessId, phone: customerPhone, name: input.customerName as string | undefined },
    });
    await prisma.waitlistEntry.create({ data: { businessId, customerId: customer.id, serviceId: service.id } });
    return JSON.stringify({ addedToWaitlist: true, service: service.name });
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
    return JSON.stringify({ notified: true });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

// Anthropic's own status is retried once on transient failures — a customer waiting mid-chat
// benefits far more from one quick retry than from an instant "the bot is down" reply.
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 529]);
const RETRY_DELAY_MS = 700;

async function makeApiCall(model: string, system: string, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
  try {
    return (await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools,
      messages,
    })) as Anthropic.Message;
  } catch (err) {
    const retryable = err instanceof APIError ? RETRYABLE_STATUSES.has(err.status ?? 0) : true; // network errors: also retry once
    if (!retryable) throw err;

    console.warn(`[bot] Anthropic call failed (${err instanceof APIError ? err.status : "network"}), retrying once...`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));

    return (await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools,
      messages,
    })) as Anthropic.Message;
  }
}

const AI_UNAVAILABLE_HE = "מצטערים, הבוט אינו זמין כרגע. אנא נסו שוב בעוד כמה דקות, או צרו קשר ישיר עם העסק.";

export async function handleIncomingMessage(businessId: string, customerPhone: string, messageText: string): Promise<BotResult> {
  const systemText = await buildSystemPrompt(businessId, customerPhone);
  const system = systemText;
  const history = await getHistory(businessId, customerPhone);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t: Turn) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: messageText },
  ];

  const lastOfferedSlots: { value?: AvailableSlot[] } = {};
  let hadToolError = false;
  // Tracks whether the most recent book/reschedule attempt actually failed and hasn't since
  // been followed by a success — guards against the model claiming "booked!" in its final
  // reply when the underlying tool call actually errored out (e.g. slot taken in the meantime).
  let unconfirmedBookingFailure: string | null = null;
  let model = chooseModel(messageText, false);

  console.log(`[bot] model=${model} business=${businessId} phone=${customerPhone} msg="${messageText.slice(0, 80)}"`);

  let response: Anthropic.Message;
  try {
    response = await makeApiCall(model, system, messages);
  } catch (err) {
    if (err instanceof APIError) console.error(`Anthropic API error ${err.status}:`, err.message);
    else console.error("Unexpected Anthropic error:", err);
    captureError(err, { businessId, customerPhone, model });
    return { text: AI_UNAVAILABLE_HE };
  }

  let toolLoopCount = 0;
  while (response.stop_reason === "tool_use") {
    if (++toolLoopCount > 8) break; // safety guard — raised slightly since open-ended availability requests now scan multiple days

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      console.log(`[bot] tool=${block.name} input=${JSON.stringify(block.input)}`);
      let result: string;
      try {
        result = await runTool(businessId, customerPhone, block.name, block.input as Record<string, unknown>, lastOfferedSlots);
      } catch (toolErr) {
        console.error(`[bot] tool ${block.name} threw:`, toolErr);
        result = JSON.stringify({ error: String(toolErr) });
      }
      console.log(`[bot] tool=${block.name} result=${result.slice(0, 200)}`);

      // If a tool returned an error and we're still on Haiku, escalate to Sonnet for the retry
      if (result.includes('"error"') && model === MODEL_CHEAP) {
        hadToolError = true;
        model = MODEL_SMART;
        console.log(`[bot] tool error detected — escalating to ${MODEL_SMART}`);
      }

      if (block.name === "book_appointment" || block.name === "reschedule_appointment") {
        unconfirmedBookingFailure = result.includes('"error"') ? result : null;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    try {
      response = await makeApiCall(model, system, messages);
    } catch (err) {
      if (err instanceof APIError) console.error(`Anthropic API error ${err.status} (tool loop):`, err.message);
      else console.error("Unexpected Anthropic error (tool loop):", err);
      captureError(err, { businessId, customerPhone, model, phase: "tool loop" });
      return { text: AI_UNAVAILABLE_HE };
    }
  }

  let replyText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // The model can (rarely) generate a confident "booked!" reply even though the last
  // book/reschedule tool call actually returned an error — e.g. the slot was taken in the
  // instant between offering it and confirming. Force one corrective round so the customer is
  // never told a booking succeeded when nothing was actually saved.
  if (unconfirmedBookingFailure) {
    console.warn("[bot] Booking attempt failed but wasn't retried — forcing an honest reply");
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `(מערכתי: ניסיון הקביעה/שינוי האחרון נכשל בפועל (${unconfirmedBookingFailure}) — שום תור לא נשמר. אל תגיד ללקוח שהתור נקבע. הסבר לו בקצרה שהמועד לא זמין/קרתה תקלה, והצע לבדוק זמינות אחרת או לנסות שוב.)`,
    });
    try {
      const corrected = await makeApiCall(model, system, messages);
      const correctedText = corrected.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (correctedText) replyText = correctedText;
    } catch (err) {
      console.error("Corrective booking-failure call failed:", err);
    }
  }

  // Claude sometimes ends a tool-use turn with no accompanying text (e.g. right after a
  // successful booking). An empty reply here is doubly bad: the customer sees nothing, AND
  // storing an empty assistant turn in history would break the *next* API call (Anthropic
  // rejects empty text content blocks), which is what caused "have to ask twice" — the
  // following message would silently fail and fall back to the generic error text. Nudge the
  // model once for an actual reply instead of ever sending/storing blank content.
  if (!replyText) {
    console.warn("[bot] Model returned empty text after tool use — requesting a follow-up summary");
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: "(תן ללקוח סיכום קצר של מה שקרה כרגע, במשפט אחד.)" });
    try {
      const followUp = await makeApiCall(model, system, messages);
      replyText = followUp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    } catch (err) {
      console.error("Follow-up summary call failed:", err);
    }
  }
  if (!replyText) replyText = "בוצע! ✅"; // last-resort guarantee — never send/store an empty message

  await appendTurn(businessId, customerPhone, { role: "user", content: messageText });
  await appendTurn(businessId, customerPhone, { role: "assistant", content: replyText });

  if (hadToolError) {
    console.log(`[bot] escalated to Sonnet for this turn (tool error recovery)`);
  }

  return { text: replyText, offeredSlots: lastOfferedSlots.value };
}
