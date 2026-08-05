-- Owner-triggered "start a fresh conversation" marker.
-- Nullable and defaulted to NULL: every existing customer keeps their full conversation, since a
-- reset that never happened must not hide history the bot is already relying on.
ALTER TABLE "Customer" ADD COLUMN "conversationResetAt" TIMESTAMP(3);
