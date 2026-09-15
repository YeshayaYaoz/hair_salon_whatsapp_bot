-- Every inbound WhatsApp message, written before Meta is acknowledged. The unique wamid is the
-- deduplication (Meta delivers at-least-once); rows left unprocessed are retried by the recovery
-- sweep, so a crash between the 200 and the reply no longer loses the customer's message.
CREATE TABLE "WhatsAppInbound" (
    "id"            TEXT NOT NULL,
    "wamid"         TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "payload"       JSONB NOT NULL,
    "receivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"     TIMESTAMP(3),
    "processedAt"   TIMESTAMP(3),
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastError"     TEXT,

    CONSTRAINT "WhatsAppInbound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppInbound_wamid_key" ON "WhatsAppInbound"("wamid");
CREATE INDEX "WhatsAppInbound_processedAt_receivedAt_idx" ON "WhatsAppInbound"("processedAt", "receivedAt");
