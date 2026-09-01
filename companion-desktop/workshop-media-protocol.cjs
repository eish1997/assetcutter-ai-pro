'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { randomBytes } = require('node:crypto');

const SCHEME = 'ac-workshop';
const ROOM_SCHEME = 'ac-room';
const HOST = 'v1';

/** @type {Map<string, { abs: string, mime: string, kind: string, issuedAt: number }>} */
const tokens = new Map();
const TOKEN_CAP = 400;

function registerWorkshopMediaScheme(protocol) {
  if (!protocol || typeof protocol.registerSchemesAsPrivileged !== 'function') return;
  const workshopPrivileges = {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  };
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: workshopPrivileges },
    { scheme: ROOM_SCHEME, privileges: { ...workshopPrivileges } },
  ]);
}

function mediaUrlFileName(fileAbs) {
  const raw = path.basename(String(fileAbs || '')) || 'file';
  const ext = path.extname(raw);
  const stem = raw
    .slice(0, Math.max(0, raw.length - ext.length))
    .replace(/[^\w.\u4e00-\u9fff-]+/g, '_')
    .slice(0, 80) || 'file';
  const safeExt = /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext : '';
  return `${stem}${safeExt}`;
}

function issueWorkshopMediaUrl(fileAbs, meta) {
  const abs = path.resolve(String(fileAbs || ''));
  if (!abs) return '';
  const token = randomBytes(16).toString('hex');
  tokens.set(token, {
    abs,
    mime: String((meta && meta.mime) || 'application/octet-stream'),
    kind: String((meta && meta.kind) || 'file'),
    issuedAt: Date.now(),
  });
  while (tokens.size > TOKEN_CAP) {
    const first = tokens.keys().next().value;
    if (!first) break;
    tokens.delete(first);
  }
  return `${SCHEME}://${HOST}/${token}/${encodeURIComponent(mediaUrlFileName(abs))}`;
}

function parseWorkshopMediaUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== `${SCHEME}:`) return null;
    if (String(parsed.hostname || '').toLowerCase() !== HOST) return null;
    const token = decodeURIComponent(String(parsed.pathname || '').replace(/^\/+/, '').split('/')[0] || '').trim();
    return token || null;
  } catch {
    return null;
  }
}

function resolveWorkshopMediaRequest(url) {
  const token = parseWorkshopMediaUrl(url);
  if (!token) return null;
  const rec = tokens.get(token);
  if (!rec || !rec.abs) return null;
  return rec;
}

function isWorkshopMediaUrl(url) {
  return Boolean(parseWorkshopMediaUrl(url));
}

function clearWorkshopMediaTokensForTests() {
  tokens.clear();
}

function rangeResponse(request, abs, mime, size) {
  const range = request && request.headers ? request.headers.get('Range') || request.headers.get('range') : '';
  if (!range) {
    return new Response(fs.createReadStream(abs), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(String(range));
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end) || end >= size) end = size - 1;
  if (start < 0 || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const chunk = end - start + 1;
  return new Response(fs.createReadStream(abs, { start, end }), {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(chunk),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

function attachWorkshopMediaProtocol(protocol, _net, opts) {
  const isAllowedAbs = opts && typeof opts.isAllowedAbs === 'function' ? opts.isAllowedAbs : () => false;
  const handler = async (request) => {
    const hit = resolveWorkshopMediaRequest(request.url);
    if (!hit) return new Response('not found', { status: 404 });
    if (!isAllowedAbs(hit.abs)) return new Response('forbidden', { status: 403 });
    let st;
    try {
      st = await fsp.stat(hit.abs);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!st.isFile()) return new Response('not found', { status: 404 });
    try {
      return rangeResponse(request, hit.abs, hit.mime, st.size);
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
      proto.handle(SCHEME, handler);
    } catch (err) {
      console.warn('[workshop-media] protocol.handle', err && err.message ? err.message : err);
    }
  }
}

module.exports = {
  SCHEME,
  ROOM_SCHEME,
  HOST,
  registerWorkshopMediaScheme,
  issueWorkshopMediaUrl,
  resolveWorkshopMediaRequest,
  isWorkshopMediaUrl,
  parseWorkshopMediaUrl,
  clearWorkshopMediaTokensForTests,
  attachWorkshopMediaProtocol,
};
