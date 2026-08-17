-- Claimed before a number order is placed, so a second concurrent request cannot order and pay for
-- a second number. voicePhoneNumber is only set after the carrier returns, which leaves a window.
ALTER TABLE "Business" ADD COLUMN "voiceNumberOrderedAt" TIMESTAMP(3);
