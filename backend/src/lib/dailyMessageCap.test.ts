import { describe, it, expect, vi, beforeEach } from "vitest";

const count = vi.fn();
vi.mock("./prisma.js", () => ({ prisma: { conversationMessage: { count } } }));

const { checkDailyCap, DAILY_MESSAGES_PER_CUSTOMER } = await import("./dailyMessageCap.js");

beforeEach(() => vi.clearAllMocks());

/**
 * The only bound on per-business AI spend that doesn't cost a real customer a real answer. Bot
 * replies are otherwise unmetered on purpose — blocking one mid-booking would break the product —
 * so this catches the case no genuine booking conversation reaches: a hundred replies in a day.
 */
describe("checkDailyCap", () => {
  it("lets an ordinary conversation through", async () => {
    count.mockResolvedValue(12);
    expect(await checkDailyCap("biz1", "972500000000")).toMatchObject({ exceeded: false, justCrossed: false });
  });

  it("allows exactly the cap, and stops the one after it", async () => {
    // The count excludes the reply about to be written, so the 100th still goes out.
    count.mockResolvedValue(DAILY_MESSAGES_PER_CUSTOMER - 1);
    expect((await checkDailyCap("biz1", "972500000000")).exceeded).toBe(false);

    count.mockResolvedValue(DAILY_MESSAGES_PER_CUSTOMER);
    expect((await checkDailyCap("biz1", "972500000000")).exceeded).toBe(true);
  });

  it("flags the crossing once, so the customer is told once and not on every message", async () => {
    count.mockResolvedValue(DAILY_MESSAGES_PER_CUSTOMER);
    expect((await checkDailyCap("biz1", "972500000000")).justCrossed).toBe(true);

    // Everything past it is silent — a notice per message would be its own send loop.
    count.mockResolvedValue(DAILY_MESSAGES_PER_CUSTOMER + 40);
    const later = await checkDailyCap("biz1", "972500000000");
    expect(later.exceeded).toBe(true);
    expect(later.justCrossed).toBe(false);
  });

  it("counts replies to this customer, in a rolling 24h window", async () => {
    count.mockResolvedValue(0);
    await checkDailyCap("biz1", "972500000000");

    const where = count.mock.calls[0][0].where;
    // Replies, not inbound messages: a reply is output tokens plus a send, an unanswered inbound
    // message costs nothing, and twenty messages in a row should consume one reply and not twenty.
    expect(where).toMatchObject({ businessId: "biz1", phone: "972500000000", role: "assistant" });
    // Rolling, not the calendar day: a fixed boundary hands anyone who hits the cap a full reset
    // at midnight, at the least useful hour of the day.
    const since = where.createdAt.gte as Date;
    expect(Math.round((Date.now() - since.getTime()) / 3_600_000)).toBe(24);
  });

  it("caps per customer, not per business", async () => {
    // A busy salon talks to hundreds of people a day; a business-wide cap would cut the whole line
    // off because one thread misbehaved.
    count.mockResolvedValue(0);
    await checkDailyCap("biz1", "972500000001");
    expect(count.mock.calls[0][0].where.phone).toBe("972500000001");
  });
});
