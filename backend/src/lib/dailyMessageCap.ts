import { prisma } from "./prisma.js";

/**
 * Per-customer daily ceiling on bot replies.
 *
 * In-conversation replies are deliberately unmetered — blocking one mid-booking would break the
 * product — which left per-business AI spend with no ceiling at all (see aiCostAlerts.ts, which
 * only tells the operator after the fact). This is the one bound that can be placed on it without
 * costing a real customer a real answer: no genuine booking conversation needs a hundred replies in
 * a day, so anything past that is a loop, a bored teenager, or something automated.
 *
 * The cap is per customer rather than per business on purpose. A busy salon legitimately talks to
 * hundreds of people a day, and a business-wide cap would cut the whole line off because one thread
 * misbehaved.
 */
export const DAILY_MESSAGES_PER_CUSTOMER = 100;

/**
 * Rolling 24 hours, not the calendar day.
 *
 * A calendar day hands anyone who hits the cap a full reset at midnight, and puts the reset at the
 * least useful hour. The rolling window also means the customer gets replies back gradually as
 * their earlier messages age out, instead of nothing at all until a fixed boundary.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CapStatus {
  /** True when this message is past the cap and must not reach the model. */
  exceeded: boolean;
  /** True only for the first message past it, so the customer is told once and not on every send. */
  justCrossed: boolean;
  count: number;
}

/**
 * How many replies this customer has had in the window, and whether that is past the cap.
 *
 * Counts replies rather than incoming messages because replies are the thing being paid for: an
 * inbound message that never reaches the model costs nothing, while every reply is output tokens
 * plus a send. It also means a customer firing off twenty messages in a row consumes one reply,
 * not twenty.
 *
 * Manual messages the owner sends from the dashboard are stored as assistant turns too, so they
 * count here. In practice that barely matters — sending one pauses the bot on that thread anyway,
 * so the two limits never apply at once — but a thread the owner has answered by hand a great deal
 * will reach the cap sooner if they later resume the bot.
 *
 * The cap notice itself is sent directly rather than appended as a turn, so it cannot inflate the
 * count that produced it.
 *
 * Called before this turn is persisted, so `count` excludes the reply about to be written — hence
 * the >= comparisons rather than >.
 */
export async function checkDailyCap(businessId: string, customerPhone: string): Promise<CapStatus> {
  const count = await prisma.conversationMessage.count({
    where: {
      businessId,
      phone: customerPhone,
      role: "assistant",
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
  });

  return {
    exceeded: count >= DAILY_MESSAGES_PER_CUSTOMER,
    justCrossed: count === DAILY_MESSAGES_PER_CUSTOMER,
    count,
  };
}
