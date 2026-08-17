-- Which language the phone bot transcribes callers in.
--
-- Speech recognition was never told a language at all, and an unpinned transcriber handed Latin
-- letters inside Hebrew speech produced a repetition loop on a real call — one spoken email address
-- came back as "2022" repeated twenty-five times. Pinning it is the fix, but a salon whose callers
-- switch between Hebrew and English cannot be pinned to either, so "multilingual" is a third option
-- rather than a compromise baked into every business.
ALTER TABLE "Business" ADD COLUMN "voiceLanguage" TEXT NOT NULL DEFAULT 'he';
