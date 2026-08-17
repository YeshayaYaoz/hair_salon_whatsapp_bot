-- Owner heads-up when the voice agent sends a caller unit details/photos. Default false: the bot
-- handled it, and a notification per photo request trains the owner to ignore the channel that
-- also carries paid deposits and failed transfers.
ALTER TABLE "Business" ADD COLUMN "notifyOnDetailsSent" BOOLEAN NOT NULL DEFAULT false;
