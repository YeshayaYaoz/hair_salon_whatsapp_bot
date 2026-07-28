"use client";

// Shared building blocks for the settings-style pages (Settings, Bot, WhatsApp) — kept in one
// place so the same look/behavior doesn't drift between pages that each have their own form.

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      dir="ltr"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors ${checked ? "bg-[#1B7FA0] border-[#1B7FA0]" : "bg-gray-200 border-gray-200"}`}
    >
      <span
        className="absolute top-0 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(1rem)" : "translateX(0)" }}
      />
    </button>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-0.5">{title}</h2>
      {description && <p className="text-xs text-gray-600 mb-4">{description}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}
