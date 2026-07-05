ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "cancellationPolicy" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "referralText" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "digestEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "lastDigestSentAt" TIMESTAMP(3);

CREATE TABLE "BlockedTime" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedTime_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BlockedTime_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BlockedTime_businessId_startTime_idx" ON "BlockedTime"("businessId", "startTime");
