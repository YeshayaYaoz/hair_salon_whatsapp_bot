import { prisma } from "./prisma.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "./crypto.js";

const INACTIVE_DAYS = 28; // send re-engagement after 4 weeks of no bookings
const MIN_DAYS_BETWEEN_MESSAGES = 21; // don't message the same customer more than once every 3 weeks

function buildReengagementMessage(customerName: string | null, serviceName: string, businessName: string): string {
  const name = customerName ? customerName.split(" ")[0] : "היי";
  return `${name}! 😊 עבר קצת זמן מאז שביקרת ב${businessName}.\nרוצה שאקבע לך תור ל${serviceName}? אפשר לכתוב לי מתי נוח ואמצא זמן מתאים 📅`;
}

export async function runRetentionJob() {
  console.log("[retention] Starting retention job...");

  const now = new Date();
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const messageCooldown = new Date(now.getTime() - MIN_DAYS_BETWEEN_MESSAGES * 24 * 60 * 60 * 1000);

  // Find all active businesses with WhatsApp connected
  const businesses = await prisma.business.findMany({
    where: {
      subscriptionStatus: "active",
      whatsappPhoneNumberId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: {
      id: true,
      name: true,
      whatsappPhoneNumberId: true,
      whatsappAccessToken: true,
    },
  });

  for (const business of businesses) {
    try {
      await processBusinessRetention(business, inactiveCutoff, messageCooldown);
    } catch (err) {
      console.error(`[retention] Error processing business ${business.id}:`, err);
    }
  }

  console.log("[retention] Job complete.");
}

async function processBusinessRetention(
  business: { id: string; name: string; whatsappPhoneNumberId: string | null; whatsappAccessToken: string | null },
  inactiveCutoff: Date,
  messageCooldown: Date
) {
  // Find customers who:
  // 1. Have a preferred service (have booked before)
  // 2. Haven't had a confirmed appointment since inactiveCutoff
  // 3. Haven't received a retention message recently
  const candidates = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      preferredServiceId: { not: null },
      OR: [
        { lastRetentionSentAt: null },
        { lastRetentionSentAt: { lt: messageCooldown } },
      ],
      appointments: {
        none: {
          status: "confirmed",
          startTime: { gte: inactiveCutoff },
        },
      },
    },
    include: {
      appointments: {
        where: { status: "confirmed" },
        orderBy: { startTime: "desc" },
        take: 1,
      },
    },
  });

  if (candidates.length === 0) return;

  const accessToken = decryptSecret(business.whatsappAccessToken!);
  const phoneNumberId = business.whatsappPhoneNumberId!;

  // Resolve preferred service names in one query
  const serviceIds = [...new Set(candidates.map((c) => c.preferredServiceId!))];
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true },
  });
  const serviceMap = Object.fromEntries(services.map((s) => [s.id, s.name]));

  for (const customer of candidates) {
    const serviceName = serviceMap[customer.preferredServiceId!];
    if (!serviceName) continue;

    const message = buildReengagementMessage(customer.name, serviceName, business.name);

    try {
      await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customer.phone, text: message });
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastRetentionSentAt: new Date() },
      });
      console.log(`[retention] Sent re-engagement to ${customer.phone} for business ${business.id}`);
    } catch (err) {
      console.error(`[retention] Failed to send to ${customer.phone}:`, err);
    }

    // Small delay to avoid hitting WhatsApp rate limits
    await new Promise((r) => setTimeout(r, 500));
  }
}
