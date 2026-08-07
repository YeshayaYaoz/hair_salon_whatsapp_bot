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

/**
 * A thread this quiet is over, and its context is a liability rather than help.
 *
 * Two days later the customer is asking about a different visit, but the model still sees the old
 * dates and half-finished booking above the new message and answers as if they were current. Longer
 * than the 24h greeting window on purpose: re-introducing yourself is cheap and reversible, while
 * forgetting what someone told you an hour ago is not.
 */
const IDLE_RESET_MS = 48 * 60 * 60 * 1000;

/**
 * Empties a thread that has gone quiet past IDLE_RESET_MS.
 *
 * Persists the cutoff via the same marker the manual reset uses, rather than only emptying the
 * cache. Without that the drop would not survive a restart: the next fetch takes the most recent
 * MAX_TURNS rows, the newest of which are now the fresh messages, so the pre-gap turns would come
 * back alongside them.
 *
 * Returns a new array so callers keep the "cache hands back the live array" contract — appendTurn
 * pushes into whatever is cached, and handing back a detached array would silently lose turns.
 */
function dropIfIdle(key: string, businessId: string, phone: string, turns: Turn[]): Turn[] {
  const last = turns[turns.length - 1];
  if (!last?.at || Date.now() - last.at.getTime() <= IDLE_RESET_MS) return turns;

  const emptied: Turn[] = [];
  cache.set(key, emptied);
  // updateMany, not update: a conversation can exist for a phone with no Customer row yet, and a
  // missing row must not throw inside what is otherwise a read.
  prisma.customer
    .updateMany({ where: { businessId, phone }, data: { conversationResetAt: new Date() } })
    .catch((err) => console.error("[conversationStore] Failed to persist idle reset:", err));
  return emptied;
}

export async function getHistory(businessId: string, customerPhone: string): Promise<Turn[]> {
  const k = cacheKey(businessId, customerPhone);
  const cached = cache.get(k);
  if (cached) return dropIfIdle(k, businessId, customerPhone, cached);

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
  return dropIfIdle(k, businessId, customerPhone, turns);
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

/** Same, for every thread of one business. Scans the cache because it is keyed by business+phone
 * and there is no per-business index — fine at this size, and it runs once per bulk reset. */
export function forgetAllCachedHistory(businessId: string): void {
  const prefix = `${businessId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export async function clearHistory(businessId: string, customerPhone: string): Promise<void> {
  cache.delete(cacheKey(businessId, customerPhone));
  await prisma.conversationMessage.deleteMany({ where: { businessId, phone: customerPhone } }).catch((err) =>
    console.error("[conversationStore] Failed to clear history:", err)
  );
}
