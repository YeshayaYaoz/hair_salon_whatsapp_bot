import { createHash, createHmac } from "crypto";

/**
 * The carrier half of connecting a salon's phone line.
 *
 * Cartesia holds the agent; Zadarma holds the number. `cartesiaAdmin` imports the number and points
 * it at the agent, and until now the other direction — telling the carrier to send calls to
 * Cartesia at all — was a field someone had to fill in a browser for every single number. This page
 * of the setup doc even said it had to be, on the strength of an API that turned out to have the
 * endpoint all along.
 *
 * That made onboarding a salon a task with a person in it, which does not survive ten salons. Every
 * other step is automatic; this was the one that was not.
 *
 * Buying numbers lives here too, but behind a different rule from the wiring: ordering starts a
 * recurring monthly charge, so someone has to have decided to spend it. For a paying business that
 * decision was made when they subscribed, and making them wait on a human to click something is the
 * manual step this whole file exists to remove. For a trial it has not been made by anyone — a
 * signup that never converts would leave a number billing every month — so that path stops and asks.
 *
 * The entitlement check itself is NOT here. This module knows how to spend money, not who is
 * allowed to; keeping the two apart means the answer to "who can order" has exactly one home.
 */

const BASE_URL = "https://api.zadarma.com";

export class ZadarmaNotConfiguredError extends Error {
  constructor() {
    super("ZADARMA_API_KEY / ZADARMA_API_SECRET are not set — carrier forwarding cannot be configured");
    this.name = "ZadarmaNotConfiguredError";
  }
}

/**
 * Zadarma signs requests rather than accepting a bearer token, and the recipe is order-sensitive:
 * parameters sorted by key, urlencoded, then hashed together with the method path and the md5 of
 * that same query string. Get any part of the order wrong and the failure is a flat 401 that says
 * nothing about which part.
 */
function sign(methodPath: string, params: Record<string, string>, secret: string): string {
  const query = new URLSearchParams(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]] as [string, string])
  ).toString();
  const md5 = createHash("md5").update(query).digest("hex");
  const hash = createHmac("sha1", secret).update(methodPath + query + md5).digest("hex");
  return Buffer.from(hash).toString("base64");
}

function creds(): { key: string; secret: string } {
  const key = process.env.ZADARMA_API_KEY?.trim();
  const secret = process.env.ZADARMA_API_SECRET?.trim();
  if (!key || !secret) throw new ZadarmaNotConfiguredError();
  return { key, secret };
}

async function request(
  method: "GET" | "PUT" | "POST",
  methodPath: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const { key, secret } = creds();
  const query = new URLSearchParams(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]] as [string, string])
  ).toString();
  const signature = sign(methodPath, params, secret);

  const url = `${BASE_URL}${methodPath}` + (method === "GET" && query ? `?${query}` : "");
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `${key}:${signature}`,
      ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    ...(method === "GET" ? {} : { body: query }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Zadarma answers 200 with {"status":"error"} rather than an HTTP error code, so the HTTP status
  // alone would report every rejection as a success.
  if (!res.ok || body.status === "error") {
    throw new Error(`Zadarma ${methodPath} failed: ${(body.message as string) ?? `HTTP ${res.status}`}`);
  }
  return body;
}

export interface ZadarmaNumber {
  number: string;
  /** The `type` every per-number call requires. */
  type: string;
  /** "on" for a live line; anything else means it is not ringing. */
  status: string;
  /** When Zadarma will stop serving it unless renewed. Null when the carrier gave none. */
  stopDate: Date | null;
  monthlyFee: number;
  currency: string;
  /** Whether Zadarma will take the monthly fee from the balance on stopDate by itself. */
  autorenew: boolean;
  isOnTest: boolean;
}

/**
 * Zadarma writes timestamps as "2026-02-11 18:14:40" with no zone. They are read as UTC: a few
 * hours either way does not change whether a number expires this week, which is all anything
 * here asks of the value.
 */
function parseZadarmaDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim().replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The numbers on this Zadarma account.
 *
 * Used to return only number and type; stop_date and autorenew were discarded, which is why no
 * part of the system could say whether a line was about to lapse. Both are what the renewal job
 * runs on. Zadarma sends booleans as the strings "true"/"false".
 */
export async function listNumbers(): Promise<ZadarmaNumber[]> {
  const body = await request("GET", "/v1/direct_numbers/", {});
  const rows = (body.info as Array<Record<string, unknown>>) ?? [];
  return rows
    .map((r) => ({
      number: String(r.number ?? ""),
      type: String(r.type ?? ""),
      status: String(r.status ?? ""),
      stopDate: parseZadarmaDate(r.stop_date),
      monthlyFee: Number(r.monthly_fee ?? 0) || 0,
      currency: String(r.currency ?? ""),
      autorenew: String(r.autorenew ?? "") === "true",
      isOnTest: String(r.is_on_test ?? "") === "true",
    }))
    .filter((r) => r.number);
}

/**
 * Turns Zadarma's own monthly renewal on or off for one number. On means the fee comes off the
 * balance on the stop date without anyone doing anything; off means the number lapses there. The
 * renewal job sets on for paying businesses and off for cancelled ones — the second is how Tori
 * stops paying for a line nobody is using.
 */
export async function setAutoprolongation(number: string, on: boolean): Promise<void> {
  await request("PUT", "/v1/direct_numbers/autoprolongation/", {
    number: number.replace(/\D/g, ""),
    value: on ? "on" : "off",
  });
}

/**
 * Prepays the number for a whole number of months, from the balance, and returns the new stop
 * date. Belt and braces for a line that is days from lapsing and whose autorenew could not be
 * switched on — spending early is cheaper than a salon whose phone has stopped ringing.
 */
export async function prolongNumber(
  number: string,
  months: number
): Promise<{ stopDate: Date | null; totalPaid: number; currency: string }> {
  const body = await request("PUT", "/v1/direct_numbers/prolong/", {
    number: number.replace(/\D/g, ""),
    months: String(months),
  });
  const paid = (body.total_paid as { amount?: unknown; currency?: unknown } | undefined) ?? {};
  return {
    stopDate: parseZadarmaDate(body.stop_date),
    totalPaid: Number(paid.amount ?? 0) || 0,
    currency: String(paid.currency ?? ""),
  };
}

/** Digits only, for comparing a number the owner typed against one Zadarma reports. */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Sends the number's incoming calls to Cartesia — the External Server (SIP URI) field, set over the
 * API instead of by hand.
 *
 * The leading "+" is kept deliberately. Cartesia routes on the SIP To header matched against
 * imported numbers in +E.164; written without it the destination matches nothing, so there is no
 * agent to route to and the call is dropped *before a call record exists* — the number looks
 * correctly configured on both sides while every call silently fails. That cost a live debugging
 * session when it was set by hand, and it would cost the same set from here.
 */
export async function pointNumberAtCartesia(
  phoneNumber: string,
  sipHost = process.env.CARTESIA_SIP_HOST?.trim() || "sip.cartesia.ai"
): Promise<{ changed: boolean; sipId: string }> {
  const wanted = digits(phoneNumber);
  const numbers = await listNumbers();
  const match = numbers.find((n) => digits(n.number) === wanted);
  if (!match) {
    // Not an error worth failing a settings save over: plenty of salons will bring a number from
    // another carrier, and this account simply has nothing to configure for them.
    throw new Error(`Zadarma has no number matching ${phoneNumber} on this account`);
  }

  const sipId = `+${wanted}@${sipHost}`;
  await request("PUT", "/v1/direct_numbers/set_sip_id/", {
    type: match.type,
    number: match.number,
    sip_id: sipId,
  });
  return { changed: true, sipId };
}


/** Account balance, in the account's own currency. Zero is the usual reason an order silently fails. */
export async function getBalance(): Promise<{ balance: number; currency: string }> {
  const body = await request("GET", "/v1/info/balance/", {});
  return { balance: Number(body.balance ?? 0), currency: String(body.currency ?? "") };
}

export interface AvailableNumber {
  number: string;
  monthlyFee?: string;
}

/**
 * Numbers free to order on a destination.
 *
 * The response key is not stable across Zadarma's endpoints — `numbers` on some, `info` on others —
 * and reading only `info` once reported an empty list against a dashboard visibly full of numbers.
 */
export async function listAvailableNumbers(directionId: string): Promise<AvailableNumber[]> {
  const body = await request("GET", `/v1/direct_numbers/available/${directionId}/`, {});
  const rows =
    (body.numbers as Array<Record<string, unknown>>) ??
    (body.info as Array<Record<string, unknown>>) ??
    (body.data as Array<Record<string, unknown>>) ??
    [];
  return rows
    .map((r) => ({ number: String(r.number ?? r), monthlyFee: r.monthly_fee ? String(r.monthly_fee) : undefined }))
    .filter((r) => /^\d+$/.test(r.number));
}

export class NumberOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberOrderError";
  }
}

/**
 * Orders one specific number and returns the one Zadarma actually allocated.
 *
 * Those differ. Asking for 972555077983 has returned 972559661420 — so the caller must configure
 * everything downstream against the returned value, never against the requested one. Silently
 * getting a different number is how the wrong number ends up in three places.
 */
export async function orderNumber(directionId: string, wanted: string): Promise<string> {
  const digits = wanted.replace(/\D/g, "");
  const body = await request("POST", "/v1/direct_numbers/order/", {
    direction_id: directionId,
    number: digits,
  });
  const allocated = String((body as { number?: unknown }).number ?? "").replace(/\D/g, "");
  if (!allocated) throw new NumberOrderError("Zadarma accepted the order but returned no number");
  // Reserved-but-inactive is what a zero balance looks like from here: the order succeeds and the
  // line can receive nothing. Reported as a failure because a number that cannot ring is not a
  // number the business got.
  if (String((body as { is_activated?: unknown }).is_activated ?? "") === "false") {
    throw new NumberOrderError(
      `Zadarma reserved ${allocated} but has not activated it — usually a zero balance or a pending documents step`
    );
  }
  return allocated;
}
