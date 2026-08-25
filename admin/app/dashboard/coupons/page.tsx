"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonCard } from "../../lib/Skeleton";
import { EmptyState } from "../../lib/EmptyState";

interface CustomerCoupon {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  serviceIds: string[];
  maxUses: number | null;
  usedCount: number;
  onePerCustomer: boolean;
  expiresAt: string | null;
  active: boolean;
  description: string | null;
}

interface Service {
  id: string;
  name: string;
}

/**
 * Discount codes the business hands out to its own customers.
 *
 * The bot is what actually applies them: a customer types the code mid-conversation, the bot checks
 * it and quotes the discounted price. So this screen's job is only to define them — and to say
 * plainly that the code has to reach customers some other way, because an owner who creates one
 * here and waits for something to happen has built a promotion nobody can use.
 */
export default function CouponsPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [coupons, setCoupons] = useState<CustomerCoupon[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [onePerCustomer, setOnePerCustomer] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");
  const [description, setDescription] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  async function load() {
    setCoupons(await apiFetch<CustomerCoupon[]>("/api/business/customer-coupons"));
  }

  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      setCoupons([]);
    });
    apiFetch<Service[]>("/api/business/services")
      .then(setServices)
      // Non-fatal: without the list the per-service picker is simply not offered, and a coupon
      // with no services selected is valid on everything — the sensible default anyway.
      .catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/customer-coupons", {
        method: "POST",
        body: JSON.stringify({
          code,
          discountType,
          discountValue: Number(discountValue),
          serviceIds,
          maxUses: maxUses ? Number(maxUses) : null,
          onePerCustomer,
          // The date input gives a bare day; the server wants an instant. End of that day, so a
          // coupon "valid until the 31st" works all through the 31st rather than expiring at
          // midnight as it begins.
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
          description: description || undefined,
        }),
      });
      setCode("");
      setDiscountValue("");
      setMaxUses("");
      setExpiresAt("");
      setDescription("");
      setServiceIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "היצירה נכשלה" : "Could not create");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: CustomerCoupon) {
    await apiFetch(`/api/business/customer-coupons/${c.id}`, {
      method: "PUT",
      body: JSON.stringify({
        code: c.code,
        discountType: c.discountType,
        discountValue: c.discountValue,
        serviceIds: c.serviceIds,
        maxUses: c.maxUses,
        onePerCustomer: c.onePerCustomer,
        expiresAt: c.expiresAt,
        active: !c.active,
        description: c.description ?? undefined,
      }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm(he ? "למחוק את הקוד? לקוחות לא יוכלו להשתמש בו יותר." : "Delete this code? Customers won't be able to use it any more.")) return;
    await apiFetch(`/api/business/customer-coupons/${id}`, { method: "DELETE" });
    await load();
  }

  function describe(c: CustomerCoupon): string {
    const off = c.discountType === "percent" ? `${c.discountValue}%` : `₪${c.discountValue}`;
    const scope =
      c.serviceIds.length === 0
        ? he ? "כל השירותים" : "all services"
        : c.serviceIds
            .map((id) => services.find((s) => s.id === id)?.name)
            .filter(Boolean)
            .join(", ") || (he ? "שירותים נבחרים" : "selected services");
    return he ? `${off} הנחה · ${scope}` : `${off} off · ${scope}`;
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "קודי הנחה" : "Discount codes"}</h1>
        <p className="text-gray-600 text-sm mt-1">
          {he
            ? "קודים שאתם נותנים ללקוחות שלכם. כשלקוח כותב קוד לבוט, הוא בודק אותו ומעדכן את המחיר לפני שהוא סוגר את התור."
            : "Codes you give your own customers. When a customer sends one to the bot, it checks the code and quotes the new price before booking."}
        </p>
      </div>

      <form onSubmit={create} className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">{he ? "קוד חדש" : "New code"}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "הקוד" : "Code"}</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={he ? "לדוגמה: WELCOME10" : "e.g. WELCOME10"}
              dir="ltr"
              required
              className="w-full"
            />
            <p className="text-[11px] text-gray-600 mt-1">
              {he ? "אותיות באנגלית וספרות — קל להכתיב בטלפון ובוואטסאפ." : "Latin letters and digits — easy to dictate over the phone."}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "ההנחה" : "Discount"}</label>
            <div className="flex gap-2">
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
                className="w-32 shrink-0"
              >
                <option value="percent">{he ? "אחוזים" : "Percent"}</option>
                <option value="fixed">{he ? "שקלים" : "Shekels"}</option>
              </select>
              <input
                type="number"
                min={1}
                max={discountType === "percent" ? 100 : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percent" ? "10" : "50"}
                required
                className="w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              {he ? "מקסימום שימושים (ריק = ללא הגבלה)" : "Max uses (blank = unlimited)"}
            </label>
            <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={he ? "ללא הגבלה" : "Unlimited"} className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              {he ? "בתוקף עד (ריק = ללא תאריך)" : "Valid until (blank = no end date)"}
            </label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full" dir="ltr" />
          </div>
        </div>

        {services.length > 0 && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              {he ? "תקף לשירותים (לא בחרתם? תקף לכולם)" : "Valid for services (none selected = all)"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {services.map((s) => {
                const on = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setServiceIds((prev) => (on ? prev.filter((id) => id !== s.id) : [...prev, s.id]))}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                      on ? "bg-[#1B7FA0] text-white border-[#1B7FA0]" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            {he ? "מה הבוט יגיד ללקוח (לא חובה)" : "What the bot tells the customer (optional)"}
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={he ? "לדוגמה: 10% הנחה ללקוחות חדשים" : "e.g. 10% off for new customers"}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 mt-3">
          <input type="checkbox" checked={onePerCustomer} onChange={(e) => setOnePerCustomer(e.target.checked)} />
          <span className="text-xs text-gray-700">
            {he ? "פעם אחת ללקוח (לפי מספר טלפון)" : "Once per customer (by phone number)"}
          </span>
        </label>

        <div className="flex items-center gap-3 mt-4">
          <button
            type="submit"
            disabled={saving || !code.trim() || !discountValue}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {saving ? (he ? "יוצר…" : "Creating…") : he ? "יצירת קוד" : "Create code"}
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      </form>

      {coupons === null ? (
        <SkeletonCard lines={3} />
      ) : coupons.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <EmptyState
            icon="🎟️"
            title={he ? "עוד אין קודי הנחה" : "No discount codes yet"}
            hint={
              he
                ? "צרו קוד למעלה, ואז שתפו אותו — בסטורי, על כרטיס בקופה, או בהודעה ללקוחות. הבוט יזהה אותו כשלקוח יכתוב אותו."
                : "Create one above, then share it — in a story, on a card at the counter, or in a message. The bot recognises it when a customer types it."
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {coupons.map((c) => {
            const exhausted = c.maxUses !== null && c.usedCount >= c.maxUses;
            const expired = Boolean(c.expiresAt && new Date(c.expiresAt).getTime() < Date.now());
            const live = c.active && !exhausted && !expired;
            return (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-900 tabular-nums" dir="ltr">{c.code}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        live
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }`}
                    >
                      {/* Says WHY it isn't live. "Inactive" alone sends the owner looking for a
                          switch when the real answer is that it ran out or the date passed. */}
                      {live
                        ? he ? "פעיל" : "Live"
                        : exhausted
                          ? he ? "מוצה" : "Used up"
                          : expired
                            ? he ? "פג תוקף" : "Expired"
                            : he ? "כבוי" : "Off"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{describe(c)}</p>
                  <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
                    {he ? "נוצל " : "Used "}
                    {c.usedCount}
                    {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                    {c.onePerCustomer ? (he ? " · פעם אחת ללקוח" : " · once per customer") : ""}
                    {c.expiresAt ? ` · ${he ? "עד" : "until"} ${new Date(c.expiresAt).toLocaleDateString(he ? "he-IL" : "en-GB")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(c)}
                    className="text-xs font-medium text-[#197492] hover:underline row-action"
                  >
                    {c.active ? (he ? "כיבוי" : "Turn off") : he ? "הפעלה" : "Turn on"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="text-xs font-medium text-red-600 hover:text-red-700 row-action"
                  >
                    {he ? "מחיקה" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
