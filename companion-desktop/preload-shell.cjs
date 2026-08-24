'use strict';

const { app, contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');

const DEFAULT_SHELL_SITE_DEV = 'http://localhost:3000';
const DEFAULT_SHELL_SITE_PACKAGED = 'https://assetcutter-ai-pro.vercel.app/';

function defaultShellSiteUrl() {
  try {
    return app.isPackaged ? DEFAULT_SHELL_SITE_PACKAGED : DEFAULT_SHELL_SITE_DEV;
  } catch {
    return DEFAULT_SHELL_SITE_DEV;
  }
}

const IPC_MS_DEFAULT = 15000;
const IPC_MS_MAX = 600000;
let latestDroppedFilePaths = [];

function timedInvoke(channel, ...args) {
  let timeoutMs = IPC_MS_DEFAULT;
  const last = args[args.length - 1];
  if (typeof last === 'number' && Number.isFinite(last)) {
    timeoutMs = Math.min(Math.max(Math.floor(last), 1000), IPC_MS_MAX);
    args = args.slice(0, -1);
  }
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('IPC 超时（' + timeoutMs + 'ms）')), timeoutMs),
    ),
  ]);
}

function apiTimeoutMs(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const n = Number(o.timeoutMs);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1000), IPC_MS_MAX) : IPC_MS_DEFAULT;
}

function pathsFromDroppedFiles(files) {
  const list = Array.from(files || []);
  return list
    .map((file) => {
      try {
        if (webUtils && typeof webUtils.getPathForFile === 'function') {
          return webUtils.getPathForFile(file);
        }
      } catch {
        /* ignore */
      }
      return typeof file?.path === 'string' ? file.path : '';
    })
    .filter(Boolean);
}

function rememberDroppedFilePaths(event) {
  try {
    const files = event && event.dataTransfer && event.dataTransfer.files;
    const paths = pathsFromDroppedFiles(files);
    if (paths.length) latestDroppedFilePaths = paths;
  } catch {
    /* ignore */
  }
}

try {
  window.addEventListener('drop', rememberDroppedFilePaths, true);
  window.addEventListener('dragover', rememberDroppedFilePaths, true);
} catch {
  /* ignore */
}

contextBridge.exposeInMainWorld('companionShell', {
  api: (method, pathname, body, opts) =>
    timedInvoke('companion-api', method, pathname, body, opts || {}, apiTimeoutMs(opts)),
  fetchHostBundleCatalog: () => timedInvoke('shell-fetch-host-bundle-catalog'),
  fetchShellToolCatalog: () => timedInvoke('shell-fetch-shell-tool-catalog'),
  pickPath: (opts) => timedInvoke('shell-pick-path', opts || {}),
  savePath: (opts) => timedInvoke('shell-save-path', opts || {}),
  saveTextFile: (opts) => timedInvoke('shell-save-text-file', opts || {}, 120000),
  readTextFile: (opts) => timedInvoke('shell-read-text-file', opts || {}, 120000),
  droppedFilePaths: (files) => {
    const paths = pathsFromDroppedFiles(files);
    return paths.length ? paths : latestDroppedFilePaths.slice();
  },
  resolveDroppedConnectionPath: (payload) => timedInvoke('shell-resolve-dropped-connection-path', payload || {}),
  openToolWindow: (toolId) => timedInvoke('shell-open-tool-window', toolId),
  closeToolWindow: (toolId) => timedInvoke('shell-close-tool-window', toolId),
  submitShellToolForReview: (toolId) => timedInvoke('shell-submit-shell-tool-review', toolId, 600000),
  publishShellToolToCloud: (toolId) => timedInvoke('shell-publish-shell-tool-cloud', toolId, 600000),
  syncHostBridgesFromCloud: () => timedInvoke('shell-sync-host-bridges-cloud', 120000),
  publishHostBridgeToCloud: (payload) => timedInvoke('shell-publish-host-bridge-cloud', payload || {}, 600000),
  activateHostBridgeCloudVersion: (payload) => timedInvoke('shell-activate-host-bridge-cloud-version', payload || {}, 120000),
  resolveCompanionArtifactDownload: (artifactId) =>
    timedInvoke('shell-resolve-companion-artifact-download', artifactId, 120000),
  builtinExampleAvailable: () => timedInvoke('shell-builtin-example-available'),
  samLocalDesktopState: () => timedInvoke('shell-sam-local-desktop-state'),
  samLocalBootstrapRun: () => timedInvoke('shell-sam-local-bootstrap-run'),
  rembgDesktopState: () => timedInvoke('shell-rembg-desktop-state'),
  rembgBootstrapRun: () => timedInvoke('shell-rembg-bootstrap-run'),
  paddleOcrDesktopState: () => timedInvoke('shell-paddleocr-desktop-state'),
  paddleOcrBootstrapRun: (opts) => timedInvoke('shell-paddleocr-bootstrap-run', opts || {}),
  traySummary: () => timedInvoke('shell-tray-summary'),
  checkShellUpdate: () => timedInvoke('shell-check-shell-update'),
  installShellUpdate: () => timedInvoke('shell-install-shell-update'),
  loadSettings: () => timedInvoke('shell-settings-load'),
  saveSettings: (patch) => timedInvoke('shell-settings-save', patch),
  accountStatus: () => timedInvoke('shell-account-status'),
  pickVolumeRoot: () => timedInvoke('shell-pick-volume-root'),
  pickDownloadDir: () => timedInvoke('shell-pick-download-dir'),
  getEffectiveDownloadDir: () => timedInvoke('shell-get-effective-download-dir'),
  applyVolumeChange: (payload) => timedInvoke('shell-apply-volume-change', payload || {}),
  restartCompanion: (opts) => timedInvoke('shell-restart-companion', opts || {}),
  openWebsite: (url) => timedInvoke('shell-open-website', url),
  openManagementBrowser: () => timedInvoke('shell-open-management'),
  openFolderPath: (absPath) => timedInvoke('shell-open-folder-path', absPath),
  minimizeWindow: () => timedInvoke('shell-window-minimize'),
  closeWindow: () => timedInvoke('shell-window-close'),
  toggleMaximize: () => timedInvoke('shell-window-toggle-maximize'),
  setShellView: (view) => timedInvoke('shell-set-view', view, 120000),
  popupSidebarContextMenu: () => timedInvoke('shell-sidebar-context-menu-popup'),
  workbenchReload: () => timedInvoke('shell-workbench-reload'),
  workbenchReloadHard: () => timedInvoke('shell-workbench-reload-hard'),
  workbenchOpenExternal: () => timedInvoke('shell-workbench-open-external'),
  desktopObservationStart: (payload) => timedInvoke('shell-desktop-observation-start', payload || {}),
  desktopObservationFrame: (payload) => timedInvoke('shell-desktop-observation-frame', payload || {}),
  desktopObservationStatus: () => timedInvoke('shell-desktop-observation-status'),
  desktopObservationStop: () => timedInvoke('shell-desktop-observation-stop'),
  // Pass object so numeric 0 is not eaten by timedInvoke's trailing-timeout heuristic.
  setWorkbenchSidebarInsetPx: (px) =>
    timedInvoke('shell-workbench-sidebar-inset', { px: Math.max(0, Math.round(Number(px) || 0)) }),
  loadPairing: () => timedInvoke('shell-load-pairing'),
  savePairing: (payload) => timedInvoke('shell-save-pairing', payload || {}),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
  },
  /** 主进程在用户从托盘选择「本机分割准备」时广播，渲染进程可切换至设置并滚动到 SamLocal 区块 */
  onSamLocalSetupFocus: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-focus-sam-local-setup', () => {
      try {
        handler();
      } catch {
        /* ignore */
      }
    });
  },
  /** SamLocal 一键安装进度：主进程逐行 JSON 或结束事件 */
  onSamLocalBootstrapLog: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('sam-local-bootstrap-log', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  onRembgBootstrapLog: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('rembg-bootstrap-log', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  onPaddleOcrBootstrapLog: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('paddleocr-bootstrap-log', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  onUpdaterState: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-updater-state', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  platform: process.platform,
  /** 与 main.cjs `defaultShellSiteUrl` 一致，供壳首帧与「打开网站」回退 */
  defaultSiteUrl: defaultShellSiteUrl(),
  defaultScriptHubApiUrl: (() => {
    try {
      return 'http://localhost:8787/';
    } catch {
      return 'http://localhost:8787/';
    }
  })(),
  setCopilotLayout: (layout) => timedInvoke('shell-set-copilot-layout', layout || {}),
  getCopilotLayout: () => timedInvoke('shell-get-copilot-layout'),
  onCopilotLayout: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-copilot-layout', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  onShellViewSync: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-sync-view', (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    });
  },
  onCopilotOnboardingFocus: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-focus-copilot-onboarding', () => {
      try {
        handler();
      } catch {
        /* ignore */
      }
    });
  },
  onOpenCopilotObjectSession: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-open-copilot-object-session', (_evt, payload) => {
      try {
        handler(payload || {});
      } catch {
        /* ignore */
      }
    });
  },
  onCopilotRefreshOnboarding: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('shell-copilot-refresh-onboarding', () => {
      try {
        handler();
      } catch {
        /* ignore */
      }
    });
  },
  agentSession: {
    listMessages: (sessionId) => timedInvoke('agent-session-list-messages', sessionId),
    clearHistory: (sessionId) => timedInvoke('agent-session-clear-history', sessionId),
    send: (text, sessionId) => timedInvoke('agent-session-send', { text, sessionId }, 600000),
    abort: () => timedInvoke('agent-session-abort'),
    confirm: (confirmId, approved) => timedInvoke('agent-session-confirm', confirmId, approved),
    probeBrain: () => timedInvoke('agent-session-probe-brain'),
    probeAllBrains: () => timedInvoke('agent-probe-all-brains', 60000),
    runtimeStatus: () => timedInvoke('agent-runtime-status'),
    loadSettings: () => timedInvoke('agent-settings-load'),
    saveSettings: (patch) => timedInvoke('agent-settings-save', patch || {}),
    syncCodexAuth: () => timedInvoke('agent-codex-auth-sync', 120000),
    setupCodex: (options) => timedInvoke('agent-codex-one-click-setup', options || {}, 600000),
    onCodexSetupProgress: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_evt, payload) => {
        try {
          handler(payload);
        } catch {
          /* ignore */
        }
      };
      ipcRenderer.on('agent-codex-setup-progress', listener);
      return () => ipcRenderer.removeListener('agent-codex-setup-progress', listener);
    },
    usageSummary: (options) => timedInvoke('agent-usage-summary', options || {}),
    usageUploadCloudDraft: (options) => timedInvoke('agent-usage-upload-cloud-draft', options || {}, 120000),
    usageQuotaPolicyProbe: () => timedInvoke('agent-usage-quota-policy-probe', 120000),
    workflowPromotionPreflight: (options) => timedInvoke('agent-workflow-promotion-preflight', options || {}, 120000),
    workflowPromotionDrafts: () => timedInvoke('agent-workflow-promotion-drafts'),
    toolExecutions: (options) => timedInvoke('agent-tool-executions', options || {}),
    workbenchContext: () => timedInvoke('agent-workbench-context', {}, 120000),
    projectMemory: (options) => timedInvoke('agent-project-memory-list', options || {}),
    saveProjectMemory: (entry) => timedInvoke('agent-project-memory-save', entry || {}),
    updateProjectMemory: (payload) => timedInvoke('agent-project-memory-update', payload || {}),
    regenerateMcpToken: () => timedInvoke('agent-mcp-regenerate-token'),
    mcpStatus: () => timedInvoke('agent-mcp-status'),
    mcpProbe: () => timedInvoke('agent-mcp-probe', 10000),
    mcpWorkbenchE2e: (options) => timedInvoke('agent-mcp-workbench-e2e', options || {}, 240000),
    mcpToolCatalog: () => timedInvoke('agent-mcp-tool-catalog'),
    loadPolicy: () => timedInvoke('agent-policy-load'),
    savePolicy: (patch) => timedInvoke('agent-policy-save', patch || {}),
    onEvent: (handler) => {
      if (typeof handler !== 'function') return;
      ipcRenderer.on('agent-session:event', (_evt, payload) => {
        try {
          handler(payload);
        } catch {
          /* ignore */
        }
      });
    },
  },
});
