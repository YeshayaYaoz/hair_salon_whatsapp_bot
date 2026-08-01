ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry over the single imageUrl added earlier so no configured photo is lost.
UPDATE "Service"
SET "imageUrls" = ARRAY["imageUrl"]
WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '' AND cardinality("imageUrls") = 0;

ALTER TABLE "Service" DROP COLUMN IF EXISTS "imageUrl";
