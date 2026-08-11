-- Which medium a recorded turn happened on.
--
-- Voice calls are written to ConversationMessage with role='user', exactly like an inbound
-- WhatsApp message. The owner-alert and send-details paths measure Meta's 24h customer-service
-- window from those rows — so a phone call was opening a WhatsApp window that Meta had not
-- opened. The free-form sends that followed were accepted with a 200 and then dropped in transit
-- (error 131047), and the owner was told the message had been sent.
--
-- Existing rows are all WhatsApp, hence the default; new voice turns pass 'voice' explicitly.
ALTER TABLE "ConversationMessage" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
