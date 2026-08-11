import { asyncRouter } from "../lib/asyncRouter.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { findAvailableSlots, SlotUnavailableError, OutsideBusinessHoursError } from "../booking/availability.js";
import { bookAppointmentWithSideEffects, cancelAppointmentById, rescheduleAppointmentById, AppointmentNotFoundError } from "../booking/actions.js";
import { parseBookingTime, instantPartsInTz } from "../lib/timezone.js";
import { TEMPLATES, isBusinessType } from "../lib/businessTemplates.js";
// Shared with the owner-notification phone: the same "typed by a human vs formatted by a
// machine" mismatch this was written for applies wherever those two meet. See lib/phone.ts.
import { normalizePhone } from "../lib/phone.js";
import { listHebrewVoices } from "../lib/cartesiaAdmin.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { logClaudeUsage } from "../lib/usageLedger.js";

export const voiceRouter = asyncRouter();

// Cartesia's agent hits these as custom tools during a live call, so it's a single shared secret
// configured once in the Cartesia agent's tool auth header — not a per-business webhook secret like
// the payment webhooks, since Cartesia isn't relaying anything a customer could see or forge a
// request from.
function requireCartesiaAuth(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const secret = process.env.CARTESIA_TOOL_SECRET;
  const header = req.headers.authorization;
  if (!secret || header !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

type ResolvedVoiceBusiness = {
  id: string;
  timezone: string;
  bookingModel: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  blockedAt: Date | null;
};

/** Resolves which salon a call belongs to from the dialed number — every voice tool needs this first. */
async function resolveBusinessByCalledNumber(calledNumber: string): Promise<ResolvedVoiceBusiness | null> {
  const calledDigits = normalizePhone(calledNumber);
  // Prisma can't filter on a normalized expression without raw SQL, and voicePhoneNumber may be
  // stored with or without a leading "+" depending on how it was entered — fetch the (expected to
  // stay small) set of voice-enabled businesses and match on digits in memory instead.
  const candidates = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: {
      id: true, voicePhoneNumber: true, timezone: true, bookingModel: true,
      subscriptionStatus: true, subscriptionPlan: true, blockedAt: true,
    },
  });
  const matched = candidates.find((b) => normalizePhone(b.voicePhoneNumber!) === calledDigits);
  if (!matched) return null;
  const { voicePhoneNumber: _ignored, ...business } = matched;
  return business;
}

/**
 * Voice is a Premium feature and was being given away.
 *
 * Every other tenant surface goes through requireActiveSubscription (see businessRoutes.ts), but
 * this router only ever checked the shared Cartesia secret — which authenticates *Cartesia*, not
 * the salon. So a business on Standard (₪149 against Premium's ₪299, which is sold on exactly this)
 * got the full voice agent by putting a number in a text box, and a cancelled account kept it
 * indefinitely, while its WhatsApp bot had already stopped answering.
 *
 * Returns true when the call has been refused, matching rejectIfInquiry below. The message is
 * written to be spoken aloud, because that is what Cartesia will do with it.
 */
const VOICE_ACTIVE_STATUSES = new Set(["trial", "active"]);

function rejectIfNotEntitled(business: ResolvedVoiceBusiness, res: import("express").Response): boolean {
  if (business.blockedAt || !VOICE_ACTIVE_STATUSES.has(business.subscriptionStatus)) {
    res.status(402).json({
      error: "This business's subscription is not active. Apologize, say you can't take the booking right now, and ask the caller to contact the business directly.",
    });
    return true;
  }
  // Trials get voice so it can actually be evaluated before the plan is chosen; a paid account has
  // to be on the plan that includes it.
  if (business.subscriptionStatus === "active" && business.subscriptionPlan !== "premium") {
    res.status(402).json({
      error: "Voice calling is not included in this business's plan. Apologize, say you can't take the booking by phone, and ask the caller to message the business on WhatsApp instead.",
    });
    return true;
  }
  return false;
}

// Inquiry-mode businesses (B&B etc.) close bookings only human-to-human — the voice agent briefs
// the caller and transfers to the owner. Guard server-side too, so a misfiring agent can never
// write a booking for them.
function rejectIfInquiry(business: { bookingModel: string }, res: import("express").Response): boolean {
  if (business.bookingModel !== "inquiry") return false;
  res.status(409).json({
    error: "This business does not take automated bookings. Brief the caller on prices and options, then transfer the call to the owner (ownerTransferNumber from /context).",
  });
  return true;
}

voiceRouter.use(requireCartesiaAuth);

// Called once per incoming call, before the agent speaks — resolves which salon the dialed number
// belongs to, and whether the caller is an existing customer with an upcoming appointment, so the
// agent can open with something like "Hi Dana, calling about your appointment tomorrow?" instead of
// a blind generic greeting.
/**
 * The first thing a caller hears — built here rather than taken from `botGreeting`.
 *
 * `botGreeting` is written for WhatsApp: several lines, emoji, a menu of options, and sometimes
 * bracket placeholders like "[פירוט של כל הצימרים]" that the WhatsApp bot itself refuses to send
 * raw (`claudeBot.ts`). Spoken down a phone line it is far too long to open a call with, and a
 * placeholder gets read out literally.
 *
 * A phone greeting has one job: say who answered, and invite the caller to talk. "כאן X" is how
 * Israeli businesses actually answer, and it sidesteps the ל+ה contraction that "הגעתם ל…" would
 * hit on any name starting with ה — "להרמוניה" is right, "למספרה" is right, and no rule tells the
 * two apart from the name alone.
 */
function spokenGreeting(name: string): string {
  return `שלום, כאן ${name.trim()}. איך אפשר לעזור?`;
}

/**
 * The gender of the voice this business chose, or null if it cannot be determined.
 *
 * listHebrewVoices caches for an hour and returns [] when the catalogue is unreachable, so this
 * costs nothing per call and degrades to "unknown" rather than failing the call — a voice agent
 * that cannot answer the phone is far worse than one using the wrong verb form.
 */
async function voiceGenderFor(voiceId: string | null): Promise<"masculine" | "feminine" | null> {
  if (!voiceId) return null;
  const voice = (await listHebrewVoices()).find((v) => v.id === voiceId);
  // gender_neutral gives us nothing to inflect with, so it is treated the same as unknown.
  return voice?.gender === "masculine" || voice?.gender === "feminine" ? voice.gender : null;
}

voiceRouter.post("/context", async (req, res) => {
  const parsed = z.object({ calledNumber: z.string().min(1), callerNumber: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber and callerNumber are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;

  const callerDigits = normalizePhone(parsed.data.callerNumber);
  // Midnight UTC today: SpecialPeriod.startDate/endDate are DATE columns, so comparing against a
  // timestamp with a time component would drop a period on the day it ends.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [full, hours, customers, services, faqEntries, specialPeriods] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: {
        name: true, timezone: true, address: true, botGreeting: true, botPersonality: true,
        cancellationPolicy: true, businessType: true, bookingModel: true, availabilityInfo: true, notificationPhone: true,
        voiceId: true,
        // Same three the WhatsApp prompt already has. Without them the agent is asked questions it
        // structurally cannot answer — "how many people fit", "how do I get there", "what about a
        // 3-night stay" — and an agent with no data and a caller waiting tends to invent one.
        pricingNotes: true, googleMapsUrl: true,
      },
    }),
    prisma.businessHours.findMany({ where: { businessId: business.id }, orderBy: { dayOfWeek: "asc" } }),
    prisma.customer.findMany({ where: { businessId: business.id }, select: { id: true, phone: true, name: true } }),
    prisma.service.findMany({ where: { businessId: business.id }, select: { name: true, description: true, priceCents: true, durationMin: true, capacity: true } }),
    prisma.faqEntry.findMany({ where: { businessId: business.id }, select: { question: true, answer: true } }),
    // Dates on which the terms differ (holiday pricing, minimum stays). Without these the voice
    // agent quotes the ordinary rate on erev Pesach while the WhatsApp bot says it's different —
    // the two channels answer the same caller, so they must not disagree. Only periods that
    // haven't ended yet; past ones are noise that accumulates year over year.
    prisma.specialPeriod.findMany({
      where: { businessId: business.id, endDate: { gte: todayUtc } },
      orderBy: { startDate: "asc" },
      take: 40,
      select: { label: true, description: true, startDate: true, endDate: true },
    }),
  ]);
  const caller = customers.find((c) => normalizePhone(c.phone) === callerDigits);

  let upcomingAppointment: { id: string; serviceName: string; startTime: Date; staffName: string | null } | null = null;
  if (caller) {
    const appt = await prisma.appointment.findFirst({
      where: { businessId: business.id, customerId: caller.id, status: "confirmed", startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      include: { service: { select: { name: true } }, staff: { select: { name: true } } },
    });
    if (appt) upcomingAppointment = { id: appt.id, serviceName: appt.service.name, startTime: appt.startTime, staffName: appt.staff?.name ?? null };
  }

  // businessType drives the vocabulary the agent should speak in (e.g. call the customer "מטופל"
  // at a clinic vs "לקוח" at a salon) — same TEMPLATES source of truth the WhatsApp bot's prompt
  // reads from, so the two channels never disagree on what kind of business this is.
  const template = isBusinessType(full.businessType) ? TEMPLATES[full.businessType] : null;

  res.json({
    businessName: full.name,
    businessType: template ? { key: template.type, labelHe: template.labelHe, labelEn: template.labelEn } : null,
    vocabulary: template?.vocabulary ?? null,
    // "slot" = the agent may book live via check-availability/book. "inquiry" (B&B etc.) = the
    // agent must NOT book: it briefs the caller on prices/options/availabilityInfo and then
    // transfers the call to ownerTransferNumber — bookings close only human-to-human.
    bookingModel: full.bookingModel,
    availabilityInfo: full.availabilityInfo,
    /** Where "אפשר לדבר עם מישהו?" goes. Sent for every business, not just inquiry ones: a caller
     * asking for a person is the most ordinary request there is, and a salon whose agent could not
     * honour it simply talked past them. Inquiry businesses additionally *depend* on it, since
     * that is the only way they close a booking at all. */
    ownerTransferNumber: full.notificationPhone,
    timezone: full.timezone,
    address: full.address,
    googleMapsUrl: full.googleMapsUrl,
    /** Free-text pricing rules the owner wrote (non-linear packages, surcharges, exclusions). The
     * agent states these as written and still never computes a total from them. */
    pricingNotes: full.pricingNotes,
    greeting: spokenGreeting(full.name),
    personality: full.botPersonality,
    // The voice this salon chose. One shared agent answers for every business, so without this each
    // one sounds identical; the agent applies it per call (AgentUpdateCall) after reading this
    // response. Null means the agent keeps its own default, which is what every salon had before
    // the setting existed.
    voiceId: full.voiceId,
    /** Which gender the agent should speak about *itself* in. A feminine voice saying "אני מעביר"
     * is jarring in a way an English agent never is, because Hebrew marks gender on every verb.
     * Derived from the Cartesia catalogue rather than stored, so it always matches the voice
     * actually playing; null (no key, unknown voice, gender_neutral) leaves the agent's default. */
    voiceGender: await voiceGenderFor(full.voiceId),
    cancellationPolicy: full.cancellationPolicy,
    // Date-only strings: the agent reads these out loud and compares them to what the caller asks
    // for, so a timezone-bearing timestamp would be both wrong to speak and easy to misread.
    specialPeriods: specialPeriods.map((p) => ({
      label: p.label,
      description: p.description,
      startDate: p.startDate.toISOString().slice(0, 10),
      endDate: p.endDate.toISOString().slice(0, 10),
    })),
    hours: hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: h.openMin, closeMin: h.closeMin })),
    services: services.map((s) => ({
      name: s.name,
      description: s.description,
      priceIls: s.priceCents / 100,
      durationMin: s.durationMin,
      // For an overnight rental this is how many guests the unit sleeps — the single most common
      // question on a booking call.
      capacity: s.capacity,
    })),
    faq: faqEntries,
    caller: caller
      ? { isKnownCustomer: true, name: caller.name, upcomingAppointment }
      : { isKnownCustomer: false, name: null, upcomingAppointment: null },
  });
});

function formatLocalTime(date: Date, timezone: string): string {
  const { minutes } = instantPartsInTz(date, timezone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Finds open slots for a service on a given day — same underlying logic as the WhatsApp bot's
// check_availability tool (booking/availability.ts), so results never diverge between channels.
voiceRouter.post("/check-availability", async (req, res) => {
  const parsed = z
    .object({ calledNumber: z.string().min(1), serviceName: z.string().min(1), date: z.string().min(1), staffName: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber, serviceName, and date (YYYY-MM-DD) are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;
  if (rejectIfInquiry(business, res)) return;

  const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.serviceName, mode: "insensitive" } } });
  if (!service) {
    const all = await prisma.service.findMany({ where: { businessId: business.id }, select: { name: true } });
    return res.status(404).json({ error: "Unknown service", availableServices: all.map((s) => s.name) });
  }

  let staffId: string | undefined;
  if (parsed.data.staffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.staffName, mode: "insensitive" } } });
    if (!staff) {
      const all = await prisma.staffMember.findMany({ where: { businessId: business.id }, select: { name: true } });
      return res.status(404).json({ error: "Unknown staff member", availableStaff: all.map((s) => s.name) });
    }
    staffId = staff.id;
  }

  const slots = await findAvailableSlots(business.id, service.id, parsed.data.date, undefined, staffId);
  res.json({
    slots: slots.map((s) => ({ startTime: s.startTime, localTime: formatLocalTime(new Date(s.startTime), business.timezone), staffId: s.staffId })),
  });
});

// Books a slot returned by check-availability. startTime must be the exact ISO string that
// endpoint returned — same contract as the WhatsApp bot's book_appointment tool, to avoid the agent
// inventing/miscalculating a time itself.
voiceRouter.post("/book", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      callerNumber: z.string().min(1),
      callerName: z.string().optional(),
      serviceName: z.string().min(1),
      startTime: z.string().min(1),
      staffName: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing required fields" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;
  if (rejectIfInquiry(business, res)) return;

  const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.serviceName, mode: "insensitive" } } });
  if (!service) return res.status(404).json({ error: "Unknown service" });

  let staffId: string | null | undefined;
  if (parsed.data.staffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.staffName, mode: "insensitive" } } });
    if (!staff) return res.status(404).json({ error: "Unknown staff member" });
    staffId = staff.id;
  }

  try {
    const appointment = await bookAppointmentWithSideEffects({
      businessId: business.id,
      serviceId: service.id,
      serviceName: service.name,
      customerPhone: parsed.data.callerNumber,
      customerName: parsed.data.callerName,
      startTime: parseBookingTime(parsed.data.startTime, business.timezone),
      staffId,
      staffName: parsed.data.staffName,
      ownerAlertPrefix: "📞 הזמנה חדשה (שיחת טלפון)!",
    });
    res.json({ booked: true, appointmentId: appointment.id, startTime: appointment.startTime, endTime: appointment.endTime });
  } catch (err) {
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "Slot no longer available" });
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Cancels the given appointment (its id comes from /context's upcomingAppointment, or a future
// list-appointments tool) — scoped to the business, so a caller can never cancel someone else's.
voiceRouter.post("/cancel", async (req, res) => {
  const parsed = z.object({ calledNumber: z.string().min(1), appointmentId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber and appointmentId are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;

  try {
    await cancelAppointmentById(business.id, parsed.data.appointmentId);
    res.json({ cancelled: true });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) return res.status(404).json({ error: "No matching appointment found" });
    throw err;
  }
});

/**
 * Sends the owner a WhatsApp message about a caller who wants to reach them.
 *
 * A live transfer is not always possible — the owner may not answer, and a business with no
 * notification phone has nowhere to transfer to at all. Without this the agent's only honest reply
 * was "someone will get back to you", with nothing behind it: no message was sent and the owner
 * never learned anyone had called.
 *
 * Returns 200 with `{ notified: false }` rather than an error when the owner is unreachable, so the
 * agent can tell the caller the truth instead of promising a message that did not send.
 */
voiceRouter.post("/notify-owner", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      callerNumber: z.string().min(1),
      callerName: z.string().max(120).optional(),
      // What the caller actually wants, in the agent's own words. Capped because it is model output
      // going into a WhatsApp message.
      message: z.string().min(1).max(600),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber, callerNumber and message are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;

  const who = parsed.data.callerName?.trim() || "מתקשר";
  // The number is the part the owner acts on, so it goes on its own line rather than mid-sentence.
  const phone = parsed.data.callerNumber === "unknown" ? "לא זוהה" : parsed.data.callerNumber;
  const notified = await notifyOwner(
    business.id,
    `📞 בקשה משיחת טלפון\n\n${who}: ${parsed.data.message}\n\nלחזור אליו: ${phone}`
  );
  res.json({ notified });
});

// Reschedules to a new time (and optionally a new service/staff) — newStartTime follows the same
// "exact ISO string from check-availability" contract as /book.
voiceRouter.post("/reschedule", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      appointmentId: z.string().min(1),
      newStartTime: z.string().min(1),
      newServiceName: z.string().optional(),
      newStaffName: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing required fields" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;
  if (rejectIfInquiry(business, res)) return;

  let newServiceId: string | undefined;
  if (parsed.data.newServiceName) {
    const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.newServiceName, mode: "insensitive" } } });
    if (!service) return res.status(404).json({ error: "Unknown service" });
    newServiceId = service.id;
  }

  let newStaffId: string | null | undefined;
  if (parsed.data.newStaffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.newStaffName, mode: "insensitive" } } });
    if (!staff) return res.status(404).json({ error: "Unknown staff member" });
    newStaffId = staff.id;
  }

  try {
    const appointment = await rescheduleAppointmentById({
      businessId: business.id,
      appointmentId: parsed.data.appointmentId,
      newStartTime: parseBookingTime(parsed.data.newStartTime, business.timezone),
      newServiceId,
      newStaffId,
      ownerAlertPrefix: "📞 שינוי מועד (שיחת טלפון)!",
    });
    res.json({ rescheduled: true, startTime: appointment.startTime, endTime: appointment.endTime });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) return res.status(404).json({ error: "No matching appointment found to reschedule" });
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "New slot no longer available; original appointment kept" });
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: err.message + "; original appointment kept" });
    throw err;
  }
});

/**
 * Token usage from one voice-agent LLM call.
 *
 * Phone calls were the only AI spend with no ledger entry at all: the agent runs out-of-process
 * (Cartesia's container, not ours) and talks to the model directly, so nothing passed through
 * logClaudeUsage. Cost-per-business, the AI budget alerts and the margin figures all silently
 * excluded voice — which matters most for exactly the businesses that take calls.
 *
 * Reported per call rather than per conversation because that's the granularity the model returns,
 * and it matches how the WhatsApp side already logs. `customerPhone` is the caller, so voice and
 * WhatsApp spend for the same person land on the same key.
 *
 * Failures here must never affect the call — the agent logs and moves on (see report_usage in
 * voice-agent/main.py), and a rejected report costs a ledger row, not a conversation.
 */
voiceRouter.post("/usage", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      callerNumber: z.string().optional(),
      model: z.string().min(1),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      cacheReadTokens: z.number().int().min(0).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid usage payload" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });

  await logClaudeUsage({
    businessId: business.id,
    // "unknown" rather than dropping the row: a withheld caller ID still costs money, and losing
    // the spend would understate exactly the calls we can say least about.
    customerPhone: parsed.data.callerNumber || "unknown",
    provider: "voice",
    model: parsed.data.model,
    inputTokens: parsed.data.inputTokens,
    outputTokens: parsed.data.outputTokens,
    cacheReadTokens: parsed.data.cacheReadTokens,
  });

  res.json({ logged: true });
});
