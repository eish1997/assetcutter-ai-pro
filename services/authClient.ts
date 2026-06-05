import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AuthRole = 'user' | 'admin';

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: AuthRole;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** 工作区云存储（图片等）配额，字节；默认 200MB */
  workspaceQuotaBytes?: number;
  /** 当前已用字节（登录/me 与管理员列表会带上） */
  workspaceUsedBytes?: number;
  staffRoleId?: string | null;
  staffRoleSlug?: string | null;
  staffRoleDisplayName?: string | null;
};

type AuthResponse = { user: AuthUser };

export async function registerByEmail(username: string, email: string, password: string, opts?: { staffInvite?: string }) {
  const body: Record<string, string> = { username, email, password };
  const invite = String(opts?.staffInvite || '').trim();
  if (invite) body.staffInvite = invite;
  return requestJson<AuthResponse>(apiUrl('/api/auth/register'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function loginByEmail(identifier: string, password: string) {
  return requestJson<AuthResponse>(apiUrl('/api/auth/login'), {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function logoutSession() {
  return requestJson<{ ok: boolean }>(apiUrl('/api/auth/logout'), { method: 'POST' });
}

export async function fetchMe() {
  return requestJson<AuthResponse>(apiUrl('/api/auth/me'));
}

