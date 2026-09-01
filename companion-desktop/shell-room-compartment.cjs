'use strict';

const fs = require('fs');
const path = require('path');
const { isLeasedRoomView } = require('./shell-rooms.cjs');

const ROOM_SCHEME = 'ac-room';
const ROOM_SESSION_PARTITION = 'persist:assetcutter-room';
const MANIFEST_NAME = 'assetcutter-room.json';
const MANIFEST_KIND = 'assetcutter-room';
const MANIFEST_FORMAT = 1;
const ENTRY_NAME = 'index.html';

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function roomsRoot(userData) {
  return path.join(String(userData || ''), 'rooms');
}

function roomDir(userData, roomId) {
  const id = String(roomId || '');
  if (!isLeasedRoomView(id)) throw new Error('invalid_room_id');
  return path.join(roomsRoot(userData), id);
}

function isPathInside(root, target) {
  const r = path.resolve(String(root || ''));
  const t = path.resolve(String(target || ''));
  const prefix = r.endsWith(path.sep) ? r : `${r}${path.sep}`;
  return t === r || t.startsWith(prefix);
}

function emptyRoomHtml(title) {
  const safe = String(title || '空房')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return (
    '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    `<title>${safe}</title>\n` +
    '<style>html,body{margin:0;height:100%;background:#0b0b0d;color:#6f6f78;font-family:system-ui,sans-serif;}</style>\n' +
    '</head>\n' +
    '<body></body>\n' +
    '</html>\n'
  );
}

function ensureEmptyRoom(opts = {}) {
  const userData = String(opts.userData || '');
  const roomId = String(opts.roomId || '');
  const title = String(opts.title || '空房');
  const dir = roomDir(userData, roomId);
  fs.mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, ENTRY_NAME);
  if (!fs.existsSync(entry)) {
    fs.writeFileSync(entry, emptyRoomHtml(title), 'utf8');
  }
  return { dir, entry };
}

function removeRoomDir(opts = {}) {
  const userData = String(opts.userData || '');
  const roomId = String(opts.roomId || '');
  if (!isLeasedRoomView(roomId)) return { removed: false };
  const dir = roomDir(userData, roomId);
  if (!fs.existsSync(dir)) return { removed: false, dir };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, dir };
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipNameOk(name) {
  const n = String(name || '').replace(/\\/g, '/');
  if (!n || n.startsWith('/') || n.includes(':')) return false;
  const parts = n.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function packStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const row of entries) {
    const name = String(row.name || '').replace(/\\/g, '/');
    if (!zipNameOk(name)) throw new Error('zip_path_invalid');
    const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || '');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const flags = 0x0800;
    const local =
      Buffer.concat([
        u32(0x04034b50),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0),
        nameBuf,
        data,
      ]);
    const central =
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf,
      ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readStoredZip(buf) {
  const zip = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const eocd = findEocd(zip);
  if (eocd < 0) throw new Error('zip_invalid');
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > zip.length) throw new Error('zip_invalid');
  const out = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('zip_invalid');
    const method = zip.readUInt16LE(cursor + 10);
    const nameLen = zip.readUInt16LE(cursor + 28);
    const extraLen = zip.readUInt16LE(cursor + 30);
    const commentLen = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (!zipNameOk(name)) throw new Error('zip_path_traversal');
    if (method !== 0) throw new Error('zip_unsupported_method');
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip_invalid');
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const size = zip.readUInt32LE(localOffset + 18);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = zip.slice(dataStart, dataStart + size);
    out.push({ name, data });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function listRoomFiles(dir) {
  const out = [];
  function walk(absDir, prefix) {
    if (!fs.existsSync(absDir)) return;
    for (const name of fs.readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile() && zipNameOk(rel) && rel !== MANIFEST_NAME) {
        out.push({ name: rel, data: fs.readFileSync(abs) });
      }
    }
  }
  walk(dir, '');
  return out;
}

function roomManifest(opts = {}) {
  return {
    kind: MANIFEST_KIND,
    format: MANIFEST_FORMAT,
    title: String(opts.title || '空房'),
    entry: ENTRY_NAME,
  };
}

function parseRoomManifest(raw) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''));
  } catch {
    throw new Error('zip_manifest_invalid');
  }
  if (!parsed || parsed.kind !== MANIFEST_KIND || Number(parsed.format) !== MANIFEST_FORMAT) {
    throw new Error('zip_manifest_invalid');
  }
  const entry = String(parsed.entry || '').replace(/\\/g, '/');
  if (entry !== ENTRY_NAME) throw new Error('zip_entry_missing');
  return {
    kind: MANIFEST_KIND,
    format: MANIFEST_FORMAT,
    title: String(parsed.title || '').trim() || '空房',
    entry: ENTRY_NAME,
  };
}

function exportRoomZip(opts = {}) {
  const dir = roomDir(opts.userData, opts.roomId);
  if (!fs.existsSync(path.join(dir, ENTRY_NAME))) throw new Error('room_entry_missing');
  const files = listRoomFiles(dir);
  const manifest = Buffer.from(JSON.stringify(roomManifest({ title: opts.title }), null, 2), 'utf8');
  return packStoredZip([{ name: MANIFEST_NAME, data: manifest }, ...files]);
}

function validateRoomZip(buf) {
  const entries = readStoredZip(buf);
  const byName = new Map(entries.map((row) => [row.name, row]));
  const manifestRow = byName.get(MANIFEST_NAME);
  if (!manifestRow) throw new Error('zip_manifest_invalid');
  const manifest = parseRoomManifest(manifestRow.data);
  if (!byName.has(manifest.entry)) throw new Error('zip_entry_missing');
  return { entries, manifest };
}

function unpackRoomZip(buf, destDir) {
  const { entries, manifest } = validateRoomZip(buf);
  const root = path.resolve(String(destDir || ''));
  fs.mkdirSync(root, { recursive: true });
  for (const row of entries) {
    if (row.name === MANIFEST_NAME) continue;
    if (!zipNameOk(row.name)) throw new Error('zip_path_traversal');
    const abs = path.resolve(root, row.name);
    if (!isPathInside(root, abs)) throw new Error('zip_path_traversal');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, row.data);
  }
  return { dir: root, manifest };
}

function mimeForName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function parseRoomUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== `${ROOM_SCHEME}:`) return null;
    const roomId = String(parsed.hostname || '').trim();
    if (!isLeasedRoomView(roomId)) return null;
    let rel = decodeURIComponent(String(parsed.pathname || '').replace(/^\/+/, ''));
    if (!rel) rel = ENTRY_NAME;
    rel = rel.replace(/\\/g, '/');
    if (!zipNameOk(rel)) return null;
    return { roomId, rel };
  } catch {
    return null;
  }
}

function resolveRoomFile(userData, roomId, rel) {
  const root = roomDir(userData, roomId);
  const abs = path.resolve(root, String(rel || ENTRY_NAME));
  if (!isPathInside(root, abs)) return null;
  return abs;
}

function roomEntryUrl(roomId) {
  const id = String(roomId || '');
  if (!isLeasedRoomView(id)) return '';
  return `${ROOM_SCHEME}://${id}/${ENTRY_NAME}`;
}

function attachRoomCompartmentProtocol(protocol, opts = {}) {
  const getUserData = typeof opts.getUserDataPath === 'function' ? opts.getUserDataPath : () => '';
  const handler = async (request) => {
    const hit = parseRoomUrl(request && request.url);
    if (!hit) return new Response('not found', { status: 404 });
    let abs;
    try {
      abs = resolveRoomFile(getUserData(), hit.roomId, hit.rel);
    } catch {
      return new Response('forbidden', { status: 403 });
    }
    if (!abs) return new Response('forbidden', { status: 403 });
    try {
      const st = await fs.promises.stat(abs);
      if (!st.isFile()) return new Response('not found', { status: 404 });
      const bytes = await fs.promises.readFile(abs);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': mimeForName(hit.rel),
          'Content-Length': String(bytes.length),
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
  const sessions = [];
  if (opts && opts.session) sessions.push(opts.session);
  if (protocol && typeof protocol.handle === 'function') sessions.push({ protocol });
  const seen = new Set();
  for (const ses of sessions) {
    const proto = ses && ses.protocol ? ses.protocol : ses;
    if (!proto || typeof proto.handle !== 'function') continue;
    if (seen.has(proto)) continue;
    seen.add(proto);
    try {
      proto.handle(ROOM_SCHEME, handler);
    } catch (err) {
      console.warn('[ac-room] protocol.handle', err && err.message ? err.message : err);
    }
  }
}

module.exports = {
  ROOM_SCHEME,
  ROOM_SESSION_PARTITION,
  MANIFEST_NAME,
  ENTRY_NAME,
  roomsRoot,
  roomDir,
  ensureEmptyRoom,
  removeRoomDir,
  emptyRoomHtml,
  packStoredZip,
  readStoredZip,
  zipNameOk,
  exportRoomZip,
  validateRoomZip,
  unpackRoomZip,
  parseRoomUrl,
  resolveRoomFile,
  roomEntryUrl,
  attachRoomCompartmentProtocol,
};
