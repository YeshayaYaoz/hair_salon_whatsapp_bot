import * as XLSX from "xlsx";
import { normalizePhone } from "./phone.js";

/**
 * Reads a spreadsheet of customers and their monthly charges.
 *
 * A studio's member list already exists — in Excel, from the previous system, from the accountant.
 * Typing eighty rows into a form is the step at which the owner gives up, so the file is accepted
 * as-is: .xlsx, .xls or .csv, Hebrew or English headers, in any column order.
 *
 * Returns rows and per-row problems rather than throwing: one bad phone number in row 40 must not
 * discard the other 79. The caller decides whether to import the good rows.
 */
export interface ImportRow {
  name: string;
  phone: string;
  amountIls: number;
  description: string;
  dayOfMonth: number;
}

export interface ImportParse {
  rows: ImportRow[];
  errors: { row: number; error: string }[];
}

const HEADERS: Record<keyof ImportRow, string[]> = {
  name: ["name", "שם", "שם מלא", "לקוח", "שם הלקוח"],
  phone: ["phone", "טלפון", "נייד", "מספר", "מספר טלפון", "whatsapp", "וואטסאפ"],
  amountIls: ["amount", "סכום", "מחיר", "חיוב", "sum", "price"],
  description: ["description", "תיאור", "פירוט", "שירות", "מנוי", "עבור"],
  dayOfMonth: ["day", "יום", "יום בחודש", "יום חיוב", "תאריך"],
};

function norm(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/[\s_"']+/g, " ");
}

function columnFor(field: keyof ImportRow, headers: string[]): number {
  const wanted = HEADERS[field];
  return headers.findIndex((h) => wanted.includes(h));
}

export function parseChargeSheet(buffer: Buffer, defaults: { description?: string; dayOfMonth?: number } = {}): ImportParse {
  const wb = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], errors: [{ row: 0, error: "הקובץ ריק" }] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false });
  if (grid.length < 2) return { rows: [], errors: [{ row: 0, error: "הקובץ צריך שורת כותרות ולפחות שורה אחת" }] };

  const headers = (grid[0] as unknown[]).map(norm);
  const col = {
    name: columnFor("name", headers),
    phone: columnFor("phone", headers),
    amountIls: columnFor("amountIls", headers),
    description: columnFor("description", headers),
    dayOfMonth: columnFor("dayOfMonth", headers),
  };
  if (col.phone < 0 || col.amountIls < 0) {
    return { rows: [], errors: [{ row: 1, error: "חסרות עמודות חובה: טלפון וסכום. כותרות שמזוהות: " + [...HEADERS.phone, ...HEADERS.amountIls].join(", ") }] };
  }

  const rows: ImportRow[] = [];
  const errors: ImportParse["errors"] = [];
  grid.slice(1).forEach((raw, i) => {
    const rowNo = i + 2;
    const cell = (c: number) => (c >= 0 ? String((raw as unknown[])[c] ?? "").trim() : "");
    const phoneRaw = cell(col.phone);
    if (!phoneRaw) return; // an empty tail row
    const phone = normalizePhone(phoneRaw);
    if (!/^\d{9,15}$/.test(phone)) return void errors.push({ row: rowNo, error: `טלפון לא תקין: ${phoneRaw}` });
    const amount = Number(cell(col.amountIls).replace(/[₪,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return void errors.push({ row: rowNo, error: `סכום לא תקין: ${cell(col.amountIls)}` });
    const dayRaw = cell(col.dayOfMonth);
    const day = dayRaw ? Number(dayRaw.replace(/\D/g, "")) : defaults.dayOfMonth ?? 1;
    if (!Number.isInteger(day) || day < 1 || day > 31) return void errors.push({ row: rowNo, error: `יום בחודש לא תקין: ${dayRaw}` });
    const description = cell(col.description) || defaults.description || "";
    if (!description) return void errors.push({ row: rowNo, error: "חסר תיאור (למשל 'מנוי חודשי')" });
    rows.push({ name: cell(col.name), phone, amountIls: Math.round(amount * 100) / 100, description, dayOfMonth: day });
  });
  return { rows, errors };
}
