"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { SkeletonRow } from "../../../lib/Skeleton";
import { useDialog } from "../../../lib/useDialog";
import { useLanguage } from "../../../lib/LanguageContext";
import { DEFAULT_TZ } from "../../../lib/tz";

// --- Types ---

interface Campaign {
  id: string;
  name: string;
  category: string;
  locationQuery: string;
  status: string;
  createdAt: string;
  _count?: { leads: number };
}

interface LeadFinderRun {
  id: string;
  campaignId: string;
  status: string;
  totalFound: number;
  totalEnriched: number;
  totalScored: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface CampaignDetail extends Campaign {
  runs: LeadFinderRun[];
}

interface LeadListItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: string;
  latestScore: number | null;
  linkedBusiness: { id: string; name: string } | null;
}

interface BroadcastResult {
  sent: number;
  skippedOptedOut: number;
  skippedAlreadySent: number;
  failed: number;
  failedLeads: { leadId: string; error: string }[];
  totalEligible: number;
}

interface LeadScoreRow {
  id: string;
  version: number;
  totalScore: number;
  breakdown: Record<string, number>;
  createdAt: string;
}

interface LeadStatusEventRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

interface LinkedBusiness {
  id: string;
  name: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  createdAt: string;
}

interface LeadDetail extends LeadListItem {
  address: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  whatsappDetected: boolean;
  hasOnlineBooking: boolean | null;
  hasContactForm: boolean | null;
  websiteStale: boolean | null;
  notes: string | null;
  scores: LeadScoreRow[];
  statusEvents: LeadStatusEventRow[];
  profile: { summary: string; strengths: string[]; gaps: string[]; whyToriFits: string } | null;
  linkedBusiness: LinkedBusiness | null;
}

interface BusinessSearchResult {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: string;
}

interface OutreachMessage {
  id: string;
  channel: "email" | "manual_call";
  angle: string | null;
  subject: string | null;
  body: string;
  approvalStatus: "draft" | "approved" | "rejected";
  sentAt: string | null;
  createdAt: string;
}

interface SuggestedMatch {
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  businessId: string;
  businessName: string;
  businessEmail: string;
  businessCreatedAt: string;
  score: number;
}

const LEAD_STATUSES = ["new", "contacted", "replied", "meeting_scheduled", "trial_sent", "converted", "not_interested"] as const;

// Bilingual, unlike the _HE-only maps these replace. Note what is deliberately NOT here: the
// outreach subject/body below stay Hebrew in both languages. Those are the message *content* sent
// to Israeli salon owners — they follow the recipient's language, not the operator's UI, and
// translating them alongside the chrome would start emailing English to Hebrew-speaking prospects.
const STATUS_LABELS: Record<string, { he: string; en: string }> = {
  new: { he: "חדש", en: "New" },
  contacted: { he: "נוצר קשר", en: "Contacted" },
  replied: { he: "השיב", en: "Replied" },
  meeting_scheduled: { he: "פגישה נקבעה", en: "Meeting booked" },
  trial_sent: { he: "נשלח ניסיון", en: "Trial sent" },
  converted: { he: "הומר ללקוח", en: "Converted" },
  not_interested: { he: "לא מעוניין", en: "Not interested" },
};

const CAMPAIGN_STATUS_LABELS: Record<string, { he: string; en: string }> = {
  draft: { he: "טיוטה", en: "Draft" },
  running: { he: "פעיל", en: "Running" },
  paused: { he: "מושהה", en: "Paused" },
  completed: { he: "הושלם", en: "Completed" },
};

const RUN_STATUS_LABELS: Record<string, { he: string; en: string }> = {
  pending: { he: "ממתין", en: "Pending" },
  discovering: { he: "מאתר עסקים", en: "Discovering" },
  enriching: { he: "מעשיר נתונים", en: "Enriching" },
  scoring: { he: "מדרג", en: "Scoring" },
  completed: { he: "הושלם", en: "Completed" },
  failed: { he: "נכשל", en: "Failed" },
};

function pick(map: Record<string, { he: string; en: string }>, key: string, he: boolean): string {
  const e = map[key];
  return e ? (he ? e.he : e.en) : key;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-600 border-gray-200",
  contacted: "bg-blue-50 text-blue-700 border-blue-200",
  replied: "bg-indigo-50 text-indigo-700 border-indigo-200",
  meeting_scheduled: "bg-amber-50 text-amber-700 border-amber-200",
  trial_sent: "bg-purple-50 text-purple-700 border-purple-200",
  converted: "bg-green-50 text-green-700 border-green-200",
  not_interested: "bg-red-50 text-red-500 border-red-200",
};

export default function LeadFinderPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  const [view, setView] = useState<{ kind: "list" } | { kind: "campaign"; id: string } | { kind: "lead"; id: string; campaignId: string }>({
    kind: "list",
  });

  useEffect(() => {
    apiFetch<{ isSuperAdmin?: boolean }>("/api/business/me")
      .then((me) => {
        setIsSuperAdmin(Boolean(me.isSuperAdmin));
        if (!me.isSuperAdmin) router.replace("/dashboard");
      })
      .catch(() => router.replace("/dashboard"));
  }, [router]);

  if (isSuperAdmin === null) return <div className="animate-fade-in text-gray-600 text-sm">טוען…</div>;
  if (!isSuperAdmin) return null;

  return (
    <div className="animate-fade-in">
      {view.kind === "list" && (
        <CampaignListView onOpenCampaign={(id) => setView({ kind: "campaign", id })} />
      )}
      {view.kind === "campaign" && (
        <CampaignDetailView
          campaignId={view.id}
          onBack={() => setView({ kind: "list" })}
          onOpenLead={(leadId) => setView({ kind: "lead", id: leadId, campaignId: view.id })}
        />
      )}
      {view.kind === "lead" && (
        <LeadDetailView leadId={view.id} onBack={() => setView({ kind: "campaign", id: view.campaignId })} />
      )}
    </div>
  );
}

// --- Campaign list ---

function SuggestedMatchesPanel() {
  const [matches, setMatches] = useState<SuggestedMatch[] | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    apiFetch<SuggestedMatch[]>("/api/leadfinder/suggested-matches")
      .then(setMatches)
      .catch(() => setMatches([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm(m: SuggestedMatch) {
    setBusyLeadId(m.leadId);
    try {
      await apiFetch(`/api/leadfinder/leads/${m.leadId}/link-business`, {
        method: "POST",
        body: JSON.stringify({ businessId: m.businessId }),
      });
      load();
    } finally {
      setBusyLeadId(null);
    }
  }

  const visible = (matches ?? []).filter((m) => !dismissed.has(`${m.leadId}:${m.businessId}`));
  if (visible.length === 0) return null;

  return (
    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4 animate-fade-up">
      <h2 className="text-sm font-semibold text-teal-800 mb-2">
        💡 {visible.length} התאמות אפשריות בין לידים לעסקים שנרשמו עצמאית
      </h2>
      <ul className="flex flex-col gap-1.5">
        {visible.map((m) => {
          const key = `${m.leadId}:${m.businessId}`;
          return (
            <li key={key} className="flex items-center justify-between gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-teal-100">
              <span className="text-gray-700">
                <span className="font-medium">{m.leadName}</span> ({m.leadPhone ?? "—"})
                {" ⟷ "}
                <span className="font-medium">{m.businessName}</span>
                <span className="text-gray-600" dir="ltr"> ({m.businessEmail})</span>
                <span className="text-gray-600 ms-1.5">{m.score}%</span>
              </span>
              <span className="flex gap-1.5 flex-shrink-0">
                <button
                  disabled={busyLeadId === m.leadId}
                  onClick={() => confirm(m)}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  קשר
                </button>
                <button
                  onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                  className="text-xs text-gray-600 hover:text-gray-700 px-2 py-1"
                >
                  התעלם
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CampaignListView({ onOpenCampaign }: { onOpenCampaign: (id: string) => void }) {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const editRef = useDialog<HTMLDivElement>(() => setEditing(null), editing !== null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Campaign[]>("/api/leadfinder/campaigns")
      .then(setCampaigns)
      .catch((err) => setError(err instanceof Error ? err.message : "שגיאה בטעינה"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createCampaign() {
    if (!name.trim() || !category.trim() || !locationQuery.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/leadfinder/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, category, locationQuery }),
      });
      setName("");
      setCategory("");
      setLocationQuery("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה ביצירת קמפיין");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(c: Campaign) {
    setEditing(c);
    setEditName(c.name);
    setEditCategory(c.category);
    setEditLocation(c.locationQuery);
  }

  async function saveEdit() {
    if (!editing) return;
    setEditSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/leadfinder/campaigns/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName, category: editCategory, locationQuery: editLocation }),
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בעדכון קמפיין");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (!confirm(`למחוק את הקמפיין "${c.name}" וכל הלידים שלו לצמיתות?`)) return;
    setDeletingId(c.id);
    setError(null);
    try {
      await apiFetch(`/api/leadfinder/campaigns/${c.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה במחיקת קמפיין");
    } finally {
      setDeletingId(null);
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL", { timeZone: DEFAULT_TZ, day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.leadFinder}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {campaigns ? `${campaigns.length} קמפיינים` : "…"}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "#1B7FA0" }}
        >
          {showForm ? "ביטול" : "צור קמפיין חדש"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-col gap-3 max-w-md">
          <input placeholder="שם הקמפיין (למשל: ספרים - חיפה - יולי 2026)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="קטגוריה (למשל: מספרות | ברברשופ)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input placeholder="מיקום (למשל: חיפה | קריות)" value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} />
          <p className="text-xs text-gray-500 -mt-1">
            אפשר להזין כמה קטגוריות או מיקומים מופרדים ב-| כדי להרחיב את החיפוש. גוגל מחזיר עד כ-60 עסקים לכל צירוף,
            והכפילויות מסוננות אוטומטית.
          </p>
          <button
            disabled={saving}
            onClick={createCampaign}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white self-start disabled:opacity-50"
            style={{ background: "#1B7FA0" }}
          >
            {saving ? "יוצר…" : "צור קמפיין"}
          </button>
        </div>
      )}

      <SuggestedMatchesPanel />

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div ref={editRef} role="dialog" aria-modal="true" aria-labelledby="edit-campaign-title" className="bg-white rounded-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="edit-campaign-title" className="text-lg font-bold text-gray-900 mb-4">עריכת קמפיין</h2>
            <div className="flex flex-col gap-3">
              <input placeholder="שם הקמפיין" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <input placeholder="קטגוריה" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
              <input placeholder="מיקום" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
              <div className="flex gap-2 mt-2">
                <button
                  disabled={editSaving}
                  onClick={saveEdit}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "#1B7FA0" }}
                >
                  {editSaving ? "שומר…" : "שמירה"}
                </button>
                <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600">ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {campaigns === null ? (
          <div>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}</div>
        ) : campaigns.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-600 text-sm">אין עדיין קמפיינים</div>
        ) : (
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-600 font-medium">קמפיין</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">קטגוריה</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">מיקום</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">סטטוס</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">נוצר</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium">לידים</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr
                  key={c.id}
                  className={`hover:bg-gray-50 ${i !== campaigns.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
                  <td className="px-4 py-3 text-gray-800 font-medium cursor-pointer" onClick={() => onOpenCampaign(c.id)}>{c.name}</td>
                  <td className="px-4 py-3 text-gray-600 cursor-pointer" onClick={() => onOpenCampaign(c.id)}>{c.category}</td>
                  <td className="px-4 py-3 text-gray-600 cursor-pointer" onClick={() => onOpenCampaign(c.id)}>{c.locationQuery}</td>
                  <td className="px-4 py-3 cursor-pointer" onClick={() => onOpenCampaign(c.id)}>
                    <span className="inline-flex text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                      {pick(CAMPAIGN_STATUS_LABELS, c.status, he)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => onOpenCampaign(c.id)}>{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700 cursor-pointer" onClick={() => onOpenCampaign(c.id)}>{c._count?.leads ?? 0}</td>
                  <td className="px-4 py-3 text-end whitespace-nowrap">
                    <button onClick={() => openEdit(c)} className="text-xs text-gray-600 hover:text-gray-700 px-2 py-1">עריכה</button>
                    <button
                      disabled={deletingId === c.id}
                      onClick={() => deleteCampaign(c)}
                      className="text-xs text-gray-600 hover:text-red-600 px-2 py-1 disabled:opacity-50"
                    >
                      {deletingId === c.id ? "מוחק…" : "מחיקה"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// --- Broadcast (one operator-written message, sent to every lead with a discovered email) ---

const DEFAULT_BROADCAST_SUBJECT = 'הזמנה לפיילוט סגור: תורי-אונליין — חודש ב-80 ש"ח';
const DEFAULT_BROADCAST_BODY =
  'אהלן, שמי ישעיה, מנכ"ל KestechStudio - אוטומציות.\n\nאני שמח להזמין אתכם להיות מהראשונים שמשתמשים ב"תורי-אונליין" — מערכת AI חדשה שמנהלת לכם את קביעת התורים, 24/7, בלי שתצטרכו לענות לטלפונים או אפילו לשלוח הודעות תזכורת בעצמכם.\n\nאתם מקבלים חשבון ניהול משלכם שבו אתם רואים ומנהלים הכל מלמעלה.\n\nלפני ההשקה אנחנו פותחים פיילוט סגור למספר מצומצם של עסקים: חודש, בעלות של 80 ש"ח. אתם מקבלים את המערכת המלאה, אנחנו מחברים ומלווים אתכם, ואתם אומרים לנו מה עובד ומה פחות.\n\nרוצים להצטרף? תשיבו להודעה "כן, אני מעוניין/ת" או "לא מעוניין". אם כן — נשלח פרטים, ואם לא — נעזוב אתכם בשקט :)\n\nבתודה,\nצוות תורי-אונליין';

function AddLeadModal({
  campaignId,
  onClose,
  onAdded,
}: {
  campaignId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await apiFetch(`/api/leadfinder/campaigns/${campaignId}/leads`, {
        method: "POST",
        body: JSON.stringify({ name, phone, email, address, website, category, notes }),
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בהוספת ליד");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-lead-title" className="bg-white rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 id="manual-lead-title" className="text-lg font-bold text-gray-900 mb-1">הוספת ליד ידנית</h2>
        <p className="text-gray-600 text-sm mb-3">לידים שלא הגיעו מסריקה — הפניה, שיחה, או עסק שאיתרת בעצמך.</p>

        {err && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">{err}</div>}

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">שם העסק *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="text-sm w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">טלפון</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="text-sm w-full" dir="ltr" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">מייל</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="text-sm w-full" dir="ltr" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">כתובת</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="text-sm w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">אתר</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} className="text-sm w-full" dir="ltr" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">קטגוריה</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">הערות</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-sm w-full" />
          </div>

          <div className="flex gap-2 mt-1">
            <button
              disabled={saving || !name.trim()}
              onClick={save}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#1B7FA0" }}
            >
              {saving ? "מוסיף…" : "הוסף ליד"}
            </button>
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BroadcastModal({
  campaignId,
  emailEligible,
  phoneEligible,
  onClose,
  onSent,
}: {
  campaignId: string;
  emailEligible: number;
  phoneEligible: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [subject, setSubject] = useState(DEFAULT_BROADCAST_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BROADCAST_BODY);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const eligibleCount = channel === "whatsapp" ? phoneEligible : emailEligible;

  async function send() {
    setSending(true);
    setErr(null);
    try {
      const res = await apiFetch<BroadcastResult>(`/api/leadfinder/campaigns/${campaignId}/outreach/broadcast`, {
        method: "POST",
        body: JSON.stringify({ subject, body, channel }),
      });
      setResult(res);
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בשליחה");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="broadcast-title" className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 id="broadcast-title" className="text-lg font-bold text-gray-900 mb-1">שליחת הודעת תפוצה</h2>

        {result ? (
          <div className="mt-3">
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2 mb-2">
              נשלח בהצלחה ל-{result.sent} מתוך {result.totalEligible} עסקים.
            </div>
            {(result.skippedAlreadySent > 0 || result.skippedOptedOut > 0) && (
              <div className="text-xs text-gray-600 mb-2">
                {result.skippedAlreadySent > 0 && <div>דולג — כבר קיבלו הודעת תפוצה בעבר: {result.skippedAlreadySent}</div>}
                {result.skippedOptedOut > 0 && <div>דולג — ביקשו הסרה: {result.skippedOptedOut}</div>}
              </div>
            )}
            {result.failed > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-2">
                נכשל אצל {result.failed} עסקים (למשל כתובת מייל לא תקינה). אפשר לנסות שוב מאוחר יותר — מי שכבר נשלח לו לא יקבל שוב.
              </div>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-white mt-2" style={{ background: "#1B7FA0" }}>
              סגירה
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              {(["email", "whatsapp"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setChannel(c); setConfirming(false); }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
                    channel === c ? "bg-[#1B7FA0] text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {c === "email" ? "מייל" : "וואטסאפ"}
                </button>
              ))}
            </div>

            <p className="text-gray-600 text-sm mb-3">
              יש
              <span className="font-medium text-gray-700"> {eligibleCount} </span>
              עסקים בקמפיין עם {channel === "whatsapp" ? "מספר טלפון ידוע" : "כתובת מייל ידועה"} (מי שכבר קיבל תפוצה בערוץ הזה או ביקש הסרה ידולג אוטומטית).
            </p>

            {channel === "whatsapp" && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5 mb-3 leading-relaxed">
                ⚠️ וואטסאפ אוסר על שליחת טקסט חופשי למספרים קרים. ההודעה נשלחת דרך <b>תבנית שיווקית מאושרת מראש</b> של תורי (עם שם העסק כמשתנה) — הטקסט למטה משמש לתיעוד בלבד, לא נשלח כמות שהוא. דורש הגדרת <code dir="ltr">TORI_OUTREACH_*</code> בשרת. שים לב: תפוצה שיווקית לא מבוקשת בוואטסאפ נושאת סיכון לחסימת המספר וחשופה לחוק הספאם — שלח בזהירות ובנפחים קטנים.
              </div>
            )}

            {err && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">{err}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">נושא</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm w-full" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  {channel === "whatsapp" ? "תוכן ההודעה (לתיעוד בלבד — לא נשלח)" : "תוכן ההודעה"}
                </label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="text-sm w-full" />
                {channel === "email" && (
                  <p className="text-[11px] text-gray-600 mt-1">
                    שורת הסרה מרשימת התפוצה תתווסף אוטומטית בסוף ההודעה. תשובות ובקשות הסרה יגיעו לתיבה שמוגדרת ב-
                    <code dir="ltr">OUTREACH_REPLY_TO</code> — בלעדיה השליחה תיחסם.
                  </p>
                )}
              </div>

              {eligibleCount === 0 ? (
                <div className="text-xs text-gray-600">
                  {channel === "whatsapp"
                    ? "אין עסקים עם מספר טלפון בקמפיין הזה."
                    : "אין כרגע עסקים עם כתובת מייל בקמפיין הזה. כתובות מייל מתגלות אוטומטית מהאתר של כל עסק — הרץ סריקה נוספת אם עברו עסקים בלי אתר ידוע קודם לכן."}
                </div>
              ) : !confirming ? (
                <button
                  // WhatsApp sends a pre-approved template — no subject exists on that channel, so
                  // requiring one just strands the operator on a field that goes nowhere.
                  disabled={!body.trim() || (channel === "email" && !subject.trim())}
                  onClick={() => setConfirming(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white self-start disabled:opacity-50"
                  style={{ background: "#1B7FA0" }}
                >
                  המשך
                </button>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800 mb-3">
                    לשלוח את ההודעה הזו ל-{eligibleCount} עסקים עכשיו? זו פעולה בלתי הפיכה — לא ניתן לבטל הודעות שכבר נשלחו.
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={sending}
                      onClick={send}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                      style={{ background: "#B45309" }}
                    >
                      {sending ? "שולח…" : `כן, שלח ל-${eligibleCount} עסקים`}
                    </button>
                    <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600">ביטול</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Campaign detail (runs + leads) ---

function CampaignDetailView({
  campaignId,
  onBack,
  onOpenLead,
}: {
  campaignId: string;
  onBack: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [leads, setLeads] = useState<LeadListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaign = useCallback(() => {
    apiFetch<CampaignDetail>(`/api/leadfinder/campaigns/${campaignId}`)
      .then(setCampaign)
      .catch((err) => setError(err instanceof Error ? err.message : "שגיאה בטעינה"));
  }, [campaignId]);

  const loadLeads = useCallback(() => {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    apiFetch<LeadListItem[]>(`/api/leadfinder/campaigns/${campaignId}/leads${qs}`)
      .then(setLeads)
      .catch((err) => setError(err instanceof Error ? err.message : "שגיאה בטעינה"));
  }, [campaignId, statusFilter]);

  useEffect(() => {
    loadCampaign();
    loadLeads();
  }, [loadCampaign, loadLeads]);

  const latestRun = campaign?.runs?.[0];
  const runInFlight = latestRun && !["completed", "failed"].includes(latestRun.status);

  useEffect(() => {
    if (!runInFlight) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      loadCampaign();
      loadLeads();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runInFlight, loadCampaign, loadLeads]);

  async function startRun() {
    setStarting(true);
    setError(null);
    try {
      await apiFetch(`/api/leadfinder/campaigns/${campaignId}/runs`, { method: "POST" });
      loadCampaign();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהתחלת סריקה");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <button onClick={onBack} className="text-sm text-gray-600 mb-4 hover:text-gray-800">← חזרה לקמפיינים</button>

      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign?.name ?? "…"}</h1>
          <p className="text-gray-600 text-sm mt-1">{campaign ? `${campaign.category} · ${campaign.locationQuery}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddLead(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100"
          >
            + הוסף ליד ידנית
          </button>
          <button
            disabled={!leads || leads.filter((l) => l.email || l.phone).length === 0}
            onClick={() => setShowBroadcast(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 disabled:opacity-50"
          >
            📢 שלח הודעת תפוצה
          </button>
          <button
            disabled={starting || Boolean(runInFlight)}
            onClick={startRun}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "#1B7FA0" }}
          >
            {runInFlight ? "סריקה פעילה…" : starting ? "מתחיל…" : "התחל סריקה"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      {showAddLead && (
        <AddLeadModal
          campaignId={campaignId}
          onClose={() => setShowAddLead(false)}
          onAdded={() => {
            setShowAddLead(false);
            loadLeads();
          }}
        />
      )}

      {showBroadcast && (
        <BroadcastModal
          campaignId={campaignId}
          emailEligible={leads?.filter((l) => l.email).length ?? 0}
          phoneEligible={leads?.filter((l) => l.phone).length ?? 0}
          onClose={() => setShowBroadcast(false)}
          onSent={loadLeads}
        />
      )}

      {latestRun && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">סריקה אחרונה — {pick(RUN_STATUS_LABELS, latestRun.status, he)}</span>
            {latestRun.status === "failed" && latestRun.errorMessage && (
              <span className="text-xs text-red-500">{latestRun.errorMessage}</span>
            )}
          </div>
          <div className="flex gap-6 text-xs text-gray-600">
            <span>נמצאו: {latestRun.totalFound}</span>
            <span>הועשרו: {latestRun.totalEnriched}</span>
            <span>דורגו: {latestRun.totalScored}</span>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-gray-600">סינון לפי סטטוס:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm">
          <option value="">הכל</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{pick(STATUS_LABELS, s, he)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {leads === null ? (
          <div>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}</div>
        ) : leads.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-600 text-sm">אין עדיין לידים — התחל סריקה כדי לאתר עסקים</div>
        ) : (
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-600 font-medium">שם</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">טלפון</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">מייל</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">אתר</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">סטטוס</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium">ניקוד</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l, i) => (
                <tr
                  key={l.id}
                  className={`cursor-pointer hover:bg-gray-50 ${i !== leads.length - 1 ? "border-b border-gray-200/50" : ""}`}
                  onClick={() => onOpenLead(l.id)}
                >
                  <td className="px-4 py-3 text-gray-800 font-medium">
                    {l.name}
                    {l.linkedBusiness && (
                      <span className="ms-1.5 inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                        מקושר
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">{l.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[180px]" dir="ltr">{l.email ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[200px]" dir="ltr">{l.website ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[l.status] ?? ""}`}>
                      {pick(STATUS_LABELS, l.status, he)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700 font-medium">{l.latestScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// --- Lead detail ---

function ConversionPanel({ lead, onChanged }: { lead: LeadDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "create" | "link">("none");
  const [email, setEmail] = useState("");
  const [nameOverride, setNameOverride] = useState(lead.name);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<BusinessSearchResult[]>([]);

  useEffect(() => {
    if (mode !== "link" || searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<BusinessSearchResult[]>(`/api/leadfinder/businesses-search?q=${encodeURIComponent(searchQ)}`)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [mode, searchQ]);

  async function createAccount() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/leadfinder/leads/${lead.id}/create-account`, {
        method: "POST",
        body: JSON.stringify({ email, name: nameOverride }),
      });
      onChanged();
      setMode("none");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  async function linkBusiness(businessId: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/leadfinder/leads/${lead.id}/link-business`, {
        method: "POST",
        body: JSON.stringify({ businessId }),
      });
      onChanged();
      setMode("none");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!confirm("להסיר את הקישור לחשבון?")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/leadfinder/leads/${lead.id}/link-business`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (lead.linkedBusiness) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">חשבון תורי מקושר</h2>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-gray-700">
            <span className="font-medium">{lead.linkedBusiness.name}</span>
            <span className="text-gray-600 ms-2">
              {lead.linkedBusiness.subscriptionStatus}{lead.linkedBusiness.subscriptionPlan ? ` · ${lead.linkedBusiness.subscriptionPlan}` : ""}
            </span>
          </div>
          <button onClick={unlink} disabled={busy} className="text-xs text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg">
            הסר קישור
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">המרה לחשבון תורי</h2>
      {err && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">{err}</div>}

      {mode === "none" && (
        <div className="flex items-center gap-2">
          <button onClick={() => setMode("create")} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100">
            צור חשבון ניסיון
          </button>
          <button onClick={() => setMode("link")} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
            קשר לחשבון קיים (נרשם עצמאית)
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="flex flex-col gap-2">
          <input placeholder="שם העסק" value={nameOverride} onChange={(e) => setNameOverride(e.target.value)} className="text-xs" />
          <input placeholder="אימייל העסק" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="text-xs" />
          <p className="text-[11px] text-gray-600">ישלח לעסק מייל עם קישור לקביעת סיסמה והתחלה.</p>
          <div className="flex gap-2">
            <button disabled={busy || !email} onClick={createAccount} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
              {busy ? "יוצר…" : "צור ושלח"}
            </button>
            <button onClick={() => setMode("none")} className="text-xs text-gray-600">ביטול</button>
          </div>
        </div>
      )}

      {mode === "link" && (
        <div className="flex flex-col gap-2">
          <input placeholder="חיפוש לפי שם או אימייל" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="text-xs" />
          {searchResults.length > 0 && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {searchResults.map((b) => (
                <button
                  key={b.id}
                  disabled={busy}
                  onClick={() => linkBusiness(b.id)}
                  className="w-full text-start px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between"
                >
                  <span>{b.name} <span className="text-gray-600" dir="ltr">({b.email})</span></span>
                  <span className="text-gray-600">{b.subscriptionStatus}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setMode("none")} className="text-xs text-gray-600 self-start">ביטול</button>
        </div>
      )}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, { he: string; en: string }> = {
  draft: { he: "טיוטה", en: "Draft" }, approved: { he: "מאושר", en: "Approved" }, rejected: { he: "נדחה", en: "Rejected" },
};
const CHANNEL_LABELS: Record<string, { he: string; en: string }> = {
  email: { he: "מייל", en: "Email" }, manual_call: { he: "שיחת טלפון", en: "Phone call" },
};

function OutreachPanel({ leadId }: { leadId: string }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [messages, setMessages] = useState<OutreachMessage[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [channel, setChannel] = useState<"email" | "manual_call">("email");
  const [angle, setAngle] = useState<"initial" | "follow_up_1">("initial");
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [sendToEmail, setSendToEmail] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<OutreachMessage[]>(`/api/leadfinder/leads/${leadId}/outreach`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setErr(null);
    try {
      await apiFetch(`/api/leadfinder/leads/${leadId}/outreach/generate`, {
        method: "POST",
        body: JSON.stringify({ channel, angle }),
      });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה ביצירת טיוטה");
    } finally {
      setGenerating(false);
    }
  }

  function startEdit(m: OutreachMessage) {
    setEditingId(m.id);
    setEditSubject(m.subject ?? "");
    setEditBody(m.body);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/leadfinder/outreach/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ subject: editSubject || undefined, body: editBody }),
      });
      setEditingId(null);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function setApproval(id: string, approvalStatus: "approved" | "rejected") {
    setBusyId(id);
    try {
      await apiFetch(`/api/leadfinder/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ approvalStatus }) });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function send(m: OutreachMessage) {
    setBusyId(m.id);
    setErr(null);
    try {
      await apiFetch(`/api/leadfinder/outreach/${m.id}/send`, {
        method: "POST",
        body: JSON.stringify(m.channel === "email" ? { toEmail: sendToEmail } : {}),
      });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בשליחה");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">הודעות יזומות (Outreach)</h2>
      {err && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">{err}</div>}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "manual_call")} className="text-xs">
          <option value="email">מייל</option>
          <option value="manual_call">תסריט שיחה</option>
        </select>
        <select value={angle} onChange={(e) => setAngle(e.target.value as "initial" | "follow_up_1")} className="text-xs">
          <option value="initial">פנייה ראשונה</option>
          <option value="follow_up_1">מעקב (follow-up)</option>
        </select>
        <button
          disabled={generating}
          onClick={generate}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 disabled:opacity-50"
        >
          {generating ? "יוצר טיוטה…" : "✨ צור טיוטה עם AI"}
        </button>
      </div>

      {messages === null ? (
        <div className="text-xs text-gray-600 py-4 text-center">…</div>
      ) : messages.length === 0 ? (
        <div className="text-xs text-gray-600 py-4 text-center">אין עדיין טיוטות — צור אחת למעלה</div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-gray-600">{pick(CHANNEL_LABELS, m.channel, he)}</span>
                  <span className="text-gray-600">· {m.angle === "follow_up_1" ? "מעקב" : "ראשונה"}</span>
                  <span
                    className={`inline-flex px-1.5 py-0.5 rounded-full border ${
                      m.approvalStatus === "approved"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : m.approvalStatus === "rejected"
                          ? "bg-red-50 text-red-600 border-red-200"
                          : "bg-gray-50 text-gray-600 border-gray-200"
                    }`}
                  >
                    {pick(APPROVAL_LABELS, m.approvalStatus, he)}
                  </span>
                  {m.sentAt && <span className="text-green-700">✓ נשלח {new Date(m.sentAt).toLocaleDateString("he-IL")}</span>}
                </div>
                {!m.sentAt && editingId !== m.id && (
                  <button onClick={() => startEdit(m)} className="text-[11px] text-gray-600 hover:text-gray-700">עריכה</button>
                )}
              </div>

              {editingId === m.id ? (
                <div className="flex flex-col gap-2">
                  {m.channel === "email" && (
                    <input placeholder="נושא" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} className="text-xs" />
                  )}
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} className="text-xs" />
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === m.id}
                      onClick={() => saveEdit(m.id)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      שמור
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-600">ביטול</button>
                  </div>
                </div>
              ) : (
                <>
                  {m.subject && <div className="text-xs font-medium text-gray-800 mb-1">{m.subject}</div>}
                  <div className="text-xs text-gray-600 whitespace-pre-wrap">{m.body}</div>
                </>
              )}

              {!m.sentAt && editingId !== m.id && (
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100 flex-wrap">
                  {m.approvalStatus === "draft" && (
                    <>
                      <button
                        disabled={busyId === m.id}
                        onClick={() => setApproval(m.id, "approved")}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50"
                      >
                        אשר
                      </button>
                      <button
                        disabled={busyId === m.id}
                        onClick={() => setApproval(m.id, "rejected")}
                        className="text-xs text-gray-600 hover:text-red-600 px-2.5 py-1"
                      >
                        דחה
                      </button>
                    </>
                  )}
                  {m.approvalStatus === "approved" && (
                    <>
                      {m.channel === "email" && (
                        <input
                          placeholder="אימייל היעד"
                          dir="ltr"
                          value={sendToEmail}
                          onChange={(e) => setSendToEmail(e.target.value)}
                          className="text-xs flex-1 min-w-[160px]"
                        />
                      )}
                      <button
                        disabled={busyId === m.id || (m.channel === "email" && !sendToEmail.trim())}
                        onClick={() => send(m)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        {m.channel === "email" ? "שלח מייל" : "סמן כבוצע"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadDetailView({ leadId, onBack }: { leadId: string; onBack: () => void }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(() => {
    apiFetch<LeadDetail>(`/api/leadfinder/leads/${leadId}`)
      .then(setLead)
      .catch((err) => setError(err instanceof Error ? err.message : "שגיאה בטעינה"));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(status: string) {
    setUpdating(true);
    setError(null);
    try {
      await apiFetch(`/api/leadfinder/leads/${leadId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בעדכון סטטוס");
    } finally {
      setUpdating(false);
    }
  }

  if (!lead) {
    return (
      <>
        <button onClick={onBack} className="text-sm text-gray-600 mb-4 hover:text-gray-800">← חזרה</button>
        {error ? <div className="text-red-600 text-sm">{error}</div> : <div className="text-gray-600 text-sm">טוען…</div>}
      </>
    );
  }

  const latestScore = lead.scores?.[0];

  return (
    <>
      <button onClick={onBack} className="text-sm text-gray-600 mb-4 hover:text-gray-800">← חזרה לקמפיין</button>

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
          <p className="text-gray-600 text-sm mt-1">{lead.address ?? ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">סטטוס:</span>
          <select disabled={updating} value={lead.status} onChange={(e) => changeStatus(e.target.value)} className="text-sm">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{pick(STATUS_LABELS, s, he)}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      <ConversionPanel lead={lead} onChanged={load} />

      <OutreachPanel leadId={lead.id} />

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">פרטי קשר</h2>
          <div className="text-sm text-gray-600 flex flex-col gap-1.5">
            <div>טלפון: <span dir="ltr">{lead.phone ?? "—"}</span></div>
            <div>אתר: <span dir="ltr">{lead.website ?? "—"}</span></div>
            <div>קטגוריה: {lead.category ?? "—"}</div>
            <div>דירוג: {lead.rating ?? "—"} ({lead.reviewCount ?? 0} ביקורות)</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">העשרת נתונים</h2>
          <div className="text-sm text-gray-600 flex flex-col gap-1.5">
            <div>וואטסאפ באתר: {lead.whatsappDetected ? "כן" : "לא"}</div>
            <div>מערכת הזמנות אונליין: {lead.hasOnlineBooking === null ? "לא ידוע" : lead.hasOnlineBooking ? "כן" : "לא"}</div>
            <div>טופס יצירת קשר: {lead.hasContactForm === null ? "לא ידוע" : lead.hasContactForm ? "כן" : "לא"}</div>
            <div>אתר לא מעודכן: {lead.websiteStale === null ? "לא ידוע" : lead.websiteStale ? "כן" : "לא"}</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">ניקוד</h2>
        {latestScore ? (
          <>
            <div className="text-2xl font-bold text-gray-900 mb-2">{latestScore.totalScore}</div>
            <div className="flex flex-col gap-1 text-sm text-gray-600">
              {Object.entries(latestScore.breakdown).map(([factor, value]) => (
                <div key={factor} className="flex justify-between max-w-xs">
                  <span>{factor}</span>
                  <span className="tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-gray-600 text-sm">טרם חושב ניקוד</div>
        )}
      </div>

      {lead.profile && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">פרופיל</h2>
          <p className="text-sm text-gray-600 mb-3">{lead.profile.summary}</p>
          <p className="text-sm text-gray-600">{lead.profile.whyToriFits}</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">היסטוריית סטטוס</h2>
        {lead.statusEvents.length === 0 ? (
          <div className="text-gray-600 text-sm">אין עדיין שינויי סטטוס</div>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            {lead.statusEvents.map((e) => (
              <div key={e.id} className="flex justify-between">
                <span>{e.fromStatus ? `${pick(STATUS_LABELS, e.fromStatus, he)} ← ` : ""}{pick(STATUS_LABELS, e.toStatus, he)}</span>
                <span className="text-gray-600 text-xs">{new Date(e.createdAt).toLocaleString("he-IL")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
