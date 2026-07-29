import { prisma } from "./prisma.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "./crypto.js";

/**
 * Earliest moment a pending hold could expire, or null when none is outstanding.
 *
 * This exists to let the database go idle. Managed Postgres (Neon) bills by compute time and
 * suspends the compute after a few minutes without a query — but this job ticks every 5 minutes,
 * which sits right at that threshold, so the compute never suspended and billed around the clock.
 * That alone exhausted a monthly compute allowance roughly halfway through the month.
 *
 * Most businesses have deposits disabled and therefore never have a hold at all, so tracking the
 * next expiry in memory lets the overwhelming majority of ticks return without opening a
 * connection. `undefined` means "not yet seeded from the database"; null means "checked, nothing
 * pending" — the distinction matters so a fresh process doesn't mistake un-seeded for empty and
 * skip real expiries forever.
 */
let nextExpiryAt: Date | null | undefined = undefined;

/** Called when a hold is created so the job knows to wake up for it without polling to find out. */
export function noteDepositHoldCreated(expiresAt: Date): void {
  if (nextExpiryAt === undefined || nextExpiryAt === null || expiresAt < nextExpiryAt) {
    nextExpiryAt = expiresAt;
  }
}

/**
 * Releases "pending_payment" holds whose deposit window has passed without payment — otherwise
 * an abandoned payment link would block the slot forever. Ticks every few minutes (see server.ts)
 * since holds are typically short (default 30 min), but returns without touching the database
 * unless a hold is actually due — see nextExpiryAt above for why that matters.
 */
export async function runDepositExpiryJob() {
  if (nextExpiryAt === undefined) {
    // First run in this process: one query to find whether anything is pending at all.
    const soonest = await prisma.appointment.findFirst({
      where: { status: "pending_payment", depositStatus: "pending" },
      orderBy: { depositExpiresAt: "asc" },
      select: { depositExpiresAt: true },
    });
    nextExpiryAt = soonest?.depositExpiresAt ?? null;
  }
  if (nextExpiryAt === null || nextExpiryAt > new Date()) return;
  // Something is due. Clear it first: the sweep below re-derives the next expiry, and clearing
  // afterwards would lose a hold created while it ran.
  nextExpiryAt = undefined;

  const expired = await prisma.appointment.findMany({
    where: { status: "pending_payment", depositStatus: "pending", depositExpiresAt: { lt: new Date() } },
    include: {
      service: true,
      customer: true,
      business: { select: { name: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of expired) {
    // Re-assert the pending state in the WHERE clause rather than updating by id alone: a deposit
    // webhook can land between the query above and this write, and cancelling a booking the
    // customer just paid for is the worst failure this job could have. updateMany matches zero
    // rows if the payment already confirmed it, so we skip it instead of clobbering.
    const { count } = await prisma.appointment.updateMany({
      where: { id: appt.id, status: "pending_payment", depositStatus: "pending" },
      data: { status: "cancelled", depositStatus: "none" },
    });
    if (count === 0) {
      console.log(`[depositExpiry] Hold ${appt.id} was confirmed/changed mid-run — leaving it alone`);
      continue;
    }
    console.log(`[depositExpiry] Released unpaid hold ${appt.id} (business ${appt.businessId})`);

    if (appt.business.whatsappPhoneNumberId && appt.business.whatsappAccessToken) {
      try {
        const accessToken = decryptSecret(appt.business.whatsappAccessToken);
        await sendWhatsAppMessage({
          phoneNumberId: appt.business.whatsappPhoneNumberId,
          accessToken,
          to: appt.customer.phone,
          text: `היי, המועד ל${appt.service.name} אצל ${appt.business.name} שוחרר כי המקדמה לא התקבלה בזמן. רוצה לנסות לקבוע מחדש? אני כאן 😊`,
        });
      } catch (err) {
        console.error(`[depositExpiry] Failed to notify customer for appt ${appt.id}:`, err);
      }
    }
  }

  // Re-derive the next wake-up so subsequent ticks can go back to skipping the database.
  const soonest = await prisma.appointment.findFirst({
    where: { status: "pending_payment", depositStatus: "pending" },
    orderBy: { depositExpiresAt: "asc" },
    select: { depositExpiresAt: true },
  });
  nextExpiryAt = soonest?.depositExpiresAt ?? null;
}
