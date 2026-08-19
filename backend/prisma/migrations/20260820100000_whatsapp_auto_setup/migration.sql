-- Progress of the hands-off WhatsApp setup for businesses whose number Tori issued.
ALTER TABLE "Business" ADD COLUMN "whatsappAutoSetupState" TEXT;
ALTER TABLE "Business" ADD COLUMN "whatsappAutoSetupError" TEXT;
ALTER TABLE "Business" ADD COLUMN "whatsappAutoSetupAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "whatsappAutoSetupAttempts" INTEGER NOT NULL DEFAULT 0;
