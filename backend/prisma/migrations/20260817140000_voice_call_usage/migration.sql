-- Voice call minutes, from Cartesia's own call records.
--
-- The ledger measured the LLM tokens spent during a call and nothing else, so the cost that
-- actually ran the account's prepaid balance to zero — $0.06 for every minute of live call — was
-- the one number the product could not show. These two columns are where it lands.
--
-- externalId is Cartesia's call id. The sync re-reads a window of history on every tick, so the
-- unique index is what makes a second read a no-op instead of a double charge.
ALTER TABLE "ApiUsageEvent" ADD COLUMN "externalId" TEXT;
ALTER TABLE "ApiUsageEvent" ADD COLUMN "durationSeconds" INTEGER;

CREATE UNIQUE INDEX "ApiUsageEvent_externalId_key" ON "ApiUsageEvent"("externalId");
