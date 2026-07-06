-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN "subscriptionPlan" TEXT,
  ADD COLUMN "subscriptionToken" TEXT,
  ADD COLUMN "nextBillingDate" TIMESTAMP(3),
  ADD COLUMN "lastBillingAttemptAt" TIMESTAMP(3);
