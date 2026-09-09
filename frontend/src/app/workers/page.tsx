"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useWorkers } from "@/hooks/queries";
import { formatDate, formatDateTime } from "@/lib/dates";

export default function WorkersPage() {
  const [q, setQ] = useState("");
  const { data, isPending, error } = useWorkers(q || undefined);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Certificates and what each person is holding. A worker may hold several assets at once —
            the rule is one holder per asset, not one asset per holder.
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or number…"
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-900 focus:outline-none"
        />
      </div>

      {error && <ErrorBanner error={error} />}

      {isPending ? (
        <p className="text-sm text-zinc-500">Reading…</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data?.workers.map((w) => (
            <li key={w.id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{w.name}</h2>
                <span className="font-mono text-[11px] text-zinc-500">{w.employeeNo}</span>
              </div>

              <div className="mt-2">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Certificates</p>
                {w.certifications.length === 0 ? (
                  <p className="text-xs text-zinc-500">None</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {w.certifications.map((c) => (
                      <li key={c.code} className="flex flex-wrap items-baseline gap-2 text-xs">
                        <span className="text-zinc-800">{c.code}</span>
                        <span className="text-zinc-500" title={c.expiresAt}>
                          expires {formatDate(c.expiresAt)}
                        </span>
                        {c.expired && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                            expired
                          </span>
                        )}
                        {c.expiringSoon && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                            expiring soon
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Holding now</p>
                {w.holding.length === 0 ? (
                  <p className="text-xs text-zinc-500">Nothing</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {w.holding.map((h) => (
                      <li key={h.code} className="flex flex-wrap items-baseline gap-2 text-xs">
                        <Link href={`/assets/${h.code}`} className="font-medium hover:underline">
                          {h.code}
                        </Link>
                        <span className="text-zinc-500" title={h.since}>
                          since {formatDateTime(h.since)}
                        </span>
                        {h.overdue && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                            overdue
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
