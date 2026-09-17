-- Every outbound WhatsApp message and its delivery verdict. Written by the send path (through the
-- client's observer, so no call site can skip it), settled by the status webhook. A send that
-- returns 200 is only "accepted"; this is where "delivered" or "failed" lands.
CREATE TABLE "WhatsAppOutbound" (
    "id"            TEXT NOT NULL,
    "messageId"     TEXT,
    "businessId"    TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "to"            TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "templateName"  TEXT,
    "status"        TEXT NOT NULL DEFAULT 'sent',
    "failCode"      INTEGER,
    "failTitle"     TEXT,
    "sentAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusAt"      TIMESTAMP(3),

    CONSTRAINT "WhatsAppOutbound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppOutbound_messageId_key" ON "WhatsAppOutbound"("messageId");
CREATE INDEX "WhatsAppOutbound_businessId_status_sentAt_idx" ON "WhatsAppOutbound"("businessId", "status", "sentAt");
CREATE INDEX "WhatsAppOutbound_status_sentAt_idx" ON "WhatsAppOutbound"("status", "sentAt");
