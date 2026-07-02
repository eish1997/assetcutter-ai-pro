'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const hermesGatewayHost = require('./hermes-gateway-host.cjs');
const { findHermesCli, hermesEnvPath, readHermesEnvValue } = require('./hermes-cli-resolve.cjs');

const DEFAULT_API_PORT = 8642;
const DEFAULT_API_HOST = '127.0.0.1';
const DEFAULT_OFFICIAL_BASE = `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}/v1`;

/** @type {string | null} */
let lastError = null;

function hermesRuntimeStatePath(userRoot) {
  return path.join(userRoot, 'state.json');
}

function readHermesRuntimeState(userRoot) {
  const p = hermesRuntimeStatePath(userRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function findHermesCliFromState(userRoot) {
  const st = readHermesRuntimeState(userRoot);
  if (st && st.hermesCli && fs.existsSync(st.hermesCli)) return String(st.hermesCli);
  return '';
}

function loadHermesEnvFile() {
  const envPath = hermesEnvPath();
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function mergeHermesEnv(hermesEnv) {
  return { ...process.env, ...hermesEnv };
}

function runHermesCli(cli, args, hermesEnv, timeoutMs = 90000) {
  return spawnSync(cli, args, {
    encoding: 'utf8',
    env: mergeHermesEnv(hermesEnv),
    cwd: os.homedir(),
    windowsHide: true,
    timeout: timeoutMs,
  });
}

/** @param {string} stdout @param {string} stderr */
function parseGatewayStatusOutput(stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`.trim();
  const running = /gateway process running/i.test(text) || /running \(PID:\s*\d+\)/i.test(text);
  const pidMatch = text.match(/PID:\s*(\d+)/i);
  return { running, pid: pidMatch ? Number(pidMatch[1]) : null, text };
}

function collectProbeApiKeys(cfg, userRoot) {
  const st = userRoot ? readHermesRuntimeState(userRoot) : null;
  return [
    ...new Set(
      [cfg.apiKey, st && st.apiKey, readHermesEnvValue('API_SERVER_KEY')]
        .map((k) => String(k || '').trim())
        .filter(Boolean),
    ),
  ];
}

function isOfficialRunning() {
  const cli = findHermesCli();
  if (!cli) return false;
  const r = runHermesCli(cli, ['gateway', 'status'], loadHermesEnvFile(), 15000);
  return parseGatewayStatusOutput(r.stdout, r.stderr).running;
}

function resolveGatewayConfig(settings, userRoot) {
  const st = userRoot ? readHermesRuntimeState(userRoot) : null;
  const fromSettings = hermesGatewayHost.parseGatewayUrl(settings && settings.hermesGatewayUrl);
  const fromState = st && st.gatewayUrl ? hermesGatewayHost.parseGatewayUrl(st.gatewayUrl) : null;
  const useOfficial = settings && settings.hermesGatewayKind !== 'dev';
  const baseUrl = useOfficial
    ? (fromState && fromState.baseUrl) || DEFAULT_OFFICIAL_BASE
    : fromSettings.baseUrl;
  const apiKey =
    (settings && settings.hermesApiKey) ||
    (st && st.apiKey) ||
    readHermesEnvValue('API_SERVER_KEY') ||
    (useOfficial ? '' : 'hermes-local');
  return { baseUrl, apiKey: String(apiKey || '').trim(), kind: useOfficial ? 'official' : 'dev' };
}

function getState(settings, userRoot) {
  const cfg = resolveGatewayConfig(settings, userRoot);
  const st = userRoot ? readHermesRuntimeState(userRoot) : null;
  const cli = (st && st.hermesCli) || findHermesCliFromState(userRoot) || findHermesCli();
  return {
    kind: cfg.kind,
    configured: Boolean(settings && settings.hermesGatewayUrl) || Boolean(st),
    managed: Boolean(settings && settings.hermesManagedGateway),
    running: isOfficialRunning(),
    installed: Boolean(st && st.hermesCli) || Boolean(cli),
    hermesCli: cli || null,
    gatewayUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || '<unset>',
    bootstrapScript: path.join(__dirname, 'hermes-bootstrap', 'hermes-bootstrap.cjs'),
    lastError,
    runtimeState: st,
  };
}

async function startOfficialGateway(settings, userRoot, sendLog) {
  lastError = null;
  const logLine = (msg) => {
    if (typeof sendLog === 'function') sendLog({ type: 'log', msg });
  };

  const cfg = resolveGatewayConfig(settings, userRoot);
  const apiKeys = collectProbeApiKeys(cfg, userRoot);

  let probe = await hermesGatewayHost.probeGatewayWithKeys(cfg.baseUrl, apiKeys);
  if (probe.ok) {
    return { ok: true, external: true, probe, apiKey: probe.apiKey };
  }

  const cli = findHermesCliFromState(userRoot) || findHermesCli();
  if (!cli) {
    lastError = 'Hermes 未安装，请先运行「安装 Hermes 官方版」';
    return { ok: false, error: lastError, needsBootstrap: true };
  }

  const hermesEnv = loadHermesEnvFile();
  const statusResult = runHermesCli(cli, ['gateway', 'status'], hermesEnv);
  const status = parseGatewayStatusOutput(statusResult.stdout, statusResult.stderr);

  if (status.running) {
    logLine('检测到 Hermes Gateway 已在运行，正在重启以加载 API Server 配置…');
    const rr = runHermesCli(cli, ['gateway', 'restart'], hermesEnv);
    const restartOut = `${rr.stdout || ''}\n${rr.stderr || ''}`.trim();
    if (restartOut) logLine(restartOut);
    if (rr.error) {
      lastError = rr.error.message;
      return { ok: false, error: lastError };
    }
    probe = await hermesGatewayHost.waitForGatewayReadyWithKeys(cfg.baseUrl, apiKeys, 120000);
    if (probe.ok) {
      return { ok: true, external: true, restarted: true, probe, apiKey: probe.apiKey };
    }
    lastError = probe.detail || 'Gateway 重启后 API Server 仍未就绪';
    return {
      ok: false,
      error: `${lastError}（可手动运行 hermes gateway restart，并用 hermes model 配置模型）`,
    };
  }

  logLine('正在启动 Hermes Gateway 服务…');
  const sr = runHermesCli(cli, ['gateway', 'start'], hermesEnv);
  const startOut = `${sr.stdout || ''}\n${sr.stderr || ''}`.trim();
  if (startOut) logLine(startOut);
  if (sr.error) {
    lastError = sr.error.message;
    return { ok: false, error: lastError };
  }

  probe = await hermesGatewayHost.waitForGatewayReadyWithKeys(cfg.baseUrl, apiKeys, 120000);
  if (probe.ok) {
    return { ok: true, started: true, probe, apiKey: probe.apiKey, hermesCli: cli };
  }
  lastError = probe.detail || 'Hermes Gateway 未就绪';
  return {
    ok: false,
    error: `${lastError}（可运行 hermes gateway start / hermes model 配置模型）`,
  };
}

async function waitForOfficialReady(baseUrl, apiKey, timeoutMs = 120000, apiKeys) {
  const keys = Array.isArray(apiKeys) && apiKeys.length ? apiKeys : [apiKey];
  return hermesGatewayHost.waitForGatewayReadyWithKeys(baseUrl, keys, timeoutMs);
}

function stopOfficialGateway() {
  // 官方 Gateway 由系统计划任务/systemd 托管，伴侣不持有子进程，也不应 stop 用户服务。
  return { ok: true, wasRunning: false };
}

async function startManagedGateway(settings, userRoot, sendLog) {
  const kind = settings && settings.hermesGatewayKind === 'dev' ? 'dev' : 'official';
  if (kind === 'dev') {
    stopOfficialGateway();
    return hermesGatewayHost.startManagedGateway(settings, sendLog);
  }
  hermesGatewayHost.stopManagedGateway();
  return startOfficialGateway(settings, userRoot, sendLog);
}

function stopManagedGateway() {
  stopOfficialGateway();
  return hermesGatewayHost.stopManagedGateway();
}

module.exports = {
  DEFAULT_OFFICIAL_BASE,
  DEFAULT_API_PORT,
  readHermesRuntimeState,
  findHermesCli,
  getState,
  startOfficialGateway,
  startManagedGateway,
  stopOfficialGateway,
  stopManagedGateway,
  waitForOfficialReady,
  isOfficialRunning,
  resolveGatewayConfig,
  parseGatewayStatusOutput,
  collectProbeApiKeys,
};
