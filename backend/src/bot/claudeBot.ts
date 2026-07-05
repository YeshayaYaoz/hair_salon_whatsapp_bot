import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTurn, getHistory } from "./conversationStore.js";
import { findAvailableSlots, createAppointment, type AvailableSlot } from "../booking/availability.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "../lib/crypto.js";
import { syncAppointmentToCalendar } from "../lib/googleCalendar.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5";

const tools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description: "Find open appointment slots for a given service on a given date. If the customer requests a longer session (e.g. multiple hours), pass durationMin to find slots that fit the full duration.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the service the customer wants, matching a known service name" },
        date: { type: "string", description: "Date to check, in YYYY-MM-DD format" },
        durationMin: { type: "number", description: "Optional override for session length in minutes. Use when the customer requests more time than the service default (e.g. 120 for a 2-hour session)." },
      },
      required: ["serviceName", "date"],
    },
  },
  {
    name: "book_appointment",
    description: "Book a confirmed appointment slot for the customer. If a custom durationMin was used in check_availability, pass the same value here.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        startTime: { type: "string", description: "Exact slot start time in ISO 8601, must come from a prior check_availability result" },
        customerName: { type: "string", description: "Customer's name, if known" },
        durationMin: { type: "number", description: "Optional session length override in minutes, same value passed to check_availability" },
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
    description: "Add the customer to the waitlist for a service when no slots are available. The salon will contact them when a slot opens.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the service they want to wait for" },
        customerName: { type: "string", description: "Customer's name, if known" },
      },
      required: ["serviceName"],
    },
  },
  {
    name: "request_human_followup",
    description: "Alert the salon owner to follow up with this customer directly. Use when the customer has a complex request, complaint, or asks for something outside the bot's capabilities.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief reason why human follow-up is needed" },
        customerName: { type: "string", description: "Customer's name, if known" },
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
    await sendWhatsAppMessage({
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken,
      to: business.notificationPhone,
      text: message,
    });
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
    if (!service) return JSON.stringify({ error: "Unknown service" });

    const slots = await findAvailableSlots(businessId, service.id, new Date(input.date as string), input.durationMin as number | undefined);
    lastOfferedSlots.value = slots.slice(0, 6);
    return JSON.stringify({ slots: lastOfferedSlots.value });
  }

  if (name === "book_appointment") {
    const service = await prisma.service.findFirst({
      where: { businessId, name: { equals: input.serviceName as string, mode: "insensitive" } },
    });
    if (!service) return JSON.stringify({ error: "Unknown service" });

    const appointment = await createAppointment({
      businessId,
      serviceId: service.id,
      customerPhone,
      customerName: input.customerName as string | undefined,
      startTime: new Date(input.startTime as string),
      overrideDurationMin: input.durationMin as number | undefined,
    });
    lastOfferedSlots.value = undefined;

    // Update the customer's preferred service for CRM memory
    await prisma.customer.updateMany({
      where: { businessId, phone: customerPhone },
      data: { preferredServiceId: service.id },
    });

    const when = new Date(appointment.startTime).toLocaleString("he-IL", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const customerLabel = input.customerName ? `${input.customerName} (${customerPhone})` : customerPhone;
    notifyOwner(businessId, `📅 הזמנה חדשה!\nלקוח: ${customerLabel}\nשירות: ${service.name}\nמועד: ${when}`);

    // Sync to Google Calendar (non-fatal)
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
      appointments: appointments.map((a: (typeof appointments)[number]) => ({ service: a.service.name, startTime: a.startTime })),
    });
  }

  if (name === "cancel_appointment") {
    const appointment = await prisma.appointment.findFirst({
      where: { businessId, status: "confirmed", customer: { phone: customerPhone }, startTime: new Date(input.startTime as string) },
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

    await prisma.waitlistEntry.create({
      data: { businessId, customerId: customer.id, serviceId: service.id },
    });

    return JSON.stringify({ addedToWaitlist: true, service: service.name });
  }

  if (name === "request_human_followup") {
    const label = (input.customerName as string | undefined) ?? customerPhone;
    notifyOwner(businessId, `🙋 לקוח ${label} ביקש המשך טיפול אנושי:\n${input.reason}`);
    return JSON.stringify({ notified: true });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

/** Hebrew fallback message when the AI service is temporarily unavailable. */
const AI_UNAVAILABLE_HE =
  "מצטערים, הבוט אינו זמין כרגע. אנא נסו שוב בעוד כמה דקות, או צרו קשר ישיר עם העסק.";

export async function handleIncomingMessage(businessId: string, customerPhone: string, messageText: string): Promise<BotResult> {
  const system = await buildSystemPrompt(businessId, new Date().toISOString().slice(0, 10), customerPhone);
  const history = getHistory(businessId, customerPhone);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: messageText },
  ];

  const lastOfferedSlots: { value?: AvailableSlot[] } = {};
  console.log(`[bot] businessId=${businessId} customerPhone=${customerPhone} message="${messageText.slice(0, 80)}"`);

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages,
    });
  } catch (err) {
    if (err instanceof APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
    } else {
      console.error("Unexpected error calling Anthropic:", err);
    }
    return { text: AI_UNAVAILABLE_HE };
  }

  while (response.stop_reason === "tool_use") {
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[bot] tool_call name=${block.name} input=${JSON.stringify(block.input)}`);
        let result: string;
        try {
          result = await runTool(businessId, customerPhone, block.name, block.input as Record<string, unknown>, lastOfferedSlots);
        } catch (toolErr) {
          console.error(`[bot] tool ${block.name} threw:`, toolErr);
          result = JSON.stringify({ error: String(toolErr) });
        }
        console.log(`[bot] tool_result name=${block.name} result=${result.slice(0, 200)}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools,
        messages,
      });
    } catch (err) {
      if (err instanceof APIError) {
        console.error(`Anthropic API error ${err.status} (tool loop):`, err.message);
      } else {
        console.error("Unexpected error calling Anthropic (tool loop):", err);
      }
      return { text: AI_UNAVAILABLE_HE };
    }
  }

  const replyText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  appendTurn(businessId, customerPhone, { role: "user", content: messageText });
  appendTurn(businessId, customerPhone, { role: "assistant", content: replyText });

  return { text: replyText, offeredSlots: lastOfferedSlots.value };
}
