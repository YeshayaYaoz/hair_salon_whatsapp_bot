import { asyncRouter } from "../lib/asyncRouter.js";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import {
  createSubscriptionCheckoutLink,
  createWalletTopupLink,
  chargeSubscriptionToken,
  PLAN_PRICES_ILS,
  BILLING_PERIOD_DAYS,
  planPriceForCycle,
  unusedCreditIls,
  chargeAfterCredit,
  PayPlusBillingNotConfiguredError,
  PayPlusTerminalNotConfiguredError,
  probeGenerateLink,
  resolveTerminalConfig,
} from "./payplusSubscription.js";
import { requireSuperAdmin } from "../api/businessRoutes.js";
import { captureError } from "../lib/errorMonitoring.js";
import { explainPayPlusError } from "../lib/payplusErrors.js";
import { parsePayPlusCallback } from "../lib/payplusCallback.js";

/** Fallback return URL when the caller sends none — the dashboard page these actions start from. */
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const payplusBillingRouter = asyncRouter();
export const payplusBillingWebhookRouter = asyncRouter();

/**
 * The payplus-probe script, as a page the operator can open — the server already holds every
 * variable the CLI version needed `railway run` for. Read-only except ?link=1, which creates a
 * real ₪1 payment page (still charges nobody until it is paid; paying it yourself is the one
 * end-to-end proof no code can give).
 */
payplusBillingRouter.get("/payplus/health", requireAuth, requireSuperAdmin, async (req: AuthedRequest, res) => {
  const sandbox = process.env.PAYPLUS_ENV === "sandbox";
  const backend = (process.env.PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
  const webhookSecret = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET?.trim();

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  checks.push({
    name: "סביבת PayPlus",
    ok: !sandbox,
    detail: sandbox ? "SANDBOX — נוצרים לינקים אבל אף שקל לא נגבה" : "production",
  });
  for (const name of ["PAYPLUS_API_KEY", "PAYPLUS_SECRET_KEY", "PAYPLUS_PAGE_UID", "PAYPLUS_BILLING_WEBHOOK_SECRET", "PUBLIC_BACKEND_URL"]) {
    checks.push({ name, ok: Boolean(process.env[name]?.trim()) });
  }

  // Renewals: env vars, or the values captured from a paid checkout's callback.
  const terminal = await resolveTerminalConfig();
  checks.push({
    name: "terminal_uid + cashier_uid (חיובי חידוש)",
    ok: terminal.source !== "missing",
    detail:
      terminal.source === "missing"
        ? "חסרים — ייקלטו אוטומטית מה-callback של התשלום המוצלח הראשון, או שיוגדרו ידנית ב-Railway"
        : terminal.source === "env"
          ? "מוגדרים ב-Railway"
          : "נקלטו אוטומטית מ-callback של תשלום",
  });

  // The webhook GET self-check, via the public URL — proves what PayPlus will actually reach.
  if (backend && webhookSecret) {
    try {
      const r = await fetch(`${backend}/webhook/billing/payplus/${webhookSecret}`);
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean };
      checks.push({
        name: "ה-webhook חי והסוד תואם",
        ok: r.status === 200 && body.ok === true,
        detail: r.status === 200 ? undefined : `GET החזיר ${r.status} — כרטיס יחויב ושום מנוי לא יופעל`,
      });
    } catch (err) {
      checks.push({ name: "ה-webhook חי והסוד תואם", ok: false, detail: err instanceof Error ? err.message : "network error" });
    }
  }

  // Credentials against the real PayPlus host; with ?link=1 the ₪1 page URL is returned too.
  const wantLink = req.query.link === "1";
  const probe = await probeGenerateLink();
  checks.push({ name: "המפתחות מתקבלים אצל PayPlus (יצירת דף ₪1)", ok: probe.ok, detail: probe.ok ? undefined : probe.error });

  res.json({
    ok: checks.every((c) => c.ok),
    checks,
    ...(wantLink && probe.ok ? { testPaymentUrl: probe.url } : {}),
  });
});

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
  const parsedBody = z.object({ returnUrl: z.string().url().optional() }).safeParse(req.body ?? {});
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.subscriptionPlan) {
    return res.status(400).json({ error: "אין מנוי פעיל להחלפה." });
  }
  if (business.billingCycle === "annual") return res.json({ ok: true });

  // No saved card: send the owner to a hosted page for the annual amount instead of refusing.
  // A business can be active with no token (activated by hand, or before tokenisation was on), and
  // "No active PayPlus subscription to switch" is both wrong from where they sit and unactionable.
  if (!business.subscriptionToken) {
    const returnUrl = parsedBody.success && parsedBody.data.returnUrl ? parsedBody.data.returnUrl : `${APP_URL}/dashboard/billing`;
    try {
      const credit = unusedCreditIls(business);
      const url = await createSubscriptionCheckoutLink(
        business.id,
        business.subscriptionPlan,
        returnUrl,
        "annual",
        chargeAfterCredit(planPriceForCycle(business.subscriptionPlan, "annual"), credit)
      );
      return res.json({ url, creditedIls: credit });
    } catch (err) {
      console.error("PayPlus annual checkout failed:", err);
      captureError(err, { businessId: business.id, kind: "payplusAnnualCheckout" });
      const detail = explainPayPlusError(err instanceof Error ? err.message : String(err));
      return res.status(502).json({ error: `יצירת קישור התשלום נכשלה. ${detail}` });
    }
  }

  // Credit the days already paid for on the monthly plan. Charging the full annual price on day 3
  // of a paid month bills them twice for the remaining 27 days.
  const creditIls = unusedCreditIls(business);
  const amountIls = chargeAfterCredit(planPriceForCycle(business.subscriptionPlan, "annual"), creditIls);
  const token = decryptSecret(business.subscriptionToken);
  let result;
  try {
    result = await chargeSubscriptionToken(token, amountIls, "תורי — מעבר למנוי שנתי");
  } catch (err) {
    if (err instanceof PayPlusTerminalNotConfiguredError) return res.status(503).json({ error: "חיוב בכרטיס שמור אינו מוגדר בשרת. פנו לתמיכה." });
    throw err;
  }
  if (!result.success) return res.status(502).json({ error: `החיוב למנוי השנתי נכשל. ${explainPayPlusError(result.error ?? "")}` });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      billingCycle: "annual",
      nextBillingDate: new Date(Date.now() + BILLING_PERIOD_DAYS.annual * 24 * 60 * 60 * 1000),
      lastBillingAttemptAt: new Date(),
    },
  });
  res.json({ ok: true, chargedIls: amountIls, creditedIls: creditIls });
});

/** Tops up the prepaid wallet used for metered add-ons (extra WhatsApp/SMS sends beyond the plan). */
payplusBillingRouter.post("/payplus/wallet/topup", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ amountIls: z.number().int().positive().max(1000), returnUrl: z.string().url().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });

  // Same fallback as the annual switch: no saved card is a reason to show a payment page, not a
  // reason to tell a paying customer they have no subscription.
  if (!business.subscriptionToken) {
    const returnUrl = parsed.data.returnUrl ?? `${APP_URL}/dashboard/billing`;
    try {
      const url = await createWalletTopupLink(business.id, parsed.data.amountIls, returnUrl);
      return res.json({ url });
    } catch (err) {
      console.error("PayPlus wallet checkout failed:", err);
      captureError(err, { businessId: business.id, kind: "payplusWalletCheckout" });
      const detail = explainPayPlusError(err instanceof Error ? err.message : String(err));
      return res.status(502).json({ error: `יצירת קישור התשלום נכשלה. ${detail}` });
    }
  }

  const token = decryptSecret(business.subscriptionToken);
  let result;
  try {
    result = await chargeSubscriptionToken(token, parsed.data.amountIls, "תורי — טעינת ארנק להודעות");
  } catch (err) {
    if (err instanceof PayPlusTerminalNotConfiguredError) return res.status(503).json({ error: "חיוב בכרטיס שמור אינו מוגדר בשרת. פנו לתמיכה." });
    throw err;
  }
  if (!result.success) return res.status(502).json({ error: `טעינת הארנק נכשלה. ${explainPayPlusError(result.error ?? "")}` });

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
  if (business.subscriptionPlan === parsed.data.plan) return res.json({ ok: true });

  // Proration needs both a saved card and a known cycle end. Without either, the honest move is a
  // hosted page for a fresh period on the new plan rather than an English dead end.
  if (!business.subscriptionToken || !business.subscriptionPlan || !business.nextBillingDate) {
    const cycle = business.billingCycle === "annual" ? "annual" : "monthly";
    try {
      // Same rule as the token path below, which charges only the difference in daily rates: the
      // unused remainder of the current plan comes off a fresh period on the new one.
      const credit = unusedCreditIls(business);
      const url = await createSubscriptionCheckoutLink(
        business.id,
        parsed.data.plan,
        `${APP_URL}/dashboard/billing`,
        cycle,
        chargeAfterCredit(planPriceForCycle(parsed.data.plan, cycle), credit)
      );
      return res.json({ url, creditedIls: credit });
    } catch (err) {
      console.error("PayPlus plan-change checkout failed:", err);
      captureError(err, { businessId: business.id, kind: "payplusPlanChangeCheckout" });
      const detail = explainPayPlusError(err instanceof Error ? err.message : String(err));
      return res.status(502).json({ error: `יצירת קישור התשלום נכשלה. ${detail}` });
    }
  }

  const oldDaily = PLAN_PRICES_ILS[business.subscriptionPlan] / 30;
  const newDaily = PLAN_PRICES_ILS[parsed.data.plan] / 30;
  const daysRemaining = Math.max(0, Math.ceil((business.nextBillingDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  const proratedDiff = Math.round((newDaily - oldDaily) * daysRemaining);

  if (proratedDiff > 0) {
    const token = decryptSecret(business.subscriptionToken);
    let result;
    try {
      result = await chargeSubscriptionToken(token, proratedDiff, `תורי — שדרוג תוכנית (${parsed.data.plan})`);
    } catch (err) {
      if (err instanceof PayPlusTerminalNotConfiguredError) return res.status(503).json({ error: "חיוב בכרטיס שמור אינו מוגדר בשרת. פנו לתמיכה." });
      throw err;
    }
    if (!result.success) return res.status(502).json({ error: `חיוב ההפרש נכשל. ${explainPayPlusError(result.error ?? "")}` });
  }

  await prisma.business.update({ where: { id: business.id }, data: { subscriptionPlan: parsed.data.plan } });
  res.json({ ok: true, proratedChargeIls: Math.max(0, proratedDiff) });
});

/**
 * Where the customer's browser lands after paying a billing checkout.
 *
 * PayPlus redirects to refURL_success with a POST. A Next.js page route only answers GET, so the
 * customer who had just paid — and had the PayPlus email to prove it — was shown a bare
 * "HTTP ERROR 405" as the very first thing after handing over money. This trampoline accepts any
 * method and answers 303 See Other, which the browser follows with a clean GET.
 *
 * Registered BEFORE the /:secret routes so the two-segment path cannot be captured by them. The
 * destination is confined to the dashboard's own origin — an open redirect on a payment return
 * URL is a phishing primitive, so anything else falls back to the billing page.
 */
payplusBillingWebhookRouter.all("/return/redirect", (req, res) => {
  const fallback = `${APP_URL}/dashboard/billing`;
  const to = typeof req.query.to === "string" ? req.query.to : "";
  let destination = fallback;
  try {
    const parsed = new URL(to);
    if (parsed.origin === new URL(APP_URL).origin) destination = parsed.toString();
  } catch {
    /* not a URL — keep the fallback */
  }
  res.redirect(303, destination);
});

/**
 * Browser-openable check that the callback URL is actually live and the secret matches.
 *
 * The failure it exists for is silent and expensive: a secret that does not match means PayPlus's
 * POST 404s, so the card is charged and nothing is activated or credited, with no trace on our
 * side. Confirming that previously meant crafting a POST by hand, which is not a reasonable thing
 * to ask of the person who needs the answer.
 *
 * Safe to expose. It reveals exactly what a POST to the same URL already reveals — whether the
 * path exists — and does strictly less: GET touches no database and changes no state. Anyone
 * guessing the secret could learn the same thing from the real endpoint, so this adds no oracle
 * that was not already there, and the comparison below is the same timing-safe one.
 */
payplusBillingWebhookRouter.get("/:secret", (req, res) => {
  if (!secretMatches(req.params.secret)) return res.status(404).json({ error: "not found" });
  res.json({
    ok: true,
    message: "Billing webhook is live and the secret matches. PayPlus callbacks will be accepted.",
  });
});

/** Timing-safe compare against the configured secret. Returns false when none is configured, so a
 * missing variable can never be mistaken for a match. */
function secretMatches(given: string): boolean {
  // Trimmed: a pasted trailing newline would otherwise make the configured URL and the compared
  // value disagree, and the only symptom is a 404 on PayPlus's side. See validateEnv.
  const expected = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** PayPlus webhook for the initial checkout — captures the recurring token and activates the
 * subscription. more_info carries "<businessId>:<plan>" set when the link was generated. */
payplusBillingWebhookRouter.post("/:secret", async (req, res) => {
  // Authenticate BEFORE acknowledging. Without this the endpoint activates a subscription for any
  // businessId a caller puts in more_info: POST {status_code:"000", more_info:"<id>:premium:annual"}
  // and that business is on a paid plan for free, forever. The deposit webhook has always verified
  // a per-business secret (webhook/paymentWebhooks.ts); this one was the odd one out.
  //
  // A single shared secret rather than per-business: this webhook is Tori's own PayPlus account,
  // configured once in their dashboard, not something each business sets up.
  if (!process.env.PAYPLUS_BILLING_WEBHOOK_SECRET?.trim()) {
    console.error("[payplus subscription webhook] PAYPLUS_BILLING_WEBHOOK_SECRET is not set — rejecting");
    return res.status(503).json({ error: "not configured" });
  }
  if (!secretMatches(req.params.secret)) {
    console.warn("[payplus subscription webhook] Rejected call with a bad secret");
    return res.status(404).json({ error: "not found" });
  }

  res.status(200).json({ ok: true }); // acknowledge fast, PayPlus retries aggressively on non-2xx

  try {
    // Parsed by the shared walker: PayPlus's documented callback nests these fields under
    // data.transaction, older integrations get them flat, and this webhook must accept both —
    // a shape miss here is a card charged, a 200 acknowledged, and a subscription that never
    // activates, with no retry from PayPlus. See lib/payplusCallback.ts.
    const event = parsePayPlusCallback(req.body);
    if (!event.success) return;

    // Transactions/Charge (renewals, upgrades, token top-ups) requires terminal_uid + cashier_uid,
    // no PayPlus endpoint lists them, and asking the operator to dig them out of the dashboard is
    // one more manual step that can silently not happen. Every successful checkout callback
    // carries both — so record them, and the token charge uses them when the env vars are unset.
    if (event.terminalUid && event.cashierUid) {
      const capture = [
        ["payplus_terminal_uid", event.terminalUid],
        ["payplus_cashier_uid", event.cashierUid],
      ] as const;
      for (const [key, value] of capture) {
        prisma.systemSetting
          .upsert({ where: { key }, create: { key, value }, update: { value } })
          .catch((err) => console.error(`[payplus subscription webhook] Could not store ${key}:`, err));
      }
    }

    // more_info is a short reference, not the businessId — PayPlus caps the field at 19 characters
    // and a cuid alone is longer. The plan and cycle were parked on the row when the link was made.
    const checkoutRef = event.referenceId;
    const tokenUid = event.tokenUid;
    if (!checkoutRef) {
      console.warn("[payplus subscription webhook] No more_info on the callback — cannot attribute the payment");
      return;
    }

    const business = await prisma.business.findUnique({
      where: { checkoutRef },
      select: { id: true, checkoutPlan: true, checkoutCycle: true, checkoutPurpose: true, checkoutAmountIls: true },
    });
    if (!business) {
      console.warn(`[payplus subscription webhook] No pending checkout for ref ${checkoutRef}`);
      return;
    }

    // Null purpose means a row written before wallet checkouts existed, and those were all
    // subscriptions — an in-flight checkout must not be dropped by this deploy.
    if ((business.checkoutPurpose ?? "subscription") === "wallet") {
      // Credited from the amount WE generated the page for, never from one echoed back in the
      // callback body — that field is attacker-controllable and this one is not.
      if (!business.checkoutAmountIls) {
        console.warn(`[payplus wallet webhook] Pending wallet checkout ${checkoutRef} has no amount — ignoring`);
        return;
      }
      const updated = await prisma.business.update({
        where: { id: business.id },
        data: {
          walletBalanceAgorot: { increment: business.checkoutAmountIls * 100 },
          // Saved so the next top-up is a one-click token charge rather than another hosted page.
          // Only ever set, never cleared: a top-up must not be able to drop a working subscription
          // token just because PayPlus returned none for this transaction.
          ...(tokenUid ? { subscriptionToken: encryptSecret(tokenUid) } : {}),
          // Consumed — leaving it set would let a replayed callback credit the wallet twice.
          checkoutRef: null,
          checkoutPurpose: null,
          checkoutAmountIls: null,
        },
      });
      console.log(
        `[payplus wallet webhook] Credited ₪${business.checkoutAmountIls} to business ${business.id} ` +
          `(balance now ₪${(updated.walletBalanceAgorot / 100).toFixed(2)})`
      );
      return;
    }

    if (!business.checkoutPlan || !PLAN_PRICES_ILS[business.checkoutPlan]) {
      console.warn(`[payplus subscription webhook] No pending plan for ref ${checkoutRef}`);
      return;
    }

    const plan = business.checkoutPlan;
    const billingCycle = business.checkoutCycle === "annual" ? "annual" : "monthly";

    // No token means the charge went through but the card wasn't stored — the subscription is paid
    // for this period and will need a fresh link next time. Activating anyway is right: the customer
    // paid. The nightly job skips businesses with no token, so this can't silently fail to bill.
    if (!tokenUid) {
      console.warn(`[payplus subscription webhook] No token returned for business ${business.id} — activating without one`);
    }

    await prisma.business.update({
      where: { id: business.id },
      data: {
        subscriptionStatus: "active",
        subscriptionPlan: plan,
        subscriptionToken: tokenUid ? encryptSecret(tokenUid) : null,
        billingCycle,
        nextBillingDate: new Date(Date.now() + BILLING_PERIOD_DAYS[billingCycle] * 24 * 60 * 60 * 1000),
        lastBillingAttemptAt: new Date(),
        billingCyclesCompleted: 0,
        // Consumed — leaving it set would let a replayed callback re-activate the subscription.
        checkoutRef: null,
        checkoutPlan: null,
        checkoutCycle: null,
        checkoutPurpose: null,
        checkoutAmountIls: null,
      },
    });
    console.log(`[payplus subscription webhook] Activated ${plan}/${billingCycle} subscription for business ${business.id}`);
  } catch (err) {
    console.error("[payplus subscription webhook] Failed to process event:", err);
    captureError(err, { phase: "payplus subscription webhook" });
  }
});
