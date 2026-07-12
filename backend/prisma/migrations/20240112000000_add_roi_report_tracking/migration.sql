-- AlterTable
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "lastRoiReportSentAt" TIMESTAMP(3);
