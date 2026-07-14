-- Wallet metering: switch the prepaid wallet from whole shekels to agorot (1/100 ILS) for
-- accurate per-message deduction, and add a per-cycle usage counter so metering only kicks in
-- once a business exceeds its plan's included message quota.

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "walletBalanceAgorot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "messagesUsedThisCycle" INTEGER NOT NULL DEFAULT 0;

-- One-time backfill: carry over any existing shekel balance into the new agorot column.
-- Only touches rows that still have the pre-migration state (agorot column untouched at 0 while
-- the old shekel column holds a nonzero balance) — safe to re-run.
UPDATE "Business"
  SET "walletBalanceAgorot" = "walletBalanceIls" * 100
  WHERE "walletBalanceAgorot" = 0 AND "walletBalanceIls" IS NOT NULL AND "walletBalanceIls" != 0;

ALTER TABLE "Business" DROP COLUMN IF EXISTS "walletBalanceIls";
