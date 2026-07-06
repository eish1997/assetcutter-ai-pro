/**
 * 平台注册邀请码（一次性）— 与 admin-staff-invites（后台成员角色）分离。
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createAuditLog } from './auth-store.js';

const DATA_PATH = path.resolve(process.cwd(), 'server/data/registration-invites.json');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function getRegistrationMode() {
  const raw = String(process.env.REGISTRATION_MODE || 'open').trim().toLowerCase();
  return raw === 'invite_only' ? 'invite_only' : 'open';
}

/** 去掉空格/连字符并大写，用于 lookup */
export function normalizeRegistrationInviteCode(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

export function formatRegistrationInviteCode(codeKey) {
  const k = normalizeRegistrationInviteCode(codeKey);
  if (k.length === 10 && k.startsWith('AC')) {
    return `${k.slice(0, 2)}-${k.slice(2, 6)}-${k.slice(6, 10)}`;
  }
  return k;
}

function generateCodeKey() {
  let s = 'AC';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return s;
}

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
    code: formatRegistrationInviteCode(row.codeKey),
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

function findRowByCodeKey(store, codeKey) {
  const k = normalizeRegistrationInviteCode(codeKey);
  if (!k) return null;
  return store.invites.find((x) => normalizeRegistrationInviteCode(x.codeKey) === k) || null;
}

function inviteFailureReason(row) {
  if (!row) return 'not_found';
  if (row.revokedAt) return 'revoked';
  if (row.usedAt) return 'used';
  if (new Date(row.expiresAt).getTime() <= Date.now()) return 'expired';
  return null;
}

export function registrationInviteErrorMessage(reason) {
  switch (reason) {
    case 'expired':
      return '邀请码已过期';
    case 'used':
      return '邀请码已使用';
    case 'revoked':
      return '邀请码已撤销';
    case 'required':
      return '需要有效邀请码才能注册';
    default:
      return '邀请码无效或已失效';
  }
}

export async function listRegistrationInvites() {
  const store = await loadStore();
  return store.invites
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(publicInvite);
}

export async function createRegistrationInvite({ note, ttlDays, actor }) {
  const days = Math.max(1, Math.min(90, Math.floor(Number(ttlDays) || 30)));
  const now = Date.now();
  const codeKey = generateCodeKey();
  const invite = {
    id: crypto.randomUUID(),
    codeKey,
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
  const code = formatRegistrationInviteCode(codeKey);
  return {
    invite: publicInvite(invite),
    code,
    codeKey,
    registerPath: `/?invite=${encodeURIComponent(code)}`,
  };
}

export async function revokeRegistrationInvite(inviteId) {
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

export async function peekRegistrationInviteCode(codeInput) {
  const store = await loadStore();
  const row = findRowByCodeKey(store, codeInput);
  const fail = inviteFailureReason(row);
  if (fail) return { ok: false, reason: fail };
  return { ok: true, inviteId: row.id, code: formatRegistrationInviteCode(row.codeKey) };
}

export async function consumeRegistrationInviteCode(codeInput, userId, meta = {}) {
  const uid = String(userId || '').trim();
  const k = normalizeRegistrationInviteCode(codeInput);
  if (!k || !uid) return { ok: false, reason: 'invalid' };

  const store = await loadStore();
  const row = findRowByCodeKey(store, k);
  let fail = inviteFailureReason(row);
  if (fail) return { ok: false, reason: fail };

  const freshStore = await loadStore();
  const freshRow = findRowByCodeKey(freshStore, k);
  fail = inviteFailureReason(freshRow);
  if (fail) return { ok: false, reason: fail };

  freshRow.usedAt = new Date().toISOString();
  freshRow.usedByUserId = uid;
  await saveStore(freshStore);

  await createAuditLog({
    actorUserId: uid,
    actorIdentifier: meta.username || uid,
    action: 'auth.registration_invite_redeemed',
    targetUserId: uid,
    meta: { inviteId: freshRow.id, code: formatRegistrationInviteCode(freshRow.codeKey) },
    ip: meta.ip || '',
    userAgent: meta.userAgent || '',
  });

  return { ok: true, inviteId: freshRow.id };
}
