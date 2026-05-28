'use strict';

const { app, contextBridge, ipcRenderer, clipboard } = require('electron');

const DEFAULT_SHELL_SITE_DEV = 'http://localhost:3000';
const DEFAULT_SHELL_SITE_PACKAGED = 'https://assetcutter-ai-pro.vercel.app/';

function defaultShellSiteUrl() {
  try {
    return app.isPackaged ? DEFAULT_SHELL_SITE_PACKAGED : DEFAULT_SHELL_SITE_DEV;
  } catch {
    return DEFAULT_SHELL_SITE_DEV;
  }
}

const IPC_MS = 15000;

function timedInvoke(channel, ...args) {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise((_, rej) => setTimeout(() => rej(new Error('IPC 超时（' + IPC_MS + 'ms）')), IPC_MS)),
  ]);
}

contextBridge.exposeInMainWorld('companionShell', {
  api: (method, pathname, body, opts) => timedInvoke('companion-api', method, pathname, body, opts || {}),
  fetchHostBundleCatalog: () => timedInvoke('shell-fetch-host-bundle-catalog'),
  samLocalDesktopState: () => timedInvoke('shell-sam-local-desktop-state'),
  samLocalBootstrapRun: () => timedInvoke('shell-sam-local-bootstrap-run'),
  rembgDesktopState: () => timedInvoke('shell-rembg-desktop-state'),
  rembgBootstrapRun: () => timedInvoke('shell-rembg-bootstrap-run'),
  traySummary: () => timedInvoke('shell-tray-summary'),
  installShellUpdate: () => timedInvoke('shell-install-shell-update'),
  loadSettings: () => timedInvoke('shell-settings-load'),
  saveSettings: (patch) => timedInvoke('shell-settings-save', patch),
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
  setShellView: (view) => timedInvoke('shell-set-view', view),
  popupSidebarContextMenu: () => timedInvoke('shell-sidebar-context-menu-popup'),
  workbenchReload: () => timedInvoke('shell-workbench-reload'),
  workbenchReloadHard: () => timedInvoke('shell-workbench-reload-hard'),
  workbenchOpenExternal: () => timedInvoke('shell-workbench-open-external'),
  setWorkbenchSidebarInsetPx: (px) => timedInvoke('shell-workbench-sidebar-inset', px),
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
});
