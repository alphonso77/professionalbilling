const DEFAULT_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type RequestOptions = {
  getToken?: () => Promise<string | null> | string | null;
  orgId?: string | null;
  signal?: AbortSignal;
};

export async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (opts.getToken) {
    const token = await opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  if (opts.orgId) {
    headers["x-org-id"] = opts.orgId;
  }

  const url = `${DEFAULT_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errBody =
      parsed && typeof parsed === "object"
        ? (parsed as {
            error?: string | { message?: string; code?: string };
            details?: unknown;
          })
        : null;
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    if (typeof errBody?.error === "string") {
      message = errBody.error;
    } else if (errBody?.error && typeof errBody.error === "object") {
      message = errBody.error.message ?? message;
      code = errBody.error.code;
    }
    throw new ApiError(res.status, message, code, errBody?.details);
  }

  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

export function buildQuery(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}
