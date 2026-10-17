const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('akuMini', {
  onPlayerState: (callback) => {
    ipcRenderer.on('player-state', (_event, state) => callback(state));
  },
  sendCommand: (command) => ipcRenderer.send('player-command', command),
  close: () => ipcRenderer.send('miniplayer-close')
});
