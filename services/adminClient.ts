import type { AuthUser } from './authClient';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

type UsersResponse = { users: AuthUser[] };
type UserResponse = { user: AuthUser };
type AuditLog = {
  id: string;
  actorUserId: string | null;
  actorIdentifier: string;
  action: string;
  targetUserId: string | null;
  meta: unknown;
  ip: string;
  userAgent: string;
  createdAt: string;
};
type AuditLogsResponse = { logs: AuditLog[] };

export async function fetchAdminUsers() {
  return requestJson<UsersResponse>(apiUrl('/api/admin/users'));
}

export async function updateAdminUser(userId: string, patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' }) {
  return requestJson<UserResponse>(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchAuditLogs(limit = 200) {
  return requestJson<AuditLogsResponse>(apiUrl(`/api/admin/audit-logs?limit=${encodeURIComponent(String(limit))}`));
}

