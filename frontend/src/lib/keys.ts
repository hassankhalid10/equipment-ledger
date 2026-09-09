/**
 * One place for every query key, so invalidating after a write cannot miss a
 * screen by getting the key subtly wrong. Writes invalidate broadly - the
 * store is small and correctness after a write matters more than saving a
 * few requests.
 */
export const keys = {
  health: ["health"] as const,
  assets: (filters?: Record<string, string | undefined>) => ["assets", filters ?? {}] as const,
  history: (code: string) => ["history", code] as const,
  asOf: (at: string) => ["as-of", at] as const,
  movements: (filters?: Record<string, string | number | undefined>) =>
    ["movements", filters ?? {}] as const,
  workers: (q?: string) => ["workers", q ?? ""] as const,
  keepers: ["keepers"] as const,
};

/**
 * Everything a write can affect. The as-of view is included because a
 * correction changes what a past instant looked like (PLAN.md §12 #7), and
 * workers because what someone is holding changes on every issue and return.
 *
 * `keepers` and `health` are deliberately absent: no write touches either.
 */
export const writeAffectedKeys = [
  ["assets"],
  ["history"],
  ["as-of"],
  ["movements"],
  ["workers"],
] as const;
