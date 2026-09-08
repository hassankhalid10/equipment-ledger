"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Health = {
  status: "ok" | "degraded";
  database: { connected: boolean; name: string; host: string };
};

export function ApiStatus() {
  const { data, isError, isPending } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 10_000,
  });

  const up = !isError && data?.database.connected === true;
  const label = isPending
    ? "checking API…"
    : up
      ? `API · ${data.database.name}`
      : "API unreachable";

  return (
    <span className="flex items-center gap-2 text-xs text-zinc-500">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          isPending ? "bg-zinc-400" : up ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
      {label}
    </span>
  );
}
