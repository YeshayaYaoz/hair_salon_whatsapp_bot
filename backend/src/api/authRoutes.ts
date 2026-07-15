import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signBusinessToken } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { APP_URL, sendPasswordResetEmail, sendWelcomeEmail } from "../lib/email.js";
import {
  getAuthUrl,
  exchangeCode,
  fetchGoogleUserInfo,
  saveGoogleTokensFromResponse,
  GoogleCalendarNotConfiguredError,
} from "../lib/googleCalendar.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "auth",
  message: "Too many attempts. Please try again later.",
});

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/signup", authLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password } = parsed.data;
  const existing = await prisma.business.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const business = await prisma.business.create({ data: { name, email, passwordHash } });

  // Send welcome email (non-fatal)
  sendWelcomeEmail(email, name).catch((err) => console.error("Welcome email failed:", err));

  res.status(201).json({ token: signBusinessToken(business.id) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const business = await prisma.business.findUnique({ where: { email } });
  if (!business) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, business.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  if (business.blockedAt) {
    return res.status(403).json({ error: "This account has been suspended. Contact support." });
  }

  res.json({ token: signBusinessToken(business.id) });
});

authRouter.post("/forgot-password", authLimiter, async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const business = await prisma.business.findUnique({ where: { email } });
    if (!business) return res.status(404).json({ error: "כתובת האימייל לא נמצאה במערכת" });
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.passwordResetToken.create({ data: { businessId: business.id, token, expiresAt } });
    await sendPasswordResetEmail(email, `${APP_URL}/reset-password?token=${token}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("forgot-password error:", err);
    res.status(500).json({ error: "שגיאה בשרת" });
  }
});

authRouter.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const { token, password } = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: "Token invalid or expired" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.business.update({ where: { id: record.businessId }, data: { passwordHash } });
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } });
    res.json({ ok: true });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Sign in with Google ---
//
// Requests identity (email/profile) and the Calendar scope in the SAME consent screen, so a new
// business gets its Google Calendar connected automatically as part of signing up, rather than
// needing a second separate connection step later in Settings. Uses its own redirect URI
// (GOOGLE_LOGIN_REDIRECT_URI) distinct from the Settings-page "connect Calendar" flow
// (GOOGLE_REDIRECT_URI), since this callback runs unauthenticated (no business session yet) and
// does different work (find-or-create the account) than reconnecting an existing business's
// calendar. Both flows share the same Google Cloud OAuth client (GOOGLE_CLIENT_ID/SECRET).
const GOOGLE_LOGIN_REDIRECT_URI = process.env.GOOGLE_LOGIN_REDIRECT_URI;
const GOOGLE_LOGIN_SCOPE = "openid email profile https://www.googleapis.com/auth/calendar.events";

authRouter.get("/google/url", (_req, res) => {
  // Fail loudly rather than silently falling back to GOOGLE_REDIRECT_URI (getAuthUrl's default) —
  // that redirect URI points at the authenticated Settings-page callback, which would reject an
  // unauthenticated sign-in attempt with a confusing "Missing bearer token" instead of a clear
  // "not configured" error.
  if (!GOOGLE_LOGIN_REDIRECT_URI) {
    return res.status(503).json({ error: "התחברות עם גוגל אינה מוגדרת בשרת (GOOGLE_LOGIN_REDIRECT_URI חסר). פנה לתמיכה." });
  }
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const url = getAuthUrl(state, { redirectUri: GOOGLE_LOGIN_REDIRECT_URI, scope: GOOGLE_LOGIN_SCOPE });
    res.json({ url });
  } catch (err) {
    if (err instanceof GoogleCalendarNotConfiguredError) {
      return res.status(503).json({ error: "התחברות עם גוגל אינה מוגדרת בשרת. פנה לתמיכה." });
    }
    throw err;
  }
});

authRouter.post("/google/callback", authLimiter, async (req, res) => {
  try {
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const tokens = await exchangeCode(code, GOOGLE_LOGIN_REDIRECT_URI);
    const profile = await fetchGoogleUserInfo(tokens.access_token);
    if (!profile.verified_email) return res.status(400).json({ error: "Google email is not verified" });

    let business = await prisma.business.findUnique({ where: { email: profile.email } });
    let isNewAccount = false;
    if (!business) {
      isNewAccount = true;
      // Google-authenticated accounts don't set a password — store an unguessable placeholder
      // hash so password login simply fails "invalid credentials" rather than the field being
      // nullable (which would touch every other code path that assumes passwordHash exists).
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      business = await prisma.business.create({
        data: { name: profile.name || profile.email, email: profile.email, passwordHash },
      });
    }

    // Save the Calendar connection using the tokens already in hand — the authorization code was
    // already consumed above, so a second exchangeCode call (what saveGoogleTokens does) would
    // fail. refresh_token is only present when the user actually granted the calendar scope.
    if (business.blockedAt) {
      return res.status(403).json({ error: "This account has been suspended. Contact support." });
    }

    await saveGoogleTokensFromResponse(business.id, tokens);

    if (isNewAccount) sendWelcomeEmail(profile.email, business.name).catch((err) => console.error("Welcome email failed:", err));

    res.json({ token: signBusinessToken(business.id) });
  } catch (err) {
    console.error("google/callback error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Google sign-in failed" });
  }
});
