-- A downgrade takes effect at the next renewal instead of immediately, so the business keeps the
-- plan it has already paid for until that period ends. Null for every existing row: nobody has a
-- change scheduled, and the previous behaviour left nothing to migrate — it applied downgrades on
-- the spot and forfeited the remainder.
ALTER TABLE "Business" ADD COLUMN "scheduledPlan" TEXT;
