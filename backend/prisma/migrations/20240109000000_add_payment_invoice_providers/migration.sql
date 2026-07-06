-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN "paymentProvider" TEXT,
  ADD COLUMN "paymentApiKey" TEXT,
  ADD COLUMN "paymentApiSecret" TEXT,
  ADD COLUMN "invoiceProvider" TEXT,
  ADD COLUMN "invoiceApiKey" TEXT,
  ADD COLUMN "invoiceApiSecret" TEXT;
