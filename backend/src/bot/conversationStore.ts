/** In-memory per-customer conversation history. Fine for v1/single-instance; swap for Redis when scaling. */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const conversations = new Map<string, Turn[]>();
const MAX_TURNS = 12;

function key(businessId: string, customerPhone: string) {
  return `${businessId}:${customerPhone}`;
}

export function getHistory(businessId: string, customerPhone: string): Turn[] {
  return conversations.get(key(businessId, customerPhone)) ?? [];
}

export function appendTurn(businessId: string, customerPhone: string, turn: Turn) {
  const k = key(businessId, customerPhone);
  const history = conversations.get(k) ?? [];
  history.push(turn);
  conversations.set(k, history.slice(-MAX_TURNS));
}
