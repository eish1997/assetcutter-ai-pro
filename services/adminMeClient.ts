import type { AuthUser } from './authClient';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AdminStaffRole = {
  id: string;
  slug: string;
  displayName: string;
  isSystem: boolean;
  description: string;
};

export type AdminMeResponse = {
  user: AuthUser;
  staffRole: AdminStaffRole;
  permissions: string[];
};

export async function fetchAdminMe() {
  return requestJson<AdminMeResponse>(apiUrl('/api/admin/me'), { cache: 'no-store' });
}
