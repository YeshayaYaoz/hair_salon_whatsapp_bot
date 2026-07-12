-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "subscriptionPlan" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionToken" TEXT,
  ADD COLUMN IF NOT EXISTS "nextBillingDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastBillingAttemptAt" TIMESTAMP(3);
