'use strict';

const { contextBridge, ipcRenderer, clipboard } = require('electron');

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
  openWebsite: (url) => timedInvoke('shell-open-website', url),
  openManagementBrowser: () => timedInvoke('shell-open-management'),
  openWizard: () => timedInvoke('shell-open-wizard'),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
  },
  platform: process.platform,
});
