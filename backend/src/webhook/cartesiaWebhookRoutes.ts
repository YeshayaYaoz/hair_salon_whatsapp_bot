/**
 * Cartesia's call webhook — what a phone call reports about itself, as it ends.
 *
 * The hourly sync in lib/voiceUsage.ts reads the same calls from the list endpoint and stays as the
 * backstop, because a webhook can be missed and a missed webhook must not become a missing charge.
 * What this adds is not redundancy, though:
 *
 *   - Minutes land in the ledger seconds after the caller hangs up rather than up to an hour later.
 *   - The delivery carries the call's **transcript**, which the list endpoint does not. That is the
 *     only place `tts_ttfb` exists — the agent's real time-to-first-audio on live calls, which
 *     until now could only be approximated by a benchmark against a synthetic prompt — and the only
 *     place `was_interrupted` exists, which is what a bot that talks over people looks like in data.
 *   - `post_call_analysis` brings Cartesia's own summary of what the caller wanted.
 *
 * Authentication is a shared secret Cartesia echoes in `x-webhook-secret`. That is their whole
 * scheme: no signature, no timestamp, so the secret is the entire proof and this endpoint must
 * never do anything with an unverified body — not even log it.
 */
import { asyncRouter } from "../lib/asyncRouter.js";
import { prisma } from "../lib/prisma.js";
import { getAgentCall, type CartesiaCall } from "../lib/cartesiaAdmin.js";
import { recordCall, voiceNumberIndex, transcriptMetrics } from "../lib/voiceUsage.js";

export const cartesiaWebhookRouter = asyncRouter();

interface WebhookBody {
  type?: string;
  call_id?: string;
  webhook_request_id?: string;
  call?: CartesiaCall;
  analysis?: { summary?: string | null };
}

cartesiaWebhookRouter.post("/call", async (req, res) => {
  const secret = process.env.CARTESIA_WEBHOOK_SECRET?.trim();
  const presented = req.header("x-webhook-secret");
  if (!secret || presented !== secret) return res.status(401).json({ error: "Unauthorized" });

  const body = (req.body ?? {}) as WebhookBody;

  // Answered before the work, deliberately. Cartesia retries on 5xx and on a timeout, and a retry
  // of an event we are already handling is a second write racing the first. The unique index makes
  // that safe, but there is no reason to invite it: nothing below needs the caller to wait.
  res.json({ received: true });

  try {
    await handle(body);
  } catch (err) {
    // Never rethrown into the response — it has already been sent. The hourly sync will pick up
    // anything lost here, which is exactly why it was kept.
    console.error(`[cartesiaWebhook] ${body.type} failed:`, err instanceof Error ? err.message : err);
  }
});

async function handle(body: WebhookBody): Promise<void> {
  switch (body.type) {
    case "call_completed":
    case "call_failed": {
      // A failed call still occupied a line and still billed, so it is recorded the same way. What
      // separates the two is end_reason, which is on the record either way.
      if (!body.call) return;
      await recordCall(body.call, await voiceNumberIndex());
      return;
    }

    case "post_call_analysis": {
      const summary = body.analysis?.summary?.trim();
      if (!summary || !body.call_id) return;

      const updated = await prisma.apiUsageEvent.updateMany({
        where: { externalId: body.call_id },
        data: { summary },
      });
      if (updated.count > 0) return;

      // The analysis beat the call_completed it belongs to — the two are separate deliveries and
      // nothing orders them. Fetching the call is what keeps the summary rather than dropping it
      // and waiting for a sync that will never know a summary existed.
      const call = await getAgentCall(body.call_id);
      await recordCall({ ...call, summary }, await voiceNumberIndex());
      return;
    }

    // call_started and call_turn are not handled: a call has no duration until it ends, and every
    // turn of it arrives again inside call_completed's transcript. Subscribing to them would double
    // the delivery volume to learn nothing new.
    default:
      return;
  }
}

/** Exported for the tests, which is the only thing outside this file that needs it. */
export const __testables = { handle, transcriptMetrics };
