"use client";

import { useKeepers } from "@/hooks/queries";
import { useKeeperStore } from "@/stores/keeper";

/**
 * The "pick a name from a list" the spec asks for. Not a login: the API
 * trusts whatever this sends, by design (PLAN.md §9). It exists so every
 * movement records who wrote it.
 */
export function KeeperPicker() {
  const { data } = useKeepers();
  const { keeperId, setKeeper } = useKeeperStore();

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-600">
      <span className="hidden sm:inline">Keeper</span>
      <select
        value={keeperId ?? ""}
        onChange={(e) => {
          const keeper = data?.keepers.find((k) => k.id === e.target.value);
          setKeeper(keeper ? { id: keeper.id, name: keeper.name } : null);
        }}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-900 focus:outline-none"
      >
        <option value="">Pick a name…</option>
        {data?.keepers.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shown in place of a form when nobody has picked a name yet — every write
 * needs a keeperId, so there is nothing useful to submit without one. */
export function KeeperRequired() {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Pick your name in the header first — every entry records who wrote it.
    </p>
  );
}
