/**
 * 试用通道（Gemini 代理）每日任务计数：按用户 ID + UTC 日期，持久化 JSON。
 */
import fs from 'fs/promises';
import path from 'path';

const DATA_PATH = path.resolve(process.cwd(), 'server/data/trial-gemini-daily.json');

async function loadRaw() {
  try {
    const t = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object') return parsed;
  } catch {
    /* missing or corrupt */
  }
  return { users: {} };
}

async function saveRaw(data) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} userId
 * @param {number} dailyLimit
 * @returns {Promise<{ ok: boolean; used: number; limit: number; remaining?: number }>}
 */
export async function consumeTrialGeminiSlotForUser(userId, dailyLimit) {
  const uid = String(userId || '').trim();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(dailyLimit) || 60)));
  if (!uid) return { ok: false, used: 0, limit };

  const day = utcDay();
  const data = await loadRaw();
  const users = data.users || {};
  const u = { ...(typeof users[uid] === 'object' && users[uid] ? users[uid] : {}) };
  const prev = typeof u[day] === 'number' && Number.isFinite(u[day]) ? u[day] : 0;
  if (prev >= limit) {
    return { ok: false, used: prev, limit, remaining: 0 };
  }
  const next = prev + 1;
  u[day] = next;
  users[uid] = u;
  data.users = users;
  await saveRaw(data);
  return { ok: true, used: next, limit, remaining: limit - next };
}

/**
 * @param {string} userId
 * @param {number} dailyLimit
 */
export async function getTrialGeminiUsageForUser(userId, dailyLimit) {
  const uid = String(userId || '').trim();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(dailyLimit) || 60)));
  const day = utcDay();
  if (!uid) return { day, used: 0, limit, remaining: limit };
  const data = await loadRaw();
  const users = data.users || {};
  const u = typeof users[uid] === 'object' && users[uid] ? users[uid] : {};
  const used = typeof u[day] === 'number' && Number.isFinite(u[day]) ? Math.max(0, Math.floor(u[day])) : 0;
  return { day, used, limit, remaining: Math.max(0, limit - used) };
}
