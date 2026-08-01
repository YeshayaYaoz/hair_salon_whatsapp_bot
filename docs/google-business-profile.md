# Importing opening hours from Google Business Profile

The "Sync hours from Google" button on the Schedule page reads the opening hours a business already
publishes on Google Search and Maps, and offers to replace the hours stored here.

## How it works

1. `GET /api/business/google-business/hours` — reads the hours, saves nothing.
   - `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` for the accounts the
     owner manages.
   - `GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title,regularHours`
     for each account's locations.
2. `mapGoogleHours()` converts Google's periods into this app's one-row-per-day representation.
3. The owner reviews the result in the dashboard.
4. `POST /api/business/google-business/hours/apply` replaces `BusinessHours` with what they confirmed.

The OAuth connection is the same one used for Google Calendar — same client, same stored refresh
token. The only difference is the scope: `https://www.googleapis.com/auth/business.manage` is
requested alongside `calendar.events`. Owners who connected Google before this feature shipped have
a valid token without that scope; they get a 401 and a "connect Google account" button that
re-consents and upgrades the same record.

## What doesn't map cleanly

Google's model is richer than ours, so two cases are handled explicitly instead of being silently
mangled. Both are reported back to the owner in the review step:

- **Split hours** (open 09:00–13:00 and 16:00–20:00). This app stores one open/close pair per day,
  so the day is imported as 09:00–20:00 and the owner is told to add the break as a blocked time.
- **Overnight hours** (open Friday 20:00, close Saturday 02:00). Skipped entirely — importing them
  would produce a backwards range — and the owner is told to set that day by hand.

Days absent from Google are treated as closed, and applying replaces the whole week. Merging
instead would leave stale hours on exactly the days the owner meant to clear.

## ⚠️ Access must be granted by Google before this works

The Business Profile APIs are **restricted**. Having a valid OAuth token with the `business.manage`
scope is not enough — Google must also approve the Cloud project for these specific APIs. Until
that approval lands, every call returns 403 or 404 no matter what the owner does, and the dashboard
shows the "Google won't allow access" message.

To enable it:

1. Submit the [Business Profile APIs access request form](https://developers.google.com/my-business/content/prereqs)
   for the Google Cloud project behind `GOOGLE_CLIENT_ID`.
2. Wait for Google's approval (this is a manual review, not instant).
3. Once approved, enable these APIs on the project:
   - My Business Account Management API
   - My Business Business Information API
4. Add `https://www.googleapis.com/auth/business.manage` to the OAuth consent screen's scopes. It
   is a sensitive scope, so the consent screen needs verification before it can be used outside the
   project's test users.

Separately, each business owner must have a **verified** Google Business Profile and be signed in
with the Google account that manages it. An unverified listing has no hours to read.

Nothing else in the app depends on this: if the APIs are unavailable, the button reports why and
opening hours are still edited by hand exactly as before.
