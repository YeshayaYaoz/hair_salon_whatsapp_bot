-- PayPlus requires customer_uid on every token charge (Transactions/Charge with use_token).
-- It arrives only on the checkout callback, so it is stored alongside the token it belongs to.
ALTER TABLE "Business" ADD COLUMN "subscriptionCustomerUid" TEXT;
