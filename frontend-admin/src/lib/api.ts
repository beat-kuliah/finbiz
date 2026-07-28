export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let getToken: () => string | null = () => null;
let onRefreshed: (token: string) => void = () => {};
let onAuthFailed: () => void = () => {};

export function bindTokenGetter(fn: () => string | null) {
  getToken = fn;
}

export function bindOnRefreshed(fn: (token: string) => void) {
  onRefreshed = fn;
}

export function bindOnAuthFailed(fn: () => void) {
  onAuthFailed = fn;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch("/api/platform/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        onAuthFailed();
        return null;
      }
      const data = (await res.json()) as { accessToken: string };
      onRefreshed(data.accessToken);
      return data.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(path, { ...init, headers, credentials: "include" });
  if (
    res.status === 401 &&
    !path.includes("/auth/login") &&
    !path.includes("/auth/refresh")
  ) {
    const next = await refreshAccess();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(path, { ...init, headers, credentials: "include" });
    } else {
      onAuthFailed();
    }
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
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
