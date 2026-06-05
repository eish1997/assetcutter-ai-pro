import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { findUserById, updateUserById } from './auth-store.js';
import { getRoleById } from './admin-roles-store.js';
import { createAuditLog } from './auth-store.js';

const DATA_PATH = path.resolve(process.cwd(), 'server/data/admin-staff-invites.json');

async function loadStore() {
  try {
    const text = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.invites)) return parsed;
  } catch {
    /* missing */
  }
  return { invites: [] };
}

async function saveStore(data) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function publicInvite(row) {
  return {
    id: row.id,
    staffRoleId: row.staffRoleId,
    staffRoleSlug: row.staffRoleSlug || '',
    staffRoleDisplayName: row.staffRoleDisplayName || '',
    note: row.note || '',
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt || null,
    usedByUserId: row.usedByUserId || null,
    revokedAt: row.revokedAt || null,
    createdByUserId: row.createdByUserId || null,
    createdByIdentifier: row.createdByIdentifier || '',
  };
}

export async function listStaffInvites() {
  const store = await loadStore();
  return store.invites
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(publicInvite);
}

export async function createStaffInvite({ staffRoleId, note, ttlDays, actor }) {
  const roleId = String(staffRoleId || '').trim();
  if (!roleId) throw new Error('缺少 staffRoleId');
  const role = await getRoleById(roleId);
  if (!role) throw new Error('角色不存在');
  if (role.slug === 'super') throw new Error('不可通过邀请分配超级管理员');
  const days = Math.max(1, Math.min(30, Math.floor(Number(ttlDays) || 7)));
  const now = Date.now();
  const token = crypto.randomBytes(24).toString('base64url');
  const invite = {
    id: crypto.randomUUID(),
    token,
    staffRoleId: role.id,
    staffRoleSlug: role.slug,
    staffRoleDisplayName: role.displayName,
    note: String(note || '').trim(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByUserId: null,
    revokedAt: null,
    createdByUserId: actor?.userId || null,
    createdByIdentifier: actor?.identifier || '',
  };
  const store = await loadStore();
  store.invites.push(invite);
  await saveStore(store);
  return {
    invite: publicInvite(invite),
    token,
    registerPath: `/?staffInvite=${encodeURIComponent(token)}`,
  };
}

export async function revokeStaffInvite(inviteId) {
  const id = String(inviteId || '').trim();
  if (!id) throw new Error('缺少 invite id');
  const store = await loadStore();
  const row = store.invites.find((x) => x.id === id);
  if (!row) throw new Error('邀请不存在');
  if (row.usedAt) throw new Error('邀请已使用');
  row.revokedAt = new Date().toISOString();
  await saveStore(store);
  return publicInvite(row);
}

export async function peekStaffInviteToken(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, reason: 'invalid' };
  const store = await loadStore();
  const row = store.invites.find((x) => x.token === t);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  const role = await getRoleById(row.staffRoleId);
  if (!role) return { ok: false, reason: 'role_missing' };
  return { ok: true, staffRoleId: row.staffRoleId, staffRoleSlug: role.slug };
}

export async function consumeStaffInviteToken(token, userId, meta = {}) {
  const t = String(token || '').trim();
  const uid = String(userId || '').trim();
  if (!t || !uid) return { ok: false, reason: 'invalid' };
  const store = await loadStore();
  const row = store.invites.find((x) => x.token === t);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  const role = await getRoleById(row.staffRoleId);
  if (!role) return { ok: false, reason: 'role_missing' };

  const freshStore = await loadStore();
  const freshRow = freshStore.invites.find((x) => x.token === t);
  if (!freshRow) return { ok: false, reason: 'not_found' };
  if (freshRow.revokedAt) return { ok: false, reason: 'revoked' };
  if (freshRow.usedAt) return { ok: false, reason: 'used' };
  if (new Date(freshRow.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const updated = await updateUserById(uid, { role: 'admin', staffRoleId: freshRow.staffRoleId });
  if (!updated) return { ok: false, reason: 'user_update_failed' };

  freshRow.usedAt = new Date().toISOString();
  freshRow.usedByUserId = uid;
  await saveStore(freshStore);

  const user = await findUserById(uid);
  await createAuditLog({
    actorUserId: uid,
    actorIdentifier: user?.username || uid,
    action: 'admin.staff_invite_redeemed',
    targetUserId: uid,
    meta: { inviteId: freshRow.id, staffRoleId: freshRow.staffRoleId, staffRoleSlug: role.slug },
    ip: meta.ip || '',
    userAgent: meta.userAgent || '',
  });

  return { ok: true, staffRoleId: freshRow.staffRoleId, staffRoleSlug: role.slug };
}
