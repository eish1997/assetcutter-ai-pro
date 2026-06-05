import type { AdminStaffRole } from '../services/adminMeClient';

export const ADMIN_ROLE_PREVIEW_STORAGE_KEY = 'ac_admin_role_preview_v1';

export type AdminRolePreviewSession = {
  roleId: string;
  slug: string;
  displayName: string;
  permissions: string[];
};

export function readAdminRolePreviewSession(): AdminRolePreviewSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_ROLE_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminRolePreviewSession;
    if (!parsed?.roleId || !parsed.slug || !Array.isArray(parsed.permissions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAdminRolePreviewSession(data: AdminRolePreviewSession): void {
  sessionStorage.setItem(ADMIN_ROLE_PREVIEW_STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event('ac-admin-role-preview-changed'));
}

export function clearAdminRolePreviewSession(): void {
  sessionStorage.removeItem(ADMIN_ROLE_PREVIEW_STORAGE_KEY);
  window.dispatchEvent(new Event('ac-admin-role-preview-changed'));
}

export function previewSessionToStaffRole(session: AdminRolePreviewSession): AdminStaffRole {
  return {
    id: session.roleId,
    slug: session.slug,
    displayName: session.displayName,
    isSystem: ['super', 'admin', 'auditor'].includes(session.slug),
    description: '角色预览模拟',
  };
}

/** 预览模式下拦截写操作（界面仍展示该角色可见的按钮） */
export function blockIfRolePreview(isRolePreview: boolean): boolean {
  if (!isRolePreview) return false;
  window.alert('当前为角色界面预览，写操作已禁用');
  return true;
}
