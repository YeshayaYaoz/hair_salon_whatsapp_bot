import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signBusinessToken } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { sendPasswordResetEmail } from "../lib/email.js";

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

  res.json({ token: signBusinessToken(business.id) });
});

// Forgot password — always responds 200 to prevent email enumeration
authRouter.post("/forgot-password", authLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const business = await prisma.business.findUnique({ where: { email } });
  if (business) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    await prisma.passwordResetToken.create({ data: { businessId: business.id, token, expiresAt } });
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\*$/, "").replace(/\/$/, "") || "http://localhost:3000";
    await sendPasswordResetEmail(email, `${frontendUrl}/reset-password?token=${token}`);
  }
  res.json({ ok: true });
});

authRouter.post("/reset-password", authLimiter, async (req, res) => {
  const { token, password } = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.used || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "Token invalid or expired" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.business.update({ where: { id: record.businessId }, data: { passwordHash } });
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } });
  res.json({ ok: true });
});
