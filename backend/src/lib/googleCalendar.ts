import { prisma } from "./prisma.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export class GoogleCalendarNotConfiguredError extends Error {
  constructor() {
    super("Google Calendar integration is not configured on the server (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).");
    this.name = "GoogleCalendarNotConfiguredError";
  }
}

export function getAuthUrl(state: string, opts?: { redirectUri?: string; scope?: string }): string {
  // Guard against building a malformed URL (client_id=undefined) that makes Google return a raw 400.
  const redirectUri = opts?.redirectUri ?? REDIRECT_URI;
  if (!CLIENT_ID || !CLIENT_SECRET || !redirectUri) {
    throw new GoogleCalendarNotConfiguredError();
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: opts?.scope ?? "https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function requireConfig(redirectUriOverride?: string): { clientId: string; clientSecret: string; redirectUri: string } {
  const redirectUri = redirectUriOverride ?? REDIRECT_URI;
  if (!CLIENT_ID || !CLIENT_SECRET || !redirectUri) throw new GoogleCalendarNotConfiguredError();
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri };
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // only present on first consent (access_type=offline + prompt=consent)
  expires_in: number;
}

export async function exchangeCode(code: string, redirectUriOverride?: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = requireConfig(redirectUriOverride);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body.error_description ?? "OAuth exchange failed");
  return body;
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  verified_email: boolean;
}

/** Fetches the signed-in user's profile — used by the "Sign in with Google" flow to identify the account. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body.error?.message ?? "Failed to fetch Google profile");
  return body;
}

/**
 * Saves already-exchanged tokens as this business's Google Calendar connection. Used by the
 * "Sign in with Google" flow, which requests the calendar scope alongside identity during the
 * same consent screen and so already has tokens in hand — avoids a second exchangeCode call
 * against an already-consumed authorization code (Google rejects reuse).
 */
export async function saveGoogleTokensFromResponse(businessId: string, tokens: GoogleTokenResponse) {
  if (!tokens.refresh_token) return; // no calendar consent was granted (or already connected previously)
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await prisma.googleCalendarToken.upsert({
    where: { businessId },
    create: {
      businessId,
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: encryptSecret(tokens.refresh_token),
      expiresAt,
    },
    update: {
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: encryptSecret(tokens.refresh_token),
      expiresAt,
    },
  });
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body.error_description ?? "Token refresh failed");
  return body;
}

export async function saveGoogleTokens(businessId: string, code: string) {
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token — try reconnecting");
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await prisma.googleCalendarToken.upsert({
    where: { businessId },
    create: {
      businessId,
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: encryptSecret(tokens.refresh_token),
      expiresAt,
    },
    update: {
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: encryptSecret(tokens.refresh_token),
      expiresAt,
    },
  });
}

async function getValidAccessToken(businessId: string): Promise<string | null> {
  const record = await prisma.googleCalendarToken.findUnique({ where: { businessId } });
  if (!record) return null;

  if (record.expiresAt > new Date(Date.now() + 60_000)) {
    return decryptSecret(record.accessToken);
  }

  // Refresh
  const refreshToken = decryptSecret(record.refreshToken);
  const fresh = await refreshAccessToken(refreshToken);
  const expiresAt = new Date(Date.now() + fresh.expires_in * 1000);
  await prisma.googleCalendarToken.update({
    where: { businessId },
    data: { accessToken: encryptSecret(fresh.access_token), expiresAt },
  });
  return fresh.access_token;
}

export async function syncAppointmentToCalendar(
  businessId: string,
  appointment: {
    startTime: Date;
    endTime: Date;
    serviceName: string;
    customerName?: string;
    customerPhone: string;
  }
) {
  try {
    const record = await prisma.googleCalendarToken.findUnique({ where: { businessId } });
    if (!record) return; // Not connected

    const accessToken = await getValidAccessToken(businessId);
    if (!accessToken) return;

    const summary = `${appointment.serviceName}${appointment.customerName ? ` — ${appointment.customerName}` : ""}`;
    const description = `לקוח: ${appointment.customerName ?? "לא ידוע"}\nטלפון: ${appointment.customerPhone}\nשירות: ${appointment.serviceName}`;

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(record.calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary,
          description,
          start: { dateTime: appointment.startTime.toISOString(), timeZone: "Asia/Jerusalem" },
          end: { dateTime: appointment.endTime.toISOString(), timeZone: "Asia/Jerusalem" },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json() as any;
      console.error("Google Calendar sync failed:", err);
    } else {
      console.log("Appointment synced to Google Calendar");
    }
  } catch (err) {
    console.error("Google Calendar sync error (non-fatal):", err);
  }
}

export async function disconnectGoogleCalendar(businessId: string) {
  await prisma.googleCalendarToken.deleteMany({ where: { businessId } });
}
