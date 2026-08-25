-- Discount codes a business offers its own customers.
ALTER TABLE "Appointment" ADD COLUMN "couponCode" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "couponDiscountIls" INTEGER;

CREATE TABLE "CustomerCoupon" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "serviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "onePerCustomer" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerCoupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerCoupon_businessId_code_key" ON "CustomerCoupon"("businessId", "code");
CREATE INDEX "CustomerCoupon_businessId_idx" ON "CustomerCoupon"("businessId");

CREATE TABLE "CustomerCouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "appointmentId" TEXT,
    "discountIls" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerCouponRedemption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerCouponRedemption_couponId_customerPhone_idx" ON "CustomerCouponRedemption"("couponId", "customerPhone");

ALTER TABLE "CustomerCoupon" ADD CONSTRAINT "CustomerCoupon_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerCouponRedemption" ADD CONSTRAINT "CustomerCouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "CustomerCoupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
