-- Lead Finder module: business discovery, enrichment, scoring, campaign management.
-- Fully isolated from the booking domain (Business/Customer/Appointment). Outreach tables
-- (OutreachMessage, ConsentLog) are created now as schema-only groundwork; send/generate logic
-- is not implemented in this pass.
--
-- All statements are idempotent (CREATE TABLE/INDEX IF NOT EXISTS) per repo convention, since
-- the production DB was originally created via `db push` and migrations must be safely re-runnable.

CREATE TABLE IF NOT EXISTS "LeadCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "locationQuery" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadFinderRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "totalEnriched" INTEGER NOT NULL DEFAULT 0,
    "totalScored" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFinderRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "category" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "businessHours" JSONB,
    "socialLinks" JSONB,
    "whatsappDetected" BOOLEAN NOT NULL DEFAULT false,
    "hasOnlineBooking" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "websiteStale" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadScore" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadProfile" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "whyToriFits" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "model" TEXT,

    CONSTRAINT "LeadProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadStatusEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStatusEvent_pkey" PRIMARY KEY ("id")
);

-- Schema only for this pass — no generation/sending logic implemented yet.
CREATE TABLE IF NOT EXISTS "OutreachMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "angle" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- Required before any repeat outreach — table exists ahead of the outreach feature itself.
CREATE TABLE IF NOT EXISTS "ConsentLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadScoringConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadScoringConfig_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_placeId_key') THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_placeId_key" UNIQUE ("placeId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadProfile_leadId_key') THEN
    ALTER TABLE "LeadProfile" ADD CONSTRAINT "LeadProfile_leadId_key" UNIQUE ("leadId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadScoringConfig_key_key') THEN
    ALTER TABLE "LeadScoringConfig" ADD CONSTRAINT "LeadScoringConfig_key_key" UNIQUE ("key");
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "LeadFinderRun_campaignId_idx" ON "LeadFinderRun"("campaignId");
CREATE INDEX IF NOT EXISTS "Lead_campaignId_idx" ON "Lead"("campaignId");
CREATE INDEX IF NOT EXISTS "Lead_campaignId_status_idx" ON "Lead"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "LeadScore_leadId_idx" ON "LeadScore"("leadId");
CREATE INDEX IF NOT EXISTS "LeadStatusEvent_leadId_idx" ON "LeadStatusEvent"("leadId");
CREATE INDEX IF NOT EXISTS "OutreachMessage_leadId_idx" ON "OutreachMessage"("leadId");
CREATE INDEX IF NOT EXISTS "ConsentLog_leadId_idx" ON "ConsentLog"("leadId");

-- Foreign keys.
-- LeadFinderRun/Lead -> LeadCampaign: RESTRICT (a campaign should never cascade-delete its
-- leads/runs; leads are the valuable artifact and must survive campaign deletion attempts).
-- Everything hanging off a Lead cascades when that Lead is deleted.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadFinderRun_campaignId_fkey') THEN
    ALTER TABLE "LeadFinderRun" ADD CONSTRAINT "LeadFinderRun_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "LeadCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_campaignId_fkey') THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "LeadCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadScore_leadId_fkey') THEN
    ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadProfile_leadId_fkey') THEN
    ALTER TABLE "LeadProfile" ADD CONSTRAINT "LeadProfile_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadStatusEvent_leadId_fkey') THEN
    ALTER TABLE "LeadStatusEvent" ADD CONSTRAINT "LeadStatusEvent_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OutreachMessage_leadId_fkey') THEN
    ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConsentLog_leadId_fkey') THEN
    ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
