import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const DB_DIR = path.resolve(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DB_DIR, 'auth-db.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_POSTGRES = Boolean(DATABASE_URL);
let pool = null;
let pgReady = false;

function nowIso() {
  return new Date().toISOString();
}

function getPool() {
  if (!USE_POSTGRES) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
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
  pgReady = true;
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const init = { version: 1, users: [], sessions: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
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
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
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
  };
}

function safeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

function safeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function mapUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
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
  if (USE_POSTGRES) {
    await ensurePostgres();
    const p = getPool();
    const exists = await p.query('SELECT id, role, status FROM users WHERE id = $1 LIMIT 1', [id]);
    if (!exists.rows[0]) return null;
    const nextRole = patch?.role != null ? safeRole(patch.role) : exists.rows[0].role;
    const nextStatus = patch?.status != null ? safeStatus(patch.status) : exists.rows[0].status;
    await p.query('UPDATE users SET role = $2, status = $3, updated_at = NOW() WHERE id = $1', [id, nextRole, nextStatus]);
    const out = await p.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return out.rows[0] ? publicUser(mapUserRow(out.rows[0])) : null;
  }
  const db = readDb();
  const target = db.users.find((u) => u.id === id);
  if (!target) return null;
  if (patch?.role != null) target.role = safeRole(patch.role);
  if (patch?.status != null) target.status = safeStatus(patch.status);
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
      return publicUser(mapUserRow(out.rows[0]));
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
    return publicUser(user);
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
  return publicUser(user);
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
      `SELECT s.*, u.id AS u_id, u.username, u.email, u.role, u.status, u.created_at AS u_created_at, u.updated_at AS u_updated_at
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
    const user = {
      id: row.u_id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: new Date(row.u_created_at).toISOString(),
      updatedAt: new Date(row.u_updated_at).toISOString(),
    };
    if (user.status !== 'active') return null;
    return {
      session,
      user,
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

export async function initAuthStore() {
  await ensurePostgres();
}

