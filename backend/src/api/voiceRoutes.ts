import { asyncRouter } from "../lib/asyncRouter.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { findAvailableSlots, SlotUnavailableError, OutsideBusinessHoursError } from "../booking/availability.js";
import { bookAppointmentWithSideEffects, cancelAppointmentById, rescheduleAppointmentById, AppointmentNotFoundError } from "../booking/actions.js";
import { parseBookingTime, instantPartsInTz } from "../lib/timezone.js";
import { TEMPLATES, isBusinessType } from "../lib/businessTemplates.js";
// Shared with the owner-notification phone: the same "typed by a human vs formatted by a
// machine" mismatch this was written for applies wherever those two meet. See lib/phone.ts.
import { normalizePhone } from "../lib/phone.js";
import { cachedHebrewVoices } from "../lib/cartesiaAdmin.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { logClaudeUsage } from "../lib/usageLedger.js";
import { sendUnitDetailsEmail } from "../lib/email.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage, sendWhatsAppImage } from "../webhook/whatsappClient.js";

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
 * Reads the cached catalogue only, and never waits on one. The hour-long cache made this look free
 * per call, but the cache is per process and empties on every deploy — so the first caller after
 * each one waited on an outbound Cartesia request, mid-call, before hearing anything. Degrades to
 * "unknown" (default feminine inflection) rather than delaying the greeting: a caller notices
 * silence long before they notice a verb form.
 */
function voiceGenderFor(voiceId: string | null): "masculine" | "feminine" | null {
  if (!voiceId) return null;
  // Cache-only: see cachedHebrewVoices. A caller is on the line while this runs.
  const voice = cachedHebrewVoices().find((v) => v.id === voiceId);
  // gender_neutral gives us nothing to inflect with, so it is treated the same as unknown.
  return voice?.gender === "masculine" || voice?.gender === "feminine" ? voice.gender : null;
}

/**
 * The one customer whose phone matches the caller, or null.
 *
 * This runs while an answered caller hears silence, and it used to be a fetch of EVERY customer
 * row in the business — thousands of rows over the wire from Neon per call — to match one number
 * in application code (formats vary, so Prisma couldn't compare them). Matching on the last nine
 * digits inside SQL returns at most one row instead; it is the same rule the outreach reply
 * handler already uses, and Israeli subscriber numbers are nine digits after the country code, so
 * it is exactly what normalizePhone equality reduced to for the numbers this ever sees.
 *
 * The length guard is not decorative: an unavailable caller ID arrives as "unknown", which
 * normalizes to "" — and an empty LIKE suffix matches every customer in the table, greeting the
 * caller by whoever happened to sort first.
 */
async function findCallerCustomer(
  businessId: string,
  callerDigits: string
): Promise<{ id: string; phone: string; name: string | null } | null> {
  if (callerDigits.length < 7) return null;
  const last9 = callerDigits.slice(-9);
  const rows = await prisma.$queryRaw<{ id: string; phone: string; name: string | null }[]>(
    Prisma.sql`SELECT id, phone, name FROM "Customer"
               WHERE "businessId" = ${businessId}
                 AND RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = ${last9}
               LIMIT 1`
  );
  return rows[0] ?? null;
}

voiceRouter.post("/context", async (req, res) => {
  // A caller is listening to silence for exactly as long as this handler runs, and the agent's own
  // log can only show the round trip as a whole. Without this line, "the greeting is slow" cannot
  // be split into our query time versus the network between Cartesia and us.
  const startedAt = Date.now();
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

  const [full, hours, caller, services, faqEntries, specialPeriods] = await Promise.all([
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
    findCallerCustomer(business.id, callerDigits),
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

  // Register the caller as a customer, exactly as the WhatsApp webhook does for anyone who writes
  // in. Phone callers were the one channel that left no trace: the Customers page never learned
  // they existed, so a caller who rang twice was "unknown" both times and the WhatsApp bot had no
  // idea it had already spoken to them. The dashboard's own empty state promises every customer
  // who reaches the bot is saved automatically — this makes that true for the phone too.
  //
  // Fire-and-forget and non-fatal: a caller is on the line, and a CRM write must never delay the
  // greeting or fail the call.
  if (callerDigits.length >= 7) {
    // try/catch around the fire-and-forget, not just .catch on the promise: this sits in the
    // handler a caller is waiting on, and anything that throws *synchronously* here would 500 the
    // context fetch and put the unreachable apology in the caller's ear over a CRM row.
    try {
      void prisma.customer
        .upsert({
          where: { businessId_phone: { businessId: business.id, phone: callerDigits } },
          create: { businessId: business.id, phone: callerDigits },
          update: {},
        })
        .catch((err) => console.error("[voice] Failed to register caller as customer:", err));
    } catch (err) {
      console.error("[voice] Failed to register caller as customer:", err);
    }
  }

  console.log(`[voice] /context for ${full.name} in ${Date.now() - startedAt}ms`);

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
    voiceGender: voiceGenderFor(full.voiceId),
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
      // Marks this as the channel that leaves the customer nothing in writing, so they get a
      // confirmation message. See bookAppointmentWithSideEffects.
      source: "voice",
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
      source: "voice",
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
      // Anthropic bills cache writes at 1.25x input; dropping them here would understate every
      // first turn of every call, which is where the whole system prompt gets written to cache.
      cacheCreationTokens: z.number().int().min(0).optional(),
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
    cacheCreationTokens: parsed.data.cacheCreationTokens,
  });

  res.json({ logged: true });
});

/**
 * Sends a unit's details and photos to the caller, from the voice agent, during the call.
 *
 * This is the request the product exists to automate. On a live call the agent's only move was
 * "אעביר לבעל הצימר" — a caller who asked for pictures got a note relayed to the owner, who then
 * had to do the sending by hand. The WhatsApp bot already sends these photos itself; the phone
 * channel gets the same ability here.
 *
 * Two channels, honestly different in reliability:
 * - WhatsApp: sent from the business's own WABA. Meta only guarantees delivery inside the
 *   caller's 24h customer-service window, so the send is attempted only when that window is open
 *   (the caller has messaged the business recently). Outside it the endpoint says so instead of
 *   firing a message that Meta accepts and then kills in transit — the exact failure that hit
 *   the owner alerts.
 * - Email: always deliverable. Reply-To is the business's own address, so an answer goes to the
 *   owner, not to a noreply void.
 *
 * Either way the owner gets a notification that details were auto-sent — the caller is a warm
 * lead, and the notification is what turns "the bot handled it" into a follow-up.
 */
voiceRouter.post("/send-details", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      serviceName: z.string().min(1),
      channel: z.enum(["whatsapp", "email"]),
      callerNumber: z.string().optional(),
      toEmail: z.string().email().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid send-details payload" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfNotEntitled(business, res)) return;

  const service = await prisma.service.findFirst({
    where: { businessId: business.id, name: { equals: parsed.data.serviceName, mode: "insensitive" } },
    select: { name: true, description: true, priceCents: true, maxGuests: true, imageUrls: true, linkUrl: true },
  });
  if (!service) return res.status(404).json({ error: "Unknown service" });

  const full = await prisma.business.findUniqueOrThrow({
    where: { id: business.id },
    select: { name: true, email: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });

  const lines = [
    `${service.name} — ${full.name}`,
    service.description ?? "",
    service.priceCents ? `מחיר: ${Math.round(service.priceCents / 100)} ש"ח ללילה` : "",
    service.maxGuests ? `עד ${service.maxGuests} אורחים` : "",
    service.linkUrl ? `פרטים נוספים: ${service.linkUrl}` : "",
  ].filter(Boolean);

  if (parsed.data.channel === "whatsapp") {
    const caller = parsed.data.callerNumber?.trim();
    if (!caller || caller === "unknown") {
      return res.status(400).json({ error: "callerNumber is required for the whatsapp channel" });
    }
    if (!full.whatsappPhoneNumberId || !full.whatsappAccessToken) {
      return res.status(409).json({ error: "This business has no WhatsApp connected" });
    }
    // Same 24h rule that governs the owner alerts: a free-form send outside the caller's window
    // is accepted by Meta and dies in transit, which would have the agent promising photos that
    // never arrive. The window is open only if the caller has messaged this business recently.
    const windowOpen = await prisma.conversationMessage.findFirst({
      where: {
        businessId: business.id,
        phone: normalizePhone(caller),
        role: "user",
        // The caller is on the phone right now, and this very call is being written to this table
        // as 'user' turns. Without the filter the call would vouch for itself: every caller would
        // look reachable on WhatsApp, and every photo would be accepted by Meta and dropped.
        channel: "whatsapp",
        createdAt: { gte: new Date(Date.now() - 23.5 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!windowOpen) {
      return res.status(409).json({
        error:
          "Caller has no open WhatsApp window with this business — offer email instead, or message_owner so the owner sends it.",
      });
    }
    const accessToken = decryptSecret(full.whatsappAccessToken);
    await sendWhatsAppMessage({
      phoneNumberId: full.whatsappPhoneNumberId, accessToken, to: caller, text: lines.join("\n"),
    });
    // Up to four photos: enough to show the unit, few enough not to flood a phone.
    for (const url of service.imageUrls.slice(0, 4)) {
      await sendWhatsAppImage({ phoneNumberId: full.whatsappPhoneNumberId, accessToken, to: caller, imageUrl: url });
    }
  } else {
    if (!parsed.data.toEmail) return res.status(400).json({ error: "toEmail is required for the email channel" });
    await sendUnitDetailsEmail({
      to: parsed.data.toEmail,
      replyTo: full.email,
      businessName: full.name,
      unitName: service.name,
      lines,
      imageUrls: service.imageUrls,
      linkUrl: service.linkUrl,
    });
  }

  // The caller is a warm lead; the notification is what turns "the bot handled it" into an owner
  // follow-up. Fire-and-forget — a failed heads-up must not fail the send that already happened.
  void notifyOwner(
    business.id,
    `📞 שיחת טלפון: נשלחו פרטים ותמונות של "${service.name}" ל${parsed.data.channel === "email" ? `מייל ${parsed.data.toEmail}` : `וואטסאפ ${parsed.data.callerNumber}`}.`
  );

  res.json({ sent: true, photos: Math.min(service.imageUrls.length, 4) });
});

/**
 * Records what was said on a phone call, into the same conversation history the WhatsApp bot uses.
 *
 * Until now a call left nothing behind. Every WhatsApp exchange lands in ConversationMessage and
 * shows up in the dashboard's Conversations view; a phone call — the channel where a caller states
 * their dates, their party size, and what they want — produced one owner note at best and vanished.
 * The owner could not answer "who called this morning and what did they want", and neither could
 * the WhatsApp bot when the same person messaged an hour later.
 *
 * Stored under the caller's own phone number, so the two channels form one thread per person:
 * `getHistory` in conversationStore reads by (businessId, phone) and does not care which channel
 * wrote the rows. A caller who phones and then messages is picked up mid-conversation.
 *
 * The agent posts turns as they happen rather than one summary at the end, because a call can drop
 * at any moment and a transcript that only exists after a clean goodbye is missing exactly the
 * calls worth reading.
 */
voiceRouter.post("/transcript", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      callerNumber: z.string().min(1),
      turns: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
        .min(1)
        .max(20),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid transcript payload" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });

  const phone = normalizePhone(parsed.data.callerNumber);
  // A withheld caller ID has no thread to belong to — storing these under "" would merge every
  // anonymous caller in the business into one unreadable conversation.
  if (phone.length < 7) return res.json({ stored: 0 });

  await prisma.conversationMessage.createMany({
    data: parsed.data.turns.map((t) => ({
      businessId: business.id,
      phone,
      role: t.role,
      // Marked so the dashboard (and anyone reading the thread) can tell a spoken turn from a
      // typed one — they read very differently, and a transcription error looks like nonsense
      // without the label.
      content: t.role === "user" ? `📞 ${t.content}` : t.content,
      // The emoji above is for human readers. This is the part code reads: a spoken turn must
      // never be mistaken for an inbound WhatsApp message, because that is what Meta's 24h
      // window is measured from.
      channel: "voice",
    })),
  });

  res.json({ stored: parsed.data.turns.length });
});
