'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { app, Tray, Menu, nativeImage, shell, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');

/** Windows：与产品路径一致，数据落在 %LOCALAPPDATA%\\AssetCutterCompanion\\desktop-shell */
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  try {
    app.setPath(
      'userData',
      path.join(process.env.LOCALAPPDATA, 'AssetCutterCompanion', 'desktop-shell'),
    );
  } catch {
    /* app 已 ready 等情况下可能失败，忽略 */
  }
}

app.setName('AssetCutterCompanion');

const DEFAULT_HTTP_PORT = 18765;

/** @type {import('child_process').ChildProcess | null} */
let companion = null;
/** @type {Tray | null} */
let tray = null;
/** @type {BrowserWindow | null} */
let wizardWindow = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string} */
let companionStatusNote = '伴侣运行中';
/** @type {string | null} */
let companionLastError = null;
/** @type {NodeJS.Timeout | null} */
let statusPollTimer = null;
/** @type {string | null} */
let lastStatusAlertKey = null;
/** @type {boolean} */
let companionAutoUpdateConfigured = false;
/** @type {boolean} */
let isQuitting = false;

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'companion-shell-settings.json');
}

function readShellSettings() {
  try {
    const p = shellSettingsPath();
    if (!fs.existsSync(p)) return { siteUrl: 'http://localhost:3000' };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const siteUrl =
      typeof j.siteUrl === 'string' && j.siteUrl.trim() ? j.siteUrl.trim() : 'http://localhost:3000';
    return { siteUrl };
  } catch {
    return { siteUrl: 'http://localhost:3000' };
  }
}

function saveShellSettings(patch) {
  const cur = readShellSettings();
  if (patch && typeof patch.siteUrl === 'string') {
    const t = patch.siteUrl.trim();
    cur.siteUrl = t || 'http://localhost:3000';
  }
  fs.mkdirSync(path.dirname(shellSettingsPath()), { recursive: true });
  fs.writeFileSync(shellSettingsPath(), `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
  return cur;
}

let lastDesktopReleaseNagKey = null;
/** @type {ReturnType<typeof setInterval> | null} */
let desktopReleaseCheckTimer = null;

function readDesktopShellPackageVersion() {
  try {
    const p = path.join(__dirname, 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return typeof j.version === 'string' && j.version.trim() ? j.version.trim() : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function semverRemoteGreater(remote, local) {
  const pa = String(remote)
    .split('.')
    .map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0);
  const pb = String(local)
    .split('.')
    .map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const a = pa[i] || 0;
    const b = pb[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function checkRemoteDesktopShellReleaseOnce() {
  const { siteUrl } = readShellSettings();
  let origin;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }
  const plat =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const api = `${origin}/api/companion-artifacts/latest?kind=desktop_shell&platform=${encodeURIComponent(
    plat,
  )}&channel=stable`;
  try {
    const r = await fetch(api, { method: 'GET', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rem = j && j.latest && j.latest.semver ? String(j.latest.semver) : '';
    if (!rem) return null;
    const loc = readDesktopShellPackageVersion();
    if (!semverRemoteGreater(rem, loc)) return null;
    return { remote: rem, local: loc };
  } catch {
    return null;
  }
}

function scheduleDesktopShellReleaseCheck() {
  const tick = async () => {
    const info = await checkRemoteDesktopShellReleaseOnce();
    if (!info) return;
    const key = `${info.remote}|${info.local}`;
    if (key === lastDesktopReleaseNagKey) return;
    lastDesktopReleaseNagKey = key;
    companionStatusNote = `网站有新版桌面壳 v${info.remote}（当前 ${info.local}）`;
    updateTrayTooltip();
    if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        iconType: 'info',
        title: 'Asset Cutter 本地伴侣',
        content: `网站已发布较新的桌面壳 v${info.remote}（当前安装 ${info.local}）。可在主站工作区左下角「下载壳」获取安装包。`,
      });
    }
  };
  void tick();
  if (desktopReleaseCheckTimer) clearInterval(desktopReleaseCheckTimer);
  desktopReleaseCheckTimer = setInterval(() => void tick(), 4 * 60 * 60 * 1000);
}

function registerCompanionProtocol() {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('assetcutter-companion', process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient('assetcutter-companion');
    }
  } catch (e) {
    console.warn('[companion-desktop] setAsDefaultProtocolClient:', e.message);
  }
}

function peekProtocolUrl(argv) {
  const a = argv || process.argv;
  return a.find((x) => typeof x === 'string' && /^assetcutter-companion:/i.test(x));
}

function companionApiRequest(method, pathname, body) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(pathname || '');
  if (!p.startsWith('/v1/')) {
    return Promise.resolve({ ok: false, error: 'path_not_allowed' });
  }
  const port = readHttpPort();
  const token = readSharedToken();
  const bodyStr = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (bodyStr && m !== 'GET' && m !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: p,
        method: m,
        timeout: 15000,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* 非 JSON */
          }
          const ok = typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, status: res.statusCode, json, text });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    if (bodyStr && m !== 'GET' && m !== 'HEAD') req.write(bodyStr);
    req.end();
  });
}

function readHttpPort() {
  const raw = process.env.COMPANION_HTTP_PORT?.trim();
  if (!raw) return DEFAULT_HTTP_PORT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_HTTP_PORT;
  return n;
}

function localCompanionDir() {
  return path.resolve(__dirname, '..', 'local-companion');
}

function wizardCompletePath() {
  return path.join(app.getPath('userData'), 'first-run-complete');
}

function pairingConfigPath() {
  return path.join(app.getPath('userData'), 'pairing-config.json');
}

function readPairingConfig() {
  try {
    const p = pairingConfigPath();
    if (!fs.existsSync(p)) return { sharedToken: '', allowedOrigins: '' };
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      sharedToken: typeof parsed.sharedToken === 'string' ? parsed.sharedToken : '',
      allowedOrigins: typeof parsed.allowedOrigins === 'string' ? parsed.allowedOrigins : '',
    };
  } catch {
    return { sharedToken: '', allowedOrigins: '' };
  }
}

function savePairingConfig(nextCfg) {
  const sharedToken = typeof nextCfg?.sharedToken === 'string' ? nextCfg.sharedToken.trim() : '';
  const allowedOriginsRaw = typeof nextCfg?.allowedOrigins === 'string' ? nextCfg.allowedOrigins : '';
  if (sharedToken && sharedToken.length < 8) {
    throw new Error('配对 Token 过短，至少 8 位');
  }
  const origins = allowedOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueOrigins = [...new Set(origins)];
  const badOrigin = uniqueOrigins.find((o) => !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(o) && !/\*$/.test(o));
  if (badOrigin) {
    throw new Error(`Origin 格式非法: ${badOrigin}`);
  }
  const allowedOrigins = uniqueOrigins.join(',');
  const payload = { sharedToken, allowedOrigins, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(pairingConfigPath()), { recursive: true });
  fs.writeFileSync(pairingConfigPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { sharedToken, allowedOrigins };
}

function hasCompletedWizard() {
  try {
    return fs.existsSync(wizardCompletePath());
  } catch {
    return false;
  }
}

function markWizardCompleted() {
  try {
    fs.mkdirSync(path.dirname(wizardCompletePath()), { recursive: true });
    fs.writeFileSync(wizardCompletePath(), `${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    console.error('[companion-desktop] 无法写入向导完成标记:', err.message);
  }
}

function shouldShowFirstRunWizard() {
  if (process.env.COMPANION_DESKTOP_SKIP_WIZARD === '1') return false;
  if (process.env.COMPANION_DESKTOP_FORCE_WIZARD === '1') return true;
  if (process.platform !== 'win32') return false;
  return !hasCompletedWizard();
}

function createTrayIcon() {
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return nativeImage.createFromBuffer(Buffer.from(png1x1, 'base64'));
}

function updateTrayTooltip() {
  if (!tray || tray.isDestroyed()) return;
  const suffix = companionLastError ? `（异常：${companionLastError}）` : `（${companionStatusNote}）`;
  tray.setToolTip(`Asset Cutter 本地伴侣${suffix}`);
}

function readSharedToken() {
  const envTok = process.env.COMPANION_SHARED_TOKEN?.trim();
  if (envTok) return envTok;
  /** 与启动子进程一致：向导写入的 pairing-config 需参与本机 HTTP 客户端鉴权，否则 /v1/capabilities 等会 401 */
  try {
    const p = readPairingConfig().sharedToken?.trim();
    return p || null;
  } catch {
    return null;
  }
}

function restartLocalCompanionFromTray() {
  stopLocalCompanion();
  startLocalCompanion();
}

function notifyCompanionFailure(message) {
  if (!tray || tray.isDestroyed()) return;
  if (process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'warning',
      title: '本地伴侣异常',
      content: `${message}。可在托盘菜单执行「重新启动本地伴侣」或打开「桌面窗口 / 浏览器管理页」排查。`,
    });
  }
}

function notifyStatusIssue(title, message, dedupeKey) {
  if (dedupeKey && lastStatusAlertKey === dedupeKey) return;
  if (dedupeKey) lastStatusAlertKey = dedupeKey;
  if (!tray || tray.isDestroyed()) return;
  if (process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'warning',
      title,
      content: `${message}。可在托盘菜单执行「重新启动本地伴侣」或打开「桌面窗口 / 浏览器管理页」排查。`,
    });
  }
}

function fetchRuntimeStatus() {
  const port = readHttpPort();
  const token = readSharedToken();
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/runtime-status',
        method: 'GET',
        timeout: 3500,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          const statusCode = typeof res.statusCode === 'number' ? res.statusCode : 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const body = JSON.parse(bodyText);
              resolve(body);
            } catch {
              reject(new Error('runtime_status_invalid_json'));
            }
            return;
          }
          if (statusCode === 401) {
            reject(new Error('runtime_status_unauthorized'));
            return;
          }
          reject(new Error(`runtime_status_http_${statusCode}`));
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('runtime_status_timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

function probeCompanionHealth() {
  const port = readHttpPort();
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/health',
        method: 'GET',
        timeout: 1200,
      },
      (res) => {
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
        res.resume();
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function pollCompanionStatus() {
  if (!companion || companion.killed) return;
  try {
    const status = await fetchRuntimeStatus();
    const relay = status && typeof status === 'object' ? status.relay : null;
    const siteAuth = status && typeof status === 'object' ? status.siteAuth : null;
    const siteAuthState =
      siteAuth && typeof siteAuth === 'object' && typeof siteAuth.state === 'string' ? siteAuth.state : null;
    const siteAuthDetail =
      siteAuth && typeof siteAuth === 'object' && typeof siteAuth.detail === 'string' ? siteAuth.detail : '';
    const siteAuthNextAction =
      siteAuth && typeof siteAuth === 'object' && typeof siteAuth.nextAction === 'string' ? siteAuth.nextAction : '';
    const relayConfigured = Boolean(relay && relay.configured);
    const relayRunning = Boolean(relay && relay.running);
    if (siteAuthState === 'not_logged_in') {
      companionStatusNote = '站点登录态异常';
      companionLastError = siteAuthDetail || 'site_not_logged_in';
      updateTrayTooltip();
      rebuildTrayMenu();
      notifyStatusIssue(
        '本地伴侣提醒',
        `检测到站点登录态异常：${siteAuthDetail || '请重新登录'}；${siteAuthNextAction || '请在网站端重新登录后重试'}`,
        `site_auth_not_logged_in_${siteAuthDetail || 'default'}`,
      );
      return;
    }
    if (relayConfigured && !relayRunning) {
      const relayLastError =
        relay && typeof relay === 'object' && typeof relay.lastError === 'string' ? relay.lastError : null;
      const relayLastExitCode =
        relay && typeof relay === 'object' && typeof relay.lastExitCode === 'number'
          ? relay.lastExitCode
          : null;
      const relayLastSignal =
        relay && typeof relay === 'object' && typeof relay.lastSignal === 'string' ? relay.lastSignal : null;
      const detailParts = [];
      if (relayLastError) detailParts.push(`error=${relayLastError}`);
      if (relayLastExitCode != null) detailParts.push(`exit=${relayLastExitCode}`);
      if (relayLastSignal) detailParts.push(`signal=${relayLastSignal}`);
      const detail = detailParts.length ? ` (${detailParts.join(', ')})` : '';
      companionStatusNote = 'Relay 子进程未运行';
      companionLastError = `relay_not_running${detail}`;
      updateTrayTooltip();
      rebuildTrayMenu();
      notifyStatusIssue('本地伴侣提醒', `已配置 Relay，但当前未运行${detail}`, `relay_not_running${detail}`);
      return;
    }
    companionStatusNote = '伴侣运行中';
    companionLastError = null;
    lastStatusAlertKey = null;
    updateTrayTooltip();
    rebuildTrayMenu();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'runtime_status_unauthorized') {
      companionStatusNote = '状态检查需配对 Token';
      companionLastError = 'status_needs_token';
      updateTrayTooltip();
      rebuildTrayMenu();
      notifyStatusIssue('本地伴侣提醒', '配对验证失败，请在「首次设置向导」或网站设置中检查本机通信密码是否一致', 'status_needs_token');
      return;
    }
    companionStatusNote = '状态检查失败';
    companionLastError = msg;
    updateTrayTooltip();
    rebuildTrayMenu();
    notifyStatusIssue('本地伴侣提醒', `状态检查失败（${msg}）`, `status_failed_${msg}`);
  }
}

function startStatusPolling() {
  if (statusPollTimer) return;
  void pollCompanionStatus();
  statusPollTimer = setInterval(() => {
    void pollCompanionStatus();
  }, 12000);
}

function stopStatusPolling() {
  if (!statusPollTimer) return;
  clearInterval(statusPollTimer);
  statusPollTimer = null;
}

async function startLocalCompanion() {
  const hasExistingCompanion = await probeCompanionHealth();
  if (hasExistingCompanion) {
    companionStatusNote = '已连接到现有本地伴侣';
    companionLastError = null;
    updateTrayTooltip();
    rebuildTrayMenu();
    return;
  }

  const companionRoot = localCompanionDir();
  const nodeBin = process.env.COMPANION_NODE?.trim() || 'node';
  const mainTs = path.join(companionRoot, 'src', 'main.ts');
  const args = ['--import', 'tsx', mainTs];

  const env = {
    ...process.env,
    COMPANION_OPEN_BROWSER: '0',
  };
  const pair = readPairingConfig();
  if (!env.COMPANION_SHARED_TOKEN && pair.sharedToken) {
    env.COMPANION_SHARED_TOKEN = pair.sharedToken;
  }
  if (!env.COMPANION_ALLOWED_ORIGINS && pair.allowedOrigins) {
    env.COMPANION_ALLOWED_ORIGINS = pair.allowedOrigins;
  }

  const stdio = process.stdout?.isTTY ? 'inherit' : 'ignore';

  companion = spawn(nodeBin, args, {
    cwd: companionRoot,
    env,
    stdio,
    windowsHide: false,
  });
  companionStatusNote = '伴侣运行中';
  companionLastError = null;
  lastStatusAlertKey = null;
  updateTrayTooltip();

  companion.on('error', async (err) => {
    const hasExternalCompanion = await probeCompanionHealth();
    if (hasExternalCompanion) {
      companionStatusNote = '已连接到现有本地伴侣';
      companionLastError = null;
      updateTrayTooltip();
      rebuildTrayMenu();
      companion = null;
      return;
    }
    console.error('[companion-desktop] 无法启动 local-companion:', err.message);
    companionStatusNote = '伴侣异常';
    companionLastError = `启动失败: ${err.message}`;
    updateTrayTooltip();
    rebuildTrayMenu();
    notifyCompanionFailure(companionLastError);
  });

  companion.on('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') {
      companionStatusNote = '伴侣已停止';
      companionLastError = null;
    } else {
      companionStatusNote = '伴侣异常退出';
      companionLastError = `退出码=${code ?? 'null'} 信号=${signal ?? 'null'}`;
      notifyCompanionFailure(companionLastError);
    }
    updateTrayTooltip();
    rebuildTrayMenu();
    companion = null;
  });
}

function stopLocalCompanion() {
  if (!companion || companion.killed) return;
  try {
    companion.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  companion = null;
}

function openConsole() {
  const port = readHttpPort();
  const url = `http://127.0.0.1:${port}/`;
  void shell.openExternal(url);
}

function companionConsoleUrl() {
  const port = readHttpPort();
  return `http://127.0.0.1:${port}/`;
}

function buildTrayMenu() {
  const template = [
    {
      label: companionLastError ? `状态：异常（${companionLastError}）` : `状态：${companionStatusNote}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '打开桌面窗口',
      click: () => openMainWindow(),
    },
    {
      label: '在浏览器打开本机管理页',
      click: () => openConsole(),
    },
    {
      label: '重新启动本地伴侣',
      click: () => restartLocalCompanionFromTray(),
    },
  ];

  if (process.platform === 'win32') {
    template.push({
      label: '首次设置向导',
      click: () => openFirstRunWizard(),
    });
  }

  const updateFeed = process.env.COMPANION_UPDATE_FEED_URL?.trim();
  if (updateFeed) {
    template.push({
      label: '检查更新…',
      click: async () => {
        try {
          const { autoUpdater } = require('electron-updater');
          await autoUpdater.checkForUpdates();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          void dialog.showErrorBox('检查更新失败', msg);
        }
      },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  );

  return Menu.buildFromTemplate(template);
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function openFirstRunWizard() {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.focus();
    return;
  }

  const wizardTitle = hasCompletedWizard()
    ? '本地伴侣 — 说明与设置'
    : '本地伴侣 — 首次设置';

  wizardWindow = new BrowserWindow({
    width: 520,
    height: 480,
    resizable: false,
    maximizable: false,
    minimizable: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#141414',
    title: wizardTitle,
    webPreferences: {
      preload: path.join(__dirname, 'preload-wizard.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  wizardWindow.on('closed', () => {
    wizardWindow = null;
  });

  void wizardWindow.loadFile(path.join(__dirname, 'wizard', 'index.html'));
  wizardWindow.once('ready-to-show', () => {
    wizardWindow?.show();
  });
}

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 400,
    height: 560,
    minWidth: 360,
    minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c0e',
    title: 'Asset Cutter 本地伴侣',
    webPreferences: {
      preload: path.join(__dirname, 'preload-shell.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const shellHtml = path.join(__dirname, 'shell', 'index.html');
  void mainWindow.loadFile(shellHtml);
}

function setupOptionalAutoUpdate() {
  const feed = process.env.COMPANION_UPDATE_FEED_URL?.trim();
  if (!feed || companionAutoUpdateConfigured) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.error('[companion-desktop] electron-updater 未安装:', e.message);
    return;
  }
  companionAutoUpdateConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  autoUpdater.on('update-not-available', () => {
    if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
      tray.displayBalloon({ title: '软件更新', content: '当前已是最新版本。' });
    }
  });
  autoUpdater.on('update-available', (info) => {
    const ver = info && typeof info.version === 'string' ? info.version : '新版本';
    void dialog
      .showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `可更新至 ${ver}`,
        detail: '是否下载更新？下载完成后可在退出应用时安装。',
        buttons: ['稍后', '下载更新'],
        defaultId: 1,
        cancelId: 0,
      })
      .then((r) => {
        if (r.response === 1) void autoUpdater.downloadUpdate();
      });
  });
  autoUpdater.on('update-downloaded', () => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: '更新已就绪',
        message: '更新已下载完成。',
        detail: '需要退出应用后完成安装。是否现在退出并安装？',
        buttons: ['稍后', '退出并安装'],
        defaultId: 1,
        cancelId: 0,
      })
      .then((r) => {
        if (r.response === 1) autoUpdater.quitAndInstall(false, true);
      });
  });
  autoUpdater.on('error', (err) => {
    console.error('[companion-desktop][updater]', err);
  });
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => console.error('[companion-desktop][updater] check', e));
  }, 20000);
}

function buildTray() {
  tray = new Tray(createTrayIcon());
  updateTrayTooltip();

  /** Windows：左键单击打开桌面壳主窗口（右键仍为菜单）。 */
  if (process.platform === 'win32') {
    tray.on('click', () => {
      openMainWindow();
    });
  }

  rebuildTrayMenu();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  ipcMain.on('wizard-open-console', () => {
    openConsole();
  });

  ipcMain.on('wizard-complete', () => {
    markWizardCompleted();
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.close();
    }
    openMainWindow();
  });

  ipcMain.handle('shell-tray-summary', async () => {
    const port = readHttpPort();
    const alive = await probeCompanionHealth();
    return {
      connected: alive,
      port,
      note: companionStatusNote,
      lastError: companionLastError,
    };
  });

  ipcMain.handle('shell-settings-load', () => readShellSettings());

  ipcMain.handle('shell-settings-save', (_e, patch) => {
    try {
      return { ok: true, data: saveShellSettings(patch) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-open-website', async (_e, url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'invalid_url' };
    await shell.openExternal(u);
    return { ok: true };
  });

  ipcMain.handle('shell-open-management', () => {
    openConsole();
    return { ok: true };
  });

  ipcMain.handle('shell-open-wizard', () => {
    openFirstRunWizard();
    return { ok: true };
  });

  ipcMain.handle('companion-api', async (_e, method, pathname, body) => {
    try {
      return await companionApiRequest(method, pathname, body);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('wizard-load-pairing', () => {
    return readPairingConfig();
  });

  ipcMain.handle('wizard-save-pairing', (_event, payload) => {
    try {
      return { ok: true, data: savePairingConfig(payload) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.on('second-instance', (_event, commandLine) => {
    void commandLine;
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.focus();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    openMainWindow();
  });

  app.whenReady().then(() => {
    registerCompanionProtocol();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    void startLocalCompanion();
    buildTray();
    startStatusPolling();
    setupOptionalAutoUpdate();
    setTimeout(() => {
      try {
        scheduleDesktopShellReleaseCheck();
      } catch (e) {
        console.warn('[companion-desktop] desktop release check:', e instanceof Error ? e.message : e);
      }
    }, 45000);
    if (shouldShowFirstRunWizard()) {
      openFirstRunWizard();
    } else if (process.env.COMPANION_DESKTOP_NO_AUTO_SHELL !== '1') {
      const delayMs = peekProtocolUrl() ? 400 : 900;
      setTimeout(() => openMainWindow(), delayMs);
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url && /^assetcutter-companion:/i.test(url)) {
      openMainWindow();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (desktopReleaseCheckTimer) {
      clearInterval(desktopReleaseCheckTimer);
      desktopReleaseCheckTimer = null;
    }
    stopStatusPolling();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
      mainWindow = null;
    }
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.destroy();
      wizardWindow = null;
    }
    stopLocalCompanion();
  });
}
