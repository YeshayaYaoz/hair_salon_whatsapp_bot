-- CreateTable
CREATE TABLE "RecurringCharge" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountIls" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeDue" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "recurringChargeId" TEXT,
    "customerId" TEXT NOT NULL,
    "amountIls" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ChargeDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "chargeDueId" TEXT,
    "amountIls" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "RecurringCharge_businessId_active_idx" ON "RecurringCharge"("businessId", "active");
CREATE UNIQUE INDEX "ChargeDue_recurringChargeId_dueDate_key" ON "ChargeDue"("recurringChargeId", "dueDate");
CREATE INDEX "ChargeDue_businessId_status_idx" ON "ChargeDue"("businessId", "status");
CREATE UNIQUE INDEX "Receipt_chargeDueId_key" ON "Receipt"("chargeDueId");
CREATE INDEX "Receipt_businessId_createdAt_idx" ON "Receipt"("businessId", "createdAt");

-- Foreign keys
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeDue" ADD CONSTRAINT "ChargeDue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeDue" ADD CONSTRAINT "ChargeDue_recurringChargeId_fkey" FOREIGN KEY ("recurringChargeId") REFERENCES "RecurringCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChargeDue" ADD CONSTRAINT "ChargeDue_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_chargeDueId_fkey" FOREIGN KEY ("chargeDueId") REFERENCES "ChargeDue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
