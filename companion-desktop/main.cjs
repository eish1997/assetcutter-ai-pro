'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const http = require('http');
const https = require('https');
const {
  app,
  Tray,
  Menu,
  nativeImage,
  shell,
  BrowserWindow,
  BrowserView,
  session,
  ipcMain,
  dialog,
  protocol,
} = require('electron');
const { spawn, execSync } = require('child_process');
const { createHash, randomBytes } = require('node:crypto');
const companionSandboxPaths = require('./companion-sandbox-paths.cjs');
const { createCompanionAutoUpdate } = require('./companion-auto-update.cjs');
const { computeWorkbenchAndDshBounds, detachBrowserViews } = require('./embedded-browser-manager.cjs');
const { createDshHost, DEFAULT_VERSION: DSH_PINNED_VERSION, resolveDshCliEntry } = require('./dsh-host.cjs');
const { viewsForShellView, DSH_SESSION_PARTITION, isDshPartitionAllowed, shellViewShowsDsh, sameDshOrigin, fingerSurfaceForShellView } = require('./dsh-workbench-views.cjs');
const { isLeasedRoomView, normalizeResidentShellView } = require('./shell-rooms.cjs');
const { createLeasedRoomStore } = require('./shell-leased-rooms.cjs');
const {
  readDshPaneWidthFromSettings,
  withDshPaneWidth,
  readDshPaneCollapsedFromSettings,
  withDshPaneCollapsed,
  clampDshPaneWidth,
  DSH_PANE_WIDTH_DEFAULT,
} = require('./dsh-pane-width.cjs');
const {
    writeDshContextInject,
    writeDshPatchFile,
    writeDshHandoff,
    clearDshHandoff,
    writeComposerSuggested,
    clearComposerSuggested,
    formatWorkspaceDocumentForDsh,
    dshPluginEnv,
  } = require('./dsh-context-inject.cjs');
const { buildFillDshComposerScript } = require('./dsh-composer-fill.cjs');
const { createWorkspaceDocumentStore, workspaceEventsForCompartment, pickHostForSend } = require('./workspace-document-store.cjs');
const { createWorkshopFileTreeHost, uniqueRoots, isPathInside } = require('./workshop-file-tree.cjs');
const {
  registerWorkshopMediaScheme,
  attachWorkshopMediaProtocol,
} = require('./workshop-media-protocol.cjs');
registerWorkshopMediaScheme(protocol);
const {
  workshopFolderSourceOfTruthFromState,
  filterWorkbenchDocumentEvents,
} = require('./workshop-folder-source.cjs');
const { createConnectionPackageBridge } = require('./connectionPackageBridge.cjs');
const { createHostPrimitiveBridge } = require('./host-primitive-bridge.cjs');
const { createDshWorkspaceTools, createDshWorkspaceHttp } = require('./dsh-workspace-tool.cjs');
const { connectedHostsFromDrafts, sendHostErrorSuggestSurface } = require('./workspace-finger-hosts.cjs');
const { createAgentStore } = require('./agent-store.cjs');
const { createAgentBodyHost } = require('./agent-body-host.cjs');
const { listSkillEntries } = require('./agent-skills.cjs');
const { buildToolCatalog } = require('./agent-tool-schemas.cjs');
const { createAgentSessionService } = require('./agent-session/index.cjs');
const { createAgentPolicy } = require('./agent-policy.cjs');
const { createAgentWorkbenchClient, TEAM_WEB_PARTITION } = require('./agent-workbench-client.cjs');
const { createAgentScriptHubClient } = require('./agent-script-hub-client.cjs');
const { COPILOT_USAGE_PRIVACY_EXCLUDES, buildCopilotUsageCloudDraft } = require('./agent-usage-cloud-draft.cjs');
const {
  appendProjectMemoryNote,
  listProjectMemoryNotes,
  updateProjectMemoryNote,
  summarizeProjectMemory,
} = require('./agent-memory.cjs');
const {
  STATUS_COMMAND,
  WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
  workbenchLoginActions,
  workflowPromotionActions,
  usageGovernanceActions,
} = require('./agent-blocker-actions.cjs');
const { createBrainAdapter, listBrainCatalog } = require('./brain-adapters/index.cjs');
const { createAgentBodyMcpServer } = require('./agent-body-mcp.cjs');
const { codexAuthStatus, syncCodexAuthFromCloud } = require('./codex-auth-sync.cjs');
const { removeCodexMcpServerConfig } = require('./codex-mcp-config.cjs');

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

/**
 * 进入工作区时卡片会并发创建 WebGL/曾尝试 WebGPU；Electron GPU 进程易被打挂导致 BrowserView 黑屏。
 * 壳内强制关 WebGPU，预览走 WebGL（页面侧 companionShell 检测也会跳过 WebGPU）。
 */
try {
  app.commandLine.appendSwitch('disable-webgpu');
} catch {
  /* ignore */
}

/** 系统代理挂了时，Chromium 仍可能把回环流量送进代理；绕过 127.0.0.1/localhost */
try {
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>;127.0.0.1;localhost;::1');
} catch {
  /* ignore */
}

const DEFAULT_HTTP_PORT = 18765;

const { isProxyOrTransientLoadError } = require('./workbench-load-errors.cjs');

/** 串行化同一 webContents 的 load，避免第二次导航把第一次取消成 ERR_ABORTED */
const workbenchLoadChains = new WeakMap();

/**
 * loadURL + 代理回退（任意用户机）：
 * - 安装包：先 direct（系统代理常把 Chromium 拖进超时，而 WinHTTP/浏览器仍通）
 * - 开发壳：先当前/系统代理（本机 Vite），失败再 direct
 * 可回退错误含 PROXY / ABORTED / CONNECTION_TIMED_OUT(-118) / RESET 等。
 */
async function loadUrlWithProxyFallback(webContents, target) {
  if (!webContents || webContents.isDestroyed()) {
    throw new Error('webContents_destroyed');
  }
  const prev = workbenchLoadChains.get(webContents) || Promise.resolve();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  workbenchLoadChains.set(
    webContents,
    prev.then(
      () => gate,
      () => gate,
    ),
  );
  await prev.catch(() => {});

  const packaged = (() => {
    try {
      return Boolean(app.isPackaged);
    } catch {
      return false;
    }
  })();

  try {
    const ses = webContents.session;
    const setMode = async (mode) => {
      if (ses && typeof ses.setProxy === 'function') {
        await ses.setProxy({ mode });
      }
    };

    if (packaged) {
      try {
        await setMode('direct');
        if (webContents.isDestroyed()) throw new Error('webContents_destroyed');
        await webContents.loadURL(target);
        return;
      } catch (e) {
        if (!isProxyOrTransientLoadError(e)) throw e;
        companionLog(
          'warn',
          '[companion-desktop] loadURL direct failed, retry system proxy:',
          e instanceof Error ? e.message : e,
        );
        if (webContents.isDestroyed()) throw new Error('webContents_destroyed');
        await setMode('system');
        await webContents.loadURL(target);
        return;
      }
    }

    try {
      await webContents.loadURL(target);
      return;
    } catch (e) {
      if (!isProxyOrTransientLoadError(e)) throw e;
      companionLog(
        'warn',
        '[companion-desktop] loadURL failed, retry with direct:',
        e instanceof Error ? e.message : e,
      );
    }
    if (webContents.isDestroyed()) throw new Error('webContents_destroyed');
    await setMode('direct');
    await webContents.loadURL(target);
  } finally {
    release();
  }
}

/** 开发：`npm start`；安装包：未保存过主站时的「打开网站」默认 */
const DEFAULT_SHELL_SITE_DEV = 'http://localhost:3000';
const DEFAULT_SHELL_SITE_PACKAGED = 'https://assetcutter-ai-pro.vercel.app/';
const DEFAULT_AUTH_API_ORIGIN_DEV = 'http://localhost:9100';
const DEFAULT_AUTH_API_ORIGIN_PROD = 'https://assetcutter-auth-api.onrender.com';
const DEFAULT_SCRIPT_HUB_API_DEV = 'http://localhost:8787/';

function defaultShellSiteUrl() {
  try {
    return app.isPackaged ? DEFAULT_SHELL_SITE_PACKAGED : DEFAULT_SHELL_SITE_DEV;
  } catch {
    return DEFAULT_SHELL_SITE_DEV;
  }
}

function defaultScriptHubApiUrl() {
  // Tool Bridge 为本机服务（:8787），与 Workflow 壳页面无关；打包版亦默认连本机 Bridge
  try {
    return DEFAULT_SCRIPT_HUB_API_DEV;
  } catch {
    return DEFAULT_SCRIPT_HUB_API_DEV;
  }
}

function isLocalDevWorkbenchUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.port === '3000' || u.port === '5173');
  } catch {
    return false;
  }
}

/** @type {import('child_process').ChildProcess | null} */
let companion = null;
/** @type {Tray | null} */
let tray = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Map<string, BrowserWindow>} */
const shellToolWindows = new Map();
const SHELL_TOOL_WORKSPACE_KEY = '__tool_workspace__';
const SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH = 52;
const SHELL_TOOL_WORKSPACE_EXPANDED_MIN_WIDTH = 620;
const SHELL_TOOL_WORKSPACE_EXPANDED_MIN_HEIGHT = 400;
const SHELL_TOOL_WORKSPACE_COLLAPSED_MIN_HEIGHT = 160;
/** @type {WeakMap<BrowserWindow, Electron.Rectangle>} */
const shellToolWorkspaceExpandedBounds = new WeakMap();
/** @type {import('electron').BrowserView | null} */
let workbenchBrowserView = null;
/** @type {import('electron').BrowserView | null} */
let dshBrowserView = null;
/** @type {{ start: Function, stop: Function } | null} */
let dshHostController = null;
/** @type {string | null} */
let dshHostUrl = null;
let dshScriptHubClient = null;
const workspaceDocumentStore = createWorkspaceDocumentStore();
const leasedRoomStore = createLeasedRoomStore({
  getPath: () => path.join(app.getPath('userData'), 'shell-leased-rooms.json'),
});
const dshWorkspaceTools = createDshWorkspaceTools({
  store: workspaceDocumentStore,
  writeMode: 'document',
  getFinger: () => workspaceDocumentStore.getSnapshot().finger,
  isWorkshopFolderSourceOfTruth: () => {
    try {
      return workshopFolderSourceOfTruthFromState(workshopFileTreeHost.state());
    } catch {
      return false;
    }
  },
  getConnectionBridge: () =>
    createConnectionPackageBridge({
      companionApiRequest: (method, pathname, body, opts) => companionApiRequest(method, pathname, body, opts),
    }),
  getHostPrimitiveBridge: () =>
    createHostPrimitiveBridge({
      companionApiRequest: (method, pathname, body, opts) => companionApiRequest(method, pathname, body, opts),
    }),
  openSurface: async (view) => openShellSurfaceFromDsh(view),
  getShellView: () => shellMainProcessActiveView,
  syncConnectedHosts: () => syncConnectedHostsFromCompanion(),
  companionApiRequest: (method, pathname, body, opts) => companionApiRequest(method, pathname, body, opts),
  runGenerate: async (command) => {
    try {
      const r = await invokeWorkbenchBridge(
        'generateOnCurrent',
        { presetId: command && command.presetId },
        { timeoutMs: 180000 },
      );
      if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'generate_failed' };
      return { ok: true, resultKey: r.resultKey, companionKey: r.companionKey };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  sendToHost: async (host, command) => {
    const finger = workspaceDocumentStore.getSnapshot().finger;
    const resolved = await workshopFileTreeHost.resolveSendFile(finger);
    if (!resolved || !resolved.ok) {
      return { ok: false, error: (resolved && resolved.error) || 'no_selection' };
    }
    const bridge = createHostPrimitiveBridge({
      companionApiRequest: (method, pathname, body, opts) => companionApiRequest(method, pathname, body, opts),
    });
    const invoked = await bridge.invokeHostPrimitive(
      host && host.id,
      'host.import_file',
      {
        filePath: resolved.fileAbs,
        rel: resolved.fileRel,
        assetId: command && command.assetId,
      },
      { localVersionId: host && host.localVersionId },
    );
    if (!invoked || !invoked.ok) {
      return { ok: false, error: (invoked && invoked.error) || 'host_import_failed' };
    }
    const invokeBody = invoked.result && typeof invoked.result === 'object' ? invoked.result : {};
    const inner = invokeBody.result && typeof invokeBody.result === 'object' ? invokeBody.result : invokeBody;
    if (inner.ok === false) {
      return { ok: false, error: inner.error || inner.message || 'host_import_failed' };
    }
    return {
      ok: true,
      hostId: host && host.id,
      filePath: resolved.fileAbs,
      message: inner.message,
    };
  },
});
workspaceDocumentStore.subscribe((events) => {
  try {
    refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
    const fingerChanged = Array.isArray(events) && events.some((e) => e && e.type === 'finger.changed');
    if (fingerChanged && mainWindow && !mainWindow.isDestroyed()) {
      const finger = workspaceDocumentStore.getSnapshot().finger || {};
      mainWindow.webContents.send('shell-workspace-finger-changed', finger);
    }
    let folderSource = false;
    try {
      folderSource = workshopFolderSourceOfTruthFromState(workshopFileTreeHost.state());
    } catch {
      folderSource = false;
    }
    const toWorkbench = filterWorkbenchDocumentEvents(
      folderSource ? events : workspaceEventsForCompartment(events, 'workshop'),
      folderSource,
    );
    if (!toWorkbench.length) return;
    if (workbenchBrowserView && workbenchBrowserView.webContents && !workbenchBrowserView.webContents.isDestroyed()) {
      workbenchBrowserView.webContents.send('workspace-document-event', toWorkbench);
    }
  } catch {
    /* ignore */
  }
});
let dshWorkspaceHttp = null;
function ensureDshWorkspaceHttp() {
  if (dshWorkspaceHttp) return dshWorkspaceHttp;
  dshWorkspaceHttp = createDshWorkspaceHttp(dshWorkspaceTools, { port: 3081 });
  return dshWorkspaceHttp;
}
const FIRST_PARTY_WEB_PARTITION = TEAM_WEB_PARTITION || 'persist:assetcutter-team';
const LEGACY_FIRST_PARTY_WEB_PARTITIONS = ['persist:assetcutter-workbench', 'persist:assetcutter-script-hub'];
/** 避免给同一 BrowserView 重复注册 `did-finish-load` */
const workbenchPairingInjectHooked = new WeakSet();
/** 避免给同一 BrowserView 重复注册下载接管 */
const workbenchDownloadHooked = new WeakSet();
/** @type {string} */
let shellMainProcessActiveView = 'workbench';

/** 与 `shell/index.html` 侧栏展开宽度一致；收起时为 0（由渲染进程 IPC 同步） */
const SHELL_SIDEBAR_WIDTH_EXPANDED = 56;
/** @type {number} */
let shellWorkbenchSidebarInsetPx = SHELL_SIDEBAR_WIDTH_EXPANDED;
const SHELL_COPILOT_WIDTH_DEFAULT = 360;
const SHELL_COPILOT_WIDTH_MIN = 360;
const SHELL_COPILOT_WIDTH_MAX = 720;
/** Collapsed Copilot leaves no residual rail; titlebar button expands it again. */
const SHELL_COPILOT_WIDTH_COLLAPSED = 0;
/** @type {boolean} */
let shellCopilotCollapsed = false;
/** @type {number} */
let shellCopilotWidthPx = SHELL_COPILOT_WIDTH_DEFAULT;
/** @type {number} */
let shellDshPaneWidthPx = DSH_PANE_WIDTH_DEFAULT;
/** @type {boolean} */
let shellDshPaneCollapsed = false;
const DESKTOP_OBSERVATION_FRAME_LIMIT = 30;
let desktopObservationRuntimeState = {
  enabled: false,
  paused: false,
  permissionGranted: false,
  scope: 'current_window',
  startedAt: 0,
  updatedAt: 0,
};
let desktopObservationFrames = [];
let codexLaunchSetupInFlight = false;
const AUTO_CODEX_SETUP_ARG = '--assetcutter-codex-one-click-setup';
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
/** @type {ReturnType<createAgentStore> | null} */
let agentStore = null;
/** @type {ReturnType<createAgentBodyHost> | null} */
let agentBodyHost = null;
/** @type {ReturnType<createAgentSessionService> | null} */
let agentSessionService = null;
/** @type {ReturnType<createAgentPolicy> | null} */
let agentPolicy = null;
/** @type {ReturnType<createAgentBodyMcpServer> | null} */
let agentMcpServer = null;
/** @type {ReturnType<createAgentWorkbenchClient> | null} */
let agentWorkbenchClient = null;
/** @type {import('./agent-types.d.ts').AgentBrainPort | null} */
let agentBrainInstance = null;
/** @type {string | null} */
let agentBrainInstanceId = null;
/** @type {Map<string, { resolve: (v: boolean) => void; timer: NodeJS.Timeout }>} */
const agentConfirmWaiters = new Map();

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
/** @type {import('child_process').ChildProcess | null} */
let paddleOcrBootstrapChild = null;

function sanitizeDesktopObservationText(value, maxLength = 180) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .replace(/(token|cookie|secret|password|authorization)\s*[:=]\s*[^,\s;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, '[base64 redacted]')
    .slice(0, maxLength);
}

function normalizeDesktopObservationScope(scope) {
  const s = String(scope || '').trim();
  if (s === 'app' || s === 'desktop') return s;
  return 'current_window';
}

function buildDesktopObservationStatus() {
  const frames = desktopObservationFrames.slice(-DESKTOP_OBSERVATION_FRAME_LIMIT);
  return {
    ok: true,
    state: { ...desktopObservationRuntimeState },
    frameLimit: DESKTOP_OBSERVATION_FRAME_LIMIT,
    frameCount: frames.length,
    latestFrame: frames.length ? { ...frames[frames.length - 1] } : null,
    events: frames.map((frame) => ({
      type: 'desktop.observe.frame',
      id: frame.id,
      ts: frame.ts,
      summary: frame.summary,
      scope: frame.scope,
      foregroundApp: frame.foregroundApp,
      foregroundWindowTitle: frame.foregroundWindowTitle,
    })),
  };
}

function startDesktopObservationRuntime(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const now = Date.now();
  desktopObservationRuntimeState = {
    ...desktopObservationRuntimeState,
    enabled: true,
    paused: Boolean(body.paused),
    permissionGranted: Boolean(body.permissionGranted),
    scope: normalizeDesktopObservationScope(body.scope),
    startedAt: desktopObservationRuntimeState.startedAt || now,
    updatedAt: now,
  };
  return buildDesktopObservationStatus();
}

function appendDesktopObservationFrame(payload) {
  if (
    !desktopObservationRuntimeState.enabled ||
    !desktopObservationRuntimeState.permissionGranted ||
    desktopObservationRuntimeState.paused
  ) {
    return { ok: false, error: 'desktop_observation_not_authorized', ...buildDesktopObservationStatus() };
  }
  const body = payload && typeof payload === 'object' ? payload : {};
  const now = Date.now();
  const frame = {
    id: `desktop_frame_${randomBytes(8).toString('hex')}`,
    type: 'desktop.observe.frame',
    ts: new Date(now).toISOString(),
    scope: normalizeDesktopObservationScope(body.scope || desktopObservationRuntimeState.scope),
    foregroundApp: sanitizeDesktopObservationText(body.foregroundApp, 80),
    foregroundWindowTitle: sanitizeDesktopObservationText(body.foregroundWindowTitle, 120),
    summary: sanitizeDesktopObservationText(body.summary || 'desktop observation frame', 220),
  };
  desktopObservationFrames.push(frame);
  desktopObservationFrames = desktopObservationFrames.slice(-DESKTOP_OBSERVATION_FRAME_LIMIT);
  desktopObservationRuntimeState = {
    ...desktopObservationRuntimeState,
    scope: frame.scope,
    updatedAt: now,
  };
  return buildDesktopObservationStatus();
}

function stopDesktopObservationRuntime() {
  desktopObservationFrames = [];
  desktopObservationRuntimeState = {
    enabled: false,
    paused: false,
    permissionGranted: false,
    scope: desktopObservationRuntimeState.scope || 'current_window',
    startedAt: 0,
    updatedAt: Date.now(),
  };
  return buildDesktopObservationStatus();
}

function anyDesktopBootstrapChildRunning() {
  const sam = samBootstrapChild && samBootstrapChild.exitCode === null && !samBootstrapChild.killed;
  const rem = rembgBootstrapChild && rembgBootstrapChild.exitCode === null && !rembgBootstrapChild.killed;
  const ocr =
    paddleOcrBootstrapChild && paddleOcrBootstrapChild.exitCode === null && !paddleOcrBootstrapChild.killed;
  return Boolean(sam || rem || ocr);
}

function localAuthOriginAlternates(origin) {
  const out = [];
  const add = (value) => {
    try {
      const o = new URL(String(value || '').trim()).origin;
      if (o && !out.includes(o)) out.push(o);
    } catch {
      /* ignore */
    }
  };
  add(origin);
  try {
    const u = new URL(String(origin || '').trim());
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '9100') {
      add(`${u.protocol}//localhost:${u.port}`);
      add(`${u.protocol}//127.0.0.1:${u.port}`);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function shellSiteOriginForAuthWrite() {
  try {
    return new URL(readShellSettings().siteUrl || defaultShellSiteUrl()).origin;
  } catch {
    return '';
  }
}

async function authCookieHeaderForOrigin(origin) {
  try {
    const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
    const cookies = await ses.cookies.get({ url: origin });
    return (cookies || [])
      .filter((c) => c && c.name && c.value != null)
      .map((c) => `${String(c.name)}=${String(c.value)}`)
      .join('; ');
  } catch {
    return '';
  }
}

function shellSettingsPath() {
  return path.join(app.getPath('userData'), 'companion-shell-settings.json');
}

function readShellSettings() {
  const fallbackSite = defaultShellSiteUrl();
  try {
    const p = shellSettingsPath();
    if (!fs.existsSync(p)) {
      return {
        siteUrl: fallbackSite,
        authApiOrigin: '',
        volumeRoot: '',
        downloadDir: '',
        scriptHubApiUrl: defaultScriptHubApiUrl(),
        scriptHubApiToken: '',
        dshPaneWidth: DSH_PANE_WIDTH_DEFAULT,
        dshPaneCollapsed: false,
        workshopTreeRoot: '',
        workshopTreeRoots: [],
        workshopWorkspaceDir: '',
      };
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const siteUrl =
      typeof j.siteUrl === 'string' && j.siteUrl.trim() ? j.siteUrl.trim() : fallbackSite;
    const authApiOrigin =
      typeof j.authApiOrigin === 'string' ? j.authApiOrigin.trim().replace(/\/+$/, '') : '';
    const volumeRoot = typeof j.volumeRoot === 'string' ? j.volumeRoot.trim() : '';
    const workshopTreeRoot = typeof j.workshopTreeRoot === 'string' ? j.workshopTreeRoot.trim() : '';
    const workshopTreeRoots = uniqueRoots([
      ...(Array.isArray(j.workshopTreeRoots) ? j.workshopTreeRoots : []),
      workshopTreeRoot,
    ]);
    const downloadDir = typeof j.downloadDir === 'string' ? j.downloadDir.trim() : '';
    const workshopWorkspaceDir = typeof j.workshopWorkspaceDir === 'string' ? j.workshopWorkspaceDir.trim() : '';
    const rawScriptHubApi =
      typeof j.scriptHubApiUrl === 'string' && j.scriptHubApiUrl.trim()
        ? j.scriptHubApiUrl.trim()
        : defaultScriptHubApiUrl();
    const scriptHubApiUrl = normalizeScriptHubApiUrl(rawScriptHubApi) || defaultScriptHubApiUrl();
    const scriptHubApiToken =
      typeof j.scriptHubApiToken === 'string' ? j.scriptHubApiToken.trim() : '';
    let settingsDirty = false;
    if (scriptHubApiUrl !== rawScriptHubApi) {
      j.scriptHubApiUrl = scriptHubApiUrl;
      settingsDirty = true;
    }
    if (settingsDirty) {
      try {
        fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, 'utf8');
      } catch {
        /* ignore */
      }
    }
    return {
      siteUrl,
      authApiOrigin,
      volumeRoot,
      workshopTreeRoot: workshopTreeRoots[0] || '',
      workshopTreeRoots,
      workshopWorkspaceDir,
      downloadDir,
      scriptHubApiUrl,
      scriptHubApiToken,
      dshPaneWidth: readDshPaneWidthFromSettings(j),
      dshPaneCollapsed: readDshPaneCollapsedFromSettings(j),
    };
  } catch {
    return {
      siteUrl: fallbackSite,
      authApiOrigin: '',
      volumeRoot: '',
      workshopTreeRoot: '',
      workshopTreeRoots: [],
      workshopWorkspaceDir: '',
      downloadDir: '',
      scriptHubApiUrl: defaultScriptHubApiUrl(),
      scriptHubApiToken: '',
      dshPaneWidth: DSH_PANE_WIDTH_DEFAULT,
      dshPaneCollapsed: false,
    };
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
  if (patch && Array.isArray(patch.workshopTreeRoots)) {
    cur.workshopTreeRoots = uniqueRoots(patch.workshopTreeRoots);
    cur.workshopTreeRoot = cur.workshopTreeRoots[0] || '';
  }
  if (patch && typeof patch.workshopTreeRoot === 'string' && !Array.isArray(patch.workshopTreeRoots)) {
    let v = patch.workshopTreeRoot.trim();
    if (v) {
      try {
        v = path.resolve(path.normalize(v));
      } catch {
        /* ignore */
      }
    }
    cur.workshopTreeRoots = uniqueRoots([...(cur.workshopTreeRoots || []), v]);
    cur.workshopTreeRoot = cur.workshopTreeRoots[0] || '';
  }
  if (patch && typeof patch.workshopWorkspaceDir === 'string') {
    let w = patch.workshopWorkspaceDir.trim();
    if (w) {
      try {
        w = path.resolve(path.normalize(w));
      } catch {
        /* ignore */
      }
      for (const root of cur.workshopTreeRoots || []) {
        if (root && isPathInside(root, w)) {
          w = cur.workshopWorkspaceDir || '';
          break;
        }
      }
    }
    cur.workshopWorkspaceDir = w;
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
  if (patch && typeof patch.scriptHubApiUrl === 'string') {
    const t = patch.scriptHubApiUrl.trim();
    cur.scriptHubApiUrl = normalizeScriptHubApiUrl(t) || defaultScriptHubApiUrl();
  }
  if (patch && typeof patch.scriptHubApiToken === 'string') {
    cur.scriptHubApiToken = patch.scriptHubApiToken.trim();
  }
  if (patch && patch.dshPaneWidth != null) {
    Object.assign(cur, withDshPaneWidth(cur, patch.dshPaneWidth));
    shellDshPaneWidthPx = cur.dshPaneWidth;
  }
  if (patch && patch.dshPaneCollapsed != null) {
    Object.assign(cur, withDshPaneCollapsed(cur, patch.dshPaneCollapsed));
    shellDshPaneCollapsed = cur.dshPaneCollapsed;
  }
  fs.mkdirSync(path.dirname(shellSettingsPath()), { recursive: true });
  fs.writeFileSync(shellSettingsPath(), `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
  return cur;
}

const workshopFileTreeHost = createWorkshopFileTreeHost({
  getRoots: () => readShellSettings().workshopTreeRoots || [],
  setRoots: (roots) => saveShellSettings({ workshopTreeRoots: roots }),
  getWorkspaceDir: () => readShellSettings().workshopWorkspaceDir || '',
  setWorkspaceDir: (dir) => saveShellSettings({ workshopWorkspaceDir: dir || '' }),
  nativeImage,
  pickDirectory: async (opts) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    return dialog.showOpenDialog(win || undefined, {
      title: String(opts && opts.title ? opts.title : '添加文件夹'),
      properties: ['openDirectory'],
    });
  },
});

function getAgentStoreRoot() {
  const sandboxRoot = companionSandboxPaths.getCompanionSandboxRoot();
  if (sandboxRoot) return path.join(sandboxRoot, 'agent-store');
  return path.join(app.getPath('userData'), 'agent-store');
}

function getCopilotEffectiveWidthPx() {
  return shellCopilotCollapsed ? SHELL_COPILOT_WIDTH_COLLAPSED : shellCopilotWidthPx;
}

function notifyShellViewSync(view) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('shell-sync-view', { view });
    } catch {
      /* ignore */
    }
  }
}

function broadcastAgentSessionEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('agent-session:event', payload || {});
    } catch {
      /* ignore */
    }
  }
}

function cancelAllAgentConfirms() {
  for (const [, w] of agentConfirmWaiters) {
    clearTimeout(w.timer);
    w.resolve({ approved: false, reason: 'cancelled' });
  }
  agentConfirmWaiters.clear();
}

function waitForAgentConfirm(confirmId, meta) {
  const id = String(confirmId || '').trim();
  const timeoutMs =
    meta && Number.isFinite(Number(meta.timeoutMs))
      ? Math.min(600000, Math.max(5000, Number(meta.timeoutMs)))
      : 120000;
  const signal = meta && meta.signal ? meta.signal : null;
  if (signal && signal.aborted) return Promise.resolve({ approved: false, reason: 'cancelled' });
  if (!meta || meta.broadcast !== false) {
    broadcastAgentSessionEvent({
      type: 'confirm_required',
      confirmId: id,
      name: meta && meta.name ? String(meta.name) : 'tool',
      arguments: meta && meta.arguments && typeof meta.arguments === 'object' ? meta.arguments : {},
      sessionId: meta && meta.sessionId ? String(meta.sessionId) : 'default',
      clientId: meta && meta.clientId ? String(meta.clientId) : 'copilot',
      toolCallId: meta && meta.toolCallId ? String(meta.toolCallId) : undefined,
      traceId: meta && meta.traceId ? String(meta.traceId) : undefined,
    });
  }
  return new Promise((resolve) => {
    let timer = null;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      agentConfirmWaiters.delete(id);
      resolve(value);
    };
    const onAbort = () => settle({ approved: false, reason: 'cancelled' });
    timer = setTimeout(() => {
      settle({ approved: false, reason: 'timeout' });
    }, timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    agentConfirmWaiters.set(id, { resolve: settle, timer });
  });
}

function resolveAgentConfirm(confirmId, approved) {
  const id = String(confirmId || '').trim();
  const w = agentConfirmWaiters.get(id);
  if (!w) return { ok: false, error: 'unknown_confirm' };
  clearTimeout(w.timer);
  agentConfirmWaiters.delete(id);
  w.resolve({ approved: Boolean(approved), reason: approved ? 'approved' : 'rejected' });
  return { ok: true };
}

async function invokeWorkbenchBridge(method, args, opts) {
  if (!workbenchBrowserView || workbenchBrowserView.webContents.isDestroyed()) {
    throw new Error('workbench_unavailable');
  }
  const wc = workbenchBrowserView.webContents;
  const payload = JSON.stringify({
    method: String(method || ''),
    args: args && typeof args === 'object' ? args : {},
  });
  const js = `(async () => {
    if (!window.__acAgentWorkbench) return { __bridgeMissing: true };
    return window.__acAgentWorkbench.dispatch(${payload});
  })()`;
  const timeoutMs = Number(opts && opts.timeoutMs);
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000);
  let lastErr = 'bridge_not_registered';
  while (Date.now() < deadline) {
    try {
      const result = await wc.executeJavaScript(js);
      if (result && result.__bridgeMissing) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      return result;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw new Error(lastErr);
}

async function agentRunShellTool(toolId) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'no_shell_window' };
  }
  try {
    return await mainWindow.webContents.executeJavaScript(
      `window.companionShell.openToolWindow(${JSON.stringify(String(toolId || ''))})`,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function agentRunShellBootstrap(engine, opts) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'no_shell_window' };
  }
  const eng = String(engine || '').trim();
  try {
    if (eng === 'sam_local') {
      return await mainWindow.webContents.executeJavaScript('window.companionShell.samLocalBootstrapRun()');
    }
    if (eng === 'rembg') {
      return await mainWindow.webContents.executeJavaScript('window.companionShell.rembgBootstrapRun()');
    }
    if (eng === 'paddleocr') {
      const o = opts && typeof opts === 'object' ? opts : {};
      return await mainWindow.webContents.executeJavaScript(
        `window.companionShell.paddleOcrBootstrapRun(${JSON.stringify(o)})`,
      );
    }
    return { ok: false, error: 'unknown_engine' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** @type {Promise<void> | null} */
let agentBrainInitPromise = null;

function resolveAgentBrain() {
  if (!agentStore) return createBrainAdapter('stub');
  if (agentBrainInstance) return agentBrainInstance;
  agentBrainInstance = createBrainAdapter('stub', { store: agentStore });
  agentBrainInstanceId = 'stub';
  return agentBrainInstance;
}

async function ensureAgentBrainReady() {
  if (!agentStore) {
    resolveAgentBrain();
    return;
  }
  if (!agentBrainInitPromise) {
    agentBrainInitPromise = (async () => {
      const settings = agentStore.readSettings();
      let preferred = String(settings.defaultBrainId || 'codex').trim() || 'codex';
      if (preferred !== 'codex') {
        preferred = 'codex';
        agentStore.writeSettings({ defaultBrainId: 'codex' });
      }
      if (preferred === 'stub') {
        agentBrainInstance = createBrainAdapter('stub', { store: agentStore });
        agentBrainInstanceId = 'stub';
        agentStore.writeBrainMeta('stub', { displayName: 'Stub', lastProbeOk: true });
        return;
      }
      const candidate = createBrainAdapter(preferred, { store: agentStore });
      try {
        const probe = await candidate.probe();
        agentStore.writeBrainMeta(preferred, {
          displayName: candidate.displayName,
          lastProbeOk: Boolean(probe.ok),
          lastProbeDetail: probe.detail || null,
          lastProbeAt: new Date().toISOString(),
        });
        if (probe.ok) {
          agentBrainInstance = candidate;
          agentBrainInstanceId = preferred;
          return;
        }
        companionLog(
          'warn',
          `[agent] brain ${preferred} unavailable (${probe.detail || 'probe failed'}), fallback stub`,
        );
      } catch (e) {
        companionLog(
          'warn',
          `[agent] brain ${preferred} probe error:`,
          e instanceof Error ? e.message : String(e),
        );
      }
      agentBrainInstance = createBrainAdapter('stub', { store: agentStore });
      agentBrainInstanceId = 'stub';
    })();
  }
  await agentBrainInitPromise;
  if (!agentBrainInstance) resolveAgentBrain();
}

function resetAgentBrainCache() {
  agentBrainInitPromise = null;
  agentBrainInstance = null;
  agentBrainInstanceId = null;
}

async function syncCodexSharedAuthIfEnabled(reason) {
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  const settings = agentStore.readSettings();
  if (!settings.codexSharedAuthEnabled) {
    return { ok: true, skipped: true, status: codexAuthStatus() };
  }
  if (reason === 'startup' && !settings.codexSharedAuthAutoUpdate) {
    return { ok: true, skipped: true, status: codexAuthStatus() };
  }
  try {
    const result = await syncCodexAuthFromCloud(settings, { fetch: fetchCodexSharedAuthWithShellSession });
    agentStore.writeSettings({
      codexSharedAuthLastSyncAt: result.updatedAt || new Date().toISOString(),
      codexSharedAuthLastError: '',
    });
    resetAgentBrainCache();
    return { ...result, status: codexAuthStatus() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    agentStore.writeSettings({
      codexSharedAuthLastError: message,
    });
    return { ok: false, error: message, status: codexAuthStatus() };
  }
}

function headerObjectFromInitHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      out[String(pair[0])] = String(pair[1]);
    }
    return out;
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (value == null) continue;
      out[key] = String(value);
    }
  }
  return out;
}

async function shellSessionCookieHeaderForCodexAuth(url) {
  const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
  const origins = [];
  try {
    origins.push(new URL(String(url || '')).origin);
  } catch {
    /* ignore */
  }
  try {
    const settings = readShellSettings();
    if (settings.siteUrl) origins.push(new URL(settings.siteUrl).origin);
  } catch {
    /* ignore */
  }
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  if (authOrigin) origins.unshift(authOrigin);

  const byName = new Map();
  for (const origin of [...new Set(origins.filter(Boolean))]) {
    try {
      const cookies = await ses.cookies.get({ url: origin });
      for (const cookie of Array.isArray(cookies) ? cookies : []) {
        const name = String(cookie && cookie.name ? cookie.name : '').trim();
        const value = String(cookie && cookie.value != null ? cookie.value : '');
        if (!name || byName.has(name)) continue;
        byName.set(name, value);
      }
    } catch {
      /* keep trying other origins */
    }
  }
  return [...byName.entries()]
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('; ');
}

async function fetchCodexSharedAuthWithShellSession(url, init) {
  const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
  const baseHeaders = headerObjectFromInitHeaders(init && init.headers);
  const cookieHeader = await shellSessionCookieHeaderForCodexAuth(url);
  const hasAuthCookie = cookieHeader
    .split(';')
    .some((part) => isLikelyShellAuthCookieName(String(part || '').split('=')[0].trim()));
  const hasBearer = Boolean(baseHeaders.Authorization || baseHeaders.authorization);
  if (!hasAuthCookie && !hasBearer) {
    throw new Error('http_401: missing_shell_session_cookie');
  }
  return ses.fetch(url, {
    ...(init || {}),
    credentials: 'include',
    headers: {
      ...baseHeaders,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
}

function migrateAgentSettingsToCodexDefault() {
  if (!agentStore) return;
  const settings = agentStore.readSettings();
  if (settings.codexDefaultMigrated) return;
  const current = String(settings.defaultBrainId || '').trim();
  if (current !== 'codex') {
    agentStore.writeSettings({
      defaultBrainId: 'codex',
      codexDefaultMigrated: true,
    });
    resetAgentBrainCache();
    return;
  }
  agentStore.writeSettings({ codexDefaultMigrated: true });
}

function codexSettingsChanged(prev, next) {
  if (!prev || !next) return false;
  return (
    prev.codexCommand !== next.codexCommand ||
    prev.codexCwd !== next.codexCwd ||
    prev.codexModel !== next.codexModel ||
    prev.codexSandbox !== next.codexSandbox
  );
}

function buildCodexRuntimeStatus(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const command = String(s.codexCommand || (process.platform === 'win32' ? 'codex.cmd' : 'codex')).trim();
  const defaultCwd = agentStore && typeof agentStore.codexWorkspaceDir === 'function'
    ? agentStore.codexWorkspaceDir()
    : path.join(getAgentStoreRoot(), 'codex-workspace');
  const cwd = String(s.codexCwd || defaultCwd).trim();
  const cwdExists = Boolean(cwd && fs.existsSync(cwd));
  const auth = codexAuthStatus();
  const defaultBrain = String(s.defaultBrainId || 'codex').trim();
  return {
    command,
    cwd,
    cwdExists,
    model: String(s.codexModel || '').trim(),
    sandbox: String(s.codexSandbox || 'workspace-write').trim(),
    defaultBrain,
    isDefaultBrain: defaultBrain === 'codex',
    auth: {
      exists: Boolean(auth.exists),
      path: auth.path ? String(auth.path) : '',
    },
    readyHint: Boolean(command && cwdExists),
  };
}

function runSetupCommand(command, args, options) {
  return new Promise((resolve) => {
    const opts = options && typeof options === 'object' ? options : {};
    const { timeoutMs, ...spawnOptions } = opts;
    const child = spawn(command, args || [], {
      ...spawnOptions,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, code: null, detail: 'timeout' });
    }, Number(timeoutMs) || 120000);
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        err += chunk.toString('utf8');
      });
    }
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, detail: e instanceof Error ? e.message : String(e) });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        detail: (out || err || '').trim(),
      });
    });
  });
}

async function probeCodexBrainDirect() {
  if (!agentStore) return { ok: false, detail: 'agent_not_ready' };
  const adapter = createBrainAdapter('codex', { store: agentStore });
  try {
    return await adapter.probe();
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function runCodexConversationSmokeTest(options) {
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  const opts = options && typeof options === 'object' ? options : {};
  const timeoutMs = Math.max(10000, Math.min(120000, Number(opts.timeoutMs) || 45000));
  const adapter = createBrainAdapter('codex', { store: agentStore });
  const sessionId = `setup-smoke-${Date.now()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => {
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  let text = '';
  const activities = [];
  try {
    for await (const ev of adapter.streamTurn({
      sessionId,
      messages: [{ role: 'user', content: 'Reply with exactly: assetcutter-codex-ready' }],
      tools: [],
      signal: ac.signal,
    })) {
      if (!ev) continue;
      if (ev.type === 'text_delta') text += String(ev.text || '');
      if (ev.type === 'activity') activities.push({ phase: ev.phase, name: ev.name, detail: ev.detail });
      if (ev.type === 'error') {
        return { ok: false, error: ev.message || 'codex_smoke_failed', text: text.trim(), activities };
      }
      if (ev.type === 'done') break;
    }
    const normalized = text.trim().toLowerCase();
    return {
      ok: normalized.includes('assetcutter-codex-ready'),
      text: text.trim(),
      activities,
      error: normalized.includes('assetcutter-codex-ready') ? null : 'unexpected_codex_smoke_reply',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), text: text.trim(), activities };
  } finally {
    clearTimeout(timer);
    if (typeof adapter.clearSession === 'function') {
      try {
        adapter.clearSession(sessionId);
      } catch {
        /* ignore */
      }
    }
  }
}

function defaultCodexSharedAuthUrl() {
  let authOrigin = resolveAuthApiOriginForCompanionApi() || DEFAULT_AUTH_API_ORIGIN_PROD;
  try {
    const u = new URL(authOrigin);
    const host = String(u.hostname || '').toLowerCase();
    if (
      !String(process.env.COMPANION_AUTH_API_ORIGIN || '').trim() &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1')
    ) {
      authOrigin = DEFAULT_AUTH_API_ORIGIN_PROD;
    }
  } catch {
    authOrigin = DEFAULT_AUTH_API_ORIGIN_PROD;
  }
  if (!authOrigin) return '';
  return `${authOrigin}/api/team/codex/auth`;
}

function shouldReplaceCodexSharedAuthUrl(value, fallback) {
  const current = String(value || '').trim();
  if (!current) return true;
  if (!fallback) return false;
  try {
    const u = new URL(current);
    const host = String(u.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

function codexProbeLooksMissing(probe) {
  const detail = String(probe && probe.detail ? probe.detail : '').toLowerCase();
  return (
    !probe ||
    !probe.ok && (
      detail.includes('is not recognized as an internal or external command') ||
      detail.includes('not recognized') ||
      detail.includes('not found') ||
      detail.includes('enoent') ||
      detail.includes('cannot find') ||
      detail.includes('\u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4') ||
      detail.includes('\u65e0\u6cd5\u8bc6\u522b') ||
      detail.includes('\ufffd') && detail.includes('codex')
    )
  );
}

function knownWindowsNpmPaths() {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  const programFiles = String(process.env.ProgramFiles || 'C:\\Program Files');
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
  const appData = String(process.env.APPDATA || '');
  candidates.push(...portableNodeNpmCandidatesForSetup());
  candidates.push(path.join(programFiles, 'nodejs', 'npm.cmd'));
  candidates.push(path.join(programFilesX86, 'nodejs', 'npm.cmd'));
  if (appData) candidates.push(path.join(appData, 'npm', 'npm.cmd'));
  return candidates;
}

function knownWindowsCodexPaths() {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  const appData = String(process.env.APPDATA || '');
  const programFiles = String(process.env.ProgramFiles || 'C:\\Program Files');
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
  candidates.push(path.join(codexNpmGlobalPrefixForSetup(), 'codex.cmd'));
  if (appData) candidates.push(path.join(appData, 'npm', 'codex.cmd'));
  candidates.push(path.join(programFiles, 'nodejs', 'codex.cmd'));
  candidates.push(path.join(programFilesX86, 'nodejs', 'codex.cmd'));
  return candidates;
}

function setupCommandEnv(extraPaths) {
  const env = { ...process.env };
  const paths = Array.isArray(extraPaths) ? extraPaths.filter(Boolean).map(String) : [];
  if (!paths.length) return env;
  const pathKey = Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH';
  const current = String(env[pathKey] || env.PATH || '');
  const existing = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(existing.map((p) => p.toLowerCase()));
  const merged = [...existing];
  for (const p of paths) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.unshift(p);
    }
  }
  env[pathKey] = merged.join(path.delimiter);
  if (pathKey !== 'PATH') env.PATH = env[pathKey];
  return env;
}

function setupToolPathDirs() {
  if (process.platform !== 'win32') return [];
  const dirs = [];
  const appData = String(process.env.APPDATA || '');
  const programFiles = String(process.env.ProgramFiles || 'C:\\Program Files');
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
  dirs.push(codexNpmGlobalPrefixForSetup());
  dirs.push(...portableNodePathDirsForSetup());
  if (appData) dirs.push(path.join(appData, 'npm'));
  dirs.push(path.join(programFiles, 'nodejs'));
  dirs.push(path.join(programFilesX86, 'nodejs'));
  return dirs;
}

const NODE_LTS_DIST_URL = 'https://nodejs.org/dist/latest-v22.x/';

function nodeWindowsMsiArchForSetup() {
  return os.arch() === 'arm64' ? 'arm64' : 'x64';
}

function portableNodeRuntimeRootForSetup() {
  const root = companionSandboxPaths.sandboxRuntimesRoot() || path.join(app.getPath('userData'), 'runtimes');
  return path.join(root, 'codex-node');
}

function codexNpmGlobalPrefixForSetup() {
  const root = companionSandboxPaths.sandboxRuntimesRoot() || path.join(app.getPath('userData'), 'runtimes');
  return path.join(root, 'codex-npm-global');
}

function setupNpmGlobalEnv(extraPaths) {
  const prefix = codexNpmGlobalPrefixForSetup();
  fs.mkdirSync(prefix, { recursive: true });
  const env = setupCommandEnv([prefix, ...(Array.isArray(extraPaths) ? extraPaths : []), ...setupToolPathDirs()]);
  env.NPM_CONFIG_PREFIX = prefix;
  env.npm_config_prefix = prefix;
  return env;
}

function portableNodePathDirsForSetup() {
  if (process.platform !== 'win32') return [];
  const root = portableNodeRuntimeRootForSetup();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.existsSync(path.join(dir, 'node.exe'))) continue;
    out.push(dir);
    const npmBin = path.join(dir, 'node_modules', 'npm', 'bin');
    if (fs.existsSync(npmBin)) out.push(npmBin);
  }
  return out;
}

function portableNodeNpmCandidatesForSetup() {
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const dir of portableNodePathDirsForSetup()) {
    const npm = path.join(dir, 'npm.cmd');
    if (fs.existsSync(npm)) out.push(npm);
  }
  return out;
}

function psSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function fetchTextDirectForSetup(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e), text: '' });
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { timeout: Number(timeoutMs) || 30000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        resolve({ ok: false, error: `http_${res.statusCode}`, text: '' });
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, error: e instanceof Error ? e.message : String(e), text: '' }));
  });
}

async function fetchTextViaPowerShellForSetup(url, timeoutMs) {
  if (process.platform !== 'win32') return { ok: false, error: 'powershell_fetch_unsupported', text: '' };
  const command =
    `$ProgressPreference='SilentlyContinue';` +
    `$r=Invoke-WebRequest -Uri ${psSingleQuote(url)} -UseBasicParsing -TimeoutSec ${Math.max(5, Math.ceil((Number(timeoutMs) || 30000) / 1000))};` +
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` +
    `Write-Output $r.Content`;
  const result = await runSetupCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeoutMs: Number(timeoutMs) || 30000 },
  );
  return result.ok
    ? { ok: true, text: result.detail || '', method: 'powershell' }
    : { ok: false, error: result.detail || `powershell exited ${result.code}`, text: '', method: 'powershell' };
}

async function fetchTextForSetup(url, timeoutMs) {
  const direct = await fetchTextDirectForSetup(url, timeoutMs);
  if (direct.ok || process.platform !== 'win32') return direct;
  const fallback = await fetchTextViaPowerShellForSetup(url, timeoutMs);
  return fallback.ok ? { ...fallback, directError: direct.error || '' } : { ...direct, fallback };
}

function downloadFileDirectForSetup(url, targetPath, expectedSha256, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const file = fs.createWriteStream(targetPath);
    const hash = createHash('sha256');
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      try {
        file.close();
      } catch {
        /* ignore */
      }
      if (!payload.ok) {
        try {
          fs.rmSync(targetPath, { force: true });
        } catch {
          /* ignore */
        }
      }
      resolve(payload);
    };
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { timeout: Number(timeoutMs) || 300000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        finish({ ok: false, error: `http_${res.statusCode}` });
        return;
      }
      res.on('data', (chunk) => {
        hash.update(chunk);
        file.write(chunk);
      });
      res.on('end', () => {
        file.end(() => {
          const sha256 = hash.digest('hex');
          if (expectedSha256 && sha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
            finish({ ok: false, error: 'sha256_mismatch', sha256 });
            return;
          }
          finish({ ok: true, sha256, filePath: targetPath });
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => finish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    file.on('error', (e) => finish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  });
}

async function downloadFileViaPowerShellForSetup(url, targetPath, expectedSha256, timeoutMs) {
  if (process.platform !== 'win32') return { ok: false, error: 'powershell_download_unsupported' };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const command =
    `$ProgressPreference='SilentlyContinue';` +
    `Invoke-WebRequest -Uri ${psSingleQuote(url)} -OutFile ${psSingleQuote(targetPath)} -UseBasicParsing -TimeoutSec ${Math.max(5, Math.ceil((Number(timeoutMs) || 300000) / 1000))}`;
  const result = await runSetupCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeoutMs: Number(timeoutMs) || 300000 },
  );
  if (!result.ok) {
    try {
      fs.rmSync(targetPath, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, error: result.detail || `powershell exited ${result.code}`, method: 'powershell' };
  }
  try {
    const sha256 = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
    if (expectedSha256 && sha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
      fs.rmSync(targetPath, { force: true });
      return { ok: false, error: 'sha256_mismatch', sha256, method: 'powershell' };
    }
    return { ok: true, sha256, filePath: targetPath, method: 'powershell' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), method: 'powershell' };
  }
}

async function downloadFileForSetup(url, targetPath, expectedSha256, timeoutMs) {
  const direct = await downloadFileDirectForSetup(url, targetPath, expectedSha256, timeoutMs);
  if (direct.ok || process.platform !== 'win32') return direct;
  const fallback = await downloadFileViaPowerShellForSetup(url, targetPath, expectedSha256, timeoutMs);
  return fallback.ok ? { ...fallback, directError: direct.error || '' } : { ...direct, fallback };
}

async function resolveLatestNodeMsiForSetup() {
  const arch = nodeWindowsMsiArchForSetup();
  const sums = await fetchTextForSetup(`${NODE_LTS_DIST_URL}SHASUMS256.txt`, 30000);
  if (!sums.ok) return { ok: false, error: sums.error || 'node_shasums_unavailable' };
  const pattern = new RegExp(`^([a-f0-9]{64})\\s+(node-v[^\\s]+-${arch}\\.msi)$`, 'im');
  const match = String(sums.text || '').match(pattern);
  if (!match) return { ok: false, error: `node_msi_not_found_${arch}` };
  return {
    ok: true,
    sha256: match[1],
    fileName: match[2],
    url: `${NODE_LTS_DIST_URL}${match[2]}`,
  };
}

async function resolveLatestNodeZipForSetup() {
  const arch = nodeWindowsMsiArchForSetup();
  const sums = await fetchTextForSetup(`${NODE_LTS_DIST_URL}SHASUMS256.txt`, 30000);
  if (!sums.ok) return { ok: false, error: sums.error || 'node_shasums_unavailable' };
  const pattern = new RegExp(`^([a-f0-9]{64})\\s+(node-v[^\\s]+-win-${arch}\\.zip)$`, 'im');
  const match = String(sums.text || '').match(pattern);
  if (!match) return { ok: false, error: `node_zip_not_found_${arch}` };
  return {
    ok: true,
    sha256: match[1],
    fileName: match[2],
    url: `${NODE_LTS_DIST_URL}${match[2]}`,
  };
}

async function resolveNpmCommandForSetup() {
  const defaultCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const probe = await runSetupCommand(defaultCommand, ['--version'], {
    timeoutMs: 15000,
    env: setupCommandEnv(setupToolPathDirs()),
  });
  if (probe.ok) return { ok: true, command: defaultCommand, probe };
  for (const candidate of knownWindowsNpmPaths()) {
    if (!fs.existsSync(candidate)) continue;
    const directProbe = await runSetupCommand(candidate, ['--version'], { timeoutMs: 15000 });
    if (directProbe.ok) return { ok: true, command: candidate, probe: directProbe };
  }
  return { ok: false, command: defaultCommand, probe };
}

async function resolveCodexCommandForSetup(npmCommand) {
  const defaultCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const direct = await runSetupCommand(defaultCommand, ['--version'], {
    timeoutMs: 15000,
    env: setupCommandEnv(setupToolPathDirs()),
  });
  if (direct.ok) return { ok: true, command: defaultCommand, probe: direct };
  if (npmCommand) {
    const prefix = await runSetupCommand(npmCommand, ['config', 'get', 'prefix'], {
      timeoutMs: 15000,
      env: setupNpmGlobalEnv(),
    });
    if (prefix.ok && prefix.detail) {
      const dir = prefix.detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || '';
      const candidate = path.join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
      if (candidate && fs.existsSync(candidate)) {
        const probe = await runSetupCommand(candidate, ['--version'], { timeoutMs: 15000 });
        if (probe.ok) return { ok: true, command: candidate, probe };
      }
    }
  }
  for (const candidate of knownWindowsCodexPaths()) {
    if (!fs.existsSync(candidate)) continue;
    const probe = await runSetupCommand(candidate, ['--version'], { timeoutMs: 15000 });
    if (probe.ok) return { ok: true, command: candidate, probe };
  }
  return { ok: false, command: defaultCommand, probe: direct };
}

async function installNodeFromOfficialMsiForSetup(progress) {
  if (process.platform !== 'win32') {
    return { ok: false, skipped: true, error: 'node_msi_auto_install_unsupported' };
  }
  if (typeof progress === 'function') progress('node_msi_resolve', '\u6b63\u5728\u51c6\u5907 Node.js LTS \u5b89\u88c5\u5305');
  const msi = await resolveLatestNodeMsiForSetup();
  if (!msi.ok) return { ok: false, method: 'official_msi', error: msi.error || 'node_msi_resolve_failed' };
  const dir = path.join(os.tmpdir(), `assetcutter-node-lts-${Date.now()}`);
  const target = path.join(dir, msi.fileName);
  if (typeof progress === 'function') progress('node_msi_download', '\u6b63\u5728\u4e0b\u8f7d Node.js LTS');
  const download = await downloadFileForSetup(msi.url, target, msi.sha256, 300000);
  if (!download.ok) {
    return { ok: false, method: 'official_msi', error: download.error || 'node_msi_download_failed', detail: msi.url };
  }
  if (typeof progress === 'function') progress('node_msi_install', '\u6b63\u5728\u5b89\u88c5 Node.js LTS');
  const install = await runSetupCommand('msiexec.exe', ['/i', target, '/qn', '/norestart'], { timeoutMs: 600000 });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (!install.ok) {
    return {
      ok: false,
      method: 'official_msi',
      error: 'node_msi_install_failed',
      detail: install.detail || `msiexec exited ${install.code}`,
    };
  }
  return { ok: true, method: 'official_msi', detail: `${msi.fileName} ${download.sha256}` };
}

async function installPortableNodeForSetup(progress) {
  if (process.platform !== 'win32') {
    return { ok: false, skipped: true, error: 'portable_node_auto_install_unsupported' };
  }
  if (typeof progress === 'function') progress('node_portable_resolve', '\u6b63\u5728\u51c6\u5907\u4fbf\u643a Node.js');
  const zip = await resolveLatestNodeZipForSetup();
  if (!zip.ok) return { ok: false, method: 'portable_zip', error: zip.error || 'node_zip_resolve_failed' };
  const runtimeRoot = portableNodeRuntimeRootForSetup();
  const downloadDir = path.join(runtimeRoot, '_downloads');
  const target = path.join(downloadDir, zip.fileName);
  if (typeof progress === 'function') progress('node_portable_download', '\u6b63\u5728\u4e0b\u8f7d\u4fbf\u643a Node.js');
  const download = await downloadFileForSetup(zip.url, target, zip.sha256, 300000);
  if (!download.ok) {
    return { ok: false, method: 'portable_zip', error: download.error || 'node_zip_download_failed', detail: zip.url };
  }
  if (typeof progress === 'function') progress('node_portable_extract', '\u6b63\u5728\u89e3\u538b\u4fbf\u643a Node.js');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const expand = await runSetupCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${psSingleQuote(target)} -DestinationPath ${psSingleQuote(runtimeRoot)} -Force`,
    ],
    { timeoutMs: 300000 },
  );
  try {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (!expand.ok) {
    return {
      ok: false,
      method: 'portable_zip',
      error: 'node_zip_extract_failed',
      detail: expand.detail || `Expand-Archive exited ${expand.code}`,
    };
  }
  const folderName = zip.fileName.replace(/\.zip$/i, '');
  const nodeDir = path.join(runtimeRoot, folderName);
  const npm = path.join(nodeDir, 'npm.cmd');
  const npmProbe = fs.existsSync(npm)
    ? await runSetupCommand(npm, ['--version'], { timeoutMs: 15000, env: setupCommandEnv([nodeDir]) })
    : { ok: false, detail: 'npm.cmd missing after extract' };
  if (!npmProbe.ok) {
    return { ok: false, method: 'portable_zip', error: 'portable_npm_missing', detail: npmProbe.detail || npm };
  }
  return { ok: true, method: 'portable_zip', detail: `${zip.fileName} ${download.sha256}`, nodeDir, npmCommand: npm };
}

async function installNodeRuntimeForSetup(progress) {
  if (process.platform !== 'win32') {
    return { ok: false, skipped: true, error: 'node_auto_install_unsupported' };
  }
  const wingetProbe = await runSetupCommand('winget', ['--version'], { timeoutMs: 15000 });
  if (!wingetProbe.ok) {
    const msi = await installNodeFromOfficialMsiForSetup(progress);
    if (msi.ok) return { ...msi, winget: { ok: false, detail: wingetProbe.detail || 'winget is not available' } };
    const portable = await installPortableNodeForSetup(progress);
    return portable.ok
      ? { ...portable, winget: { ok: false, detail: wingetProbe.detail || 'winget is not available' }, msi }
      : {
          ok: false,
          method: 'official_msi_then_portable_zip',
          error: portable.error || msi.error || 'winget_missing',
          detail: portable.detail || msi.detail || wingetProbe.detail || 'all Node.js install methods failed',
          winget: { ok: false, detail: wingetProbe.detail || 'winget is not available' },
          msi,
          portable,
        };
  }
  if (typeof progress === 'function') progress('node_winget_install', '\u6b63\u5728\u901a\u8fc7 winget \u5b89\u88c5 Node.js LTS');
  const install = await runSetupCommand(
    'winget',
    [
      'install',
      '--id',
      'OpenJS.NodeJS.LTS',
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ],
    { timeoutMs: 600000 },
  );
  if (!install.ok) {
    const msi = await installNodeFromOfficialMsiForSetup(progress);
    if (msi.ok) return { ...msi, winget: { ok: false, detail: install.detail || `winget exited ${install.code}` } };
    const portable = await installPortableNodeForSetup(progress);
    return portable.ok
      ? { ...portable, winget: { ok: false, detail: install.detail || `winget exited ${install.code}` }, msi }
      : {
          ok: false,
          method: 'winget_then_official_msi_then_portable_zip',
          error: 'node_install_failed',
          detail: `${install.detail || `winget exited ${install.code}`}; ${msi.detail || msi.error || 'official MSI failed'}; ${portable.detail || portable.error || 'portable zip failed'}`,
          winget: { ok: false, detail: install.detail || `winget exited ${install.code}` },
          msi,
          portable,
        };
  }
  return { ok: true, method: 'winget', detail: install.detail };
}

async function installCodexWithNpmForSetup(npmCommand) {
  const install = await runSetupCommand(npmCommand, ['install', '-g', '@openai/codex'], {
    timeoutMs: 300000,
    env: setupNpmGlobalEnv(),
  });
  return {
    ...install,
    npmCommand,
  };
}

async function installCodexCliForSetup(progress) {
  let npm = await resolveNpmCommandForSetup();
  let nodeInstall = { ok: false, skipped: true, reason: 'npm_available' };
  if (!npm.ok) {
    if (typeof progress === 'function') progress('install_node', '\u6b63\u5728\u5b89\u88c5 Node.js \u8fd0\u884c\u73af\u5883');
    nodeInstall = await installNodeRuntimeForSetup(progress);
    if (typeof progress === 'function') progress('probe_npm_after_node', '\u6b63\u5728\u68c0\u67e5 npm');
    npm = await resolveNpmCommandForSetup();
  }
  if (!npm.ok) {
    return {
      ok: false,
      skipped: true,
      error: 'npm_missing',
      detail: (npm.probe && npm.probe.detail) || 'npm is not available',
      nodeInstall,
    };
  }
  const npmCommand = npm.command;
  if (typeof progress === 'function') progress('install_codex_cli', '\u6b63\u5728\u5b89\u88c5 Codex CLI');
  let install = await installCodexWithNpmForSetup(npmCommand);
  let codexNodeFallback = null;
  if (!install.ok && process.platform === 'win32') {
    if (typeof progress === 'function') {
      progress('install_codex_cli_portable', '\u6b63\u5728\u7528\u4fbf\u643a Node/npm \u91cd\u8bd5 Codex CLI');
    }
    codexNodeFallback = await installPortableNodeForSetup(progress);
    if (codexNodeFallback.ok && codexNodeFallback.npmCommand) {
      const retry = await installCodexWithNpmForSetup(codexNodeFallback.npmCommand);
      install = {
        ...retry,
        firstAttempt: install,
        fallback: codexNodeFallback,
      };
    }
  }
  if (!install.ok) {
    return {
      ok: false,
      error: 'codex_install_failed',
      detail: install.detail || `npm exited ${install.code}`,
      nodeInstall,
      fallback: codexNodeFallback,
      firstAttempt: install.firstAttempt || null,
    };
  }
  const finalNpmCommand = install.npmCommand || npmCommand;
  const codex = await resolveCodexCommandForSetup(finalNpmCommand);
  const commandPath = codex.ok && codex.command !== (process.platform === 'win32' ? 'codex.cmd' : 'codex') ? codex.command : '';
  return { ok: true, detail: install.detail, commandPath, nodeInstall, fallback: codexNodeFallback, npmCommand: finalNpmCommand };
}

function sendCodexSetupProgress(options, id, message) {
  const opts = options && typeof options === 'object' ? options : {};
  const runId = String(opts.progressRunId || '').trim();
  if (!runId || !mainWindow || !mainWindow.webContents) return;
  mainWindow.webContents.send('agent-codex-setup-progress', {
    runId,
    id,
    message,
    at: new Date().toISOString(),
  });
}

function codexSetupCheck(id, label, ok, detail, nextAction) {
  return {
    id,
    label,
    ok: Boolean(ok),
    status: ok ? 'ok' : 'failed',
    detail: detail ? String(detail) : '',
    nextAction: !ok && nextAction ? String(nextAction) : '',
  };
}

function codexCloudIdentityNextAction(sync) {
  const error = String(sync && sync.error ? sync.error : '');
  if (!error) return '';
  if (error.startsWith('http_401')) return 'Workbench sign-in is open. Setup will continue after sign-in; if it times out, run one-click setup again.';
  if (error.startsWith('http_404')) return 'Publish the auth-api version that includes /api/team/codex/auth, then update the desktop app.';
  if (error.startsWith('http_503')) return 'Configure CODEX_SHARED_AUTH_JSON_BASE64 or CODEX_SHARED_AUTH_JSON in the cloud auth service.';
  if (error === 'missing_codex_shared_auth_url') return 'Configure the cloud Codex identity URL, or let one-click setup fill the default team route.';
  return 'Check network access to the team identity service, then run one-click setup again.';
}

function codexCliNextAction(probe, install) {
  const installError = String(install && install.error ? install.error : '');
  if (installError === 'npm_missing') return 'Install Node.js/npm or allow the one-click setup to install Node.js, then run setup again.';
  if (installError === 'codex_install_failed') return 'Check network/proxy/npm permissions, then run one-click setup again.';
  const detail = String(probe && probe.detail ? probe.detail : '').toLowerCase();
  if (detail.includes('not logged in') || detail.includes('login') || detail.includes('auth')) {
    return 'Open Codex login once, or enable team Codex identity sync, then run setup again.';
  }
  return 'Install or repair Codex CLI, then run one-click setup again.';
}

function buildCodexSetupChecks(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const settings = p.settings || {};
  const mcp = p.mcp || {};
  const sync = p.sync || {};
  const probe = p.probe || {};
  const smoke = p.smoke || {};
  const install = p.install || {};
  const requireCloudIdentity = p.requireCloudIdentity !== false;
  return [
    codexSetupCheck(
      'local_settings',
      'Local settings',
      settings.defaultBrainId === 'codex',
      'Codex is the default conversation engine.',
      'Run one-click setup again so Copilot can switch the default brain to Codex.',
    ),
    codexSetupCheck(
      'mcp',
      'Local tool channel',
      Boolean(mcp.running || mcp.enabled),
      mcp.running ? `127.0.0.1:${mcp.port}/mcp` : 'MCP is enabled.',
      'Restart the local companion, then run one-click setup again.',
    ),
    codexSetupCheck(
      'cloud_identity',
      'Cloud identity',
      requireCloudIdentity ? Boolean(sync.ok && !sync.skipped) : Boolean(sync.ok || sync.skipped),
      sync.ok ? 'Synced.' : sync.skipped ? 'Skipped.' : sync.error || '',
      codexCloudIdentityNextAction(sync),
    ),
    codexSetupCheck('codex_cli', 'Codex CLI', Boolean(probe.ok), probe.detail || '', codexCliNextAction(probe, install)),
    codexSetupCheck(
      'active_brain',
      'Conversation engine',
      p.activeBrainId === 'codex',
      p.activeBrainId || '',
      'Run one-click setup again after Codex CLI is available.',
    ),
    codexSetupCheck(
      'conversation',
      'Conversation verification',
      Boolean(smoke.ok),
      smoke.ok ? 'Test conversation completed.' : smoke.error || smoke.text || '',
      'Open Codex login or check network/proxy, then run one-click setup with conversation verification again.',
    ),
  ];
}

function buildCodexSetupReport(parts) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const checks = Array.isArray(p.checks) ? p.checks : [];
  return {
    ok: Boolean(p.ok),
    at: new Date().toISOString(),
    desktopVersion: readDesktopShellPackageVersion(),
    activeBrainId: p.activeBrainId ? String(p.activeBrainId) : '',
    cloudIdentitySynced: Boolean(p.cloudIdentitySynced),
    conversationVerified: Boolean(p.conversationVerified),
    checks,
    failed: checks.filter((check) => check && !check.ok).map((check) => check.id || check.label || 'unknown'),
  };
}

async function runCodexOneClickSetup(options) {
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  const opts = options && typeof options === 'object' ? options : {};
  const steps = [];
  const record = (id, result) => {
    steps.push({ id, ...(result && typeof result === 'object' ? result : { ok: Boolean(result) }) });
    return result;
  };

  const progress = (id, message) => sendCodexSetupProgress(opts, id, message);
  progress('start', '\u6b63\u5728\u542f\u52a8 Codex \u4e00\u952e\u914d\u7f6e');

  const before = agentStore.readSettings();
  const previousSetupReport =
    before && before.codexLastSetupReport && typeof before.codexLastSetupReport === 'object'
      ? before.codexLastSetupReport
      : null;
  const codexCwd =
    opts.codexCwd != null
      ? String(opts.codexCwd || '').trim()
      : typeof agentStore.codexWorkspaceDir === 'function'
        ? agentStore.codexWorkspaceDir()
        : before.codexCwd || '';
  const defaultSharedAuthUrl = defaultCodexSharedAuthUrl();
  const codexSharedAuthUrl = shouldReplaceCodexSharedAuthUrl(before.codexSharedAuthUrl, defaultSharedAuthUrl)
    ? defaultSharedAuthUrl
    : before.codexSharedAuthUrl;
  progress('settings', '\u6b63\u5728\u914d\u7f6e\u672c\u673a\u8bbe\u7f6e');
  const patched = agentStore.writeSettings({
    defaultBrainId: 'codex',
    mcpEnabled: true,
    codexCwd,
    codexSharedAuthEnabled: opts.cloudIdentity === false ? before.codexSharedAuthEnabled : true,
    codexSharedAuthAutoUpdate: opts.cloudIdentity === false ? before.codexSharedAuthAutoUpdate : true,
    codexSharedAuthUrl,
  });
  if (agentMcpServer) {
    agentMcpServer.ensureMcpToken(patched);
    await agentMcpServer.syncFromSettings();
  }
  record('settings', { ok: true });

  progress('auth_sync', '\u6b63\u5728\u62c9\u53d6\u4e91\u7aef\u56e2\u961f\u8eab\u4efd');
  const sync = await syncCodexSharedAuthIfEnabled('manual');
  record('auth_sync', sync);

  progress('probe_before_install', '\u6b63\u5728\u68c0\u67e5 Codex CLI');
  const existingCodex = await resolveCodexCommandForSetup();
  record('resolve_existing_codex_cli', existingCodex);
  if (existingCodex && existingCodex.ok && existingCodex.command) {
    const defaultCodexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const currentCommand = String(patched.codexCommand || '').trim();
    if (existingCodex.command !== defaultCodexCommand && currentCommand !== existingCodex.command) {
      progress('codex_command_path', '\u6b63\u5728\u4fdd\u5b58 Codex \u547d\u4ee4\u8def\u5f84');
      agentStore.writeSettings({ codexCommand: existingCodex.command });
      record('codex_command_path', { ok: true, command: existingCodex.command, source: 'existing' });
    }
  }
  let probe = await probeCodexBrainDirect();
  record('probe_before_install', probe);
  let install = { ok: false, skipped: true, reason: 'probe_not_missing' };
  const shouldInstallCodex = opts.install !== false && (
    !existingCodex ||
    !existingCodex.ok ||
    (!probe.ok && codexProbeLooksMissing(probe))
  );
  if (shouldInstallCodex) {
    install = await installCodexCliForSetup(progress);
    record('install_codex_cli', install);
    if (install && install.ok && install.commandPath) {
      progress('codex_command_path', '\u6b63\u5728\u4fdd\u5b58 Codex \u547d\u4ee4\u8def\u5f84');
      agentStore.writeSettings({ codexCommand: install.commandPath });
      record('codex_command_path', { ok: true, command: install.commandPath });
    }
    progress('probe_after_install', '\u6b63\u5728\u590d\u68c0 Codex CLI');
    probe = await probeCodexBrainDirect();
    record('probe_after_install', probe);
  }

  progress('activate', '\u6b63\u5728\u542f\u7528 Codex \u5bf9\u8bdd');
  resetAgentBrainCache();
  await ensureAgentBrainReady();
  let settings = agentStore.readSettings();
  const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
  const activeBrainId = agentSessionService ? agentSessionService.getBrainId() : 'stub';
  const shouldVerifyConversation = opts.verifyConversation !== false;
  const requireCloudIdentity = opts.cloudIdentity !== false;
  let conversation = { ok: false, skipped: true, error: 'not_run' };
  if (shouldVerifyConversation && probe && probe.ok && activeBrainId === 'codex') {
    progress('conversation_test', '\u6b63\u5728\u8fdb\u884c Codex \u6d4b\u8bd5\u5bf9\u8bdd');
    conversation = await runCodexConversationSmokeTest({ timeoutMs: opts.verifyTimeoutMs });
    record('conversation_test', conversation);
  } else if (!shouldVerifyConversation) {
    conversation = { ok: true, skipped: true, error: '' };
  }
  const cloudIdentitySynced = Boolean(sync && sync.ok && !sync.skipped);
  const identityOk = requireCloudIdentity ? cloudIdentitySynced : Boolean(sync && (sync.ok || sync.skipped));
  const setupOk = Boolean(identityOk && probe && probe.ok && activeBrainId === 'codex' && conversation.ok);
  if (setupOk && !settings.brainSetupCompleted) {
    settings = agentStore.writeSettings({ brainSetupCompleted: true });
  }
  const mcpStatus = agentMcpServer ? agentMcpServer.status() : null;
  const mcpConfig = agentMcpServer ? agentMcpServer.buildMcpClientConfig() : null;
  const codexAuth = codexAuthStatus();
  const setupChecks = buildCodexSetupChecks({
    settings,
    mcp: mcpStatus,
    sync,
    probe,
    smoke: conversation,
    install,
    activeBrainId,
    requireCloudIdentity,
  });
  const conversationVerified = Boolean(
    (shouldVerifyConversation && conversation && conversation.ok && !conversation.skipped) ||
      (!shouldVerifyConversation && previousSetupReport && previousSetupReport.conversationVerified),
  );
  const reportCloudIdentitySynced = Boolean(
    cloudIdentitySynced ||
      (!requireCloudIdentity && previousSetupReport && previousSetupReport.cloudIdentitySynced) ||
      (!shouldVerifyConversation && previousSetupReport && previousSetupReport.cloudIdentitySynced),
  );
  const setupReport = buildCodexSetupReport({
    ok: setupOk,
    checks: setupChecks,
    activeBrainId,
    cloudIdentitySynced: reportCloudIdentitySynced,
    conversationVerified,
  });
  settings = agentStore.writeSettings({ codexLastSetupReport: setupReport });
  return {
    ok: setupOk,
    steps,
    authSync: sync,
    install,
    probe,
    conversation,
    settings,
    setupChecks,
    mcp: mcpStatus,
    mcpConfig,
    mcpToolCatalog: await buildAgentMcpToolCatalog(),
    mcpEntranceStatus,
    codexRuntime: buildCodexRuntimeStatus(settings),
    codexAuth,
    activeBrainId,
    cloudIdentitySynced,
    cloudAuthLoginRequired: Boolean(sync && !sync.ok && String(sync.error || '').startsWith('http_401')),
    cloudAuthRouteMissing: Boolean(sync && !sync.ok && String(sync.error || '').startsWith('http_404')),
    cloudAuthNotConfigured: Boolean(sync && !sync.ok && String(sync.error || '').startsWith('http_503')),
    needsLogin: Boolean(!(codexAuth.exists)),
  };
}

function notifyCopilotRefreshOnboarding() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('shell-copilot-refresh-onboarding');
  } catch {
    /* ignore */
  }
}

function maybeFocusCopilotOnboarding() {
  if (!agentStore || !mainWindow || mainWindow.isDestroyed()) return;
  const settings = agentStore.readSettings();
  if (settings.brainSetupCompleted) return;
  shellCopilotCollapsed = false;
  agentStore.writeSettings({ copilotCollapsed: false });
  layoutShellChrome();
  try {
    mainWindow.webContents.send('shell-focus-copilot-onboarding');
  } catch {
    /* ignore */
  }
}

async function openWorkbenchForCodexLaunchLogin() {
  try {
    openMainWindow();
  } catch {
    /* ignore */
  }
  shellCopilotCollapsed = false;
  if (agentStore) agentStore.writeSettings({ copilotCollapsed: false });
  layoutShellChrome();
  await transitionMainProcessShellView('workbench', { notifyRenderer: true });
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  } catch {
    /* ignore */
  }
  try {
    if (workbenchBrowserView && !workbenchBrowserView.webContents.isDestroyed()) {
      workbenchBrowserView.webContents.reload();
    }
  } catch {
    /* ignore */
  }
}

async function waitForShellLoginForCodexLaunch(timeoutMs) {
  const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 120000);
  let last = null;
  while (Date.now() <= deadline) {
    last = await readShellAccountStatus();
    if (last && last.loggedIn) return { ok: true, account: last };
    if (Date.now() >= deadline) break;
    await sleep(Math.min(2000, Math.max(250, deadline - Date.now())));
  }
  return { ok: false, account: last };
}

function argvWantsCodexAutoSetup(argv) {
  const items = Array.isArray(argv) ? argv : process.argv;
  return items.some((item) => String(item || '').trim() === AUTO_CODEX_SETUP_ARG);
}

async function maybeRunCodexOneClickSetupFromLaunch(argv) {
  if (!argvWantsCodexAutoSetup(argv)) return { ok: true, skipped: true };
  if (codexLaunchSetupInFlight) return { ok: true, skipped: true, inFlight: true };
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  codexLaunchSetupInFlight = true;
  const progressRunId = `launch-${Date.now()}-${randomBytes(4).toString('hex')}`;
  try {
    shellCopilotCollapsed = false;
    agentStore.writeSettings({ copilotCollapsed: false, defaultBrainId: 'codex' });
    layoutShellChrome();
    notifyCopilotRefreshOnboarding();
    let result = await runCodexOneClickSetup({
      install: true,
      verifyConversation: true,
      progressRunId,
      source: 'launch_arg',
    });
    if (result && result.cloudAuthLoginRequired) {
      sendCodexSetupProgress(
        { progressRunId },
        'launch_wait_login',
        '需要登录工作台，已打开登录页面；登录后会自动继续配置 Codex。',
      );
      await openWorkbenchForCodexLaunchLogin();
      const login = await waitForShellLoginForCodexLaunch(120000);
      if (login && login.ok) {
        sendCodexSetupProgress({ progressRunId }, 'launch_retry_after_login', '登录完成，继续配置 Codex。');
        result = await runCodexOneClickSetup({
          install: true,
          verifyConversation: true,
          progressRunId,
          source: 'launch_arg_retry_after_login',
          retryAfterLogin: true,
        });
      } else {
        sendCodexSetupProgress({ progressRunId }, 'launch_login_timeout', '仍未检测到工作台登录，稍后可再次一键配置。');
      }
    }
    sendCodexSetupProgress(
      { progressRunId },
      result && result.ok ? 'launch_complete' : 'launch_failed',
      result && result.ok ? 'Codex 自动配置已完成' : 'Codex 自动配置未完成，请查看配置报告',
    );
    notifyCopilotRefreshOnboarding();
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    sendCodexSetupProgress({ progressRunId }, 'launch_failed', error);
    return { ok: false, error };
  } finally {
    codexLaunchSetupInFlight = false;
  }
}

function normalizeScriptHubApiUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return defaultScriptHubApiUrl();
  if (!/^https?:\/\//i.test(t)) return '';
  try {
    return new URL(t).href;
  } catch {
    return '';
  }
}

function detachAllEmbeddedBrowserViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  detachBrowserViews(mainWindow, [workbenchBrowserView, dshBrowserView].filter(Boolean));
}

function syncEmbeddedBrowserViews(nextView) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wanted = viewsForShellView(nextView, { workbench: workbenchBrowserView, dsh: dshBrowserView });
  const known = [workbenchBrowserView, dshBrowserView].filter(Boolean);
  layoutShellChrome();
  const attached = mainWindow.getBrowserViews();
  for (const view of known) {
    const should = wanted.indexOf(view) >= 0;
    const isOn = attached.indexOf(view) >= 0;
    if (should && !isOn) {
      try {
        mainWindow.addBrowserView(view);
      } catch {
        /* ignore */
      }
    }
  }
  layoutShellChrome();
  const attachedAfter = mainWindow.getBrowserViews();
  for (const view of known) {
    const should = wanted.indexOf(view) >= 0;
    const isOn = attachedAfter.indexOf(view) >= 0;
    if (!should && isOn) {
      try {
        mainWindow.removeBrowserView(view);
      } catch {
        /* ignore */
      }
    }
  }
}

function notifyWorkbenchShellView(view) {
  try {
    if (workbenchBrowserView && workbenchBrowserView.webContents && !workbenchBrowserView.webContents.isDestroyed()) {
      workbenchBrowserView.webContents.send('workspace-shell-view', view);
    }
  } catch {
    /* ignore */
  }
}

function applyShellRoomFinger(view) {
  notifyWorkbenchShellView(view);
  if (view === 'workbench') return;
  if (!shellViewShowsDsh(view)) return;
  workspaceDocumentStore.dispatch({ type: 'set_finger', finger: { surface: fingerSurfaceForShellView(view) } });
}

function normalizeShellViewName(view) {
  const known = normalizeResidentShellView(view);
  if (!known) return 'workbench';
  if (isLeasedRoomView(known) && !leasedRoomStore.has(known)) return 'workbench';
  return known;
}

async function openShellSurfaceFromDsh(view) {
  const requested = String(view || '');
  const v = normalizeShellViewName(requested);
  if (isLeasedRoomView(requested) && v !== requested) {
    return { ok: false, error: 'unknown_surface' };
  }
  return transitionMainProcessShellView(v, { notifyRenderer: true });
}

async function restoreEmbeddedViewForShellState(view) {
  const v = normalizeShellViewName(view);
  if (v === 'workbench') {
    return attachWorkbenchBrowserView();
  }
  syncEmbeddedBrowserViews(v);
  return attachDshForCurrentShellView();
}

/**
 * 切换主进程壳视图；嵌入页 attach 失败时回滚到 prev 并恢复 BrowserView。
 * @param {string} nextView
 * @param {{ notifyRenderer?: boolean }} [opts]
 */
async function transitionMainProcessShellView(nextView, opts) {
  const notifyRenderer = Boolean(opts && opts.notifyRenderer);
  const v = normalizeShellViewName(nextView);
  const prev = shellMainProcessActiveView;
  shellMainProcessActiveView = v;

  if (!mainWindow || mainWindow.isDestroyed()) {
    if (notifyRenderer) notifyShellViewSync(v);
    return { ok: true, view: v };
  }

  let r = { ok: true };
  if (v === 'workbench') {
    r = await attachWorkbenchBrowserView();
  } else {
    syncEmbeddedBrowserViews(v);
    r = await attachDshForCurrentShellView();
  }

  if (!r.ok) {
    shellMainProcessActiveView = prev;
    await restoreEmbeddedViewForShellState(prev);
    return { ok: false, error: r.error, view: prev };
  }

  if (notifyRenderer) notifyShellViewSync(v);
  return { ok: true, view: v };
}

/** 创建沙盒子目录（幂等）；与 `companion-sandbox-paths.cjs` 布局一致 */
function ensureCompanionSandboxLayout() {
  if (process.platform !== 'win32') return;
  const root = companionSandboxPaths.getCompanionSandboxRoot();
  if (!root) return;
  const dirs = [
    path.join(root, 'runtimes'),
    path.join(root, 'models', 'rembg'),
    path.join(root, 'models', 'paddleocr'),
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

function paddleOcrBootstrapScriptPath() {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'paddleocr-bootstrap', 'paddleocr-bootstrap.cjs');
    }
  } catch {
    /* ignore */
  }
  return path.join(__dirname, 'paddleocr-bootstrap', 'paddleocr-bootstrap.cjs');
}

function readPaddleOcrDesktopRuntimeState() {
  if (process.platform !== 'win32') return null;
  try {
    const p = path.join(app.getPath('userData'), 'paddleocr-runtime', 'state.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const exe = typeof j.pythonExe === 'string' ? j.pythonExe.trim() : '';
    if (!j || !j.ready || !exe || !fs.existsSync(exe)) return null;
    return j;
  } catch {
    return null;
  }
}

function resolvePaddleOcrServiceDir() {
  const st = readPaddleOcrDesktopRuntimeState();
  if (st?.serviceDir && fs.existsSync(st.serviceDir)) return st.serviceDir;
  if (app.isPackaged) {
    try {
      const packaged = path.join(process.resourcesPath, 'paddleocr-service');
      if (fs.existsSync(packaged)) return packaged;
    } catch {
      /* ignore */
    }
  }
  return path.join(__dirname, '..', 'local-companion', 'paddleocr-service');
}

/** 注入 PaddleOCR Python / 服务目录 / 设备（默认 CPU；state.json 或 AC_PADDLEOCR_GPU 可设 gpu） */
function applyDesktopPaddleOcrToEnv(env) {
  const st = readPaddleOcrDesktopRuntimeState();
  if (!String(env.COMPANION_PADDLEOCR_PYTHON || '').trim()) {
    const exe =
      (st?.pythonExe && fs.existsSync(st.pythonExe) ? st.pythonExe : '') || resolveDesktopRembgPythonExe();
    if (exe) env.COMPANION_PADDLEOCR_PYTHON = exe;
  }
  if (!String(env.COMPANION_PADDLEOCR_SERVICE_DIR || '').trim()) {
    env.COMPANION_PADDLEOCR_SERVICE_DIR = resolvePaddleOcrServiceDir();
  }
  if (!String(env.COMPANION_PADDLEOCR_DEVICE || '').trim()) {
    const device = typeof st?.device === 'string' ? st.device.trim().toLowerCase() : 'cpu';
    env.COMPANION_PADDLEOCR_DEVICE = device === 'gpu' ? 'gpu' : 'cpu';
  }
  const bundledOcr = path.join(resolvePaddleOcrServiceDir(), 'server.py');
  if (fs.existsSync(bundledOcr) && !String(env.COMPANION_PADDLEOCR_SERVER_SCRIPT || '').trim()) {
    env.COMPANION_PADDLEOCR_SERVER_SCRIPT = bundledOcr;
  }
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
    if (!app.isPackaged && isLocalDevWorkbenchUrl(settings.siteUrl)) {
      return DEFAULT_AUTH_API_ORIGIN_DEV;
    }
  } catch {
    /* ignore */
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

/** 发行 catalog 的 publicInstallUrl 常走 auth-api /api/r2 代理，须把该主机注入伴侣子进程白名单 */
function isLikelyShellAuthCookieName(name) {
  const value = String(name || '');
  return value === 'ac_session' || /(^|[_-])(auth|session|token|jwt|access|refresh|sid)([_-]|$)|next-auth|supabase|sb-/i.test(value);
}

function cookieSetUrlForOrigin(origin, cookie) {
  try {
    const u = new URL(origin);
    const pathValue = String((cookie && cookie.path) || '/');
    u.pathname = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return String(origin || '');
  }
}

function electronCookieSetDetails(origin, cookie) {
  const detail = {
    url: cookieSetUrlForOrigin(origin, cookie),
    name: String(cookie && cookie.name ? cookie.name : ''),
    value: String(cookie && cookie.value != null ? cookie.value : ''),
    path: String((cookie && cookie.path) || '/'),
    secure: Boolean(cookie && cookie.secure),
    httpOnly: Boolean(cookie && cookie.httpOnly),
  };
  if (cookie && cookie.domain && !cookie.hostOnly) detail.domain = cookie.domain;
  if (cookie && Number.isFinite(Number(cookie.expirationDate))) detail.expirationDate = Number(cookie.expirationDate);
  if (cookie && cookie.sameSite) detail.sameSite = cookie.sameSite;
  return detail;
}

async function migrateLegacyFirstPartyCookies(authOrigin, siteOrigin) {
  const out = {
    attempted: false,
    copiedCount: 0,
    skippedReason: '',
    sources: [],
  };
  const origins = [...new Set([authOrigin, siteOrigin].filter(Boolean))];
  if (!origins.length) {
    out.skippedReason = 'origin_unavailable';
    return out;
  }
  const target = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
  const targetAuthCookies = await target.cookies.get({ url: authOrigin || origins[0] });
  const targetHasAuth = (Array.isArray(targetAuthCookies) ? targetAuthCookies : []).some((c) =>
    isLikelyShellAuthCookieName(c && c.name),
  );
  if (targetHasAuth) {
    out.skippedReason = 'target_has_auth_cookie';
    return out;
  }
  out.attempted = true;
  for (const partitionName of LEGACY_FIRST_PARTY_WEB_PARTITIONS) {
    if (partitionName === FIRST_PARTY_WEB_PARTITION) continue;
    const source = session.fromPartition(partitionName);
    const sourceOut = { partition: partitionName, cookieCount: 0, copiedCount: 0, authCookieCount: 0, error: null };
    try {
      for (const origin of origins) {
        const cookies = await source.cookies.get({ url: origin });
        sourceOut.cookieCount += Array.isArray(cookies) ? cookies.length : 0;
        for (const cookie of Array.isArray(cookies) ? cookies : []) {
          if (!cookie || !cookie.name || cookie.value == null) continue;
          if (isLikelyShellAuthCookieName(cookie.name)) sourceOut.authCookieCount += 1;
          await target.cookies.set(electronCookieSetDetails(origin, cookie));
          sourceOut.copiedCount += 1;
          out.copiedCount += 1;
        }
      }
    } catch (e) {
      sourceOut.error = e instanceof Error ? e.message : String(e);
    }
    out.sources.push(sourceOut);
  }
  if (!out.copiedCount) out.skippedReason = 'no_legacy_cookies';
  return out;
}

async function readShellAccountStatus() {
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  const siteUrl = readShellSettings().siteUrl;
  let siteOrigin = null;
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    siteOrigin = null;
  }
  const out = {
    ok: true,
    partition: FIRST_PARTY_WEB_PARTITION,
    authOrigin,
    siteOrigin,
    loggedIn: false,
    user: null,
    cookieCount: 0,
    cookieNames: [],
    hasAuthCookie: false,
    statusCode: 0,
    triedAuthOrigins: [],
    migration: null,
    error: null,
  };
  if (!authOrigin) {
    out.ok = false;
    out.error = 'auth_origin_unavailable';
    return out;
  }
  try {
    out.migration = await migrateLegacyFirstPartyCookies(authOrigin, siteOrigin);
    const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
    const origins = localAuthOriginAlternates(authOrigin);
    let lastError = null;
    for (const origin of origins) {
      const attempt = { origin, statusCode: 0, cookieCount: 0, hasAuthCookie: false, error: null };
      out.triedAuthOrigins.push(attempt);
      try {
        const cookies = await ses.cookies.get({ url: origin });
        const names = Array.isArray(cookies)
          ? cookies.map((c) => String(c && c.name ? c.name : '')).filter(Boolean)
          : [];
        attempt.cookieCount = names.length;
        attempt.hasAuthCookie = names.some((name) => isLikelyShellAuthCookieName(name));
        const res = await ses.fetch(`${origin}/api/auth/me`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        attempt.statusCode = res.status;
        let json = null;
        try {
          const text = await res.text();
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.ok && json && (json.user || json.id || json.username)) {
          out.authOrigin = origin;
          out.statusCode = res.status;
          out.cookieCount = names.length;
          out.cookieNames = names.slice(0, 20);
          out.hasAuthCookie = attempt.hasAuthCookie;
          out.loggedIn = true;
          out.user = json && json.user ? json.user : json;
          out.error = null;
          return out;
        }
        lastError = res.status === 401 ? 'not_logged_in' : `http_${res.status}`;
        out.statusCode = res.status;
        out.cookieCount = names.length;
        out.cookieNames = names.slice(0, 20);
        out.hasAuthCookie = attempt.hasAuthCookie;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attempt.error = msg;
        lastError = msg;
      }
    }
    out.error = lastError || 'not_logged_in';
  } catch (e) {
    out.ok = false;
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

function splitSetCookieHeader(value) {
  const text = String(value || '');
  if (!text) return [];
  const parts = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === ',') {
      const segment = text.slice(start, i);
      if (/expires\s*=/i.test(segment) && !/;\s*/.test(text.slice(i + 1, i + 16))) {
        inExpires = true;
        continue;
      }
      if (inExpires) {
        inExpires = false;
        continue;
      }
      const rest = text.slice(i + 1);
      if (/^\s*[^=;,\s]+=/.test(rest)) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function parseSetCookieForElectron(origin, rawCookie) {
  const raw = String(rawCookie || '').trim();
  if (!raw) return null;
  const parts = raw.split(';').map((p) => p.trim()).filter(Boolean);
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  if (eq <= 0) return null;
  const detail = {
    url: origin,
    name: nameValue.slice(0, eq),
    value: decodeURIComponent(nameValue.slice(eq + 1)),
    path: '/',
    secure: false,
    httpOnly: false,
  };
  for (const attr of attrs) {
    const attrEq = attr.indexOf('=');
    const key = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
    const value = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : '';
    if (key === 'path' && value) detail.path = value;
    else if (key === 'domain' && value) detail.domain = value;
    else if (key === 'max-age') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) detail.expirationDate = Math.floor(Date.now() / 1000) + seconds;
    } else if (key === 'expires') {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) detail.expirationDate = Math.floor(ms / 1000);
    } else if (key === 'secure') detail.secure = true;
    else if (key === 'httponly') detail.httpOnly = true;
    else if (key === 'samesite' && value) {
      const normalized = value.toLowerCase();
      if (normalized === 'lax') detail.sameSite = 'lax';
      else if (normalized === 'strict') detail.sameSite = 'strict';
      else if (normalized === 'none') detail.sameSite = 'no_restriction';
    }
  }
  detail.url = cookieSetUrlForOrigin(origin, detail);
  return detail;
}

async function loginShellAccountWithPassword(args = {}) {
  const identifier = String(args.identifier || '').trim();
  const password = String(args.password || '');
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  const siteUrl = readShellSettings().siteUrl;
  let siteOrigin = '';
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    siteOrigin = '';
  }
  if (!identifier || !password) {
    return { ok: false, code: 'AGENT_SHELL_LOGIN_INVALID_ARGS', error: 'identifier and password are required' };
  }
  if (!authOrigin) {
    return { ok: false, code: 'AGENT_SHELL_LOGIN_ORIGIN_UNAVAILABLE', error: 'auth origin unavailable' };
  }
  const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
  const res = await ses.fetch(`${authOrigin}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(siteOrigin ? { Origin: siteOrigin } : {}),
    },
    body: JSON.stringify({ identifier, password }),
  });
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : splitSetCookieHeader(res.headers.get('set-cookie') || '');
  for (const rawCookie of setCookies) {
    const detail = parseSetCookieForElectron(authOrigin, rawCookie);
    if (!detail || !detail.name) continue;
    await ses.cookies.set(detail);
  }
  let json = null;
  let text = '';
  try {
    text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const account = await readShellAccountStatus();
  if (!res.ok || !account.loggedIn) {
    return {
      ok: false,
      code: res.status === 401 ? 'AGENT_AUTH_REQUIRED' : 'AGENT_SHELL_LOGIN_HTTP',
      statusCode: res.status,
      error: json && json.error ? String(json.error) : text || `login failed with HTTP ${res.status}`,
      account: summarizeShellAccountForAgent(account),
      cookieNames: Array.isArray(setCookies) ? setCookies.map((c) => String(c).split('=')[0]).filter(Boolean) : [],
    };
  }
  return {
    ok: true,
    statusCode: res.status,
    account: summarizeShellAccountForAgent(account),
    cookieNames: Array.isArray(setCookies) ? setCookies.map((c) => String(c).split('=')[0]).filter(Boolean) : [],
  };
}

async function uploadCopilotUsageCloudDraft(opts = {}) {
  const daysRaw = Number(opts && opts.days);
  const limitRaw = Number(opts && opts.limit);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(30, Math.floor(daysRaw)) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50000, Math.floor(limitRaw)) : 5000;
  const dryRun = Boolean(opts && opts.dryRun);
  const account = await readShellAccountStatus();
  const accountSummary = summarizeShellAccountForAgent(account);
  const summary =
    agentStore && typeof agentStore.summarizeUsageAudit === 'function'
      ? agentStore.summarizeUsageAudit({ days, limit })
      : null;
  const draft = buildCopilotUsageCloudDraft(summary, { quotaPolicy: readCopilotUsageQuotaPolicy() });
  const base = {
    ok: false,
    uploaded: false,
    dryRun,
    endpoint: draft.targetApi,
    partition: FIRST_PARTY_WEB_PARTITION,
    account: accountSummary,
    eventCount: draft.eventCount,
    idempotencyScope: draft.idempotencyScope,
    privacyExcludes: Array.isArray(draft.privacy && draft.privacy.excludes)
      ? draft.privacy.excludes.map(String)
      : [...COPILOT_USAGE_PRIVACY_EXCLUDES],
  };
  if (!draft.events.length) {
    return {
      ...base,
      ok: true,
      code: 'AGENT_USAGE_UPLOAD_NO_EVENTS',
      noEvents: true,
      message: 'No local Copilot usage events are available for this window.',
      nextStep: 'Run Copilot work first, then retry when local token usage exists.',
    };
  }
  if (dryRun) {
    return {
      ...base,
      ok: true,
      validated: true,
      message: 'Usage cloud draft is valid; real upload still requires the shell team session.',
      nextStep: 'Retry with dryRun=false after admin approval and an authenticated shell team session.',
    };
  }
  if (!accountSummary.loggedIn) {
    return {
      ...base,
      code: 'AGENT_AUTH_REQUIRED',
      authRequired: true,
      message: 'Shell team session is not logged in; open the embedded Workbench and finish login before uploading usage.',
      recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
      nextStep: 'Open the embedded Workbench, finish login, then retry ac.usage.upload_cloud_draft.',
    };
  }
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  if (!authOrigin) {
    return {
      ...base,
      code: 'AGENT_USAGE_UPLOAD_ORIGIN_UNAVAILABLE',
      message: 'Auth API origin is unavailable.',
    };
  }
  try {
    const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
    const res = await ses.fetch(`${authOrigin}/api/usage/events`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: draft.events }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      return {
        ...base,
        code: res.status === 401 ? 'AGENT_AUTH_REQUIRED' : 'AGENT_USAGE_UPLOAD_HTTP',
        authRequired: res.status === 401,
        statusCode: res.status,
        message: json && json.error ? String(json.error) : text || `Usage upload failed with HTTP ${res.status}.`,
        nextStep:
          res.status === 401
            ? 'Open the embedded Workbench, finish login, then retry ac.usage.upload_cloud_draft.'
            : 'Check the team usage API and retry with the same idempotency scope.',
      };
    }
    return {
      ...base,
      ok: true,
      uploaded: true,
      statusCode: res.status,
      inserted: Number(json && json.inserted) || 0,
      skipped: Number(json && json.skipped) || 0,
      disabled: Boolean(json && json.disabled),
      serverOk: Boolean(json && json.ok),
      message:
        json && json.disabled
          ? 'Usage billing API accepted the request but billing is disabled.'
          : 'Sanitized Copilot usage events were uploaded through the shell session.',
      nextStep:
        json && json.disabled
          ? 'Enable team usage billing/quota policy before treating uploads as enforced governance.'
          : 'Use the team usage/audit UI or API to review the uploaded Copilot usage events.',
    };
  } catch (e) {
    return {
      ...base,
      code: 'AGENT_USAGE_UPLOAD_FAILED',
      message: e instanceof Error ? e.message : String(e),
      nextStep: 'Check the local auth API connection and retry with the same idempotency scope.',
    };
  }
}

function readCopilotUsageQuotaPolicy() {
  const settings = agentStore && typeof agentStore.readSettings === 'function' ? agentStore.readSettings() : null;
  const policy = settings && settings.copilotUsageQuotaPolicy && typeof settings.copilotUsageQuotaPolicy === 'object'
    ? settings.copilotUsageQuotaPolicy
    : {};
  return {
    cloudQuotaEnforced: Boolean(policy.cloudQuotaEnforced),
    usageBillingEnabled: Boolean(policy.usageBillingEnabled),
    currentPhase: policy.currentPhase ? String(policy.currentPhase) : '',
    enforcementSource: policy.enforcementSource ? String(policy.enforcementSource) : '',
    policyId: policy.policyId ? String(policy.policyId) : '',
    billingSku: policy.billingSku ? String(policy.billingSku) : '',
    checkedAt: policy.checkedAt ? String(policy.checkedAt) : '',
  };
}

function listWorkflowPromotionDraftSummaries() {
  if (!agentStore || typeof agentStore.skillsDir !== 'function') return { ok: false, error: 'agent_not_ready', drafts: [] };
  const skillsRoot = agentStore.skillsDir();
  const drafts = listSkillEntries(skillsRoot)
    .map((skill) => ({
      id: skill.id ? String(skill.id) : '',
      name: skill.name ? String(skill.name) : '',
      description: skill.description ? String(skill.description) : '',
      revision: Number.isFinite(Number(skill.revision)) ? Number(skill.revision) : 1,
      updatedAt: skill.updatedAt ? String(skill.updatedAt) : '',
      createdAt: skill.createdAt ? String(skill.createdAt) : '',
      hasWorkbenchPreset: Boolean(skill.workbenchPreset),
      hasScriptManifest: Boolean(skill.scriptManifest),
      promptName: skill.id ? `skill:${skill.id}` : '',
      resourceUri: skill.id ? `skill://${skill.id}` : '',
    }))
    .filter((skill) => skill.id)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  return {
    ok: true,
    skillsRoot,
    count: drafts.length,
    latest: drafts[0] || null,
    drafts,
  };
}

async function probeCopilotUsageQuotaPolicy() {
  const account = await readShellAccountStatus();
  const accountSummary = summarizeShellAccountForAgent(account);
  const base = {
    ok: false,
    account: accountSummary,
    partition: FIRST_PARTY_WEB_PARTITION,
    endpoint: '/api/usage/policy',
  };
  if (!accountSummary.loggedIn) {
    return {
      ...base,
      code: 'AGENT_AUTH_REQUIRED',
      authRequired: true,
      message: 'Shell team session is not logged in; open the embedded Workbench before probing usage policy.',
      recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
      quotaPolicy: readCopilotUsageQuotaPolicy(),
    };
  }
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  if (!authOrigin) {
    return {
      ...base,
      code: 'AGENT_USAGE_POLICY_ORIGIN_UNAVAILABLE',
      message: 'Auth API origin is unavailable.',
      quotaPolicy: readCopilotUsageQuotaPolicy(),
    };
  }
  try {
    const ses = session.fromPartition(FIRST_PARTY_WEB_PARTITION);
    const res = await ses.fetch(`${authOrigin}/api/usage/policy`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      return {
        ...base,
        code: res.status === 401 ? 'AGENT_AUTH_REQUIRED' : 'AGENT_USAGE_POLICY_HTTP',
        authRequired: res.status === 401,
        statusCode: res.status,
        message: json && json.error ? String(json.error) : text || `Usage policy probe failed with HTTP ${res.status}.`,
        quotaPolicy: readCopilotUsageQuotaPolicy(),
      };
    }
    const quotaPolicy = {
      cloudQuotaEnforced: Boolean(json && json.cloudQuotaEnforced),
      usageBillingEnabled: Boolean(json && json.usageBillingEnabled),
      currentPhase: json && json.currentPhase ? String(json.currentPhase) : '',
      enforcementSource: json && json.enforcementSource ? String(json.enforcementSource) : 'auth_api_usage_policy',
      policyId: json && json.policyId ? String(json.policyId) : '',
      billingSku: json && json.billingSku ? String(json.billingSku) : 'copilot.codex.tokens',
      checkedAt: json && json.checkedAt ? String(json.checkedAt) : new Date().toISOString(),
    };
    if (agentStore) agentStore.writeSettings({ copilotUsageQuotaPolicy: quotaPolicy });
    return {
      ...base,
      ok: true,
      statusCode: res.status,
      usageBillingEnabled: Boolean(json && json.usageBillingEnabled),
      quotaPolicy,
      message: quotaPolicy.cloudQuotaEnforced
        ? 'Team usage billing/quota policy is enabled.'
        : 'Usage billing API is reachable, but quota enforcement is disabled.',
    };
  } catch (e) {
    return {
      ...base,
      code: 'AGENT_USAGE_POLICY_PROBE_FAILED',
      message: e instanceof Error ? e.message : String(e),
      quotaPolicy: readCopilotUsageQuotaPolicy(),
    };
  }
}

function summarizeCopilotUsageAudit(options) {
  const summary =
    agentStore && typeof agentStore.summarizeUsageAudit === 'function'
      ? agentStore.summarizeUsageAudit(options && typeof options === 'object' ? options : {})
      : null;
  if (!summary || typeof summary !== 'object') return summary;
  const quotaPolicy = readCopilotUsageQuotaPolicy();
  return {
    ...summary,
    currentPhase: 'local_usage_signal',
    cloudEnforced: Boolean(quotaPolicy.cloudQuotaEnforced),
    cloudDraft: buildCopilotUsageCloudDraft(summary, { quotaPolicy }),
  };
}

function extractWorkbenchProjectForMemory(context) {
  const ctx = context && typeof context === 'object' ? context : {};
  const structured = ctx.structured && typeof ctx.structured === 'object' ? ctx.structured : ctx;
  const activeProject = structured.activeProject && typeof structured.activeProject === 'object' ? structured.activeProject : null;
  const projectId = String(
    structured.activeProjectId ||
      (activeProject && (activeProject.id || activeProject.projectId)) ||
      structured.projectId ||
      '',
  ).trim();
  const projectName = String(
    structured.activeProjectName ||
      (activeProject && (activeProject.name || activeProject.title)) ||
      structured.projectName ||
      projectId ||
      '',
  ).trim();
  return { projectId, projectName, structured };
}

async function readCurrentProjectMemoryScope(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.projectId) {
    return {
      projectId: String(opts.projectId),
      projectName: opts.projectName ? String(opts.projectName) : '',
      context: null,
    };
  }
  if (!agentWorkbenchClient || typeof agentWorkbenchClient.getContext !== 'function') {
    return { projectId: 'unscoped', projectName: '', context: null };
  }
  try {
    const context = await agentWorkbenchClient.getContext();
    const project = extractWorkbenchProjectForMemory(context);
    return {
      projectId: project.projectId || 'unscoped',
      projectName: project.projectName,
      context,
    };
  } catch {
    return { projectId: 'unscoped', projectName: '', context: null };
  }
}

async function listCopilotProjectMemory(options) {
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  const scope = await readCurrentProjectMemoryScope(options);
  const opts = options && typeof options === 'object' ? options : {};
  const notes = listProjectMemoryNotes(agentStore.memoryDir(), {
    projectId: scope.projectId,
    includeDisabled: Boolean(opts.includeDisabled),
    includeDeleted: Boolean(opts.includeDeleted),
    kind: opts.kind,
    limit: opts.limit || 50,
  });
  const summary = summarizeProjectMemory(agentStore.memoryDir(), { projectId: scope.projectId, limit: 200 });
  return {
    ok: true,
    projectId: scope.projectId,
    projectName: scope.projectName,
    notes,
    summary,
  };
}

async function saveCopilotProjectMemory(entry) {
  if (!agentStore) return { ok: false, error: 'agent_not_ready' };
  const payload = entry && typeof entry === 'object' ? entry : {};
  const scope = await readCurrentProjectMemoryScope(payload);
  const result = appendProjectMemoryNote(agentStore.memoryDir(), {
    ...payload,
    projectId: scope.projectId,
    projectName: payload.projectName || scope.projectName,
    source: payload.source || 'copilot-ui',
    confirmedBy: payload.confirmedBy || 'user',
  });
  if (!result.ok) return result;
  const summary = summarizeProjectMemory(agentStore.memoryDir(), { projectId: scope.projectId, limit: 200 });
  return {
    ok: true,
    projectId: scope.projectId,
    projectName: payload.projectName || scope.projectName,
    note: result.note,
    summary,
  };
}

function summarizeShellAccountForAgent(status) {
  const s = status && typeof status === 'object' ? status : {};
  const user = s.user && typeof s.user === 'object' ? s.user : {};
  const migration = s.migration && typeof s.migration === 'object' ? s.migration : null;
  return {
    loggedIn: Boolean(s.loggedIn),
    user: s.loggedIn
      ? {
          id: user.id != null ? String(user.id) : '',
          username: user.username != null ? String(user.username) : '',
          email: user.email != null ? String(user.email) : '',
          name: user.name != null ? String(user.name) : '',
        }
      : null,
    partition: String(s.partition || FIRST_PARTY_WEB_PARTITION),
    authOrigin: s.authOrigin || null,
    siteOrigin: s.siteOrigin || null,
    cookieCount: Number(s.cookieCount) || 0,
    hasAuthCookie: Boolean(s.hasAuthCookie),
    statusCode: Number(s.statusCode) || 0,
    error: s.error || null,
    migration: migration
      ? {
          attempted: Boolean(migration.attempted),
          copiedCount: Number(migration.copiedCount) || 0,
          skippedReason: migration.skippedReason || '',
          sourceCount: Array.isArray(migration.sources) ? migration.sources.length : 0,
        }
      : null,
    nextStep: s.loggedIn
      ? 'Use ac.workbench.ensure_ready before creating projects or running capabilities.'
      : 'Call ac.shell.navigate with { "view": "workbench" }, let the user log in, then retry ac.workbench.ensure_ready.',
  };
}

function summarizeWorkbenchE2eEntrance(e2e, shellAccount) {
  const r = e2e && typeof e2e === 'object' ? e2e : {};
  const account = summarizeShellAccountForAgent(shellAccount);
  return {
    checkedAt: new Date().toISOString(),
    ok: Boolean(r.ok),
    failedStep: r.failedStep ? String(r.failedStep) : '',
    errorCode: r.errorCode ? String(r.errorCode) : '',
    authRequired: Boolean(r.authRequired || r.errorCode === 'AGENT_AUTH_REQUIRED'),
    action: r.action ? String(r.action) : '',
    projectId: r.projectId ? String(r.projectId) : '',
    assetId: r.assetId ? String(r.assetId) : '',
    nextStep: r.nextStep ? String(r.nextStep).slice(0, 500) : '',
    account: {
      loggedIn: account.loggedIn,
      partition: account.partition,
      authOrigin: account.authOrigin,
      siteOrigin: account.siteOrigin,
      cookieCount: account.cookieCount,
      hasAuthCookie: account.hasAuthCookie,
      statusCode: account.statusCode,
      error: account.error,
    },
  };
}

function buildAgentMcpEntranceBlockers(status, settings) {
  const s = status && typeof status === 'object' ? status : {};
  const shellAccount = s.shellAccount && typeof s.shellAccount === 'object' ? s.shellAccount : {};
  const workbenchEntrance = s.workbenchEntrance && typeof s.workbenchEntrance === 'object' ? s.workbenchEntrance : {};
  const workflow = s.workflowPublication && typeof s.workflowPublication === 'object' ? s.workflowPublication : {};
  const usage = s.usageAudit && typeof s.usageAudit === 'object' ? s.usageAudit : {};
  const codexRuntime = buildCodexRuntimeStatus(settings);
  const blockers = [];
  const add = (id, severity, owner, nextStep, detail) => {
    blockers.push({ id, severity, owner, nextStep, ...(detail && typeof detail === 'object' ? detail : {}) });
  };
  if (!agentMcpServer || !agentMcpServer.status || !agentMcpServer.status().running) {
    add('mcp_unavailable', 'critical', 'local_shell', 'Enable and restart the local MCP server before using Copilot as an external Agent body.');
  }
  if (!codexRuntime || !codexRuntime.readyHint) {
    add('codex_runtime_not_ready', 'action_required', 'admin', 'Configure the Codex command/cwd/auth state in Companion Settings.');
  }
  if (!shellAccount.loggedIn) {
    add('workbench_login_required', 'action_required', 'user', 'Open the embedded Workbench and finish login.', {
      command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
      actions: workbenchLoginActions(),
    });
  }
  const entranceStatus = workbenchEntrance.status ? String(workbenchEntrance.status) : '';
  if (entranceStatus && entranceStatus !== 'ready' && entranceStatus !== 'login_required') {
    add(`workbench_${entranceStatus}`, 'action_required', 'admin', workbenchEntrance.nextStep || 'Rerun the Workbench E2E validation.', {
      command: workbenchEntrance.waitLoginCommand || 'npm run smoke:agent-mcp:e2e:wait-login',
      actions: workbenchLoginActions(),
    });
  }
  const promotion = workflow.promotionReadiness && typeof workflow.promotionReadiness === 'object' ? workflow.promotionReadiness : null;
  if (promotion && promotion.publishableNow === false) {
    const promotionTargets = Array.isArray(promotion.targets)
      ? promotion.targets.map((target) => ({
          id: target && target.id ? String(target.id) : '',
          status: target && target.status ? String(target.status) : '',
          plannedTool: target && target.plannedTool ? String(target.plannedTool) : '',
          passedGates: Array.isArray(target && target.passedGates) ? target.passedGates.map(String) : [],
          missingGates: Array.isArray(target && target.missing) ? target.missing.map(String) : [],
          unevaluatedGates: Array.isArray(target && target.unevaluatedGates) ? target.unevaluatedGates.map(String) : [],
          adminConfirmation:
            target && target.adminConfirmation && typeof target.adminConfirmation === 'object'
              ? {
                  required: Boolean(target.adminConfirmation.required),
                  passed: Boolean(target.adminConfirmation.passed),
                  sourceRequired: target.adminConfirmation.sourceRequired
                    ? String(target.adminConfirmation.sourceRequired)
                    : 'copilot_ui',
                  autoConfirmCountsAsAdminApproval: Boolean(target.adminConfirmation.autoConfirmCountsAsAdminApproval),
                }
              : null,
        }))
      : [];
    add('workflow_promotion_draft_only', 'info', 'admin', promotion.reason || 'Workflow drafts are not yet publishable as governed team tools.', {
      command: STATUS_COMMAND,
      phase: promotion.currentPhase || 'draft_only',
      publishableNow: false,
      promotionTargets,
      missingGates: [...new Set(promotionTargets.flatMap((target) => target.missingGates || []))],
      actions: workflowPromotionActions(),
    });
  }
  const usagePhase =
    usage.currentPhase
      ? String(usage.currentPhase)
      : usage.totals && typeof usage.totals === 'object'
        ? 'local_usage_signal'
        : '';
  if (usagePhase === 'local_usage_signal' && !usage.cloudEnforced) {
    const usageCloudDraft = usage.cloudDraft && typeof usage.cloudDraft === 'object' ? usage.cloudDraft : null;
    const usageMissingGates =
      usageCloudDraft && Array.isArray(usageCloudDraft.blockedBy)
        ? [...new Set(usageCloudDraft.blockedBy.map(String).filter(Boolean))]
        : [];
    add('usage_governance_local_only', 'info', 'admin', 'Local Copilot usage is visible, but team quota enforcement and cloud audit are not connected yet.', {
      command: STATUS_COMMAND,
      phase: usagePhase,
      cloudEnforced: false,
      resource: 'assetcutter://mcp/usage-audit',
      missingGates: usageMissingGates,
      actions: usageGovernanceActions(),
      cloudDraft: usageCloudDraft
        ? {
            currentPhase: usageCloudDraft.currentPhase || 'cloud_event_draft',
            targetApi: usageCloudDraft.targetApi || '/api/usage/events',
            eventCount: Number(usageCloudDraft.eventCount) || 0,
            uploadReady: Boolean(usageCloudDraft.uploadReady),
            blockedBy: Array.isArray(usageCloudDraft.blockedBy) ? usageCloudDraft.blockedBy.map(String) : [],
            uploadPlan:
              usageCloudDraft.uploadPlan && typeof usageCloudDraft.uploadPlan === 'object'
                ? {
                    endpoint: usageCloudDraft.uploadPlan.endpoint || '/api/usage/events',
                    method: usageCloudDraft.uploadPlan.method || 'POST',
                    credentials: usageCloudDraft.uploadPlan.credentials || 'include',
                    tool: usageCloudDraft.uploadPlan.tool || 'ac.usage.upload_cloud_draft',
                    idempotencyScope: usageCloudDraft.uploadPlan.idempotencyScope || '',
                    safeToRetry: Boolean(
                      usageCloudDraft.uploadPlan.retry && usageCloudDraft.uploadPlan.retry.safeToRetry,
                    ),
                  }
                : null,
            quotaPolicy:
              usageCloudDraft.quotaPolicy && typeof usageCloudDraft.quotaPolicy === 'object'
                ? {
                    currentPhase: usageCloudDraft.quotaPolicy.currentPhase || 'usage_event_ingestion_ready',
                    billingSku: usageCloudDraft.quotaPolicy.billingSku || 'copilot.codex.tokens',
                    billingSkuRegisteredInDefaultCatalog: Boolean(
                      usageCloudDraft.quotaPolicy.billingSkuRegisteredInDefaultCatalog,
                    ),
                    usageBillingApiConfigured: Boolean(usageCloudDraft.quotaPolicy.usageBillingApiConfigured),
                    cloudQuotaEnforced: Boolean(usageCloudDraft.quotaPolicy.cloudQuotaEnforced),
                    usageBillingEnabled: Boolean(usageCloudDraft.quotaPolicy.usageBillingEnabled),
                    enforcementSource: usageCloudDraft.quotaPolicy.enforcementSource
                      ? String(usageCloudDraft.quotaPolicy.enforcementSource)
                      : '',
                    policyId: usageCloudDraft.quotaPolicy.policyId ? String(usageCloudDraft.quotaPolicy.policyId) : '',
                    probeTool: usageCloudDraft.quotaPolicy.probeTool || 'ac.usage.probe_quota_policy',
                    policyEndpoint: usageCloudDraft.quotaPolicy.policyEndpoint || '/api/usage/policy',
                  }
                : null,
          }
        : null,
    });
  }
  return blockers;
}

async function buildAgentMcpEntranceStatus() {
  if (!agentMcpServer || typeof agentMcpServer.summarizeWorkbenchEntranceState !== 'function') return null;
  const shellAccount = await readShellAccountStatus();
  const settings = agentStore ? agentStore.readSettings() : null;
  const status = {
    shellAccount,
    ...agentMcpServer.summarizeWorkbenchEntranceState(summarizeShellAccountForAgent(shellAccount)),
  };
  if (typeof agentMcpServer.summarizeWorkflowPublicationState === 'function') {
    status.workflowPublication = await agentMcpServer.summarizeWorkflowPublicationState();
  }
  if (agentStore && typeof agentStore.summarizeUsageAudit === 'function') {
    status.usageAudit = summarizeCopilotUsageAudit({ days: 1, limit: 5000 });
  }
  status.blockers = buildAgentMcpEntranceBlockers(status, settings);
  status.workbenchUsable = Boolean(status.workbenchEntrance && status.workbenchEntrance.ready);
  status.teamEntranceReady = Boolean(status.workbenchUsable && status.blockers.length === 0);
  status.teamEntrancePhase = status.teamEntranceReady ? 'ready' : status.workbenchUsable ? 'governance_blocked' : 'workbench_blocked';
  status.teamEntranceBlockers = status.blockers.map((blocker) => String(blocker && blocker.id ? blocker.id : 'unknown'));
  return status;
}

function applyCompanionBundleDownloadTrustEnv(env) {
  const authOrigin = resolveAuthApiOriginForCompanionApi();
  if (authOrigin) {
    env.COMPANION_AUTH_API_ORIGIN = authOrigin;
  }
  const hosts = new Set();
  const existing = String(env.COMPANION_HOST_BUNDLE_TRUST_HOSTS || '').trim();
  if (existing) {
    for (const part of existing.split(',')) {
      const h = part.trim().toLowerCase();
      if (h) hosts.add(h);
    }
  }
  if (authOrigin) {
    try {
      hosts.add(new URL(authOrigin).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  try {
    const site = String(readShellSettings().siteUrl || '').trim();
    if (site) hosts.add(new URL(site).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  if (hosts.size > 0) {
    env.COMPANION_HOST_BUNDLE_TRUST_HOSTS = [...hosts].join(',');
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

async function fetchShellToolCatalogFromSite() {
  const r = await fetchHostBundleCatalogFromSite();
  if (!r.ok) return r;
  const artifacts = (r.artifacts || []).filter((a) => a && a.kind === 'shell_tool_bundle');
  return { ok: true, artifacts };
}

async function submitShellToolForReview(toolIdRaw) {
  const toolId = String(toolIdRaw || '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) {
    return { ok: false, error: 'invalid_tool_id' };
  }
  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };

  const pack = await companionApiRequest('POST', `/v1/shell-tools/authored/${encodeURIComponent(toolId)}/pack`, {}, {
    timeoutMs: 120000,
  });
  if (!pack.ok || !pack.json || !pack.json.zipPath) {
    return { ok: false, error: pack.json?.error || pack.text || 'pack_failed' };
  }
  const zipPath = String(pack.json.zipPath);
  let buf;
  try {
    buf = await fsp.readFile(zipPath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const sha256 = require('node:crypto').createHash('sha256').update(buf).digest('hex');
  const fileName = String(pack.json.fileName || path.basename(zipPath));
  const semver = String(pack.json.semver || '0.1.0');

  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const authMe = await readShellAccountStatus();
  if (!authMe || !authMe.loggedIn) {
    return { ok: false, error: 'not_logged_in', message: '请先在工作台登录团队账号后再提交审批' };
  }

  if (authMe.authOrigin) origin = authMe.authOrigin;
  const writeOrigin = shellSiteOriginForAuthWrite();
  const cookieHeader = await authCookieHeaderForOrigin(origin);
  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(writeOrigin ? { Origin: writeOrigin } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
  const presign = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/shell-tool-submissions/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: JSON.stringify({ fileName, contentType: 'application/zip' }),
  });
  if (!presign.ok || !presign.json || !presign.json.uploadUrl) {
    return {
      ok: false,
      error: presign.json?.error || presign.text || 'presign_failed',
      status: presign.status,
    };
  }

  try {
    const putRes = await fetch(presign.json.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presign.json.contentType || 'application/zip' },
      body: buf,
    });
    if (!putRes.ok) {
      return { ok: false, error: `upload_failed_${putRes.status}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const detail = await companionApiRequest('GET', `/v1/shell-tools/${encodeURIComponent(toolId)}`, null, {
    timeoutMs: 15000,
  });
  const label = detail.json?.tool?.name || toolId;
  const notes = detail.json?.tool?.description || '';

  const reg = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/shell-tool-submissions`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: JSON.stringify({
      toolId,
      semver,
      label,
      notes,
      fileName,
      r2Key: presign.json.objectKey,
      sha256,
      bytes: buf.length,
    }),
  });
  if (!reg.ok || !reg.json || !reg.json.submission) {
    return { ok: false, error: reg.json?.error || reg.text || 'register_failed', status: reg.status };
  }

  await companionApiRequest(
    'POST',
    `/v1/shell-tools/${encodeURIComponent(toolId)}/review-status`,
    { reviewStatus: 'pending', submissionId: reg.json.submission.id },
    { timeoutMs: 15000 },
  );

  return { ok: true, submissionId: reg.json.submission.id, submission: reg.json.submission };
}

async function publishShellToolToCloud(toolIdRaw) {
  const toolId = String(toolIdRaw || '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) {
    return { ok: false, error: 'invalid_tool_id' };
  }
  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };

  const authMe = await readShellAccountStatus();
  const user = authMe && authMe.user && typeof authMe.user === 'object' ? authMe.user : {};
  if (!authMe || !authMe.loggedIn) {
    return { ok: false, error: 'not_logged_in', message: 'Please log in before publishing tools.' };
  }
  if (String(user.role || '') !== 'admin') {
    return { ok: false, error: 'admin_required', message: 'Only admins can publish tools to cloud.' };
  }
  if (authMe.authOrigin) origin = authMe.authOrigin;
  const writeOrigin = shellSiteOriginForAuthWrite();
  const cookieHeader = await authCookieHeaderForOrigin(origin);
  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(writeOrigin ? { Origin: writeOrigin } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const pack = await companionApiRequest('POST', `/v1/shell-tools/authored/${encodeURIComponent(toolId)}/pack`, {}, {
    timeoutMs: 120000,
  });
  if (!pack.ok || !pack.json || !pack.json.zipPath) {
    return { ok: false, error: pack.json?.error || pack.text || 'pack_failed' };
  }

  const zipPath = String(pack.json.zipPath);
  let buf;
  try {
    buf = await fsp.readFile(zipPath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const sha256 = require('node:crypto').createHash('sha256').update(buf).digest('hex');
  const fileName = String(pack.json.fileName || path.basename(zipPath));
  const semver = String(pack.json.semver || '0.1.0');
  const safeBase = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || `${toolId}.zip`;
  const objectKey = `public/companion-distribution/shell-tools/${toolId}/${Date.now()}_${safeBase}`;

  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const presign = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/admin/companion-artifacts/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: JSON.stringify({ fileName, objectKey, contentType: 'application/zip' }),
  });
  if (!presign.ok || !presign.json || !presign.json.uploadUrl) {
    return {
      ok: false,
      error: presign.json?.error || presign.text || 'presign_failed',
      status: presign.status,
    };
  }

  try {
    const putRes = await fetch(presign.json.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presign.json.contentType || 'application/zip' },
      body: buf,
    });
    if (!putRes.ok) {
      return { ok: false, error: `upload_failed_${putRes.status}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const detail = await companionApiRequest('GET', `/v1/shell-tools/${encodeURIComponent(toolId)}`, null, {
    timeoutMs: 15000,
  });
  const label = detail.json?.tool?.name || toolId;
  const notesBase = detail.json?.tool?.description || '';
  const notes = `${notesBase}\n#toolId:${toolId}`.trim();

  const reg = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/admin/companion-artifacts`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: JSON.stringify({
      kind: 'shell_tool_bundle',
      semver,
      channel: 'stable',
      platform: 'universal',
      fileName,
      r2Key: presign.json.objectKey || objectKey,
      sha256,
      bytes: buf.length,
      notes,
      label,
    }),
  });
  if (!reg.ok || !reg.json || !reg.json.artifact) {
    return { ok: false, error: reg.json?.error || reg.text || 'register_failed', status: reg.status };
  }

  await companionApiRequest(
    'POST',
    `/v1/shell-tools/${encodeURIComponent(toolId)}/review-status`,
    { reviewStatus: 'approved', submissionId: reg.json.artifact.id },
    { timeoutMs: 15000 },
  );

  return { ok: true, artifact: reg.json.artifact };
}

function stripHostBridgeRuntimeFields(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const {
    source,
    draftStatus,
    createdBy,
    createdAt,
    updatedAt,
    validation,
    installs,
    lastProbe,
    cloudVersion,
    cloudVersionId,
    cloudVersions,
    ...definition
  } = raw;
  return definition;
}

async function syncHostBridgesFromCloud() {
  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };
  const authMe = await readShellAccountStatus();
  if (authMe && authMe.authOrigin) origin = authMe.authOrigin;
  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const catalog = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/host-bridges`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!catalog.ok || !catalog.json) {
    return { ok: false, error: catalog.json?.error || catalog.text || `http_${catalog.status}`, status: catalog.status };
  }
  const hosts = Array.isArray(catalog.json.hosts) ? catalog.json.hosts : [];
  const versions = [];
  for (const host of hosts) {
    const hostId = String(host && host.hostId ? host.hostId : host && host.definition && host.definition.id ? host.definition.id : '').trim();
    if (!hostId) continue;
    const vr = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/host-bridges/${encodeURIComponent(hostId)}/versions`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (vr.ok && vr.json && Array.isArray(vr.json.versions)) {
      for (const version of vr.json.versions) versions.push(version);
    } else {
      versions.push(host);
    }
  }
  const synced = await companionApiRequest('POST', '/v1/bridges/cloud/sync', { versions }, { timeoutMs: 30000 });
  if (!synced.ok) return { ok: false, error: synced.json?.error || synced.text || 'local_sync_failed' };
  return {
    ok: true,
    synced: Number(synced.json?.synced) || 0,
    skipped: Number(synced.json?.skipped) || 0,
    remoteCount: versions.length,
  };
}

async function publishHostBridgeToCloud(payload) {
  const hostId = String(payload && payload.hostId ? payload.hostId : '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(hostId)) return { ok: false, error: 'invalid_host_id' };
  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };
  const authMe = await readShellAccountStatus();
  const user = authMe && authMe.user && typeof authMe.user === 'object' ? authMe.user : {};
  if (!authMe || !authMe.loggedIn) return { ok: false, error: 'not_logged_in', message: '请先在工作台登录。' };
  if (String(user.role || '') !== 'admin') return { ok: false, error: 'admin_required', message: '当前账号不是管理员。' };
  if (authMe.authOrigin) origin = authMe.authOrigin;
  const drafts = await companionApiRequest('GET', '/v1/bridges/drafts', null, { timeoutMs: 15000 });
  const draft = drafts.json && Array.isArray(drafts.json.drafts) ? drafts.json.drafts.find((item) => item && item.id === hostId) : null;
  const definition = stripHostBridgeRuntimeFields(draft);
  if (!definition) return { ok: false, error: 'draft_not_found', message: '未找到本地宿主草稿。' };
  if (draft.validation && draft.validation.ok === false) {
    return { ok: false, error: 'draft_invalid', message: (draft.validation.messages || []).join('；') || '草稿校验未通过。' };
  }
  if (!Array.isArray(draft.installs) || !draft.installs.length) {
    return { ok: false, error: 'acceptance_required', message: '请先安装并完成至少一次本地验收，再提交云端。' };
  }
  if (!draft.lastProbe || draft.lastProbe.ok !== true) {
    return { ok: false, error: 'probe_required', message: '请先完成一次真实连接探测成功，再提交云端。' };
  }

  const writeOrigin = shellSiteOriginForAuthWrite();
  const cookieHeader = await authCookieHeaderForOrigin(origin);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(writeOrigin ? { Origin: writeOrigin } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const r = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/admin/host-bridges/${encodeURIComponent(hostId)}/versions`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      definition,
      semver: payload && payload.semver,
      note: payload && payload.note,
    }),
  });
  if (!r.ok || !r.json || !r.json.version) {
    return { ok: false, error: r.json?.error || r.text || `http_${r.status}`, message: r.json?.message, status: r.status };
  }
  await syncHostBridgesFromCloud();
  return { ok: true, version: r.json.version };
}

async function activateHostBridgeCloudVersion(payload) {
  const hostId = String(payload && payload.hostId ? payload.hostId : '').trim();
  const versionId = String(payload && payload.versionId ? payload.versionId : '').trim();
  if (!hostId || !versionId) return { ok: false, error: 'missing_version' };
  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };
  const authMe = await readShellAccountStatus();
  const user = authMe && authMe.user && typeof authMe.user === 'object' ? authMe.user : {};
  if (!authMe || !authMe.loggedIn) return { ok: false, error: 'not_logged_in', message: '请先在工作台登录。' };
  if (String(user.role || '') !== 'admin') return { ok: false, error: 'admin_required', message: '当前账号不是管理员。' };
  if (authMe.authOrigin) origin = authMe.authOrigin;
  const writeOrigin = shellSiteOriginForAuthWrite();
  const cookieHeader = await authCookieHeaderForOrigin(origin);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(writeOrigin ? { Origin: writeOrigin } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const r = await fetchWithPartition(
    FIRST_PARTY_WEB_PARTITION,
    `${origin}/api/admin/host-bridges/${encodeURIComponent(hostId)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST', credentials: 'include', headers, body: '{}' },
  );
  if (!r.ok || !r.json || !r.json.version) {
    return { ok: false, error: r.json?.error || r.text || `http_${r.status}`, message: r.json?.message, status: r.status };
  }
  await syncHostBridgesFromCloud();
  return { ok: true, version: r.json.version };
}

async function resolveCompanionArtifactDownload(artifactIdRaw) {
  const artifactId = String(artifactIdRaw || '').trim();
  if (!artifactId) return { ok: false, error: 'missing_artifact_id' };

  let origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) return { ok: false, error: 'invalid_auth_api_origin' };

  const authMe = await readShellAccountStatus();
  if (!authMe || !authMe.loggedIn) {
    return { ok: false, error: 'not_logged_in', message: '请先在工作台登录后再下载云端工具。' };
  }
  if (authMe.authOrigin) origin = authMe.authOrigin;

  const writeOrigin = shellSiteOriginForAuthWrite();
  const cookieHeader = await authCookieHeaderForOrigin(origin);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(writeOrigin ? { Origin: writeOrigin } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const { fetchWithPartition } = require('./agent-partition-fetch.cjs');
  const r = await fetchWithPartition(FIRST_PARTY_WEB_PARTITION, `${origin}/api/companion-artifacts/resolve-download`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ id: artifactId }),
  });
  if (!r.ok || !r.json || !r.json.downloadUrl) {
    return {
      ok: false,
      error: r.json?.error || r.text || `http_${r.status}`,
      status: r.status,
    };
  }
  return {
    ok: true,
    downloadUrl: r.json.downloadUrl,
    expiresIn: r.json.expiresIn,
    fileName: r.json.fileName,
    semver: r.json.semver,
    kind: r.json.kind,
  };
}

async function fetchHostBundleCatalogFromSite() {
  const origin = resolveAuthApiOriginForCompanionApi();
  if (!origin) {
    return { ok: false, error: 'invalid_auth_api_origin' };
  }
  const api = `${origin}/api/companion-artifacts/catalog`;
  try {
    const r = await fetch(api, { method: 'GET', signal: AbortSignal.timeout(20000) });
    let j = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    if (!r.ok) {
      const detail =
        j && typeof j.error === 'string' && j.error.trim()
          ? String(j.error).trim()
          : `http_${r.status}`;
      return { ok: false, error: detail, httpStatus: r.status };
    }
    const raw = j && Array.isArray(j.artifacts) ? j.artifacts : [];
    return { ok: true, artifacts: raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const CONNECTION_DROP_EXE_HOSTS = new Map(
  [
    ['photoshop.exe', { hostId: 'photoshop', name: 'Photoshop' }],
    ['maya.exe', { hostId: 'maya', name: 'Maya' }],
    ['blender.exe', { hostId: 'blender', name: 'Blender' }],
    ['3dsmax.exe', { hostId: '3ds-max', name: '3ds Max' }],
    ['unity.exe', { hostId: 'unity', name: 'Unity' }],
    ['unrealeditor.exe', { hostId: 'unreal', name: 'Unreal Editor' }],
    ['ue4editor.exe', { hostId: 'unreal', name: 'Unreal Editor' }],
    ['illustrator.exe', { hostId: 'illustrator', name: 'Illustrator' }],
    ['afterfx.exe', { hostId: 'after-effects', name: 'After Effects' }],
    ['adobe premiere pro.exe', { hostId: 'premiere', name: 'Premiere Pro' }],
    ['resolve.exe', { hostId: 'davinci-resolve', name: 'DaVinci Resolve' }],
    ['houdini.exe', { hostId: 'houdini', name: 'Houdini' }],
    ['nuke.exe', { hostId: 'nuke', name: 'Nuke' }],
    ['cinema 4d.exe', { hostId: 'cinema-4d', name: 'Cinema 4D' }],
    ['zbrush.exe', { hostId: 'zbrush', name: 'ZBrush' }],
    ['rhino.exe', { hostId: 'rhino', name: 'Rhino' }],
    ['sketchup.exe', { hostId: 'sketchup', name: 'SketchUp' }],
  ].map(([exe, meta]) => [String(exe).toLowerCase(), meta]),
);

function inferDroppedSoftwareVersion(targetPath, shortcutPath, name) {
  const text = [targetPath, shortcutPath, name].filter(Boolean).join(' ');
  const normalized = text.replace(/\\/g, '/');
  const patterns = [
    /(?:Photoshop|Illustrator|After Effects|Premiere Pro|Blender|Maya|Unity|Unreal|UE)[^\d]*(20\d{2}|\d+\.\d+(?:\.\d+)?)/i,
    /\/(?:Maya|Blender|Unity|UE_?)(20\d{2}|\d+\.\d+(?:\.\d+)?)\//i,
    /\/UE[_-](\d+\.\d+(?:\.\d+)?)\//i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) return match[1];
  }
  return '';
}

function resolveDroppedConnectionPath(payload) {
  const inputPath = String(payload && payload.path ? payload.path : '').trim();
  if (!inputPath) return { ok: false, error: 'missing_path', message: '没有读取到拖入文件路径。' };
  const abs = path.resolve(path.normalize(inputPath));
  if (!fs.existsSync(abs)) return { ok: false, error: 'path_not_found', message: '拖入的文件不存在。' };
  const ext = path.extname(abs).toLowerCase();
  let targetPath = abs;
  let shortcutPath = '';
  let targetKind = ext.replace(/^\./, '') || 'file';
  if (ext === '.lnk') {
    if (process.platform !== 'win32' || !shell || typeof shell.readShortcutLink !== 'function') {
      return { ok: false, error: 'shortcut_unsupported', message: '当前环境不支持解析快捷方式。' };
    }
    let shortcut = null;
    try {
      shortcut = shell.readShortcutLink(abs);
    } catch (e) {
      return { ok: false, error: 'shortcut_resolve_failed', message: e instanceof Error ? e.message : String(e) };
    }
    targetPath = path.resolve(path.normalize(String(shortcut && shortcut.target ? shortcut.target : '')));
    shortcutPath = abs;
    targetKind = 'shortcut';
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { ok: false, error: 'shortcut_target_not_found', message: '快捷方式指向的目标不存在。' };
    }
  }
  const targetExt = path.extname(targetPath).toLowerCase();
  if (targetExt !== '.exe') {
    return { ok: false, error: 'unsupported_drop_target', message: '请拖入软件快捷方式或 exe 文件。' };
  }
  const exeName = path.basename(targetPath);
  const inferred = CONNECTION_DROP_EXE_HOSTS.get(exeName.toLowerCase()) || null;
  const shortcutName = shortcutPath ? path.basename(shortcutPath, path.extname(shortcutPath)) : '';
  const fallbackName = path.basename(targetPath, targetExt);
  const name = (inferred && inferred.name) || shortcutName || fallbackName;
  const versionHint = inferDroppedSoftwareVersion(targetPath, shortcutPath, name);
  return {
    ok: true,
    inputPath: abs,
    shortcutPath,
    targetPath,
    targetKind,
    exeName,
    hostId: inferred && inferred.hostId,
    name,
    versionHint,
  };
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
  const signal = optObj.signal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      resolve({ ok: false, error: 'aborted', text: 'aborted' });
      return;
    }
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
    const onAbort = () => {
      req.destroy();
      resolve({ ok: false, error: 'aborted', text: 'aborted' });
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      if (signal && signal.aborted) {
        resolve({ ok: false, error: 'aborted', text: 'aborted' });
        return;
      }
      reject(err);
    });
    req.on('close', () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    });
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
  const isDisposedFrameError = (e) => {
    const msg = e instanceof Error ? e.message : String(e || '');
    return /Render frame was disposed|WebFrameMain could be accessed|frame.*disposed/i.test(msg);
  };
  const executeWorkbenchScript = async (js) => {
    if (!wc || wc.isDestroyed()) return { ok: false, disposed: true, value: '' };
    let timer = null;
    try {
      const result = await Promise.race([
        wc.executeJavaScript(js),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('workbench_execute_script_timeout')), 3000);
        }),
      ]);
      return { ok: true, disposed: false, value: result };
    } catch (e) {
      if (isDisposedFrameError(e) || !wc || wc.isDestroyed()) {
        return { ok: false, disposed: true, value: '' };
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

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
    const r = await executeWorkbenchScript(
      `(()=>{ try { return localStorage.getItem('ac_companion_local_token_v1')||''; } catch(e){ return ''; } })()`,
    );
    if (!r.ok) return;
    before = r.value;
  } catch {
    return;
  }
  try {
    const r = await executeWorkbenchScript(`(()=>{ try {
      localStorage.setItem('ac_companion_local_base_v1', ${JSON.stringify(base)});
      localStorage.setItem('ac_companion_local_token_v1', ${JSON.stringify(tok)});
    } catch(e){} })()`);
    if (!r.ok) return;
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

function killLoopbackPortListeners(port) {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`,
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {
    /* ignore */
  }
}

/**
 * Windows：结束占用伴侣 HTTP 端口的监听进程（用于切换存储目录等需强制换进程的场景）。
 * 可能结束用户在其它终端启动的 local-companion。
 */
function killProcessListeningOnCompanionPort(port) {
  killLoopbackPortListeners(port);
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

async function waitForCompanionHealth(timeoutMs) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 8000);
  while (Date.now() < deadline) {
    if (await probeCompanionHealth()) return true;
    await sleep(280);
  }
  return false;
}

function resolveCompanionSpawnLogPath() {
  try {
    return path.join(app.getPath('userData'), 'local-companion-spawn.log');
  } catch {
    return '';
  }
}

function appendCompanionSpawnLog(logPath, text) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, text);
  } catch {
    /* ignore */
  }
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
  /** 安装包：去掉易导致子进程异常退出的继承变量（任意用户机通用） */
  if (app.isPackaged) {
    delete env.NODE_OPTIONS;
    delete env.VSCODE_INSPECTOR_OPTIONS;
    // 强制使用壳指定端口；忽略系统里误设的 COMPANION_HTTP_PORT
    delete env.COMPANION_HTTP_PORT;
    env.COMPANION_HTTP_PORT = String(readHttpPort() || DEFAULT_HTTP_PORT);
  }
  /** Dev: pull outbound proxy from repo .env.local so import-url can reach CDNs (auth-api already uses --env-file). */
  try {
    if (!app.isPackaged) {
      const envLocalPath = path.resolve(__dirname, '..', '.env.local');
      if (fs.existsSync(envLocalPath)) {
        const text = fs.readFileSync(envLocalPath, 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const t = String(line || '').trim();
          if (!t || t.startsWith('#')) continue;
          const eq = t.indexOf('=');
          if (eq <= 0) continue;
          const key = t.slice(0, eq).trim();
          if (key !== 'TRIPO_PROXY' && key !== 'HTTPS_PROXY' && key !== 'HTTP_PROXY') continue;
          if (String(env[key] || '').trim()) continue;
          let val = t.slice(eq + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (val) env[key] = val;
        }
      }
    }
  } catch {
    /* ignore */
  }
  const sbRoot = companionSandboxPaths.getCompanionSandboxRoot();
  if (sbRoot) {
    env.COMPANION_SANDBOX_ROOT = sbRoot;
  }
  /** Packaged: pin Maya bridge source so install works even if cwd ≠ bundle root */
  if (app.isPackaged) {
    const bridgePy = path.join(
      process.resourcesPath,
      'local-companion-bundle',
      'maya-plugins',
      'script-hub-bridge',
      'script_hub_bridge.py',
    );
    if (fs.existsSync(bridgePy)) {
      env.COMPANION_MAYA_BRIDGE_SOURCE = bridgePy;
    }
  }
  /** SamLocal 走 127.0.0.1；系统 HTTP_PROXY 未排除回环时 fetch 会报 COMPUTE_SAM_BACKEND */
  const loopNoProxy = '127.0.0.1,localhost,::1';
  const curNo = String(env.NO_PROXY || env.no_proxy || '').trim();
  env.NO_PROXY = !curNo ? loopNoProxy : curNo.includes('127.0.0.1') ? curNo : `${curNo},${loopNoProxy}`;
  env.no_proxy = env.NO_PROXY;
  const pair = readPairingConfig();
  /** 配对文件为「用户在壳里保存的真值」；父进程若误带旧 COMPANION_* 环境变量，不得盖过 pairing（否则网站与 Workflow 会 bearer_invalid） */
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
  applyDesktopPaddleOcrToEnv(env);
  applyCompanionBundleDownloadTrustEnv(env);
  try {
    if (!app.isPackaged) {
      const exampleDir = path.resolve(__dirname, '..', 'packages', 'shell-tools', 'example-image-converter');
      if (fs.existsSync(path.join(exampleDir, 'tool.json'))) {
        env.COMPANION_SHELL_TOOL_EXAMPLE_DIR = exampleDir;
      }
    }
  } catch {
    /* ignore */
  }

  /** 父进程/系统环境若带 `COMPANION_HTTP_PORT=0`（常为 Relay 子进程约定），子进程会按「关闭 HTTP」立即 exit(1) */
  if (String(env.COMPANION_HTTP_PORT ?? '').trim() === '0') {
    delete env.COMPANION_HTTP_PORT;
  }

  let stdio = process.stdout?.isTTY ? 'inherit' : 'ignore';
  /** 安装包始终落盘 spawn 日志，便于任意用户机排障（与是否 TTY 无关） */
  let spawnLogPath = app.isPackaged ? resolveCompanionSpawnLogPath() : '';
  if (app.isPackaged) {
    appendCompanionSpawnLog(
      spawnLogPath,
      `\n---------- ${new Date().toISOString()} spawn ${cfg.nodeBin} ${cfg.args.join(' ')} cwd=${companionRoot} ----------\n`,
    );
    stdio = spawnLogPath ? ['ignore', 'pipe', 'pipe'] : 'ignore';
  }

  companion = spawn(cfg.nodeBin, cfg.args, {
    cwd: companionRoot,
    env,
    stdio,
    windowsHide: false,
  });

  if (spawnLogPath && companion.stdout && companion.stderr) {
    const append = (chunk) => appendCompanionSpawnLog(spawnLogPath, chunk);
    companion.stdout.on('data', append);
    companion.stderr.on('data', append);
  }
  companionStatusNote = '伴侣启动中…';
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
      const logHint = spawnLogPath ? `；日志 ${spawnLogPath}` : '';
      companionLastError = `退出码=${code ?? 'null'} 信号=${signal ?? 'null'}${logHint}`;
      notifyCompanionFailure(companionLastError);
    }
    updateTrayTooltip();
    rebuildTrayMenu();
    companion = null;
  });

  /** 任意用户机：spawn 后必须确认 /v1/health，避免「壳在跑、18765 没人听」却静默当成成功 */
  void (async () => {
    const ok = await waitForCompanionHealth(10000);
    if (ok) {
      companionStatusNote = '伴侣运行中';
      companionLastError = null;
      updateTrayTooltip();
      rebuildTrayMenu();
      return;
    }
    if (await probeCompanionHealth()) return;
    companionStatusNote = '伴侣未就绪';
    const logHint = spawnLogPath ? ` 详见 ${spawnLogPath}` : '';
    companionLastError = `本机 HTTP（127.0.0.1:${readHttpPort()}）未响应。请托盘「重新启动本地伴侣」。${logHint}`;
    updateTrayTooltip();
    rebuildTrayMenu();
    notifyCompanionFailure(companionLastError);
  })();
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

function notifyShellChromeLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('shell-copilot-layout', {
      collapsed: shellCopilotCollapsed,
      widthPx: shellCopilotWidthPx,
      effectiveWidthPx: getCopilotEffectiveWidthPx(),
      dshPaneCollapsed: shellDshPaneCollapsed,
      dshPaneWidth: shellDshPaneWidthPx,
    });
  } catch {
    /* ignore */
  }
}

function layoutShellChrome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const showDsh = shellViewShowsDsh(shellMainProcessActiveView);
  const dual = computeWorkbenchAndDshBounds(mainWindow.getContentBounds(), {
    sidebarInsetPx: shellWorkbenchSidebarInsetPx,
    titlebarHeightPx: SHELL_TITLEBAR_HEIGHT,
    toolbarHeightPx: SHELL_WORKBENCH_TOOLBAR_HEIGHT,
    dshPaneWidthPx: showDsh && !shellDshPaneCollapsed ? shellDshPaneWidthPx : 0,
  });
  if (shellMainProcessActiveView === 'workbench' && workbenchBrowserView) {
    workbenchBrowserView.setBounds(dual.workbench);
  }
  if (showDsh && dshBrowserView) {
    dshBrowserView.setBounds(dual.dsh);
  }
}

function layoutWorkbenchBrowserView() {
  layoutShellChrome();
}

function detachWorkbenchBrowserView() {
  detachAllEmbeddedBrowserViews();
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

function shouldAnnounceTrayDownloadBalloon() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return true;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return true;
    if (!mainWindow.isFocused()) return true;
    return false;
  } catch {
    return true;
  }
}

function announceDownloadSaved(savePath, noticeTitle) {
  announceWebDownloadSaved(savePath, noticeTitle);
  if (shouldAnnounceTrayDownloadBalloon()) {
    announceTrayDownloadSaved(savePath, noticeTitle);
  }
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
  announceDownloadSaved(savePath, (opts && opts.noticeTitle) || '下载已完成');
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
        announceDownloadSaved(savePath, '下载已完成');
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
      partition: FIRST_PARTY_WEB_PARTITION,
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

function ensureDshBrowserView() {
  if (dshBrowserView) return dshBrowserView;
  if (!isDshPartitionAllowed(DSH_SESSION_PARTITION)) {
    throw new Error('dsh partition must not be team');
  }
  const view = new BrowserView({
    webPreferences: {
      partition: DSH_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  dshBrowserView = view;
  return view;
}

function dshInjectDir() {
  return path.join(app.getPath('userData'), 'dsh-inject');
}

function dshPluginDirOpts() {
  return {
    dir: dshInjectDir(),
    packaged: Boolean(app.isPackaged),
    resourcesPath: process.resourcesPath,
  };
}

function refreshDshFingerInject(snapshot) {
  try {
    const snap =
      snapshot && snapshot.finger
        ? snapshot
        : { finger: snapshot || {}, assets: {}, assetIds: [], projectId: '' };
    let folderSource = false;
    try {
      folderSource = workshopFolderSourceOfTruthFromState(workshopFileTreeHost.state());
    } catch {
      folderSource = false;
    }
    const text = formatWorkspaceDocumentForDsh(snap, { workshopFolderSource: folderSource });
    return writeDshContextInject({ dir: dshInjectDir(), text, finger: snap.finger });
  } catch (e) {
    console.warn('[dsh-inject]', e instanceof Error ? e.message : e);
    return null;
  }
}

async function fillDshComposerText(text) {
  const composerText = String(text || '').trim();
  if (!composerText) return { ok: false, error: 'empty' };
  try {
    writeComposerSuggested({ dir: dshInjectDir(), text: composerText });
  } catch (e) {
    console.warn('[dsh-composer-suggested]', e instanceof Error ? e.message : e);
  }
  const script = buildFillDshComposerScript(composerText);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!isDshBrowserViewLive()) {
      await sleep(120);
      continue;
    }
    try {
      const filled = await dshBrowserView.webContents.executeJavaScript(script, true);
      if (filled) return { ok: true, target: 'dsh' };
    } catch (e) {
      if (attempt === 15) {
        console.warn('[dsh-composer-fill]', e instanceof Error ? e.message : e);
      }
    }
    await sleep(200);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('shell-fill-copilot-composer', { text: composerText });
      return { ok: true, target: 'legacy_copilot' };
    } catch {
      /* ignore */
    }
  }
  return { ok: false, error: 'fill_failed' };
}

async function applyDshHandoff(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const domain = String(body.domain || body.kind || 'connection').trim() || 'connection';
  const composerText = String(body.composerText || body.suggestedMessage || '').trim();
  try {
    clearDshHandoff({ dir: dshInjectDir() });
    clearComposerSuggested({ dir: dshInjectDir() });
    writeDshHandoff({ dir: dshInjectDir(), payload: body });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
  saveShellSettings({ dshPaneCollapsed: false });
  notifyShellChromeLayout();
  try {
    await attachDshForCurrentShellView();
  } catch (e) {
    console.warn('[dsh-handoff]', e instanceof Error ? e.message : e);
  }
  layoutShellChrome();
  notifyShellChromeLayout();
  const fill = composerText ? await fillDshComposerText(composerText) : { ok: true, skipped: true };
  return { ok: true, domain, composerText, fill };
}

function overlayConnectedHosts(drafts, opts) {
  const o = opts && typeof opts === 'object' ? opts : { hasSelectedCard: opts !== false };
  const finger = workspaceDocumentStore.getSnapshot().finger || {};
  const hosts = connectedHostsFromDrafts(drafts, {
    hasSelectedCard: o.hasSelectedCard !== false,
    selectedRelPath: o.selectedRelPath != null ? o.selectedRelPath : finger.selectedRelPath,
  });
  workspaceDocumentStore.applyEvents([{ type: 'finger.changed', finger: { connectedHosts: hosts } }]);
  refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
  return hosts;
}

async function syncConnectedHostsFromCompanion() {
  try {
    const r = await companionApiRequest('GET', '/v1/capability-packages/drafts', null, { timeoutMs: 8000 });
    const drafts = r && r.ok && r.json && Array.isArray(r.json.drafts) ? r.json.drafts : [];
    const finger = workspaceDocumentStore.getSnapshot().finger || {};
    return overlayConnectedHosts(drafts, {
      hasSelectedCard: Boolean(finger.selectedAssetId),
      selectedRelPath: finger.selectedRelPath,
    });
  } catch (e) {
    console.warn('[dsh-hosts]', e instanceof Error ? e.message : e);
    return [];
  }
}

function dshBundledRoot() {
  try {
    if (app.isPackaged) return path.join(process.resourcesPath, 'dsh-bundled');
  } catch {
    /* app not ready */
  }
  return path.join(__dirname, 'dsh-bundled');
}

function dshSpawnRuntime() {
  const root = dshBundledRoot();
  const cliFile = resolveDshCliEntry(root);
  if (!cliFile) {
    if (app.isPackaged) console.warn('[dsh] bundled runtime missing', root);
    return {};
  }
  const { cmd, envExtra } = getNodeLauncherForLocalCompanion();
  return { cliFile, command: cmd, cwd: root, envExtra };
}

async function ensureDshHostUrl() {
  if (!dshHostController) {
    dshHostController = createDshHost({ spawn, killPortListeners: killLoopbackPortListeners });
  }
  ensureDshWorkspaceHttp();
  await syncConnectedHostsFromCompanion();
  refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
  let patch = null;
  try {
    patch = writeDshPatchFile(dshPluginDirOpts());
  } catch (e) {
    console.warn('[dsh-patch]', e instanceof Error ? e.message : e);
  }
  const runtime = dshSpawnRuntime();
  const started = await dshHostController.start({
    version: DSH_PINNED_VERSION,
    host: '127.0.0.1',
    port: 3080,
    patchFile: patch && patch.patchPath,
    cliFile: runtime.cliFile,
    command: runtime.command,
    cwd: runtime.cwd,
    env: { ...dshPluginEnv({ injectDir: dshInjectDir() }), ...(runtime.envExtra || {}) },
    reclaimExternal: true,
  });
  dshHostUrl = started.url;
  companionLog('log', '[companion-desktop] dsh ready', started.url, started.reused ? '(reused child)' : '(spawned)');
  return dshHostUrl;
}

function isDshBrowserViewLive() {
  if (!dshBrowserView || !dshHostUrl) return false;
  try {
    const wc = dshBrowserView.webContents;
    if (!wc || wc.isDestroyed()) return false;
    return sameDshOrigin(wc.getURL(), dshHostUrl);
  } catch {
    return false;
  }
}

async function attachDshBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isDshBrowserViewLive()) {
    const view = dshBrowserView;
    if (mainWindow.getBrowserViews().indexOf(view) < 0) mainWindow.addBrowserView(view);
    layoutShellChrome();
    return;
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1) {
        if (dshHostController) dshHostController.stop();
        dshHostUrl = null;
        killLoopbackPortListeners(3080);
        await sleep(400 * attempt);
      }
      const url = await ensureDshHostUrl();
      if (!url || !/^https?:\/\/127\.0\.0\.1(?::|\/|$)/i.test(url)) {
        throw new Error('dsh url must be loopback');
      }
      const view = ensureDshBrowserView();
      const alreadyAttached = mainWindow.getBrowserViews().indexOf(view) >= 0;
      if (!alreadyAttached) mainWindow.addBrowserView(view);
      layoutShellChrome();
      const wc = view.webContents;
      let needLoad = true;
      try {
        const cur = wc.getURL();
        if (cur && cur !== 'about:blank') needLoad = !sameDshOrigin(cur, url);
      } catch {
        needLoad = true;
      }
      if (needLoad) await wc.loadURL(url);
      companionLog('log', '[companion-desktop] dsh BrowserView attached');
      return;
    } catch (e) {
      lastErr = e;
      companionLog(
        'warn',
        `[companion-desktop] dsh attach attempt ${attempt}/3 failed:`,
        e instanceof Error ? e.message : e,
      );
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastErr || new Error('dsh attach failed');
}

async function attachDshForCurrentShellView() {
  if (!shellViewShowsDsh(shellMainProcessActiveView)) {
    layoutShellChrome();
    return { ok: true };
  }
  try {
    await attachDshBrowserView();
    layoutShellChrome();
    applyShellRoomFinger(shellMainProcessActiveView);
    return { ok: true };
  } catch (e) {
    companionLog('warn', '[companion-desktop] dsh attach failed:', e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

  syncEmbeddedBrowserViews('workbench');
  const view = ensureWorkbenchBrowserView();
  const wc = view.webContents;

  const alreadyAttached = mainWindow.getBrowserViews().indexOf(view) >= 0;
  if (!alreadyAttached) mainWindow.addBrowserView(view);
  layoutShellChrome();

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
      await loadUrlWithProxyFallback(wc, target);
    } catch (e) {
      detachWorkbenchBrowserView();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    void injectWorkbenchCompanionPrefsFromPairingFile(wc).catch((e) => {
      console.warn('[companion-desktop] workbench inject (same url)', e instanceof Error ? e.message : e);
    });
  }

  try {
    await attachDshBrowserView();
  } catch (e) {
    companionLog('warn', '[companion-desktop] dsh attach failed:', e instanceof Error ? e.message : e);
  }

  applyShellRoomFinger('workbench');
  return { ok: true };
}

async function navigateShellFromAgent(view) {
  return transitionMainProcessShellView(view, { notifyRenderer: true });
}

async function getAgentShellStateSummary() {
  const port = readHttpPort();
  const alive = await probeCompanionHealth();
  const brainProbe = agentSessionService ? await agentSessionService.probeBrain() : { ok: false };
  const shellAccount = summarizeShellAccountForAgent(await readShellAccountStatus());
  return {
    shellView: shellMainProcessActiveView,
    account: shellAccount,
    companion: {
      connected: alive,
      port,
      note: companionStatusNote,
      lastError: companionLastError,
      capabilityUi: companionTrayCapabilityUi,
    },
    brain: {
      id: agentSessionService ? agentSessionService.getBrainId() : 'stub',
      probe: brainProbe,
    },
    copilot: {
      collapsed: shellCopilotCollapsed,
      widthPx: shellCopilotWidthPx,
      effectiveWidthPx: getCopilotEffectiveWidthPx(),
    },
  };
}

function initAgentPlatform() {
  agentStore = createAgentStore({ getRoot: getAgentStoreRoot });
  agentStore.ensureLayout();
  migrateAgentSettingsToCodexDefault();
  const agentSettings = agentStore.readSettings();
  shellCopilotCollapsed = Boolean(agentSettings.copilotCollapsed);
  shellCopilotWidthPx = Number.isFinite(Number(agentSettings.copilotWidth))
    ? Math.min(SHELL_COPILOT_WIDTH_MAX, Math.max(SHELL_COPILOT_WIDTH_MIN, Number(agentSettings.copilotWidth)))
    : SHELL_COPILOT_WIDTH_DEFAULT;
  const shellSettings = readShellSettings();
  shellDshPaneWidthPx = readDshPaneWidthFromSettings(shellSettings);
  shellDshPaneCollapsed = readDshPaneCollapsedFromSettings(shellSettings);

  agentPolicy = createAgentPolicy({
    getPolicyPath: () => path.join(getAgentStoreRoot(), 'policy.json'),
  });
  agentPolicy.readPolicy();

  const workbenchClient = createAgentWorkbenchClient({
    getSiteUrl: () => readShellSettings().siteUrl,
    getAgentApiOrigin: () => resolveAuthApiOriginForCompanionApi(),
    normalizeSiteUrl: normalizeWorkbenchSiteUrl,
    invokeBridge: invokeWorkbenchBridge,
    navigateShell: navigateShellFromAgent,
    getCompanionHttpPort: () => readHttpPort(),
    getCompanionSharedToken: () => readSharedToken(),
  });
  agentWorkbenchClient = workbenchClient;

  const scriptHubClient = createAgentScriptHubClient({
    getScriptHubApiUrl: () => readShellSettings().scriptHubApiUrl,
    getScriptHubApiToken: () => readShellSettings().scriptHubApiToken,
    normalizeScriptHubApiUrl,
    navigateShell: navigateShellFromAgent,
  });
  dshScriptHubClient = scriptHubClient;

  agentBodyHost = createAgentBodyHost({
    getShellView: () => shellMainProcessActiveView,
    navigateShell: navigateShellFromAgent,
    companionApiRequest,
    getStateSummary: getAgentShellStateSummary,
    shellLogin: loginShellAccountWithPassword,
    workbenchClient,
    scriptHubClient,
    runShellTool: agentRunShellTool,
    runShellBootstrap: agentRunShellBootstrap,
    uploadCopilotUsageCloudDraft,
    probeCopilotUsageQuotaPolicy,
    getSkillsRoot: () => agentStore.skillsDir(),
    getMemoryRoot: () => agentStore.memoryDir(),
  });

  agentSessionService = createAgentSessionService({
    store: agentStore,
    bodyHost: agentBodyHost,
    getShellView: () => shellMainProcessActiveView,
    getBrain: () => resolveAgentBrain(),
    ensureBrainReady: ensureAgentBrainReady,
    gateTool: (tool) => agentPolicy.gateTool(tool),
    waitForConfirm: waitForAgentConfirm,
    cancelPendingConfirms: cancelAllAgentConfirms,
    onEvent: broadcastAgentSessionEvent,
  });

  agentMcpServer = createAgentBodyMcpServer({
    readSettings: () => agentStore.readSettings(),
    writeSettings: (patch) => agentStore.writeSettings(patch),
    bodyHost: agentBodyHost,
    gateTool: (tool) => agentPolicy.gateTool(tool),
    readPolicy: () => agentPolicy.readPolicy(),
    waitForConfirm: waitForAgentConfirm,
    appendAudit: (entry) => agentStore.appendAudit(entry),
    listToolExecutions: (options) => agentStore.listToolExecutions(options && typeof options === 'object' ? options : {}),
    summarizeUsageAudit: (options) => summarizeCopilotUsageAudit(options && typeof options === 'object' ? options : {}),
    getShellView: () => shellMainProcessActiveView,
    getStateSummary: getAgentShellStateSummary,
    getCodexRuntimeStatus: () => buildCodexRuntimeStatus(agentStore.readSettings()),
    getSkillsRoot: () => agentStore.skillsDir(),
    log: companionLog.bind(null, 'log'),
  });

  void (async () => {
    await syncCodexSharedAuthIfEnabled('startup');
    await ensureAgentBrainReady();
  })();
  // Copilot/Codex needs local Body MCP loopback to call ac.* (127.0.0.1 only).
  try {
    const s = agentStore.readSettings();
    if (!s.mcpEnabled || !s.mcpToken) {
      agentStore.writeSettings({ mcpEnabled: true });
      agentMcpServer.ensureMcpToken(agentStore.readSettings());
    }
  } catch (e) {
    companionLog('warn', `ensure Copilot Body MCP: ${e instanceof Error ? e.message : String(e)}`);
  }
  void agentMcpServer.syncFromSettings();
}

async function buildAgentMcpToolCatalog() {
  if (!agentBodyHost || typeof agentBodyHost.listTools !== 'function') {
    return buildToolCatalog([]);
  }
  const tools = await agentBodyHost.listTools();
  return buildToolCatalog(tools);
}

function bindMainWindowWorkbenchLayoutHandlers() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const relayout = () => layoutShellChrome();
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
    width: 1120,
    height: 720,
    minWidth: 720,
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
    dshBrowserView = null;
    shellMainProcessActiveView = 'workbench';
    mainWindow = null;
  });

  bindMainWindowWorkbenchLayoutHandlers();

  mainWindow.webContents.on('did-finish-load', () => {
    if (companionUpdater.getUpdaterUiState) {
      broadcastShellUpdaterState(companionUpdater.getUpdaterUiState());
    }
    setTimeout(() => maybeFocusCopilotOnboarding(), 120);
    setTimeout(() => {
      void maybeRunCodexOneClickSetupFromLaunch(process.argv);
    }, 420);
  });

  const shellHtml = path.join(__dirname, 'shell', 'index.html');
  void mainWindow.loadFile(shellHtml);
}

function openShellToolWindow(toolIdRaw) {
  const toolId = String(toolIdRaw || '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) {
    return { ok: false, error: 'invalid_tool_id' };
  }

  const existing = shellToolWindows.get(SHELL_TOOL_WORKSPACE_KEY);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    existing.webContents.send('shell-tool-workspace-open-tool', { toolId });
    return { ok: true, reused: true, toolId };
  }

  const win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 620,
    minHeight: 400,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c0e',
    show: false,
    title: '工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload-tool-window.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  shellToolWindows.set(SHELL_TOOL_WORKSPACE_KEY, win);
  win.on('closed', () => {
    if (shellToolWindows.get(SHELL_TOOL_WORKSPACE_KEY) === win) shellToolWindows.delete(SHELL_TOOL_WORKSPACE_KEY);
  });

  const html = path.join(__dirname, 'shell', 'tool-window.html');
  void win.loadFile(html, { query: { toolId } });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  return { ok: true, toolId };
}

function closeShellToolWindow(toolIdRaw) {
  const toolId = String(toolIdRaw || '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) {
    return { ok: false, error: 'invalid_tool_id' };
  }
  const existing = shellToolWindows.get(SHELL_TOOL_WORKSPACE_KEY);
  if (existing && !existing.isDestroyed()) {
    existing.webContents.send('shell-tool-workspace-close-tool', { toolId });
    return { ok: true, closed: true, toolId };
  }
  return { ok: true, closed: false, toolId };
}

function setShellToolWorkspaceDetailsCollapsed(win, collapsedRaw) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'window_not_found' };
  const collapsed = Boolean(collapsedRaw);
  if (collapsed) {
    try {
      if (win.isMaximized()) win.unmaximize();
    } catch {
      /* ignore */
    }
    const bounds = win.getBounds();
    if (bounds.width > SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH + 24) {
      shellToolWorkspaceExpandedBounds.set(win, bounds);
    }
    win.setMinimumSize(SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH, SHELL_TOOL_WORKSPACE_COLLAPSED_MIN_HEIGHT);
    win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH,
      height: Math.max(bounds.height, SHELL_TOOL_WORKSPACE_COLLAPSED_MIN_HEIGHT),
    });
    return { ok: true, collapsed: true, bounds: win.getBounds() };
  }

  const current = win.getBounds();
  const previous = shellToolWorkspaceExpandedBounds.get(win);
  const next = previous && previous.width > SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH + 24
    ? previous
    : {
        x: current.x,
        y: current.y,
        width: 860,
        height: Math.max(current.height, 620),
      };
  win.setBounds({
    x: current.x,
    y: current.y,
    width: Math.max(next.width, SHELL_TOOL_WORKSPACE_EXPANDED_MIN_WIDTH),
    height: Math.max(next.height, SHELL_TOOL_WORKSPACE_EXPANDED_MIN_HEIGHT),
  });
  win.setMinimumSize(SHELL_TOOL_WORKSPACE_EXPANDED_MIN_WIDTH, SHELL_TOOL_WORKSPACE_EXPANDED_MIN_HEIGHT);
  return { ok: true, collapsed: false, bounds: win.getBounds() };
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

  ipcMain.handle('shell-check-shell-update', async () => {
    if (!companionUpdater || typeof companionUpdater.checkNow !== 'function') {
      return { ok: false, error: 'updater_unavailable' };
    }
    await companionUpdater.checkNow(true);
    return {
      ok: true,
      updater: companionUpdater.getUpdaterUiState ? companionUpdater.getUpdaterUiState() : null,
    };
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
  ipcMain.handle('shell-account-status', () => readShellAccountStatus());

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
              await loadUrlWithProxyFallback(workbenchBrowserView.webContents, target);
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

  ipcMain.handle('shell-open-tool-window', async (_e, toolId) => {
    try {
      return openShellToolWindow(toolId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-submit-shell-tool-review', async (_e, toolId) => {
    try {
      return await submitShellToolForReview(toolId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-publish-shell-tool-cloud', async (_e, toolId) => {
    try {
      return await publishShellToolToCloud(toolId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-sync-host-bridges-cloud', async () => {
    try {
      return await syncHostBridgesFromCloud();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-publish-host-bridge-cloud', async (_e, payload) => {
    try {
      return await publishHostBridgeToCloud(payload);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-activate-host-bridge-cloud-version', async (_e, payload) => {
    try {
      return await activateHostBridgeCloudVersion(payload);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-resolve-companion-artifact-download', async (_e, artifactId) => {
    try {
      return await resolveCompanionArtifactDownload(artifactId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-close-tool-window', async (_e, toolId) => {
    try {
      return closeShellToolWindow(toolId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-builtin-example-available', () => {
    try {
      const packagesRoot = path.resolve(__dirname, '..', 'packages', 'shell-tools');
      const folders = ['example-image-converter', 'transfer-maps-batch'];
      const examples = [];
      for (const folder of folders) {
        const toolJsonPath = path.join(packagesRoot, folder, 'tool.json');
        if (!fs.existsSync(toolJsonPath)) continue;
        try {
          const tool = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8'));
          const toolId = String(tool.id || '').trim();
          if (!toolId) continue;
          examples.push({
            toolId,
            name: String(tool.name || '').trim(),
            description: String(tool.description || '').trim(),
            semver: String(tool.semver || '').trim(),
            tags: Array.isArray(tool.tags) ? tool.tags : [],
          });
        } catch {
          /* skip broken package */
        }
      }
      if (!examples.length) {
        return { ok: true, available: false, examples: [] };
      }
      const primary = examples[0];
      return {
        ok: true,
        available: true,
        toolId: primary.toolId,
        name: primary.name,
        description: primary.description,
        semver: primary.semver,
        tags: primary.tags,
        examples,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), available: false, examples: [] };
    }
  });

  ipcMain.handle('shell-tool-window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.minimize();
      return { ok: true };
    }
    return { ok: false, error: 'window_not_found' };
  });

  ipcMain.handle('shell-tool-window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
      return { ok: true };
    }
    return { ok: false, error: 'window_not_found' };
  });

  ipcMain.handle('shell-tool-window-set-details-collapsed', (event, collapsed) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return setShellToolWorkspaceDetailsCollapsed(win, collapsed);
  });

  ipcMain.handle('shell-tool-window-toggle-pin', (event, pinned) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: 'window_not_found' };
    const on = Boolean(pinned);
    win.setAlwaysOnTop(on, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true });
    }
    return { ok: true, pinned: win.isAlwaysOnTop() };
  });

  ipcMain.handle('shell-tool-window-get-pin', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: 'window_not_found' };
    return { ok: true, pinned: win.isAlwaysOnTop() };
  });

  /** Dedup auto-fix prompts from tool windows (toolId+fingerprint). */
  const shellToolAutoFixRecent = new Map();

  function expandCopilotPanelForAutoFix() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!shellCopilotCollapsed) return;
    shellCopilotCollapsed = false;
    if (agentStore) {
      agentStore.writeSettings({ copilotCollapsed: false });
    }
    layoutShellChrome();
    notifyShellChromeLayout();
  }

  function buildShellToolAutoFixPrompt(payload) {
    const toolId = String(payload && payload.toolId ? payload.toolId : '').trim();
    const toolName = String(payload && payload.toolName ? payload.toolName : toolId).trim() || toolId;
    const actionId = String(payload && payload.actionId ? payload.actionId : '').trim();
    const origin = String(payload && payload.origin ? payload.origin : '').trim();
    const error = String(payload && payload.error ? payload.error : '').trim();
    const message = String(payload && payload.message ? payload.message : '').trim();
    const exitCode = payload && payload.exitCode != null ? String(payload.exitCode) : '';
    const stdout = String(payload && payload.stdout ? payload.stdout : '');
    const stderr = String(payload && payload.stderr ? payload.stderr : '');
    const params =
      payload && payload.params && typeof payload.params === 'object' ? payload.params : {};
    const clip = (s, n) => {
      const t = String(s || '');
      return t.length > n ? t.slice(0, n) + '\n…(已截断)' : t;
    };
    const editable = origin === 'authored' || origin === 'import';
    const lines = [
      `小工具「${toolName}」(${toolId}) 刚才运行失败。请直接修复，不要让我手动粘贴日志。`,
      editable
        ? '请用 ac.shell_tool.authored_upsert 修改本机草稿（tool.json / module/panel.json / scripts），保存后会自动热重载；修好后可用 ac.shell_tool.run 再打开窗口让我复测。'
        : '该工具不是本机自建包，请先说明原因与改法；若可复制为我的工具再修，请提示我导入/scaffold。',
      actionId ? `动作: ${actionId}` : '',
      error ? `错误码: ${error}` : '',
      message ? `错误信息: ${message}` : '',
      exitCode !== '' ? `退出码: ${exitCode}` : '',
      `参数 JSON:\n\`\`\`json\n${clip(JSON.stringify(params, null, 2), 2000)}\n\`\`\``,
      stdout.trim() ? `stdout:\n\`\`\`\n${clip(stdout, 4000)}\n\`\`\`` : '',
      stderr.trim() ? `stderr:\n\`\`\`\n${clip(stderr, 4000)}\n\`\`\`` : '',
    ].filter(Boolean);
    return lines.join('\n\n');
  }

  async function fetchShellToolCapabilityContextForAutoFix(toolId) {
    try {
      const r = await companionApiRequest('GET', `/v1/capability-packages/${encodeURIComponent(toolId)}/context`, null, {
        timeoutMs: 8000,
      });
      if (r && r.ok && r.json && r.json.ok) return r.json;
    } catch {
      /* capability context is best-effort for auto-fix */
    }
    return null;
  }

  async function sendShellToolAutoFixToCopilot(payload) {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    const toolId = String(payload && payload.toolId ? payload.toolId : '').trim();
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) {
      return { ok: false, error: 'invalid_tool_id' };
    }
    const toolName = String(payload && payload.toolName ? payload.toolName : toolId).trim() || toolId;
    const prompt = buildShellToolAutoFixPrompt(payload || {});
    const fp = require('node:crypto')
      .createHash('sha256')
      .update(
        [
          toolId,
          payload && payload.actionId,
          payload && payload.error,
          payload && payload.exitCode,
          String(payload && payload.stderr ? payload.stderr : '').slice(0, 500),
          String(payload && payload.stdout ? payload.stdout : '').slice(0, 500),
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 16);
    const now = Date.now();
    const prev = shellToolAutoFixRecent.get(`${toolId}:${fp}`) || 0;
    if (now - prev < 12000) {
      return { ok: true, skipped: true, reason: 'duplicate_recent' };
    }
    shellToolAutoFixRecent.set(`${toolId}:${fp}`, now);

    expandCopilotPanelForAutoFix();
    const context = await fetchShellToolCapabilityContextForAutoFix(toolId);
    const session = context && context.session && typeof context.session === 'object' ? context.session : {};
    const capabilitySessionId =
      typeof session.sessionId === 'string' && session.sessionId.trim()
        ? session.sessionId.trim()
        : `capability:tool:${toolId}`;
    const contextPrompt =
      context && typeof context.contextPrompt === 'string' && context.contextPrompt.trim()
        ? context.contextPrompt.trim()
        : [
            'Current conversation is bound to a tool CapabilityPackage.',
            `CapabilityPackage ID: ${toolId}`,
            `Tool name: ${toolName}`,
            'Keep fixes, run results, and retests attached to this capability object.',
          ].join('\n');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shell-open-copilot-object-session', {
          type: 'capability',
          id: (session && session.id) || toolId,
          sessionId: capabilitySessionId,
          label: (session && session.label) || toolName,
          contextPrompt,
          focus: false,
        });
      }
    } catch {
      /* ignore */
    }

    const outboundPrompt = `${contextPrompt}\n\n用户这次说：\n${prompt}`;
    const trySend = async () => agentSessionService.sendUserMessage(outboundPrompt, { sessionId: capabilitySessionId });
    let result = await trySend();
    if (result && result.error === 'turn_in_progress') {
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        result = await trySend();
        if (!result || result.error !== 'turn_in_progress') break;
      }
    }
    if (result && result.ok === false) {
      return {
        ok: false,
        error: result.error || 'send_failed',
        queued: result.error === 'turn_in_progress',
      };
    }
    return { ok: true, sent: true };
  }

  ipcMain.handle('shell-tool-report-run-failure', async (_e, payload) => {
    try {
      return await sendShellToolAutoFixToCopilot(payload);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('shell-set-view', async (_e, view) => transitionMainProcessShellView(view));
  ipcMain.handle('shell-leased-rooms-list', () => ({ ok: true, rooms: leasedRoomStore.list() }));
  ipcMain.handle('shell-leased-rooms-create', () => {
    const room = leasedRoomStore.create();
    return { ok: true, room, rooms: leasedRoomStore.list() };
  });
  ipcMain.handle('shell-leased-rooms-remove', async (_e, payload) => {
    const id = String((payload && payload.id) || '');
    const rooms = leasedRoomStore.remove(id);
    if (!rooms) return { ok: false, error: 'not_found' };
    const switched = shellMainProcessActiveView === id;
    if (switched) {
      await transitionMainProcessShellView('workbench', { notifyRenderer: true });
    }
    return { ok: true, rooms, removedId: id, switchedToWorkbench: switched };
  });
  ipcMain.handle('shell-leased-room-context-menu', (event, payload) => {
    const id = String((payload && payload.id) || '');
    const room = leasedRoomStore.list().find((row) => row.id === id);
    if (!room) return { ok: false, error: 'not_found' };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: 'no_window' };
    const menu = Menu.buildFromTemplate([
      {
        label: `删除「${room.title}」`,
        click: () => {
          void (async () => {
            const rooms = leasedRoomStore.remove(id);
            if (!rooms) return;
            if (shellMainProcessActiveView === id) {
              await transitionMainProcessShellView('workbench', { notifyRenderer: true });
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('shell-leased-rooms-changed', { rooms, removedId: id });
            }
          })();
        },
      },
    ]);
    menu.popup({ window: win });
    return { ok: true };
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

  ipcMain.handle('shell-workbench-sidebar-inset', (_e, payload) => {
    const raw =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.px
        : payload;
    const n = Number(raw);
    const inset = Number.isFinite(n)
      ? Math.max(0, Math.min(Math.round(n), SHELL_SIDEBAR_WIDTH_EXPANDED))
      : SHELL_SIDEBAR_WIDTH_EXPANDED;
    shellWorkbenchSidebarInsetPx = inset;
    layoutShellChrome();
    return { ok: true, inset };
  });

  ipcMain.handle('shell-set-dsh-pane-width', (_e, payload) => {
    const w = payload && typeof payload === 'object' ? payload.widthPx : payload;
    const persist = !(payload && typeof payload === 'object' && payload.persist === false);
    const clamped = clampDshPaneWidth(w);
    shellDshPaneWidthPx = clamped;
    if (persist) saveShellSettings({ dshPaneWidth: clamped });
    layoutShellChrome();
    return { ok: true, dshPaneWidth: clamped };
  });
  ipcMain.handle('shell-set-dsh-pane-collapsed', (_e, payload) => {
    const collapsed = Boolean(payload && payload.collapsed);
    const next = saveShellSettings({ dshPaneCollapsed: collapsed });
    layoutShellChrome();
    return {
      ok: true,
      dshPaneCollapsed: next.dshPaneCollapsed,
      dshPaneWidth: next.dshPaneWidth,
    };
  });
  ipcMain.handle('shell-dsh-handoff', async (_e, payload) => applyDshHandoff(payload));
  ipcMain.handle('shell-get-workspace-finger', () => {
    const snap = workspaceDocumentStore.getSnapshot();
    return { ok: true, finger: snap.finger || {} };
  });
  ipcMain.handle('shell-send-to-current-host', async (_e, payload) => {
    const body = payload && typeof payload === 'object' ? payload : {};
    const hostId = body.hostId;
    const localVersionId = typeof body.localVersionId === 'string' ? body.localVersionId.trim() : '';
    if (localVersionId && hostId) {
      try {
        await companionApiRequest(
          'POST',
          '/v1/capability-packages/drafts/' + encodeURIComponent(String(hostId)) + '/local-version',
          { localVersionId, makeDefault: true },
          { timeoutMs: 12000 },
        );
      } catch (e) {
        console.warn('[shell-send]', e instanceof Error ? e.message : e);
      }
    }
    const picked = pickHostForSend(workspaceDocumentStore.getSnapshot().finger, hostId, localVersionId);
    if (!picked.ok) {
      const out = { ok: false, error: picked.error };
      const suggestSurface = sendHostErrorSuggestSurface(picked.error);
      if (suggestSurface) out.suggestSurface = suggestSurface;
      return out;
    }
    const finger = workspaceDocumentStore.getSnapshot().finger;
    const resolved = await workshopFileTreeHost.resolveSendFile(finger);
    if (!resolved || !resolved.ok) {
      return { ok: false, error: (resolved && resolved.error) || 'no_selection' };
    }
    const bridge = createHostPrimitiveBridge({
      companionApiRequest: (method, pathname, body, opts) => companionApiRequest(method, pathname, body, opts),
    });
    const invoked = await bridge.invokeHostPrimitive(
      picked.host.id,
      'host.import_file',
      { filePath: resolved.fileAbs, rel: resolved.fileRel },
      { localVersionId: picked.host.localVersionId || localVersionId },
    );
    if (!invoked || !invoked.ok) {
      return { ok: false, error: (invoked && invoked.error) || 'host_import_failed' };
    }
    const invokeBody = invoked.result && typeof invoked.result === 'object' ? invoked.result : {};
    const inner = invokeBody.result && typeof invokeBody.result === 'object' ? invokeBody.result : invokeBody;
    if (inner.ok === false) {
      return { ok: false, error: inner.error || inner.message || 'host_import_failed' };
    }
    return {
      ok: true,
      hostId: picked.host.id,
      filePath: resolved.fileAbs,
      message: inner.message,
    };
  });

  ipcMain.handle('shell-set-copilot-layout', (_e, layout) => {
    const col = Boolean(layout && layout.collapsed);
    shellCopilotCollapsed = col;
    const w = Number(layout && layout.widthPx);
    if (Number.isFinite(w)) {
      shellCopilotWidthPx = Math.round(
        Math.min(SHELL_COPILOT_WIDTH_MAX, Math.max(SHELL_COPILOT_WIDTH_MIN, w)),
      );
    }
    if (agentStore) {
      agentStore.writeSettings({
        copilotCollapsed: shellCopilotCollapsed,
        copilotWidth: shellCopilotWidthPx,
      });
    }
    layoutShellChrome();
    return {
      ok: true,
      collapsed: shellCopilotCollapsed,
      widthPx: shellCopilotWidthPx,
      effectiveWidthPx: getCopilotEffectiveWidthPx(),
    };
  });

  ipcMain.handle('shell-get-copilot-layout', () => ({
    ok: true,
    collapsed: shellCopilotCollapsed,
    widthPx: shellCopilotWidthPx,
    effectiveWidthPx: getCopilotEffectiveWidthPx(),
  }));

  ipcMain.handle('agent-session-list-messages', (_e, sessionId) => {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    return { ok: true, messages: agentSessionService.listMessages(sessionId) };
  });

  ipcMain.handle('agent-session-clear-history', (_e, sessionId) => {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    try {
      return agentSessionService.clearHistory(sessionId);
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('agent-session-send', async (_e, payload) => {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    const text = payload && typeof payload === 'object' ? payload.text : payload;
    const sessionId = payload && typeof payload === 'object' ? payload.sessionId : undefined;
    return agentSessionService.sendUserMessage(text, { sessionId });
  });

  ipcMain.handle('agent-session-abort', () => {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    return agentSessionService.abortTurn();
  });

  ipcMain.handle('agent-session-probe-brain', async () => {
    if (!agentSessionService) return { ok: false, error: 'agent_not_ready' };
    const probe = await agentSessionService.probeBrain();
    return { ok: true, brainId: agentSessionService.getBrainId(), probe };
  });

  ipcMain.handle('agent-runtime-status', async () => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    const settings = agentStore.readSettings();
    return {
      ok: true,
      settings,
      codexRuntime: buildCodexRuntimeStatus(settings),
      codexAuth: codexAuthStatus(),
      brainMetas: agentStore.listBrainMetas(),
      activeBrainId: agentSessionService ? agentSessionService.getBrainId() : 'stub',
    };
  });

  ipcMain.handle('agent-session-confirm', (_e, confirmId, approved) => {
    return resolveAgentConfirm(confirmId, approved);
  });

  ipcMain.handle('agent-settings-load', async () => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    const settings = agentStore.readSettings();
    const mcp = agentMcpServer ? agentMcpServer.status() : { enabled: false, running: false };
    const mcpConfig = agentMcpServer ? agentMcpServer.buildMcpClientConfig() : null;
    const mcpToolCatalog = await buildAgentMcpToolCatalog();
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    const agentPolicyConfig = agentPolicy ? agentPolicy.readPolicy() : null;
    return {
      ok: true,
      settings,
      mcp,
      mcpConfig,
      mcpToolCatalog,
      mcpEntranceStatus,
      agentPolicy: agentPolicyConfig,
      policyTemplates: agentPolicy && typeof agentPolicy.listPolicyTemplates === 'function' ? agentPolicy.listPolicyTemplates() : [],
      codexRuntime: buildCodexRuntimeStatus(settings),
      codexAuth: codexAuthStatus(),
      brains: listBrainCatalog(),
      brainMetas: agentStore.listBrainMetas(),
      activeBrainId: agentSessionService ? agentSessionService.getBrainId() : 'stub',
    };
  });

  ipcMain.handle('agent-settings-save', async (_e, patch) => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    const normalizedPatch = { ...(patch && typeof patch === 'object' ? patch : {}), defaultBrainId: 'codex' };
    const prev = agentStore.readSettings();
    const next = agentStore.writeSettings(normalizedPatch);
    if (agentPolicy && Object.prototype.hasOwnProperty.call(normalizedPatch, 'codexPermissionMode')) {
      agentPolicy.writePolicy({ confirmTools: next.codexPermissionMode !== 'full' });
    }
    if (prev.defaultBrainId !== next.defaultBrainId || codexSettingsChanged(prev, next)) {
      resetAgentBrainCache();
      await ensureAgentBrainReady();
    }
    if (agentMcpServer) {
      await agentMcpServer.syncFromSettings();
    }
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    return {
      ok: true,
      settings: next,
      mcp: agentMcpServer ? agentMcpServer.status() : null,
      mcpConfig: agentMcpServer ? agentMcpServer.buildMcpClientConfig() : null,
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
      mcpEntranceStatus,
      agentPolicy: agentPolicy ? agentPolicy.readPolicy() : null,
      policyTemplates: agentPolicy && typeof agentPolicy.listPolicyTemplates === 'function' ? agentPolicy.listPolicyTemplates() : [],
      codexRuntime: buildCodexRuntimeStatus(next),
      codexAuth: codexAuthStatus(),
      activeBrainId: agentSessionService ? agentSessionService.getBrainId() : 'stub',
    };
  });

  ipcMain.handle('agent-codex-auth-sync', async () => {
    const result = await syncCodexSharedAuthIfEnabled('manual');
    if (result.ok) {
      await ensureAgentBrainReady();
    }
    const settings = agentStore ? agentStore.readSettings() : null;
    return {
      ...result,
      settings,
      codexRuntime: buildCodexRuntimeStatus(settings),
      activeBrainId: agentSessionService ? agentSessionService.getBrainId() : 'stub',
    };
  });

  ipcMain.handle('agent-codex-one-click-setup', async (_e, options) => {
    return runCodexOneClickSetup(options);
  });

  ipcMain.handle('agent-usage-summary', async (_e, options) => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    return { ok: true, summary: summarizeCopilotUsageAudit(options && typeof options === 'object' ? options : {}) };
  });

  ipcMain.handle('agent-usage-upload-cloud-draft', async (_e, options) => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    return uploadCopilotUsageCloudDraft(options && typeof options === 'object' ? options : {});
  });

  ipcMain.handle('agent-usage-quota-policy-probe', async () => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    return probeCopilotUsageQuotaPolicy();
  });

  ipcMain.handle('agent-workflow-promotion-preflight', async (_e, options) => {
    if (!agentBodyHost || !agentStore) return { ok: false, error: 'agent_not_ready' };
    const opts = options && typeof options === 'object' ? options : {};
    const target = String(opts.target || '').trim();
    const name =
      target === 'script_hub_tool'
        ? 'ac.workflow.promote_script_hub_tool'
        : target === 'workbench_preset'
          ? 'ac.workflow.promote_workbench_preset'
          : '';
    if (!name) return { ok: false, error: 'invalid_target' };
    const args = {
      skillId: String(opts.skillId || '').trim(),
      ...(opts.presetName ? { presetName: String(opts.presetName) } : {}),
      ...(opts.toolName ? { toolName: String(opts.toolName) } : {}),
    };
    if (!args.skillId) return { ok: false, error: 'missing_skill_id' };
    const startedAt = Date.now();
    const toolCallId = `shell_tool_${randomBytes(16).toString('hex')}`;
    const result = await agentBodyHost.executeTool(name, args, {
      sessionId: 'shell-settings',
      brainId: 'copilot-ui',
      shellView: currentShellView,
      clientId: 'shell',
      toolCallId,
      policyDecision: 'copilot_ui_admin_confirm',
      adminConfirmationPassed: true,
      adminConfirmationSource: 'copilot_ui',
      auditRecordWritten: true,
    });
    agentStore.appendAudit({
      ts: new Date().toISOString(),
      clientId: 'shell',
      sessionId: 'shell-settings',
      brainId: 'copilot-ui',
      toolCallId,
      tool: name,
      ok: Boolean(result && result.ok),
      errorCode: result && result.error && result.error.code ? result.error.code : null,
      argsDigest: JSON.stringify({ skillId: args.skillId, target }).slice(0, 500),
      durationMs: Date.now() - startedAt,
      policyDecision: 'copilot_ui_admin_confirm',
    });
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    return {
      ok: true,
      tool: name,
      target,
      toolCallId,
      result,
      preflight: result && result.structured ? result.structured : null,
      mcpEntranceStatus,
    };
  });

  ipcMain.handle('agent-workflow-promotion-drafts', async () => {
    return listWorkflowPromotionDraftSummaries();
  });

  ipcMain.handle('agent-tool-executions', async (_e, options) => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    return { ok: true, executions: agentStore.listToolExecutions(options && typeof options === 'object' ? options : {}) };
  });

  ipcMain.handle('shell-desktop-observation-start', async (_event, payload) => {
    return startDesktopObservationRuntime(payload);
  });

  ipcMain.handle('shell-desktop-observation-frame', async (_event, payload) => {
    return appendDesktopObservationFrame(payload);
  });

  ipcMain.handle('shell-desktop-observation-status', async () => {
    return buildDesktopObservationStatus();
  });

  ipcMain.handle('shell-desktop-observation-stop', async () => {
    return stopDesktopObservationRuntime();
  });

  ipcMain.handle('agent-workbench-context', async () => {
    if (!agentWorkbenchClient || typeof agentWorkbenchClient.getContext !== 'function') {
      return { ok: false, error: 'agent_not_ready' };
    }
    const context = await agentWorkbenchClient.getContext();
    await syncConnectedHostsFromCompanion();
    const executions = agentStore ? agentStore.listToolExecutions({ limit: 5 }) : [];
    return {
      ok: Boolean(context && context.ok),
      context,
      structured: context && context.structured ? context.structured : null,
      executions,
    };
  });

  ipcMain.handle('workspace-dispatch', async (_event, command) => {
    return dshWorkspaceTools.workspace_dispatch(command);
  });

  ipcMain.handle('workspace-hydrate-document', async (_event, payload) => {
    let folderSource = false;
    try {
      folderSource = workshopFolderSourceOfTruthFromState(workshopFileTreeHost.state());
    } catch {
      folderSource = false;
    }
    if (folderSource) {
      refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
      return { ok: true, snapshot: workspaceDocumentStore.getSnapshot(), skippedAssets: true };
    }
    const snapshot = workspaceDocumentStore.hydrate(payload && typeof payload === 'object' ? payload : {});
    refreshDshFingerInject(workspaceDocumentStore.getSnapshot());
    return { ok: true, snapshot };
  });

  ipcMain.handle('workspace-read-finger', async () => {
    return dshWorkspaceTools.workspace_read_finger();
  });

  ipcMain.handle('workspace-read-document', async () => {
    return dshWorkspaceTools.workspace_read_document();
  });

  ipcMain.handle('workspace-read-compartment', async (_event, payload) => {
    const compartment = String((payload && payload.compartment) || 'workshop').trim();
    const doc = dshWorkspaceTools.workspace_read_document();
    if (!doc || doc.ok === false) return doc || { ok: false, error: 'read_failed' };
    const { compartmentAssetIdsFromSnapshot } = require('./workshop-folder-source.cjs');
    const assetIds = compartmentAssetIdsFromSnapshot(doc, compartment);
    const assets = {};
    if (doc.assets && typeof doc.assets === 'object') {
      for (const id of assetIds) {
        if (doc.assets[id]) assets[id] = doc.assets[id];
      }
    }
    return { ok: true, compartment, assetIds, assets };
  });

  ipcMain.handle('workspace-open-surface', async (_event, surface) => {
    return dshWorkspaceTools.workspace_open_surface(surface);
  });

  ipcMain.handle('workspace-sync-connection-drafts', async (_event, drafts) => {
    const finger = workspaceDocumentStore.getSnapshot().finger || {};
    const hosts = overlayConnectedHosts(Array.isArray(drafts) ? drafts : [], {
      hasSelectedCard: Boolean(finger.selectedAssetId),
      selectedRelPath: finger.selectedRelPath,
    });
    return { ok: true, hosts };
  });

  ipcMain.handle('workshop-file-state', async () => workshopFileTreeHost.state());
  ipcMain.handle('workshop-file-pick-root', async () => workshopFileTreeHost.pickRoot());
  ipcMain.handle('workshop-file-remove-root', async (_event, payload) => workshopFileTreeHost.removeRoot(payload || {}));
  ipcMain.handle('workshop-file-list', async (_event, payload) => workshopFileTreeHost.list(payload || {}));
  ipcMain.handle('workshop-file-thumb', async (_event, payload) => workshopFileTreeHost.thumb(payload || {}));
  ipcMain.handle('workshop-file-read', async (_event, payload) => workshopFileTreeHost.readFile(payload || {}));
  ipcMain.handle('workshop-file-media', async (_event, payload) => workshopFileTreeHost.getMedia(payload || {}));
  ipcMain.handle('workshop-file-write-result', async (_event, payload) => workshopFileTreeHost.writeResult(payload || {}));
  ipcMain.handle('workshop-file-create-package', async (_event, payload) => workshopFileTreeHost.createPackage(payload || {}));
  ipcMain.handle('workshop-file-create-checkout', async (_event, payload) => workshopFileTreeHost.createCheckoutFile(payload || {}));
  ipcMain.handle('workshop-file-write-checkout', async (_event, payload) => workshopFileTreeHost.writeCheckoutFile(payload || {}));
  ipcMain.handle('workshop-file-import', async (_event, payload) => workshopFileTreeHost.importFiles(payload || {}));
  ipcMain.handle('workshop-file-mkdir', async (_event, payload) => workshopFileTreeHost.mkdir(payload || {}));
  ipcMain.handle('workshop-file-move', async (_event, payload) => workshopFileTreeHost.moveEntries(payload || {}));
  ipcMain.handle('workshop-file-copy', async (_event, payload) => workshopFileTreeHost.copyEntries(payload || {}));
  ipcMain.handle('workshop-file-trash', async (_event, payload) => workshopFileTreeHost.trashEntries(payload || {}));
  ipcMain.handle('workshop-file-group', async (_event, payload) => workshopFileTreeHost.groupEntries(payload || {}));
  ipcMain.handle('workshop-file-upgrade-loose', async (_event, payload) => workshopFileTreeHost.upgradeLoose(payload || {}));
  ipcMain.handle('workshop-file-apply-checkout', async (_event, payload) => workshopFileTreeHost.applyCheckout(payload || {}));
  ipcMain.handle('workshop-file-set-face', async (_event, payload) => workshopFileTreeHost.setFace(payload || {}));
  ipcMain.handle('workshop-file-pick-workspace', async () => workshopFileTreeHost.pickWorkspaceDir());
  ipcMain.handle('workshop-file-set-library-open', async (_event, payload) =>
    workshopFileTreeHost.setLibraryOpen(payload || {}),
  );

  ipcMain.handle('agent-project-memory-list', async (_event, options) => {
    return listCopilotProjectMemory(options && typeof options === 'object' ? options : {});
  });

  ipcMain.handle('agent-project-memory-save', async (_event, entry) => {
    return saveCopilotProjectMemory(entry && typeof entry === 'object' ? entry : {});
  });

  ipcMain.handle('agent-project-memory-update', async (_event, payload) => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const result = updateProjectMemoryNote(agentStore.memoryDir(), p.id, p.patch && typeof p.patch === 'object' ? p.patch : {});
    if (!result.ok) return result;
    const scope = await readCurrentProjectMemoryScope(p);
    return {
      ok: true,
      note: result.note,
      summary: summarizeProjectMemory(agentStore.memoryDir(), { projectId: scope.projectId, limit: 200 }),
    };
  });

  ipcMain.handle('agent-mcp-regenerate-token', async () => {
    if (!agentMcpServer || !agentStore) return { ok: false, error: 'agent_not_ready' };
    const r = agentMcpServer.regenerateToken();
    if (agentStore.readSettings().mcpEnabled) {
      await agentMcpServer.syncFromSettings();
    }
    return {
      ok: true,
      ...r,
      settings: agentStore.readSettings(),
      mcp: agentMcpServer.status(),
      mcpConfig: agentMcpServer.buildMcpClientConfig(),
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
    };
  });

  ipcMain.handle('agent-mcp-status', async () => {
    if (!agentMcpServer) return { ok: false, error: 'agent_not_ready' };
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    return {
      ok: true,
      mcp: agentMcpServer.status(),
      mcpConfig: agentMcpServer.buildMcpClientConfig(),
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
      mcpEntranceStatus,
    };
  });

  ipcMain.handle('agent-mcp-probe', async () => {
    if (!agentMcpServer) return { ok: false, error: 'agent_not_ready' };
    const probe = await agentMcpServer.probeSelf();
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    return {
      ok: true,
      probe,
      mcp: agentMcpServer.status(),
      mcpConfig: agentMcpServer.buildMcpClientConfig(),
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
      mcpEntranceStatus,
    };
  });

  ipcMain.handle('agent-mcp-workbench-e2e', async (_event, options) => {
    if (!agentMcpServer || typeof agentMcpServer.runWorkbenchE2eSelf !== 'function') {
      return { ok: false, error: 'agent_not_ready' };
    }
    const e2e = await agentMcpServer.runWorkbenchE2eSelf(options && typeof options === 'object' ? options : {});
    const shellAccount = await readShellAccountStatus();
    const mcpWorkbenchLastE2e = summarizeWorkbenchE2eEntrance(e2e, shellAccount);
    if (agentStore) agentStore.writeSettings({ mcpWorkbenchLastE2e });
    const mcpEntranceStatus = await buildAgentMcpEntranceStatus();
    return {
      ok: true,
      e2e,
      shellAccount,
      mcpWorkbenchLastE2e,
      mcp: agentMcpServer.status(),
      mcpConfig: agentMcpServer.buildMcpClientConfig(),
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
      mcpEntranceStatus,
    };
  });

  ipcMain.handle('agent-mcp-tool-catalog', async () => {
    if (!agentBodyHost) return { ok: false, error: 'agent_not_ready' };
    return { ok: true, mcpToolCatalog: await buildAgentMcpToolCatalog() };
  });

  ipcMain.handle('agent-policy-load', async () => {
    if (!agentPolicy) return { ok: false, error: 'agent_not_ready' };
    return {
      ok: true,
      agentPolicy: agentPolicy.readPolicy(),
      policyTemplates: typeof agentPolicy.listPolicyTemplates === 'function' ? agentPolicy.listPolicyTemplates() : [],
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
    };
  });

  ipcMain.handle('agent-policy-save', async (_e, patch) => {
    if (!agentPolicy) return { ok: false, error: 'agent_not_ready' };
    const body = patch && typeof patch === 'object' ? patch : {};
    const templateId = body.templateId ? String(body.templateId) : '';
    const applied = templateId && typeof agentPolicy.applyPolicyTemplate === 'function'
      ? agentPolicy.applyPolicyTemplate(templateId)
      : null;
    if (applied && !applied.ok) return applied;
    const next = applied && applied.ok ? applied.policy : agentPolicy.writePolicy(body);
    return {
      ok: true,
      agentPolicy: next,
      appliedTemplate: applied && applied.ok ? applied.template : '',
      policyTemplates: typeof agentPolicy.listPolicyTemplates === 'function' ? agentPolicy.listPolicyTemplates() : [],
      mcpToolCatalog: await buildAgentMcpToolCatalog(),
    };
  });

  ipcMain.handle('agent-probe-all-brains', async () => {
    if (!agentStore) return { ok: false, error: 'agent_not_ready' };
    const catalog = listBrainCatalog();
    const out = [];
    for (const b of catalog) {
      const adapter = createBrainAdapter(b.id, { store: agentStore });
      try {
        const probe = await adapter.probe();
        const meta = agentStore.writeBrainMeta(b.id, {
          displayName: b.displayName,
          lastProbeOk: Boolean(probe.ok),
          lastProbeDetail: probe.detail || null,
          lastProbeAt: new Date().toISOString(),
        });
        out.push({ id: b.id, displayName: b.displayName, probe, meta });
      } catch (e) {
        out.push({
          id: b.id,
          displayName: b.displayName,
          probe: { ok: false, detail: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    return { ok: true, brains: out, activeBrainId: agentSessionService ? agentSessionService.getBrainId() : 'stub' };
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

  ipcMain.handle('shell-fetch-shell-tool-catalog', async () => {
    try {
      return await fetchShellToolCatalogFromSite();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), artifacts: [] };
    }
  });

  ipcMain.handle('shell-pick-path', async (event, opts) => {
    const pick = opts && opts.pick === 'file' ? 'file' : 'directory';
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const properties =
      pick === 'file' ? ['openFile'] : ['openDirectory', 'createDirectory'];
    const r = await dialog.showOpenDialog(win || undefined, {
      title: pick === 'file' ? '选择文件' : '选择文件夹',
      properties,
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  });

  ipcMain.handle('shell-save-path', async (event, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const defaultPath = typeof o.defaultPath === 'string' ? o.defaultPath.trim() : '';
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '保存文件';
    const filters = Array.isArray(o.filters)
      ? o.filters
          .map((f) => ({
            name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim() : 'Files',
            extensions: Array.isArray(f?.extensions)
              ? f.extensions.map((x) => String(x || '').replace(/^\./, '').trim()).filter(Boolean)
              : [],
          }))
          .filter((f) => f.extensions.length > 0)
      : [];
    const r = await dialog.showSaveDialog(win || undefined, {
      title,
      ...(defaultPath ? { defaultPath } : {}),
      ...(filters.length ? { filters } : {}),
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('shell-save-text-file', async (event, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const text = typeof o.text === 'string' ? o.text : '';
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const r = await dialog.showSaveDialog(win || undefined, {
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '保存文件',
      ...(typeof o.defaultPath === 'string' && o.defaultPath.trim() ? { defaultPath: o.defaultPath.trim() } : {}),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fsp.writeFile(r.filePath, text, 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('shell-read-text-file', async (_event, opts) => {
    const filePath = String(opts && opts.path ? opts.path : '').trim();
    if (!filePath) return { ok: false, error: 'missing_path' };
    const abs = path.resolve(path.normalize(filePath));
    if (!fs.existsSync(abs)) return { ok: false, error: 'path_not_found' };
    if (path.extname(abs).toLowerCase() !== '.json') return { ok: false, error: 'unsupported_file_type' };
    const text = await fsp.readFile(abs, 'utf8');
    return { ok: true, path: abs, text };
  });

  ipcMain.handle('shell-resolve-dropped-connection-path', async (_event, payload) => {
    try {
      return resolveDroppedConnectionPath(payload || {});
    } catch (e) {
      return { ok: false, error: 'drop_resolve_failed', message: e instanceof Error ? e.message : String(e) };
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

  ipcMain.handle('shell-paddleocr-desktop-state', () => {
    if (process.platform !== 'win32') {
      return { ok: true, platformUnsupported: true, installed: false };
    }
    const scriptPath = paddleOcrBootstrapScriptPath();
    const st = readPaddleOcrDesktopRuntimeState();
    return {
      ok: true,
      platformUnsupported: false,
      hasBootstrapScript: fs.existsSync(scriptPath),
      installed: Boolean(st?.ready),
      device: typeof st?.device === 'string' ? st.device : 'cpu',
      pythonExe: typeof st?.pythonExe === 'string' ? st.pythonExe : undefined,
    };
  });

  ipcMain.handle('shell-paddleocr-bootstrap-run', async (event, payload) => {
    if (process.platform !== 'win32') {
      return { ok: false, error: '仅支持 Windows' };
    }
    if (anyDesktopBootstrapChildRunning()) {
      return { ok: false, error: '正在安装中，请稍候' };
    }
    const scriptPath = paddleOcrBootstrapScriptPath();
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, error: '缺少 paddleocr-bootstrap 脚本' };
    }
    const useGpu =
      payload && typeof payload === 'object' && payload.useGpu === true ? '1' : '0';
    const userRoot = path.join(app.getPath('userData'), 'paddleocr-runtime');
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const sendLog = (logPayload) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send('paddleocr-bootstrap-log', logPayload);
      } catch {
        /* ignore */
      }
    };
    const sbRoot = companionSandboxPaths.getCompanionSandboxRoot();
    paddleOcrBootstrapChild = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AC_PADDLEOCR_USER_ROOT: userRoot,
        AC_PADDLEOCR_GPU: useGpu,
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
    paddleOcrBootstrapChild.stdout.on('data', (b) => {
      outCarry = feedLines(outCarry, b);
    });
    paddleOcrBootstrapChild.stderr.on('data', (b) => {
      errCarry = feedLines(errCarry, b);
    });
    paddleOcrBootstrapChild.on('error', (err) => {
      paddleOcrBootstrapChild = null;
      outCarry = '';
      errCarry = '';
      sendLog({ type: 'error', msg: err.message });
      sendLog({ type: 'bootstrap-finished', ok: false });
    });
    paddleOcrBootstrapChild.on('close', (code) => {
      flushCarry(outCarry);
      flushCarry(errCarry);
      outCarry = '';
      errCarry = '';
      paddleOcrBootstrapChild = null;
      const ok = code === 0;
      sendLog({ type: 'bootstrap-finished', ok, exitCode: code });
      if (ok) {
        void restartLocalCompanionFromTray({ aggressive: true }).catch((e) =>
          console.error('[companion-desktop] restart after PaddleOCR bootstrap:', e),
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      setTimeout(() => {
        void maybeRunCodexOneClickSetupFromLaunch(commandLine);
      }, 250);
      return;
    }
    openMainWindow();
    setTimeout(() => {
      void maybeRunCodexOneClickSetupFromLaunch(commandLine);
    }, 700);
  });

  app.whenReady().then(() => {
    ensureCompanionSandboxLayout();
    initAgentPlatform();
    registerCompanionProtocol();
    attachWorkshopMediaProtocol(protocol, null, {
      isAllowedAbs: (abs) => workshopFileTreeHost.isAllowedMediaAbs(abs),
      session: session.fromPartition(FIRST_PARTY_WEB_PARTITION),
    });
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
    if (process.env.COMPANION_DESKTOP_NO_AUTO_SHELL !== '1' || argvWantsCodexAutoSetup(process.argv)) {
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
    try {
      if (dshHostController) dshHostController.stop();
    } catch {
      /* ignore */
    }
    try {
      killLoopbackPortListeners(3080);
    } catch {
      /* ignore */
    }
    // Drop AssetCutter MCP from shared ~/.codex so ChatGPT desktop is not left
    // requiring ASSETCUTTER_MCP_TOKEN after the companion exits.
    try {
      removeCodexMcpServerConfig({});
    } catch (e) {
      companionLog('warn', '[codex-mcp] remove on quit failed', e instanceof Error ? e.message : e);
    }
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
