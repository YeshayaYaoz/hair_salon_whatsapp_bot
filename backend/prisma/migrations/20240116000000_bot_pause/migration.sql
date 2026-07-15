-- Lets an owner take over a WhatsApp thread: sending a manual message pauses the bot on that
-- conversation until explicitly resumed, so the bot doesn't talk over a human mid-conversation.
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "botPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "botPausedAt" TIMESTAMP(3);
