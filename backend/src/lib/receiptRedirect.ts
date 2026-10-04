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

receiptRedirectRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return res.status(404).type("text/plain").send("לא נמצא");
  const receipt = await prisma.receipt.findUnique({ where: { id }, select: { documentUrl: true } });
  if (!receipt) return res.status(404).type("text/plain").send("הקבלה לא נמצאה");
  res.redirect(302, receipt.documentUrl);
});
