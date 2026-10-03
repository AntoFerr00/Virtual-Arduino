const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  compileAndRun: (code) => ipcRenderer.invoke('compile-and-run', code),
  stopRun: () => ipcRenderer.invoke('stop-run'),
  sendInput: (msg) => ipcRenderer.send('send-input', msg),
  // Both return an unsubscribe function
  onConsoleOutput: (callback) => subscribe('console-output', callback),
  onIpcMessage: (callback) => subscribe('ipc-message', callback)
});
