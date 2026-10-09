-- Identifies a business on Tori's shared line: its booking link puts "#<code>" into the
-- customer's first message. Minted on first use (sharedLineRouting.ts), one per business.
ALTER TABLE "Business" ADD COLUMN "sharedLineCode" TEXT;
CREATE UNIQUE INDEX "Business_sharedLineCode_key" ON "Business"("sharedLineCode");
