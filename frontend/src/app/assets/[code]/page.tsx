"use client";

import { use, useState } from "react";
import Link from "next/link";
import { AssetStateBadge } from "@/components/AssetStateBadge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { MovementTimeline } from "@/components/MovementTimeline";
import { IssueDialog } from "@/components/dialogs/IssueDialog";
import { ReturnDialog } from "@/components/dialogs/ReturnDialog";
import { ReserveDialog } from "@/components/dialogs/ReserveDialog";
import { ServiceDialog } from "@/components/dialogs/ServiceDialog";
import { CancelReservationDialog } from "@/components/dialogs/CancelReservationDialog";
import { useHistory } from "@/hooks/queries";
import { formatDateTime, relative } from "@/lib/dates";
import type { ReservationView } from "@/lib/types";

type Dialog = "issue" | "return" | "reserve" | "service" | null;

export default function AssetPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data, isPending, error } = useHistory(decodeURIComponent(code));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cancelling, setCancelling] = useState<ReservationView | null>(null);

  if (isPending) return <p className="text-sm text-zinc-500">Reading the ledger…</p>;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const { asset, timeline, reservations } = data;
  const held = Boolean(asset.holder);

  return (
    <section className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-zinc-500 hover:underline">
          ← Store board
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{asset.code}</h1>
          <AssetStateBadge status={asset.status} />
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          {asset.name} · {asset.kind}
          {asset.requiredCertification && (
            <span className="text-amber-700"> · needs {asset.requiredCertification}</span>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Right now</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Holder</dt>
            <dd>{asset.holder?.name ?? "In the store"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Since</dt>
            <dd title={asset.holder?.since ?? ""}>{formatDateTime(asset.holder?.since)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Due back</dt>
            <dd title={asset.holder?.dueAt ?? ""}>
              {asset.holder?.dueAt ? `${formatDateTime(asset.holder.dueAt)} (${relative(asset.holder.dueAt)})` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Reserved now for</dt>
            <dd>{asset.activeReservation?.worker?.name ?? "—"}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDialog("issue")}
            disabled={held || !asset.serviceable}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Issue
          </button>
          <button
            type="button"
            onClick={() => setDialog("return")}
            disabled={!held}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-40"
          >
            Return
          </button>
          <button
            type="button"
            onClick={() => setDialog("reserve")}
            disabled={!asset.serviceable}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-40"
          >
            Reserve
          </button>
          <button
            type="button"
            onClick={() => setDialog("service")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
          >
            {asset.serviceable ? "Take out of service" : "Back in service"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Buttons only hide what the ledger already refuses — the server is what actually decides.
        </p>
      </div>

      {reservations.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Reservations</h2>
          <ul className="mt-2 divide-y divide-zinc-100 text-sm">
            {reservations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="font-medium">{r.worker?.name ?? "—"}</span>
                <span className="text-zinc-600" title={`${r.startsAt} → ${r.endsAt}`}>
                  {formatDateTime(r.startsAt)} → {formatDateTime(r.endsAt)}
                </span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
                  {r.status.toLowerCase()}
                </span>
                {r.neverCollected && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                    never collected
                  </span>
                )}
                {r.status === "PENDING" && (
                  <button
                    type="button"
                    onClick={() => setCancelling(r)}
                    className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-900"
                  >
                    Cancel
                  </button>
                )}
                {r.cancelReason && (
                  <span className="w-full text-xs text-zinc-500">{r.cancelReason}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Its whole life</h2>
        <p className="mt-1 mb-3 text-xs text-zinc-500">
          Nothing here is ever edited or deleted. A correction is a new entry, and the entry it
          replaced stays struck through.
        </p>
        <MovementTimeline timeline={timeline} />
      </div>

      <IssueDialog asset={asset} open={dialog === "issue"} onClose={() => setDialog(null)} />
      <ReturnDialog asset={asset} open={dialog === "return"} onClose={() => setDialog(null)} />
      <ReserveDialog asset={asset} open={dialog === "reserve"} onClose={() => setDialog(null)} />
      <ServiceDialog asset={asset} open={dialog === "service"} onClose={() => setDialog(null)} />

      {cancelling && (
        <CancelReservationDialog reservation={cancelling} open onClose={() => setCancelling(null)} />
      )}
    </section>
  );
}
