import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../lib/depositExpiryJob.js", () => ({ noteDepositHoldCreated: vi.fn() }));

import { opensNewConversation } from "./claudeBot.js";
import type { Turn } from "./conversationStore.js";

const now = new Date("2026-08-05T12:00:00Z");
const ago = (ms: number): Turn[] => [{ role: "user", content: "היי", at: new Date(now.getTime() - ms) }];

const HOUR = 60 * 60 * 1000;

/**
 * Decides whether the greeting button and quick replies are attached. Previously this was "this
 * number has never written before", so a returning customer saw the opening message once ever and
 * the owner could never reproduce it while testing.
 */
describe("opensNewConversation", () => {
  it("treats an empty history as a new conversation", () => {
    // Also the post-reset case: the owner's reset hides earlier turns, so history comes back empty.
    expect(opensNewConversation([], now)).toBe(true);
  });

  it("continues a conversation that is still inside the 24h window", () => {
    expect(opensNewConversation(ago(HOUR), now)).toBe(false);
    expect(opensNewConversation(ago(23 * HOUR), now)).toBe(false);
  });

  it("opens a new conversation once the thread has been quiet for over 24h", () => {
    expect(opensNewConversation(ago(25 * HOUR), now)).toBe(true);
    expect(opensNewConversation(ago(30 * 24 * HOUR), now)).toBe(true);
  });

  it("measures from the most recent turn, not the first", () => {
    const history: Turn[] = [
      { role: "user", content: "ישן", at: new Date(now.getTime() - 40 * HOUR) },
      { role: "assistant", content: "חדש", at: new Date(now.getTime() - HOUR) },
    ];
    expect(opensNewConversation(history, now)).toBe(false);
  });

  it("does not re-greet on an undated turn", () => {
    // Turns written before timestamps were persisted. Staying silent is the safer failure: a
    // spurious greeting mid-conversation reads as the bot having lost the thread.
    expect(opensNewConversation([{ role: "user", content: "היי" }], now)).toBe(false);
  });
});

/**
 * The owner phoned their own line and then wrote "שלום" — and got no opening message, no greeting
 * button and no quick replies, because the call had been written into this same history minutes
 * earlier and the flag that gates all three read it as a recent turn.
 */
describe("opensNewConversation ignores the voice channel", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("greets someone whose only history is a phone call", () => {
    const history = [
      { role: "user" as const, content: "📞 יש לכם צימר לסופ״ש?", at: minutesAgo(20), channel: "voice" },
      { role: "assistant" as const, content: "יש שתי יחידות", at: minutesAgo(19), channel: "voice" },
    ];
    expect(opensNewConversation(history, now)).toBe(true);
  });

  it("still does not re-greet inside a live WhatsApp thread", () => {
    const history = [
      { role: "user" as const, content: "📞 שאלה בטלפון", at: minutesAgo(30), channel: "voice" },
      { role: "user" as const, content: "היי", at: minutesAgo(5), channel: "whatsapp" },
    ];
    expect(opensNewConversation(history, now)).toBe(false);
  });

  it("measures the 24h gap from the last typed turn, not the last call", () => {
    const history = [
      { role: "user" as const, content: "הודעה ישנה", at: new Date(now.getTime() - 26 * 3600_000), channel: "whatsapp" },
      { role: "user" as const, content: "📞 שיחה עכשיו", at: minutesAgo(2), channel: "voice" },
    ];
    expect(opensNewConversation(history, now)).toBe(true);
  });

  it("treats a turn with no channel as typed, so existing rows and tests are unaffected", () => {
    expect(opensNewConversation([{ role: "user", content: "היי", at: minutesAgo(5) }], now)).toBe(false);
  });
});
