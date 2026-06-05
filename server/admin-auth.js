import { hasPermission } from './admin-permissions.js';
import { buildAdminMePayload, resolveStaffContext } from './admin-roles-store.js';
import { findUserById } from './auth-store.js';

export function createAdminAuthHelpers({ requireAuth, json }) {
  async function requireStaff(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return null;
    const full = await findUserById(user.id);
    const ctx = await resolveStaffContext(full || user);
    if (!ctx) {
      json(res, 403, { error: '无管理后台权限' });
      return null;
    }
    return { user: full || user, ...ctx };
  }

  async function requirePermission(req, res, permission) {
    const staff = await requireStaff(req, res);
    if (!staff) return null;
    if (!hasPermission(staff.permissions, permission)) {
      json(res, 403, { error: '权限不足' });
      return null;
    }
    return staff;
  }

  async function requireAdminMe(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return null;
    const full = await findUserById(user.id);
    const payload = await buildAdminMePayload(full || user);
    if (!payload) {
      json(res, 403, { error: '无管理后台权限' });
      return null;
    }
    return payload;
  }

  return { requireStaff, requirePermission, requireAdminMe };
}
