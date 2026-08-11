/**
 * One parser for every PayPlus server-to-server callback, shared by the deposit webhook
 * (webhook/paymentWebhooks.ts) and the subscription webhook (billing/payplusBillingRoutes.ts).
 *
 * Why it searches instead of indexing: PayPlus's own documentation ("Transaction Callback
 * Response") shows the payload nested as
 *
 *   { results: {...}, data: { transaction: { status_code, amount, more_info, ... },
 *                             data: { customer_uid, terminal_uid, card_information: {...} } } }
 *
 * while integrations in the wild — and PayPlus's older format — receive the same fields flat on
 * the body ({ status_code, amount, more_info, token_uid, ... }). Both webhooks previously read
 * only `(body.data ?? body).status_code`, which matches the flat shape and silently misses the
 * documented one: the card is charged, the callback arrives, `success` computes false, and
 * nothing activates — with a 200 acknowledged back to PayPlus, so there is no retry and no trace.
 *
 * The walk is breadth-first, so a field on the transaction/top level wins over a deeper duplicate,
 * and bounded, so a hostile payload cannot make it spin.
 */

const MAX_NODES = 200;

/**
 * Breadth-first search for one field name. Earlier names in the caller's list are searched
 * exhaustively before later ones — `status_code` anywhere in the payload must beat `status`
 * anywhere, because the `results: { status: "success" }` envelope means "the API call worked",
 * not "the charge succeeded". A declined charge arrives inside a successful envelope.
 *
 * The `results` envelope is skipped outright for the same reason: nothing about the charge
 * lives there, and its `status`/`code` fields exist only to collide with ours.
 */
function findOne(body: unknown, name: string): unknown {
  const queue: unknown[] = [body];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_NODES) {
    const node = queue.shift();
    visited++;
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;
    if (record[name] !== undefined && record[name] !== null && record[name] !== "") return record[name];
    for (const [key, value] of Object.entries(record)) {
      if (key === "results") continue;
      if (typeof value === "object" && value !== null) queue.push(value);
    }
  }
  return undefined;
}

function findField(body: unknown, ...names: string[]): unknown {
  for (const name of names) {
    const found = findOne(body, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

export interface PayPlusCallback {
  success: boolean;
  amountIls?: number;
  /** The free-text reference we sent as more_info when generating the page. */
  referenceId?: string;
  /** Present only when the page was generated with create_token. */
  tokenUid?: string;
  customerName?: string;
  customerPhone?: string;
}

export function parsePayPlusCallback(body: unknown): PayPlusCallback {
  const status = findField(body, "status_code", "status");
  const amount = findField(body, "amount");
  const amountIls = typeof amount === "number" ? amount : Number(amount) || undefined;
  return {
    success: status === "000" || status === 0 || status === "success",
    amountIls,
    referenceId: (findField(body, "more_info") as string) || undefined,
    tokenUid: (findField(body, "token_uid", "token") as string) || undefined,
    customerName: (findField(body, "customer_name") as string) || undefined,
    customerPhone: (findField(body, "customer_phone", "phone") as string) || undefined,
  };
}
