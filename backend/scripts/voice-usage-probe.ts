/**
 * What the ledger actually holds for voice calls — the other half of the Cartesia call list.
 *
 * "Cartesia recorded the call" and "we recorded the call" are two different claims, and the whole
 * point of the webhook is the second one. Reading their API proves nothing about our database, and
 * until this existed the only way to check was to log into the dashboard as a business owner.
 *
 * Reads only. Run against production:
 *   railway run npx tsx scripts/voice-usage-probe.ts
 * or through the "Read Cartesia's own usage" workflow, which does the same with the deploy's own
 * credentials.
 *
 * Caller numbers are masked to their last four digits. Everything else is the operator's own data.
 */
import { prisma } from "../src/lib/prisma.js";
import { voiceBudgetStatus } from "../src/lib/voiceBudgetAlert.js";
import { listAgentCalls, CartesiaNotConfiguredError } from "../src/lib/cartesiaAdmin.js";

/** Last four digits only — enough to match a row against a call you made, and nothing more. */
function maskPhone(phone: string): string {
  if (phone === "unknown") return "unknown";
  return `…${phone.slice(-4)}`;
}

function mmss(seconds: number | null): string {
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function main() {
  const limit = Number(process.argv[2]) || 10;

  const rows = await prisma.apiUsageEvent.findMany({
    where: { kind: "voice_call" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      createdAt: true,
      businessId: true,
      customerPhone: true,
      externalId: true,
      durationSeconds: true,
      costAgorot: true,
      summary: true,
      ttfbMsMedian: true,
      interruptions: true,
    },
  });

  if (rows.length === 0) {
    console.log("No voice_call rows at all.");
    console.log("If a call has just ended: the webhook writes within seconds, the hourly sync within the hour.");
    console.log("If neither has, check that CARTESIA_WEBHOOK_SECRET is set and the agent has a webhook_id.");
    return;
  }

  const names = new Map(
    (await prisma.business.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.businessId))] } },
      select: { id: true, name: true },
    })).map((b) => [b.id, b.name])
  );

  console.log(`Last ${rows.length} voice call(s), newest first:\n`);
  for (const r of rows) {
    console.log(`${r.createdAt.toISOString()}  ${names.get(r.businessId) ?? r.businessId}`);
    console.log(
      `  ${mmss(r.durationSeconds)}  ₪${((r.costAgorot ?? 0) / 100).toFixed(2)}  from ${maskPhone(r.customerPhone)}  ${r.externalId ?? "(no call id)"}`
    );
    // The three fields that only a webhook delivery can fill. All null means the row came from the
    // hourly sync — the minutes are right and the live data never arrived.
    const live =
      r.ttfbMsMedian !== null || r.interruptions !== null || r.summary !== null
        ? `ttfb=${r.ttfbMsMedian ?? "-"}ms  interruptions=${r.interruptions ?? "-"}`
        : "no webhook data (recorded by the hourly sync)";
    console.log(`  ${live}`);
    if (r.summary) console.log(`  summary: ${r.summary}`);
    console.log();
  }

  await printServiceNames();

  // The service's own CARTESIA_API_KEY, exercised against the real API. After a key rotation this
  // is the line that says whether the Railway copy was updated: the hourly sync fails quietly into
  // a job log, and a stale key would otherwise surface as "minutes stopped arriving" days later.
  try {
    const recent = await listAgentCalls(new Date(Date.now() - 24 * 60 * 60 * 1000), 1);
    console.log(`Cartesia key on this service: OK (${recent.length} call(s) visible in the last 24h)`);
  } catch (err) {
    if (err instanceof CartesiaNotConfiguredError) console.log("Cartesia key on this service: not configured");
    else console.log(`Cartesia key on this service: FAILING — ${err instanceof Error ? err.message : err}`);
  }

  const status = await voiceBudgetStatus();
  console.log(
    `Month to date: ${status.calls} call(s), ${status.billedMinutes} billed minute(s), ` +
      `$${status.spentUsd.toFixed(2)} of $${status.budgetUsd.toFixed(2)} (${status.percent}%)`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Service names as stored, next to what a voice tool would have to send to match them.
 *
 * A live call failed four times on `Unknown service` for a unit that plainly exists, and the lookup
 * is an exact case-insensitive equals. So the question is not "is it there" but "is the string the
 * agent sends the same string" — and the differences that break an equals are the ones you cannot
 * see: a trailing space, a directional mark, a curly quote. Hence the codepoints.
 */
export async function printServiceNames() {
  const businesses = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: { id: true, name: true, services: { select: { name: true } } },
  });

  console.log("\nVoice-enabled businesses and their service names:");
  for (const b of businesses) {
    console.log(`\n  ${b.name}`);
    for (const s of b.services) {
      const codes = [...s.name].map((ch) => ch.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");
      const suspicious = /^\s|\s$|[‎‏‪-‮⁦-⁩"'׳״]/.test(s.name);
      console.log(`    ${JSON.stringify(s.name)}${suspicious ? "   ← has whitespace, quotes or a bidi mark" : ""}`);
      console.log(`      U+ ${codes}`);
    }
  }
}
