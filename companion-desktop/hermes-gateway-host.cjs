'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 19119;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_BASE = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1`;

/** @type {import('child_process').ChildProcess | null} */
let gatewayChild = null;
/** @type {string | null} */
let lastError = null;

function devGatewayScriptPath(companionDir) {
  const base = companionDir || path.join(__dirname);
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      const packaged = path.join(process.resourcesPath, 'hermes-bootstrap', 'dev-gateway.mjs');
      if (fs.existsSync(packaged)) return packaged;
    }
  } catch {
    /* ignore */
  }
  return path.join(base, '..', 'hermes-bootstrap', 'dev-gateway.mjs');
}

function parseGatewayUrl(raw) {
  const trimmed = String(raw || DEFAULT_BASE).trim();
  const withV1 = trimmed.replace(/\/$/, '');
  try {
    const u = new URL(withV1.endsWith('/v1') ? withV1 : `${withV1}/v1`);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : DEFAULT_PORT;
    return {
      baseUrl: `${u.origin}/v1`.replace(/\/$/, ''),
      host: u.hostname || DEFAULT_HOST,
      port,
    };
  } catch {
    return { baseUrl: DEFAULT_BASE, host: DEFAULT_HOST, port: DEFAULT_PORT };
  }
}

async function probeGateway(baseUrl, apiKey) {
  const url = String(baseUrl || DEFAULT_BASE).trim().replace(/\/$/, '');
  const key = String(apiKey || 'hermes-local').trim();
  try {
    const r = await fetch(`${url}/models`, {
      signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.ok) return { ok: true, detail: `gateway ${url}` };
    return { ok: false, detail: `http ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Try multiple API keys (official Hermes may use API_SERVER_KEY from .env). */
async function probeGatewayWithKeys(baseUrl, apiKeys) {
  const seen = new Set();
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  for (const raw of keys) {
    const key = String(raw ?? '').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const probe = await probeGateway(baseUrl, key);
    if (probe.ok) return { ...probe, apiKey: key };
  }
  return { ok: false, detail: 'gateway not reachable with configured keys' };
}

function isManagedRunning() {
  return Boolean(gatewayChild && gatewayChild.exitCode === null && !gatewayChild.killed);
}

function getState(settings) {
  const cfg = parseGatewayUrl(settings && settings.hermesGatewayUrl);
  const scriptPath = devGatewayScriptPath();
  return {
    configured: Boolean(settings && settings.hermesGatewayUrl),
    managed: Boolean(settings && settings.hermesManagedGateway),
    running: isManagedRunning(),
    scriptAvailable: fs.existsSync(scriptPath),
    scriptPath,
    gatewayUrl: cfg.baseUrl,
    apiKey: settings && settings.hermesApiKey != null ? String(settings.hermesApiKey) : 'hermes-local',
    model: settings && settings.hermesModel != null ? String(settings.hermesModel) : 'default',
    lastError,
  };
}

/**
 * @param {Record<string, unknown>} settings
 * @param {(payload: object) => void} [sendLog]
 */
async function startManagedGateway(settings, sendLog) {
  lastError = null;
  if (isManagedRunning()) {
    return { ok: true, alreadyRunning: true };
  }

  const scriptPath = devGatewayScriptPath();
  if (!fs.existsSync(scriptPath)) {
    lastError = '缺少 hermes-bootstrap/dev-gateway.mjs';
    return { ok: false, error: lastError };
  }

  const { baseUrl, host, port } = parseGatewayUrl(settings && settings.hermesGatewayUrl);
  const apiKey = String((settings && settings.hermesApiKey) || 'hermes-local').trim();
  const model = String((settings && settings.hermesModel) || 'default').trim();

  const existing = await probeGateway(baseUrl, apiKey);
  if (existing.ok) {
    return { ok: true, external: true, probe: existing };
  }

  gatewayChild = spawn(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      COMPANION_HERMES_GATEWAY_HOST: host,
      COMPANION_HERMES_GATEWAY_PORT: String(port),
      COMPANION_AGENT_HERMES_API_KEY: apiKey,
      COMPANION_AGENT_HERMES_MODEL: model,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logLine = (msg) => {
    if (typeof sendLog === 'function') sendLog({ type: 'log', msg });
  };

  gatewayChild.stdout.on('data', (b) => logLine(String(b).trim()));
  gatewayChild.stderr.on('data', (b) => logLine(String(b).trim()));
  gatewayChild.on('error', (err) => {
    lastError = err.message;
    gatewayChild = null;
    if (typeof sendLog === 'function') sendLog({ type: 'error', msg: err.message });
  });
  gatewayChild.on('close', (code) => {
    if (code !== 0 && code !== null) lastError = `Gateway 进程退出 code=${code}`;
    gatewayChild = null;
    if (typeof sendLog === 'function') sendLog({ type: 'gateway-closed', code });
  });

  return { ok: true, started: true };
}

async function waitForGatewayReady(baseUrl, apiKey, timeoutMs = 15000) {
  const url = String(baseUrl || DEFAULT_BASE).trim().replace(/\/$/, '');
  const key = String(apiKey || 'hermes-local').trim();
  const deadline = Date.now() + Math.max(2000, Number(timeoutMs) || 15000);
  let last = { ok: false, detail: 'timeout' };
  while (Date.now() < deadline) {
    last = await probeGateway(url, key);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

async function waitForGatewayReadyWithKeys(baseUrl, apiKeys, timeoutMs = 15000) {
  const url = String(baseUrl || DEFAULT_BASE).trim().replace(/\/$/, '');
  const deadline = Date.now() + Math.max(2000, Number(timeoutMs) || 15000);
  let last = { ok: false, detail: 'timeout' };
  while (Date.now() < deadline) {
    last = await probeGatewayWithKeys(url, apiKeys);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

function stopManagedGateway() {
  if (!gatewayChild) return { ok: true, wasRunning: false };
  try {
    gatewayChild.kill();
  } catch {
    /* ignore */
  }
  gatewayChild = null;
  return { ok: true, wasRunning: true };
}

module.exports = {
  DEFAULT_BASE,
  DEFAULT_PORT,
  DEFAULT_HOST,
  parseGatewayUrl,
  probeGateway,
  probeGatewayWithKeys,
  getState,
  startManagedGateway,
  waitForGatewayReady,
  waitForGatewayReadyWithKeys,
  stopManagedGateway,
  devGatewayScriptPath,
  isManagedRunning,
};
