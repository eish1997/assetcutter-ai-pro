/**
 * 本地伴侣发行资产元数据（桌面壳安装包 / 宿主侧插件包等）。
 * - 若配置了 **DATABASE_URL**（如 Render 生产）：存 **Postgres**，部署后仍保留。
 * - 否则：存 **server/data/companion-artifacts.json**（本地开发常见）。
 * 对象本体在 R2，键需符合 r2-storage-handlers 中的 companion-distribution 前缀约定。
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import {
  ALLOWED_COMPANION_PLATFORMS,
  normalizeCompanionPlatformInput,
  platformMatchesQuery,
  platformRankForLatest,
} from './companion-artifacts-platform.js';

const DATA_PATH = path.resolve(process.cwd(), 'server', 'data', 'companion-artifacts.json');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_COMPANION_PG = Boolean(DATABASE_URL);
const { Pool } = pg;
let companionPool = null;
let companionPgReady = false;

/** @typedef {{ id: string, kind: 'desktop_shell' | 'host_plugin_bundle' | 'shell_tool_bundle', semver: string, channel: string, platform: string, fileName: string, r2Key: string, sha256: string, bytes: number, notes: string, label: string, publishedAt: string, createdByUserId: string }} CompanionArtifactV1 */

function getCompanionPool() {
  if (!USE_COMPANION_PG) return null;
  if (!companionPool) {
    companionPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return companionPool;
}

async function ensureCompanionArtifactsPg() {
  if (!USE_COMPANION_PG || companionPgReady) return;
  const p = getCompanionPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS companion_artifacts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      semver TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'stable',
      platform TEXT NOT NULL,
      file_name TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      sha512 TEXT,
      block_map_bytes BIGINT,
      block_map_r2_key TEXT,
      bytes BIGINT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ NOT NULL,
      created_by_user_id TEXT NOT NULL DEFAULT ''
    );
  `);
  await p.query(
    `ALTER TABLE companion_artifacts ADD COLUMN IF NOT EXISTS block_map_bytes BIGINT`,
  );
  await p.query(
    `ALTER TABLE companion_artifacts ADD COLUMN IF NOT EXISTS block_map_r2_key TEXT`,
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_companion_artifacts_published_at ON companion_artifacts (published_at DESC);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_companion_artifacts_lookup ON companion_artifacts (kind, (lower(platform)), channel);`
  );
  companionPgReady = true;
}

function mapPgRow(r) {
  if (!r) return null;
  const out = {
    id: r.id,
    kind: r.kind,
    semver: r.semver,
    channel: r.channel || 'stable',
    platform: r.platform,
    fileName: r.file_name,
    r2Key: r.r2_key,
    sha256: String(r.sha256 || '').toLowerCase(),
    bytes: Number(r.bytes) || 0,
    notes: r.notes ?? '',
    label: r.label ?? '',
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : '',
    createdByUserId: r.created_by_user_id ?? '',
  };
  const sp = r.sha512 != null && String(r.sha512).trim() ? String(r.sha512).trim().toLowerCase() : '';
  if (sp) out.sha512 = sp;
  const bm = Number(r.block_map_bytes);
  if (Number.isFinite(bm) && bm > 0) out.blockMapBytes = Math.floor(bm);
  const bmk =
    r.block_map_r2_key != null && String(r.block_map_r2_key).trim()
      ? String(r.block_map_r2_key).trim()
      : '';
  if (bmk) out.blockMapR2Key = bmk;
  return out;
}

function defaultData() {
  return { schemaVersion: 1, artifacts: [] };
}

async function readRaw() {
  try {
    const text = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return defaultData();
    if (!Array.isArray(parsed.artifacts)) return defaultData();
    return parsed;
  } catch {
    return defaultData();
  }
}

async function writeRaw(data) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function makeId() {
  return crypto.randomBytes(12).toString('hex');
}

export async function listCompanionArtifacts() {
  await ensureCompanionArtifactsPg();
  if (USE_COMPANION_PG) {
    const p = getCompanionPool();
    const r = await p.query(
      `SELECT id, kind, semver, channel, platform, file_name, r2_key, sha256, sha512, bytes, notes, label, published_at, created_by_user_id
       FROM companion_artifacts
       ORDER BY published_at DESC`
    );
    return r.rows.map((row) => mapPgRow(row));
  }
  const data = await readRaw();
  return [...(data.artifacts || [])].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/**
 * @param {{ kind: string, semver: string, channel?: string, platform: string, fileName: string, r2Key: string, sha256: string, sha512?: string, blockMapBytes?: number, blockMapR2Key?: string, bytes: number, notes?: string, label?: string, createdByUserId: string }} input
 */
export async function addCompanionArtifact(input) {
  const channel = String(input.channel || 'stable').trim() || 'stable';
  const sha512Raw = String(input.sha512 || '').trim().toLowerCase();
  const blockMapBytes = Math.floor(Number(input.blockMapBytes) || 0);
  const blockMapR2Key = String(input.blockMapR2Key || '').trim();
  const rec = {
    id: makeId(),
    kind: input.kind,
    semver: String(input.semver || '').trim(),
    channel,
    platform: normalizeCompanionPlatformInput(input.platform),
    fileName: String(input.fileName || '').trim(),
    r2Key: String(input.r2Key || '').trim(),
    sha256: String(input.sha256 || '').trim().toLowerCase(),
    ...(sha512Raw ? { sha512: sha512Raw } : {}),
    ...(blockMapBytes > 0 ? { blockMapBytes } : {}),
    ...(blockMapR2Key ? { blockMapR2Key } : {}),
    bytes: Math.floor(Number(input.bytes) || 0),
    notes: String(input.notes || '').trim(),
    label: String(input.label || '').trim(),
    publishedAt: new Date().toISOString(),
    createdByUserId: String(input.createdByUserId || ''),
  };
  if (!rec.kind || !['desktop_shell', 'host_plugin_bundle', 'shell_tool_bundle'].includes(rec.kind)) {
    throw new Error('kind 须为 desktop_shell、host_plugin_bundle 或 shell_tool_bundle');
  }
  if (!rec.semver) throw new Error('semver 不能为空');
  if (!rec.platform) throw new Error('platform 不能为空');
  if (!ALLOWED_COMPANION_PLATFORMS.includes(rec.platform)) {
    throw new Error(`platform 须为 ${ALLOWED_COMPANION_PLATFORMS.join(' | ')}`);
  }
  if (!rec.fileName) throw new Error('fileName 不能为空');
  if (!rec.r2Key) throw new Error('r2Key 不能为空');
  if (!rec.r2Key.startsWith('public/companion-distribution/')) {
    throw new Error('r2Key 须以 public/companion-distribution/ 开头');
  }
  if (!/^[a-f0-9]{64}$/.test(rec.sha256)) throw new Error('sha256 须为 64 位十六进制');
  if (rec.sha512 && !/^[a-f0-9]{128}$/.test(rec.sha512)) {
    throw new Error('sha512 须为 128 位十六进制，或留空');
  }
  if (!Number.isFinite(rec.bytes) || rec.bytes < 1) throw new Error('bytes 无效');
  if (rec.blockMapR2Key && !rec.blockMapR2Key.startsWith('public/companion-distribution/')) {
    throw new Error('blockMapR2Key 须以 public/companion-distribution/ 开头');
  }
  if (rec.blockMapBytes && (!rec.blockMapR2Key || rec.blockMapBytes < 1)) {
    throw new Error('blockMapBytes 须与 blockMapR2Key 同时提供');
  }

  await ensureCompanionArtifactsPg();
  if (USE_COMPANION_PG) {
    const p = getCompanionPool();
    await p.query(
      `INSERT INTO companion_artifacts (
        id, kind, semver, channel, platform, file_name, r2_key, sha256, sha512, block_map_bytes, block_map_r2_key, bytes, notes, label, published_at, created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16)`,
      [
        rec.id,
        rec.kind,
        rec.semver,
        rec.channel,
        rec.platform,
        rec.fileName,
        rec.r2Key,
        rec.sha256,
        rec.sha512 || null,
        rec.blockMapBytes || null,
        rec.blockMapR2Key || null,
        rec.bytes,
        rec.notes,
        rec.label,
        rec.publishedAt,
        rec.createdByUserId,
      ]
    );
    return rec;
  }

  const data = await readRaw();
  data.artifacts = [rec, ...(data.artifacts || [])];
  await writeRaw(data);
  return rec;
}

export async function deleteCompanionArtifact(id) {
  const rid = String(id || '').trim();
  if (!rid) throw new Error('id 无效');
  await ensureCompanionArtifactsPg();
  if (USE_COMPANION_PG) {
    const p = getCompanionPool();
    const r = await p.query(`DELETE FROM companion_artifacts WHERE id = $1`, [rid]);
    if (r.rowCount < 1) throw new Error('记录不存在');
    return { ok: true };
  }
  const data = await readRaw();
  const before = (data.artifacts || []).length;
  data.artifacts = (data.artifacts || []).filter((x) => x && x.id !== rid);
  if (data.artifacts.length === before) throw new Error('记录不存在');
  await writeRaw(data);
  return { ok: true };
}

export async function getCompanionArtifactById(id) {
  const rid = String(id || '').trim();
  if (!rid) return null;
  await ensureCompanionArtifactsPg();
  if (USE_COMPANION_PG) {
    const p = getCompanionPool();
    const r = await p.query(`SELECT * FROM companion_artifacts WHERE id = $1 LIMIT 1`, [rid]);
    return r.rows[0] ? mapPgRow(r.rows[0]) : null;
  }
  const data = await readRaw();
  return (data.artifacts || []).find((x) => x && x.id === rid) || null;
}

/**
 * 取「最新」一条：按 publishedAt 降序，再筛 kind / platform / channel。
 * @param {{ kind?: string, platform?: string, channel?: string }} q
 */
export async function pickLatestArtifact(q) {
  const kind = q.kind ? String(q.kind) : 'desktop_shell';
  const platform = q.platform ? String(q.platform).toLowerCase() : 'win32';
  const channel = q.channel ? String(q.channel) : 'stable';
  const rows = await listCompanionArtifacts();
  const filtered = rows.filter(
    (r) =>
      r.kind === kind &&
      platformMatchesQuery(platform, r.platform) &&
      String(r.channel || 'stable') === channel
  );
  filtered.sort((a, b) => {
    const ra = platformRankForLatest(platform, a.platform);
    const rb = platformRankForLatest(platform, b.platform);
    if (ra !== rb) return ra - rb;
    return String(b.publishedAt).localeCompare(String(a.publishedAt));
  });
  return filtered[0] || null;
}

/**
 * 公开列表（不含 r2Key）。含 sha256/bytes 供本机宿主校验下载完整性。
 */
export function toPublicSummary(rec) {
  if (!rec) return null;
  const out = {
    id: rec.id,
    kind: rec.kind,
    semver: rec.semver,
    channel: rec.channel,
    platform: rec.platform,
    fileName: rec.fileName,
    bytes: rec.bytes,
    sha256: rec.sha256,
    notes: rec.notes,
    label: rec.label,
    publishedAt: rec.publishedAt,
  };
  if (rec.sha512 && /^[a-f0-9]{128}$/i.test(String(rec.sha512))) {
    out.sha512 = String(rec.sha512).trim().toLowerCase();
  }
  return out;
}
