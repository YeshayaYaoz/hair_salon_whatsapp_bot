import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseChargeSheet } from "./chargeImport.js";

/** Owners send whatever their accountant exported. Hebrew headers, any order, one bad row. */
function sheet(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "לקוחות");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("parseChargeSheet", () => {
  it("reads Hebrew headers in any order and normalises phones", () => {
    const out = parseChargeSheet(sheet([
      ["סכום", "שם", "טלפון", "יום", "תיאור"],
      [350, "דנה כהן", "050-111-1111", 1, "מנוי פילאטיס"],
      ["₪200", "יוסי", "+972 52 222 2222", 15, "חוג"],
    ]));
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      { name: "דנה כהן", phone: "972501111111", amountIls: 350, description: "מנוי פילאטיס", dayOfMonth: 1 },
      { name: "יוסי", phone: "972522222222", amountIls: 200, description: "חוג", dayOfMonth: 15 },
    ]);
  });

  it("reports a bad row by number and keeps the rest", () => {
    const out = parseChargeSheet(sheet([
      ["name", "phone", "amount"],
      ["דנה", "0501111111", 350],
      ["יוסי", "abc", 200],
      ["רותי", "0503333333", "free"],
    ]), { description: "מנוי חודשי", dayOfMonth: 1 });
    expect(out.rows).toHaveLength(1);
    expect(out.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it("fills description and day from the form defaults when the sheet lacks them", () => {
    const out = parseChargeSheet(sheet([["שם", "נייד", "מחיר"], ["דנה", "0501111111", 350]]), { description: "מנוי", dayOfMonth: 10 });
    expect(out.rows[0]).toMatchObject({ description: "מנוי", dayOfMonth: 10 });
  });

  it("refuses a sheet without the phone and amount columns, naming what it looks for", () => {
    const out = parseChargeSheet(sheet([["שם", "כתובת"], ["דנה", "תל אביב"]]));
    expect(out.rows).toEqual([]);
    expect(out.errors[0].error).toMatch(/טלפון/);
  });

  it("reads a csv too", () => {
    const csv = Buffer.from("name,phone,amount,description,day\nדנה,0501111111,350,מנוי,1\n", "utf8");
    const out = parseChargeSheet(csv);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].phone).toBe("972501111111");
  });
});
