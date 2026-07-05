const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  compileAndRun: (code) => ipcRenderer.invoke('compile-and-run', code),
  stopRun: () => ipcRenderer.invoke('stop-run'),
  sendInput: (msg) => ipcRenderer.send('send-input', msg),
  onConsoleOutput: (callback) => ipcRenderer.on('console-output', (_event, value) => callback(value)),
  onIpcMessage: (callback) => ipcRenderer.on('ipc-message', (_event, value) => callback(value))
});
