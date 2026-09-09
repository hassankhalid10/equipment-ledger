import type { AssetStatus } from "@/lib/types";

/** One component renders every state, everywhere, so the store board and the
 * as-of view can never disagree about what "overdue" looks like. */
const STYLES: Record<AssetStatus, { label: string; className: string }> = {
  IN_STORE: { label: "In store", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  ISSUED: { label: "Issued", className: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  OVERDUE: { label: "Overdue", className: "bg-red-50 text-red-700 ring-red-600/20" },
  RESERVED: { label: "Reserved", className: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  OUT_OF_SERVICE: { label: "Out of service", className: "bg-zinc-200 text-zinc-700 ring-zinc-500/30" },
  NOT_YET_IN_STORE: { label: "Not yet in store", className: "bg-zinc-100 text-zinc-500 ring-zinc-400/30" },
};

export function AssetStateBadge({ status }: { status: AssetStatus }) {
  const style = STYLES[status] ?? STYLES.IN_STORE;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      {style.label}
    </span>
  );
}
