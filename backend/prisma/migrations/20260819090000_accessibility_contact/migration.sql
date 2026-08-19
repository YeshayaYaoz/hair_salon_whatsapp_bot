-- Contact published on a business's own accessibility statement (/book/:id/accessibility).
-- Nullable with no default: an unset contact is a real state the statement handles, and there is
-- no value we could invent on a business's behalf.
ALTER TABLE "Business" ADD COLUMN "accessibilityContact" TEXT;
