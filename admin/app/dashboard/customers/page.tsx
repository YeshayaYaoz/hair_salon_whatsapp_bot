"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface Customer {
  id: string;
  name?: string;
  phone: string;
  _count: { appointments: number };
}

export default function CustomersPage() {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiFetch<Customer[]>("/api/business/customers").then(setCustomers);
  }, []);

  const filtered = customers.filter(
    (c) =>
      c.phone.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-white">{t.customersTitle}</h1>
          <p className="text-zinc-400 text-sm mt-1">{customers.length} {t.totalCustomers}</p>
        </div>
        <input
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden animate-fade-up stagger-2">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-zinc-500 text-sm">
            {t.noCustomers}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-start px-4 py-3 text-zinc-400 font-medium">{t.customer}</th>
                <th className="text-start px-4 py-3 text-zinc-400 font-medium">{t.when}</th>
                <th className="text-start px-4 py-3 text-zinc-400 font-medium text-end">{t.totalBookings}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className={i !== filtered.length - 1 ? "border-b border-zinc-800/50" : ""}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-violet-600/20 border border-violet-700/40 flex items-center justify-center text-violet-400 font-semibold text-sm shrink-0">
                        {(c.name ?? c.phone).charAt(0).toUpperCase()}
                      </div>
                      <span className="text-zinc-200 font-medium">{c.name ?? <span className="text-zinc-500 italic">—</span>}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-3 text-end">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {c._count.appointments}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
