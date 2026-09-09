"use client";

import Link from "next/link";
import { useState } from "react";
import { AssetStateBadge } from "@/components/AssetStateBadge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAssets } from "@/hooks/queries";
import { formatDateTime, relative } from "@/lib/dates";
import type { AssetStatus } from "@/lib/types";

const STATUSES: { value: AssetStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "IN_STORE", label: "In store" },
  { value: "ISSUED", label: "Issued" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "RESERVED", label: "Reserved" },
  { value: "OUT_OF_SERVICE", label: "Out of service" },
];

export default function StoreBoardPage() {
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const { data, isPending, error } = useAssets({ status: status || undefined, q: q || undefined });

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Store board</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Every asset and the state the ledger says it is in, right now.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code or name…"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-900 focus:outline-none"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-900 focus:outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mt-4"><ErrorBanner error={error} /></div>}

      {isPending ? (
        <p className="mt-6 text-sm text-zinc-500">Reading the ledger…</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-zinc-500">
            {data?.total ?? 0} asset{data?.total === 1 ? "" : "s"}
          </p>

          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Asset</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Who has it</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data?.assets.map((a) => (
                  <tr key={a.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <Link href={`/assets/${a.code}`} className="font-medium hover:underline">
                        {a.code}
                      </Link>
                      <span className="block text-xs text-zinc-500">{a.name}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {a.kind}
                      {a.requiredCertification && (
                        <span className="block text-[11px] text-amber-700">
                          needs {a.requiredCertification}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <AssetStateBadge status={a.status} />
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {a.holder?.name ??
                        (a.activeReservation
                          ? `reserved for ${a.activeReservation.worker?.name ?? "someone"}`
                          : "—")}
                    </td>
                    <td className="px-3 py-2 text-zinc-600" title={a.holder?.dueAt ?? ""}>
                      {a.holder?.dueAt ? (
                        <>
                          {formatDateTime(a.holder.dueAt)}
                          <span
                            className={`block text-[11px] ${a.status === "OVERDUE" ? "text-red-600" : "text-zinc-500"}`}
                          >
                            {relative(a.holder.dueAt)}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data?.assets.length === 0 && (
            <p className="mt-4 text-sm text-zinc-500">Nothing matches that filter.</p>
          )}
        </>
      )}
    </section>
  );
}
