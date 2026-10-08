-- Where a signup came from (UTM parameters, referrer, or the owner's own answer). Free text,
-- read by people in the admin panel and the signup alert, never by code.
ALTER TABLE "Business" ADD COLUMN "signupSource" TEXT;
