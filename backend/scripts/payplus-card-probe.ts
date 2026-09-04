/**
 * Asks PayPlus which shapes of "save a card" page it will actually generate.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/payplus-card-probe.ts
 *
 * Safe to run: generateLink creates a page, it does not charge anybody. Money only moves if a
 * human opens the returned URL and completes it, and this script never opens one.
 *
 * The question it exists to answer is whether saving a card has to cost the owner a shekel.
 * charge_method 1 with create_token is the shape we know works, and it is a real ₪1 charge.
 * charge_method 2 is PayPlus's approval (J5) — an authorization that verifies the card and stores
 * a token without capturing funds. If PayPlus generates that page, the verification charge and the
 * wallet credit that compensates for it both stop being necessary, and the flow gets simpler and
 * more honest at once. If it refuses, the refusal is the evidence that the ₪1 is unavoidable —
 * which is worth having written down rather than assumed, in either direction.
 *
 * Also tries amount 0, because "no zero-amount page" is currently an inference from MIN_CHARGE_ILS
 * rather than something anyone confirmed with PayPlus.
 */

const BASE_URL = "https://restapi.payplus.co.il/api/v1.0";

function creds() {
  const apiKey = process.env.PAYPLUS_API_KEY?.trim();
  const secretKey = process.env.PAYPLUS_SECRET_KEY?.trim();
  const pageUid = process.env.PAYPLUS_PAGE_UID?.trim();
  if (!apiKey || !secretKey || !pageUid) {
    console.error("PAYPLUS_API_KEY / PAYPLUS_SECRET_KEY / PAYPLUS_PAGE_UID must all be set.");
    process.exit(1);
  }
  return { apiKey, secretKey, pageUid };
}

interface Attempt {
  label: string;
  chargeMethod: number;
  amount: number;
}

const ATTEMPTS: Attempt[] = [
  { label: "charge_method 1, ₪1 — what we ship today", chargeMethod: 1, amount: 1 },
  { label: "charge_method 2 (approval / J5), ₪1 — verify without capturing", chargeMethod: 2, amount: 1 },
  { label: "charge_method 1, ₪0 — no charge at all", chargeMethod: 1, amount: 0 },
  { label: "charge_method 2 (approval / J5), ₪0", chargeMethod: 2, amount: 0 },
];

async function probe(a: Attempt): Promise<void> {
  const { apiKey, secretKey, pageUid } = creds();
  try {
    const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
      },
      body: JSON.stringify({
        payment_page_uid: pageUid,
        charge_method: a.chargeMethod,
        create_token: true,
        amount: a.amount,
        currency_code: "ILS",
        sendEmailApproval: false,
        sendEmailFailure: false,
        more_info: "card-probe",
        customer: { customer_name: "Tori card probe", email: "billing-health@torionline.co.il" },
        items: [{ name: "תורי — בדיקת שמירת כרטיס", quantity: 1, price: a.amount }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { payment_page_link?: string };
      results?: { status?: string; description?: string };
      message?: string;
    };
    const ok = res.ok && body.results?.status === "success" && !!body.data?.payment_page_link;
    // The URL itself is not printed. A generated page is payable by anyone holding the link, and a
    // build log is not the place for one — the yes/no is the entire result being asked for.
    console.log(
      ok
        ? `  ✔ ${a.label} — PayPlus generated a page`
        : `  ✖ ${a.label} — HTTP ${res.status}: ${body.results?.description ?? body.message ?? "unknown"}`
    );
  } catch (err) {
    console.log(`  ✖ ${a.label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log("Which card-on-file page shapes does PayPlus accept?");
  console.log("");
  for (const a of ATTEMPTS) await probe(a);
  console.log("");
  console.log("A page generated here charges nobody — nothing was opened, so nothing was paid.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
