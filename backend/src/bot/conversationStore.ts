import { prisma } from "../lib/prisma.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 16;
// In-memory cache so we don't hit the DB on every turn within the same session.
const cache = new Map<string, Turn[]>();

function cacheKey(businessId: string, phone: string) {
  return `${businessId}:${phone}`;
}

export async function getHistory(businessId: string, customerPhone: string): Promise<Turn[]> {
  const k = cacheKey(businessId, customerPhone);
  if (cache.has(k)) return cache.get(k)!;

  const rows = await prisma.conversationMessage.findMany({
    where: { businessId, phone: customerPhone },
    orderBy: { createdAt: "asc" },
    take: MAX_TURNS,
  });

  const turns: Turn[] = rows.map((r) => ({ role: r.role as Turn["role"], content: r.content }));
  cache.set(k, turns);
  return turns;
}

export async function appendTurn(businessId: string, customerPhone: string, turn: Turn): Promise<void> {
  const k = cacheKey(businessId, customerPhone);
  const history = cache.get(k) ?? [];
  history.push(turn);
  // Keep only the last MAX_TURNS in memory
  if (history.length > MAX_TURNS) history.splice(0, history.length - MAX_TURNS);
  cache.set(k, history);

  // Persist to DB (non-blocking — fire and forget, failure is non-fatal)
  prisma.conversationMessage.create({
    data: { businessId, phone: customerPhone, role: turn.role, content: turn.content },
  }).catch((err) => console.error("[conversationStore] Failed to persist turn:", err));

  // Prune old messages beyond MAX_TURNS in the background
  pruneOldMessages(businessId, customerPhone).catch(() => {});
}

export async function clearHistory(businessId: string, customerPhone: string): Promise<void> {
  cache.delete(cacheKey(businessId, customerPhone));
  await prisma.conversationMessage.deleteMany({ where: { businessId, phone: customerPhone } }).catch((err) =>
    console.error("[conversationStore] Failed to clear history:", err)
  );
}

async function pruneOldMessages(businessId: string, phone: string) {
  const rows = await prisma.conversationMessage.findMany({
    where: { businessId, phone },
    orderBy: { createdAt: "desc" },
    skip: MAX_TURNS,
    select: { id: true },
  });
  if (rows.length > 0) {
    await prisma.conversationMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }
}
