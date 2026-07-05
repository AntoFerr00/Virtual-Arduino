const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let runnerProcess = null;

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

// IPC handers for compiling and running C++ code
ipcMain.handle('compile-and-run', async (event, code) => {
  if (runnerProcess) {
    runnerProcess.kill();
    runnerProcess = null;
  }

  const workspaceDir = path.join(__dirname, '..', 'workspace');
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir);
  }

  const sourceFile = path.join(workspaceDir, 'main.cpp');
  const exeFile = path.join(workspaceDir, 'main.exe');
  
  // We write the code appending the Arduino mock header include if not present
  let finalCode = code;
  if (!finalCode.includes('#include "Arduino.h"')) {
    finalCode = '#include "Arduino.h"\n' + finalCode;
  }
  
  fs.writeFileSync(sourceFile, finalCode, 'utf8');

  return new Promise((resolve) => {
    // We assume the mock Arduino core is in electron/mock-core
    const mockCoreDir = path.join(__dirname, 'mock-core');
    const mockCpp = path.join(mockCoreDir, 'Arduino.cpp');

    mainWindow.webContents.send('console-output', '> Compiling...\n');

    const compiler = spawn('g++', [
      sourceFile, 
      mockCpp, 
      '-I', mockCoreDir, 
      '-o', exeFile,
      '-std=c++17',
      '-lws2_32' // Windows sockets if needed for IPC
    ]);

    let compileError = '';

    compiler.stderr.on('data', (data) => {
      compileError += data.toString();
    });

    compiler.on('close', (code) => {
      if (code !== 0) {
        mainWindow.webContents.send('console-output', `Compilation failed:\n${compileError}`);
        resolve({ success: false, error: compileError });
        return;
      }

      mainWindow.webContents.send('console-output', '> Compilation successful. Running...\n');
      
      runnerProcess = spawn(exeFile, [], {
        env: { ...process.env, ARDUINO_VIRTUAL_IPC: '1' }
      });

      runnerProcess.stdout.on('data', (data) => {
        // The mock core might send IPC messages via stdout in a special format,
        // or we just route normal stdout to console.
        const output = data.toString();
        // Parse special IPC messages
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.startsWith('IPC_MSG:')) {
            try {
              const msg = JSON.parse(line.substring(8));
              mainWindow.webContents.send('ipc-message', msg);
            } catch(e) {}
          } else if (line) {
            mainWindow.webContents.send('console-output', line + '\n');
          }
        }
      });

      runnerProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('console-output', '[ERROR] ' + data.toString() + '\n');
      });

      runnerProcess.on('close', (code) => {
        mainWindow.webContents.send('console-output', `> Process exited with code ${code}\n`);
      });

      resolve({ success: true });
    });
  });
});

ipcMain.handle('stop-run', () => {
  if (runnerProcess) {
    runnerProcess.kill();
    runnerProcess = null;
    mainWindow.webContents.send('console-output', '> Process stopped by user.\n');
  }
});

ipcMain.on('send-input', (event, msg) => {
  if (runnerProcess && runnerProcess.stdin) {
    runnerProcess.stdin.write(JSON.stringify(msg) + '\n');
  }
});
