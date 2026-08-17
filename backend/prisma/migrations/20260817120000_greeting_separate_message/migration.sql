-- Whether the owner's welcome is sent as its own message before the reply. Default false: one
-- message reads as a person, two read as a bot talking to itself.
ALTER TABLE "Business" ADD COLUMN "greetingSeparateMessage" BOOLEAN NOT NULL DEFAULT false;
