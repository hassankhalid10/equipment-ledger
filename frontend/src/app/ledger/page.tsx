"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useMovements } from "@/hooks/queries";
import { formatDateTime } from "@/lib/dates";

const TYPE_LABEL: Record<string, string> = {
  ISSUE: "Issued",
  RETURN: "Returned",
  OUT_OF_SERVICE: "Out of service",
  BACK_IN_SERVICE: "Back in service",
};

const PAGE_SIZE = 50;

export default function LedgerPage() {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useMovements({ page, pageSize: PAGE_SIZE });
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">The book</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Every movement ever written, newest first. Two clocks side by side: when it happened, and
          when it was written down.
        </p>
      </div>

      {error && <ErrorBanner error={error} />}

      {isPending ? (
        <p className="text-sm text-zinc-500">Reading the ledger…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium">Who</th>
                  <th className="px-3 py-2 font-medium">Happened</th>
                  <th className="px-3 py-2 font-medium">Written</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data?.movements.map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <span className="font-medium">{TYPE_LABEL[m.type] ?? m.type}</span>
                      {m.correctsMovementId && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                          correction
                        </span>
                      )}
                      {m.condition === "DAMAGED" && (
                        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
                          damaged
                        </span>
                      )}
                      {m.correctionReason && (
                        <span className="block text-xs italic text-blue-700">
                          “{m.correctionReason}”
                        </span>
                      )}
                      {m.reason && <span className="block text-xs text-zinc-500">{m.reason}</span>}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {m.worker?.name ?? m.returnedBy?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600" title={m.occurredAt}>
                      {formatDateTime(m.occurredAt)}
                    </td>
                    <td className="px-3 py-2 text-zinc-600" title={m.recordedAt}>
                      {formatDateTime(m.recordedAt)}
                      {m.loggedLate && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                          late
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-600">
            <span>
              {data?.total ?? 0} movements · page {page} of {lastPage}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40"
              >
                Newer
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
                className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40"
              >
                Older
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
