-- What Zadarma last reported about each business's voice number, copied down daily by the
-- renewal job so "is this line paid for" is answerable without a carrier call.
ALTER TABLE "Business" ADD COLUMN "voiceNumberStopDate" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "voiceNumberAutorenew" BOOLEAN;
