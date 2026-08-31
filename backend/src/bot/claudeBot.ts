import { prisma } from "../lib/prisma.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTurn, getHistory, type Turn } from "./conversationStore.js";
import { findAvailableSlots, createAppointment, SlotUnavailableError, OutsideBusinessHoursError, SLOT_BLOCKING_STATUSES, type AvailableSlot } from "../booking/availability.js";
import { cancelAppointmentById } from "../booking/actions.js";
import { normalizeOwnerPhone } from "../lib/phone.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "../lib/crypto.js";
import { checkManager } from "./managerAuth.js";
import {
  daySchedule, businessSummary, blockTime, notifyCustomerOfCancellation, dayBounds, todayIn, BlockOverlapError,
  openingHours, setDayHours, listServices, listStaff, listFaq, listWaitlist, listBlocks,
  minutesToHhmm, hhmmToMinutes, dayNameToIndex,
} from "./managerActions.js";
import { issueAndSendReceipt, NoInvoiceProviderError, DELIVERY_MESSAGE_HE } from "../lib/receipts.js";
import { quoteCustomerCoupon, redeemCustomerCoupon, releaseCustomerCoupon, CustomerCouponError, CUSTOMER_COUPON_FAILURE_HE } from "../booking/customerCoupons.js";
import { isDepositRequired, depositHoldFields, createDepositLink, releaseHold } from "../booking/deposits.js";
import { parseBookingTime, parseDateString, dayOfWeekForDate, instantPartsInTz, zonedDateParts } from "../lib/timezone.js";
import { notifyWaitlist } from "../lib/waitlist.js";
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
 * Routes only unambiguous, content-free acknowledgements to the cheap tier — everything else,
 * including anything that could touch booking logic, stays on the smart tier.
 *
 * This used to just return "smart" unconditionally: an earlier "simple message" heuristic sent
 * short messages to Haiku and produced a steady trickle of invented Hebrew words in real
 * conversations ("יתאשר" instead of "יאשר", "משתניים" — literally "variables" — instead of
 * "מהשתיים"). That's a model-capability limit on Hebrew morphology, not something prompt wording
 * fixes, so the fix isn't a smarter classifier — it's a stricter one: only route messages where a
 * wrong word literally cannot matter, because there's nothing to say beyond "acknowledged".
 *
 * hadToolError forces "smart" outright — a tool that just failed needs the model that can actually
 * reason about the retry, not the one being evaluated for cost.
 */
const SIMPLE_MESSAGE_RE =
  /^(hi|hey|hello|thanks|thank you|ok|okay|k|yes|no|sure|great|cool|byy?e|goodbye|היי|הי|שלום|ביי|תודה|תודה רבה|מעולה|סבבה|בסדר|בסדר גמור|כן|לא|אוקיי|אוקי|יאללה|נהדר|יופי|וואו|תודה!)[!.,?׃…\s]*$/iu;

function chooseTier(messageText: string, hadToolError: boolean): "cheap" | "smart" {
  if (hadToolError) return "smart";
  const trimmed = messageText.trim();
  if (trimmed.length > 0 && trimmed.length <= 20 && SIMPLE_MESSAGE_RE.test(trimmed)) return "cheap";
  return "smart";
}

/**
 * Manager-only tools.
 *
 * Deliberately NOT in the `tools` array above. They are appended only for a sender Meta says is the
 * owner (see managerAuth), so a customer's model never even sees that they exist — and every one of
 * them re-checks authorisation at execution time, because prompt-level hiding is not a security
 * boundary, it is only hygiene.
 */
/** Names the execution guard treats as owner-only. Derived below from managerTools itself. */
const managerTools: GenericTool[] = [
  {
    name: "issue_receipt",
    description:
      "Issue a receipt (קבלה) for money the business already received — cash, a card at the counter, a transfer — and send it to the customer on WhatsApp. Two steps, both through this tool: call it first WITHOUT confirmed to get back the exact details, read them to the owner and ask for a yes; only then call again with confirmed:true. Never set confirmed:true on the first call. A receipt is a real accounting document that cannot be deleted once issued.",
    input_schema: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "The customer's name or phone as the owner said it — used to find them in the CRM",
        },
        amountIls: { type: "number", description: "Amount received, in shekels" },
        description: { type: "string", description: "What it was for, e.g. 'תספורת וצבע'" },
        confirmed: {
          type: "boolean",
          description: "Only true on the second call, after the owner explicitly confirmed the details you read back.",
        },
      },
      required: ["customerName", "amountIls", "description"],
    },
  },
  {
    name: "manager_help",
    description:
      "List what the owner can do from WhatsApp. Call this when the owner greets you, asks what you can do, seems unsure, or asks for something close to but not exactly one of your abilities. Cheap and read-only — err towards calling it.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "day_schedule",
    description:
      "The owner's own bookings for a date — who is coming, when, for what. Use for 'what do I have today', 'מה יש לי מחר', 'who's coming at 3'. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Omit for today." },
      },
      required: [],
    },
  },
  {
    name: "business_summary",
    description:
      "How the business is doing: bookings and revenue this month, new customers, how many appointments are still upcoming. Read-only.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "block_time",
    description:
      "Block a window so the bot stops offering it — a day off, a dentist appointment, a supplier visit. Two steps like issue_receipt: call without confirmed to check the window is free and read it back, then again with confirmed:true. If bookings already sit inside the window it refuses and lists them; do not retry, tell the owner what clashes and let them decide.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        startTime: { type: "string", description: "HH:MM in the business's own timezone" },
        endTime: { type: "string", description: "HH:MM in the business's own timezone" },
        reason: { type: "string", description: "Optional note, e.g. 'חופש'" },
        confirmed: { type: "boolean", description: "Only true on the second call, after the owner confirmed." },
      },
      required: ["date", "startTime", "endTime"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel a customer's booking on the owner's behalf and tell the customer it was cancelled. Two steps: call without confirmed to identify the exact booking and read it back, then again with confirmed:true. This messages a real customer, so never confirm on the owner's behalf.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer name or phone as the owner said it" },
        date: { type: "string", description: "YYYY-MM-DD of the booking. Omit to use their next one." },
        confirmed: { type: "boolean", description: "Only true on the second call, after the owner confirmed." },
      },
      required: ["customerName"],
    },
  },
  {
    name: "show_settings",
    description:
      "Read one part of the business's own setup: opening hours, services and prices, staff, FAQ answers the bot gives, who is on the waitlist, or upcoming blocked time. Read-only and cheap — use it before changing anything so you can tell the owner what it is now.",
    input_schema: {
      type: "object",
      properties: {
        what: {
          type: "string",
          enum: ["hours", "services", "staff", "faq", "waitlist", "blocks"],
          description: "Which part to show",
        },
      },
      required: ["what"],
    },
  },
  {
    name: "set_hours",
    description:
      "Set or clear one day's opening hours — 'תשנה יום שלישי ל-9 עד 5', 'אני סגור בשבת'. One day per call; for several days call it once per day. Two steps: without confirmed to read the change back, then with confirmed:true. Changing hours changes what the bot offers every customer, so it is always confirmed.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "Day name as the owner said it — 'שלישי', 'יום ראשון', 'Monday'" },
        open: { type: "string", description: "Opening time HH:MM. Omit when closing the day." },
        close: { type: "string", description: "Closing time HH:MM. Omit when closing the day." },
        closed: { type: "boolean", description: "True to mark the day closed entirely." },
        confirmed: { type: "boolean" },
      },
      required: ["day"],
    },
  },
  {
    name: "upsert_service",
    description:
      "Add a service or change an existing one's price or duration — 'תעלה את הצבע ל-250', 'תוסיף שירות פן, 80 שקל, 30 דקות'. Matches an existing service by name; creates it when there is none. Two-step confirmation. Prices are what customers are quoted, so never guess a value the owner did not say.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        priceIls: { type: "number", description: "Price in shekels" },
        durationMin: { type: "number", description: "How long it takes, in minutes" },
        confirmed: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "manage_staff",
    description: "Add or remove a member of staff customers can ask for by name. Two-step confirmation on removal.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove"] },
        name: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["action", "name"],
    },
  },
  {
    name: "add_faq",
    description:
      "Teach the bot an answer it should give customers — 'אם שואלים על חניה, תגיד שיש חניון בבניין'. Applies to every customer from then on, so read it back before saving.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        answer: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["question", "answer"],
    },
  },
  {
    name: "remove_block",
    description: "Remove a time block the owner previously set — 'תבטל את החסימה של מחר'. Use show_settings with 'blocks' first to find which one they mean.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD of the block to remove" },
        confirmed: { type: "boolean" },
      },
      required: ["date"],
    },
  },
  {
    name: "set_bot_enabled",
    description:
      "Turn the customer-facing bot on or off. Off means it stops answering customers entirely — messages are still saved and the owner answers them by hand. Always confirm; this is invisible from the customer's side and easy to leave off by accident.",
    input_schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        confirmed: { type: "boolean" },
      },
      required: ["enabled"],
    },
  },
  {
    name: "book_for_customer",
    description:
      "Book an appointment on the owner's behalf — for someone who phoned or walked in. If the customer is not in the CRM, pass their phone and they are added. Two-step confirmation. Respects opening hours and existing bookings exactly as a customer booking would.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        customerPhone: { type: "string", description: "Needed only for someone not already a customer" },
        serviceName: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM in the business's timezone" },
        confirmed: { type: "boolean" },
      },
      required: ["customerName", "serviceName", "date", "time"],
    },
  },
  {
    name: "add_customer",
    description: "Add someone to the customer list without booking anything — a regular the salon already had.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        note: { type: "string" },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "set_customer_note",
    description: "Save a note about a customer, shown to the owner beside that customer's conversation — 'תרשום על דנה שהיא מעדיפה בוקר'. The note is for the owner; the bot does not read it out to customers.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        note: { type: "string" },
      },
      required: ["customerName", "note"],
    },
  },
  {
    name: "message_customer",
    description:
      "Send a customer a WhatsApp message from the business — 'תכתבי לדנה שאני מאחרת ברבע שעה'. Two-step confirmation: this reaches a real person in the business's name, so read the exact wording back first.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        text: { type: "string", description: "Exactly what to send" },
        confirmed: { type: "boolean" },
      },
      required: ["customerName", "text"],
    },
  },
  {
    name: "create_discount_code",
    description:
      "Create a discount code for the business's customers — 'תפתח קוד WELCOME10 של 10 אחוז'. Two-step confirmation.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Latin letters and digits, e.g. WELCOME10" },
        percent: { type: "number", description: "Percentage off. Give this or fixedIls, not both." },
        fixedIls: { type: "number", description: "Shekels off. Give this or percent, not both." },
        maxUses: { type: "number", description: "Optional cap on total uses" },
        confirmed: { type: "boolean" },
      },
      required: ["code"],
    },
  },
];

// Derived rather than hand-listed: a manager tool added above is guarded automatically, instead of
// depending on someone remembering to add its name in a second place.
const MANAGER_ONLY_TOOLS = new Set(managerTools.map((t) => t.name));

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
        couponCode: { type: "string", description: "Only if the customer gave a discount code AND check_coupon already accepted it. Never invent one." },
      },
      required: ["serviceName", "startTime", "customerName"],
    },
  },
  {
    name: "check_coupon",
    description:
      "Check a discount code the customer mentioned, for a specific service. Call this whenever a customer says they have a code, coupon or promotion — never guess whether a code is valid, and never promise a discount without calling this first. Returns the discount and the final price, or a reason it cannot be used. Checking costs nothing and can be repeated.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The code exactly as the customer wrote it" },
        serviceName: { type: "string", description: "The service they want it applied to, matching a known service name" },
      },
      required: ["code", "serviceName"],
    },
  },
  {
    name: "list_my_appointments",
    description: "List this customer's upcoming appointments, including any still held awaiting a deposit (awaitingPayment:true).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of this customer's upcoming appointments. Works for a slot still held awaiting a deposit as well as a confirmed booking.",
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
    name: "get_payment_link",
    description:
      "Return the deposit payment link for this customer's appointment that is still awaiting payment. Use whenever the customer asks to pay, says they lost or can't open the link, or asks how much they owe. Do NOT call book_appointment for this — they already have a held slot.",
    input_schema: { type: "object", properties: {} },
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
  /**
   * Records a name the moment it is mentioned, independently of any booking.
   *
   * Everywhere else a name gets written is the tail end of a completed action — book_appointment,
   * or request_booking_callback. Neither necessarily happens: a guest asks about prices and photos,
   * says who they are, and leaves. The name was in the transcript and nowhere else, so the
   * customers list showed a page of nameless rows for a business that had been talking to people
   * by name all week. Worst in inquiry mode, where there is no booking call to fall back on.
   */
  {
    name: "save_customer_name",
    description:
      "Record the customer's name as soon as they give it, whether or not they are booking. Call this the first time a name is mentioned in the conversation. Do not call it again unless they correct their name, and never guess a name they did not state.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "The name exactly as the customer gave it." },
      },
      required: ["customerName"],
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

/**
 * Picks the units that hold a given party, in code.
 *
 * Two separate conversations went wrong on this: a family of five was steered to the ten-guest unit
 * at ₪3,000 while the seven-guest one at ₪2,100 went unmentioned, and a party of six was offered a
 * unit that sleeps three. The instruction to prefer the cheapest unit that fits was already in the
 * prompt both times. It kept failing because it asked the model to do arithmetic on numbers it had
 * to first extract from prose, and a wrong answer there is invisible — every unit named is real and
 * the price quoted is correct, so nothing downstream can catch it.
 *
 * So the model reports the headcount and the comparison happens here. It still writes the reply;
 * it just no longer decides what fits.
 */
const unitsForGuestsTool: GenericTool = {
  name: "find_units_for_guests",
  description:
    "Given how many people are coming, returns the units that can hold them, cheapest first. Call this before naming or pricing any unit once you know the party size — do not work out which unit fits on your own. Count every person including children and infants.",
  input_schema: {
    type: "object",
    properties: {
      guestCount: { type: "number", description: "Total people, including children and babies." },
    },
    required: ["guestCount"],
  },
};

// Inquiry mode exposes only info + handoff tools — no check_availability/book_appointment/etc.,
// since there is no live booking engine for these verticals.
const inquiryTools: GenericTool[] = [
  requestBookingCallbackTool,
  tools.find((t) => t.name === "save_customer_name")!,
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
  /** The owner's greeting, to send as its own message before `text`. Set only when this opens a
   * conversation and the greeting has no unfilled [placeholders] — see handleIncomingMessage. */
  greetingText?: string;
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

// Exported for tests, following normalizeServiceName above. The tool bodies are where the money
// decisions live — deposits, cancellations, payment links — and driving the whole model loop to
// reach them would test the provider adapter far more than the behaviour under test.
/**
 * Finds a customer the owner named in passing — "דנה", "0501234567", "דנה כהן".
 *
 * Scoped to the business, and never used to decide authorisation: this resolves WHO a receipt is
 * for, long after managerAuth has already settled who is asking.
 *
 * An ambiguous name returns null rather than guessing. Issuing a real accounting document against
 * the wrong customer is worse than asking which Dana they meant.
 */
async function findCustomerByNameOrPhone(
  businessId: string,
  query: string
): Promise<{ id: string; name: string | null; phone: string } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const asDigits = trimmed.replace(/\D/g, "");
  if (asDigits.length >= 7) {
    // Suffix match: the owner may say the local form of a number stored internationally.
    const byPhone = await prisma.customer.findMany({
      where: { businessId, phone: { endsWith: asDigits.slice(-9) } },
      select: { id: true, name: true, phone: true },
      take: 2,
    });
    if (byPhone.length === 1) return byPhone[0];
    if (byPhone.length > 1) return null;
  }

  const byName = await prisma.customer.findMany({
    where: { businessId, name: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, name: true, phone: true },
    take: 2,
  });
  return byName.length === 1 ? byName[0] : null;
}

export async function runTool(
  businessId: string,
  customerPhone: string,
  name: string,
  input: Record<string, unknown>,
  lastOfferedSlots: { value?: AvailableSlot[] },
  lastPhotos: { value?: { url: string; caption?: string }[] }
): Promise<string> {
  // Manager-only tools are authorised HERE, at execution, against the phone number Meta signed —
  // never by the model's belief about who it is talking to, and never from anything in the message.
  // Hiding the tool from a customer's tool list is hygiene; this is the boundary.
  if (MANAGER_ONLY_TOOLS.has(name)) {
    const { isManager } = await checkManager(businessId, customerPhone);
    if (!isManager) {
      // Says nothing about what the tool is or that authorisation exists — a refusal that
      // describes the gate is a map of the gate.
      console.warn(`[bot] Refused manager tool "${name}" for non-manager ${customerPhone} on ${businessId}`);
      return JSON.stringify({
        error: "This is not something you can do here. Answer the customer normally and do not mention this.",
      });
    }
  }

  // A confirmation gate shared by every manager write. Same shape everywhere, so the owner learns
  // one rhythm — the bot reads back what it is about to do, and only a "yes" makes it happen.
  const confirmFirst = (input: Record<string, unknown>, preview: Record<string, unknown>, what: string) =>
    input.confirmed === true
      ? null
      : JSON.stringify({
          needsConfirmation: true,
          [what]: preview,
          note: "Read this back to the owner and ask them to confirm. Nothing has changed yet. Only if they say yes, call again with the same values and confirmed:true.",
        });

  if (name === "show_settings") {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true, botEnabled: true },
    });
    const tz = biz.timezone || "Asia/Jerusalem";
    switch (input.what) {
      case "hours": {
        const hours = await openingHours(businessId);
        return JSON.stringify({
          hours,
          // Days with no row are closed, and an owner asking "what are my hours" needs to hear
          // which days those are rather than notice an absence.
          closedDays: [0, 1, 2, 3, 4, 5, 6]
            .filter((d) => !hours.some((h) => h.dayOfWeek === d))
            .map((d) => ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][d]),
        });
      }
      case "services":
        return JSON.stringify({ services: await listServices(businessId) });
      case "staff":
        return JSON.stringify({ staff: await listStaff(businessId) });
      case "faq":
        return JSON.stringify({ faq: await listFaq(businessId) });
      case "waitlist":
        return JSON.stringify({ waiting: await listWaitlist(businessId) });
      case "blocks":
        return JSON.stringify({ blocks: await listBlocks(businessId, tz) });
      default:
        return JSON.stringify({ error: "Ask the owner which part they mean." });
    }
  }

  if (name === "set_hours") {
    const dayIndex = dayNameToIndex(String(input.day ?? ""));
    if (dayIndex === null) return JSON.stringify({ error: "Ask the owner which day they mean." });
    const dayName = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][dayIndex];

    if (input.closed === true) {
      const gate = confirmFirst(input, { day: dayName, closed: true }, "willSet");
      if (gate) return gate;
      await setDayHours({ businessId, dayOfWeek: dayIndex, closed: true });
      return JSON.stringify({ updated: true, note: `יום ${dayName} מסומן כסגור. הבוט לא יציע בו תורים.` });
    }

    const openMin = hhmmToMinutes(String(input.open ?? ""));
    const closeMin = hhmmToMinutes(String(input.close ?? ""));
    if (openMin === null || closeMin === null) {
      return JSON.stringify({ error: "Ask the owner for the opening and closing time, e.g. 09:00 to 17:00." });
    }
    if (closeMin <= openMin) return JSON.stringify({ error: "The closing time must be after the opening time." });

    const gate = confirmFirst(
      input,
      { day: dayName, open: minutesToHhmm(openMin), close: minutesToHhmm(closeMin) },
      "willSet"
    );
    if (gate) return gate;

    await setDayHours({ businessId, dayOfWeek: dayIndex, openMin, closeMin });
    return JSON.stringify({ updated: true, day: dayName, open: minutesToHhmm(openMin), close: minutesToHhmm(closeMin) });
  }

  if (name === "upsert_service") {
    const serviceName = String(input.name ?? "").trim();
    if (!serviceName) return JSON.stringify({ error: "Ask the owner which service." });
    const existing = (await listServices(businessId)).find(
      (svc) => svc.name.trim().toLowerCase() === serviceName.toLowerCase()
    );

    const priceIls = input.priceIls === undefined ? existing?.priceIls : Number(input.priceIls);
    const durationMin = input.durationMin === undefined ? existing?.durationMin : Number(input.durationMin);
    if (priceIls === undefined || durationMin === undefined) {
      // Never invented: a price the owner did not say is a price customers would be quoted.
      return JSON.stringify({
        error: existing
          ? "Ask the owner what to change — the price, the duration, or both."
          : "That service does not exist yet. Ask the owner for its price and how long it takes.",
      });
    }
    if (!Number.isFinite(priceIls) || priceIls < 0 || !Number.isFinite(durationMin) || durationMin <= 0) {
      return JSON.stringify({ error: "Ask the owner for a valid price and duration." });
    }

    const gate = confirmFirst(
      input,
      { service: serviceName, priceIls, durationMin, isNew: !existing },
      "willSave"
    );
    if (gate) return gate;

    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: { priceCents: Math.round(priceIls * 100), durationMin },
      });
    } else {
      await prisma.service.create({
        data: { businessId, name: serviceName, priceCents: Math.round(priceIls * 100), durationMin },
      });
    }
    return JSON.stringify({ saved: true, service: serviceName, priceIls, durationMin });
  }

  if (name === "manage_staff") {
    const staffName = String(input.name ?? "").trim();
    if (!staffName) return JSON.stringify({ error: "Ask the owner for the name." });

    if (input.action === "add") {
      const already = (await listStaff(businessId)).find((m) => m.name.trim().toLowerCase() === staffName.toLowerCase());
      if (already) return JSON.stringify({ error: `${staffName} is already on the team.` });
      await prisma.staffMember.create({ data: { businessId, name: staffName } });
      return JSON.stringify({ added: true, name: staffName });
    }

    const member = (await listStaff(businessId)).find((m) => m.name.trim().toLowerCase() === staffName.toLowerCase());
    if (!member) return JSON.stringify({ error: `No staff member called ${staffName}.` });
    const gate = confirmFirst(input, { remove: member.name }, "willRemove");
    if (gate) return gate;
    // Their past appointments keep the row via staffId; removing only stops new bookings naming
    // them, which is what an owner means by "she doesn't work here any more".
    await prisma.staffMember.deleteMany({ where: { id: member.id, businessId } });
    return JSON.stringify({ removed: true, name: member.name });
  }

  if (name === "add_faq") {
    const question = String(input.question ?? "").trim();
    const answer = String(input.answer ?? "").trim();
    if (!question || !answer) return JSON.stringify({ error: "Ask the owner for both the question and the answer." });
    const gate = confirmFirst(input, { question, answer }, "willAdd");
    if (gate) return gate;
    await prisma.faqEntry.create({ data: { businessId, question, answer } });
    return JSON.stringify({ added: true, note: "The bot will use this with customers from now on." });
  }

  if (name === "remove_block") {
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const tz = biz.timezone || "Asia/Jerusalem";
    const date = String(input.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: "Ask the owner which date." });

    const { start, end } = dayBounds(date, tz);
    const blocks = await prisma.blockedTime.findMany({
      where: { businessId, startTime: { gte: start, lt: end } },
      orderBy: { startTime: "asc" },
    });
    if (blocks.length === 0) return JSON.stringify({ error: "There is no block on that date." });

    const fmt = new Intl.DateTimeFormat("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const gate = confirmFirst(
      input,
      { date, blocks: blocks.map((b) => ({ from: fmt.format(b.startTime), to: fmt.format(b.endTime) })) },
      "willRemove"
    );
    if (gate) return gate;

    await prisma.blockedTime.deleteMany({ where: { id: { in: blocks.map((b) => b.id) }, businessId } });
    return JSON.stringify({ removed: blocks.length, note: "The bot can offer that time again." });
  }

  if (name === "set_bot_enabled") {
    const enabled = input.enabled === true;
    const gate = confirmFirst(input, { botWillBe: enabled ? "on" : "off" }, "willSet");
    if (gate) return gate;
    await prisma.business.update({ where: { id: businessId }, data: { botEnabled: enabled } });
    return JSON.stringify({
      botEnabled: enabled,
      note: enabled
        ? "הבוט עונה שוב ללקוחות."
        : "הבוט מפסיק לענות ללקוחות. ההודעות שלהם עדיין נשמרות ואפשר לענות ידנית מהדשבורד. אפשר להדליק בחזרה כאן בכל רגע.",
    });
  }

  if (name === "book_for_customer") {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = biz.timezone || "Asia/Jerusalem";
    const { service, services } = await findServiceByName(businessId, String(input.serviceName ?? ""));
    if (!service) return unknownServiceError(services);

    const date = String(input.date ?? "");
    const time = String(input.time ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hhmmToMinutes(time) === null) {
      return JSON.stringify({ error: "Ask the owner for the date and time." });
    }
    const startTime = parseBookingTime(`${date}T${time.padStart(5, "0")}:00`, tz);

    let target = await findCustomerByNameOrPhone(businessId, String(input.customerName ?? ""));
    const givenPhone = input.customerPhone ? normalizeOwnerPhone(String(input.customerPhone)) : null;
    if (!target && !givenPhone) {
      return JSON.stringify({
        error: `No customer matching "${input.customerName}". Ask the owner for their phone number and call again with customerPhone.`,
      });
    }

    const gate = confirmFirst(
      input,
      {
        customer: target?.name ?? String(input.customerName),
        service: service.name,
        date,
        time,
      },
      "willBook"
    );
    if (gate) return gate;

    if (!target && givenPhone) {
      const created = await prisma.customer.upsert({
        where: { businessId_phone: { businessId, phone: givenPhone } },
        create: { businessId, phone: givenPhone, name: String(input.customerName).trim() || null },
        update: {},
        select: { id: true, name: true, phone: true },
      });
      target = created;
    }

    try {
      await createAppointment({
        businessId,
        serviceId: service.id,
        customerPhone: target!.phone,
        customerName: target!.name ?? (String(input.customerName).trim() || "לקוח"),
        startTime,
      });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return JSON.stringify({ error: "That slot is already taken. Offer the owner another time." });
      }
      if (err instanceof OutsideBusinessHoursError) {
        return JSON.stringify({
          error: "That time is outside the opening hours. Tell the owner — they can change the hours with set_hours if they meant to.",
        });
      }
      throw err;
    }
    return JSON.stringify({ booked: true, customer: target!.name ?? target!.phone, service: service.name, date, time });
  }

  if (name === "add_customer") {
    const phone = normalizeOwnerPhone(String(input.phone ?? ""));
    if (!phone) return JSON.stringify({ error: "That phone number does not look right — ask the owner to repeat it." });
    const existing = await prisma.customer.findUnique({
      where: { businessId_phone: { businessId, phone } },
      select: { name: true },
    });
    if (existing) {
      return JSON.stringify({ error: `${existing.name ?? "Someone"} is already saved with that number.` });
    }
    await prisma.customer.create({
      data: {
        businessId,
        phone,
        name: String(input.name ?? "").trim() || null,
        notes: input.note ? String(input.note).trim() : null,
      },
    });
    return JSON.stringify({
      added: true,
      note: "They are on the customer list. When they first message the bot it will already know their name.",
    });
  }

  if (name === "set_customer_note") {
    const target = await findCustomerByNameOrPhone(businessId, String(input.customerName ?? ""));
    if (!target) return JSON.stringify({ error: `No customer matching "${input.customerName}".` });
    await prisma.customer.update({ where: { id: target.id }, data: { notes: String(input.note ?? "").trim() } });
    return JSON.stringify({ saved: true, customer: target.name ?? target.phone });
  }

  if (name === "message_customer") {
    const target = await findCustomerByNameOrPhone(businessId, String(input.customerName ?? ""));
    if (!target) return JSON.stringify({ error: `No customer matching "${input.customerName}".` });
    const text = String(input.text ?? "").trim();
    if (!text) return JSON.stringify({ error: "Ask the owner what to say." });

    const gate = confirmFirst(input, { to: target.name ?? target.phone, text }, "willSend");
    if (gate) return gate;

    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { whatsappPhoneNumberId: true, whatsappAccessToken: true },
    });
    if (!biz.whatsappPhoneNumberId || !biz.whatsappAccessToken) {
      return JSON.stringify({ error: "WhatsApp is not connected, so nothing can be sent." });
    }
    try {
      await sendWhatsAppMessage({
        phoneNumberId: biz.whatsappPhoneNumberId,
        accessToken: decryptSecret(biz.whatsappAccessToken),
        to: target.phone,
        text,
      });
      return JSON.stringify({ sent: true, to: target.name ?? target.phone });
    } catch (err) {
      // Almost always the 24h window. Said plainly so the owner phones instead of assuming it went.
      return JSON.stringify({
        error:
          "WhatsApp would not deliver it — most likely because this customer has not written in the last 24 hours. Tell the owner it was NOT sent.",
      });
    }
  }

  if (name === "create_discount_code") {
    const code = String(input.code ?? "").trim().toUpperCase();
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(code)) {
      return JSON.stringify({ error: "A code should be Latin letters and digits, e.g. WELCOME10." });
    }
    const percent = input.percent === undefined ? null : Number(input.percent);
    const fixedIls = input.fixedIls === undefined ? null : Number(input.fixedIls);
    if ((percent === null) === (fixedIls === null)) {
      return JSON.stringify({ error: "Ask the owner whether it is a percentage or a shekel amount." });
    }
    if (percent !== null && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      return JSON.stringify({ error: "A percentage discount has to be between 1 and 100." });
    }
    if (fixedIls !== null && (!Number.isFinite(fixedIls) || fixedIls <= 0)) {
      return JSON.stringify({ error: "Ask the owner for the amount off, in shekels." });
    }

    const existing = await prisma.customerCoupon.findUnique({
      where: { businessId_code: { businessId, code } },
      select: { id: true },
    });
    if (existing) return JSON.stringify({ error: `There is already a code called ${code}.` });

    const gate = confirmFirst(
      input,
      { code, discount: percent !== null ? `${percent}%` : `₪${fixedIls}`, maxUses: input.maxUses ?? null },
      "willCreate"
    );
    if (gate) return gate;

    await prisma.customerCoupon.create({
      data: {
        businessId,
        code,
        discountType: percent !== null ? "percent" : "fixed",
        discountValue: Math.round((percent ?? fixedIls)!),
        maxUses: input.maxUses ? Math.round(Number(input.maxUses)) : null,
      },
    });
    return JSON.stringify({
      created: true,
      code,
      note: "Customers can use it by typing the code to the bot. Share it however you like — the bot recognises it.",
    });
  }

  if (name === "manager_help") {
    // Discoverability is the whole point: an owner who does not know these exist has none of them.
    // Returned as data for the model to phrase naturally rather than a canned block, so it reads
    // like an answer to what they actually asked.
    return JSON.stringify({
      youCanAskMeTo: {
        היומן: [
          "'מה יש לי היום?' · 'מי מגיע מחר?'",
          "'תקבע לדנה תספורת מחר ב-10' — גם ללקוחה חדשה, רק תגיד לי את הטלפון",
          "'תבטל את התור של יוסי מחר' — אני גם מודיע לו",
          "'תחסום לי מחר 14:00 עד 16:00'",
        ],
        "שעות ומחירים": [
          "'מה שעות הפתיחה שלי?' · 'תשנה יום שלישי ל-9 עד 5' · 'אני סגור בשבת'",
          "'כמה עולה צבע?' · 'תעלה את הצבע ל-250' · 'תוסיף שירות פן, 80 שקל, 30 דקות'",
          "'תוסיף עובדת בשם מיכל'",
        ],
        לקוחות: [
          "'תכתבי לדנה שאני מאחרת ברבע שעה'",
          "'תוסיף לקוחה חדשה: רותי, 0501234567'",
          "'תרשום על דנה שהיא מעדיפה בוקר'",
          "'מי ברשימת המתנה?'",
        ],
        כסף: [
          "'תוציא קבלה לדנה על 200 שקל, תספורת'",
          "'כמה הכנסתי החודש?'",
          "'תפתח קוד הנחה WELCOME10 של 10 אחוז'",
        ],
        אחר: ["'תכבה את הבוט' / 'תדליק את הבוט'", "'מה השאלות הנפוצות?' · 'אם שואלים על חניה תגיד שיש חניון'"],
      },
      note:
        "Tell the owner these in their own language, briefly and in a friendly way, and mention they can just write naturally — no commands or menus. Do not read the list back verbatim as a menu unless they asked for a full list.",
    });
  }

  if (name === "day_schedule") {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = biz.timezone || "Asia/Jerusalem";
    const date = (input.date as string | undefined) || todayIn(tz);
    const entries = await daySchedule(businessId, date, tz);
    return JSON.stringify({
      date,
      count: entries.length,
      appointments: entries,
      note:
        entries.length === 0
          ? "Nothing booked that day. Say so plainly."
          : "Read these out in order, briefly. pending_payment means the slot is held but the deposit has not been paid yet — worth flagging.",
    });
  }

  if (name === "business_summary") {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const summary = await businessSummary(businessId, biz.timezone || "Asia/Jerusalem");
    return JSON.stringify({
      ...summary,
      note: "Revenue is net of any discount codes actually used, so it is what was really taken, not list prices.",
    });
  }

  if (name === "block_time") {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = biz.timezone || "Asia/Jerusalem";
    const date = String(input.date ?? "");
    const from = String(input.startTime ?? "");
    const to = String(input.endTime ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) {
      return JSON.stringify({ error: "Ask the owner for the date and the start and end times." });
    }

    const start = parseBookingTime(`${date}T${from.padStart(5, "0")}:00`, tz);
    const end = parseBookingTime(`${date}T${to.padStart(5, "0")}:00`, tz);
    if (end.getTime() <= start.getTime()) {
      return JSON.stringify({ error: "The end time is not after the start time — ask the owner to clarify." });
    }

    try {
      // Dry run first: this both validates the window and surfaces clashes before anything is
      // written, so the confirmation the owner is asked for is about a window we know is free.
      const clashCheck = await blockTime({ businessId, start, end, timezone: tz, reason: undefined, dryRun: true });
      void clashCheck;
    } catch (err) {
      if (err instanceof BlockOverlapError) {
        return JSON.stringify({
          error: "There are bookings inside that window.",
          conflicts: err.conflicts,
          note: "Do not block over these. Tell the owner what clashes and ask what they want to do — they may want to cancel those first.",
        });
      }
      throw err;
    }

    if (input.confirmed !== true) {
      return JSON.stringify({
        needsConfirmation: true,
        willBlock: { date, from, to, reason: input.reason ?? null },
        note: "Read this back and ask the owner to confirm. Nothing is blocked yet. Only then call again with confirmed:true.",
      });
    }

    try {
      await blockTime({ businessId, start, end, reason: input.reason as string | undefined, timezone: tz });
      return JSON.stringify({ blocked: true, date, from, to, note: "The bot will no longer offer that time." });
    } catch (err) {
      if (err instanceof BlockOverlapError) {
        // Something was booked between the preview and the confirmation.
        return JSON.stringify({ error: "A booking was just made inside that window.", conflicts: err.conflicts });
      }
      throw err;
    }
  }

  if (name === "cancel_booking") {
    const customer = await findCustomerByNameOrPhone(businessId, String(input.customerName ?? ""));
    if (!customer) {
      return JSON.stringify({ error: `No customer matching "${input.customerName}". Ask the owner for their phone number.` });
    }

    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = biz.timezone || "Asia/Jerusalem";

    const dateFilter = input.date
      ? (() => {
          const { start, end } = dayBounds(String(input.date), tz);
          return { gte: start, lt: end };
        })()
      : { gte: new Date() };

    const booking = await prisma.appointment.findFirst({
      where: { businessId, customerId: customer.id, status: "confirmed", startTime: dateFilter },
      include: { service: true },
      orderBy: { startTime: "asc" },
    });
    if (!booking) {
      return JSON.stringify({
        error: input.date
          ? `${customer.name ?? customer.phone} has no confirmed booking on that date.`
          : `${customer.name ?? customer.phone} has no upcoming booking.`,
      });
    }

    const when = new Intl.DateTimeFormat("he-IL", {
      timeZone: tz, weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(booking.startTime);

    if (input.confirmed !== true) {
      return JSON.stringify({
        needsConfirmation: true,
        willCancel: { customer: customer.name ?? customer.phone, service: booking.service.name, when },
        note: "Read this back and ask the owner to confirm. Nothing is cancelled yet, and the customer has not been told anything.",
      });
    }

    await cancelAppointmentById(businessId, booking.id);
    const told = await notifyCustomerOfCancellation({
      businessId,
      customerPhone: customer.phone,
      serviceName: booking.service.name,
      when,
    });
    return JSON.stringify({
      cancelled: true,
      customerNotified: told,
      note: told
        ? "The slot is free and the customer has been told."
        : "The slot is free, but the customer could NOT be messaged — tell the owner to contact them directly.",
    });
  }

  if (name === "issue_receipt") {
    const amountIls = Number(input.amountIls);
    if (!Number.isFinite(amountIls) || amountIls <= 0) {
      return JSON.stringify({ error: "Ask the owner for the amount received, in shekels." });
    }
    const description = String(input.description ?? "").trim();
    if (!description) return JSON.stringify({ error: "Ask the owner what the payment was for." });

    const customer = await findCustomerByNameOrPhone(businessId, String(input.customerName ?? ""));
    if (!customer) {
      return JSON.stringify({
        error: `No customer matching "${input.customerName}". Ask the owner for the customer's phone number, or tell them to add the customer in the dashboard first.`,
      });
    }

    // The confirmation gate is code, not prompting. A receipt is an accounting document that cannot
    // be deleted — only credited — so "the model was told to ask first" is not good enough. The
    // first call always returns a preview and issues nothing.
    if (input.confirmed !== true) {
      return JSON.stringify({
        needsConfirmation: true,
        willIssue: {
          customer: customer.name ?? customer.phone,
          amountIls,
          description,
        },
        note: "Read these details back to the owner and ask them to confirm. Only if they say yes, call issue_receipt again with the same values and confirmed:true. Nothing has been issued yet.",
      });
    }

    try {
      const receipt = await issueAndSendReceipt({
        businessId,
        amountIls,
        description,
        customerName: customer.name?.trim() || "לקוח",
        customerPhone: customer.phone,
      });
      return JSON.stringify({
        issued: true,
        documentUrl: receipt.documentUrl,
        delivery: receipt.delivery,
        note: DELIVERY_MESSAGE_HE[receipt.delivery] + " Give the owner the link.",
      });
    } catch (err) {
      if (err instanceof NoInvoiceProviderError) {
        return JSON.stringify({
          error: "No invoicing provider is connected. Tell the owner to connect one on the Payments page in the dashboard.",
        });
      }
      throw err;
    }
  }

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

  if (name === "check_coupon") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);
    try {
      const quote = await quoteCustomerCoupon({
        businessId,
        code: input.code as string,
        serviceId: service.id,
        servicePriceIls: Math.round(service.priceCents / 100),
        customerPhone,
      });
      return JSON.stringify({
        valid: true,
        code: quote.code,
        discountIls: quote.discountIls,
        originalPriceIls: Math.round(service.priceCents / 100),
        finalPriceIls: quote.finalPriceIls,
        ...(quote.description ? { description: quote.description } : {}),
        note: "Tell the customer the discounted price. Pass this exact code as couponCode when you call book_appointment.",
      });
    } catch (err) {
      if (err instanceof CustomerCouponError) {
        // The reason is returned in Hebrew because it is the sentence the customer hears — the
        // model relaying an English enum would translate it inconsistently every time.
        return JSON.stringify({ valid: false, reason: CUSTOMER_COUPON_FAILURE_HE[err.reason] });
      }
      throw err;
    }
  }

  if (name === "book_appointment") {
    const { service, services } = await findServiceByName(businessId, input.serviceName as string);
    if (!service) return unknownServiceError(services);
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        timezone: true, name: true,
        depositEnabled: true, depositAmountIls: true, depositHoldMinutes: true,
        paymentProvider: true, paymentApiKey: true, paymentApiSecret: true, paymentPageUid: true, paymentWebhookSecret: true,
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

    // Shared with the public booking page (booking/deposits.ts). It used to be decided here and
    // nowhere else, which is how the website booking form ended up giving away free confirmed slots
    // at salons that required a deposit over WhatsApp.
    const depositRequired = isDepositRequired(biz);

    const startTime = parseBookingTime(input.startTime as string, biz.timezone || "Asia/Jerusalem");

    // Already booked by this same customer? Return it instead of trying again.
    //
    // The model re-calls this tool for anything that sounds like it concerns the appointment — a
    // real customer typed "אפשר לשלם?" right after booking and got told their slot had just been
    // taken, because the conflict it hit was their own booking. From where they sat, the bot
    // cancelled their appointment for no reason.
    const alreadyBooked = await prisma.appointment.findFirst({
      where: {
        businessId,
        serviceId: service.id,
        startTime,
        status: { in: SLOT_BLOCKING_STATUSES },
        customer: { phone: customerPhone },
      },
      include: { service: true },
    });
    if (alreadyBooked) {
      return JSON.stringify({
        alreadyBooked: true,
        status: alreadyBooked.status,
        note: "This customer already has this exact appointment — it was NOT double-booked and nothing changed. Do not tell them the slot is taken. Answer whatever they actually asked.",
        ...(alreadyBooked.depositPaymentUrl ? { paymentUrl: alreadyBooked.depositPaymentUrl } : {}),
      });
    }

    // Re-quoted here, never trusted from the model: the tool call that validated it happened turns
    // ago, the code may have been exhausted since, and the model can pass a code the customer only
    // wished for. A code that no longer holds books at full price rather than failing the booking —
    // the customer chose a time, and losing the slot over a promotion is the worse outcome.
    let couponQuote: Awaited<ReturnType<typeof quoteCustomerCoupon>> | null = null;
    if (input.couponCode) {
      couponQuote = await quoteCustomerCoupon({
        businessId,
        code: input.couponCode as string,
        serviceId: service.id,
        servicePriceIls: Math.round(service.priceCents / 100),
        customerPhone,
      }).catch(() => null);
    }

    // The deposit never exceeds what is actually owed: a ₪50 deposit on a service discounted to
    // ₪40 would charge the customer more than the visit costs.
    const depositBiz = couponQuote
      ? { ...biz, depositAmountIls: Math.min(biz.depositAmountIls, couponQuote.finalPriceIls) }
      : biz;

    let appointment;
    try {
      appointment = await createAppointment({
        businessId,
        serviceId: service.id,
        customerPhone,
        customerName,
        startTime,
        overrideDurationMin: input.durationMin as number | undefined,
        staffId: staffResolution.staffId ?? null,
        ...(depositRequired ? depositHoldFields(depositBiz) : {}),
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

    // Consumed only now that the appointment exists, so a booking that failed for any other reason
    // leaves the promotion untouched. A use that cannot be claimed (someone took the last one in
    // between) leaves the booking standing at the quoted price — the discrepancy is visible to the
    // owner on the coupons screen, which is the right place for it.
    if (couponQuote) {
      const claimed = await redeemCustomerCoupon({
        couponId: couponQuote.couponId,
        customerPhone,
        appointmentId: appointment.id,
        discountIls: couponQuote.discountIls,
      });
      if (claimed) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { couponCode: couponQuote.code, couponDiscountIls: couponQuote.discountIls },
        });
      }
    }

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
        const paymentUrl = await createDepositLink({
          businessId,
          biz,
          appointmentId: appointment.id,
          serviceName: service.name,
          customerName,
          customerPhone,
        });
        return JSON.stringify({
          booked: false,
          depositRequired: true,
          depositAmountIls: biz.depositAmountIls,
          paymentUrl,
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
        await releaseHold(appointment.id);
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
    // Holds are included, not just confirmed bookings. A customer who booked somewhere that takes
    // deposits has a real appointment as far as they are concerned — the slot is theirs and the
    // clock is running — but filtering to "confirmed" meant asking "what do I have booked?"
    // answered "nothing", which reads as their booking having failed.
    const appointments = await prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ["confirmed", "pending_payment"] },
        customer: { phone: customerPhone },
        startTime: { gte: new Date() },
      },
      include: { service: true },
      orderBy: { startTime: "asc" },
    });
    return JSON.stringify({
      appointments: appointments.map((a) => ({
        service: a.service.name,
        startTime: a.startTime,
        ...(a.status === "pending_payment"
          ? {
              awaitingPayment: true,
              depositAmountIls: a.depositAmountIls,
              holdExpiresAt: a.depositExpiresAt,
              note: "Held, not confirmed — the deposit is still unpaid and the slot is released when the hold expires. Use get_payment_link if they want to pay now.",
            }
          : {}),
      })),
    });
  }

  /**
   * "Can I pay?" had no tool behind it.
   *
   * The model's only option was book_appointment, which finds the slot already held and answers as
   * if something went wrong — a real customer typed "אפשר לשלם?" right after booking and was told
   * their slot had just been taken. The alreadyBooked branch was patched to re-surface the link,
   * but only if the model happened to route there, and only for that exact service and time.
   *
   * This asks the real question instead: does this customer have an unpaid hold, and what is its
   * link. No new link is minted — the provider already issued one against this appointment id, and
   * a second would leave two live payment pages for one slot.
   */
  if (name === "get_payment_link") {
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const tz = biz.timezone || "Asia/Jerusalem";
    const pending = await prisma.appointment.findFirst({
      where: {
        businessId,
        customer: { phone: customerPhone },
        status: "pending_payment",
        depositStatus: "pending",
        startTime: { gte: new Date() },
      },
      orderBy: { startTime: "asc" },
      include: { service: true },
    });

    if (!pending) {
      return JSON.stringify({
        error:
          "This customer has no appointment awaiting payment. If they think they booked, use list_my_appointments to check what they actually have before saying anything about payment.",
      });
    }
    if (!pending.depositPaymentUrl) {
      return JSON.stringify({
        error:
          "The hold exists but no payment link was ever generated for it. Apologize, and use request_human_followup so the business can sort it out — do not invent a link or an amount.",
      });
    }

    // Same shape book_appointment returns, so the model describes a held slot the same way here as
    // it did when the hold was created.
    const heDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const { dayOfWeek } = instantPartsInTz(pending.startTime, tz);
    return JSON.stringify({
      paymentUrl: pending.depositPaymentUrl,
      depositAmountIls: pending.depositAmountIls,
      serviceName: pending.service.name,
      dayOfWeek: `יום ${heDays[dayOfWeek]}`,
      localTime: pending.startTime.toLocaleTimeString("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
      // The hold is the thing that expires, so the deadline is the useful part of the answer.
      expiresAt: pending.depositExpiresAt,
    });
  }

  if (name === "cancel_appointment") {
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const tz = biz.timezone || "Asia/Jerusalem";
    const target = parseBookingTime(input.startTime as string, tz);
    // A hold is cancellable too. It was not, so a customer who changed their mind before paying had
    // no way to say so — the slot stayed blocked for the whole hold window and the salon kept
    // waiting on a deposit that was never coming.
    const appointment = await prisma.appointment.findFirst({
      where: {
        businessId,
        status: { in: ["confirmed", "pending_payment"] },
        customer: { phone: customerPhone },
        startTime: target,
      },
      include: { service: true, customer: true },
    });
    if (!appointment) return JSON.stringify({ error: "No matching appointment found" });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "cancelled" } });
    await releaseCustomerCoupon(appointment.id);
    if (appointment.calendarEventId) {
      deleteCalendarEvent(businessId, appointment.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
    }
    // Offer the freed slot to anyone waiting for this service.
    notifyWaitlist(businessId, appointment.serviceId, appointment.service.name, appointment.startTime).catch((err) =>
      console.error("[waitlist] Notification failed:", err)
    );

    // The owner was told when this booking was made and is told when a deposit lands, but nothing
    // told them it had been cancelled — so a salon learned its 3pm was free only by looking. That
    // is the slot they could still sell, and the customer they might want to call.
    //
    // Unpaid holds are the exception: nothing announces a hold when it is created, so announcing
    // its cancellation would report the disappearance of something the owner never knew existed.
    const wasHold = appointment.status === "pending_payment";
    const depositPaid = appointment.depositStatus === "paid";
    const customerLabel = appointment.customer.name
      ? `${appointment.customer.name} (${appointment.customer.phone})`
      : appointment.customer.phone;
    const when = appointment.startTime.toLocaleString("he-IL", {
      timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
    if (!wasHold) notifyOwner(
      businessId,
      `❌ תור בוטל\nלקוח: ${customerLabel}\nשירות: ${appointment.service.name}\nמועד: ${when}` +
        // Money already taken is the part the owner has to decide about, so it cannot be a
        // footnote. We deliberately do not refund automatically: the salon's cancellation policy
        // is its own, and quietly refunding — or quietly keeping — would both be decisions we
        // don't get to make on their behalf.
        (depositPaid ? `\n\n⚠️ שולמה מקדמה של ₪${appointment.depositAmountIls ?? "?"} — יש להחליט לגבי החזר לפי מדיניות הביטולים שלכם.` : "")
    );

    return JSON.stringify({
      cancelled: true,
      // Surfaced so the reply can be honest about the money instead of silently ignoring it. The
      // model is told to acknowledge it and point at the business, not to promise a refund — the
      // policy is the salon's and the bot has no way to issue one.
      ...(depositPaid
        ? {
            depositPaid: true,
            depositAmountIls: appointment.depositAmountIls,
            refundGuidance:
              "A deposit was already paid for this appointment. Acknowledge it, tell the customer the business will be in touch about it according to their cancellation policy, and do NOT promise a refund or a specific amount.",
          }
        : {}),
    });
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
    await releaseCustomerCoupon(existing.id);
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

      // A move is two facts the owner needs — a slot freed and a slot taken — and neither was
      // being sent. Reported as one message rather than a cancel plus a book, because that is what
      // actually happened and two alerts would read as two separate customers.
      const movedLabel = customerName ? `${customerName} (${customerPhone})` : customerPhone;
      const fmt = (d: Date) =>
        d.toLocaleString("he-IL", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      notifyOwner(
        businessId,
        `🔄 תור הוזז\nלקוח: ${movedLabel}\nשירות: ${service.name}\nמ: ${fmt(existing.startTime)}\nל: ${fmt(appointment.startTime)}`
      );

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

  if (name === "find_units_for_guests") {
    const guests = Math.round(Number(input.guestCount));
    if (!Number.isFinite(guests) || guests < 1) {
      return JSON.stringify({ error: "guestCount must be a positive number of people." });
    }
    const units = await prisma.service.findMany({
      where: { businessId },
      orderBy: { priceCents: "asc" },
      select: { name: true, priceCents: true, maxGuests: true },
    });
    const priced = (u: { name: string; priceCents: number }) => ({ name: u.name, priceIls: u.priceCents / 100 });

    const fits = units.filter((u) => u.maxGuests != null && u.maxGuests >= guests);
    const tooSmall = units.filter((u) => u.maxGuests != null && u.maxGuests < guests);
    // A unit with no occupancy set is genuinely unknown, not "unlimited" and not "excluded" —
    // reported separately so the reply can defer to the owner instead of silently ruling it out.
    const unknown = units.filter((u) => u.maxGuests == null);

    return JSON.stringify({
      guestCount: guests,
      // Already sorted by price, so the head is the cheapest that fits — the thing to offer first.
      recommended: fits[0] ? priced(fits[0]) : null,
      alsoFit: fits.slice(1).map(priced),
      tooSmall: tooSmall.map((u) => u.name),
      capacityUnknown: unknown.map((u) => u.name),
      note: fits.length === 0
        ? (unknown.length > 0
          ? "No unit with a stated capacity fits this party. Do NOT rule out the units under capacityUnknown — say their suitability has to be confirmed with the owner."
          : "No unit fits this party. Say so plainly and offer to pass the request to the owner.")
        : "Offer `recommended` first. Mention `alsoFit` only as further options, never instead of it. Never offer anything from `tooSmall`.",
    });
  }

  if (name === "save_customer_name") {
    const given = (input.customerName as string | undefined)?.trim();
    if (!given) return JSON.stringify({ error: "No name was provided — do not call this without one." });
    await saveCustomerName(businessId, customerPhone, given);
    // Nothing for the customer to be told: they just said their name, and reading it back is the
    // narration BREVITY_RULE exists to stop.
    return JSON.stringify({ saved: true });
  }

  if (name === "request_booking_callback") {
    const givenName = (input.customerName as string | undefined)?.trim();
    // Inquiry businesses never call book_appointment, and that is the only other place a name is
    // written — so for a B&B the name the customer just gave went into the owner's alert and was
    // then thrown away, leaving every guest nameless in the dashboard forever.
    if (givenName) await saveCustomerName(businessId, customerPhone, givenName);

    const label = givenName ?? customerPhone;
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

/**
 * Upsert, because someone who has only ever asked questions may have no Customer row yet — and in
 * inquiry mode that is most of them, since no booking ever creates one.
 */
async function saveCustomerName(businessId: string, phone: string, name: string): Promise<void> {
  await prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone } },
    update: { name },
    create: { businessId, phone, name },
  });
}

const AI_UNAVAILABLE_HE = "מצטער, הבוט אינו זמין כרגע. נסה שוב בעוד כמה דקות, או צור קשר ישיר עם העסק.";

/**
 * A thread counts as a new conversation once it has been quiet for this long.
 *
 * Matches WhatsApp's own 24-hour session window, which is the boundary the customer already feels:
 * past it they are starting a conversation, not continuing one. Keying the greeting off "this
 * number has never written before" instead meant a returning customer saw the opening message and
 * its buttons exactly once in their life, and the owner could never see them again while testing.
 */
const NEW_CONVERSATION_GAP_MS = 24 * 60 * 60 * 1000;

/** Whether this incoming message opens a conversation rather than continuing one. Exported for
 * testing: it decides whether the greeting button and quick replies are attached. */
export function opensNewConversation(history: Turn[], now: Date = new Date()): boolean {
  // Typed turns only. A phone call is written into this same history deliberately — voiceRoutes
  // /transcript stores it under the caller's number so the two channels read as one thread — but a
  // call is not a WhatsApp message, and counting it as one is a bug the owner hit on their own
  // line: they phoned, then wrote "שלום" hours later, and got neither the opening message nor the
  // greeting button nor the quick replies, because the last "turn" was something they had said out
  // loud minutes earlier.
  //
  // The channel column exists for exactly this class of mistake — its comment in voiceRoutes says a
  // spoken turn "must never be mistaken for an inbound WhatsApp message" — but Turn dropped the
  // field before any decision code could read it.
  //
  // Only this flag is filtered. The history handed to the model keeps the call, which is the point
  // of recording it: the greeting goes out, and the reply underneath it still knows what was
  // discussed on the phone.
  const last = [...history].reverse().find((t) => t.channel !== "voice");
  if (!last) return true; // nothing typed before — genuinely new, reset by the owner, or voice-only
  if (!last.at) return false; // undated turn: assume mid-conversation rather than re-greet
  return now.getTime() - last.at.getTime() > NEW_CONVERSATION_GAP_MS;
}

export async function handleIncomingMessage(businessId: string, customerPhone: string, messageText: string): Promise<BotResult> {
  const history = await getHistory(businessId, customerPhone);
  // Read this now, not at the return. conversationStore caches turns and hands back the array
  // itself, and appendTurn below pushes into that same array — so by the end of this function
  // `history` always holds the two turns we just wrote, and `length === 0` is never true. The
  // greeting button and quick replies are gated on this flag, which is why neither ever appeared.
  const isFirstReply = opensNewConversation(history);

  /**
   * The owner's greeting, sent verbatim as its own message ahead of the reply.
   *
   * Folded into the reply it was paraphrased, shortened, or dropped entirely once the model had an
   * actual question to answer — a new customer asking about prices got straight pricing and never
   * saw the welcome the owner wrote. As a separate message it goes out exactly as written.
   *
   * Not sent when it still contains a [placeholder]: those are instructions to the model to fill in
   * ("[פירוט של כל הצימרים]"), and sending the text raw would put the brackets in front of a real
   * customer. Those greetings keep the old behaviour, where the model composes them into the reply.
   */
  const greetingRow = isFirstReply
    ? await prisma.business.findUnique({ where: { id: businessId }, select: { botGreeting: true } })
    : null;
  const rawGreeting = greetingRow?.botGreeting?.trim();
  const greetingText = rawGreeting && !/\[[^\]]+\]/.test(rawGreeting) ? rawGreeting : undefined;

  const system = await buildSystemPrompt(businessId, customerPhone, Boolean(greetingText));

  // "inquiry" businesses (e.g. B&B) have no live booking engine — the bot answers info and hands
  // booking intent to the owner, so it gets a reduced tool set with no slot/booking tools.
  const biz = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { bookingModel: true, businessType: true, aiProvider: true, aiModel: true, timezone: true, aiTemperature: true },
  });
  const baseTools = biz.bookingModel === "inquiry" ? inquiryTools : tools;
  // Only where a "service" is something people sleep in. A salon has no party size to fit, and the
  // tool would be one more thing to weigh on every call for no benefit.
  const withUnits = biz.businessType === "bnb" ? [...baseTools, unitsForGuestsTool] : baseTools;

  // Manager tools are offered only to the owner's own number, as asserted by Meta's signed webhook
  // envelope. This keeps them out of a customer's prompt entirely — the model cannot offer, hint at
  // or hallucinate a capability it was never shown. It is NOT what makes them safe: runTool
  // re-checks the same thing at execution, so a model that invents the call still gets refused.
  const { isManager, businessName } = await checkManager(businessId, customerPhone);
  const activeTools = isManager ? [...withUnits, ...managerTools] : withUnits;

  // The first time an owner writes to their own bot, tell them what it can do for them. Without
  // this the capability is invisible: nobody thinks to ask their booking bot to block a Tuesday.
  // Claimed with a conditional update so two messages arriving together cannot both send it.
  let introduceManagerTools = false;
  if (isManager) {
    const claimed = await prisma.business.updateMany({
      where: { id: businessId, managerIntroSentAt: null },
      data: { managerIntroSentAt: new Date() },
    });
    introduceManagerTools = claimed.count > 0;
  }

  // Said in the system prompt rather than left for the model to infer: without it the bot greets
  // the owner as a customer and offers to book them an appointment at their own salon.
  const systemForTurn = isManager
    ? {
        ...system,
        volatile:
          system.volatile +
          `\n\n=== YOU ARE TALKING TO THE OWNER OF ${businessName ?? "THIS BUSINESS"} ===\n` +
          "This is the number registered on the account, verified by WhatsApp itself. This is NOT a customer.\n\n" +
          "Talk to them completely differently from a customer:\n" +
          "- No customer greeting, no 'how can I help you book an appointment', no sales tone. They own the place.\n" +
          "- Be brief and practical, like a capable assistant who already knows the business.\n" +
          "- They write naturally. There are no commands or menus — understand what they mean and do it.\n" +
          "- Nearly everything they can do in the dashboard, they can do here: see and change the schedule, " +
          "book and cancel for customers, block time off, set opening hours, change prices and services, manage " +
          "staff and FAQ answers, message a customer, issue receipts, create discount codes, see revenue, and " +
          "turn the customer bot on or off.\n" +
          "- Read the current state before changing it (show_settings) so you can tell them what it is now — " +
          "an owner changing Tuesday's hours usually wants to hear what they are first.\n" +
          "- If they greet you, ask what you can do, seem unsure, or ask for something near but not exactly " +
          "one of your abilities, call manager_help and tell them — most owners do not yet know any of this " +
          "is possible from WhatsApp, so surfacing it is genuinely useful rather than noise.\n" +
          "- Anything that changes money or a customer's booking is confirmed with them first. The tools " +
          "enforce this; never try to skip it, and never confirm on their behalf." +
          (introduceManagerTools
            ? "\n\nTHIS IS THE FIRST TIME THEY HAVE WRITTEN TO THEIR OWN BOT. Whatever else you answer, open by " +
              "telling them warmly and briefly that they can run the business from right here — call manager_help " +
              "and weave two or three concrete examples into a sentence or two. Do not paste a menu. Then answer " +
              "what they actually asked."
            : ""),
      }
    : system;

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

  // "auto" is a meta-choice, not a real backend: it picks Claude or DeepSeek per-message from the
  // same tier the chosen provider then uses to pick its own cheap/smart model — so a business set
  // to "auto" gets DeepSeek only for the same narrow class of message that would get Haiku under
  // "Claude, auto model", and Claude Sonnet for everything else. modelOverride is dropped for
  // "auto" because a pinned model id from one provider is meaningless once the provider itself is
  // decided per-message.
  const isMetaAuto = biz.aiProvider === "auto";
  const modelOverride = isMetaAuto ? null : biz.aiModel;
  let provider = getAiProvider(isMetaAuto ? (tier === "cheap" ? "deepseek" : "anthropic") : biz.aiProvider);
  let model = provider.resolveModel(tier, modelOverride);

  console.log(`[bot] provider=${provider.key} model=${model} business=${businessId} phone=${customerPhone} msg="${messageText.slice(0, 80)}"`);

  async function call(currentModel: string) {
    const res = await provider.send({
      model: currentModel,
      system: systemForTurn,
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
    // A worse reply beats no reply. In "auto" mode the other backend is a different account and
    // API surface entirely, so a failure (key revoked, model disabled, outage) is worth retrying
    // there rather than assuming the whole request is doomed. Outside "auto", the only fallback
    // available is this same provider's cheap tier — which does nothing if a model override pins
    // both tiers to the same id, or if the failure is account-level rather than model-level.
    let fallbackProvider = provider;
    let fallbackModel: string;
    if (isMetaAuto) {
      fallbackProvider = getAiProvider(provider.key === "anthropic" ? "deepseek" : "anthropic");
      fallbackModel = fallbackProvider.resolveModel(tier, null);
    } else {
      fallbackModel = provider.resolveModel("cheap", modelOverride);
    }
    const canFallBack = isMetaAuto ? true : fallbackModel !== model;
    console.error(
      `[bot] ${provider.key} call failed on ${model}${canFallBack ? ` — falling back to ${fallbackProvider.key}/${fallbackModel}` : ""}:`,
      err instanceof ProviderCallError ? err.message : err
    );
    captureError(err, { businessId, customerPhone, model, provider: provider.key });

    if (!canFallBack) return { text: AI_UNAVAILABLE_HE };
    try {
      provider = fallbackProvider;
      model = fallbackModel;
      if (!isMetaAuto) tier = "cheap";
      response = await call(model);
    } catch (fallbackErr) {
      console.error(`[bot] fallback to ${provider.key}/${model} also failed:`, fallbackErr instanceof ProviderCallError ? fallbackErr.message : fallbackErr);
      captureError(fallbackErr, { businessId, customerPhone, model, provider: provider.key, phase: "fallback" });
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
      // but only if the business hasn't pinned a specific model override, in which case there's no
      // cheap/smart pair to escalate between. In "auto" mode, cheap tier means the request went to
      // DeepSeek, so escalating means switching provider too, not just picking a different model
      // from the same one.
      if (result.includes('"error"') && tier === "cheap" && !modelOverride) {
        hadToolError = true;
        tier = "smart";
        if (isMetaAuto) provider = getAiProvider("anthropic");
        model = provider.resolveModel(tier, modelOverride);
        console.log(`[bot] tool error detected — escalating to ${provider.key}/${model}`);
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
    isFirstReply,
    greetingText,
  };
}
