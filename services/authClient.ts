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
};

type AuthResponse = { user: AuthUser };

export async function registerByEmail(username: string, email: string, password: string) {
  return requestJson<AuthResponse>(apiUrl('/api/auth/register'), {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
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

export async function forgotPassword(identifier: string) {
  return requestJson<{ ok: boolean; resetToken?: string }>(apiUrl('/api/auth/forgot-password'), {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  return requestJson<{ ok: boolean }>(apiUrl('/api/auth/reset-password'), {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

