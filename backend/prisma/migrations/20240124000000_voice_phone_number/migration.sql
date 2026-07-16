ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "voicePhoneNumber" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Business_voicePhoneNumber_key" ON "Business"("voicePhoneNumber");
