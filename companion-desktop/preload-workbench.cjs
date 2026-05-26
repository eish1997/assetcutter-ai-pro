'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const IPC_MS = 120000;

function timedInvoke(channel, payload) {
  return Promise.race([
    ipcRenderer.invoke(channel, payload),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`IPC timeout ${IPC_MS}ms`)), IPC_MS)),
  ]);
}

contextBridge.exposeInMainWorld('assetCutterWorkbench', {
  saveBlob: (payload) => timedInvoke('workbench-save-blob-download', payload || {}),
});
