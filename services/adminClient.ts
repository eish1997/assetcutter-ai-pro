import type { AuthUser } from './authClient';
import { apiUrl } from './apiBase';

type UsersResponse = { users: AuthUser[] };
type UserResponse = { user: AuthUser };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error || '请求失败'));
  return data as T;
}

export async function fetchAdminUsers() {
  return request<UsersResponse>(apiUrl('/api/admin/users'));
}

export async function updateAdminUser(userId: string, patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' }) {
  return request<UserResponse>(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

