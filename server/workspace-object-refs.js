import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const REFS_FILE = path.join(DATA_DIR, 'workspace-object-refs.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REFS_FILE)) {
    fs.writeFileSync(REFS_FILE, JSON.stringify({ version: 1, users: {} }, null, 2), 'utf8');
  }
}

function readDb() {
  ensureFile();
  try {
    const raw = fs.readFileSync(REFS_FILE, 'utf8');
    const db = JSON.parse(raw || '{}');
    if (!db || typeof db !== 'object') return { version: 1, users: {} };
    if (!db.users || typeof db.users !== 'object') db.users = {};
    return db;
  } catch {
    return { version: 1, users: {} };
  }
}

function writeDb(db) {
  ensureFile();
  fs.writeFileSync(REFS_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function ensureUserRow(db, userId) {
  if (!db.users[userId] || typeof db.users[userId] !== 'object') {
    db.users[userId] = { refs: {} };
  }
  if (!db.users[userId].refs || typeof db.users[userId].refs !== 'object') {
    db.users[userId].refs = {};
  }
  return db.users[userId];
}

export function applyWorkspaceObjectRefDelta(userId, addKeys = [], removeKeys = []) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('userId 无效');
  const db = readDb();
  const row = ensureUserRow(db, uid);
  const refs = row.refs;
  const delta = new Map();
  for (const k of addKeys) {
    const key = String(k || '').trim();
    if (!key) continue;
    delta.set(key, (delta.get(key) || 0) + 1);
  }
  for (const k of removeKeys) {
    const key = String(k || '').trim();
    if (!key) continue;
    delta.set(key, (delta.get(key) || 0) - 1);
  }

  const deletedKeys = [];
  for (const [key, d] of delta.entries()) {
    const oldCount = Math.max(0, Math.floor(Number(refs[key] || 0)));
    const next = oldCount + d;
    if (next <= 0) {
      if (oldCount > 0) deletedKeys.push(key);
      delete refs[key];
    } else {
      refs[key] = next;
    }
  }

  writeDb(db);
  return { deletedKeys };
}

