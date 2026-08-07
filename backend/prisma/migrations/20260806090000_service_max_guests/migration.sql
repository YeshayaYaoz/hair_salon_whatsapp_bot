-- Max people a unit sleeps, for overnight verticals.
-- Nullable with no default: "the owner hasn't said" and "sleeps one" are different answers, and
-- backfilling a guess here would be worse than the prose it replaces — the bot must be able to say
-- it doesn't know rather than quietly rule a unit in or out on an invented number.
ALTER TABLE "Service" ADD COLUMN "maxGuests" INTEGER;
