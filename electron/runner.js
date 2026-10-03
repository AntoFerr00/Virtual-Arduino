// Compiles a sketch against the mock Arduino core and runs it as a child process.
// Shared by the Electron main process and the Vite dev server (web interface).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WORKSPACE_DIR = path.join(__dirname, '..', 'workspace');
const MOCK_CORE_DIR = path.join(__dirname, 'mock-core');

// onConsole(text): build log / Serial output; onIpc(msg): IPC_MSG events from the sketch.
function createRunner({ onConsole, onIpc }) {
  let runnerProcess = null;

  function stop() {
    if (!runnerProcess) return false;
    runnerProcess.kill();
    runnerProcess = null;
    return true;
  }

  function compileAndRun(code) {
    stop();
    if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR);

    const sourceFile = path.join(WORKSPACE_DIR, 'main.cpp');
    const exeFile = path.join(WORKSPACE_DIR, process.platform === 'win32' ? 'main.exe' : 'main');

    // We write the code appending the Arduino mock header include if not present
    let finalCode = code;
    if (!finalCode.includes('#include "Arduino.h"')) {
      finalCode = '#include "Arduino.h"\n' + finalCode;
    }
    fs.writeFileSync(sourceFile, finalCode, 'utf8');

    return new Promise((resolve) => {
      onConsole('> Compiling...\n');

      const compiler = spawn('g++', [
        sourceFile,
        path.join(MOCK_CORE_DIR, 'Arduino.cpp'),
        '-I', MOCK_CORE_DIR,
        '-o', exeFile,
        '-std=c++17',
        // Windows: static runtime, otherwise the exe loads whichever libstdc++ DLL comes first
        // in PATH (e.g. Git's or an old MinGW's) and crashes before setup() runs.
        ...(process.platform === 'win32' ? ['-static', '-lws2_32'] : ['-pthread']),
      ]);

      let compileError = '';
      compiler.stderr.on('data', (data) => {
        compileError += data.toString();
      });
      compiler.on('error', (err) => {
        const msg = `Could not start g++ (${err.message}). Install a C++ compiler (e.g. MinGW-w64) and add it to PATH.\n`;
        onConsole(msg);
        resolve({ success: false, error: msg });
      });

      compiler.on('close', (exitCode) => {
        if (exitCode !== 0) {
          onConsole(`Compilation failed:\n${compileError}`);
          resolve({ success: false, error: compileError });
          return;
        }

        onConsole('> Compilation successful. Running...\n');

        const proc = spawn(exeFile, [], {
          env: { ...process.env, ARDUINO_VIRTUAL_IPC: '1' }
        });
        runnerProcess = proc;

        let pendingLine = '';
        proc.stdout.on('data', (data) => {
          // The mock core sends IPC messages via stdout in a special format;
          // everything else is Serial output.
          // A chunk can end mid-line: keep the tail until the rest of the line arrives.
          const lines = (pendingLine + data.toString()).split('\n');
          pendingLine = lines.pop();
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('IPC_MSG:')) {
              try {
                onIpc(JSON.parse(line.substring(8)));
              } catch (e) {}
            } else if (line) {
              onConsole(line + '\n');
            }
          }
        });

        proc.stderr.on('data', (data) => {
          onConsole('[ERROR] ' + data.toString() + '\n');
        });

        proc.on('close', (exitCode) => {
          if (runnerProcess === proc) runnerProcess = null;
          onConsole(`> Process exited with code ${exitCode}\n`);
        });

        resolve({ success: true });
      });
    });
  }

  function sendInput(msg) {
    if (runnerProcess && runnerProcess.stdin.writable) {
      runnerProcess.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  return { compileAndRun, stop, sendInput };
}

module.exports = { createRunner };
