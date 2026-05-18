// API client — talks to /api/* (proxied to backend by next.config.mjs).
// Session token is kept in localStorage AND sent as cookie by the backend;
// we send it as x-session-token header for safety.

const TOKEN_KEY = 'billur_token';
const COOKIE_KEY = 'billur_token';

function syncSessionCookie(token: string | null): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  if (token) {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${8 * 3600}; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  syncSessionCookie(token);
}

class ApiError extends Error {
  status: number;
  code?: string;
  constructor(msg: string, status: number, code?: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { raw?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) {
    headers['x-session-token'] = token;
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (opts?.raw) return res as unknown as T;

  if (!res.ok) {
    let errMsg = res.statusText;
    let errCode: string | undefined;
    try {
      const j = await res.json();
      errMsg = j.error || j.message || errMsg;
      errCode = j.code;
    } catch { /* not JSON */ }
    if (res.status === 401) errMsg = errMsg || 'Sessiya tugagan — qayta kiring';
    if (res.status === 403) errMsg = errMsg || "Ruxsat yo'q";
    throw new ApiError(errMsg, res.status, errCode);
  }

  // 204 / empty body
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:   <T = any>(path: string)              => request<T>('GET',    path),
  post:  <T = any>(path: string, body?: any)  => request<T>('POST',   path, body),
  put:   <T = any>(path: string, body?: any)  => request<T>('PUT',    path, body ?? {}),
  patch: <T = any>(path: string, body?: any)  => request<T>('PATCH',  path, body ?? {}),
  del:   <T = any>(path: string)              => request<T>('DELETE', path),
  raw:   (path: string)                       => request<Response>('GET', path, undefined, { raw: true }),
};

export { ApiError };
