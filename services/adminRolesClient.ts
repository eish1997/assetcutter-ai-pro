import type { MatrixCellValue } from './adminMatrix';
import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AdminRoleRow = {
  id: string;
  slug: string;
  displayName: string;
  isSystem: boolean;
  description: string;
  permissions: string[];
  matrix: Record<string, MatrixCellValue>;
  userCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type MatrixColumnMeta = {
  id: string;
  label: string;
  kind: 'toggle' | 'rw';
  superOnly?: boolean;
};

export async function fetchAdminRoles() {
  return requestJson<{ roles: AdminRoleRow[] }>(apiUrl('/api/admin/roles'), { cache: 'no-store' });
}

export async function fetchAdminPermissionColumns() {
  return requestJson<{ columns: MatrixColumnMeta[] }>(apiUrl('/api/admin/permissions'), { cache: 'no-store' });
}

export async function createAdminRole(body: {
  slug: string;
  displayName: string;
  description?: string;
  copyFromRoleId?: string;
}) {
  return requestJson<{ role: AdminRoleRow }>(apiUrl('/api/admin/roles'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteAdminRole(roleId: string) {
  return requestJson<{ ok: boolean }>(apiUrl(`/api/admin/roles/${encodeURIComponent(roleId)}`), {
    method: 'DELETE',
  });
}

export async function saveAdminRolePermissions(roleId: string, matrix: Record<string, MatrixCellValue>) {
  return requestJson<{ role: AdminRoleRow }>(
    apiUrl(`/api/admin/roles/${encodeURIComponent(roleId)}/permissions`),
    {
      method: 'PUT',
      body: JSON.stringify({ matrix }),
    }
  );
}
