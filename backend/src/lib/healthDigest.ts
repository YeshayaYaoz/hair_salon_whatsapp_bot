import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";
import { getJobStatuses } from "./jobStatus.js";

/**
 * Daily operator health digest — emailed to SUPER_ADMIN_EMAIL (i.e. us, not the salons).
 *
 * The point is to learn about problems before a customer phones about them: a business whose
 * WhatsApp token went invalid, one with no owner notification phone (so every alert silently goes
 * nowhere), bots switched off, and whether the scheduled jobs actually ran. Everything here is a
 * read-only snapshot; a failure to send must never take the server down.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface HealthSnapshot {
  businesses: number;
  activeBusinesses: number;
  appointmentsLast24h: number;
  newBusinessesLast24h: number;
  brokenWhatsapp: string[]; // names of businesses whose token is invalid
  missingNotificationPhone: string[];
  botDisabled: string[];
  /** Active paid subscriptions with no saved card — these are silently never billed. */
  unbillable: string[];
  staleJobs: string[]; // jobs that errored, or haven't run in over a day
}

export async function collectHealthSnapshot(): Promise<HealthSnapshot> {
  const since = new Date(Date.now() - ONE_DAY_MS);

  const [businesses, appointmentsLast24h, newBusinessesLast24h] = await Promise.all([
    prisma.business.findMany({
      select: {
        name: true,
        subscriptionStatus: true,
        blockedAt: true,
        whatsappAccessToken: true,
        whatsappTokenValid: true,
        notificationPhone: true,
        botEnabled: true,
        subscriptionPlan: true,
        subscriptionToken: true,
      },
    }),
    prisma.appointment.count({ where: { createdAt: { gte: since } } }),
    prisma.business.count({ where: { createdAt: { gte: since } } }),
  ]);

  const isLive = (b: (typeof businesses)[number]) =>
    !b.blockedAt && ["trial", "active"].includes(b.subscriptionStatus);

  // Only flag live businesses — a lapsed/blocked account being misconfigured isn't actionable.
  const live = businesses.filter(isLive);

  const staleJobs: string[] = [];
  try {
    const statuses = await getJobStatuses();
    for (const job of statuses) {
      const ranRecently = Date.now() - new Date(job.lastRunAt).getTime() < ONE_DAY_MS;
      if (!ranRecently || job.lastStatus !== "ok") staleJobs.push(job.jobName);
    }
  } catch {
    // Job status is a nice-to-have here; never let it break the digest.
  }

  return {
    businesses: businesses.length,
    activeBusinesses: live.length,
    appointmentsLast24h,
    newBusinessesLast24h,
    brokenWhatsapp: live.filter((b) => b.whatsappAccessToken && !b.whatsappTokenValid).map((b) => b.name),
    missingNotificationPhone: live.filter((b) => !b.notificationPhone?.trim()).map((b) => b.name),
    botDisabled: live.filter((b) => !b.botEnabled).map((b) => b.name),
    // The billing job requires a token (see its query), so a business without one is skipped every
    // night with no log line and no alert — an active paid plan that is quietly never charged.
    // Nothing else in the system notices, which is why it belongs here.
    unbillable: businesses
      .filter((b) => b.subscriptionStatus === "active" && b.subscriptionPlan && !b.subscriptionToken && !b.blockedAt)
      .map((b) => b.name),
    staleJobs,
  };
}

function renderHtml(s: HealthSnapshot): string {
  const list = (items: string[]) =>
    items.length === 0 ? "<span style='color:#16a34a'>none ✓</span>" : items.map((i) => `<code>${i}</code>`).join(", ");

  const issues =
    s.brokenWhatsapp.length + s.missingNotificationPhone.length + s.botDisabled.length + s.staleJobs.length + s.unbillable.length;

  return `
    <h2>Tori — daily health</h2>
    <p style="font-size:15px">
      <strong>${issues === 0 ? "✅ No issues" : `⚠️ ${issues} thing(s) need attention`}</strong>
    </p>
    <h3>Activity (last 24h)</h3>
    <ul>
      <li>Appointments booked: <strong>${s.appointmentsLast24h}</strong></li>
      <li>New businesses: <strong>${s.newBusinessesLast24h}</strong></li>
      <li>Live businesses: <strong>${s.activeBusinesses}</strong> (of ${s.businesses} total)</li>
    </ul>
    <h3>Needs attention</h3>
    <ul>
      <li>WhatsApp token broken: ${list(s.brokenWhatsapp)}</li>
      <li>No owner notification phone: ${list(s.missingNotificationPhone)}</li>
      <li>Bot switched off: ${list(s.botDisabled)}</li>
      <li>Jobs with no success in 24h: ${list(s.staleJobs)}</li>
      <li>Active plan but <strong>no saved card — never billed</strong>: ${list(s.unbillable)}</li>
    </ul>
  `;
}

/** Sends the digest once per day, in the 08:00 UTC hour. Safe to call hourly. */
export async function runHealthDigestJob() {
  if (new Date().getUTCHours() !== 8) return;
  const snapshot = await collectHealthSnapshot();
  const issues =
    snapshot.brokenWhatsapp.length +
    snapshot.missingNotificationPhone.length +
    snapshot.botDisabled.length +
    snapshot.staleJobs.length +
    snapshot.unbillable.length;
  await sendAdminAlertEmail(
    `Tori health — ${snapshot.appointmentsLast24h} bookings, ${issues} issue(s)`,
    renderHtml(snapshot)
  );
}
