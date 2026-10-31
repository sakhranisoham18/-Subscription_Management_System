const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; [k: string]: unknown };
}

// Access token lives in memory only (never localStorage); the refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = await res.json();
      accessToken = body.data.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;
export const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function raw(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return raw(method, path, body, false);
    onSessionExpired?.();
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await raw(method, path, body);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details?.fields);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', `${path}${qs(q)}`),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};

/** Fetches a protected file (PDF/CSV) and opens or downloads it. */
export async function openFile(path: string, opts: { download?: boolean; filename?: string } = {}) {
  const res = await raw('GET', path);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Could not load the file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (opts.download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename ?? /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
