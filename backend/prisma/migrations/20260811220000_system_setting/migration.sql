-- Operator-level values captured at runtime (first use: PayPlus terminal/cashier uids from the
-- checkout callback, which no PayPlus API endpoint lists).
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
