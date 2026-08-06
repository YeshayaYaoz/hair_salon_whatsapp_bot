import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUR = 60 * 60 * 1000;

/**
 * A thread that has been quiet for two days is over, and feeding its context to the model is worse
 * than having none: the customer is asking about a different visit, but the old dates and the
 * half-finished booking sit above the new message and get answered as if they were current.
 *
 * The drop has to be persisted, not just dropped from the cache — the next fetch takes the most
 * recent turns, and without a stored cutoff the pre-gap ones come back alongside the fresh ones.
 */
describe("idle conversation reset", () => {
  let rows: { role: string; content: string; createdAt: Date }[] = [];
  let updateMany: ReturnType<typeof vi.fn>;
  let resetAt: Date | null = null;

  async function load() {
    vi.resetModules();
    updateMany = vi.fn(async () => ({ count: 1 }));
    vi.doMock("../lib/prisma.js", () => ({
      prisma: {
        customer: {
          findUnique: vi.fn(async () => ({ conversationResetAt: resetAt })),
          updateMany,
        },
        conversationMessage: {
          findMany: vi.fn(async ({ where }: any) => {
            const cutoff = where?.createdAt?.gt as Date | undefined;
            return rows.filter((r) => !cutoff || r.createdAt > cutoff).slice(-16).reverse();
          }),
          create: vi.fn(() => ({ catch: () => {} })),
        },
      },
    }));
    return import("./conversationStore.js");
  }

  beforeEach(() => {
    rows = [];
    resetAt = null;
  });

  it("keeps a conversation that went quiet for less than 48h", async () => {
    const { getHistory } = await load();
    rows = [{ role: "user", content: "יש מקום בשבת?", createdAt: new Date(Date.now() - 40 * HOUR) }];

    const history = await getHistory("biz1", "972500000000");
    expect(history.map((t) => t.content)).toEqual(["יש מקום בשבת?"]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("empties a conversation that has been quiet for more than 48h", async () => {
    const { getHistory } = await load();
    rows = [{ role: "user", content: "יש מקום בשבת?", createdAt: new Date(Date.now() - 50 * HOUR) }];

    expect(await getHistory("biz1", "972500000000")).toEqual([]);
  });

  it("persists the cutoff, so the dropped turns do not come back after a restart", async () => {
    const { getHistory } = await load();
    rows = [{ role: "user", content: "ישן", createdAt: new Date(Date.now() - 50 * HOUR) }];

    await getHistory("biz1", "972500000000");

    // Marking the customer is what makes the drop durable — the transcript rows stay put.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "biz1", phone: "972500000000" } })
    );
    expect(updateMany.mock.calls[0][0].data.conversationResetAt).toBeInstanceOf(Date);
  });

  it("still hands back the live cached array, so appended turns are not lost", async () => {
    const { getHistory, appendTurn } = await load();
    rows = [{ role: "user", content: "ישן", createdAt: new Date(Date.now() - 50 * HOUR) }];

    const history = await getHistory("biz1", "972500000000");
    expect(history).toEqual([]);

    await appendTurn("biz1", "972500000000", { role: "user", content: "היי" });
    // Same array object the caller is holding — the emptied array must be the cached one, not a
    // detached copy, or every turn appended after an idle reset would vanish from the model's view.
    expect(history.map((t) => t.content)).toEqual(["היי"]);
  });

  it("honours an owner reset that is newer than the turns", async () => {
    const { getHistory } = await load();
    rows = [{ role: "user", content: "לפני האיפוס", createdAt: new Date(Date.now() - 2 * HOUR) }];
    resetAt = new Date(Date.now() - HOUR);

    expect(await getHistory("biz1", "972500000000")).toEqual([]);
  });
});
