-- Marketing opt-out, per customer per business. Null on every existing row: nobody has been sent
-- a marketing message with an opt-out button yet, so nobody has pressed one.
ALTER TABLE "Customer" ADD COLUMN "marketingOptOutAt" TIMESTAMP(3);

-- A campaign and its per-recipient outcomes. The send loop only ever knows that Meta accepted a
-- request; delivery is decided later on the status webhook, and these rows are where it lands.
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "ownerText" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Campaign_businessId_createdAt_idx" ON "Campaign"("businessId", "createdAt");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CampaignSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "failCode" INTEGER,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampaignSend_messageId_key" ON "CampaignSend"("messageId");
CREATE INDEX "CampaignSend_campaignId_idx" ON "CampaignSend"("campaignId");
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
