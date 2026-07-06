import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { createSubscriptionCheckoutLink, chargeSubscriptionToken, PLAN_PRICES_ILS } from "./payplusSubscription.js";
import { captureError } from "../lib/errorMonitoring.js";

export const payplusBillingRouter = Router();
export const payplusBillingWebhookRouter = Router();

/** Creates a PayPlus checkout link that charges the first month AND captures a recurring token. */
payplusBillingRouter.post("/payplus/checkout", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ plan: z.enum(["standard", "premium"]), returnUrl: z.string().url() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const url = await createSubscriptionCheckoutLink(req.businessId!, parsed.data.plan, parsed.data.returnUrl);
    res.json({ url });
  } catch (err) {
    console.error("PayPlus subscription checkout failed:", err);
    res.status(502).json({ error: "Failed to create checkout link" });
  }
});

/** Upgrades/downgrades the plan and charges a prorated top-up immediately for the remainder of
 * the current billing period — the next scheduled charge picks up the new plan price automatically. */
payplusBillingRouter.put("/payplus/plan", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ plan: z.enum(["standard", "premium"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.subscriptionToken || !business.subscriptionPlan || !business.nextBillingDate) {
    return res.status(400).json({ error: "No active PayPlus subscription to change" });
  }
  if (business.subscriptionPlan === parsed.data.plan) return res.json({ ok: true });

  const oldDaily = PLAN_PRICES_ILS[business.subscriptionPlan] / 30;
  const newDaily = PLAN_PRICES_ILS[parsed.data.plan] / 30;
  const daysRemaining = Math.max(0, Math.ceil((business.nextBillingDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  const proratedDiff = Math.round((newDaily - oldDaily) * daysRemaining);

  if (proratedDiff > 0) {
    const token = decryptSecret(business.subscriptionToken);
    const result = await chargeSubscriptionToken(token, proratedDiff, `תורי — שדרוג תוכנית (${parsed.data.plan})`);
    if (!result.success) return res.status(502).json({ error: `Proration charge failed: ${result.error}` });
  }

  await prisma.business.update({ where: { id: business.id }, data: { subscriptionPlan: parsed.data.plan } });
  res.json({ ok: true, proratedChargeIls: Math.max(0, proratedDiff) });
});

/** PayPlus webhook for the initial checkout — captures the recurring token and activates the
 * subscription. more_info carries "<businessId>:<plan>" set when the link was generated. */
payplusBillingWebhookRouter.post("/", async (req, res) => {
  res.status(200).json({ ok: true }); // acknowledge fast, PayPlus retries aggressively on non-2xx

  try {
    const data = (req.body?.data ?? req.body) as Record<string, unknown>;
    const status = (data.status_code ?? data.status) as string | number | undefined;
    const success = status === "000" || status === 0 || status === "success";
    if (!success) return;

    const moreInfo = data.more_info as string | undefined;
    const tokenUid = data.token_uid as string | undefined;
    if (!moreInfo || !tokenUid) {
      console.warn("[payplus subscription webhook] Missing more_info/token_uid — cannot activate subscription");
      return;
    }
    const [businessId, plan] = moreInfo.split(":");
    if (!businessId || !plan || !PLAN_PRICES_ILS[plan]) {
      console.warn(`[payplus subscription webhook] Unrecognized more_info: ${moreInfo}`);
      return;
    }

    await prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: "active",
        subscriptionPlan: plan,
        subscriptionToken: encryptSecret(tokenUid),
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastBillingAttemptAt: new Date(),
      },
    });
    console.log(`[payplus subscription webhook] Activated ${plan} subscription for business ${businessId}`);
  } catch (err) {
    console.error("[payplus subscription webhook] Failed to process event:", err);
    captureError(err, { phase: "payplus subscription webhook" });
  }
});
