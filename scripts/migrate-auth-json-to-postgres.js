import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const DB_FILE = path.resolve(process.cwd(), 'server', 'data', 'auth-db.json');

if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL，无法迁移');
  process.exit(1);
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`未找到源文件：${DB_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(DB_FILE, 'utf8');
const parsed = JSON.parse(raw || '{}');
const users = Array.isArray(parsed.users) ? parsed.users : [];
const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await pool.query('BEGIN');
  try {
    await pool.query(`
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
    await pool.query(`
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

    for (const u of users) {
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE
         SET username = EXCLUDED.username,
             email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             status = EXCLUDED.status,
             updated_at = EXCLUDED.updated_at`,
        [
          u.id,
          u.username || String(u.email || '').split('@')[0] || `user_${String(u.id || '').slice(0, 8)}`,
          String(u.email || '').toLowerCase(),
          u.passwordHash,
          u.role === 'admin' ? 'admin' : 'user',
          u.status === 'disabled' ? 'disabled' : 'active',
          u.createdAt || new Date().toISOString(),
          u.updatedAt || new Date().toISOString(),
        ]
      );
    }

    for (const s of sessions) {
      await pool.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, updated_at, revoked_at, user_agent, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          s.id,
          s.userId,
          s.tokenHash,
          s.expiresAt,
          s.createdAt || new Date().toISOString(),
          s.updatedAt || new Date().toISOString(),
          s.revokedAt || null,
          s.userAgent || '',
          s.ip || '',
        ]
      );
    }

    await pool.query('COMMIT');
    console.log(`[migrate-auth] done: users=${users.length}, sessions=${sessions.length}`);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[migrate-auth] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

