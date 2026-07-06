import crypto from 'crypto';
import {
  ADMIN_ROLE_SLUG,
  DEFAULT_ROLE_PERMISSIONS,
  SUPER_ROLE_SLUG,
  AUDITOR_ROLE_SLUG,
  filterPermissionsForRoleSlug,
} from './admin-permissions.js';
import {
  assertMatrixEditable,
  matrixToPermissions,
  normalizeMatrixInput,
  permissionsToMatrix,
  validateCustomRoleSlug,
} from './admin-matrix.js';
import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';

let rbacReady = false;
let roleIdBySlugCache = null;

function nowIso() {
  return new Date().toISOString();
}

function resetRoleCache() {
  roleIdBySlugCache = null;
}

async function ensureRbacTablesPg(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT false,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_key)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_key ON role_permissions(permission_key);`);
  await p.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS staff_role_id TEXT REFERENCES admin_roles(id) ON DELETE SET NULL;
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_staff_role_id ON users(staff_role_id);`);
}

async function upsertSystemRolePg(p, { slug, displayName, description, permissions }) {
  const existing = await p.query('SELECT id FROM admin_roles WHERE slug = $1 LIMIT 1', [slug]);
  let roleId;
  const ts = nowIso();
  if (existing.rowCount > 0) {
    roleId = existing.rows[0].id;
    await p.query(
      `UPDATE admin_roles SET display_name = $2, description = $3, is_system = true, updated_at = $4 WHERE id = $1`,
      [roleId, displayName, description, ts]
    );
    return roleId;
  }
  roleId = crypto.randomUUID();
  await p.query(
    `INSERT INTO admin_roles (id, slug, display_name, is_system, description, created_at, updated_at)
     VALUES ($1,$2,$3,true,$4,$5,$6)`,
    [roleId, slug, displayName, description, ts, ts]
  );
  for (const key of permissions) {
    await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2)', [roleId, key]);
  }
  return roleId;
}

function upsertSystemRoleJson(db, { slug, displayName, description, permissions }) {
  if (!Array.isArray(db.adminRoles)) db.adminRoles = [];
  if (!Array.isArray(db.rolePermissions)) db.rolePermissions = [];
  let row = db.adminRoles.find((r) => r.slug === slug);
  const ts = nowIso();
  if (!row) {
    row = {
      id: crypto.randomUUID(),
      slug,
      displayName,
      isSystem: true,
      description,
      createdAt: ts,
      updatedAt: ts,
    };
    db.adminRoles.push(row);
    for (const permissionKey of permissions) {
      db.rolePermissions.push({ roleId: row.id, permissionKey });
    }
    return row.id;
  }
  row.displayName = displayName;
  row.description = description;
  row.isSystem = true;
  row.updatedAt = ts;
  return row.id;
}

async function seedSystemRoles() {
  const specs = [
    {
      slug: SUPER_ROLE_SLUG,
      displayName: '超级管理员',
      description: '全部权限；唯一可管理角色矩阵与提升 super',
      permissions: DEFAULT_ROLE_PERMISSIONS[SUPER_ROLE_SLUG],
    },
    {
      slug: ADMIN_ROLE_SLUG,
      displayName: '运营管理员',
      description: '日常运营；不可改用户后台角色与限流高危项',
      permissions: DEFAULT_ROLE_PERMISSIONS[ADMIN_ROLE_SLUG],
    },
    {
      slug: AUDITOR_ROLE_SLUG,
      displayName: '审计员',
      description: '只读：用户列表与审计日志；导出为脱敏版',
      permissions: DEFAULT_ROLE_PERMISSIONS[AUDITOR_ROLE_SLUG],
    },
  ];
  if (USE_POSTGRES) {
    const p = getPool();
    const ids = {};
    for (const spec of specs) {
      ids[spec.slug] = await upsertSystemRolePg(p, spec);
    }
    return ids;
  }
  const db = readDb();
  const ids = {};
  for (const spec of specs) {
    ids[spec.slug] = upsertSystemRoleJson(db, spec);
  }
  writeDb(db);
  return ids;
}

async function migrateLegacyStaffUsers(roleIds) {
  const superId = roleIds[SUPER_ROLE_SLUG];
  const adminId = roleIds[ADMIN_ROLE_SLUG];
  const seedEmail = String(process.env.AUTH_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  if (USE_POSTGRES) {
    const p = getPool();
    if (seedEmail) {
      await p.query(
        `UPDATE users SET role = 'admin', staff_role_id = $2, updated_at = NOW()
         WHERE email = $1 AND staff_role_id IS NULL`,
        [seedEmail, superId]
      );
    }
    await p.query(
      `UPDATE users SET staff_role_id = $1, updated_at = NOW()
       WHERE role = 'admin' AND staff_role_id IS NULL AND ($2::text IS NULL OR email <> $2)`,
      [adminId, seedEmail || null]
    );
    return;
  }
  const db = readDb();
  let changed = false;
  for (const u of db.users) {
    if (u.role !== 'admin') continue;
    const isSeed = seedEmail && String(u.email || '').toLowerCase() === seedEmail;
    if (isSeed) {
      if (!u.staffRoleId) {
        u.staffRoleId = superId;
        u.updatedAt = nowIso();
        changed = true;
        console.warn(`[rbac] migrated seed admin user ${u.email} -> staff_role super`);
      }
      continue;
    }
    if (!u.staffRoleId) {
      u.staffRoleId = adminId;
      u.updatedAt = nowIso();
      changed = true;
      console.warn(`[rbac] migrated legacy admin user ${u.email} -> staff_role admin`);
    }
  }
  if (changed) writeDb(db);
}

/** 已有角色补全侧栏拆分后的权限（audit→任务执行、dashboard→系统状态）。 */
async function migrateSidebarPermissionKeys() {
  const rules = [
    { ifHas: 'audit.read', add: 'task_events.read' },
    { ifHas: 'audit.read', add: 'usage.read' },
    { ifHas: 'dashboard.read', add: 'system_status.read' },
  ];
  if (USE_POSTGRES) {
    const p = getPool();
    const res = await p.query('SELECT id FROM admin_roles');
    for (const row of res.rows) {
      const permRes = await p.query('SELECT permission_key FROM role_permissions WHERE role_id = $1', [row.id]);
      const raw = permRes.rows.map((r) => r.permission_key);
      const toAdd = rules.filter((r) => raw.includes(r.ifHas) && !raw.includes(r.add)).map((r) => r.add);
      for (const key of toAdd) {
        await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
          row.id,
          key,
        ]);
      }
    }
    return;
  }
  const db = readDb();
  let changed = false;
  for (const role of db.adminRoles || []) {
    const raw = (db.rolePermissions || []).filter((rp) => rp.roleId === role.id).map((rp) => rp.permissionKey);
    for (const rule of rules) {
      if (!raw.includes(rule.ifHas) || raw.includes(rule.add)) continue;
      db.rolePermissions.push({ roleId: role.id, permissionKey: rule.add });
      changed = true;
    }
  }
  if (changed) writeDb(db);
}

/** 系统角色补全 credits.write（积分 v1 上线前已存在的库）。 */
async function migrateCreditsWritePermission(roleIds) {
  const targets = [
    { slug: SUPER_ROLE_SLUG, roleId: roleIds[SUPER_ROLE_SLUG] },
    { slug: ADMIN_ROLE_SLUG, roleId: roleIds[ADMIN_ROLE_SLUG] },
  ].filter((t) => t.roleId);
  const key = 'credits.write';
  if (USE_POSTGRES) {
    const p = getPool();
    for (const { roleId } of targets) {
      await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        roleId,
        key,
      ]);
    }
    return;
  }
  const db = readDb();
  let changed = false;
  for (const { roleId } of targets) {
    const has = (db.rolePermissions || []).some((rp) => rp.roleId === roleId && rp.permissionKey === key);
    if (has) continue;
    db.rolePermissions.push({ roleId, permissionKey: key });
    changed = true;
  }
  if (changed) writeDb(db);
}

/** 系统角色补全 registration_invites.write（邀请注册 v1 上线前已存在的库）。 */
async function migrateRegistrationInvitesWritePermission(roleIds) {
  const targets = [
    { slug: SUPER_ROLE_SLUG, roleId: roleIds[SUPER_ROLE_SLUG] },
    { slug: ADMIN_ROLE_SLUG, roleId: roleIds[ADMIN_ROLE_SLUG] },
  ].filter((t) => t.roleId);
  const key = 'registration_invites.write';
  if (USE_POSTGRES) {
    const p = getPool();
    for (const { roleId } of targets) {
      await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        roleId,
        key,
      ]);
    }
    return;
  }
  const db = readDb();
  let changed = false;
  for (const { roleId } of targets) {
    const has = (db.rolePermissions || []).some((rp) => rp.roleId === roleId && rp.permissionKey === key);
    if (has) continue;
    db.rolePermissions.push({ roleId, permissionKey: key });
    changed = true;
  }
  if (changed) writeDb(db);
}

export async function ensureAdminRbac() {
  if (rbacReady) return;
  if (USE_POSTGRES) {
    await ensurePostgres();
    await ensureRbacTablesPg(getPool());
  } else {
    readDb();
  }
  const roleIds = await seedSystemRoles();
  await migrateLegacyStaffUsers(roleIds);
  await migrateSidebarPermissionKeys();
  await migrateCreditsWritePermission(roleIds);
  await migrateRegistrationInvitesWritePermission(roleIds);
  resetRoleCache();
  rbacReady = true;
}

async function loadRoleIdBySlugMap() {
  if (roleIdBySlugCache) return roleIdBySlugCache;
  if (USE_POSTGRES) {
    await ensureAdminRbac();
    const res = await getPool().query('SELECT id, slug FROM admin_roles');
    roleIdBySlugCache = new Map(res.rows.map((r) => [r.slug, r.id]));
    return roleIdBySlugCache;
  }
  const db = readDb();
  roleIdBySlugCache = new Map((db.adminRoles || []).map((r) => [r.slug, r.id]));
  return roleIdBySlugCache;
}

export async function getRoleIdBySlug(slug) {
  const map = await loadRoleIdBySlugMap();
  return map.get(slug) || null;
}

export async function getRoleById(roleId) {
  if (!roleId) return null;
  if (USE_POSTGRES) {
    await ensureAdminRbac();
    const res = await getPool().query('SELECT * FROM admin_roles WHERE id = $1 LIMIT 1', [roleId]);
    if (!res.rows[0]) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      slug: r.slug,
      displayName: r.display_name,
      isSystem: Boolean(r.is_system),
      description: r.description || '',
    };
  }
  const db = readDb();
  const r = (db.adminRoles || []).find((x) => x.id === roleId);
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    isSystem: Boolean(r.isSystem),
    description: r.description || '',
  };
}

async function listPermissionKeysForRoleId(roleId) {
  if (!roleId) return [];
  if (USE_POSTGRES) {
    await ensureAdminRbac();
    const res = await getPool().query(
      'SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key',
      [roleId]
    );
    return res.rows.map((r) => r.permission_key);
  }
  const db = readDb();
  return (db.rolePermissions || [])
    .filter((rp) => rp.roleId === roleId)
    .map((rp) => rp.permissionKey)
    .sort();
}

export async function resolveStaffContext(userRow) {
  if (!userRow) return null;
  await ensureAdminRbac();
  const accountRole = userRow.role;
  let staffRoleId = userRow.staffRoleId || userRow.staff_role_id || null;
  if (!staffRoleId && accountRole === 'admin') {
    staffRoleId = await getRoleIdBySlug(ADMIN_ROLE_SLUG);
    console.warn(
      `[rbac] user ${userRow.email || userRow.id} has role=admin but no staff_role_id; fallback to admin template`
    );
  }
  if (!staffRoleId) return null;
  if (accountRole !== 'admin') return null;
  const staffRole = await getRoleById(staffRoleId);
  if (!staffRole) return null;
  const raw = await listPermissionKeysForRoleId(staffRoleId);
  const permissions = filterPermissionsForRoleSlug(staffRole.slug, raw);
  if (!permissions.length) return null;
  return { staffRoleId, staffRole, permissions };
}

export async function countActiveSuperUsers(excludeUserId = null) {
  await ensureAdminRbac();
  const superId = await getRoleIdBySlug(SUPER_ROLE_SLUG);
  if (!superId) return 0;
  if (USE_POSTGRES) {
    const p = getPool();
    const res = excludeUserId
      ? await p.query(
          `SELECT COUNT(*)::int AS c FROM users WHERE staff_role_id = $1 AND status = 'active' AND id <> $2`,
          [superId, excludeUserId]
        )
      : await p.query(`SELECT COUNT(*)::int AS c FROM users WHERE staff_role_id = $1 AND status = 'active'`, [superId]);
    return Number(res.rows[0]?.c || 0);
  }
  const db = readDb();
  return db.users.filter(
    (u) => u.staffRoleId === superId && u.status === 'active' && u.id !== excludeUserId
  ).length;
}

export async function assertCanChangeStaffAssignment({ targetUserId, nextStaffRoleId, nextStatus }) {
  await ensureAdminRbac();
  const superId = await getRoleIdBySlug(SUPER_ROLE_SLUG);
  if (!superId) return;
  let currentStaffId = null;
  let currentStatus = 'active';
  if (USE_POSTGRES) {
    const res = await getPool().query('SELECT staff_role_id, status FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
    if (!res.rows[0]) return;
    currentStaffId = res.rows[0].staff_role_id;
    currentStatus = res.rows[0].status;
  } else {
    const u = readDb().users.find((x) => x.id === targetUserId);
    if (!u) return;
    currentStaffId = u.staffRoleId || null;
    currentStatus = u.status;
  }
  const currentActive = currentStatus === 'active';
  const nextActive = nextStatus != null ? nextStatus === 'active' : currentActive;
  const effectiveNextStaff =
    nextStaffRoleId !== undefined ? nextStaffRoleId : currentStaffId;
  const demotingSuper =
    currentStaffId === superId && currentActive && (effectiveNextStaff !== superId || !nextActive);
  if (!demotingSuper) return;
  const others = await countActiveSuperUsers(targetUserId);
  if (others < 1) {
    throw new Error('不能降级或禁用最后一个超级管理员');
  }
}

export async function assignSeedAdminSuperRole(userId) {
  await ensureAdminRbac();
  const superId = await getRoleIdBySlug(SUPER_ROLE_SLUG);
  if (!superId || !userId) return;
  if (USE_POSTGRES) {
    await getPool().query(
      `UPDATE users SET role = 'admin', staff_role_id = $2, updated_at = NOW()
       WHERE id = $1 AND staff_role_id IS NULL`,
      [userId, superId]
    );
    return;
  }
  const db = readDb();
  const u = db.users.find((x) => x.id === userId);
  if (!u || u.staffRoleId) return;
  u.role = 'admin';
  u.staffRoleId = superId;
  u.updatedAt = nowIso();
  writeDb(db);
}

/** 显式执行 seed:admin 时强制提升为 super（不受 staff_role_id 是否已分配影响）。 */
export async function forceSeedAdminSuperRole(userId) {
  await ensureAdminRbac();
  const superId = await getRoleIdBySlug(SUPER_ROLE_SLUG);
  if (!superId || !userId) return;
  if (USE_POSTGRES) {
    await getPool().query(
      `UPDATE users SET role = 'admin', staff_role_id = $2, updated_at = NOW() WHERE id = $1`,
      [userId, superId]
    );
    return;
  }
  const db = readDb();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return;
  u.role = 'admin';
  u.staffRoleId = superId;
  u.updatedAt = nowIso();
  writeDb(db);
}

export async function enrichPublicUserWithStaff(user) {
  if (!user) return user;
  const ctx = await resolveStaffContext({
    id: user.id,
    email: user.email,
    role: user.role,
    staffRoleId: user.staffRoleId,
  });
  if (!ctx) {
    return { ...user, staffRoleId: user.staffRoleId || null, staffRoleSlug: null };
  }
  return {
    ...user,
    staffRoleId: ctx.staffRoleId,
    staffRoleSlug: ctx.staffRole.slug,
    staffRoleDisplayName: ctx.staffRole.displayName,
  };
}

export async function buildAdminMePayload(user) {
  const ctx = await resolveStaffContext({
    id: user.id,
    email: user.email,
    role: user.role,
    staffRoleId: user.staffRoleId,
  });
  if (!ctx) return null;
  const enriched = await enrichPublicUserWithStaff(user);
  return {
    user: enriched,
    staffRole: ctx.staffRole,
    permissions: ctx.permissions,
  };
}

async function countUsersByStaffRoleId(roleId) {
  if (!roleId) return 0;
  if (USE_POSTGRES) {
    const res = await getPool().query(`SELECT COUNT(*)::int AS c FROM users WHERE staff_role_id = $1`, [roleId]);
    return Number(res.rows[0]?.c || 0);
  }
  return readDb().users.filter((u) => u.staffRoleId === roleId).length;
}

async function listAllRoles() {
  await ensureAdminRbac();
  if (USE_POSTGRES) {
    const res = await getPool().query('SELECT * FROM admin_roles ORDER BY is_system DESC, slug ASC');
    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.display_name,
      isSystem: Boolean(r.is_system),
      description: r.description || '',
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
  const db = readDb();
  return (db.adminRoles || [])
    .slice()
    .sort((a, b) => Number(Boolean(b.isSystem)) - Number(Boolean(a.isSystem)) || a.slug.localeCompare(b.slug))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      isSystem: Boolean(r.isSystem),
      description: r.description || '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
}

export async function listRolesWithPermissions() {
  const roles = await listAllRoles();
  const out = [];
  for (const role of roles) {
    const raw = await listPermissionKeysForRoleId(role.id);
    const permissions = filterPermissionsForRoleSlug(role.slug, raw);
    const userCount = await countUsersByStaffRoleId(role.id);
    out.push({
      ...role,
      permissions,
      matrix: permissionsToMatrix(permissions, role.slug),
      userCount,
    });
  }
  return out;
}

export async function createCustomRole({ slug, displayName, description = '', copyFromRoleId = null }) {
  await ensureAdminRbac();
  const normalizedSlug = validateCustomRoleSlug(slug);
  const name = String(displayName || '').trim();
  if (!name) throw new Error('displayName 不能为空');
  const roles = await listAllRoles();
  if (roles.some((r) => r.slug === normalizedSlug)) throw new Error('slug 已存在');
  let permissions = DEFAULT_ROLE_PERMISSIONS[ADMIN_ROLE_SLUG];
  if (copyFromRoleId) {
    const src = roles.find((r) => r.id === copyFromRoleId);
    if (!src) throw new Error('copyFromRoleId 无效');
    permissions = filterPermissionsForRoleSlug(src.slug, await listPermissionKeysForRoleId(src.id));
  }
  const ts = nowIso();
  if (USE_POSTGRES) {
    const p = getPool();
    const id = crypto.randomUUID();
    await p.query(
      `INSERT INTO admin_roles (id, slug, display_name, is_system, description, created_at, updated_at)
       VALUES ($1,$2,$3,false,$4,$5,$6)`,
      [id, normalizedSlug, name, String(description || ''), ts, ts]
    );
    for (const key of permissions) {
      await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2)', [id, key]);
    }
    resetRoleCache();
    return (await listRolesWithPermissions()).find((r) => r.id === id);
  }
  const db = readDb();
  const id = crypto.randomUUID();
  db.adminRoles.push({
    id,
    slug: normalizedSlug,
    displayName: name,
    isSystem: false,
    description: String(description || ''),
    createdAt: ts,
    updatedAt: ts,
  });
  for (const permissionKey of permissions) {
    db.rolePermissions.push({ roleId: id, permissionKey });
  }
  writeDb(db);
  resetRoleCache();
  return (await listRolesWithPermissions()).find((r) => r.id === id);
}

export async function deleteCustomRole(roleId) {
  await ensureAdminRbac();
  const role = await getRoleById(roleId);
  if (!role) throw new Error('角色不存在');
  if (role.isSystem) throw new Error('系统角色不可删除');
  const userCount = await countUsersByStaffRoleId(roleId);
  if (userCount > 0) throw new Error(`仍有 ${userCount} 个用户绑定此角色`);
  if (USE_POSTGRES) {
    await getPool().query('DELETE FROM admin_roles WHERE id = $1', [roleId]);
    resetRoleCache();
    return { ok: true };
  }
  const db = readDb();
  db.adminRoles = (db.adminRoles || []).filter((r) => r.id !== roleId);
  db.rolePermissions = (db.rolePermissions || []).filter((rp) => rp.roleId !== roleId);
  writeDb(db);
  resetRoleCache();
  return { ok: true };
}

export async function setRolePermissions({ actorRoleSlug, roleId, matrix }) {
  await ensureAdminRbac();
  const role = await getRoleById(roleId);
  if (!role) throw new Error('角色不存在');
  assertMatrixEditable({ actorRoleSlug, targetRoleSlug: role.slug });
  const beforeRaw = await listPermissionKeysForRoleId(roleId);
  const before = filterPermissionsForRoleSlug(role.slug, beforeRaw);
  const normalizedMatrix = normalizeMatrixInput(matrix, role.slug);
  const next = matrixToPermissions(normalizedMatrix, role.slug);
  const ts = nowIso();
  if (USE_POSTGRES) {
    const p = getPool();
    await p.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const key of next) {
      await p.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2)', [roleId, key]);
    }
    await p.query('UPDATE admin_roles SET updated_at = $2 WHERE id = $1', [roleId, ts]);
    resetRoleCache();
  } else {
    const db = readDb();
    db.rolePermissions = (db.rolePermissions || []).filter((rp) => rp.roleId !== roleId);
    for (const permissionKey of next) {
      db.rolePermissions.push({ roleId, permissionKey });
    }
    const row = (db.adminRoles || []).find((r) => r.id === roleId);
    if (row) row.updatedAt = ts;
    writeDb(db);
    resetRoleCache();
  }
  return {
    role: (await listRolesWithPermissions()).find((r) => r.id === roleId),
    before: { permissions: before, matrix: permissionsToMatrix(before, role.slug) },
    after: { permissions: next, matrix: normalizedMatrix },
  };
}
