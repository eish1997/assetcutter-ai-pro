'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const IPC_MS_DEFAULT = 15000;
const IPC_MS_MAX = 600000;

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

contextBridge.exposeInMainWorld('companionToolWindow', {
  api: (method, pathname, body, opts) =>
    timedInvoke('companion-api', method, pathname, body, opts || {}, apiTimeoutMs(opts)),
  pickPath: (opts) => timedInvoke('shell-pick-path', opts || {}),
  openFolderPath: (absPath) => timedInvoke('shell-open-folder-path', absPath),
  minimize: () => timedInvoke('shell-tool-window-minimize'),
  close: () => timedInvoke('shell-tool-window-close'),
  togglePin: (pinned) => timedInvoke('shell-tool-window-toggle-pin', pinned),
  getPin: () => timedInvoke('shell-tool-window-get-pin'),
  reportRunFailure: (payload) => timedInvoke('shell-tool-report-run-failure', payload || {}, 600000),
  platform: process.platform,
});
