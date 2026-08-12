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
 * Buying numbers is deliberately NOT here. Ordering a number spends money, and money spent without
 * anyone deciding to spend it is a different class of action from configuring a line that already
 * exists. The purchase stays a decision; the wiring does not.
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

type ConnectedNumber = { number: string; type: string };

/** The numbers on this Zadarma account, with the `type` that every per-number call requires. */
export async function listNumbers(): Promise<ConnectedNumber[]> {
  const body = await request("GET", "/v1/direct_numbers/", {});
  const rows = (body.info as Array<Record<string, unknown>>) ?? [];
  return rows
    .map((r) => ({ number: String(r.number ?? ""), type: String(r.type ?? "") }))
    .filter((r) => r.number);
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
