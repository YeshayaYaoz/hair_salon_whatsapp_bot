import { z } from "zod";
import multer from "multer";
import { asyncRouter } from "../lib/asyncRouter.js";
import { prisma } from "../lib/prisma.js";
import type { AuthedRequest } from "../lib/auth.js";
import { normalizePhone } from "../lib/phone.js";
import { listPendingDues, confirmChargeDue, skipChargeDue } from "../lib/recurringCharges.js";
import { parseChargeSheet } from "../lib/chargeImport.js";

/**
 * Recurring charges, the dues they produce each month, and the receipts issued for them.
 * Mounted inside businessRouter, so every route here is already authenticated and scoped.
 */
export const receiptsRouter = asyncRouter();

const chargeSchema = z.object({
  customerId: z.string().min(1).optional(),
  // Or a new customer, by phone — the member list rarely overlaps the bot's customer list.
  phone: z.string().min(7).max(30).optional(),
  name: z.string().trim().max(80).optional(),
  amountIls: z.number().positive().max(100000),
  description: z.string().trim().min(1).max(120),
  dayOfMonth: z.number().int().min(1).max(31),
});

async function resolveCustomer(businessId: string, input: { customerId?: string; phone?: string; name?: string }) {
  if (input.customerId) {
    return prisma.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true } });
  }
  if (!input.phone) return null;
  const phone = normalizePhone(input.phone);
  if (!/^\d{9,15}$/.test(phone)) return null;
  return prisma.customer.upsert({
    where: { businessId_phone: { businessId, phone } },
    create: { businessId, phone, name: input.name?.trim() || null },
    // A name given here fills a blank, never overwrites one the customer gave the bot.
    update: input.name?.trim() ? { name: input.name.trim() } : {},
    select: { id: true },
  });
}

const chargeSelect = {
  id: true, amountIls: true, description: true, dayOfMonth: true, active: true, createdAt: true,
  customer: { select: { id: true, name: true, phone: true } },
} as const;

receiptsRouter.get("/recurring-charges", async (req: AuthedRequest, res) => {
  const charges = await prisma.recurringCharge.findMany({
    where: { businessId: req.businessId! },
    orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }, { createdAt: "asc" }],
    select: chargeSelect,
  });
  res.json(charges);
});

receiptsRouter.post("/recurring-charges", async (req: AuthedRequest, res) => {
  const parsed = chargeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const customer = await resolveCustomer(req.businessId!, parsed.data);
  if (!customer) return res.status(400).json({ error: "צריך לקוח קיים או מספר טלפון תקין." });
  const charge = await prisma.recurringCharge.create({
    data: {
      businessId: req.businessId!,
      customerId: customer.id,
      amountIls: parsed.data.amountIls,
      description: parsed.data.description,
      dayOfMonth: parsed.data.dayOfMonth,
    },
    select: chargeSelect,
  });
  res.status(201).json(charge);
});

receiptsRouter.patch("/recurring-charges/:id", async (req: AuthedRequest, res) => {
  const parsed = chargeSchema.pick({ amountIls: true, description: true, dayOfMonth: true }).partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await prisma.recurringCharge.updateMany({ where: { id: req.params.id, businessId: req.businessId! }, data: parsed.data });
  if (r.count === 0) return res.status(404).json({ error: "Not found" });
  const charge = await prisma.recurringCharge.findUnique({ where: { id: req.params.id }, select: chargeSelect });
  res.json(charge);
});

receiptsRouter.delete("/recurring-charges/:id", async (req: AuthedRequest, res) => {
  const r = await prisma.recurringCharge.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  if (r.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

/**
 * Bulk import from a spreadsheet. Two phases through one endpoint: `?dryRun=1` parses and reports
 * what would be created, so the owner sees row 40's bad phone before anything is written; without
 * it, the good rows are imported and the bad ones reported.
 */
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
receiptsRouter.post("/recurring-charges/import", sheetUpload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "לא צורף קובץ." });
  const defaults = {
    description: typeof req.body?.description === "string" ? req.body.description.trim() : undefined,
    dayOfMonth: req.body?.dayOfMonth ? Number(req.body.dayOfMonth) : undefined,
  };
  let parsed;
  try {
    parsed = parseChargeSheet(req.file.buffer, defaults);
  } catch {
    return res.status(400).json({ error: "לא הצלחנו לקרוא את הקובץ. שמרו אותו כ-xlsx או csv ונסו שוב." });
  }
  if (req.query.dryRun) return res.json({ dryRun: true, rows: parsed.rows, errors: parsed.errors });

  let created = 0;
  let updated = 0;
  for (const row of parsed.rows) {
    const customer = await resolveCustomer(req.businessId!, { phone: row.phone, name: row.name });
    if (!customer) continue;
    // One active charge per customer per description: re-importing the same sheet updates amounts
    // and days rather than doubling everyone's membership.
    const existing = await prisma.recurringCharge.findFirst({ where: { businessId: req.businessId!, customerId: customer.id, description: row.description }, select: { id: true } });
    if (existing) {
      await prisma.recurringCharge.update({ where: { id: existing.id }, data: { amountIls: row.amountIls, dayOfMonth: row.dayOfMonth, active: true } });
      updated++;
    } else {
      await prisma.recurringCharge.create({ data: { businessId: req.businessId!, customerId: customer.id, amountIls: row.amountIls, description: row.description, dayOfMonth: row.dayOfMonth } });
      created++;
    }
  }
  res.json({ created, updated, errors: parsed.errors });
});

receiptsRouter.get("/charges-due", async (req: AuthedRequest, res) => {
  res.json(await listPendingDues(req.businessId!));
});

receiptsRouter.post("/charges-due/:id/confirm", async (req: AuthedRequest, res) => {
  const out = await confirmChargeDue(req.businessId!, req.params.id);
  if (!out.ok) return res.status(out.code === "not_found" ? 404 : out.code === "already" ? 409 : out.code === "no_provider" ? 400 : 502).json({ error: out.error });
  res.json({ ...out.receipt, message: out.message });
});

receiptsRouter.post("/charges-due/:id/skip", async (req: AuthedRequest, res) => {
  const ok = await skipChargeDue(req.businessId!, req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

receiptsRouter.get("/receipts", async (req: AuthedRequest, res) => {
  const receipts = await prisma.receipt.findMany({
    where: { businessId: req.businessId! },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, amountIls: true, description: true, documentUrl: true, delivery: true, createdAt: true, customer: { select: { id: true, name: true, phone: true } } },
  });
  res.json(receipts);
});
