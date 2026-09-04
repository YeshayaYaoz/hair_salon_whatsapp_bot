import { asyncRouter } from "../lib/asyncRouter.js";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import {
  createSubscriptionCheckoutLink,
  createWalletTopupLink,
  createPaymentMethodLink,
  CARD_ON_FILE_CHARGE_ILS,
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
  lookupCustomerTokens,
} from "./payplusSubscription.js";
import { requireSuperAdmin } from "../api/businessRoutes.js";
import { captureError } from "../lib/errorMonitoring.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import { validateCoupon, redeemCoupon, CouponError, COUPON_FAILURE_HE, normalizeCode } from "./coupons.js";
import { explainPayPlusError } from "../lib/payplusErrors.js";
import { parsePayPlusCallback, keyTree } from "../lib/payplusCallback.js";
import { fmtIls } from "../lib/money.js";

/** Fallback return URL when the caller sends none — the dashboard page these actions start from. */
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Pauses between Token/List attempts after a create_token payment: attempt, wait, attempt, wait,
 * final attempt. The 200 was acknowledged before this starts, so the waits cost PayPlus nothing.
 * Milliseconds under vitest — a webhook test must not take twelve real seconds.
 */
const TOKEN_LIST_RETRY_DELAYS_MS = process.env.VITEST ? [5, 5] : [4000, 8000];

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

  // The parked test card — what the ₪1 token-charge button uses.
  const healthToken = await prisma.systemSetting.findUnique({ where: { key: "payplus_health_token" } });
  checks.push({
    name: "כרטיס בדיקה שמור (token)",
    ok: Boolean(healthToken),
    detail: healthToken
      ? "אפשר להריץ חיוב ₪1 בכרטיס השמור"
      : "ישמר אוטומטית בתשלום ה-₪1 הבא — ואם לא, השורה הבאה אומרת למה",
  });

  // Paying businesses whose renewal would be rejected — a stored card missing the customer_uid
  // that Transactions/Charge requires beside it. This is the failure that stays invisible for a
  // whole billing period: the subscription is active, the money arrived, and nothing goes wrong
  // until the renewal fires weeks later. The nightly job now recovers the id from the token before
  // charging, so a number here is a heads-up rather than an outage — but it should be 0, and if it
  // is not, the recovery is failing too.
  const strandedTokens = await prisma.business.count({
    where: { subscriptionToken: { not: null }, subscriptionCustomerUid: null },
  });
  checks.push({
    name: "כרטיסים שמורים עם מזהה לקוח (חידושים)",
    ok: strandedTokens === 0,
    detail:
      strandedTokens === 0
        ? "כל הכרטיסים השמורים מוכנים לחידוש"
        : `ל-${strandedTokens} עסקים יש כרטיס שמור בלי customer_uid. החיוב הלילי ישלים אותו מהטוקן לפני הגבייה, ` +
          `אבל אם המספר לא יורד אחרי הריצה הבאה — Token/View נכשל וצריך לבדוק את זה`,
  });

  // Active, on a plan, and no card on file at all — so the next renewal has nothing to charge.
  // Distinct from the row above: there the card exists and is merely missing its customer_uid,
  // which the nightly job repairs by itself. Here there is nothing to repair, and only the owner
  // can fix it by entering a card. The job now duns these instead of passing over them, so the
  // owner is told — but this is where it is visible before their renewal date arrives.
  const noCardBusinesses = await prisma.business.findMany({
    where: { subscriptionStatus: "active", subscriptionPlan: { not: null }, subscriptionToken: null },
    select: { name: true, nextBillingDate: true },
    orderBy: { nextBillingDate: "asc" },
    take: 10,
  });
  const noCardCount = await prisma.business.count({
    where: { subscriptionStatus: "active", subscriptionPlan: { not: null }, subscriptionToken: null },
  });
  checks.push({
    name: "מנויים פעילים עם אמצעי תשלום",
    ok: noCardCount === 0,
    detail:
      noCardCount === 0
        ? "לכל מנוי פעיל יש כרטיס שמור לחידוש"
        : `ל-${noCardCount} מנויים פעילים אין כרטיס שמור, כך שהחידוש שלהם לא ייגבה: ` +
          noCardBusinesses
            .map(
              (b) =>
                `${b.name}${
                  b.nextBillingDate
                    ? // Explicit zone, not toISOString().slice(0,10): the server runs UTC, and a
                      // renewal dated the 1st at 01:00 Israel time would otherwise be shown as the
                      // previous month.
                      ` (${b.nextBillingDate.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" })})`
                    : ""
                }`
            )
            .join(", ") +
          (noCardCount > noCardBusinesses.length ? ` ועוד ${noCardCount - noCardBusinesses.length}` : ""),
  });

  // What actually happened on the last callback — the webhook records every hop of the token
  // capture, so "paid and the card still was not saved" is diagnosable from this page instead of
  // from production logs.
  const lastDebug = await prisma.systemSetting.findUnique({ where: { key: "payplus_last_callback_debug" } });
  if (lastDebug) {
    let d: {
      at?: string; ref?: string | null; success?: boolean; hasCustomer?: boolean;
      tokenInCallback?: boolean; tokenViaList?: boolean;
      tokenListCount?: number; tokenListError?: string | null; shape?: string;
    } = {};
    try { d = JSON.parse(lastDebug.value); } catch { /* an unreadable record reports itself below */ }
    const when = d.at ? new Date(d.at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "";
    const gotToken = Boolean(d.tokenInCallback || d.tokenViaList);
    let detail: string;
    if (!d.at) detail = "רשומת האבחון לא נקראה — פנו לתמיכה";
    else if (d.success === false) detail = `${when} — העסקה עצמה לא הצליחה (כרטיס נדחה?), אז אין כרטיס לשמור`;
    else if (gotToken) detail = `${when} — כרטיס נשמר ונקלט`;
    else if (!d.hasCustomer)
      detail = `${when} — ה-callback הגיע בלי customer_uid, אי אפשר לאתר את הכרטיס. מבנה: ${d.shape ?? "?"}`;
    else if (d.tokenListError && /NO ACCESS/i.test(d.tokenListError))
      // Seen live: HTTP 422 {"message":"NO ACCESS FOR THIS COMPANY"} — the company has no access
      // to the Tokens API at all. Only PayPlus support can grant it; nothing on our side to fix.
      detail =
        `${when} — התשלום עבר, אבל לחשבון ה-PayPlus אין גישה ל-API הטוקנים (NO ACCESS FOR THIS COMPANY). ` +
        `בקשו מתמיכת PayPlus להפעיל טוקניזציה — שמירת כרטיסים לחיוב עתידי + גישה ל-API של Tokens — ואז שלמו שוב דף ₪1`;
    else if (d.tokenListError) detail = `${when} — Token/List נכשל: ${d.tokenListError}`;
    else if (d.tokenListCount === 0)
      detail =
        `${when} — התשלום עבר אבל Token/List החזיר 0 כרטיסים גם אחרי המתנה. ` +
        `כמעט בוודאות שמירת כרטיסים (טוקניזציה) לא פעילה במסוף — בקשו מתמיכת PayPlus להפעיל אותה, ואז שלמו שוב דף ₪1`;
    else detail = `${when} — לא נשמר כרטיס מסיבה לא מזוהה. מבנה: ${d.shape ?? "?"}`;
    checks.push({ name: "ה-callback האחרון מ-PayPlus", ok: gotToken && d.success !== false, detail });
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

/**
 * Charges ₪1 on the parked test card — the exact code path of a renewal (Transactions/Charge with
 * use_token and the captured terminal/cashier), for the price of a shekel, touching no business's
 * wallet or subscription. The operator is charging their own card from their own admin page.
 */
payplusBillingRouter.post("/payplus/health/charge-token", requireAuth, requireSuperAdmin, async (_req: AuthedRequest, res) => {
  const stored = await prisma.systemSetting.findUnique({ where: { key: "payplus_health_token" } });
  if (!stored) {
    return res.status(409).json({ error: "אין עדיין כרטיס בדיקה שמור — שלמו קודם דף ₪1 מהכרטיס הזה." });
  }
  const storedCustomer = await prisma.systemSetting.findUnique({ where: { key: "payplus_health_customer_uid" } });
  try {
    const result = await chargeSubscriptionToken(
      decryptSecret(stored.value),
      1,
      "תורי — בדיקת חיוב בכרטיס שמור (₪1)",
      storedCustomer?.value
    );
    if (!result.success) return res.status(502).json({ error: `החיוב נכשל: ${explainPayPlusError(result.error ?? "")}` });
    res.json({ ok: true, transactionId: result.transactionId });
  } catch (err) {
    if (err instanceof PayPlusTerminalNotConfiguredError) {
      return res.status(503).json({ error: "חסרים terminal/cashier — הם נלכדים מאותו תשלום ₪1, נסו לרענן ולבדוק שוב." });
    }
    throw err;
  }
});

// --- Coupon administration. Operator only: these create money-off codes. ---

payplusBillingRouter.get("/payplus/coupons", requireAuth, requireSuperAdmin, async (_req: AuthedRequest, res) => {
  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      // Who used it, not just how many — "which businesses came in on LAUNCH50" is the question
      // this screen exists to answer.
      redemptions: {
        orderBy: { redeemedAt: "desc" },
        select: { discountIls: true, plan: true, redeemedAt: true, business: { select: { id: true, name: true } } },
      },
    },
  });
  res.json(coupons);
});

payplusBillingRouter.post("/payplus/coupons", requireAuth, requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      // Letters, digits, dash and underscore only: a code is typed by hand off a poster or a
      // WhatsApp message, and anything else invites an invisible mismatch (a Hebrew dash, a
      // trailing space) that reads as "the code doesn't work".
      code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
      discountType: z.enum(["percent", "fixed"]),
      discountValue: z.number().int().positive(),
      durationCycles: z.number().int().positive().nullable().optional(),
      maxRedemptions: z.number().int().positive().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      allowedPlans: z.array(z.enum(["standard", "premium", "ultra"])).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .refine((v) => v.discountType !== "percent" || v.discountValue <= 100, {
      message: "A percentage discount cannot exceed 100.",
      path: ["discountValue"],
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const code = normalizeCode(parsed.data.code);
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) return res.status(409).json({ error: `הקוד ${code} כבר קיים.` });

  const coupon = await prisma.coupon.create({
    data: {
      code,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      durationCycles: parsed.data.durationCycles ?? null,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      allowedPlans: parsed.data.allowedPlans ?? [],
      note: parsed.data.note ?? null,
    },
  });
  res.status(201).json(coupon);
});

/**
 * Deactivates a code. Never deletes it: businesses already on its discount hold a reference, and
 * "which promo did this customer come in on" has to stay answerable after the campaign ends.
 * Existing redemptions keep working — switching a code off stops NEW redemptions, it does not
 * take a discount away from someone who already paid on it.
 */
payplusBillingRouter.post("/payplus/coupons/:id/deactivate", requireAuth, requireSuperAdmin, async (req: AuthedRequest, res) => {
  const updated = await prisma.coupon.updateMany({ where: { id: req.params.id }, data: { active: false } });
  if (updated.count === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

payplusBillingRouter.post("/payplus/coupons/:id/activate", requireAuth, requireSuperAdmin, async (req: AuthedRequest, res) => {
  const updated = await prisma.coupon.updateMany({ where: { id: req.params.id }, data: { active: true } });
  if (updated.count === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

/**
 * Tells the owner what a code is worth before they commit to anything.
 *
 * Read-only: nothing is consumed until the payment webhook redeems it. A rejected code answers 200
 * with ok:false rather than a 4xx — "this code is expired" is a successful answer to the question
 * asked, and the shared apiFetch turns any non-2xx into a thrown error with no body to read.
 */
payplusBillingRouter.post("/payplus/coupon/preview", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ code: z.string().trim().min(1).max(40), plan: z.enum(["standard", "premium", "ultra"]) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const preview = await validateCoupon(parsed.data.code, parsed.data.plan, req.businessId!);
    return res.json({ ok: true, ...preview });
  } catch (err) {
    if (err instanceof CouponError) return res.json({ ok: false, reason: err.reason, message: COUPON_FAILURE_HE[err.reason] });
    throw err;
  }
});

/** Creates a PayPlus checkout link that charges the first period AND captures a recurring token. */
payplusBillingRouter.post("/payplus/checkout", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      plan: z.enum(["standard", "premium", "ultra"]),
      returnUrl: z.string().url(),
      cycle: z.enum(["monthly", "annual"]).optional(),
      couponCode: z.string().trim().max(40).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Re-validated here rather than trusted from the client: the preview call that showed the owner
  // a discount happened at a different moment, and a code can expire or be exhausted in between.
  // A bad code fails the checkout outright instead of quietly charging full price — the owner
  // entered it deliberately and would otherwise discover it on their card statement.
  let coupon: { code: string; discountIls: number } | undefined;
  if (parsed.data.couponCode) {
    try {
      const preview = await validateCoupon(parsed.data.couponCode, parsed.data.plan, req.businessId!);
      coupon = { code: preview.code, discountIls: preview.discountIls };
    } catch (err) {
      if (err instanceof CouponError) {
        return res.status(400).json({ error: COUPON_FAILURE_HE[err.reason], couponRejected: true });
      }
      throw err;
    }
  }

  try {
    const url = await createSubscriptionCheckoutLink(
      req.businessId!,
      parsed.data.plan,
      parsed.data.returnUrl,
      parsed.data.cycle ?? "monthly",
      undefined,
      coupon
    );
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
    result = await chargeSubscriptionToken(token, amountIls, "תורי — מעבר למנוי שנתי", business.subscriptionCustomerUid ?? undefined);
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
    result = await chargeSubscriptionToken(token, parsed.data.amountIls, "תורי — טעינת ארנק להודעות", business.subscriptionCustomerUid ?? undefined);
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

/**
 * Starts a hosted page whose only job is to save a card.
 *
 * Returns a URL in every case, including for a business that already has a card saved: replacing
 * an expired one is the same operation, and refusing it would leave the owner with no way to fix
 * a card that is about to start failing.
 */
payplusBillingRouter.post("/payplus/payment-method", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ returnUrl: z.string().url().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const returnUrl = parsed.data.returnUrl ?? `${APP_URL}/dashboard/billing`;
  try {
    const url = await createPaymentMethodLink(req.businessId!, returnUrl);
    res.json({ url, chargeIls: CARD_ON_FILE_CHARGE_ILS });
  } catch (err) {
    console.error("PayPlus payment-method checkout failed:", err);
    captureError(err, { businessId: req.businessId, kind: "payplusPaymentMethod" });
    if (err instanceof PayPlusBillingNotConfiguredError) {
      return res.status(503).json({ error: "חיוב מנויים אינו מוגדר בשרת. פנו לתמיכה." });
    }
    const detail = explainPayPlusError(err instanceof Error ? err.message : String(err));
    return res.status(502).json({ error: `יצירת קישור התשלום נכשלה. ${detail}` });
  }
});

/** Upgrades/downgrades the plan and charges a prorated top-up immediately for the remainder of
 * the current billing period — the next scheduled charge picks up the new plan price automatically. */
payplusBillingRouter.put("/payplus/plan", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ plan: z.enum(["standard", "premium", "ultra"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (business.subscriptionPlan === parsed.data.plan) {
    // Asking for the plan they are already on is how a scheduled downgrade gets called off: the
    // dashboard offers it as "keep Ultra", and without this the click would do nothing at all
    // while the downgrade stayed armed for the next renewal.
    if (business.scheduledPlan) {
      await prisma.business.update({ where: { id: business.id }, data: { scheduledPlan: null } });
      return res.json({ ok: true, scheduledPlanCancelled: true });
    }
    return res.json({ ok: true });
  }

  /**
   * A downgrade is scheduled, not taken.
   *
   * It used to switch the plan on the spot, which quietly forfeited the rest of a period the
   * business had already paid for — dropping from Ultra on the second day of a month cost 28 days
   * of Ultra, and on an annual term it could cost most of a year. Nothing charged them for that;
   * they simply stopped receiving what they had bought.
   *
   * So the plan stays as it is until the period ends, and the nightly charge moves them then, at
   * the lower price. Read before the token/proration branches below because it needs neither: no
   * money changes hands today either way.
   */
  const isDowngrade =
    !!business.subscriptionPlan &&
    !!PLAN_PRICES_ILS[business.subscriptionPlan] &&
    PLAN_PRICES_ILS[parsed.data.plan] < PLAN_PRICES_ILS[business.subscriptionPlan];

  if (isDowngrade && business.subscriptionStatus === "active" && business.nextBillingDate) {
    await prisma.business.update({
      where: { id: business.id },
      data: { scheduledPlan: parsed.data.plan },
    });
    return res.json({
      ok: true,
      scheduledPlan: parsed.data.plan,
      scheduledFor: business.nextBillingDate,
      proratedChargeIls: 0,
    });
  }

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

  // Rate and remaining days must come from the SAME period, which they did not.
  //
  // The daily rate was the monthly list price over 30, while daysRemaining is however long is left
  // of the actual cycle — up to 365 on an annual term. So an annual subscriber upgrading
  // Premium → Ultra with a year to run was charged (749.90 − 374.90)/30 × 365 = ₪4,562.50, against
  // a true difference of (7,499 − 3,749) = ₪3,750. An overcharge of ₪812.50, on the customers who
  // had paid furthest in advance, taken instantly from a saved card.
  const cycle = business.billingCycle === "annual" ? "annual" : "monthly";
  const periodDays = BILLING_PERIOD_DAYS[cycle];
  const oldDaily = planPriceForCycle(business.subscriptionPlan, cycle) / periodDays;
  const newDaily = planPriceForCycle(parsed.data.plan, cycle) / periodDays;
  const daysRemaining = Math.max(0, Math.ceil((business.nextBillingDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  const proratedDiff = Math.round((newDaily - oldDaily) * daysRemaining);

  if (proratedDiff > 0) {
    const token = decryptSecret(business.subscriptionToken);
    let result;
    try {
      result = await chargeSubscriptionToken(
        token,
        proratedDiff,
        `תורי — שדרוג תוכנית (${parsed.data.plan})`,
        business.subscriptionCustomerUid ?? undefined
      );
    } catch (err) {
      if (err instanceof PayPlusTerminalNotConfiguredError) return res.status(503).json({ error: "חיוב בכרטיס שמור אינו מוגדר בשרת. פנו לתמיכה." });
      throw err;
    }
    if (!result.success) return res.status(502).json({ error: `חיוב ההפרש נכשל. ${explainPayPlusError(result.error ?? "")}` });
  }

  // Clears any downgrade already armed: an owner who schedules Standard and then upgrades to Ultra
  // has changed their mind, and leaving the old instruction in place would drop them to Standard at
  // the next renewal — days after paying to go up.
  await prisma.business.update({
    where: { id: business.id },
    data: { subscriptionPlan: parsed.data.plan, scheduledPlan: null },
  });
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

    // Every hop of the token capture, persisted — the one place this can be debugged from is the
    // admin health card, because a webhook failure leaves nothing user-visible and PayPlus does
    // not retry an acknowledged 200. Keys and booleans only: the payload's values are a
    // customer's name, email and card digits, and this record is shown on an admin page.
    const debug: Record<string, unknown> = {
      at: new Date().toISOString(),
      ref: event.referenceId ?? null,
      success: event.success,
      amountIls: event.amountIls ?? null,
      hasTerminal: Boolean(event.terminalUid),
      hasCashier: Boolean(event.cashierUid),
      hasCustomer: Boolean(event.customerUid),
      tokenInCallback: Boolean(event.tokenUid),
      shape: keyTree(req.body),
    };
    const persistDebug = () =>
      prisma.systemSetting
        .upsert({
          where: { key: "payplus_last_callback_debug" },
          create: { key: "payplus_last_callback_debug", value: JSON.stringify(debug) },
          update: { value: JSON.stringify(debug) },
        })
        .catch((err) => console.error("[payplus subscription webhook] Could not store callback debug:", err));

    if (!event.success) {
      await persistDebug();
      return;
    }

    // The callback never carries the token. Verified across PayPlus's entire documentation and
    // with a real paid checkout: create_token stores the card, but the token is only retrievable
    // via Token/List, filtered by the customer_uid the callback does carry. Fetch it here — the
    // 200 was already acknowledged above, so this costs the caller nothing. Retried with a pause:
    // the callback fires at transaction time and nothing promises the stored card is listable in
    // the same instant.
    // The terminal belongs to our PayPlus account, not to this transaction, so a callback that
    // omits it is no reason to abandon the lookup — the configured or previously captured one is
    // the same terminal. Only customer_uid is genuinely per-payer and irreplaceable here.
    const lookupTerminal = event.terminalUid ?? (await resolveTerminalConfig()).terminalUid;
    debug.terminalViaConfig = !event.terminalUid && Boolean(lookupTerminal);
    if (!event.tokenUid && lookupTerminal && event.customerUid) {
      for (let attempt = 0; attempt <= TOKEN_LIST_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, TOKEN_LIST_RETRY_DELAYS_MS[attempt - 1]));
        try {
          const lookup = await lookupCustomerTokens(lookupTerminal, event.customerUid);
          debug.tokenListCount = lookup.count;
          debug.tokenListError = lookup.error ?? null;
          if (lookup.token) {
            event.tokenUid = lookup.token;
            break;
          }
        } catch (err) {
          debug.tokenListError = err instanceof Error ? err.message : String(err);
          console.warn("[payplus subscription webhook] Token/List lookup failed:", err);
        }
      }
    }
    debug.tokenViaList = Boolean(event.tokenUid) && !debug.tokenInCallback;
    if (!event.tokenUid) {
      // Either tokenization is not enabled on the PayPlus account (their support toggles it), or
      // the payload changed shape again. The keys-only tree (no values — the payload carries the
      // customer's card digits and email) separates the two without another round of guessing.
      console.warn(
        `[payplus subscription webhook] No token via callback or Token/List — if this repeats, ask PayPlus support ` +
          `to enable tokenization (טוקניזציה) on the terminal. Payload shape: ${keyTree(req.body)}`
      );
    }
    await persistDebug();

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

    // The ₪1 health payment: park the recovered token as the operator's test card, so the admin
    // page can charge ₪1 through the exact code renewals use — the cheapest possible live test of
    // Transactions/Charge. No business row is involved.
    if (event.referenceId === "billing-health") {
      if (event.tokenUid) {
        await prisma.systemSetting.upsert({
          where: { key: "payplus_health_token" },
          create: { key: "payplus_health_token", value: encryptSecret(event.tokenUid) },
          update: { value: encryptSecret(event.tokenUid) },
        });
        // PayPlus's own token-charge example sends customer_uid alongside the token, so the ₪1
        // test does too. Not a secret — it is PayPlus's opaque id for the health-check customer.
        if (event.customerUid) {
          await prisma.systemSetting.upsert({
            where: { key: "payplus_health_customer_uid" },
            create: { key: "payplus_health_customer_uid", value: event.customerUid },
            update: { value: event.customerUid },
          });
        }
        console.log("[payplus subscription webhook] Health payment token parked for the ₪1 token-charge test");
      }
      return;
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
      select: { id: true, checkoutPlan: true, checkoutCycle: true, checkoutPurpose: true, checkoutAmountIls: true, checkoutCouponCode: true },
    });
    if (!business) {
      console.warn(`[payplus subscription webhook] No pending checkout for ref ${checkoutRef}`);
      return;
    }

    // Saving a card, not buying anything. The shekel the page had to charge is credited to the
    // wallet rather than kept — the owner was told that before they paid, and a verification
    // charge that quietly stays ours is the kind of thing that ends up in a chargeback.
    //
    // Deliberately does NOT touch subscriptionStatus, plan or nextBillingDate: an owner adding a
    // card is not subscribing, and a lapsed business that saves one must not be silently
    // reactivated without a charge for the period.
    if (business.checkoutPurpose === "card") {
      if (!tokenUid) {
        // The one outcome worth shouting about: they paid the shekel and we got no card, so the
        // page they came from will still say no payment method is saved. Nothing to undo, but
        // the reason has to be findable when they ask why it did not work.
        console.warn(`[payplus card webhook] No token returned for business ${business.id} — card NOT saved`);
      }
      await prisma.business.update({
        where: { id: business.id },
        data: {
          ...(tokenUid ? { subscriptionToken: encryptSecret(tokenUid), subscriptionCustomerUid: event.customerUid ?? null } : {}),
          ...(business.checkoutAmountIls ? { walletBalanceAgorot: { increment: business.checkoutAmountIls * 100 } } : {}),
          checkoutRef: null,
          checkoutPurpose: null,
          checkoutAmountIls: null,
        },
      });
      if (tokenUid) console.log(`[payplus card webhook] Saved a payment method for business ${business.id}`);
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
          // token just because PayPlus returned none for this transaction. The customer_uid moves
          // with it — charging the token without it is rejected.
          ...(tokenUid ? { subscriptionToken: encryptSecret(tokenUid), subscriptionCustomerUid: event.customerUid ?? null } : {}),
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
        // Only ever set, never cleared — the same rule the wallet branch above follows, and for a
        // sharper reason. Nothing else in the codebase ever nulls subscriptionToken, so a lapsed
        // business still holds the card that used to work; coming back through a hosted page is
        // exactly how it re-subscribes. Writing null here on a callback that returned no token
        // (PayPlus omitted it, or the Token/List recovery above timed out — it retries because
        // listing is not instant) would throw that working card away and leave a customer who has
        // just paid with an active subscription the nightly job then refuses to renew.
        ...(tokenUid ? { subscriptionToken: encryptSecret(tokenUid), subscriptionCustomerUid: event.customerUid ?? null } : {}),
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
        checkoutCouponCode: null,
      },
    });

    // After activation, never before: the discount was already taken off the amount they just
    // paid, and redeeming earlier would consume a limited code for a checkout that was abandoned.
    // Failure here cannot undo a completed payment, so it is logged and the subscription stands —
    // the business is active either way, and a missing recurring discount is a support fix.
    if (business.checkoutCouponCode) {
      const result = await redeemCoupon(business.checkoutCouponCode, plan, business.id);
      console.log(
        result.applied
          ? `[payplus subscription webhook] Redeemed coupon ${business.checkoutCouponCode} (−₪${result.discountIls}) for ${business.id}`
          : `[payplus subscription webhook] Coupon ${business.checkoutCouponCode} not redeemed for ${business.id}: ${result.reason}`
      );
    }
    console.log(`[payplus subscription webhook] Activated ${plan}/${billingCycle} subscription for business ${business.id}`);

    // Tell the operator a sale happened. This was only ever a console line, so the one event the
    // business most needs to know about — money arriving — was invisible unless someone happened
    // to be reading logs. Sent after the activation is committed, and never allowed to fail it:
    // the subscription is live either way, and a missing email is not worth a webhook retry that
    // could re-run everything above.
    try {
      const paid = await prisma.business.findUnique({
        where: { id: business.id },
        select: { name: true, email: true, couponCode: true, couponDiscountIls: true },
      });
      const priceIls = PLAN_PRICES_ILS[plan] ?? 0;
      const cycleLabel = billingCycle === "annual" ? "שנתי" : "חודשי";
      await sendAdminAlertEmail(
        `💰 מנוי חדש: ${paid?.name ?? business.id} — ${plan} (${cycleLabel})`,
        `<h2>${paid?.name ?? business.id} נרשמו ל-${plan}</h2>
         <ul>
           <li>תוכנית: <strong>${plan}</strong> · חיוב ${cycleLabel}</li>
           <li>מחיר מחירון: ₪${fmtIls(priceIls)}</li>
           ${paid?.couponCode ? `<li>קופון: <strong>${paid.couponCode}</strong> (−₪${fmtIls(paid.couponDiscountIls)} לחיוב)</li>` : ""}
           <li>אימייל: ${paid?.email ?? "—"}</li>
           <li>מזהה עסק: <code>${business.id}</code></li>
         </ul>`
      );
    } catch (err) {
      console.error("[payplus subscription webhook] Could not send the new-subscription alert:", err);
    }
  } catch (err) {
    console.error("[payplus subscription webhook] Failed to process event:", err);
    captureError(err, { phase: "payplus subscription webhook" });
  }
});
