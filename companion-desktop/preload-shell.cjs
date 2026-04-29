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
  api: (method, pathname, body) => timedInvoke('companion-api', method, pathname, body),
  traySummary: () => timedInvoke('shell-tray-summary'),
  loadSettings: () => timedInvoke('shell-settings-load'),
  saveSettings: (patch) => timedInvoke('shell-settings-save', patch),
  pickVolumeRoot: () => timedInvoke('shell-pick-volume-root'),
  applyVolumeChange: (payload) => timedInvoke('shell-apply-volume-change', payload || {}),
  restartCompanion: (opts) => timedInvoke('shell-restart-companion', opts || {}),
  openWebsite: (url) => timedInvoke('shell-open-website', url),
  openManagementBrowser: () => timedInvoke('shell-open-management'),
  openFolderPath: (absPath) => timedInvoke('shell-open-folder-path', absPath),
  minimizeWindow: () => timedInvoke('shell-window-minimize'),
  closeWindow: () => timedInvoke('shell-window-close'),
  toggleMaximize: () => timedInvoke('shell-window-toggle-maximize'),
  loadPairing: () => timedInvoke('shell-load-pairing'),
  savePairing: (payload) => timedInvoke('shell-save-pairing', payload || {}),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
  },
  platform: process.platform,
  /** 与 main.cjs `defaultShellSiteUrl` 一致，供壳首帧与「打开网站」回退 */
  defaultSiteUrl: defaultShellSiteUrl(),
});
