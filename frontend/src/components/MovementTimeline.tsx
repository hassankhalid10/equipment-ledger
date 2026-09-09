"use client";

import { useState } from "react";
import { CorrectDialog } from "@/components/dialogs/CorrectDialog";
import { formatDateTime } from "@/lib/dates";
import type { TimelineEntry } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  ISSUE: "Issued",
  RETURN: "Returned",
  OUT_OF_SERVICE: "Out of service",
  BACK_IN_SERVICE: "Back in service",
};

/**
 * The asset's whole life. A superseded entry is struck through and kept
 * visible with its correction beneath it - "corrections, not erasures"
 * means the mistake stays on the page, not just in the database (FR-18).
 *
 * occurredAt and recordedAt sit side by side so a late entry is obvious
 * (FR-17), with the raw ISO value on hover.
 */
export function MovementTimeline({ timeline }: { timeline: TimelineEntry[] }) {
  const [correcting, setCorrecting] = useState<TimelineEntry | null>(null);

  if (timeline.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing has happened to this asset yet.</p>;
  }

  return (
    <>
      <ol className="divide-y divide-zinc-200 border-y border-zinc-200">
        {[...timeline].reverse().map((m) => (
          <li key={m.id} className={`py-3 ${m.superseded ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`text-sm font-medium ${m.superseded ? "text-zinc-500 line-through" : "text-zinc-900"}`}
              >
                {TYPE_LABEL[m.type] ?? m.type}
              </span>

              {m.worker && <span className="text-sm text-zinc-700">to {m.worker.name}</span>}
              {m.returnedBy && <span className="text-sm text-zinc-700">by {m.returnedBy.name}</span>}
              {m.condition === "DAMAGED" && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  damaged
                </span>
              )}
              {m.superseded && (
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600">
                  superseded by a correction
                </span>
              )}
              {m.correctsMovementId && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                  correction
                </span>
              )}
              {m.loggedLate && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                  logged late
                </span>
              )}

              {!m.superseded && (
                <button
                  type="button"
                  onClick={() => setCorrecting(m)}
                  className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-900"
                >
                  Correct
                </button>
              )}
            </div>

            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-500">
              <span title={m.occurredAt}>happened {formatDateTime(m.occurredAt)}</span>
              <span title={m.recordedAt}>written {formatDateTime(m.recordedAt)}</span>
              {m.dueAt && <span title={m.dueAt}>due {formatDateTime(m.dueAt)}</span>}
            </div>

            {m.correctionReason && (
              <p className="mt-1 text-xs italic text-blue-700">“{m.correctionReason}”</p>
            )}
            {m.reason && <p className="mt-1 text-xs text-zinc-600">{m.reason}</p>}
            {m.note && <p className="mt-1 text-xs text-zinc-600">{m.note}</p>}
          </li>
        ))}
      </ol>

      {correcting && (
        <CorrectDialog movement={correcting} open onClose={() => setCorrecting(null)} />
      )}
    </>
  );
}
