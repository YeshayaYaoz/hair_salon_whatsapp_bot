import { prisma } from "../lib/prisma.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  /** When the turn was written. Conversations routinely span days, and without this the model
   * reads a message from last week as if it were said just now — "מחר" in an old turn silently
   * means a date that has already passed. See claudeBot's date-stamping of stale turns. */
  at?: Date;
}

// Only the last MAX_TURNS are fed to the model; the full history stays in the DB
// so the dashboard "conversations" tab can show complete transcripts.
const MAX_TURNS = 16;

// In-memory cache so we don't hit the DB on every turn within the same session.
// NOTE (scaling): this cache is per-process. If the backend ever runs more than one
// instance, each instance will have its own view and conversations can fork mid-thread.
// Before scaling horizontally, either pin webhook traffic to one instance or move this
// cache to Redis. The DB remains the source of truth either way.
const cache = new Map<string, Turn[]>();

function cacheKey(businessId: string, phone: string) {
  return `${businessId}:${phone}`;
}

export async function getHistory(businessId: string, customerPhone: string): Promise<Turn[]> {
  const k = cacheKey(businessId, customerPhone);
  if (cache.has(k)) return cache.get(k)!;

  // An owner-triggered reset hides everything written before it from the bot without deleting a
  // single row — the dashboard transcript still shows the whole thread. Only read on a cache miss,
  // so this costs one extra query per conversation per process, not one per message.
  const customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId, phone: customerPhone } },
    select: { conversationResetAt: true },
  });

  // Latest MAX_TURNS in chronological order.
  const rows = await prisma.conversationMessage.findMany({
    where: {
      businessId,
      phone: customerPhone,
      ...(customer?.conversationResetAt ? { createdAt: { gt: customer.conversationResetAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_TURNS,
  });
  rows.reverse();

  // Defensive: drop any empty-content rows (e.g. persisted before a since-fixed bug where the
  // model returned no text). The Anthropic API rejects empty text content blocks outright, so a
  // single stale blank turn here would break every future call for this conversation.
  const turns: Turn[] = rows
    .map((r) => ({ role: r.role as Turn["role"], content: r.content, at: r.createdAt }))
    .filter((t) => t.content.trim().length > 0);
  cache.set(k, turns);
  return turns;
}

export async function appendTurn(businessId: string, customerPhone: string, turn: Turn): Promise<void> {
  if (!turn.content.trim()) return; // never persist empty content — see getHistory for why
  const k = cacheKey(businessId, customerPhone);
  const history = cache.get(k) ?? [];
  history.push({ ...turn, at: turn.at ?? new Date() });
  if (history.length > MAX_TURNS) history.splice(0, history.length - MAX_TURNS);
  cache.set(k, history);

  // Persist to DB (fire and forget; failure is non-fatal). Full history is retained
  // for the dashboard transcripts view.
  prisma.conversationMessage.create({
    data: { businessId, phone: customerPhone, role: turn.role, content: turn.content },
  }).catch((err) => console.error("[conversationStore] Failed to persist turn:", err));
}

/**
 * Drops the in-process cache for one thread. Call after moving conversationResetAt, or the cached
 * turns keep being served and the reset appears to do nothing until the process restarts.
 *
 * Deliberately separate from clearHistory below: that deletes the transcript, this only forgets it.
 */
export function forgetCachedHistory(businessId: string, customerPhone: string): void {
  cache.delete(cacheKey(businessId, customerPhone));
}

export async function clearHistory(businessId: string, customerPhone: string): Promise<void> {
  cache.delete(cacheKey(businessId, customerPhone));
  await prisma.conversationMessage.deleteMany({ where: { businessId, phone: customerPhone } }).catch((err) =>
    console.error("[conversationStore] Failed to clear history:", err)
  );
}
