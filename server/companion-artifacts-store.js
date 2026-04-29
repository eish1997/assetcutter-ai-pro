/**
 * 本地伴侣发行资产元数据（桌面壳安装包 / 宿主侧插件包等），存于本地 JSON。
 * 对象本体在 R2，键需符合 r2-storage-handlers 中的 companion-distribution 前缀约定。
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DATA_PATH = path.resolve(process.cwd(), 'server', 'data', 'companion-artifacts.json');

/** @typedef {{ id: string, kind: 'desktop_shell' | 'host_plugin_bundle', semver: string, channel: string, platform: string, fileName: string, r2Key: string, sha256: string, bytes: number, notes: string, label: string, publishedAt: string, createdByUserId: string }} CompanionArtifactV1 */

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
  const data = await readRaw();
  return [...(data.artifacts || [])].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/**
 * @param {{ kind: string, semver: string, channel?: string, platform: string, fileName: string, r2Key: string, sha256: string, sha512?: string, bytes: number, notes?: string, label?: string, createdByUserId: string }} input
 */
export async function addCompanionArtifact(input) {
  const data = await readRaw();
  const channel = String(input.channel || 'stable').trim() || 'stable';
  const sha512Raw = String(input.sha512 || '').trim().toLowerCase();
  const rec = {
    id: makeId(),
    kind: input.kind,
    semver: String(input.semver || '').trim(),
    channel,
    platform: String(input.platform || '').trim(),
    fileName: String(input.fileName || '').trim(),
    r2Key: String(input.r2Key || '').trim(),
    sha256: String(input.sha256 || '').trim().toLowerCase(),
    ...(sha512Raw ? { sha512: sha512Raw } : {}),
    bytes: Math.floor(Number(input.bytes) || 0),
    notes: String(input.notes || '').trim(),
    label: String(input.label || '').trim(),
    publishedAt: new Date().toISOString(),
    createdByUserId: String(input.createdByUserId || ''),
  };
  if (!rec.kind || !['desktop_shell', 'host_plugin_bundle'].includes(rec.kind)) {
    throw new Error('kind 须为 desktop_shell 或 host_plugin_bundle');
  }
  if (!rec.semver) throw new Error('semver 不能为空');
  if (!rec.platform) throw new Error('platform 不能为空');
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
  data.artifacts = [rec, ...(data.artifacts || [])];
  await writeRaw(data);
  return rec;
}

export async function deleteCompanionArtifact(id) {
  const rid = String(id || '').trim();
  if (!rid) throw new Error('id 无效');
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
      String(r.platform || '').toLowerCase() === platform &&
      String(r.channel || 'stable') === channel
  );
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
