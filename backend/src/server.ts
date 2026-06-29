import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./api/authRoutes.js";
import { businessRouter } from "./api/businessRoutes.js";
import { whatsappRouter } from "./webhook/whatsappRoutes.js";
import { billingRouter, stripeWebhookRouter } from "./billing/billingRoutes.js";

const app = express();
app.use(cors());

// Stripe webhook needs the raw, unparsed body to verify its signature, so this must be mounted
// before the global express.json() middleware below would otherwise consume the stream.
app.use("/api/billing/webhook", stripeWebhookRouter);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/business", businessRouter);
app.use("/api/billing", billingRouter);
app.use("/webhook/whatsapp", whatsappRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Backend listening on :${port}`));
