import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTurn, getHistory, type Turn } from "./conversationStore.js";
import { findAvailableSlots, createAppointment, SlotUnavailableError, type AvailableSlot } from "../booking/availability.js";
import { parseBookingTime } from "../lib/timezone.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "../lib/crypto.js";
import { syncAppointmentToCalendar } from "../lib/googleCalendar.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    description: "Find open appointment slots for a given service on a given date. If the customer requests a longer session (e.g. multiple hours), pass durationMin.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the service, matching a known service name from the system prompt" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        durationMin: { type: "number", description: "Optional override for session length in minutes (e.g. 120 for 2 hours)" },
      },
      required: ["serviceName", "date"],
    },
  },
  {
    name: "book_appointment",
    description: "Book a confirmed slot. Only call this after the customer has explicitly chosen a specific time from check_availability results.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        startTime: { type: "string", description: "ISO 8601 start time, must come from a prior check_availability result" },
        customerName: { type: "string", description: "Customer's name if known" },
        durationMin: { type: "number", description: "Same durationMin passed to check_availability, if any" },
      },
      required: ["serviceName", "startTime"],
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

async function notifyOwner(businessId: string, message: string) {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
    });
    if (!business?.notificationPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) return;
    const accessToken = decryptSecret(business.whatsappAccessToken);
    await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: business.notificationPhone, text: message });
  } catch (err) {
    console.error("Owner notification failed (non-fatal):", err);
  }
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
    const slots = await findAvailableSlots(businessId, service.id, new Date(input.date as string), input.durationMin as number | undefined);
    lastOfferedSlots.value = slots.slice(0, 6);
    return JSON.stringify({ slots: lastOfferedSlots.value });
  }

  if (name === "book_appointment") {
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: input.serviceName as string, mode: "insensitive" } },
    });
    if (!service) {
      const all = await prisma.service.findMany({ where: { businessId }, select: { name: true } });
      return JSON.stringify({ error: "Unknown service", availableServices: all.map((s) => s.name) });
    }
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    let appointment;
    try {
      appointment = await createAppointment({
        businessId,
        serviceId: service.id,
        customerPhone,
        customerName: input.customerName as string | undefined,
        startTime: parseBookingTime(input.startTime as string, biz.timezone || "Asia/Jerusalem"),
        overrideDurationMin: input.durationMin as number | undefined,
      });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return JSON.stringify({ error: "Slot no longer available — it was just taken. Call check_availability again to offer other times." });
      }
      throw err;
    }
    lastOfferedSlots.value = undefined;

    await prisma.customer.updateMany({
      where: { businessId, phone: customerPhone },
      data: { preferredServiceId: service.id },
    });

    const when = new Date(appointment.startTime).toLocaleString("he-IL", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const customerLabel = input.customerName ? `${input.customerName} (${customerPhone})` : customerPhone;
    notifyOwner(businessId, `📅 הזמנה חדשה!\nלקוח: ${customerLabel}\nשירות: ${service.name}\nמועד: ${when}`);

    syncAppointmentToCalendar(businessId, {
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      serviceName: service.name,
      customerName: input.customerName as string | undefined,
      customerPhone,
    }).catch((err) => console.error("Calendar sync failed:", err));

    return JSON.stringify({ booked: true, startTime: appointment.startTime, endTime: appointment.endTime });
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
    });
    if (!appointment) return JSON.stringify({ error: "No matching appointment found" });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "cancelled" } });
    return JSON.stringify({ cancelled: true });
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
    notifyOwner(businessId, `🙋 לקוח ${label} ביקש המשך טיפול אנושי:\n${input.reason}`);
    return JSON.stringify({ notified: true });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

function makeApiCall(model: string, system: string, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
  return anthropic.messages.create({
    model,
    max_tokens: 1024,
    system,
    tools,
    messages,
  }) as Promise<Anthropic.Message>;
}

const AI_UNAVAILABLE_HE = "מצטערים, הבוט אינו זמין כרגע. אנא נסו שוב בעוד כמה דקות, או צרו קשר ישיר עם העסק.";

export async function handleIncomingMessage(businessId: string, customerPhone: string, messageText: string): Promise<BotResult> {
  const systemText = await buildSystemPrompt(businessId, new Date().toISOString().slice(0, 10), customerPhone);
  const system = systemText;
  const history = await getHistory(businessId, customerPhone);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t: Turn) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: messageText },
  ];

  const lastOfferedSlots: { value?: AvailableSlot[] } = {};
  let hadToolError = false;
  let model = chooseModel(messageText, false);

  console.log(`[bot] model=${model} business=${businessId} phone=${customerPhone} msg="${messageText.slice(0, 80)}"`);

  let response: Anthropic.Message;
  try {
    response = await makeApiCall(model, system, messages);
  } catch (err) {
    if (err instanceof APIError) console.error(`Anthropic API error ${err.status}:`, err.message);
    else console.error("Unexpected Anthropic error:", err);
    return { text: AI_UNAVAILABLE_HE };
  }

  let toolLoopCount = 0;
  while (response.stop_reason === "tool_use") {
    if (++toolLoopCount > 6) break; // safety guard

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

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    try {
      response = await makeApiCall(model, system, messages);
    } catch (err) {
      if (err instanceof APIError) console.error(`Anthropic API error ${err.status} (tool loop):`, err.message);
      else console.error("Unexpected Anthropic error (tool loop):", err);
      return { text: AI_UNAVAILABLE_HE };
    }
  }

  const replyText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  await appendTurn(businessId, customerPhone, { role: "user", content: messageText });
  await appendTurn(businessId, customerPhone, { role: "assistant", content: replyText });

  if (hadToolError) {
    console.log(`[bot] escalated to Sonnet for this turn (tool error recovery)`);
  }

  return { text: replyText, offeredSlots: lastOfferedSlots.value };
}
