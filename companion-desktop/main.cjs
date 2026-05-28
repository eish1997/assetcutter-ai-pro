'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const http = require('http');
const {
  app,
  Tray,
  Menu,
  nativeImage,
  shell,
  BrowserWindow,
  BrowserView,
  ipcMain,
  dialog,
} = require('electron');
const { spawn, execSync } = require('child_process');
const { randomBytes } = require('node:crypto');
const companionSandboxPaths = require('./companion-sandbox-paths.cjs');
const { createCompanionAutoUpdate } = require('./companion-auto-update.cjs');

/** 打包壳无控制台时 stdout/stderr 可能 EPIPE；避免 uncaughtException 弹窗 */
function ignoreStreamEpipe(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
  });
}
ignoreStreamEpipe(process.stdout);
ignoreStreamEpipe(process.stderr);

function companionLog(level, ...args) {
  try {
    if (level === 'warn') console.warn(...args);
    else console.log(...args);
  } catch (e) {
    if (!(e && e.code === 'EPIPE')) throw e;
  }
}

/** Windows：统一沙盒；首次启动将旧版 `desktop-shell` / `runtimes` 迁入沙盒后再设 userData */
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  try {
    companionSandboxPaths.migrateLegacyAssetCutterLayout();
    const shellData = companionSandboxPaths.getDesktopShellUserDataPath();
    if (shellData) {
      app.setPath('userData', shellData);
    } else {
      app.setPath(
        'userData',
        path.join(process.env.LOCALAPPDATA, 'AssetCutterCompanion', 'desktop-shell'),
      );
    }
  } catch {
    /* app 已 ready 等情况下可能失败，忽略 */
  }
}

app.setName('AssetCutterCompanion');

/**
 * 部分网络（企业网关 / 地区出口）对 HTTP/3 QUIC 的 UDP 443 会直接 RST，Electron 工作台 loadURL 表现为 ERR_CONNECTION_RESET(-101)；
 * 禁用 QUIC 后退化到基于 TCP 的 HTTP/2，与多数系统浏览器在「仅 TCP 放行」环境下的行为更一致。
 */
try {
  app.commandLine.appendSwitch('disable-quic');
} catch {
  /* ignore */
}

const DEFAULT_HTTP_PORT = 18765;

/** 开发：`npm start`；安装包：未保存过主站时的「打开网站」默认 */
const DEFAULT_SHELL_SITE_DEV = 'http://localhost:3000';
const DEFAULT_SHELL_SITE_PACKAGED = 'https://assetcutter-ai-pro.vercel.app/';

function defaultShellSiteUrl() {
  try {
    return app.isPackaged ? DEFAULT_SHELL_SITE_PACKAGED : DEFAULT_SHELL_SITE_DEV;
  } catch {
    return DEFAULT_SHELL_SITE_DEV;
  }
}

/** @type {import('child_process').ChildProcess | null} */
let companion = null;
/** @type {Tray | null} */
let tray = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('electron').BrowserView | null} */
let workbenchBrowserView = null;
/** 避免给同一 BrowserView 重复注册 `did-finish-load` */
const workbenchPairingInjectHooked = new WeakSet();
/** 避免给同一 BrowserView 重复注册下载接管 */
const workbenchDownloadHooked = new WeakSet();
/** @type {'home' | 'workbench' | 'settings'} */
let shellMainProcessActiveView = 'home';

/** 与 `shell/index.html` 侧栏展开宽度一致；收起时为 0（由渲染进程 IPC 同步） */
const SHELL_SIDEBAR_WIDTH_EXPANDED = 56;
/** @type {number} */
let shellWorkbenchSidebarInsetPx = SHELL_SIDEBAR_WIDTH_EXPANDED;
const SHELL_TITLEBAR_HEIGHT = 30;
/** 与 `shell/index.html` 一致：工作台顶栏已移除，BrowserView 从标题栏下缘起算 */
const SHELL_WORKBENCH_TOOLBAR_HEIGHT = 0;
/** @type {string} */
let companionStatusNote = '伴侣运行中';
/** @type {string | null} */
let companionLastError = null;
/** 最近一次 runtime-status.localCapabilityUi（供托盘 / shell 一条主结论） */
let companionTrayCapabilityUi = null;
/** @type {NodeJS.Timeout | null} */
let statusPollTimer = null;
/** @type {string | null} */
let lastStatusAlertKey = null;
/** @type {boolean} */
let isQuitting = false;

function broadcastShellUpdaterState(state) {
  const payload = state && typeof state === 'object' ? state : { phase: 'idle', version: null, percent: 0 };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('shell-updater-state', payload);
    } catch {
      /* ignore */
    }
  }
}

const companionUpdater = createCompanionAutoUpdate({
  app,
  dialog,
  readShellSettings,
  rebuildTrayMenu,
  updateTrayTooltip,
  setCompanionStatusNote: (note) => {
    companionStatusNote = note;
  },
  displayTrayBalloon,
  onUpdaterUiChange: broadcastShellUpdaterState,
});
/** @type {import('child_process').ChildProcess | null} */
let samBootstrapChild = null;
/** @type {import('child_process').ChildProcess | null} */
let rembgBootstrapChild = null;

function anyDesktopBootstrapChildRunning() {
  const sam = samBootstrapChild && samBootstrapChild.exitCode === null && !samBootstrapChild.killed;
  const rem = rembgBootstrapChild && rembgBootstrapChild.exitCode === null && !rembgBootstrapChild.killed;
  return Boolean(sam || rem);
}

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'companion-shell-settings.json');
}

function readShellSettings() {
  const fallbackSite = defaultShellSiteUrl();
  try {
    const p = shellSettingsPath();
    if (!fs.existsSync(p)) {
      return { siteUrl: fallbackSite, authApiOrigin: '', volumeRoot: '', downloadDir: '' };
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const siteUrl =
      typeof j.siteUrl === 'string' && j.siteUrl.trim() ? j.siteUrl.trim() : fallbackSite;
    const authApiOrigin =
      typeof j.authApiOrigin === 'string' ? j.authApiOrigin.trim().replace(/\/+$/, '') : '';
    const volumeRoot = typeof j.volumeRoot === 'string' ? j.volumeRoot.trim() : '';
    const downloadDir = typeof j.downloadDir === 'string' ? j.downloadDir.trim() : '';
    return { siteUrl, authApiOrigin, volumeRoot, downloadDir };
  } catch {
    return { siteUrl: fallbackSite, authApiOrigin: '', volumeRoot: '', downloadDir: '' };
  }
}

function saveShellSettings(patch) {
  const cur = readShellSettings();
  if (patch && typeof patch.siteUrl === 'string') {
    const t = patch.siteUrl.trim();
    cur.siteUrl = t || defaultShellSiteUrl();
  }
  if (patch && typeof patch.volumeRoot === 'string') {
    let v = patch.volumeRoot.trim();
    if (v) {
      try {
        v = path.normalize(v);
      } catch {
        /* ignore */
      }
    }
    cur.volumeRoot = v;
  }
  if (patch && typeof patch.downloadDir === 'string') {
    let d = patch.downloadDir.trim();
    if (d) {
      try {
        d = path.resolve(path.normalize(d));
      } catch {
        /* ignore */
      }
    }
    cur.downloadDir = d;
    workbenchDownloadDirPromptState = 'pending';
  }
  fs.mkdirSync(path.dirname(shellSettingsPath()), { recursive: true });
  fs.writeFileSync(shellSettingsPath(), `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
  return cur;
}

/** 创建沙盒子目录（幂等）；与 `companion-sandbox-paths.cjs` 布局一致 */
function ensureCompanionSandboxLayout() {
  if (process.platform !== 'win32') return;
  const root = companionSandboxPaths.getCompanionSandboxRoot();
  if (!root) return;
  const dirs = [
    path.join(root, 'runtimes'),
    path.join(root, 'models', 'rembg'),
    path.join(root, 'cache', 'pip'),
    path.join(root, 'cache', 'torch'),
    path.join(root, 'cache', 'huggingface'),
    path.join(root, 'volume'),
  ];
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

/** 将设置中的卷根写入子进程环境；留空则移除变量，使 local-companion 使用默认（沙盒下为 sandbox/volume） */
function applyShellVolumeRootToEnv(env) {
  const sh = readShellSettings();
  if (sh.volumeRoot) {
    env.COMPANION_VOLUME_ROOT = sh.volumeRoot;
  } else {
    delete env.COMPANION_VOLUME_ROOT;
  }
}

/** 安装包内置的 SamLocal 源码树（extraResources/sam-local-bundled） */
function bundledSamLocalBundledPath() {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'sam-local-bundled');
    }
  } catch {
    /* ignore */
  }
  return path.join(__dirname, 'sam-local-bundled');
}

function samLocalBootstrapScriptPath() {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'sam-local-bootstrap', 'sam-local-bootstrap.cjs');
    }
  } catch {
    /* ignore */
  }
  return path.join(__dirname, 'sam-local-bootstrap', 'sam-local-bootstrap.cjs');
}

function readSamLocalDesktopRuntimeState() {
  if (process.platform !== 'win32') return null;
  try {
    const p = path.join(app.getPath('userData'), 'sam-local-runtime', 'state.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || !j.ready || typeof j.startScript !== 'string' || !j.startScript.trim()) return null;
    return j;
  } catch {
    return null;
  }
}

/** 若用户未手动设置 COMPANION_SPAWN_SAM_LOCAL_*，则使用本应用一键安装的 SamLocal 启动脚本 */
function applyDesktopSamLocalSpawnEnv(env) {
  if (process.platform !== 'win32') return;
  if (String(env.COMPANION_SPAWN_SAM_LOCAL_CMD || '').trim()) return;
  const st = readSamLocalDesktopRuntimeState();
  if (!st) return;
  env.COMPANION_SPAWN_SAM_LOCAL_CMD = st.startScript.trim();
  const cwd =
    typeof st.startCwd === 'string' && st.startCwd.trim()
      ? st.startCwd.trim()
      : path.dirname(st.startScript.trim());
  env.COMPANION_SPAWN_SAM_LOCAL_CWD = cwd;
}

function rembgBootstrapScriptPath() {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'rembg-bootstrap', 'rembg-bootstrap.cjs');
    }
  } catch {
    /* ignore */
  }
  return path.join(__dirname, 'rembg-bootstrap', 'rembg-bootstrap.cjs');
}

function readRembgDesktopRuntimeState() {
  if (process.platform !== 'win32') return null;
  try {
    const p = path.join(app.getPath('userData'), 'rembg-runtime', 'state.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const exe = typeof j.pythonExe === 'string' ? j.pythonExe.trim() : '';
    if (!j || !j.ready || !exe || !fs.existsSync(exe)) return null;
    return j;
  } catch {
    return null;
  }
}

function readSamLocalRembgPythonExe() {
  if (process.platform !== 'win32') return '';
  try {
    const p = path.join(app.getPath('userData'), 'sam-local-runtime', 'rembg-python.json');
    if (!fs.existsSync(p)) return '';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const exe = typeof j.pythonExe === 'string' ? j.pythonExe.trim() : '';
    return exe && fs.existsSync(exe) ? exe : '';
  } catch {
    return '';
  }
}

function resolveDesktopRembgPythonExe() {
  if (process.platform !== 'win32') return '';
  const st = readRembgDesktopRuntimeState();
  if (st?.pythonExe && fs.existsSync(st.pythonExe)) return st.pythonExe;
  return readSamLocalRembgPythonExe();
}

/** 未手动设置 COMPANION_REMBG_PYTHON 时：注入桌面一键安装的 Python（与 SamLocal 共享运行时目录） */
function applyDesktopRembgPythonToEnv(env) {
  if (String(env.COMPANION_REMBG_PYTHON || '').trim()) return;
  const exe = resolveDesktopRembgPythonExe();
  if (exe) env.COMPANION_REMBG_PYTHON = exe;
}

/** 与 local-companion `repositoryVolume.ts` 默认一致（非沙盒或未设置 LOCALAPPDATA 时） */
function getDefaultCompanionVolumeRoot() {
  const sb = companionSandboxPaths.sandboxDefaultVolumeDir();
  if (sb) return sb;
  return path.resolve(os.homedir(), '.assetcutter-companion', 'volume');
}

function volumePathsEqual(a, b) {
  try {
    const x = path.resolve(a);
    const y = path.resolve(b);
    if (process.platform === 'win32') return x.toLowerCase() === y.toLowerCase();
    return x === y;
  } catch {
    return false;
  }
}

/**
 * 将源卷根整棵迁移到目标卷根：复制子项后删除源目录（与「移动工作区」语义一致）。
 * 调用前应已停止占用该卷的伴侣进程。
 */
async function migrateCompanionVolumeTree(sourceAbs, targetAbs) {
  const src = path.resolve(sourceAbs);
  const dst = path.resolve(targetAbs);
  if (volumePathsEqual(src, dst)) return { ok: true };
  const relDstInSrc = path.relative(src, dst);
  if (relDstInSrc === '' || (!relDstInSrc.startsWith('..') && !path.isAbsolute(relDstInSrc))) {
    return { ok: false, error: '目标路径不能位于当前存储目录之内' };
  }
  const relSrcInDst = path.relative(dst, src);
  if (relSrcInDst === '' || (!relSrcInDst.startsWith('..') && !path.isAbsolute(relSrcInDst))) {
    return { ok: false, error: '当前存储目录不能位于目标路径之内' };
  }
  if (!fs.existsSync(src)) return { ok: true };
  if (!fs.statSync(src).isDirectory()) return { ok: false, error: '当前存储路径不是文件夹' };
  if (fs.existsSync(dst)) {
    try {
      if (fs.readdirSync(dst).length > 0) {
        return { ok: false, error: '目标文件夹非空，请选择空目录或清空后再迁移' };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    fs.mkdirSync(dst, { recursive: true });
  }
  const names = await fsp.readdir(src);
  for (const name of names) {
    await fsp.cp(path.join(src, name), path.join(dst, name), { recursive: true, force: true });
  }
  await fsp.rm(src, { recursive: true, force: true });
  return { ok: true };
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

function resolveAuthApiOriginForCompanionApi() {
  const fromEnv = String(process.env.COMPANION_AUTH_API_ORIGIN || '').trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* ignore */
    }
  }
  const settings = readShellSettings();
  const fromSettings = String(settings.authApiOrigin || '').trim();
  if (fromSettings) {
    try {
      return new URL(fromSettings).origin;
    } catch {
      /* ignore */
    }
  }
  try {
    const bakedPath = path.join(__dirname, 'build-constants.json');
    if (fs.existsSync(bakedPath)) {
      const j = JSON.parse(fs.readFileSync(bakedPath, 'utf8'));
      const baked = String(j.defaultAuthApiOrigin || '').trim();
      if (baked) return new URL(baked).origin;
    }
  } catch {
    /* ignore */
  }
  try {
    return new URL(readShellSettings().siteUrl).origin;
  } catch {
    return null;
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

async function fetchHostBundleCatalogFromSite() {
  const origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) {
    return { ok: false, error: 'invalid_auth_api_origin' };
  }
  const api = `${origin}/api/companion-artifacts/catalog`;
  try {
    const r = await fetch(api, { method: 'GET', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, error: `http_${r.status}` };
    const j = await r.json();
    const raw = j && Array.isArray(j.artifacts) ? j.artifacts : [];
    return { ok: true, artifacts: raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkRemoteDesktopShellReleaseOnce() {
  const origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return null;
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

function companionApiRequest(method, pathname, body, opts) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(pathname || '');
  if (!p.startsWith('/v1/')) {
    return Promise.resolve({ ok: false, error: 'path_not_allowed' });
  }
  const port = readHttpPort();
  const token = readSharedToken();
  const bodyStr = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const optObj = opts && typeof opts === 'object' ? opts : {};
  const timeoutRaw = Number(optObj.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(Math.max(Math.floor(timeoutRaw), 1000), 600000)
    : 15000;
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
        timeout: timeoutMs,
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

/**
 * 安装包：固定使用 resources/local-companion-bundle（与 electron-builder extraResources 一致），
 * 避免缺少 bundle 入口时误解析到不存在的 resources/local-companion。
 * 开发：仓库 ../local-companion
 */
function localCompanionRuntimeRoot() {
  try {
    if (app.isPackaged) {
      return path.resolve(path.join(process.resourcesPath, 'local-companion-bundle'));
    }
  } catch {
    /* app 未 ready 等 */
  }
  return path.resolve(__dirname, '..', 'local-companion');
}

/** 安装包内不依赖系统 PATH 的 node：用 Electron 二进制以 Node 模式跑子进程 */
function getNodeLauncherForLocalCompanion() {
  const custom = process.env.COMPANION_NODE?.trim();
  if (custom) return { cmd: custom, envExtra: {} };
  try {
    if (app.isPackaged) {
      return {
        cmd: process.execPath,
        envExtra: { ELECTRON_RUN_AS_NODE: '1' },
      };
    }
  } catch {
    /* ignore */
  }
  return { cmd: 'node', envExtra: {} };
}

/**
 * 开发：node + tsx + src/main.ts。安装包：预打包 **main.cjs**（CJS）+ public；勿用 main.mjs（ESM）：RUN_AS_NODE 下 yauzl 会 dynamic require 崩。
 * @returns {{ cwd: string, nodeBin: string, args: string[], envExtra: Record<string, string> }}
 */
function bundledCompanionEntryPath(root) {
  const cjs = path.join(root, 'main.cjs');
  const legacyMjs = path.join(root, 'main.mjs');
  if (fs.existsSync(cjs)) return cjs;
  if (fs.existsSync(legacyMjs)) return legacyMjs;
  return '';
}

function getLocalCompanionSpawnConfig() {
  const root = localCompanionRuntimeRoot();
  const bundledMain = bundledCompanionEntryPath(root);
  if (bundledMain) {
    const { cmd, envExtra } = getNodeLauncherForLocalCompanion();
    return { cwd: root, nodeBin: cmd, args: [bundledMain], envExtra };
  }
  const mainTs = path.join(root, 'src', 'main.ts');
  const nodeBin = process.env.COMPANION_NODE?.trim() || 'node';
  /** 开发树：优先 `tsx watch`（与 `local-companion` 的 `npm run dev` 一致），源码保存后子进程自动重启 */
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(mainTs) && fs.existsSync(tsxCli)) {
    return { cwd: root, nodeBin, args: [tsxCli, 'watch', path.join('src', 'main.ts')], envExtra: {} };
  }
  return { cwd: root, nodeBin, args: ['--import', 'tsx', mainTs], envExtra: {} };
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

function companionWorkbenchBaseUrl() {
  return `http://127.0.0.1:${readHttpPort()}`;
}

function sameCommaSeparatedOrigins(a, b) {
  const sa = new Set(
    String(a || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const sb = new Set(
    String(b || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (sa.size !== sb.size) return false;
  for (const x of sa) {
    if (!sb.has(x)) return false;
  }
  return true;
}

/**
 * 工作台在壳内打开时：把当前主站 origin 写入 `pairing-config`（供 COMPANION_ALLOWED_ORIGINS），
 * 若无通信密码则自动生成；再重启由壳拉起的 local-companion 使环境变量生效。
 * 若本机另有独立启动的伴侣进程且未重启，网站仍可能 401，需用户在该进程上对齐配置。
 */
async function prepareWorkbenchPairingForWorkbenchUrl(targetHref) {
  let origin = null;
  try {
    origin = new URL(String(targetHref || '').trim()).origin;
  } catch {
    return { ok: false, error: 'invalid_workbench_url' };
  }

  const pair = readPairingConfig();
  let token = String(pair.sharedToken || '').trim();
  const parts = String(pair.allowedOrigins || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const originSet = new Set(parts);
  const hadOrigin = originSet.has(origin);
  if (!hadOrigin) originSet.add(origin);
  const mergedOrigins = [...originSet].join(',');

  const needNewToken = !token || token.length < 8;
  if (needNewToken) {
    token = randomBytes(24).toString('hex');
  }

  if (!needNewToken && hadOrigin && sameCommaSeparatedOrigins(mergedOrigins, pair.allowedOrigins)) {
    return { ok: true, changed: false };
  }

  savePairingConfig({ sharedToken: token, allowedOrigins: mergedOrigins });
  await restartLocalCompanionFromTray({ aggressive: false });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await probeCompanionHealth()) break;
    await sleep(180);
  }
  return { ok: true, changed: true };
}

/**
 * 将 `pairing-config` 中的 token 写入工作台分区 localStorage（与网站 `companionLocalPrefs` 键一致），
 * 若与页面此前值不同则 `reload` 一次以便 SPA 重新探测伴侣。
 */
async function injectWorkbenchCompanionPrefsFromPairingFile(wc) {
  if (shellMainProcessActiveView !== 'workbench') return;
  if (!wc || wc.isDestroyed()) return;
  let u = '';
  try {
    u = wc.getURL();
  } catch {
    return;
  }
  if (!/^https?:\/\//i.test(u)) return;
  const allowed = getWorkbenchAllowedOrigin();
  if (!allowed) return;
  let pageOrigin = '';
  try {
    pageOrigin = new URL(u).origin;
  } catch {
    return;
  }
  if (pageOrigin !== allowed) return;

  const tok = String(readPairingConfig().sharedToken || '').trim();
  if (tok.length < 8) return;

  const base = companionWorkbenchBaseUrl();
  let before = '';
  try {
    before = await wc.executeJavaScript(
      `(()=>{ try { return localStorage.getItem('ac_companion_local_token_v1')||''; } catch(e){ return ''; } })()`,
    );
  } catch {
    return;
  }
  try {
    await wc.executeJavaScript(`(()=>{ try {
      localStorage.setItem('ac_companion_local_base_v1', ${JSON.stringify(base)});
      localStorage.setItem('ac_companion_local_token_v1', ${JSON.stringify(tok)});
    } catch(e){} })()`);
  } catch (e) {
    console.warn('[companion-desktop] workbench inject companion prefs', e);
    return;
  }
  if (String(before || '') !== tok) {
    try {
      wc.reload();
    } catch {
      /* ignore */
    }
  }
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
  /** 与启动子进程一致：设置页写入的 pairing-config 需参与本机 HTTP 客户端鉴权，否则 /v1/capabilities 等会 401 */
  try {
    const p = readPairingConfig().sharedToken?.trim();
    return p || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待 /v1/health 不可达（子进程已退出或端口已释放） */
async function waitUntilCompanionStopped(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = await probeCompanionHealth();
    if (!alive) return true;
    await sleep(120);
  }
  return !(await probeCompanionHealth());
}

/**
 * Windows：结束占用伴侣 HTTP 端口的监听进程（用于切换存储目录等需强制换进程的场景）。
 * 可能结束用户在其它终端启动的 local-companion。
 */
function killProcessListeningOnCompanionPort(port) {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      `powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($c) { Stop-Process -Id $c -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {
    /* ignore */
  }
}

/**
 * 停止本机伴侣子进程并尽量释放端口（与切换卷根、迁移前停写一致）。
 * @param {{ aggressive?: boolean }} [options]
 */
async function stopCompanionForVolumeChange(options = {}) {
  const aggressive = Boolean(options && options.aggressive);
  const port = readHttpPort();
  stopLocalCompanion();
  await sleep(aggressive ? 450 : 320);
  let stopped = await waitUntilCompanionStopped(aggressive ? 8000 : 5000);
  if (!stopped && aggressive) {
    killProcessListeningOnCompanionPort(port);
    await sleep(500);
  }
}

/**
 * @param {{ aggressive?: boolean }} [options] aggressive：为 true 时，在端口仍被占用时会尝试结束监听进程（Windows），以便新 COMPANION_VOLUME_ROOT 生效。
 */
async function restartLocalCompanionFromTray(options = {}) {
  await stopCompanionForVolumeChange(options);
  await startLocalCompanion();
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
    const uiRaw = status && typeof status === 'object' ? status.localCapabilityUi : null;
    if (uiRaw && typeof uiRaw === 'object') {
      companionTrayCapabilityUi = {
        headline: typeof uiRaw.headline === 'string' ? uiRaw.headline : '',
        subline: typeof uiRaw.subline === 'string' ? uiRaw.subline : '',
        tone: typeof uiRaw.tone === 'string' ? uiRaw.tone : 'ok',
        samHumanBody: typeof uiRaw.samSpawn?.humanBody === 'string' ? uiRaw.samSpawn.humanBody : '',
        nextHint0: Array.isArray(uiRaw.samSpawn?.nextHints) ? String(uiRaw.samSpawn.nextHints[0] || '') : '',
      };
    } else {
      companionTrayCapabilityUi = null;
    }
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
      companionStatusNote =
        companionTrayCapabilityUi && companionTrayCapabilityUi.headline
          ? companionTrayCapabilityUi.headline
          : 'Relay 子进程未运行';
      companionLastError = `relay_not_running${detail}`;
      updateTrayTooltip();
      rebuildTrayMenu();
      const relayBalloon =
        companionTrayCapabilityUi && companionTrayCapabilityUi.subline
          ? `${companionTrayCapabilityUi.subline}（技术摘要：relay_not_running${detail}）`
          : `已配置 Relay，但当前未运行${detail}`;
      notifyStatusIssue('本地伴侣提醒', relayBalloon, `relay_not_running${detail}`);
      return;
    }
    const samLocal = status && typeof status === 'object' ? status.samLocal : null;
    const samConfigured = Boolean(samLocal && samLocal.configured);
    const samRunning = Boolean(samLocal && samLocal.running);
    const samProbe = status && typeof status === 'object' ? status.samSegmentHttpProbe : null;
    const samHttpOk =
      samProbe && typeof samProbe === 'object' && samProbe.ok === true && samProbe.code !== 'SAM_PROBE_NOT_LOOPBACK';
    if (samConfigured && !samRunning && samHttpOk) {
      // 随启子进程未挂接，但伴侣已探测到本机分割 HTTP 健康：不按「需修复」阻断托盘气泡
    } else if (samConfigured && !samRunning) {
      const samLastError =
        samLocal && typeof samLocal === 'object' && typeof samLocal.lastError === 'string' ? samLocal.lastError : null;
      const samLastExitCode =
        samLocal && typeof samLocal === 'object' && typeof samLocal.lastExitCode === 'number'
          ? samLocal.lastExitCode
          : null;
      const samLastSignal =
        samLocal && typeof samLocal === 'object' && typeof samLocal.lastSignal === 'string' ? samLocal.lastSignal : null;
      const samParts = [];
      if (samLastError) samParts.push(`error=${samLastError}`);
      if (samLastExitCode != null) samParts.push(`exit=${samLastExitCode}`);
      if (samLastSignal) samParts.push(`signal=${samLastSignal}`);
      const samDetail = samParts.length ? ` (${samParts.join(', ')})` : '';
      companionStatusNote =
        companionTrayCapabilityUi && companionTrayCapabilityUi.headline
          ? companionTrayCapabilityUi.headline
          : '本机分割引擎未保持运行';
      companionLastError = `sam_local_not_running${samDetail}`;
      updateTrayTooltip();
      rebuildTrayMenu();
      const samLines = [];
      if (companionTrayCapabilityUi && companionTrayCapabilityUi.subline) {
        samLines.push(companionTrayCapabilityUi.subline);
      }
      if (companionTrayCapabilityUi && companionTrayCapabilityUi.samHumanBody) {
        samLines.push(companionTrayCapabilityUi.samHumanBody);
      }
      if (companionTrayCapabilityUi && companionTrayCapabilityUi.nextHint0) {
        samLines.push(`建议：${companionTrayCapabilityUi.nextHint0}`);
      }
      const samBalloon =
        samLines.length > 0 ? samLines.join('\n') : `已配置自动拉起本机分割，但当前未运行${samDetail}`;
      notifyStatusIssue('本地伴侣提醒', samBalloon, `sam_local_not_running${samDetail}`);
      return;
    }
    companionStatusNote =
      companionTrayCapabilityUi && companionTrayCapabilityUi.headline
        ? companionTrayCapabilityUi.headline
        : '伴侣运行中';
    companionLastError = null;
    lastStatusAlertKey = null;
    updateTrayTooltip();
    rebuildTrayMenu();
  } catch (err) {
    companionTrayCapabilityUi = null;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'runtime_status_unauthorized') {
      companionStatusNote = '状态检查需配对 Token';
      companionLastError = 'status_needs_token';
      updateTrayTooltip();
      rebuildTrayMenu();
      notifyStatusIssue(
        '本地伴侣提醒',
        '配对验证失败，请在桌面壳「设置 → 与网站配对」或网站设置中检查本机通信密码是否一致',
        'status_needs_token',
      );
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

  const cfg = getLocalCompanionSpawnConfig();
  const companionRoot = cfg.cwd;
  const hasBundled = Boolean(bundledCompanionEntryPath(companionRoot));
  const hasDevTree = fs.existsSync(path.join(companionRoot, 'package.json'));
  if (!hasBundled && !hasDevTree) {
    companionStatusNote = '伴侣异常';
    companionLastError = app.isPackaged
      ? '安装包缺少内置伴侣运行时（local-companion-bundle/main.cjs）。请用当前仓库的 dist 脚本重新打包安装。'
      : '未找到 local-companion（请在仓库 local-companion 目录执行 npm ci / npm install）';
    updateTrayTooltip();
    rebuildTrayMenu();
    notifyCompanionFailure(companionLastError);
    return;
  }

  const env = {
    ...process.env,
    ...cfg.envExtra,
    COMPANION_OPEN_BROWSER: '0',
  };
  const sbRoot = companionSandboxPaths.getCompanionSandboxRoot();
  if (sbRoot) {
    env.COMPANION_SANDBOX_ROOT = sbRoot;
  }
  /** SamLocal 走 127.0.0.1；系统 HTTP_PROXY 未排除回环时 fetch 会报 COMPUTE_SAM_BACKEND */
  const loopNoProxy = '127.0.0.1,localhost,::1';
  const curNo = String(env.NO_PROXY || env.no_proxy || '').trim();
  env.NO_PROXY = !curNo ? loopNoProxy : curNo.includes('127.0.0.1') ? curNo : `${curNo},${loopNoProxy}`;
  env.no_proxy = env.NO_PROXY;
  const pair = readPairingConfig();
  /** 配对文件为「用户在壳里保存的真值」；父进程若误带旧 COMPANION_* 环境变量，不得盖过 pairing（否则网站与 Script Hub 会 bearer_invalid） */
  const pairTok = String(pair.sharedToken ?? '').trim();
  if (pairTok) {
    env.COMPANION_SHARED_TOKEN = pairTok;
  }
  const pairOrigins = String(pair.allowedOrigins ?? '').trim();
  if (pairOrigins) {
    env.COMPANION_ALLOWED_ORIGINS = pairOrigins;
  }
  applyShellVolumeRootToEnv(env);
  applyDesktopSamLocalSpawnEnv(env);
  applyDesktopRembgPythonToEnv(env);

  /** 父进程/系统环境若带 `COMPANION_HTTP_PORT=0`（常为 Relay 子进程约定），子进程会按「关闭 HTTP」立即 exit(1) */
  if (String(env.COMPANION_HTTP_PORT ?? '').trim() === '0') {
    delete env.COMPANION_HTTP_PORT;
  }

  let stdio = process.stdout?.isTTY ? 'inherit' : 'ignore';
  let spawnLogPath = '';
  if (app.isPackaged && stdio === 'ignore') {
    spawnLogPath = path.join(app.getPath('userData'), 'local-companion-spawn.log');
    try {
      fs.appendFileSync(
        spawnLogPath,
        `\n---------- ${new Date().toISOString()} spawn ${cfg.nodeBin} ${cfg.args.join(' ')} ----------\n`,
      );
    } catch {
      spawnLogPath = '';
    }
    if (spawnLogPath) stdio = ['ignore', 'pipe', 'pipe'];
  }

  companion = spawn(cfg.nodeBin, cfg.args, {
    cwd: companionRoot,
    env,
    stdio,
    windowsHide: false,
  });

  if (spawnLogPath && companion.stdout && companion.stderr) {
    const append = (chunk) => {
      try {
        fs.appendFileSync(spawnLogPath, chunk);
      } catch {
        /* ignore */
      }
    };
    companion.stdout.on('data', append);
    companion.stderr.on('data', append);
  }
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
    companion = null;
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

function displayTrayBalloon(opts) {
  if (process.platform !== 'win32' || !tray || tray.isDestroyed()) return;
  tray.displayBalloon({
    iconType: opts.iconType || 'info',
    title: opts.title,
    content: opts.content,
  });
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
      label: '本机能力：打开本机引擎 / 安装',
      click: () => openSamLocalSetupGuide(),
    },
    {
      label: '重新启动本地伴侣',
      click: () => {
        void restartLocalCompanionFromTray({ aggressive: false }).catch((e) =>
          console.error('[companion-desktop] restart companion:', e),
        );
      },
    },
  ];

  if (app.isPackaged || companionUpdater.resolveUpdateFeedUrl()) {
    const labels = companionUpdater.getTrayUpdateLabels();
    if (labels.status) {
      template.push({ label: labels.status, enabled: false });
    }
    template.push({
      label: labels.check,
      click: () => {
        void companionUpdater.checkNow(true);
      },
    });
    if (labels.install) {
      template.push({
        label: labels.install,
        click: () => companionUpdater.installReadyUpdate(),
      });
    }
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

function openSamLocalSetupGuide() {
  openMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('shell-focus-sam-local-setup');
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(send, 80));
  } else {
    setTimeout(send, 80);
  }
}

function normalizeWorkbenchSiteUrl(raw) {
  const u = String(raw || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    return new URL(u).href;
  } catch {
    return null;
  }
}

/** 与当前嵌入 Chromium 的 `Chrome/x` 主版本一致，但不带 `Electron/x` 片段，减轻部分代理/WAF 对 Electron UA 的拦截或 RST。 */
function workbenchChromeLikeUserAgent() {
  const chrome = process.versions.chrome || '131.0.0.0';
  let token = 'Windows NT 10.0; Win64; x64';
  if (process.platform === 'darwin') {
    token = 'Macintosh; Intel Mac OS X 10_15_7';
  } else if (process.platform === 'linux') {
    token = 'X11; Linux x86_64';
  }
  return `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function getWorkbenchAllowedOrigin() {
  const href = normalizeWorkbenchSiteUrl(readShellSettings().siteUrl);
  if (!href) return null;
  try {
    return new URL(href).origin;
  } catch {
    return null;
  }
}

function layoutWorkbenchBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed() || !workbenchBrowserView) return;
  if (shellMainProcessActiveView !== 'workbench') return;
  const b = mainWindow.getContentBounds();
  const x = shellWorkbenchSidebarInsetPx;
  const y = SHELL_TITLEBAR_HEIGHT + SHELL_WORKBENCH_TOOLBAR_HEIGHT;
  const w = Math.max(120, b.width - shellWorkbenchSidebarInsetPx);
  const h = Math.max(120, b.height - y);
  workbenchBrowserView.setBounds({ x, y, width: w, height: h });
}

function detachWorkbenchBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed() || !workbenchBrowserView) return;
  try {
    mainWindow.removeBrowserView(workbenchBrowserView);
  } catch (e) {
    console.warn('[companion-desktop] removeBrowserView', e);
  }
}

function sanitizeDownloadFilename(name) {
  const raw = String(name || '').trim();
  const safe = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 180);
  return safe || `assetcutter-download-${Date.now()}`;
}

function uniqueDownloadPath(dir, filename) {
  const parsed = path.parse(sanitizeDownloadFilename(filename));
  const base = parsed.name || 'assetcutter-download';
  const ext = parsed.ext || '';
  let candidate = path.join(dir, `${base}${ext}`);
  for (let i = 1; fs.existsSync(candidate) && i < 1000; i += 1) {
    candidate = path.join(dir, `${base}-${i}${ext}`);
  }
  return candidate;
}

function defaultWorkbenchDownloadRoot() {
  return path.join(app.getPath('downloads'), 'AssetCutter');
}

function normalizedDownloadDirFromSettings() {
  const sh = readShellSettings();
  const raw = typeof sh.downloadDir === 'string' ? sh.downloadDir.trim() : '';
  if (!raw) return '';
  try {
    return path.resolve(path.normalize(raw));
  } catch {
    return '';
  }
}

function getWorkbenchDownloadRootSync() {
  let dir = normalizedDownloadDirFromSettings();
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      dir = '';
    }
  }
  const fallback = defaultWorkbenchDownloadRoot();
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function notifyWorkbenchDownloadSaved(payload) {
  try {
    if (!workbenchBrowserView || workbenchBrowserView.webContents.isDestroyed()) return;
    workbenchBrowserView.webContents.send('workbench-download-saved', payload || {});
  } catch {
    /* ignore */
  }
}

function announceTrayDownloadSaved(savePath, noticeTitle) {
  displayTrayBalloon({
    iconType: 'info',
    title: noticeTitle || '下载已完成',
    content: savePath,
  });
}

function announceWebDownloadSaved(savePath, noticeTitle) {
  notifyWorkbenchDownloadSaved({
    path: savePath,
    filename: path.basename(savePath),
    title: noticeTitle || '下载已完成',
  });
}

async function pickWorkbenchDownloadDir(parentWin, title) {
  const r = await dialog.showOpenDialog(parentWin || undefined, {
    title: title || '选择下载保存文件夹',
    message: 'AssetCutter 将把下载的图片、模型等保存到此文件夹。',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: normalizedDownloadDirFromSettings() || defaultWorkbenchDownloadRoot(),
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const dir = path.resolve(path.normalize(r.filePaths[0]));
  saveShellSettings({ downloadDir: dir });
  return { ok: true, dir };
}

/** @type {'pending' | 'declined'} */
let workbenchDownloadDirPromptState = 'pending';

async function resolveWorkbenchDownloadRoot({ interactive, parentWin }) {
  let dir = normalizedDownloadDirFromSettings();
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      dir = '';
    }
  }
  if (interactive && workbenchDownloadDirPromptState === 'pending') {
    const picked = await pickWorkbenchDownloadDir(
      parentWin,
      '首次下载：选择保存文件夹',
    );
    if (picked.ok) {
      return picked.dir;
    }
    workbenchDownloadDirPromptState = 'declined';
    return null;
  }
  if (interactive && workbenchDownloadDirPromptState === 'declined') {
    return null;
  }
  return getWorkbenchDownloadRootSync();
}

async function writeWorkbenchDownloadFile(bytes, filename, opts) {
  const parentWin =
    opts && opts.parentWin
      ? opts.parentWin
      : mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined;
  const root = await resolveWorkbenchDownloadRoot({
    interactive: !(opts && opts.skipPrompt),
    parentWin,
  });
  if (!root) return { ok: false, canceled: true };
  const savePath = uniqueDownloadPath(root, filename);
  await fsp.writeFile(savePath, bytes);
  announceTrayDownloadSaved(savePath, (opts && opts.noticeTitle) || '下载已完成');
  return { ok: true, path: savePath, filename: path.basename(savePath) };
}

function bindWorkbenchDownloadHandler(wc) {
  if (!wc || workbenchDownloadHooked.has(wc)) return;
  workbenchDownloadHooked.add(wc);

  wc.session.on('will-download', (_event, item, webContents) => {
    if (!workbenchBrowserView || webContents !== wc) return;

    let savePath = '';
    try {
      const downloadsRoot = getWorkbenchDownloadRootSync();
      savePath = uniqueDownloadPath(downloadsRoot, item.getFilename());
      item.setSavePath(savePath);
    } catch (e) {
      companionLog('warn', '[companion-desktop] workbench download setSavePath:', e instanceof Error ? e.message : e);
    }

    item.once('done', (_doneEvent, state) => {
      if (state === 'completed' && savePath) {
        companionLog('log', '[companion-desktop] workbench download completed:', savePath);
        announceTrayDownloadSaved(savePath, '下载已完成');
        announceWebDownloadSaved(savePath, '下载已完成');
      } else if (state !== 'cancelled') {
        companionLog('warn', '[companion-desktop] workbench download ended:', state);
      }

      try {
        if (mainWindow && !mainWindow.isDestroyed() && shellMainProcessActiveView === 'workbench') {
          const attached = mainWindow.getBrowserViews().indexOf(workbenchBrowserView) >= 0;
          if (!attached) mainWindow.addBrowserView(workbenchBrowserView);
          layoutWorkbenchBrowserView();
          wc.focus();
        }
      } catch (e) {
        companionLog('warn', '[companion-desktop] workbench restore after download:', e instanceof Error ? e.message : e);
      }
    });
  });
}

function ensureWorkbenchBrowserView() {
  if (workbenchBrowserView) return workbenchBrowserView;

  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:assetcutter-workbench',
      preload: path.join(__dirname, 'preload-workbench.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const wc = view.webContents;
  bindWorkbenchDownloadHandler(wc);

  try {
    wc.setUserAgent(workbenchChromeLikeUserAgent());
  } catch (e) {
    console.warn('[companion-desktop] workbench setUserAgent', e);
  }

  wc.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    if (/^(blob|data):/i.test(String(url || ''))) {
      event.preventDefault();
      return;
    }
    const allowed = getWorkbenchAllowedOrigin();
    if (!allowed) {
      event.preventDefault();
      return;
    }
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (origin !== allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (!workbenchPairingInjectHooked.has(view)) {
    workbenchPairingInjectHooked.add(view);
    wc.on('did-finish-load', () => {
      void injectWorkbenchCompanionPrefsFromPairingFile(wc);
    });
  }

  workbenchBrowserView = view;
  return view;
}

async function attachWorkbenchBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no_window' };
  const target = normalizeWorkbenchSiteUrl(readShellSettings().siteUrl);
  if (!target) return { ok: false, error: 'invalid_site_url' };

  try {
    await prepareWorkbenchPairingForWorkbenchUrl(target);
  } catch (e) {
    console.warn('[companion-desktop] workbench auto-pair prepare:', e instanceof Error ? e.message : e);
  }

  const view = ensureWorkbenchBrowserView();
  const wc = view.webContents;

  const alreadyAttached = mainWindow.getBrowserViews().indexOf(view) >= 0;
  if (!alreadyAttached) mainWindow.addBrowserView(view);
  layoutWorkbenchBrowserView();

  let needLoad = true;
  try {
    const cur = wc.getURL();
    if (cur && cur !== 'about:blank' && /^https?:\/\//i.test(cur)) {
      needLoad = new URL(cur).href !== new URL(target).href;
    }
  } catch {
    needLoad = true;
  }

  if (needLoad) {
    try {
      await wc.loadURL(target);
    } catch (e) {
      detachWorkbenchBrowserView();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    try {
      await injectWorkbenchCompanionPrefsFromPairingFile(wc);
    } catch (e) {
      console.warn('[companion-desktop] workbench inject (same url)', e instanceof Error ? e.message : e);
    }
  }

  return { ok: true };
}

function bindMainWindowWorkbenchLayoutHandlers() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const relayout = () => layoutWorkbenchBrowserView();
  mainWindow.on('resize', relayout);
  mainWindow.on('move', relayout);
  mainWindow.on('maximize', relayout);
  mainWindow.on('unmaximize', relayout);
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
    frame: false,
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
    workbenchBrowserView = null;
    shellMainProcessActiveView = 'home';
    mainWindow = null;
  });

  bindMainWindowWorkbenchLayoutHandlers();

  mainWindow.webContents.on('did-finish-load', () => {
    if (companionUpdater.getUpdaterUiState) {
      broadcastShellUpdaterState(companionUpdater.getUpdaterUiState());
    }
  });

  const shellHtml = path.join(__dirname, 'shell', 'index.html');
  void mainWindow.loadFile(shellHtml);
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
  ipcMain.handle('shell-tray-summary', async () => {
    const port = readHttpPort();
    const alive = await probeCompanionHealth();
    return {
      connected: alive,
      port,
      note: companionStatusNote,
      lastError: companionLastError,
      capabilityUi: companionTrayCapabilityUi,
      updater: companionUpdater.getUpdaterUiState ? companionUpdater.getUpdaterUiState() : null,
    };
  });

  ipcMain.handle('shell-install-shell-update', () => {
    companionUpdater.installReadyUpdate();
    return { ok: true };
  });

  ipcMain.handle('workbench-save-blob-download', async (event, payload) => {
    if (!workbenchBrowserView || event.sender !== workbenchBrowserView.webContents) {
      return { ok: false, error: 'not_workbench' };
    }
    try {
      const rawBytes = payload && payload.bytes;
      let bytes;
      if (rawBytes instanceof ArrayBuffer) {
        bytes = Buffer.from(rawBytes);
      } else if (ArrayBuffer.isView(rawBytes)) {
        bytes = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
      } else {
        return { ok: false, error: 'bad_bytes' };
      }
      if (bytes.length < 1) return { ok: false, error: 'empty_file' };

      const noticeTitle =
        payload && typeof payload.title === 'string' && payload.title.trim()
          ? payload.title.trim()
          : '下载已完成';
      const parentWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const saved = await writeWorkbenchDownloadFile(bytes, payload && payload.filename, {
        noticeTitle,
        parentWin,
        skipPrompt: Boolean(payload && payload.skipPrompt),
      });
      if (saved.canceled) return { ok: false, canceled: true };
      if (!saved.ok) return { ok: false, error: 'save_failed' };
      return { ok: true, path: saved.path, filename: saved.filename };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-settings-load', () => readShellSettings());

  ipcMain.handle('shell-settings-save', (_e, patch) => {
    try {
      const data = saveShellSettings(patch);
      if (
        patch &&
        typeof patch.siteUrl === 'string' &&
        workbenchBrowserView &&
        shellMainProcessActiveView === 'workbench'
      ) {
        const target = normalizeWorkbenchSiteUrl(data.siteUrl);
        if (target) {
          void (async () => {
            try {
              await prepareWorkbenchPairingForWorkbenchUrl(target);
              await workbenchBrowserView.webContents.loadURL(target);
            } catch (e) {
              console.error('[companion-desktop] workbench loadURL after settings save:', e);
            }
          })();
        }
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-pick-volume-root', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const r = await dialog.showOpenDialog(win || undefined, {
      title: '选择本地伴侣仓库目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  });

  ipcMain.handle('shell-pick-download-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const picked = await pickWorkbenchDownloadDir(win, '选择下载保存文件夹');
    if (!picked.ok) return { ok: false, canceled: true };
    workbenchDownloadDirPromptState = 'pending';
    return { ok: true, path: picked.dir };
  });

  ipcMain.handle('shell-get-effective-download-dir', () => {
    const custom = normalizedDownloadDirFromSettings();
    if (custom) {
      try {
        fs.mkdirSync(custom, { recursive: true });
        return { ok: true, path: custom, isDefault: false };
      } catch {
        /* fall through */
      }
    }
    return { ok: true, path: getWorkbenchDownloadRootSync(), isDefault: true };
  });

  ipcMain.handle('shell-apply-volume-change', async (event, payload) => {
    const newInputRaw =
      payload && typeof payload.newVolumeRoot === 'string' ? payload.newVolumeRoot.trim() : '';
    const oldHint =
      payload && typeof payload.oldVolumeRoot === 'string' ? payload.oldVolumeRoot.trim() : '';

    const newAbs = newInputRaw
      ? path.resolve(path.normalize(newInputRaw))
      : getDefaultCompanionVolumeRoot();

    let oldAbs;
    if (oldHint) {
      oldAbs = path.resolve(path.normalize(oldHint));
    } else {
      const sh = readShellSettings();
      oldAbs = sh.volumeRoot
        ? path.resolve(path.normalize(sh.volumeRoot))
        : getDefaultCompanionVolumeRoot();
    }

    if (volumePathsEqual(oldAbs, newAbs)) {
      return { ok: true, noChange: true };
    }

    const win =
      BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || mainWindow;
    const detail = '当前存储：' + oldAbs + '\n变更后：' + newAbs;
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: 'question',
      title: '更改存储位置',
      message: '是否将现有数据迁移到新目录？',
      detail,
      buttons: ['迁移并应用', '仅切换目录', '取消'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return { ok: false, canceled: true };

    const shouldMigrate = response === 0;

    try {
      await stopCompanionForVolumeChange({ aggressive: true });
      if (shouldMigrate) {
        const m = await migrateCompanionVolumeTree(oldAbs, newAbs);
        if (!m.ok) {
          dialog.showErrorBox('无法完成迁移', m.error || '未知错误');
          await startLocalCompanion();
          return { ok: false, error: m.error || 'migrate_failed' };
        }
      }
      saveShellSettings({ volumeRoot: newInputRaw });
      await startLocalCompanion();
      return { ok: true, migrated: shouldMigrate };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dialog.showErrorBox('应用存储位置失败', msg);
      try {
        await startLocalCompanion();
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('shell-restart-companion', async (_event, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    await restartLocalCompanionFromTray(o);
    return { ok: true };
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

  ipcMain.handle('shell-open-folder-path', async (_e, absPath) => {
    const raw = String(absPath || '').trim();
    if (!raw) return { ok: false, error: 'empty_path' };
    const errMsg = await shell.openPath(raw);
    return errMsg ? { ok: false, error: errMsg } : { ok: true };
  });

  ipcMain.handle('shell-window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
      return { ok: true };
    }
    return { ok: false, error: 'main_window_not_found' };
  });

  ipcMain.handle('shell-window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
      return { ok: true };
    }
    return { ok: false, error: 'main_window_not_found' };
  });

  ipcMain.handle('shell-window-toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'main_window_not_found' };
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { ok: true };
  });

  ipcMain.handle('shell-set-view', async (_e, view) => {
    const v = view === 'workbench' || view === 'settings' || view === 'home' ? view : 'home';
    shellMainProcessActiveView = v;
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: true, view: v };
    if (v === 'workbench') {
      const r = await attachWorkbenchBrowserView();
      return { ...r, view: v };
    }
    detachWorkbenchBrowserView();
    return { ok: true, view: v };
  });

  ipcMain.handle('shell-sidebar-context-menu-popup', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no_window' };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: 'no_window' };
    const menu = Menu.buildFromTemplate([
      {
        label: '刷新工作台',
        click: () => {
          if (!workbenchBrowserView || shellMainProcessActiveView !== 'workbench') return;
          try {
            workbenchBrowserView.webContents.reload();
          } catch {
            /* ignore */
          }
        },
      },
      {
        label: '硬刷新（忽略缓存）',
        click: () => {
          if (!workbenchBrowserView || shellMainProcessActiveView !== 'workbench') return;
          try {
            workbenchBrowserView.webContents.reloadIgnoringCache();
          } catch {
            /* ignore */
          }
        },
      },
      {
        label: '在浏览器中打开主站',
        click: () => {
          void (async () => {
            const u = normalizeWorkbenchSiteUrl(readShellSettings().siteUrl);
            if (u) await shell.openExternal(u);
          })();
        },
      },
    ]);
    menu.popup({ window: win });
    return { ok: true };
  });

  ipcMain.handle('shell-workbench-sidebar-inset', (_e, px) => {
    const n = Number(px);
    const inset = Number.isFinite(n)
      ? Math.max(0, Math.min(Math.round(n), SHELL_SIDEBAR_WIDTH_EXPANDED))
      : SHELL_SIDEBAR_WIDTH_EXPANDED;
    shellWorkbenchSidebarInsetPx = inset;
    layoutWorkbenchBrowserView();
    return { ok: true, inset };
  });

  ipcMain.handle('shell-workbench-reload', () => {
    if (!workbenchBrowserView || shellMainProcessActiveView !== 'workbench') {
      return { ok: false, error: 'not_visible' };
    }
    try {
      workbenchBrowserView.webContents.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-workbench-reload-hard', () => {
    if (!workbenchBrowserView || shellMainProcessActiveView !== 'workbench') {
      return { ok: false, error: 'not_visible' };
    }
    try {
      workbenchBrowserView.webContents.reloadIgnoringCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-workbench-open-external', async () => {
    const u = normalizeWorkbenchSiteUrl(readShellSettings().siteUrl);
    if (!u) return { ok: false, error: 'invalid_site_url' };
    await shell.openExternal(u);
    return { ok: true };
  });

  ipcMain.handle('companion-api', async (_e, method, pathname, body, opts) => {
    try {
      return await companionApiRequest(method, pathname, body, opts);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-fetch-host-bundle-catalog', async () => {
    try {
      return await fetchHostBundleCatalogFromSite();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), artifacts: [] };
    }
  });

  ipcMain.handle('shell-sam-local-desktop-state', () => {
    if (process.platform !== 'win32') {
      return { ok: true, platformUnsupported: true, hasBundledResources: false, installed: false };
    }
    const bundled = bundledSamLocalBundledPath();
    const hasBundled = fs.existsSync(path.join(bundled, 'app', 'main.py'));
    const st = readSamLocalDesktopRuntimeState();
    return {
      ok: true,
      platformUnsupported: false,
      hasBundledResources: hasBundled,
      installed: Boolean(st),
      state: st,
    };
  });

  ipcMain.handle('shell-sam-local-bootstrap-run', async (event) => {
    if (process.platform !== 'win32') {
      return { ok: false, error: '仅支持 Windows' };
    }
    if (anyDesktopBootstrapChildRunning()) {
      return { ok: false, error: '正在安装中，请稍候' };
    }
    const userRoot = path.join(app.getPath('userData'), 'sam-local-runtime');
    const bundledSrc = bundledSamLocalBundledPath();
    if (!fs.existsSync(path.join(bundledSrc, 'app', 'main.py'))) {
      return {
        ok: false,
        error: '当前安装包未包含 SamLocal 资源。请更新桌面应用或使用完整发行构建。',
      };
    }
    const scriptPath = samLocalBootstrapScriptPath();
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, error: '缺少 sam-local-bootstrap 脚本' };
    }
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const sendLog = (payload) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send('sam-local-bootstrap-log', payload);
      } catch {
        /* ignore */
      }
    };
    const sbRoot = companionSandboxPaths.getCompanionSandboxRoot();
    samBootstrapChild = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AC_SAM_USER_ROOT: userRoot,
        AC_SAM_SRC: bundledSrc,
        ...(sbRoot ? { AC_COMPANION_SANDBOX_ROOT: sbRoot } : {}),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outCarry = '';
    let errCarry = '';
    const feedLines = (carry, chunk) => {
      const s = carry + String(chunk);
      const parts = s.split(/\r?\n/);
      const rest = parts.pop() || '';
      for (const line of parts) {
        const t = line.trim();
        if (!t) continue;
        try {
          sendLog(JSON.parse(t));
        } catch {
          sendLog({ type: 'log', msg: t });
        }
      }
      return rest;
    };
    const flushCarry = (carry) => {
      const t = String(carry || '').trim();
      if (!t) return;
      try {
        sendLog(JSON.parse(t));
      } catch {
        sendLog({ type: 'log', msg: t });
      }
    };
    samBootstrapChild.stdout.on('data', (b) => {
      outCarry = feedLines(outCarry, b);
    });
    samBootstrapChild.stderr.on('data', (b) => {
      errCarry = feedLines(errCarry, b);
    });
    samBootstrapChild.on('error', (err) => {
      samBootstrapChild = null;
      outCarry = '';
      errCarry = '';
      sendLog({ type: 'error', msg: err.message });
      sendLog({ type: 'bootstrap-finished', ok: false });
    });
    samBootstrapChild.on('close', (code) => {
      flushCarry(outCarry);
      flushCarry(errCarry);
      outCarry = '';
      errCarry = '';
      samBootstrapChild = null;
      const ok = code === 0;
      sendLog({ type: 'bootstrap-finished', ok, exitCode: code });
      if (ok) {
        void restartLocalCompanionFromTray({ aggressive: true }).catch((e) =>
          console.error('[companion-desktop] restart after SamLocal bootstrap:', e),
        );
      }
    });
    return { ok: true, started: true };
  });

  ipcMain.handle('shell-rembg-desktop-state', () => {
    if (process.platform !== 'win32') {
      return { ok: true, platformUnsupported: true, installed: false };
    }
    const scriptPath = rembgBootstrapScriptPath();
    const exe = resolveDesktopRembgPythonExe();
    return {
      ok: true,
      platformUnsupported: false,
      hasBootstrapScript: fs.existsSync(scriptPath),
      installed: Boolean(exe),
      pythonExe: exe || undefined,
    };
  });

  ipcMain.handle('shell-rembg-bootstrap-run', async (event) => {
    if (process.platform !== 'win32') {
      return { ok: false, error: '仅支持 Windows' };
    }
    if (anyDesktopBootstrapChildRunning()) {
      return { ok: false, error: '正在安装中，请稍候' };
    }
    const scriptPath = rembgBootstrapScriptPath();
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, error: '缺少 rembg-bootstrap 脚本' };
    }
    const userRoot = path.join(app.getPath('userData'), 'rembg-runtime');
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const sendLog = (payload) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send('rembg-bootstrap-log', payload);
      } catch {
        /* ignore */
      }
    };
    const sbRoot = companionSandboxPaths.getCompanionSandboxRoot();
    rembgBootstrapChild = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AC_REMBG_USER_ROOT: userRoot,
        ...(sbRoot ? { AC_COMPANION_SANDBOX_ROOT: sbRoot } : {}),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outCarry = '';
    let errCarry = '';
    const feedLines = (carry, chunk) => {
      const s = carry + String(chunk);
      const parts = s.split(/\r?\n/);
      const rest = parts.pop() || '';
      for (const line of parts) {
        const t = line.trim();
        if (!t) continue;
        try {
          sendLog(JSON.parse(t));
        } catch {
          sendLog({ type: 'log', msg: t });
        }
      }
      return rest;
    };
    const flushCarry = (carry) => {
      const t = String(carry || '').trim();
      if (!t) return;
      try {
        sendLog(JSON.parse(t));
      } catch {
        sendLog({ type: 'log', msg: t });
      }
    };
    rembgBootstrapChild.stdout.on('data', (b) => {
      outCarry = feedLines(outCarry, b);
    });
    rembgBootstrapChild.stderr.on('data', (b) => {
      errCarry = feedLines(errCarry, b);
    });
    rembgBootstrapChild.on('error', (err) => {
      rembgBootstrapChild = null;
      outCarry = '';
      errCarry = '';
      sendLog({ type: 'error', msg: err.message });
      sendLog({ type: 'bootstrap-finished', ok: false });
    });
    rembgBootstrapChild.on('close', (code) => {
      flushCarry(outCarry);
      flushCarry(errCarry);
      outCarry = '';
      errCarry = '';
      rembgBootstrapChild = null;
      const ok = code === 0;
      sendLog({ type: 'bootstrap-finished', ok, exitCode: code });
      if (ok) {
        void restartLocalCompanionFromTray({ aggressive: true }).catch((e) =>
          console.error('[companion-desktop] restart after rembg bootstrap:', e),
        );
      }
    });
    return { ok: true, started: true };
  });

  ipcMain.handle('shell-load-pairing', () => readPairingConfig());

  ipcMain.handle('shell-save-pairing', (_event, payload) => {
    try {
      return { ok: true, data: savePairingConfig(payload) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.on('second-instance', (_event, commandLine) => {
    void commandLine;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    openMainWindow();
  });

  app.whenReady().then(() => {
    ensureCompanionSandboxLayout();
    registerCompanionProtocol();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    void startLocalCompanion();
    buildTray();
    startStatusPolling();
    void companionUpdater.setup().then((updaterOn) => {
      if (!updaterOn) {
        setTimeout(() => {
          try {
            scheduleDesktopShellReleaseCheck();
          } catch (e) {
            console.warn(
              '[companion-desktop] desktop release check:',
              e instanceof Error ? e.message : e,
            );
          }
        }, 45000);
      }
    });
    if (process.env.COMPANION_DESKTOP_NO_AUTO_SHELL !== '1') {
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
    companionUpdater.dispose();
    if (desktopReleaseCheckTimer) {
      clearInterval(desktopReleaseCheckTimer);
      desktopReleaseCheckTimer = null;
    }
    stopStatusPolling();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
      mainWindow = null;
    }
    stopLocalCompanion();
  });
}
