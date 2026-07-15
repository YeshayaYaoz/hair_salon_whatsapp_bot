-- Stores the Google Calendar event id created for an appointment, so cancelling or rescheduling
-- can delete the actual event instead of leaving a "ghost" event behind on the owner's calendar.
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "calendarEventId" TEXT;
