import { Router } from "express";
import express from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { stripe } from "./stripeClient.js";

export const billingRouter = Router();
export const stripeWebhookRouter = Router();

/** Creates a Stripe Checkout session for the logged-in business to subscribe. */
billingRouter.post("/checkout", requireAuth, async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });

  const customerId =
    business.stripeCustomerId ??
    (await stripe.customers.create({ email: business.email, name: business.name })).id;

  if (!business.stripeCustomerId) {
    await prisma.business.update({ where: { id: business.id }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${req.body.returnUrl}?checkout=success`,
    cancel_url: `${req.body.returnUrl}?checkout=cancelled`,
  });

  res.json({ url: session.url });
});

/** Opens the Stripe-hosted billing portal so a business can update its card, view invoices, or cancel. */
billingRouter.post("/portal", requireAuth, async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.stripeCustomerId) return res.status(400).json({ error: "No billing account yet" });

  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripeCustomerId,
    return_url: req.body.returnUrl,
  });

  res.json({ url: session.url });
});

/** Stripe webhook: keeps Business.subscriptionStatus in sync with the subscription lifecycle. Must receive the raw body for signature verification. */
const stripeWebhookMiddleware = express.raw({ type: "application/json" });

stripeWebhookRouter.post("/", stripeWebhookMiddleware, async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature as string, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return res.sendStatus(400);
  }

  switch (event.type) {
    // The session payload has no subscription "status" field (it has "complete"/"open"/"expired"
    // instead) — pull the real subscription to get its actual status rather than misreading the session's.
    case "checkout.session.completed": {
      const session = event.data.object as { customer: string; subscription: string | null };
      if (!session.subscription) break;
      const sub = await stripe.subscriptions.retrieve(session.subscription);
      await prisma.business.updateMany({
        where: { stripeCustomerId: session.customer },
        data: { subscriptionStatus: mapStripeStatus(sub.status), stripeSubscriptionId: sub.id },
      });
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as { customer: string; status?: string; id?: string };
      await prisma.business.updateMany({
        where: { stripeCustomerId: subscription.customer },
        data: { subscriptionStatus: mapStripeStatus(subscription.status), stripeSubscriptionId: subscription.id },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as { customer: string };
      await prisma.business.updateMany({
        where: { stripeCustomerId: subscription.customer },
        data: { subscriptionStatus: "canceled" },
      });
      break;
    }
  }

  res.json({ received: true });
});

function mapStripeStatus(stripeStatus?: string): string {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  if (stripeStatus === "canceled") return "canceled";
  return "trial";
}
