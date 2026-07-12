-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentApiSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceApiSecret" TEXT;
