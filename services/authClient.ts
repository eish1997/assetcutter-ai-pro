import { apiUrl } from './apiBase';

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { error?: string }).error || '请求失败'));
  }
  return data as T;
}

export async function registerByEmail(username: string, email: string, password: string) {
  return request<AuthResponse>(apiUrl('/api/auth/register'), {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function loginByEmail(identifier: string, password: string) {
  return request<AuthResponse>(apiUrl('/api/auth/login'), {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function logoutSession() {
  return request<{ ok: boolean }>(apiUrl('/api/auth/logout'), { method: 'POST' });
}

export async function fetchMe() {
  return request<AuthResponse>(apiUrl('/api/auth/me'));
}

