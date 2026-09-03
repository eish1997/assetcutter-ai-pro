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
  onDownloadSaved: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_evt, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('workbench-download-saved', listener);
    return () => ipcRenderer.removeListener('workbench-download-saved', listener);
  },
  onWorkspaceDocumentEvent: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_evt, events) => {
      try {
        handler(events);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('workspace-document-event', listener);
    return () => ipcRenderer.removeListener('workspace-document-event', listener);
  },
  dispatchWorkspaceCommand: (command) => timedInvoke('workspace-dispatch', command || {}),
  hydrateWorkspaceDocument: (payload) => timedInvoke('workspace-hydrate-document', payload || {}),
  getWorkshopFileState: () => timedInvoke('workshop-file-state'),
  pickWorkshopRoot: () => timedInvoke('workshop-file-pick-root'),
  removeWorkshopRoot: (payload) => timedInvoke('workshop-file-remove-root', payload || {}),
  listWorkshopDir: (payload) => timedInvoke('workshop-file-list', payload || {}),
  getWorkshopThumb: (payload) => timedInvoke('workshop-file-thumb', payload || {}),
  putWorkshopThumb: (payload) => timedInvoke('workshop-file-put-thumb', payload || {}),
  readWorkshopFile: (payload) => timedInvoke('workshop-file-read', payload || {}),
  getWorkshopMedia: (payload) => timedInvoke('workshop-file-media', payload || {}),
  writeWorkshopResult: (payload) => timedInvoke('workshop-file-write-result', payload || {}),
  createWorkshopPackage: (payload) => timedInvoke('workshop-file-create-package', payload || {}),
  createWorkshopCheckoutFile: (payload) => timedInvoke('workshop-file-create-checkout', payload || {}),
  writeWorkshopCheckoutFile: (payload) => timedInvoke('workshop-file-write-checkout', payload || {}),
  importWorkshopFiles: (payload) => timedInvoke('workshop-file-import', payload || {}),
  mkdirWorkshopDir: (payload) => timedInvoke('workshop-file-mkdir', payload || {}),
  revealWorkshopPath: (payload) => timedInvoke('workshop-file-reveal', payload || {}),
  resolveWorkshopAbs: (payload) => timedInvoke('workshop-file-resolve-abs', payload || {}),
  renameWorkshopEntry: (payload) => timedInvoke('workshop-file-rename', payload || {}),
  moveWorkshopEntries: (payload) => timedInvoke('workshop-file-move', payload || {}),
  copyWorkshopEntries: (payload) => timedInvoke('workshop-file-copy', payload || {}),
  trashWorkshopEntries: (payload) => timedInvoke('workshop-file-trash', payload || {}),
  groupWorkshopEntries: (payload) => timedInvoke('workshop-file-group', payload || {}),
  upgradeWorkshopLoose: (payload) => timedInvoke('workshop-file-upgrade-loose', payload || {}),
  applyWorkshopCheckout: (payload) => timedInvoke('workshop-file-apply-checkout', payload || {}),
  setWorkshopFace: (payload) => timedInvoke('workshop-file-set-face', payload || {}),
  pickWorkshopWorkspace: () => timedInvoke('workshop-file-pick-workspace'),
  setWorkshopLibraryOpen: (payload) => timedInvoke('workshop-file-set-library-open', payload || {}),
  onWorkspaceShellView: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_evt, view) => {
      try {
        handler(view);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('workspace-shell-view', listener);
    return () => ipcRenderer.removeListener('workspace-shell-view', listener);
  },
});
