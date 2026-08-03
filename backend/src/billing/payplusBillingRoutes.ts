import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import {
  createSubscriptionCheckoutLink,
  chargeSubscriptionToken,
  PLAN_PRICES_ILS,
  BILLING_PERIOD_DAYS,
  planPriceForCycle,
  PayPlusBillingNotConfiguredError,
} from "./payplusSubscription.js";
import { captureError } from "../lib/errorMonitoring.js";
import { explainPayPlusError } from "../lib/payplusErrors.js";

export const payplusBillingRouter = Router();
export const payplusBillingWebhookRouter = Router();

/** Creates a PayPlus checkout link that charges the first period AND captures a recurring token. */
payplusBillingRouter.post("/payplus/checkout", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ plan: z.enum(["standard", "premium"]), returnUrl: z.string().url(), cycle: z.enum(["monthly", "annual"]).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const url = await createSubscriptionCheckoutLink(req.businessId!, parsed.data.plan, parsed.data.returnUrl, parsed.data.cycle ?? "monthly");
    res.json({ url });
  } catch (err) {
    console.error("PayPlus subscription checkout failed:", err);
    captureError(err, { businessId: req.businessId, kind: "payplusCheckout" });

    // A blanket 502 here sent the owner to support with nothing to go on, and sent us to the logs
    // for something PayPlus already explained. The two failures below are the ones that actually
    // happen, and they need opposite fixes.
    if (err instanceof PayPlusBillingNotConfiguredError) {
      return res.status(503).json({ error: "חיוב מנויים אינו מוגדר בשרת. פנו לתמיכה." });
    }
    const detail = explainPayPlusError(err instanceof Error ? err.message : String(err));
    return res.status(502).json({
      // PayPlus's own rejection reason ("invalid api key", "payment page not found"), passed
      // through. This endpoint is owner-only (requireAuth), so it isn't leaking anything to the
      // public — and without it the owner cannot tell a misconfiguration from an outage.
      error: `יצירת קישור התשלום נכשלה. ${detail}`,
    });
  }
});

/** Switches an active monthly subscriber to the annual plan — charges 10 months upfront (2 free)
 * immediately via the saved token and pushes nextBillingDate a full year out. */
payplusBillingRouter.post("/payplus/switch-to-annual", requireAuth, async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.subscriptionToken || !business.subscriptionPlan) {
    return res.status(400).json({ error: "No active PayPlus subscription to switch" });
  }
  if (business.billingCycle === "annual") return res.json({ ok: true });

  const amountIls = planPriceForCycle(business.subscriptionPlan, "annual");
  const token = decryptSecret(business.subscriptionToken);
  const result = await chargeSubscriptionToken(token, amountIls, "תורי — מעבר למנוי שנתי");
  if (!result.success) return res.status(502).json({ error: `Annual charge failed: ${result.error}` });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      billingCycle: "annual",
      nextBillingDate: new Date(Date.now() + BILLING_PERIOD_DAYS.annual * 24 * 60 * 60 * 1000),
      lastBillingAttemptAt: new Date(),
    },
  });
  res.json({ ok: true, chargedIls: amountIls });
});

/** Tops up the prepaid wallet used for metered add-ons (extra WhatsApp/SMS sends beyond the plan). */
payplusBillingRouter.post("/payplus/wallet/topup", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ amountIls: z.number().int().positive().max(1000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.subscriptionToken) return res.status(400).json({ error: "No active PayPlus subscription to charge" });

  const token = decryptSecret(business.subscriptionToken);
  const result = await chargeSubscriptionToken(token, parsed.data.amountIls, "תורי — טעינת ארנק להודעות");
  if (!result.success) return res.status(502).json({ error: `Wallet top-up charge failed: ${result.error}` });

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { walletBalanceAgorot: { increment: parsed.data.amountIls * 100 } },
  });
  res.json({ ok: true, walletBalanceAgorot: updated.walletBalanceAgorot });
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
    const [businessId, plan, cycle] = moreInfo.split(":");
    const billingCycle = cycle === "annual" ? "annual" : "monthly";
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
        billingCycle,
        nextBillingDate: new Date(Date.now() + BILLING_PERIOD_DAYS[billingCycle] * 24 * 60 * 60 * 1000),
        lastBillingAttemptAt: new Date(),
        billingCyclesCompleted: 0,
      },
    });
    console.log(`[payplus subscription webhook] Activated ${plan}/${billingCycle} subscription for business ${businessId}`);
  } catch (err) {
    console.error("[payplus subscription webhook] Failed to process event:", err);
    captureError(err, { phase: "payplus subscription webhook" });
  }
});
