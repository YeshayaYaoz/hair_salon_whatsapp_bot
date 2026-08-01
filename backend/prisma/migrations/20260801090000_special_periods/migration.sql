CREATE TABLE IF NOT EXISTS "SpecialPeriod" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecialPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SpecialPeriod_businessId_startDate_idx" ON "SpecialPeriod"("businessId", "startDate");

DO $$ BEGIN
  ALTER TABLE "SpecialPeriod" ADD CONSTRAINT "SpecialPeriod_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
