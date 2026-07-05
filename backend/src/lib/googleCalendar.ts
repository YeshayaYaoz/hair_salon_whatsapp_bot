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

export function getAuthUrl(state: string): string {
  // Guard against building a malformed URL (client_id=undefined) that makes Google return a raw 400.
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new GoogleCalendarNotConfiguredError();
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function requireConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) throw new GoogleCalendarNotConfiguredError();
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI };
}

async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret, redirectUri } = requireConfig();
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
