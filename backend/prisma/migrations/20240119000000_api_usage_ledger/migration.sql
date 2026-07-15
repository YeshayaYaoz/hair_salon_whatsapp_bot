CREATE TABLE IF NOT EXISTS "ApiUsageEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costAgorot" INTEGER,
    "category" TEXT,
    "billable" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ApiUsageEvent_businessId_customerPhone_createdAt_idx" ON "ApiUsageEvent"("businessId", "customerPhone", "createdAt");
CREATE INDEX IF NOT EXISTS "ApiUsageEvent_businessId_kind_createdAt_idx" ON "ApiUsageEvent"("businessId", "kind", "createdAt");
