-- What Cartesia's call webhook carries beyond the billing figures.
--
-- summary is their own one-or-two-sentence account of what the caller wanted, delivered by the
-- post_call_analysis event. ttfbMsMedian and interruptions are read off the call's own transcript:
-- the first is the agent's real time-to-first-audio on live calls (previously only measurable in a
-- benchmark), the second counts assistant turns the caller talked over.
ALTER TABLE "ApiUsageEvent" ADD COLUMN "summary" TEXT;
ALTER TABLE "ApiUsageEvent" ADD COLUMN "ttfbMsMedian" INTEGER;
ALTER TABLE "ApiUsageEvent" ADD COLUMN "interruptions" INTEGER;
