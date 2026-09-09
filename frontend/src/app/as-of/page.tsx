"use client";

import Link from "next/link";
import { AssetStateBadge } from "@/components/AssetStateBadge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAsOf } from "@/hooks/queries";
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "@/lib/dates";
import { useAsOfStore } from "@/stores/as-of";

const PRESETS = [
  { label: "Now", minutes: 0 },
  { label: "An hour ago", minutes: 60 },
  { label: "Yesterday", minutes: 60 * 24 },
  { label: "A week ago", minutes: 60 * 24 * 7 },
  { label: "A month ago", minutes: 60 * 24 * 30 },
];

const MAX_MINUTES = 60 * 24 * 45;

export default function AsOfPage() {
  const { at, setAt, minutesAgo, setMinutesAgo } = useAsOfStore();
  const { data, isPending, isFetching, error } = useAsOf(at);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">As of</h1>
        <p className="mt-1 text-sm text-zinc-600">
          The whole store as it stood at one instant, folded from the ledger with no cache in the
          path. Corrections apply here too — this shows what was true, not what was written down at
          the time.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setMinutesAgo(p.minutes)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                minutesAgo === p.minutes
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 hover:bg-zinc-100"
              }`}
            >
              {p.label}
            </button>
          ))}

          <input
            type="datetime-local"
            value={toLocalInputValue(new Date(at))}
            onChange={(e) => e.target.value && setAt(fromLocalInputValue(e.target.value))}
            className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={MAX_MINUTES}
            step={15}
            value={minutesAgo}
            onChange={(e) => setMinutesAgo(Number(e.target.value))}
            className="w-full accent-zinc-900"
            aria-label="How far back to look"
          />
          <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
            <span>45 days ago</span>
            <span title={at} className="font-medium text-zinc-900">
              {formatDateTime(at)}
              {isFetching && <span className="ml-2 font-normal text-zinc-400">reading…</span>}
            </span>
            <span>now</span>
          </div>
        </div>
      </div>

      {error && <ErrorBanner error={error} />}

      {isPending ? (
        <p className="text-sm text-zinc-500">Reading the ledger…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data?.counts ?? {}).map(([status, count]) => (
              <span key={status} className="flex items-center gap-1.5 text-xs text-zinc-600">
                <AssetStateBadge status={status as never} />
                {count}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Asset</th>
                  <th className="px-3 py-2 font-medium">State at that moment</th>
                  <th className="px-3 py-2 font-medium">Who had it</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data?.assets.map((a) => (
                  <tr key={a.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <Link href={`/assets/${a.code}`} className="font-medium hover:underline">
                        {a.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <AssetStateBadge status={a.status} />
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{a.holder?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
