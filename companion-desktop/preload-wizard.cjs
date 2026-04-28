'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companionWizard', {
  openConsole: () => {
    ipcRenderer.send('wizard-open-console');
  },
  complete: () => {
    ipcRenderer.send('wizard-complete');
  },
  loadPairing: () => ipcRenderer.invoke('wizard-load-pairing'),
  savePairing: (payload) => ipcRenderer.invoke('wizard-save-pairing', payload),
});
