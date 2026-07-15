CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetBusinessId" TEXT NOT NULL,
    "targetBusinessName" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAuditLog_targetBusinessId_createdAt_idx" ON "AdminAuditLog"("targetBusinessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

CREATE TABLE IF NOT EXISTS "BusinessMetricSnapshot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mrrIls" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "trialCount" INTEGER NOT NULL,
    "pastDueCount" INTEGER NOT NULL,
    "canceledCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessMetricSnapshot_date_key" ON "BusinessMetricSnapshot"("date");
