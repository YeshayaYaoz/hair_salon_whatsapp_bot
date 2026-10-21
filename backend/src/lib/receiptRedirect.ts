import { prisma } from "./prisma.js";
import { rateLimit } from "./rateLimit.js";
import { asyncRouter } from "./asyncRouter.js";

/**
 * /r/<receipt id> → the document at the invoicing provider.
 *
 * Exists for one reason: a WhatsApp template's URL button has a fixed domain, and the receipt lives
 * on Green Invoice's or iCount's. The button points here, this redirects there. Unauthenticated by
 * necessity — the customer tapping the button has no account — so the id is the only secret, and a
 * cuid is 25 random characters: not guessable, not enumerable. Rate-limited anyway.
 */
export const receiptRedirectRouter = asyncRouter();

receiptRedirectRouter.use(rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "receipt-redirect" }));

/** The id a sample receipt's button carries. No row behind it, so it works with the database down. */
export const SAMPLE_RECEIPT_ID = "sample";

receiptRedirectRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  // A sample sent to show a prospect what their customers get: no document exists, so the button
  // opens the site instead of a "not found" — the one thing a demo must never show.
  if (id === SAMPLE_RECEIPT_ID) return res.redirect(302, "https://torionline.com");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return res.status(404).type("text/plain").send("לא נמצא");
  const receipt = await prisma.receipt.findUnique({ where: { id }, select: { documentUrl: true } });
  if (!receipt) return res.status(404).type("text/plain").send("הקבלה לא נמצאה");
  res.redirect(302, receipt.documentUrl);
});

/** /p/<payment request id> → the provider's hosted payment page. Same reasoning as /r. */
export const paymentLinkRedirectRouter = asyncRouter();
paymentLinkRedirectRouter.use(rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "payment-redirect" }));
paymentLinkRedirectRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return res.status(404).type("text/plain").send("לא נמצא");
  const request = await prisma.paymentRequest.findUnique({ where: { id }, select: { paymentUrl: true, status: true } });
  if (!request) return res.status(404).type("text/plain").send("בקשת התשלום לא נמצאה");
  if (request.status === "paid") return res.status(200).type("text/plain; charset=utf-8").send("התשלום הזה כבר בוצע. תודה!");
  res.redirect(302, request.paymentUrl);
});
