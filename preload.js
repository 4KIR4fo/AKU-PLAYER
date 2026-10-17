const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aku', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  onScanProgress: (callback) => {
    ipcRenderer.on('scan-progress', (_event, progress) => callback(progress));
  },
  openMiniplayer: () => ipcRenderer.invoke('miniplayer-open'),
  closeMiniplayer: () => ipcRenderer.send('miniplayer-close'),
  setMiniPlayerWindow: (config) => ipcRenderer.send('miniplayer-config', config),
  sendPlayerState: (state) => ipcRenderer.send('player-state', state),
  onPlayerCommand: (callback) => {
    ipcRenderer.on('player-command', (_event, command) => callback(command));
  },
  onMiniplayerChanged: (callback) => {
    ipcRenderer.on('miniplayer-open-changed', (_event, open) => callback(open));
  },
  categorize: (items) => ipcRenderer.invoke('categorize', items),
  cancelCategorize: () => ipcRenderer.send('categorize-cancel'),
  onCategorizeProgress: (callback) => {
    ipcRenderer.on('categorize-progress', (_event, progress) => callback(progress));
  }
});
