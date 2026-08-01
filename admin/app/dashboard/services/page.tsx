"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonRow } from "../../lib/Skeleton";
import { readableOnTint } from "../../lib/readableColor";
import { AutoTextarea } from "../../lib/AutoTextarea";

// A curated, muted palette instead of raw saturated primaries — tones picked to sit together
// (similar chroma/lightness) so any combination of service tags looks intentional, not like a
// crayon box. Named for what they read as, not by CSS keyword.
const COLORS = [
  { hex: "#1B7FA0", he: "תכלת (ברירת מחדל)", en: "Teal (default)" }, // brand teal
  { hex: "#7C6FDB", he: "לילך", en: "Lilac" },
  { hex: "#D4708A", he: "אשכולית", en: "Grapefruit" },
  { hex: "#C99A3E", he: "זהב", en: "Gold" },
  { hex: "#3FA98A", he: "אזמרגד", en: "Emerald" },
  { hex: "#5B7FBF", he: "אינדיגו", en: "Indigo" },
];

interface Service {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  durationMin: number;
  color?: string;
  capacity?: number;
  imageUrls?: string[];
  linkUrl?: string;
}

interface EditState {
  name: string;
  description: string;
  price: string;
  duration: string;
  color: string;
  capacity: string;
  imageUrls: string[];
  linkUrl: string;
}

export default function ServicesPage() {
  const { t, lang, businessType } = useLanguage();
  // Overnight verticals price by night, not by the minute. Duration is still STORED in minutes
  // (the slot engine's unit, shared by every vertical) — only the input is expressed in nights
  // and converted at the boundary, so nothing downstream needs a special case.
  const overnight = businessType === "bnb";
  const MIN_PER_NIGHT = 1440;
  const toDurationInput = (min: number) => String(overnight ? Math.max(1, Math.round(min / MIN_PER_NIGHT)) : min);
  const fromDurationInput = (v: string) => (overnight ? Math.max(1, Number(v) || 1) * MIN_PER_NIGHT : Number(v));
  const durationLabel = overnight ? t.durationNights : t.duration;
  const [services, setServices] = useState<Service[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", description: "", price: "", duration: "", color: COLORS[0].hex, capacity: "1", imageUrls: [], linkUrl: "" });
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newCapacity, setNewCapacity] = useState("1");
  const [newColor, setNewColor] = useState(COLORS[0].hex);
  const [newImageUrls, setNewImageUrls] = useState<string[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from `error` (which also carries add/save failures) so a failed *list* load
  // is reported where the list is, instead of in the add-service card at the bottom of the page.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setServices(await apiFetch<Service[]>("/api/business/services"));
    setLoaded(true);
  }

  // `setLoaded(true)` on failure too: without it the skeleton rows below render forever, so a
  // dead API looks like a page that is still loading rather than one that failed.
  useEffect(() => {
    load().catch((e) => {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoaded(true);
    });
  }, []);

  function startEdit(s: Service) {
    setEditingId(s.id);
    setEditState({
      name: s.name,
      description: s.description ?? "",
      price: (s.priceCents / 100).toFixed(0),
      duration: toDurationInput(s.durationMin),
      color: s.color ?? COLORS[0].hex,
      capacity: String(s.capacity ?? 1),
      imageUrls: s.imageUrls ?? [],
      linkUrl: s.linkUrl ?? "",
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await apiFetch(`/api/business/services/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editState.name,
          description: editState.description || undefined,
          priceCents: Math.round(Number(editState.price) * 100),
          durationMin: fromDurationInput(editState.duration),
          color: editState.color,
          capacity: Math.max(1, Number(editState.capacity) || 1),
          imageUrls: editState.imageUrls.map((u) => u.trim()).filter(Boolean),
          linkUrl: editState.linkUrl || undefined,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/business/services", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          description: newDescription || undefined,
          priceCents: Math.round(Number(newPrice) * 100),
          durationMin: fromDurationInput(newDuration),
          color: newColor,
          capacity: Math.max(1, Number(newCapacity) || 1),
          imageUrls: newImageUrls.map((u) => u.trim()).filter(Boolean),
          linkUrl: newLinkUrl || undefined,
        }),
      });
      setNewName(""); setNewDescription(""); setNewPrice(""); setNewDuration(""); setNewCapacity("1"); setNewColor(COLORS[0].hex); setNewImageUrls([]); setNewLinkUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add service");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/services/${id}`, { method: "DELETE" });
    await load();
  }

  /**
   * Editor for the list of photo links the bot sends over WhatsApp.
   *
   * These are pasted public URLs rather than uploads: the app has no object storage, and WhatsApp
   * fetches the image from the link itself, so whatever is stored here must stay reachable. Each
   * row previews the link so a typo or a dead host is visible here instead of surfacing as a
   * missing photo in a customer's chat.
   */
  function PhotoList({ urls, onChange }: { urls: string[]; onChange: (next: string[]) => void }) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-gray-600">{t.photos}</div>
        {urls.map((url, i) => (
          <div key={i} className="flex items-center gap-2">
            {url.trim() ? (
              /* eslint-disable-next-line @next/next/no-img-element -- arbitrary owner-pasted URL, not a local/optimizable asset */
              <img src={url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-gray-100" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            ) : (
              <div className="w-9 h-9 rounded-lg shrink-0 bg-gray-100" />
            )}
            <input
              value={url}
              onChange={(e) => onChange(urls.map((u, j) => (j === i ? e.target.value : u)))}
              placeholder="https://…"
              dir="ltr"
              className="flex-1 min-w-32 text-sm"
            />
            <button
              type="button"
              onClick={() => onChange(urls.filter((_, j) => j !== i))}
              aria-label={t.removePhoto}
              title={t.removePhoto}
              className="text-gray-600 hover:text-red-600 transition p-1.5 rounded hover:bg-red-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {urls.length < 10 && (
          <button
            type="button"
            onClick={() => onChange([...urls, ""])}
            className="self-start text-xs text-[#1B7FA0] hover:text-[#145F78] font-semibold px-2 py-1 rounded hover:bg-[#E0F5FB] transition"
          >
            + {t.addPhoto}
          </button>
        )}
        <p className="text-xs text-gray-600">{t.photosHint}</p>
      </div>
    );
  }

  function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    return (
      <div className="flex gap-2">
        {COLORS.map((c) => {
          const selected = value === c.hex;
          return (
            <button
              key={c.hex}
              type="button"
              title={lang === "he" ? c.he : c.en}
              onClick={() => onChange(c.hex)}
              className="relative w-7 h-7 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c.hex,
                boxShadow: selected
                  ? `0 0 0 2px #fff, 0 0 0 4px ${c.hex}, 0 2px 6px ${c.hex}66`
                  : "0 1px 2px rgba(0,0,0,0.08)",
              }}
            >
              {selected && (
                <svg className="absolute inset-0 m-auto w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.servicesTitle}</h1>
        <p className="text-gray-600 text-sm mt-1">
          {services.length === 0 ? t.servicesSubtitle : `${services.length} ${t.nav.services}`}
        </p>
      </div>

      {/* Services list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6 animate-fade-up stagger-2">
        {!loaded ? (
          <div><SkeletonRow cols={2} /><SkeletonRow cols={2} /><SkeletonRow cols={2} /></div>
        ) : loadError ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-700 text-sm font-medium">{t.loadFailed}</p>
            <p className="text-gray-500 text-xs mt-1">{loadError}</p>
            <button
              onClick={() => { setLoadError(null); setLoaded(false); load().catch((e) => { setLoadError(e instanceof Error ? e.message : String(e)); setLoaded(true); }); }}
              className="mt-4 text-sm font-medium text-[#1B7FA0] hover:text-[#145F78] px-3 py-1.5 rounded-lg hover:bg-[#E0F5FB] transition"
            >
              {t.retry}
            </button>
          </div>
        ) : services.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-600 text-sm">{t.noServices}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {services.map((s) =>
              editingId === s.id ? (
                <div key={s.id} className="px-4 py-4 bg-gray-100/30">
                  <div className="flex flex-wrap gap-2 mb-2">
                    <input value={editState.name} onChange={(e) => setEditState((p) => ({ ...p, name: e.target.value }))} placeholder={t.serviceName} className="flex-1 min-w-32 text-sm" />
                    <input value={editState.price} onChange={(e) => setEditState((p) => ({ ...p, price: e.target.value }))} placeholder={t.price} type="number" className="w-24 text-sm" />
                    <input value={editState.duration} onChange={(e) => setEditState((p) => ({ ...p, duration: e.target.value }))} placeholder={durationLabel} type="number" min="1" className="w-28 text-sm" />
                    <input value={editState.capacity} onChange={(e) => setEditState((p) => ({ ...p, capacity: e.target.value }))} placeholder={t.capacity} title={t.capacityHint} type="number" min="1" className="w-24 text-sm" />
                  </div>
                  {/* The bot reads this out to customers, so it can run to several lines — a
                      single-line input hid everything past the first few words while writing it. */}
                  <div className="mb-2">
                    <AutoTextarea
                      value={editState.description}
                      onChange={(v) => setEditState((p) => ({ ...p, description: v }))}
                      placeholder={t.descriptionOptional}
                      className="w-full text-sm"
                    />
                  </div>
                  <div className="mb-3">
                    <PhotoList urls={editState.imageUrls} onChange={(next) => setEditState((p) => ({ ...p, imageUrls: next }))} />
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input value={editState.linkUrl} onChange={(e) => setEditState((p) => ({ ...p, linkUrl: e.target.value }))} placeholder={t.linkUrlOptional} dir="ltr" className="flex-1 min-w-32 text-sm" />
                  </div>
                  <div className="flex items-center justify-between">
                    <ColorPicker value={editState.color} onChange={(hex) => setEditState((p) => ({ ...p, color: hex }))} />
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-600 hover:text-gray-600 px-3 py-1.5 rounded-lg transition">{t.cancel}</button>
                      <button onClick={() => saveEdit(s.id)} disabled={saving} className="text-xs bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition">{saving ? t.saving : t.save}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3.5 group">
                  {s.imageUrls && s.imageUrls.length > 0 ? (
                    <div className="relative shrink-0" title={t.photoCount(s.imageUrls.length)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary owner-pasted URL, not a local/optimizable asset */}
                      <img src={s.imageUrls[0]} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-100" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                      {s.imageUrls.length > 1 && (
                        <span className="absolute -bottom-1 -end-1 bg-[#1B7FA0] text-white text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full tabular-nums">
                          {s.imageUrls.length}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="w-2 h-9 rounded-full shrink-0" style={{ backgroundColor: s.color ?? "#1B7FA0" }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-800 font-medium text-sm flex items-center gap-1.5">
                      {s.name}
                      {s.linkUrl && (
                        <a href={s.linkUrl} target="_blank" rel="noopener noreferrer" className="text-[#1B7FA0] hover:text-[#145F78]" title={s.linkUrl}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                    {s.description && <div className="text-gray-600 text-xs mt-0.5 line-clamp-2 whitespace-pre-line">{s.description}</div>}
                  </div>
                  <span
                    className="text-xs font-bold shrink-0 tabular-nums px-2.5 py-1 rounded-full"
                    style={{
                      background: `${s.color ?? "#1B7FA0"}12`,
                      // The raw swatch is the chip's fill; the text is a darkened form of it, or
                      // several stock colours land at 2-4:1 against their own tint.
                      color: readableOnTint(s.color ?? "#1B7FA0"),
                    }}
                  >
                    ₪{(s.priceCents / 100).toFixed(0)}
                  </span>
                  <span className="text-gray-600 text-xs shrink-0 flex items-center gap-1 tabular-nums">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {overnight ? `${toDurationInput(s.durationMin)} ${t.nightsAbbrev}` : `${s.durationMin}′`}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(s)} className="row-action text-xs text-gray-600 hover:text-[#1B7FA0] transition px-2 py-1 rounded hover:bg-[#E0F5FB]">{t.edit}</button>
                    <button onClick={() => remove(s.id)} className="row-action text-xs text-gray-600 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-50">{t.delete}</button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Add form */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-fade-up stagger-3">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">{t.addService}</h2>
        <form onSubmit={addService} className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input placeholder={t.serviceName} value={newName} onChange={(e) => setNewName(e.target.value)} required className="flex-1 min-w-32" />
            <input placeholder={t.price} type="number" step="1" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required className="w-28" />
            <input placeholder={durationLabel} type="number" min="1" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} required className="w-32" />
            <input placeholder={t.capacity} title={t.capacityHint} type="number" min="1" value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} className="w-28" />
          </div>
          <AutoTextarea
            value={newDescription}
            onChange={setNewDescription}
            placeholder={t.descriptionOptional}
            className="w-full"
          />
          <PhotoList urls={newImageUrls} onChange={setNewImageUrls} />
          <div className="flex gap-2">
            <input placeholder={t.linkUrlOptional} value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} dir="ltr" className="flex-1 min-w-32" />
          </div>
          <div className="flex items-center justify-between mt-1">
            <ColorPicker value={newColor} onChange={setNewColor} />
            <button type="submit" disabled={adding} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
              {adding ? "…" : t.add}
            </button>
          </div>
        </form>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
