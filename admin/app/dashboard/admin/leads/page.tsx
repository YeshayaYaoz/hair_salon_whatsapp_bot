"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { SkeletonRow } from "../../../lib/Skeleton";

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
  website: string | null;
  status: string;
  latestScore: number | null;
  linkedBusiness: { id: string; name: string } | null;
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

const LEAD_STATUSES = ["new", "contacted", "replied", "meeting_scheduled", "trial_sent", "converted", "not_interested"] as const;

const STATUS_LABELS_HE: Record<string, string> = {
  new: "חדש",
  contacted: "נוצר קשר",
  replied: "השיב",
  meeting_scheduled: "פגישה נקבעה",
  trial_sent: "נשלח ניסיון",
  converted: "הומר ללקוח",
  not_interested: "לא מעוניין",
};

const CAMPAIGN_STATUS_LABELS_HE: Record<string, string> = {
  draft: "טיוטה",
  running: "פעיל",
  paused: "מושהה",
  completed: "הושלם",
};

const RUN_STATUS_LABELS_HE: Record<string, string> = {
  pending: "ממתין",
  discovering: "מאתר עסקים",
  enriching: "מעשיר נתונים",
  scoring: "מדרג",
  completed: "הושלם",
  failed: "נכשל",
};

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

  if (isSuperAdmin === null) return <div className="animate-fade-in text-gray-400 text-sm">טוען…</div>;
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

function CampaignListView({ onOpenCampaign }: { onOpenCampaign: (id: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [saving, setSaving] = useState(false);

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

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">מציאת לידים</h1>
          <p className="text-gray-500 text-sm mt-1">
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
          <input placeholder="קטגוריה (למשל: מספרות)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input placeholder="מיקום (למשל: חיפה, רדיוס 15 ק״מ)" value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} />
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

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {campaigns === null ? (
          <div>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}</div>
        ) : campaigns.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">אין עדיין קמפיינים</div>
        ) : (
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-500 font-medium">קמפיין</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">קטגוריה</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">מיקום</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">סטטוס</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">נוצר</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">לידים</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr
                  key={c.id}
                  className={`cursor-pointer hover:bg-gray-50 ${i !== campaigns.length - 1 ? "border-b border-gray-200/50" : ""}`}
                  onClick={() => onOpenCampaign(c.id)}
                >
                  <td className="px-4 py-3 text-gray-800 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.category}</td>
                  <td className="px-4 py-3 text-gray-500">{c.locationQuery}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                      {CAMPAIGN_STATUS_LABELS_HE[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">{c._count?.leads ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
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
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [leads, setLeads] = useState<LeadListItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <button onClick={onBack} className="text-sm text-gray-500 mb-4 hover:text-gray-800">← חזרה לקמפיינים</button>

      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign?.name ?? "…"}</h1>
          <p className="text-gray-500 text-sm mt-1">{campaign ? `${campaign.category} · ${campaign.locationQuery}` : ""}</p>
        </div>
        <button
          disabled={starting || Boolean(runInFlight)}
          onClick={startRun}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "#1B7FA0" }}
        >
          {runInFlight ? "סריקה פעילה…" : starting ? "מתחיל…" : "התחל סריקה"}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      {latestRun && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">סריקה אחרונה — {RUN_STATUS_LABELS_HE[latestRun.status] ?? latestRun.status}</span>
            {latestRun.status === "failed" && latestRun.errorMessage && (
              <span className="text-xs text-red-500">{latestRun.errorMessage}</span>
            )}
          </div>
          <div className="flex gap-6 text-xs text-gray-500">
            <span>נמצאו: {latestRun.totalFound}</span>
            <span>הועשרו: {latestRun.totalEnriched}</span>
            <span>דורגו: {latestRun.totalScored}</span>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-gray-500">סינון לפי סטטוס:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm">
          <option value="">הכל</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS_HE[s]}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {leads === null ? (
          <div>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}</div>
        ) : leads.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">אין עדיין לידים — התחל סריקה כדי לאתר עסקים</div>
        ) : (
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-500 font-medium">שם</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">טלפון</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">אתר</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">סטטוס</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">ניקוד</th>
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
                  <td className="px-4 py-3 text-gray-500" dir="ltr">{l.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]" dir="ltr">{l.website ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[l.status] ?? ""}`}>
                      {STATUS_LABELS_HE[l.status] ?? l.status}
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
            <span className="text-gray-400 ms-2">
              {lead.linkedBusiness.subscriptionStatus}{lead.linkedBusiness.subscriptionPlan ? ` · ${lead.linkedBusiness.subscriptionPlan}` : ""}
            </span>
          </div>
          <button onClick={unlink} disabled={busy} className="text-xs text-gray-400 hover:text-red-600 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg">
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
          <p className="text-[11px] text-gray-400">ישלח לעסק מייל עם קישור לקביעת סיסמה והתחלה.</p>
          <div className="flex gap-2">
            <button disabled={busy || !email} onClick={createAccount} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
              {busy ? "יוצר…" : "צור ושלח"}
            </button>
            <button onClick={() => setMode("none")} className="text-xs text-gray-400">ביטול</button>
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
                  <span>{b.name} <span className="text-gray-400" dir="ltr">({b.email})</span></span>
                  <span className="text-gray-400">{b.subscriptionStatus}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setMode("none")} className="text-xs text-gray-400 self-start">ביטול</button>
        </div>
      )}
    </div>
  );
}

function LeadDetailView({ leadId, onBack }: { leadId: string; onBack: () => void }) {
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
        <button onClick={onBack} className="text-sm text-gray-500 mb-4 hover:text-gray-800">← חזרה</button>
        {error ? <div className="text-red-600 text-sm">{error}</div> : <div className="text-gray-400 text-sm">טוען…</div>}
      </>
    );
  }

  const latestScore = lead.scores?.[0];

  return (
    <>
      <button onClick={onBack} className="text-sm text-gray-500 mb-4 hover:text-gray-800">← חזרה לקמפיין</button>

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
          <p className="text-gray-500 text-sm mt-1">{lead.address ?? ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">סטטוס:</span>
          <select disabled={updating} value={lead.status} onChange={(e) => changeStatus(e.target.value)} className="text-sm">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS_HE[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      <ConversionPanel lead={lead} onChanged={load} />

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
          <div className="text-gray-400 text-sm">טרם חושב ניקוד</div>
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
          <div className="text-gray-400 text-sm">אין עדיין שינויי סטטוס</div>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            {lead.statusEvents.map((e) => (
              <div key={e.id} className="flex justify-between">
                <span>{e.fromStatus ? `${STATUS_LABELS_HE[e.fromStatus] ?? e.fromStatus} ← ` : ""}{STATUS_LABELS_HE[e.toStatus] ?? e.toStatus}</span>
                <span className="text-gray-400 text-xs">{new Date(e.createdAt).toLocaleString("he-IL")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
