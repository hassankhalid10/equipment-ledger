import { ApiError } from "@/lib/api";

/**
 * Renders the API's own message verbatim, with its machine code underneath.
 * The frontend never rewrites a business refusal in its own words - a
 * keeper should be able to read this line aloud and have it make sense.
 */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;

  const isApi = error instanceof ApiError;
  const message = isApi ? error.message : "Something went wrong. Nothing was written.";

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p>{message}</p>
      {isApi && (
        <p className="mt-1 font-mono text-[11px] text-red-600">
          {error.code}
          {error.requestId ? ` · request ${error.requestId.slice(0, 8)}` : ""}
        </p>
      )}
    </div>
  );
}
