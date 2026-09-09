"use client";

import { create } from "zustand";

interface AsOfState {
  /** The instant being reconstructed, as an ISO string. */
  at: string;
  setAt: (at: string) => void;
  /** Minutes back from now, driving the slider. 0 means "now". */
  minutesAgo: number;
  setMinutesAgo: (minutes: number) => void;
}

const minutesAgoToIso = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * The time-travel instant. UI state, not server state: TanStack Query owns
 * what the store looked like at this instant, this store owns only which
 * instant the keeper is pointing at.
 *
 * Deliberately not persisted - reopening the page should start at "now",
 * not at whatever moment was being inspected last week.
 */
export const useAsOfStore = create<AsOfState>((set) => ({
  at: new Date().toISOString(),
  setAt: (at) => set({ at }),
  minutesAgo: 0,
  setMinutesAgo: (minutes) => set({ minutesAgo: minutes, at: minutesAgoToIso(minutes) }),
}));
