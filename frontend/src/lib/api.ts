export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Production path prefix (e.g. `/finbiz-api`); empty in local dev. */
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

let getToken: () => string | null = () => null;
let onRefreshed: (token: string) => void = () => {};

export function bindTokenGetter(fn: () => string | null) {
  getToken = fn;
}

export function bindOnRefreshed(fn: (token: string) => void) {
  onRefreshed = fn;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(apiUrl("/api/auth/refresh"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken: string };
      onRefreshed(data.accessToken);
      return data.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch(path: string, init: RequestInit = {}, orgId?: string | null): Promise<Response> {
  const url = apiUrl(path);
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (orgId) headers.set("X-Organization-Id", orgId);

  let res = await fetch(url, { ...init, headers, credentials: "include" });
  if (
    res.status === 401 &&
    !path.includes("/auth/login") &&
    !path.includes("/auth/register") &&
    !path.includes("/auth/google") &&
    !path.includes("/auth/refresh")
  ) {
    const next = await refreshAccess();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(url, { ...init, headers, credentials: "include" });
    }
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}, orgId?: string | null): Promise<T> {
  const res = await apiFetch(path, init, orgId);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? "Terjadi kesalahan.");
  }
  return data as T;
}

export function formatIDR(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}
