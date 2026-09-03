-- How often the morning digest goes out: daily | weekly | monthly | off.
--
-- Defaults to "daily", which is what every business already had, so nobody's cadence changes on
-- deploy. The second statement carries across the owners who had switched the digest off: without
-- it the new column would default them to daily and start messaging people who opted out.
ALTER TABLE "Business" ADD COLUMN "digestFrequency" TEXT NOT NULL DEFAULT 'daily';

UPDATE "Business" SET "digestFrequency" = 'off' WHERE "digestEnabled" = false;
