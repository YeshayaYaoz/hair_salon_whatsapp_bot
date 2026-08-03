-- Lets a pending PayPlus hosted page be a wallet top-up as well as a subscription checkout, so a
-- business with no saved card token can still pay. NULL purpose means "subscription" — every row
-- that predates this column was one.
ALTER TABLE "Business" ADD COLUMN "checkoutPurpose" TEXT;
ALTER TABLE "Business" ADD COLUMN "checkoutAmountIls" INTEGER;
