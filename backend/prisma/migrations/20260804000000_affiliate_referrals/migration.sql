-- Tracks salons sent to a provider's signup page through our affiliate link, and whether they came
-- back and connected that provider. The provider's own affiliate dashboard reports the signup (we
-- pass businessId as the `ref` sub-id); convertedAt is the part we can see ourselves.
--
-- Written by hand rather than generated: `prisma migrate dev` cannot build a shadow database from
-- this migration history (the earliest migration assumes tables that no migration creates), so
-- generating would have failed on replay rather than on anything wrong with this change.
CREATE TABLE IF NOT EXISTS "AffiliateReferral" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);

-- One row per (salon, provider, kind): re-clicking the same link updates the existing row rather
-- than piling up duplicates, and the conversion check has exactly one row to look at.
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateReferral_businessId_provider_kind_key"
    ON "AffiliateReferral"("businessId", "provider", "kind");
CREATE INDEX IF NOT EXISTS "AffiliateReferral_businessId_idx" ON "AffiliateReferral"("businessId");

ALTER TABLE "AffiliateReferral"
    ADD CONSTRAINT "AffiliateReferral_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
