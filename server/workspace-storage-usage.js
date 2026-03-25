import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'workspace-storage-usage.json');

/** 与 auth-store 中默认一致（200MB） */
export const DEFAULT_WORKSPACE_QUOTA_BYTES = 200 * 1024 * 1024;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USAGE_FILE)) {
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ version: 1, users: {} }, null, 2), 'utf8');
  }
}

function readUsage() {
  ensureFile();
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    const p = JSON.parse(raw || '{}');
    if (typeof p !== 'object' || p === null) return { version: 1, users: {} };
    if (!p.users || typeof p.users !== 'object') p.users = {};
    return p;
  } catch {
    return { version: 1, users: {} };
  }
}

function writeUsage(db) {
  ensureFile();
  fs.writeFileSync(USAGE_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * 计入配额：工作区下除 projects-index.json、各项目 workflow.json 外的对象（工作流引用的图片等）
 */
export function isBillableWorkspaceImageKey(userId, objectKey) {
  const uid = String(userId || '').trim();
  const key = String(objectKey || '').trim();
  if (!uid || !key) return false;
  const root = `users/${uid}/workspace/`;
  if (!key.startsWith(root)) return false;
  if (key === `users/${uid}/workspace/projects-index.json`) return false;
  if (key.endsWith('/workflow.json')) return false;
  return true;
}

export function getWorkspaceUsedBytes(userId) {
  const db = readUsage();
  const row = db.users[userId];
  if (!row || typeof row.usedBytes !== 'number') return 0;
  return Math.max(0, Math.floor(row.usedBytes));
}

function getUserRow(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = { usedBytes: 0, keys: {} };
  }
  return db.users[userId];
}

/** 某键当前计入的字节（用于上传前估算剩余空间） */
export function getTrackedBytesForKey(userId, objectKey) {
  const db = readUsage();
  const row = db.users[userId];
  if (!row?.keys) return 0;
  const n = row.keys[objectKey];
  return typeof n === 'number' && n > 0 ? n : 0;
}

/**
 * PUT 成功后登记：按 Head 实际大小更新用量（覆盖同键时先减旧再加新）
 * @returns {{ ok: boolean, usedBytes: number, error?: string, code?: string }}
 */
export function registerBillableObjectAfterPut(userId, objectKey, actualSize) {
  if (!isBillableWorkspaceImageKey(userId, objectKey)) {
    return { ok: true, usedBytes: getWorkspaceUsedBytes(userId) };
  }
  const size = Math.max(0, Math.floor(Number(actualSize) || 0));
  if (size <= 0) return { ok: false, usedBytes: getWorkspaceUsedBytes(userId), error: '对象大小无效', code: 'INVALID_SIZE' };

  const db = readUsage();
  const row = getUserRow(db, userId);
  if (!row.keys) row.keys = {};
  const old = typeof row.keys[objectKey] === 'number' ? row.keys[objectKey] : 0;
  const delta = size - old;
  row.usedBytes = Math.max(0, (row.usedBytes || 0) + delta);
  row.keys[objectKey] = size;
  writeUsage(db);
  return { ok: true, usedBytes: row.usedBytes };
}

/**
 * 删除对象后扣减：优先用账本中的大小，否则用传入的 headSize
 */
export function unregisterBillableObjectAfterDelete(userId, objectKey, headSize) {
  if (!isBillableWorkspaceImageKey(userId, objectKey)) return { usedBytes: getWorkspaceUsedBytes(userId) };
  const db = readUsage();
  const row = db.users[userId];
  if (!row?.keys) {
    const fallback = Math.max(0, Math.floor(Number(headSize) || 0));
    if (fallback > 0) {
      getUserRow(db, userId);
      db.users[userId].usedBytes = Math.max(0, (db.users[userId].usedBytes || 0) - fallback);
      writeUsage(db);
    }
    return { usedBytes: getWorkspaceUsedBytes(userId) };
  }
  const tracked = typeof row.keys[objectKey] === 'number' ? row.keys[objectKey] : 0;
  const sub = tracked > 0 ? tracked : Math.max(0, Math.floor(Number(headSize) || 0));
  if (tracked > 0) delete row.keys[objectKey];
  row.usedBytes = Math.max(0, (row.usedBytes || 0) - sub);
  writeUsage(db);
  return { usedBytes: row.usedBytes };
}

const EMPTY_RECONCILE_BLOCK_PREV_BYTES = 1024 * 1024; // 原账本 ≥1MB 时，不允许被「空扫描」覆盖

/**
 * 管理端：用扫描结果整体替换某用户账单（与 R2 对齐）
 * @param options.forceEmptyReset 为 true 时，即使扫描结果为空且原账本有用量也覆盖（仅确认桶已空时使用）
 */
export function replaceUserUsageFromScan(userId, keyToSize, options = {}) {
  const forceEmptyReset = !!options.forceEmptyReset;
  const prevUsed = getWorkspaceUsedBytes(userId);
  const keys = {};
  let used = 0;
  for (const [k, sz] of Object.entries(keyToSize)) {
    const n = Math.max(0, Math.floor(Number(sz) || 0));
    if (n <= 0) continue;
    keys[k] = n;
    used += n;
  }
  const scanKeyCount = Object.keys(keys).length;
  if (scanKeyCount === 0 && used === 0 && prevUsed >= EMPTY_RECONCILE_BLOCK_PREV_BYTES && !forceEmptyReset) {
    const err = new Error(
      'R2 扫描未列出任何计费对象，但当前用量账本显示仍有数据。为避免误把账本清零导致配额与同步异常，已中止。请核对 R2_BUCKET、密钥、用户 ID 与对象前缀 users/<id>/workspace/；若确认桶中已无计费文件，可在管理端使用「强制同步」。'
    );
    err.code = 'RECONCILE_EMPTY_BLOCKED';
    throw err;
  }
  const db = readUsage();
  db.users[userId] = { usedBytes: used, keys };
  writeUsage(db);
  return { usedBytes: used, scannedKeys: scanKeyCount };
}
