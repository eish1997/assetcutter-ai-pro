'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultCodexHome() {
  const envHome = String(process.env.CODEX_HOME || '').trim();
  if (envHome) return envHome;
  return path.join(os.homedir(), '.codex');
}

function codexAuthPath() {
  return path.join(defaultCodexHome(), 'auth.json');
}

function parseAuthPayload(payload) {
  let value = payload;
  if (value && typeof value === 'object' && value.authJsonBase64) {
    value = Buffer.from(String(value.authJsonBase64), 'base64').toString('utf8');
  } else if (value && typeof value === 'object' && value.authJson != null) {
    value = value.authJson;
  }
  if (typeof value === 'string') {
    value = JSON.parse(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_auth_payload');
  }
  return value;
}

async function fetchJson(url, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { method: 'GET', headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`http_${resp.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  return resp.json();
}

function writeCodexAuthJson(authJson) {
  const target = codexAuthPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(authJson, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* Windows may ignore POSIX modes. */
  }
  return target;
}

async function syncCodexAuthFromCloud(settings) {
  const url = String((settings && settings.codexSharedAuthUrl) || '').trim();
  if (!url) return { ok: false, skipped: true, error: 'missing_codex_shared_auth_url' };
  const token = String((settings && settings.codexSharedAuthToken) || '').trim();
  const payload = await fetchJson(url, token);
  const authJson = parseAuthPayload(payload);
  const target = writeCodexAuthJson(authJson);
  return {
    ok: true,
    path: target,
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt: payload && payload.updatedAt ? String(payload.updatedAt) : null,
  };
}

function codexAuthStatus() {
  const target = codexAuthPath();
  let exists = false;
  let mtime = null;
  try {
    const st = fs.statSync(target);
    exists = st.isFile();
    mtime = st.mtime.toISOString();
  } catch {
    /* ignore */
  }
  return { path: target, exists, mtime };
}

module.exports = {
  codexAuthPath,
  codexAuthStatus,
  syncCodexAuthFromCloud,
};
