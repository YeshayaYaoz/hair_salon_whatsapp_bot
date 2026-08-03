-- Retry a failed subscription charge over several days instead of cutting the business off on the
-- first decline, and make each charge claimable so a crash mid-charge cannot bill twice.
ALTER TABLE "Business" ADD COLUMN "billingFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Business" ADD COLUMN "billingClaimedAt" TIMESTAMP(3);
