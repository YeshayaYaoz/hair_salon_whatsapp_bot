import { prisma } from "./prisma.js";
import { getJobStatuses } from "./jobStatus.js";
import { sendAdminAlertEmail } from "./email.js";
import { findStaleJobs, HOUR_MS } from "./jobSchedule.js";
import { countAbandonedInbound } from "../webhook/whatsappInbox.js";

/**
 * The dead-man switch for scheduled jobs. Runs hourly and emails the operator the moment any job
 * is late by twice its interval or last failed — not the next morning, when the daily digest
 * would have mentioned it. Also carries the count of inbound WhatsApp messages the recovery sweep
 * gave up on, since each of those is a customer nobody answered.
 *
 * Alerts once per incident, not once per hour: the same set of problems re-alerts only after six
 * hours, and a changed set (a new job joins the list) alerts immediately. The marker clears the
 * moment everything is healthy, so the next incident is not swallowed by an old one.
 */
const MARKER_KEY = "job_watchdog_last_alert";
const REALERT_AFTER_MS = 6 * HOUR_MS;

export async function runJobWatchdogJob(): Promise<void> {
  const [statuses, abandoned] = await Promise.all([getJobStatuses(), countAbandonedInbound()]);
  const stale = findStaleJobs(statuses, new Date(), process.uptime() * 1000);

  const issues = stale.map((s) => ({ key: s.jobName, text: `${s.jobName} — ${s.reason}` }));
  if (abandoned > 0) {
    issues.push({ key: "inbound", text: `${abandoned} inbound WhatsApp message(s) abandoned after retries — customers who wrote and got no reply` });
  }

  const marker = await prisma.systemSetting.findUnique({ where: { key: MARKER_KEY } });

  if (issues.length === 0) {
    if (marker) await prisma.systemSetting.delete({ where: { key: MARKER_KEY } }).catch(() => {});
    return;
  }

  const key = issues.map((i) => i.key).sort().join("|");
  const previous = marker ? (JSON.parse(marker.value) as { at: string; key: string }) : null;
  const sameIncidentRecently =
    previous?.key === key && Date.now() - new Date(previous.at).getTime() < REALERT_AFTER_MS;
  if (sameIncidentRecently) return;

  const items = issues.map((i) => `<li><code>${i.text}</code></li>`).join("");
  await sendAdminAlertEmail(
    `⚠️ Tori — ${issues.length} scheduled job problem(s)`,
    `<h2 style="color:#fff;margin-bottom:8px;">Something scheduled has stopped</h2>` +
      `<ul style="color:#a1a1aa;">${items}</ul>` +
      `<p style="color:#a1a1aa;">Checked hourly. This repeats after six hours if it is still true.</p>`
  );

  const value = JSON.stringify({ at: new Date().toISOString(), key });
  await prisma.systemSetting
    .upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value }, update: { value } })
    .catch((err) => console.error("[jobWatchdog] Could not store alert marker:", err));
}
