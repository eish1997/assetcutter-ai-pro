import { apiUrl, authApiDirectUrl } from './apiBase';
import { HttpRequestError, requestJson } from './httpClient';

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
  /** AI 积分余额（管理员列表） */
  creditBalance?: number;
  /** 累计消耗积分（管理员列表） */
  creditLifetimeSpent?: number;
  staffRoleId?: string | null;
  staffRoleSlug?: string | null;
  staffRoleDisplayName?: string | null;
};

/** 是否可在主站看到管理后台入口（与 server resolveStaffContext 一致：须 role=admin） */
export function canAccessAdminPanel(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin';
}

type AuthResponse = { user: AuthUser };

let preferDirectAuthApi = false;

function shouldRetryAuthDirect(path: string, error: unknown): boolean {
  if (!(error instanceof HttpRequestError) || error.status !== 0) return false;
  const sameOriginUrl = apiUrl(path);
  const directUrl = authApiDirectUrl(path);
  return sameOriginUrl === path && directUrl !== sameOriginUrl;
}

async function requestAuthJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (preferDirectAuthApi) return requestJson<T>(authApiDirectUrl(path), init);
  try {
    return await requestJson<T>(apiUrl(path), init);
  } catch (error) {
    if (!shouldRetryAuthDirect(path, error)) throw error;
    const result = await requestJson<T>(authApiDirectUrl(path), init);
    preferDirectAuthApi = true;
    return result;
  }
}

export type RegistrationPolicy = {
  mode: 'open' | 'invite_only';
  inviteRequired: boolean;
};

export type RegistrationInviteValidation = {
  valid: boolean;
  code?: string;
  reason?: string;
};

export async function fetchRegistrationPolicy() {
  return requestAuthJson<RegistrationPolicy>('/api/auth/registration-policy', { cache: 'no-store' });
}

export async function validateRegistrationInvite(code: string) {
  const q = encodeURIComponent(String(code || '').trim());
  return requestAuthJson<RegistrationInviteValidation>(`/api/auth/invite/validate?code=${q}`, {
    cache: 'no-store',
  });
}

export async function registerByEmail(
  username: string,
  email: string,
  password: string,
  opts?: { staffInvite?: string; inviteCode?: string }
) {
  const body: Record<string, string> = { username, email, password };
  const staffInvite = String(opts?.staffInvite || '').trim();
  if (staffInvite) body.staffInvite = staffInvite;
  const inviteCode = String(opts?.inviteCode || '').trim();
  if (inviteCode) body.inviteCode = inviteCode;
  return requestAuthJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function loginByEmail(identifier: string, password: string) {
  return requestAuthJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function logoutSession() {
  return requestAuthJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function fetchMe() {
  return requestAuthJson<AuthResponse>('/api/auth/me');
}
