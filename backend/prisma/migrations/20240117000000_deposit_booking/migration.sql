-- Deposit-before-booking: business-level opt-in + amount, and per-appointment deposit tracking
-- so the bot can hold a slot as "pending_payment" until the deposit is paid or the hold expires.

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "depositAmountIls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "depositHoldMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "depositAmountIls" INTEGER,
  ADD COLUMN IF NOT EXISTS "depositStatus" TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "depositProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "depositPaymentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "depositProviderRef" TEXT,
  ADD COLUMN IF NOT EXISTS "depositExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "depositPaidAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Appointment_status_depositExpiresAt_idx" ON "Appointment"("status", "depositExpiresAt");
