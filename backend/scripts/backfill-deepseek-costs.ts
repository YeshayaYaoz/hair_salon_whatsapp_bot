/**
 * One-shot repair of DeepSeek cost rows written before the pricing fix.
 *
 * Three errors were compounded in every DeepSeek ApiUsageEvent (see usageLedger.ts):
 *   1. `prompt_tokens` includes cache hits, so the stored inputTokens counted them twice — once
 *      in the prompt total and again in cacheReadTokens.
 *   2. The rate table said $0.28/$0.42; DeepSeek publishes $0.14/$0.28.
 *   3. Anthropic's 0.1x cache-read multiplier was applied to DeepSeek, whose hits are ~0.02x.
 *
 * Together these overstated spend by roughly 7x on a cache-heavy workload.
 *
 * NOT IDEMPOTENT, by necessity. Rows written after the fix already store the corrected token
 * split, and nothing in the row distinguishes a corrected row from a new one — so the only safe
 * boundary is time. `--before` is required rather than defaulted for exactly that reason: a
 * silently defaulted cutoff is how this gets run twice and halves the numbers a second time.
 *
 * Usage:
 *   npx tsx scripts/backfill-deepseek-costs.ts --before 2026-08-10T21:00:00Z          (dry run)
 *   npx tsx scripts/backfill-deepseek-costs.ts --before 2026-08-10T21:00:00Z --apply
 *
 * Pass the deploy time of the fix as --before. Anything at or after it is left alone.
 */
const RATE = { input: 0.14, output: 0.28, cacheReadMultiplier: 0.02 };
const USD_TO_ILS = 3.7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const before = arg("--before");
  const apply = process.argv.includes("--apply");

  if (!before || Number.isNaN(Date.parse(before))) {
    console.error("Refusing to run without an explicit --before <ISO timestamp> (the deploy time of the pricing fix).");
    console.error("This script is not idempotent — running it twice would correct the same rows twice.");
    process.exit(1);
  }
  const cutoff = new Date(before);

  // Imported here, not at module scope: Prisma builds a client on import and dies on a missing
  // DATABASE_URL, which would swallow the usage message above behind a connection stack trace.
  const { prisma } = await import("../src/lib/prisma.js");

  const rows = await prisma.apiUsageEvent.findMany({
    where: { kind: "claude", model: "deepseek-chat", createdAt: { lt: cutoff } },
    select: { id: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, costAgorot: true },
  });

  let oldTotal = 0;
  let newTotal = 0;
  const updates: { id: string; inputTokens: number; costAgorot: number }[] = [];

  for (const row of rows) {
    const hits = row.cacheReadTokens ?? 0;
    // Stored inputTokens was prompt_tokens + hits, and prompt_tokens itself already contained the
    // hits — hence subtracting them twice to recover the cache-miss portion. Clamped because a
    // handful of early rows predate cache reporting entirely and would otherwise go negative.
    const miss = Math.max(0, row.inputTokens - 2 * hits);
    const costUsd = (miss * RATE.input + row.outputTokens * RATE.output + hits * RATE.input * RATE.cacheReadMultiplier) / 1_000_000;
    const costAgorot = Math.round(costUsd * USD_TO_ILS * 100);

    oldTotal += row.costAgorot ?? 0;
    newTotal += costAgorot;
    // inputTokens is stored as the full prompt (miss + hits), matching what the fixed code writes.
    updates.push({ id: row.id, inputTokens: miss + hits, costAgorot });
  }

  console.log(`DeepSeek rows before ${cutoff.toISOString()}: ${rows.length}`);
  console.log(`Reported cost: ₪${(oldTotal / 100).toFixed(2)}  ->  ₪${(newTotal / 100).toFixed(2)}`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to persist.");
    return;
  }

  // Chunked rather than one transaction: this can be tens of thousands of rows, and a single
  // transaction that large risks a statement timeout on Neon and leaves nothing applied.
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates.slice(i, i + CHUNK).map((u) =>
        prisma.apiUsageEvent.update({
          where: { id: u.id },
          data: { inputTokens: u.inputTokens, costAgorot: u.costAgorot },
        })
      )
    );
    console.log(`  updated ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
