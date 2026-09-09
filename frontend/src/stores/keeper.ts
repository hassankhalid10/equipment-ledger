"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface KeeperState {
  keeperId: string | null;
  keeperName: string | null;
  setKeeper: (keeper: { id: string; name: string } | null) => void;
}

/**
 * Who is standing at the hatch. Not authentication - the spec forbids that
 * (PLAN.md §9) - just the name stamped onto every movement so the ledger
 * records who wrote each entry.
 *
 * Persisted so it survives a refresh; a keeper should not have to re-pick
 * their name every time the page reloads mid-shift.
 */
export const useKeeperStore = create<KeeperState>()(
  persist(
    (set) => ({
      keeperId: null,
      keeperName: null,
      setKeeper: (keeper) =>
        set({ keeperId: keeper?.id ?? null, keeperName: keeper?.name ?? null }),
    }),
    { name: "equipment-ledger-keeper" },
  ),
);
