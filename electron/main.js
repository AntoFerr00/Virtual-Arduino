const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createRunner } = require('./runner');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for compiling and running C++ code
const runner = createRunner({
  onConsole: (text) => mainWindow.webContents.send('console-output', text),
  onIpc: (msg) => mainWindow.webContents.send('ipc-message', msg),
});

ipcMain.handle('compile-and-run', (event, code) => runner.compileAndRun(code));

ipcMain.handle('stop-run', () => {
  if (runner.stop()) mainWindow.webContents.send('console-output', '> Process stopped by user.\n');
});

ipcMain.on('send-input', (event, msg) => runner.sendInput(msg));
