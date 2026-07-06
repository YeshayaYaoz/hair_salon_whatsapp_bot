CREATE TABLE "SystemJobRun" (
    "jobName" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastStatus" TEXT NOT NULL,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    CONSTRAINT "SystemJobRun_pkey" PRIMARY KEY ("jobName")
);
