import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";

/** Send 24-hour appointment reminders. Run this job every hour. */
export async function runReminderJob() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      startTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: true,
      service: true,
      business: { select: { name: true, address: true, remindersEnabled: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of appointments) {
    if (!appt.business.remindersEnabled) continue;
    if (!appt.business.whatsappPhoneNumberId || !appt.business.whatsappAccessToken) continue;
    const accessToken = decryptSecret(appt.business.whatsappAccessToken);
    const when = appt.startTime.toLocaleString("he-IL", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
    const name = appt.customer.name ? appt.customer.name.split(" ")[0] : "היי";
    const addressLine = appt.business.address ? `\n📍 ${appt.business.address}` : "";
    const text = `${name}! 👋 תזכורת לתור שלך ל${appt.service.name} מחר ב-${when} אצל ${appt.business.name}.${addressLine}\n\nלביטול כתוב/י "בטל תור".`;

    try {
      await sendWhatsAppMessage({
        phoneNumberId: appt.business.whatsappPhoneNumberId,
        accessToken,
        to: appt.customer.phone,
        text,
      });
      await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
      console.log(`[reminders] Sent reminder for appt ${appt.id}`);
    } catch (err: any) {
      const code = err?.response?.data?.error?.code ?? err?.code;
      if (code === 131047) {
        // Customer hasn't messaged within 24h — mark sent to avoid retry loops
        await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
        console.warn(`[reminders] Template window closed for appt ${appt.id} (131047)`);
      } else {
        console.error(`[reminders] Failed for appt ${appt.id}:`, err);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Send post-visit review requests 2 hours after appointment ends. Run this job every hour. */
export async function runReviewJob() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      reviewSentAt: null,
      endTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: true,
      service: true,
      business: { select: { name: true, googleMapsUrl: true, reviewsEnabled: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of appointments) {
    if (!appt.business.reviewsEnabled) continue;
    if (!appt.business.whatsappPhoneNumberId || !appt.business.whatsappAccessToken) continue;
    const accessToken = decryptSecret(appt.business.whatsappAccessToken);
    const name = appt.customer.name ? appt.customer.name.split(" ")[0] : "היי";
    const reviewLine = appt.business.googleMapsUrl
      ? `\n\nנשמח אם תשאיר/י לנו ביקורת קצרה ⭐\n${appt.business.googleMapsUrl}`
      : "";
    const text = `${name}! 😊 תודה שביקרת ב${appt.business.name} היום.\nמקווים שנהנית מה${appt.service.name}!${reviewLine}`;

    try {
      await sendWhatsAppMessage({
        phoneNumberId: appt.business.whatsappPhoneNumberId,
        accessToken,
        to: appt.customer.phone,
        text,
      });
      await prisma.appointment.update({ where: { id: appt.id }, data: { reviewSentAt: new Date() } });
      console.log(`[reviews] Sent review request for appt ${appt.id}`);
    } catch (err: any) {
      const code = err?.response?.data?.error?.code ?? err?.code;
      if (code === 131047) {
        await prisma.appointment.update({ where: { id: appt.id }, data: { reviewSentAt: new Date() } });
        console.warn(`[reviews] Template window closed for appt ${appt.id} (131047)`);
      } else {
        console.error(`[reviews] Failed for appt ${appt.id}:`, err);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
