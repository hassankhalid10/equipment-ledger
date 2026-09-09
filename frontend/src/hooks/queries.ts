"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/keys";
import type {
  AsOfResponse,
  AssetListResponse,
  HistoryResponse,
  KeeperListResponse,
  MovementListResponse,
  WorkerListResponse,
} from "@/lib/types";

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function useAssets(filters: { status?: string; kind?: string; q?: string } = {}) {
  return useQuery({
    queryKey: keys.assets(filters),
    queryFn: () => api<AssetListResponse>(`/assets${query(filters)}`),
  });
}

export function useHistory(code: string) {
  return useQuery({
    queryKey: keys.history(code),
    queryFn: () => api<HistoryResponse>(`/assets/${encodeURIComponent(code)}/history`),
    enabled: Boolean(code),
  });
}

export function useAsOf(at: string) {
  return useQuery({
    queryKey: keys.asOf(at),
    queryFn: () => api<AsOfResponse>(`/ledger/as-of?at=${encodeURIComponent(at)}`),
    enabled: Boolean(at),
    // The slider moves continuously; keeping recent instants around makes
    // dragging back and forth feel instant without re-asking the server.
    staleTime: 30_000,
  });
}

export function useMovements(filters: { assetId?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: keys.movements(filters),
    queryFn: () => api<MovementListResponse>(`/movements${query(filters)}`),
  });
}

export function useWorkers(q?: string) {
  return useQuery({
    queryKey: keys.workers(q),
    queryFn: () => api<WorkerListResponse>(`/workers${query({ q })}`),
  });
}

export function useKeepers() {
  return useQuery({
    queryKey: keys.keepers,
    queryFn: () => api<KeeperListResponse>("/keepers"),
    // The pick-a-name list barely changes; no reason to keep re-asking.
    staleTime: 5 * 60_000,
  });
}
