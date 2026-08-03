-- Keeps a copy of the last WhatsApp profile picture uploaded through the dashboard, so the widget
-- shows the current image rather than an empty placeholder after every reload.
ALTER TABLE "Business" ADD COLUMN "whatsappProfilePictureUrl" TEXT;
