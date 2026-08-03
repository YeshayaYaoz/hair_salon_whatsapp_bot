ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "checkoutRef" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "checkoutPlan" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "checkoutCycle" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Business_checkoutRef_key" ON "Business"("checkoutRef");
