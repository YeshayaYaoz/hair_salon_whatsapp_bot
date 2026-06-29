import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signBusinessToken } from "../lib/auth.js";

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/signup", async (req, res) => {
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

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const business = await prisma.business.findUnique({ where: { email } });
  if (!business) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, business.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signBusinessToken(business.id) });
});
