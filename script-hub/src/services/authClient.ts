import { requestJson } from './httpClient';

function trimSlash(input: string) {
  return input.replace(/\/+$/, '');
}

/** 认证 API：开发默认同源 `/api/auth`（Vite 代理到 9100）；生产可设绝对 URL */
export function authApiUrl(path: string) {
  const fromEnv = String(import.meta.env?.VITE_AUTH_API_BASE_URL || '').trim();
  const base = fromEnv ? trimSlash(fromEnv) : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** Script Hub 业务 API：开发默认同源 `/api`（Vite 代理到 9101，但 `/api/auth` 优先走 9100） */
export function scriptHubApiUrl(path: string) {
  const fromEnv = String(import.meta.env?.VITE_SCRIPT_HUB_API_BASE_URL || '').trim();
  const base = fromEnv ? trimSlash(fromEnv) : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base) return `${base}${p}`;
  return p;
}

export type AuthRole = 'user' | 'admin';

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: AuthRole;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type AuthResponse = { user: AuthUser };

export async function registerByEmail(username: string, email: string, password: string) {
  return requestJson<AuthResponse>(authApiUrl('/api/auth/register'), {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function loginByEmail(identifier: string, password: string) {
  return requestJson<AuthResponse>(authApiUrl('/api/auth/login'), {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function logoutSession() {
  return requestJson<{ ok: boolean }>(authApiUrl('/api/auth/logout'), { method: 'POST' });
}

export async function fetchMe() {
  return requestJson<AuthResponse>(authApiUrl('/api/auth/me'));
}
