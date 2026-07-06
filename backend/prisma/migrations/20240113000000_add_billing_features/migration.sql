-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN "billingCyclesCompleted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loyaltyDiscountIls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastBillingReminderSentAt" TIMESTAMP(3),
  ADD COLUMN "walletBalanceIls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pendingYieldCampaign" JSONB;
