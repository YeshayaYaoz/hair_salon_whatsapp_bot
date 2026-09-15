-- One row per business per billing period, written before PayPlus is asked to charge. The unique
-- (businessId, periodKey) is what stops a crash between "money taken" and "due date advanced"
-- from charging the same period again the next day.
CREATE TABLE "SubscriptionCharge" (
    "id"            TEXT NOT NULL,
    "businessId"    TEXT NOT NULL,
    "periodKey"     TEXT NOT NULL,
    "amountIls"     DOUBLE PRECISION NOT NULL,
    "status"        TEXT NOT NULL,
    "transactionId" TEXT,
    "error"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionCharge_businessId_periodKey_key" ON "SubscriptionCharge"("businessId", "periodKey");
CREATE INDEX "SubscriptionCharge_status_updatedAt_idx" ON "SubscriptionCharge"("status", "updatedAt");
