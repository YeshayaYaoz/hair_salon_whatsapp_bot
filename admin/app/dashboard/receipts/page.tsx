"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonCard } from "../../lib/Skeleton";
import { EmptyState } from "../../lib/EmptyState";
import { formatPhone } from "../../lib/formatPhone";
import { DIAL_CODES, DEFAULT_DIAL_CODE } from "../../lib/dialCodes";

/**
 * Monthly charges, the dues waiting for "the money came in", and the receipts issued.
 *
 * The owner's day with this screen: on the 1st, a WhatsApp from Tori says twelve charges are due.
 * They open this page (or just answer on WhatsApp), tick the ones that paid, and each tick issues a
 * receipt and sends it. Tori never collects the money — that stays with Bit, cash, the bank — and
 * never issues a receipt without the tick, because a receipt is a statement that money arrived.
 */

interface CustomerRef { id: string; name: string | null; phone: string }
interface Charge { id: string; amountIls: number; description: string; dayOfMonth: number; active: boolean; customer: CustomerRef }
interface Due { id: string; customerId: string; customerName: string | null; customerPhone: string; amountIls: number; description: string; dueDate: string }
interface Receipt { id: string; amountIls: number; description: string; documentUrl: string; delivery: string; createdAt: string; customer: CustomerRef | null }
interface ImportResult { created?: number; updated?: number; dryRun?: boolean; rows?: unknown[]; errors: { row: number; error: string }[] }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const who = (c: { name?: string | null; phone: string } | null) => (c ? c.name?.trim() || formatPhone(c.phone) : "—");

const DELIVERY_HE: Record<string, string> = {
  sent: "נשלחה בוואטסאפ",
  template: "נשלחה בוואטסאפ",
  window_closed: "לא נשלחה — שלחו את הקישור",
  no_whatsapp: "אין וואטסאפ — שלחו את הקישור",
  failed: "השליחה נכשלה — שלחו את הקישור",
  pending: "…",
};

export default function ReceiptsPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [tab, setTab] = useState<"due" | "charges" | "history">("due");
  const [dues, setDues] = useState<Due[] | null>(null);
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [d, c, r] = await Promise.all([
      apiFetch<Due[]>("/api/business/charges-due"),
      apiFetch<Charge[]>("/api/business/recurring-charges"),
      apiFetch<Receipt[]>("/api/business/receipts"),
    ]);
    setDues(d);
    setCharges(c);
    setReceipts(r);
  }
  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      setDues([]);
      setCharges([]);
      setReceipts([]);
    });
  }, []);

  async function confirm(due: Due) {
    setBusyId(due.id);
    setError(null);
    try {
      const out = await apiFetch<{ message: string; documentUrl: string }>(`/api/business/charges-due/${due.id}/confirm`, { method: "POST" });
      setNotice(`${who({ name: due.customerName, phone: due.customerPhone })}: ${out.message}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusyId(null);
    }
  }

  async function skip(due: Due) {
    setBusyId(due.id);
    try {
      await apiFetch(`/api/business/charges-due/${due.id}/skip`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusyId(null);
    }
  }

  const pendingTotal = (dues ?? []).reduce((s, d) => s + d.amountIls, 0);

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "קבלות" : "Receipts"}</h1>
        <p className="text-gray-600 text-sm mt-1">
          {he
            ? "חיובים חודשיים קבועים ללקוחות. בכל חודש תורי מזכירה מי צריך לשלם; כשהכסף נכנס מאשרים כאן או בוואטסאפ, והקבלה מופקת ונשלחת ללקוח."
            : "Fixed monthly charges. Each month Tori reminds you who is due; when the money comes in you confirm here or on WhatsApp, and the receipt is issued and sent."}
        </p>
        <p className="text-gray-500 text-xs mt-2">
          {he
            ? "לא חיברתם מספר וואטסאפ משלכם? הקבלות נשלחות מהמספר של תורי, עם שם העסק שלכם בהודעה. את העסק מנהלים מהמספר שהגדרתם בהגדרות, בשיחה עם תורי."
            : "No WhatsApp number of your own? Receipts go out from Tori's number with your business name in the message. You run the business from the phone set in Settings, by chatting with Tori."}
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200" role="tablist">
        {([
          ["due", he ? `ממתינים לאישור${dues?.length ? ` (${dues.length})` : ""}` : `Awaiting confirmation${dues?.length ? ` (${dues.length})` : ""}`],
          ["charges", he ? "חיובים קבועים" : "Recurring charges"],
          ["history", he ? "קבלות שהונפקו" : "Issued receipts"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === key ? "border-[#1B7FA0] text-[#1B7FA0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {notice && (
        <p className="text-sm mb-4 bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-700" aria-label="close">✕</button>
        </p>
      )}

      {tab === "due" && (
        dues === null ? <SkeletonCard lines={4} /> : dues.length === 0 ? (
          <EmptyState
            icon="🧾"
            title={he ? "אין חיובים שממתינים לאישור" : "Nothing awaiting confirmation"}
            hint={he ? "ביום החיוב של כל לקוח יופיע כאן חיוב, ותקבלו הודעה בוואטסאפ." : "On each customer's day a charge appears here, and you get a WhatsApp message."}
          />
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-600 flex justify-between">
              <span>{he ? "סמנו מי שילם. הקבלה מופקת ונשלחת מיד." : "Mark who paid. The receipt is issued and sent at once."}</span>
              <span className="tabular-nums font-medium text-gray-900">₪{fmt(pendingTotal)}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {dues.map((d) => (
                <li key={d.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[160px]">
                    <div className="font-medium text-gray-900">{who({ name: d.customerName, phone: d.customerPhone })}</div>
                    <div className="text-xs text-gray-500">{d.description} · {new Date(d.dueDate).toLocaleDateString(he ? "he-IL" : "en-GB")}</div>
                  </div>
                  <div className="tabular-nums font-semibold text-gray-900">₪{fmt(d.amountIls)}</div>
                  <button
                    onClick={() => confirm(d)}
                    disabled={busyId === d.id}
                    className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition"
                  >
                    {busyId === d.id ? (he ? "מפיק…" : "Issuing…") : he ? "התקבל, שלח קבלה" : "Paid, send receipt"}
                  </button>
                  <button onClick={() => skip(d)} disabled={busyId === d.id} className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5">
                    {he ? "לא שילם החודש" : "Not paid this month"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {tab === "charges" && <ChargesTab he={he} charges={charges} onChanged={load} onError={setError} />}

      {tab === "history" && (
        receipts === null ? <SkeletonCard lines={4} /> : receipts.length === 0 ? (
          <EmptyState icon="🧾" title={he ? "עוד לא הונפקו קבלות" : "No receipts yet"} hint={he ? "כל קבלה שתורי מפיקה תופיע כאן עם קישור למסמך." : "Every receipt Tori issues appears here with a link to the document."} />
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs">
                <tr className="border-b border-gray-100">
                  <th className="text-start px-4 py-2 font-medium">{he ? "תאריך" : "Date"}</th>
                  <th className="text-start px-4 py-2 font-medium">{he ? "לקוח" : "Customer"}</th>
                  <th className="text-start px-4 py-2 font-medium">{he ? "עבור" : "For"}</th>
                  <th className="text-end px-4 py-2 font-medium">₪</th>
                  <th className="text-start px-4 py-2 font-medium">{he ? "משלוח" : "Delivery"}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">{new Date(r.createdAt).toLocaleDateString(he ? "he-IL" : "en-GB")}</td>
                    <td className="px-4 py-2 text-gray-900">{who(r.customer)}</td>
                    <td className="px-4 py-2 text-gray-700">{r.description}</td>
                    <td className="px-4 py-2 text-end tabular-nums font-medium">{fmt(r.amountIls)}</td>
                    <td className="px-4 py-2 text-gray-600">{he ? DELIVERY_HE[r.delivery] ?? r.delivery : r.delivery}</td>
                    <td className="px-4 py-2 text-end">
                      <a href={r.documentUrl} target="_blank" rel="noreferrer" className="text-[#1B7FA0] hover:underline whitespace-nowrap">{he ? "פתח" : "Open"}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function ChargesTab({ he, charges, onChanged, onError }: { he: boolean; charges: Charge[] | null; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(he ? "מנוי חודשי" : "Monthly membership");
  const [day, setDay] = useState("1");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    onError(null);
    try {
      const local = phone.replace(/\D/g, "").replace(/^0/, "");
      await apiFetch("/api/business/recurring-charges", {
        method: "POST",
        body: JSON.stringify({ name, phone: `${dialCode}${local}`, amountIls: Number(amount), description, dayOfMonth: Number(day) }),
      });
      setName(""); setPhone(""); setAmount("");
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Charge) {
    try {
      await apiFetch(`/api/business/recurring-charges/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  async function remove(c: Charge) {
    if (!window.confirm(he ? `למחוק את החיוב הקבוע של ${who(c.customer)}?` : `Delete the recurring charge for ${who(c.customer)}?`)) return;
    try {
      await apiFetch(`/api/business/recurring-charges/${c.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "שגיאה");
    }
  }

  /** Two trips: a dry run shows what the file holds before a single row is written. */
  async function upload(dryRun: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    onError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("description", description);
      form.append("dayOfMonth", day);
      const body = await apiUpload<ImportResult>(`/api/business/recurring-charges/import${dryRun ? "?dryRun=1" : ""}`, form);
      setImportResult(body);
      if (!dryRun) {
        await onChanged();
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">{he ? "הוספת חיוב קבוע" : "Add a recurring charge"}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={he ? "שם הלקוח" : "Customer name"} className="w-full" />
          <div className="flex gap-2" dir="ltr">
            <select value={dialCode} onChange={(e) => setDialCode(e.target.value)} className="w-32 shrink-0" dir="ltr" aria-label="dial code">
              {DIAL_CODES.map((c) => <option key={c.code} value={c.code}>+{c.code} {he ? c.he : c.label}</option>)}
            </select>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="0501234567" className="w-full" dir="ltr" required />
          </div>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" step="0.01" inputMode="decimal" placeholder={he ? "סכום ב-₪" : "Amount ₪"} className="w-full" required />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={he ? "עבור (יופיע בקבלה)" : "For (appears on the receipt)"} className="w-full" required />
          <label className="text-sm text-gray-600 flex items-center gap-2">
            {he ? "בכל חודש ביום" : "Every month on day"}
            <input value={day} onChange={(e) => setDay(e.target.value)} type="number" min="1" max="31" className="w-20" required />
          </label>
          <button type="submit" disabled={saving} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition justify-self-end">
            {saving ? (he ? "שומר…" : "Saving…") : he ? "הוסף" : "Add"}
          </button>
        </div>
      </form>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="font-semibold text-gray-900 mb-1">{he ? "ייבוא מאקסל" : "Import from Excel"}</h2>
        <p className="text-xs text-gray-500 mb-3">
          {he
            ? "קובץ xlsx או csv עם עמודות: שם, טלפון, סכום, ואופציונלית תיאור ויום. שורה ללא תיאור או יום מקבלת את הערכים מהטופס למעלה. ייבוא חוזר של אותו קובץ מעדכן במקום לכפול."
            : "An xlsx or csv with columns: name, phone, amount, and optionally description and day. Rows without those take the values from the form above. Re-importing the same file updates rather than duplicates."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-sm" onChange={() => setImportResult(null)} />
          <button type="button" onClick={() => upload(true)} disabled={importing} className="text-sm font-medium text-[#1B7FA0] border border-[#1B7FA0] px-3 py-1.5 rounded-lg disabled:opacity-50">
            {he ? "בדיקה בלי לשמור" : "Preview"}
          </button>
          <button type="button" onClick={() => upload(false)} disabled={importing} className="text-sm font-semibold bg-[#1B7FA0] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
            {importing ? "…" : he ? "ייבוא" : "Import"}
          </button>
        </div>
        {importResult && (
          <div className="mt-3 text-sm">
            {importResult.dryRun ? (
              <p className="text-gray-800">{he ? `${importResult.rows?.length ?? 0} שורות תקינות מוכנות לייבוא.` : `${importResult.rows?.length ?? 0} valid rows ready to import.`}</p>
            ) : (
              <p className="text-green-800">{he ? `נוספו ${importResult.created ?? 0}, עודכנו ${importResult.updated ?? 0}.` : `Added ${importResult.created ?? 0}, updated ${importResult.updated ?? 0}.`}</p>
            )}
            {importResult.errors.length > 0 && (
              <ul className="mt-2 text-red-700 text-xs space-y-0.5">
                {importResult.errors.slice(0, 20).map((e, i) => <li key={i}>{he ? `שורה ${e.row}: ` : `Row ${e.row}: `}{e.error}</li>)}
                {importResult.errors.length > 20 && <li>…</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      {charges === null ? <SkeletonCard lines={4} /> : charges.length === 0 ? (
        <EmptyState icon="🧾" title={he ? "עוד אין חיובים קבועים" : "No recurring charges yet"} hint={he ? "הוסיפו לקוח למעלה, או ייבאו רשימה מאקסל." : "Add a customer above, or import a list from Excel."} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {charges.map((c) => (
              <li key={c.id} className={`px-5 py-3 flex flex-wrap items-center gap-3 ${c.active ? "" : "opacity-60"}`}>
                <div className="flex-1 min-w-[160px]">
                  <div className="font-medium text-gray-900">{who(c.customer)}</div>
                  <div className="text-xs text-gray-500">{c.description} · {he ? `כל ${c.dayOfMonth} בחודש` : `every ${c.dayOfMonth} of the month`}{c.active ? "" : he ? " · מושהה" : " · paused"}</div>
                </div>
                <div className="tabular-nums font-semibold text-gray-900">₪{fmt(c.amountIls)}</div>
                <button onClick={() => toggle(c)} className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1">{c.active ? (he ? "השהה" : "Pause") : he ? "הפעל" : "Resume"}</button>
                <button onClick={() => remove(c)} className="text-sm text-red-600 hover:text-red-800 px-2 py-1">{he ? "מחק" : "Delete"}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
