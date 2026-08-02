-- Backfill Customer rows for anyone who has messaged the bot but never booked.
--
-- Customer rows were only ever created by booking and by the waitlist, which excluded every
-- inquiry-mode business outright: a B&B takes no automated bookings, so its Customers page stayed
-- empty no matter how many people had written in, and Conversations showed bare phone numbers.
-- The webhook now registers a customer on the first inbound message; this catches everyone who
-- wrote before that shipped.
--
-- Idempotent: the NOT EXISTS guard means re-running changes nothing.
INSERT INTO "Customer" ("id", "businessId", "phone")
SELECT
  -- No pgcrypto dependency: a random hex string in the same shape as the cuids Prisma generates.
  'bkfl' || encode(gen_random_bytes(10), 'hex'),
  m."businessId",
  m."phone"
FROM (SELECT DISTINCT "businessId", "phone" FROM "ConversationMessage") m
WHERE NOT EXISTS (
  SELECT 1 FROM "Customer" c WHERE c."businessId" = m."businessId" AND c."phone" = m."phone"
);
