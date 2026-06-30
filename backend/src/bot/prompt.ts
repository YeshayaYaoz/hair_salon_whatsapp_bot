import type { BusinessHours, Service, StaffMember, FaqEntry } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function buildSystemPrompt(businessId: string, todayIso: string): Promise<string> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { services: true, hours: true, staff: true, faqEntries: true },
  });

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hoursText = business.hours
    .sort((a: BusinessHours, b: BusinessHours) => a.dayOfWeek - b.dayOfWeek)
    .map((h: BusinessHours) => `${dayNames[h.dayOfWeek]}: ${fmtMin(h.openMin)}-${fmtMin(h.closeMin)}`)
    .join(", ") || "Not configured yet — tell the customer to contact the salon directly for hours.";

  const servicesText = business.services
    .map((s: Service) => `- ${s.name}: ₪${(s.priceCents / 100).toFixed(0)} (${s.durationMin} min)${s.description ? ` — ${s.description}` : ""}`)
    .join("\n") || "No services configured yet.";

  const staffText = business.staff.map((s: StaffMember) => s.name).join(", ") || "Not specified.";

  const faqText = business.faqEntries.map((f: FaqEntry) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");

  const personalityNote = business.botPersonality
    ? `\nPERSONALITY INSTRUCTIONS:\n${business.botPersonality}\n`
    : "";

  const greeting = business.botGreeting
    ? `\nGREETING TO USE FOR NEW CONVERSATIONS:\n${business.botGreeting}\n`
    : "";

  return `You are the WhatsApp booking assistant for "${business.name}", a hair salon. Today's date is ${todayIso}.
Be warm, concise, and helpful. Respond in the same language the customer uses (Hebrew or English). Answer only using the information below; if something isn't covered, say you're not sure and offer to have a human follow up.
${personalityNote}${greeting}
SERVICES & PRICES:
${servicesText}

OPENING HOURS:
${hoursText}

STAFF:
${staffText}

ADDRESS:
${business.address ?? "Not specified."}

${faqText ? `FREQUENTLY ASKED QUESTIONS:\n${faqText}\n` : ""}
BOOKING FLOW: use check_availability to find open slots for the requested service and date, present 2-4 options to the customer, then use book_appointment once they confirm. Always confirm the booking back in plain language.

WAITLIST: if no slots are available for a requested service, offer to add the customer to the waitlist using add_to_waitlist. The salon will contact them when a slot opens.`;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
