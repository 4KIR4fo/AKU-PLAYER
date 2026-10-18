const { contextBridge, ipcRenderer } = require('electron');

// The renderer runs sandboxed with no Node access; this is the only surface it
// gets. Keep it to plain data and callbacks so nothing leaks over the bridge.
contextBridge.exposeInMainWorld('aku', {
  addFolder: () => ipcRenderer.invoke('add-folder'),
  addFiles: () => ipcRenderer.invoke('add-files'),
  removeSource: (sourcePath) => ipcRenderer.invoke('remove-source', sourcePath),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  setDedupe: (on) => ipcRenderer.invoke('set-dedupe', on),
  hideTracks: (ids) => ipcRenderer.invoke('hide-tracks', ids),
  restoreTracks: (paths) => ipcRenderer.invoke('restore-tracks', paths),
  restoreAllHidden: () => ipcRenderer.invoke('restore-all-hidden'),
  restoreDuplicates: (ids) => ipcRenderer.invoke('restore-duplicates', ids),
  ignoreDuplicates: (ids) => ipcRenderer.invoke('ignore-duplicates', ids),
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
