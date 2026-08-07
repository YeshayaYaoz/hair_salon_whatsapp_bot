-- Normalizes voicePhoneNumber to the form the dial-time matcher uses: digits only, leading 0
-- replaced by the 972 country code.
--
-- The column is @unique, but that constraint was being applied to whatever the owner typed — so
-- "055-507-7941" and "+972555077941" are two different strings to Postgres and both could be
-- stored, letting two businesses claim the same physical line. The read side normalizes both
-- sides when resolving a dialled number, so it would then find two candidate salons for one call
-- and answer as whichever came back first.
--
-- Guarded rather than a blanket UPDATE: if two rows already hold the same line in different
-- formats, normalizing both would violate the unique index and fail the migration — which runs on
-- every deploy. Rows that would collide are left exactly as they are, so the deploy succeeds and
-- the duplicate stays visible instead of taking the release down with it.
UPDATE "Business" AS b
SET "voicePhoneNumber" = n.normalized
FROM (
  SELECT
    id,
    CASE
      WHEN regexp_replace("voicePhoneNumber", '\D', '', 'g') LIKE '0%'
        THEN '972' || substring(regexp_replace("voicePhoneNumber", '\D', '', 'g') FROM 2)
      ELSE regexp_replace("voicePhoneNumber", '\D', '', 'g')
    END AS normalized
  FROM "Business"
  WHERE "voicePhoneNumber" IS NOT NULL
) AS n
WHERE b.id = n.id
  AND b."voicePhoneNumber" <> n.normalized
  AND n.normalized <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "Business" other
    WHERE other.id <> b.id AND other."voicePhoneNumber" = n.normalized
  );
