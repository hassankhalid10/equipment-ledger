const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

/** The one error shape the API speaks (PLAN.md §10). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
  // Nest's default shape, until the error filter lands in Phase 4.
  statusCode?: number;
  message?: string | string[];
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });

  if (res.ok) {
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    // non-JSON error; fall through to the generic message
  }

  const message =
    body.error?.message ??
    (Array.isArray(body.message) ? body.message.join("; ") : body.message) ??
    `${res.status} ${res.statusText}`;

  throw new ApiError(
    res.status,
    body.error?.code ?? "HTTP_ERROR",
    message,
    body.error?.details,
    body.requestId,
  );
}
