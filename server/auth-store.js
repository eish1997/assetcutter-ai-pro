import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { DEFAULT_WORKSPACE_QUOTA_BYTES, getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import { auditLogMatchesCategory, auditCategorySql, normalizeAuditCategory, parseExcludeActions } from './admin-audit-category.js';
import { decodeAuditCursor, encodeAuditCursor, rowBeforeCursor } from './admin-audit-cursor.js';

const DB_DIR = path.resolve(process.cwd(), 'server', 'data');
const DB_FILE = path.join(
  DB_DIR,
  process.env.VITEST === 'true' || process.env.NODE_ENV === 'test' ? 'auth-db.test.json' : 'auth-db.json'
);

const DAY_MS = 24 * 60 * 60 * 1000;
const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
let USE_POSTGRES = Boolean(DATABASE_URL);
let pool = null;
let pgReady = false;

function allowJsonFallbackWhenPostgresFails() {
  const explicit = String(process.env.AUTH_STORE_ALLOW_JSON_FALLBACK || '').trim().toLowerCase();
  if (explicit) return ['1', 'true', 'on', 'yes'].includes(explicit);
  return String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
}

function postgresErrorSummary(err) {
  const code = String(err?.code || '').trim();
  const msg = String(err?.message || err || '').trim();
  return [code, msg].filter(Boolean).join(' ');
}

function attachPoolGuards(p) {
  if (!p || p.__assetcutterGuarded) return p;
  Object.defineProperty(p, '__assetcutterGuarded', { value: true });
  p.on('error', (err) => {
    pgReady = false;
    console.warn('[auth-store] postgres idle client error:', postgresErrorSummary(err));
  });
  return p;
}

function nowIso() {
  return new Date().toISOString();
}

function getPool() {
  if (!USE_POSTGRES) return null;
  if (!pool) {
    pool = attachPoolGuards(new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 15_000),
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15_000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15_000),
      lock_timeout: Number(process.env.PG_LOCK_TIMEOUT_MS || 10_000),
    }));
  }
  return pool;
}

function resetPostgresPool() {
  const p = pool;
  pool = null;
  pgReady = false;
  if (p) {
    void p.end().catch((err) => {
      console.warn('[auth-store] postgres pool close failed:', postgresErrorSummary(err));
    });
  }
}

async function ensurePostgres() {
  if (!USE_POSTGRES || pgReady) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      user_agent TEXT,
      ip TEXT
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_identifier TEXT,
      action TEXT NOT NULL,
      target_user_id TEXT,
      meta_json TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);`);
  await p.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS workspace_quota_bytes BIGINT;
  `);
  await p.query(`UPDATE users SET workspace_quota_bytes = $1 WHERE workspace_quota_bytes IS NULL`, [
    DEFAULT_WORKSPACE_QUOTA_BYTES,
  ]);
  /** ALTER … SET DEFAULT 勿用 $1：部分 PG/驱动会报 prepared statement 参数个数不匹配 */
  const quotaDefault = Number(DEFAULT_WORKSPACE_QUOTA_BYTES);
  if (Number.isFinite(quotaDefault) && quotaDefault >= 1) {
    await p.query(
      `ALTER TABLE users ALTER COLUMN workspace_quota_bytes SET DEFAULT ${Math.floor(quotaDefault)}`
    );
  }
  pgReady = true;
}

function sleepSyncMs(ms) {
  const wait = Math.max(0, Math.floor(Number(ms) || 0));
  if (wait <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  } catch {
    const end = Date.now() + wait;
    while (Date.now() < end) {
      /* spin — sync FS retry only */
    }
  }
}

/** Windows AV/indexer 偶发 libuv UNKNOWN/EPERM/EBUSY on open */
function isRetryableFsError(err) {
  const code = String(err?.code || '').toUpperCase();
  if (['UNKNOWN', 'EPERM', 'EBUSY', 'EACCES', 'EAGAIN'].includes(code)) return true;
  const msg = String(err?.message || '');
  return /unknown error,\s*open/i.test(msg);
}

function withFsRetry(fn) {
  const maxAttempts = 8;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableFsError(err) || attempt === maxAttempts) throw err;
      sleepSyncMs(12 * attempt * attempt);
    }
  }
  throw lastErr;
}

function replaceFileSync(tmpPath, destPath) {
  try {
    fs.renameSync(tmpPath, destPath);
    return;
  } catch (renameErr) {
    // Windows：目标已存在时 rename 常失败；改 copy 覆盖再删 tmp
    fs.copyFileSync(tmpPath, destPath);
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore stale tmp */
    }
  }
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const init = { version: 1, users: [], sessions: [] };
    writeDb(init);
  }
}

function readDb() {
  ensureDb();
  const raw = withFsRetry(() => fs.readFileSync(DB_FILE, 'utf8'));
  const parsed = JSON.parse(raw || '{}');
  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
  if (!Array.isArray(parsed.auditLogs)) parsed.auditLogs = [];
  if (typeof parsed.version !== 'number') parsed.version = 1;
  let changed = false;
  for (const item of parsed.users) {
    if (!item.username) {
      item.username = deriveUsernameFromEmail(item.email);
      changed = true;
    }
  }
  if (changed) writeDb(parsed);
  return parsed;
}

function writeDb(db) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  withFsRetry(() => {
    const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, payload, 'utf8');
      replaceFileSync(tmp, DB_FILE);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,32}$/.test(username);
}

function deriveUsernameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  const safe = local.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (!safe) return `user_${crypto.randomBytes(3).toString('hex')}`;
  return safe.slice(0, 32);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const key = crypto.scryptSync(String(password), salt, 64);
  return key.toString('hex');
}

export function verifyPassword(password, encoded) {
  const [prefix, saltHex, hashHex] = String(encoded || '').split('$');
  if (prefix !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = hashPassword(password, saltHex);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createPasswordHash(password) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const hashHex = hashPassword(password, saltHex);
  return `scrypt$${saltHex}$${hashHex}`;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    workspaceQuotaBytes: getWorkspaceQuotaBytesForUser(user),
    staffRoleId: user.staffRoleId || null,
  };
}

function safeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

function safeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

export function getWorkspaceQuotaBytesForUser(row) {
  if (!row) return DEFAULT_WORKSPACE_QUOTA_BYTES;
  const q = row.workspaceQuotaBytes;
  if (typeof q === 'number' && Number.isFinite(q) && q >= 1_000_000) return Math.floor(q);
  return DEFAULT_WORKSPACE_QUOTA_BYTES;
}

function validateWorkspaceQuotaBytesInput(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 * 1024 * 1024) throw new Error('工作区云配额至少为 1MB');
  if (n > 50 * 1024 * 1024 * 1024) throw new Error('工作区云配额过大（上限 50GB）');
  return n;
}

function mapUserRow(row) {
  const wqb =
    row.workspace_quota_bytes != null && row.workspace_quota_bytes !== ''
      ? Number(row.workspace_quota_bytes)
      : undefined;
  const staffRaw = row.staff_role_id;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    workspaceQuotaBytes:
      typeof wqb === 'number' && Number.isFinite(wqb) && wqb >= 1_000_000 ? Math.floor(wqb) : undefined,
    staffRoleId: staffRaw != null && staffRaw !== '' ? String(staffRaw) : null,
  };
}

function mapSessionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    userAgent: row.user_agent || '',
    ip: row.ip || '',
  };
}

export async function createUser({ username, email, password, role = 'user' }) {
  const normalizedUsername = normalizeUsername(username);
  const normalized = normalizeEmail(email);
  if (!normalizedUsername) throw new Error('用户名不能为空');
  if (!normalized) throw new Error('邮箱不能为空');
  if (!isValidUsername(normalizedUsername)) throw new Error('用户名需为 3-32 位，仅支持字母/数字/下划线');
  if (!password || String(password).length < 8) throw new Error('密码至少 8 位');

  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const dup = await p.query('SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1', [normalizedUsername, normalized]);
    if (dup.rowCount > 0) {
      const dupName = await p.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [normalizedUsername]);
      throw new Error(dupName.rowCount > 0 ? '用户名已被占用' : '该邮箱已注册');
    }
    const user = {
      id: crypto.randomUUID(),
      username: normalizedUsername,
      email: normalized,
      passwordHash: createPasswordHash(password),
      role: role === 'admin' ? 'admin' : 'user',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await p.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.id, user.username, user.email, user.passwordHash, user.role, user.status, user.createdAt, user.updatedAt]
    );
    return publicUser(user);
  }

  const db = readDb();
  const existedUsername = db.users.find((u) => u.username === normalizedUsername);
  const existed = db.users.find((u) => u.email === normalized);
  if (existedUsername) throw new Error('用户名已被占用');
  if (existed) throw new Error('该邮箱已注册');

  const user = {
    id: crypto.randomUUID(),
    username: normalizedUsername,
    email: normalized,
    passwordHash: createPasswordHash(password),
    role: role === 'admin' ? 'admin' : 'user',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.users.push(user);
  writeDb(db);
  return publicUser(user);
}

export async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const res = await p.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalized]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : null;
  }
  const db = readDb();
  return db.users.find((u) => u.email === normalized) || null;
}

export async function findUserByLogin(identifier) {
  const keyword = String(identifier || '').trim().toLowerCase();
  if (!keyword) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const res = await p.query('SELECT * FROM users WHERE email = $1 OR username = $1 LIMIT 1', [keyword]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : null;
  }
  const db = readDb();
  return db.users.find((u) => u.email === keyword || u.username === keyword) || null;
}

export async function findUserById(id) {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const res = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : null;
  }
  const db = readDb();
  return db.users.find((u) => u.id === id) || null;
}

export async function listUsersForAdmin(options = {}) {
  const pageRaw = Number(options.page);
  const pageSizeRaw = Number(options.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const maxPageSize = options.forExport ? 5000 : 100;
  const defaultPageSize = options.forExport ? 5000 : 20;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1
    ? Math.min(maxPageSize, Math.floor(pageSizeRaw))
    : defaultPageSize;
  const q = String(options.q || '').trim().toLowerCase();
  const status = options.status ? String(options.status) : '';
  const staffRoleId = options.staffRoleId ? String(options.staffRoleId) : '';
  let quotaWarnPct = Number(options.quotaWarnPct || 0);
  if (Number.isFinite(quotaWarnPct) && quotaWarnPct > 1) quotaWarnPct /= 100;

  let rows = await listUsers();
  if (q) {
    rows = rows.filter(
      (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }
  if (status === 'active' || status === 'disabled') {
    rows = rows.filter((u) => u.status === status);
  }
  if (staffRoleId === '__none__') {
    rows = rows.filter((u) => !u.staffRoleId);
  } else if (staffRoleId) {
    rows = rows.filter((u) => u.staffRoleId === staffRoleId);
  }
  if (Number.isFinite(quotaWarnPct) && quotaWarnPct > 0) {
    rows = rows.filter((u) => {
      const used = getWorkspaceUsedBytes(u.id);
      const quota = u.workspaceQuotaBytes || DEFAULT_WORKSPACE_QUOTA_BYTES;
      return quota > 0 && used / quota >= quotaWarnPct;
    });
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);
  return { users: items, total, page, pageSize };
}

export async function listUsers() {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const res = await p.query('SELECT * FROM users ORDER BY created_at DESC');
    return res.rows.map((r) => publicUser(mapUserRow(r)));
  }
  const db = readDb();
  return db.users
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(publicUser);
}

export async function updateUserById(id, patch) {
  const { assertCanChangeStaffAssignment, getRoleIdBySlug, getRoleById } = await import('./admin-roles-store.js');

  const hasStaffPatch = patch?.staffRoleId !== undefined;
  const hasLegacyRolePatch = patch?.role != null;
  const hasStatusPatch = patch?.status != null;
  const hasQuotaPatch = patch?.workspaceQuotaBytes != null;

  let nextStaffRoleId;
  let nextRole;
  let nextStatus;

  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const exists = await p.query('SELECT id, role, status, staff_role_id FROM users WHERE id = $1 LIMIT 1', [id]);
    if (!exists.rows[0]) return null;
    const cur = exists.rows[0];
    nextRole = cur.role;
    nextStatus = cur.status;
    nextStaffRoleId = cur.staff_role_id || null;

    if (hasStaffPatch) {
      nextStaffRoleId = patch.staffRoleId === null || patch.staffRoleId === '' ? null : String(patch.staffRoleId);
      if (nextStaffRoleId) {
        const roleRow = await getRoleById(nextStaffRoleId);
        if (!roleRow) throw new Error('无效的后台角色');
        nextRole = 'admin';
      } else {
        nextRole = 'user';
      }
    } else if (hasLegacyRolePatch) {
      nextRole = safeRole(patch.role);
      if (nextRole === 'user') {
        nextStaffRoleId = null;
      } else {
        nextStaffRoleId = await getRoleIdBySlug('admin');
        if (!nextStaffRoleId) throw new Error('后台角色未初始化');
      }
    }

    if (hasStatusPatch) nextStatus = safeStatus(patch.status);

    await assertCanChangeStaffAssignment({
      targetUserId: id,
      nextStaffRoleId,
      nextStatus: hasStatusPatch ? nextStatus : undefined,
    });

    await p.query(
      'UPDATE users SET role = $2, status = $3, staff_role_id = $4, updated_at = NOW() WHERE id = $1',
      [id, nextRole, nextStatus, nextStaffRoleId]
    );
    if (hasQuotaPatch) {
      const n = validateWorkspaceQuotaBytesInput(patch.workspaceQuotaBytes);
      await p.query('UPDATE users SET workspace_quota_bytes = $2, updated_at = NOW() WHERE id = $1', [id, n]);
    }
    const out = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return out.rows[0] ? publicUser(mapUserRow(out.rows[0])) : null;
  }

  const db = readDb();
  const target = db.users.find((u) => u.id === id);
  if (!target) return null;
  nextRole = target.role;
  nextStatus = target.status;
  nextStaffRoleId = target.staffRoleId || null;

  if (hasStaffPatch) {
    nextStaffRoleId = patch.staffRoleId === null || patch.staffRoleId === '' ? null : String(patch.staffRoleId);
    if (nextStaffRoleId) {
      const roleRow = await getRoleById(nextStaffRoleId);
      if (!roleRow) throw new Error('无效的后台角色');
      nextRole = 'admin';
    } else {
      nextRole = 'user';
    }
  } else if (hasLegacyRolePatch) {
    nextRole = safeRole(patch.role);
    if (nextRole === 'user') {
      nextStaffRoleId = null;
    } else {
      nextStaffRoleId = await getRoleIdBySlug('admin');
      if (!nextStaffRoleId) throw new Error('后台角色未初始化');
    }
  }

  if (hasStatusPatch) nextStatus = safeStatus(patch.status);

  await assertCanChangeStaffAssignment({
    targetUserId: id,
    nextStaffRoleId,
    nextStatus: hasStatusPatch ? nextStatus : undefined,
  });

  target.role = nextRole;
  target.status = nextStatus;
  target.staffRoleId = nextStaffRoleId;
  if (hasQuotaPatch) {
    target.workspaceQuotaBytes = validateWorkspaceQuotaBytesInput(patch.workspaceQuotaBytes);
  }
  target.updatedAt = nowIso();
  writeDb(db);
  return publicUser(target);
}

export async function upsertAdminUser({ email, password }) {
  const normalized = normalizeEmail(email);
  const adminUsername = normalizeUsername(process.env.AUTH_ADMIN_USERNAME || deriveUsernameFromEmail(normalized));
  if (!normalized) throw new Error('管理员邮箱不能为空');
  if (!isValidUsername(adminUsername)) throw new Error('管理员用户名不合法（3-32 位，仅支持字母/数字/下划线）');
  if (!password || String(password).length < 8) throw new Error('管理员密码至少 8 位');
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const owner = await p.query('SELECT id FROM users WHERE username = $1 AND email <> $2 LIMIT 1', [adminUsername, normalized]);
    if (owner.rowCount > 0) throw new Error('AUTH_ADMIN_USERNAME 已被其他账号占用');
    const existed = await p.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [normalized]);
    if (existed.rowCount > 0) {
      const id = existed.rows[0].id;
      await p.query(
        `UPDATE users
         SET username = $2, role = 'admin', status = 'active', password_hash = $3, updated_at = NOW()
         WHERE id = $1`,
        [id, adminUsername, createPasswordHash(password)]
      );
      const out = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
      const user = publicUser(mapUserRow(out.rows[0]));
      const { assignSeedAdminSuperRole } = await import('./admin-roles-store.js');
      await assignSeedAdminSuperRole(user.id);
      const refreshed = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
      return publicUser(mapUserRow(refreshed.rows[0]));
    }
    const user = {
      id: crypto.randomUUID(),
      username: adminUsername,
      email: normalized,
      passwordHash: createPasswordHash(password),
      role: 'admin',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await p.query(
      `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.id, user.username, user.email, user.passwordHash, user.role, user.status, user.createdAt, user.updatedAt]
    );
    const { assignSeedAdminSuperRole } = await import('./admin-roles-store.js');
    await assignSeedAdminSuperRole(user.id);
    const inserted = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [user.id]);
    return publicUser(mapUserRow(inserted.rows[0]));
  }

  const db = readDb();
  const usernameOwner = db.users.find((u) => u.username === adminUsername && u.email !== normalized);
  if (usernameOwner) throw new Error('AUTH_ADMIN_USERNAME 已被其他账号占用');
  const existed = db.users.find((u) => u.email === normalized);
  if (existed) {
    existed.username = adminUsername;
    existed.role = 'admin';
    existed.status = 'active';
    existed.passwordHash = createPasswordHash(password);
    existed.updatedAt = nowIso();
    writeDb(db);
    const { assignSeedAdminSuperRole } = await import('./admin-roles-store.js');
    await assignSeedAdminSuperRole(existed.id);
    return publicUser(existed);
  }
  const user = {
    id: crypto.randomUUID(),
    username: adminUsername,
    email: normalized,
    passwordHash: createPasswordHash(password),
    role: 'admin',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.users.push(user);
  writeDb(db);
  const { assignSeedAdminSuperRole } = await import('./admin-roles-store.js');
  await assignSeedAdminSuperRole(user.id);
  const saved = db.users.find((u) => u.id === user.id);
  return publicUser(saved || user);
}

function buildSession(userId, token, maxAgeMs, userAgent, ip) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + maxAgeMs).toISOString(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revokedAt: null,
    userAgent: String(userAgent || ''),
    ip: String(ip || ''),
  };
}

export async function createSession({ userId, token, maxAgeMs, userAgent, ip }) {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const session = buildSession(userId, token, maxAgeMs, userAgent, ip);
    await p.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, updated_at, revoked_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.expiresAt,
        session.createdAt,
        session.updatedAt,
        session.revokedAt,
        session.userAgent,
        session.ip,
      ]
    );
    return session;
  }
  const db = readDb();
  const session = buildSession(userId, token, maxAgeMs, userAgent, ip);
  db.sessions.push(session);
  writeDb(db);
  return session;
}

export async function revokeSessionByToken(token) {
  if (!token) return;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const tokenHash = hashToken(token);
    await p.query('UPDATE sessions SET revoked_at = NOW(), updated_at = NOW() WHERE token_hash = $1', [tokenHash]);
    return;
  }
  const db = readDb();
  const tokenHash = hashToken(token);
  const row = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!row) return;
  row.revokedAt = nowIso();
  row.updatedAt = nowIso();
  writeDb(db);
}

export async function rotateSession({ oldToken, newToken, maxAgeMs, userAgent, ip }) {
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const oldHash = hashToken(oldToken);
    const oldRes = await p.query('SELECT * FROM sessions WHERE token_hash = $1 LIMIT 1', [oldHash]);
    if (!oldRes.rows[0]) return null;
    const oldRow = mapSessionRow(oldRes.rows[0]);
    await p.query('UPDATE sessions SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1', [oldRow.id]);
    const next = buildSession(oldRow.userId, newToken, maxAgeMs, userAgent, ip);
    await p.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, updated_at, revoked_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [next.id, next.userId, next.tokenHash, next.expiresAt, next.createdAt, next.updatedAt, next.revokedAt, next.userAgent, next.ip]
    );
    return next;
  }
  const db = readDb();
  const oldHash = hashToken(oldToken);
  const oldRow = db.sessions.find((s) => s.tokenHash === oldHash);
  if (!oldRow) return null;
  oldRow.revokedAt = nowIso();
  oldRow.updatedAt = nowIso();
  const next = buildSession(oldRow.userId, newToken, maxAgeMs, userAgent, ip);
  db.sessions.push(next);
  writeDb(db);
  return next;
}

export async function getSessionWithUser(token) {
  if (!token) return null;
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const tokenHash = hashToken(token);
    const res = await p.query(
      `SELECT s.*, u.id AS u_id, u.username, u.email, u.role, u.status, u.created_at AS u_created_at, u.updated_at AS u_updated_at,
              u.workspace_quota_bytes AS u_workspace_quota_bytes, u.staff_role_id AS u_staff_role_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    const session = mapSessionRow(row);
    if (session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    const rawUser = {
      id: row.u_id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: new Date(row.u_created_at).toISOString(),
      updatedAt: new Date(row.u_updated_at).toISOString(),
      workspaceQuotaBytes:
        row.u_workspace_quota_bytes != null ? Number(row.u_workspace_quota_bytes) : undefined,
      staffRoleId: row.u_staff_role_id != null && row.u_staff_role_id !== '' ? String(row.u_staff_role_id) : null,
    };
    if (rawUser.status !== 'active') return null;
    return {
      session,
      user: publicUser(rawUser),
      shouldRotate: Date.now() - new Date(session.createdAt).getTime() > DAY_MS,
    };
  }
  const db = readDb();
  const tokenHash = hashToken(token);
  const row = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  const user = db.users.find((u) => u.id === row.userId);
  if (!user || user.status !== 'active') return null;
  return {
    session: row,
    user: publicUser(user),
    shouldRotate: Date.now() - new Date(row.createdAt).getTime() > DAY_MS,
  };
}

export async function createAuditLog({ actorUserId = null, actorIdentifier = '', action, targetUserId = null, meta = null, ip = '', userAgent = '' }) {
  if (!action) return;
  const entry = {
    id: crypto.randomUUID(),
    actorUserId: actorUserId || null,
    actorIdentifier: String(actorIdentifier || ''),
    action: String(action),
    targetUserId: targetUserId || null,
    metaJson: meta == null ? null : JSON.stringify(meta),
    ip: String(ip || ''),
    userAgent: String(userAgent || ''),
    createdAt: nowIso(),
  };
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    await p.query(
      `INSERT INTO audit_logs (id, actor_user_id, actor_identifier, action, target_user_id, meta_json, ip, user_agent, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [entry.id, entry.actorUserId, entry.actorIdentifier, entry.action, entry.targetUserId, entry.metaJson, entry.ip, entry.userAgent, entry.createdAt]
    );
    return;
  }
  const db = readDb();
  db.auditLogs.push(entry);
  if (db.auditLogs.length > 2000) db.auditLogs.splice(0, db.auditLogs.length - 2000);
  writeDb(db);
}

export async function countAuditLogsSince({ action, actionPrefix, sinceIso }) {
  const act = String(action || '').trim();
  const prefix = String(actionPrefix || '').trim();
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : NaN;
  if (!Number.isFinite(sinceMs) || (!act && !prefix)) return 0;
  const since = new Date(sinceMs).toISOString();
  if (USE_POSTGRES) {
    await ensurePostgres();
    if (prefix) {
      const res = await getPool().query(
        `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action LIKE $1 AND created_at >= $2`,
        [`${prefix}%`, since]
      );
      return Number(res.rows[0]?.c || 0);
    }
    const res = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = $1 AND created_at >= $2`,
      [act, since]
    );
    return Number(res.rows[0]?.c || 0);
  }
  const db = readDb();
  return (db.auditLogs || []).filter((r) => {
    if (new Date(r.createdAt).getTime() < sinceMs) return false;
    if (prefix) return String(r.action || '').startsWith(prefix);
    return r.action === act;
  }).length;
}

export async function listAuditLogs(arg = 200) {
  const opts = typeof arg === 'number' ? { limit: arg } : arg || {};
  const max = Math.max(1, Math.min(1000, Number(opts.limit || 200)));
  const offset = Math.max(0, Number(opts.offset || 0));
  const action = opts.action ? String(opts.action).trim() : '';
  const actor = opts.actor ? String(opts.actor).trim().toLowerCase() : '';
  const targetUserId = opts.targetUserId ? String(opts.targetUserId).trim() : '';
  const category = normalizeAuditCategory(opts.category);
  const excludeActions = parseExcludeActions(opts.excludeActions);
  const cursorRaw = opts.cursor ? String(opts.cursor).trim() : '';
  const cursor = cursorRaw ? decodeAuditCursor(cursorRaw) : null;
  const useCursor = Boolean(cursor);
  const fromMs = opts.from ? new Date(opts.from).getTime() : NaN;
  const toMs = opts.to ? new Date(opts.to).getTime() : NaN;

  function matchRow(r) {
    if (action && r.action !== action) return false;
    if (excludeActions.length && excludeActions.includes(r.action)) return false;
    if (!auditLogMatchesCategory(r.action, category)) return false;
    if (actor && !String(r.actorIdentifier || '').toLowerCase().includes(actor)) return false;
    if (targetUserId && r.targetUserId !== targetUserId) return false;
    const t = new Date(r.createdAt).getTime();
    if (Number.isFinite(fromMs) && t < fromMs) return false;
    if (Number.isFinite(toMs) && t > toMs) return false;
    if (useCursor && !rowBeforeCursor(r, cursor)) return false;
    return true;
  }

  function safeParseMeta(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(String(raw));
    } catch {
      return null;
    }
  }

  function mapLogRow(r) {
    return {
      id: r.id,
      actorUserId: r.actorUserId ?? r.actor_user_id ?? null,
      actorIdentifier: r.actorIdentifier ?? r.actor_identifier ?? '',
      action: r.action,
      targetUserId: r.targetUserId ?? r.target_user_id ?? null,
      meta: r.meta ?? safeParseMeta(r.meta_json ?? r.metaJson),
      ip: r.ip ?? '',
      userAgent: r.userAgent ?? r.user_agent ?? '',
      createdAt: r.createdAt ?? new Date(r.created_at).toISOString(),
    };
  }

  function withNextCursor(logs) {
    const nextCursor = logs.length >= max ? encodeAuditCursor(logs[logs.length - 1]) : null;
    return { logs, total, limit: max, offset: useCursor ? undefined : offset, nextCursor };
  }

  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const clauses = [];
    const params = [];
    let i = 1;
    if (action) {
      clauses.push(`action = $${i++}`);
      params.push(action);
    }
    const catSql = auditCategorySql(category, i);
    if (catSql) {
      clauses.push(catSql.sql);
      params.push(...catSql.params);
      i += catSql.params.length;
    }
    if (excludeActions.length) {
      clauses.push(`action NOT IN (${excludeActions.map(() => `$${i++}`).join(', ')})`);
      params.push(...excludeActions);
    }
    if (actor) {
      clauses.push(`LOWER(actor_identifier) LIKE $${i++}`);
      params.push(`%${actor}%`);
    }
    if (targetUserId) {
      clauses.push(`target_user_id = $${i++}`);
      params.push(targetUserId);
    }
    if (Number.isFinite(fromMs)) {
      clauses.push(`created_at >= $${i++}`);
      params.push(new Date(fromMs).toISOString());
    }
    if (Number.isFinite(toMs)) {
      clauses.push(`created_at <= $${i++}`);
      params.push(new Date(toMs).toISOString());
    }
    if (cursor) {
      clauses.push(`(created_at, id) < ($${i++}::timestamptz, $${i++})`);
      params.push(new Date(cursor.createdAt).toISOString(), cursor.id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countRes = await p.query(`SELECT COUNT(*)::int AS c FROM audit_logs ${where}`, params);
    const total = Number(countRes.rows[0]?.c || 0);
    if (useCursor) {
      params.push(max);
      const res = await p.query(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT $${i++}`,
        params
      );
      const logs = res.rows.map((r) => mapLogRow(r));
      return withNextCursor(logs);
    }
    params.push(max, offset);
    const res = await p.query(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    const logs = res.rows.map((r) => mapLogRow(r));
    return { logs, total, limit: max, offset, nextCursor: null };
  }
  const db = readDb();
  let rows = (db.auditLogs || [])
    .slice()
    .sort((a, b) => {
      const dt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (dt !== 0) return dt;
      return String(b.id).localeCompare(String(a.id));
    })
    .map((r) => mapLogRow(r));
  rows = rows.filter(matchRow);
  const total = rows.length;
  const logs = useCursor ? rows.slice(0, max) : rows.slice(offset, offset + max);
  if (useCursor) return withNextCursor(logs);
  return { logs, total, limit: max, offset, nextCursor: null };
}

/** 管理端：用户会话列表（不含 token） */
export async function listSessionsForUser(userId, options = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const max = Math.max(1, Math.min(50, Number(options.limit || 20)));
  const now = Date.now();
  const mapPublic = (s) => ({
    id: s.id,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    ip: s.ip || '',
    userAgent: s.userAgent || '',
    active: !s.revokedAt && new Date(s.expiresAt).getTime() > now,
  });

  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const res = await p.query(
      `SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [uid, max]
    );
    return res.rows.map((row) => mapPublic(mapSessionRow(row)));
  }
  const db = readDb();
  return (db.sessions || [])
    .filter((s) => s.userId === uid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, max)
    .map(mapPublic);
}

export async function initAuthStore() {
  if (USE_POSTGRES) {
    try {
      await ensurePostgres();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!allowJsonFallbackWhenPostgresFails()) {
        pgReady = false;
        resetPostgresPool();
        throw new Error(`Postgres unavailable and JSON fallback is disabled: ${msg}`);
      }
      console.warn(`[auth-store] Postgres 不可用（${msg}），回退 auth-db.json`);
      USE_POSTGRES = false;
      pool = null;
      pgReady = false;
    }
  }
  const { ensureAdminRbac } = await import('./admin-roles-store.js');
  await ensureAdminRbac();
  const { ensureGeminiFairnessConfigStore } = await import('./gemini-fairness-config-store.js');
  await ensureGeminiFairnessConfigStore();
  const { ensureWorkflowTaskEventsStore } = await import('./workflow-task-events-store.js');
  await ensureWorkflowTaskEventsStore();
  const { ensureCreditStore } = await import('./credit-store.js');
  await ensureCreditStore();
  const { ensureModelOpsConfigStore } = await import('./ai-gateway/model-ops-config-store.js');
  await ensureModelOpsConfigStore();
}

/** @internal RBAC JSON/Postgres helpers */
export { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres, resetPostgresPool };
