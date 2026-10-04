-- When a business stopped paying. The phone number's grace month runs from this date
-- (voiceNumberRenewal.ts): held 30 days, released after.
ALTER TABLE "Business" ADD COLUMN "subscriptionLapsedAt" TIMESTAMP(3);

-- Businesses already lapsed get the end of the period they paid for, not today: a salon that
-- cancelled months ago must not be granted a fresh month of a line Tori pays for.
UPDATE "Business"
SET "subscriptionLapsedAt" = COALESCE("nextBillingDate", "lastBillingAttemptAt", NOW())
WHERE "subscriptionStatus" IN ('past_due', 'canceled') AND "subscriptionLapsedAt" IS NULL;
