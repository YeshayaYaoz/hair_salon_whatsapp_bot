import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The greeting button and quick replies are both gated on BotResult.isFirstReply, and it was read
 * at the end of handleIncomingMessage as `history.length === 0`.
 *
 * conversationStore caches turns and returns the array itself, and appendTurn pushes into that
 * same array — so the two turns written just above the return were already in `history` by the
 * time it was measured. The flag was false for every message ever sent, including the genuine
 * first one, and neither interactive element could appear for any business. Nothing errored: the
 * webhook simply took the plain-text branch every time.
 *
 * This test pins the aliasing itself, because that is what made the bug invisible.
 */
describe("conversationStore aliasing", () => {
  const turns: { role: string; content: string; at?: Date }[] = [];

  beforeEach(() => {
    turns.splice(0);
    vi.resetModules();
  });

  it("hands back the live cached array, so callers must snapshot before appending", async () => {
    vi.doMock("../lib/prisma.js", () => ({
      prisma: {
        conversationMessage: {
          findMany: vi.fn(async () => turns.map((t) => ({ ...t, createdAt: new Date() }))),
          create: vi.fn(() => ({ catch: () => {} })),
        },
      },
    }));
    const { getHistory, appendTurn } = await import("./conversationStore.js");

    const history = await getHistory("biz1", "972500000000");
    expect(history.length).toBe(0);

    await appendTurn("biz1", "972500000000", { role: "user", content: "שלום" });
    await appendTurn("biz1", "972500000000", { role: "assistant", content: "היי!" });

    // The reference the caller is still holding has grown underneath it. Reading `.length === 0`
    // here — as handleIncomingMessage used to — reports "not a first reply" for a brand-new chat.
    expect(history.length).toBe(2);
  });
});
