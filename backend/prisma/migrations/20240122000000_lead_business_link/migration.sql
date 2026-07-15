ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "linkedBusinessId" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_linkedBusinessId_idx" ON "Lead"("linkedBusinessId");
