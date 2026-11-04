// Compiles a sketch against the mock Arduino core and runs it as a child process.
// Shared by the Electron main process and the Vite dev server (web interface).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const MOCK_CORE_DIR = path.join(__dirname, 'mock-core');

// Main boards the mock core can be compiled for (see mock-core/Arduino.h).
const BOARDS = {
  unoq: { name: 'Arduino UNO Q', flags: [] },
  nanoesp32: { name: 'Arduino Nano ESP32', flags: ['-DBOARD_NANO_ESP32'] },
  xiaoc3: { name: 'Seeed Studio XIAO ESP32C3', flags: ['-DBOARD_XIAO_ESP32C3'] },
};

// Each app / dev server builds in its own folder. Two of them started from the same checkout
// (`npm run dev` twice, or the desktop app next to it) would otherwise share one main.exe, and
// Windows cannot overwrite an exe while it runs: the link fails with "Permission denied".
const BUILD_ROOT = path.join(os.tmpdir(), 'virtual-arduino');
const BUILD_DIR = path.join(BUILD_ROOT, String(process.pid));

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Folders left by apps / servers that have exited (their sketches exit with them).
function pruneOldBuilds() {
  if (!fs.existsSync(BUILD_ROOT)) return;
  for (const name of fs.readdirSync(BUILD_ROOT)) {
    const pid = Number(name);
    if (!pid || pid === process.pid || isAlive(pid)) continue;
    try { fs.rmSync(path.join(BUILD_ROOT, name), { recursive: true, force: true }); } catch (e) {}
  }
}

// onConsole(text): build log / Serial output; onIpc(msg): IPC_MSG events from the sketch.
function createRunner({ onConsole, onIpc }) {
  let runnerProcess = null;
  pruneOldBuilds();

  function stop() {
    if (!runnerProcess) return false;
    runnerProcess.kill();
    runnerProcess = null;
    return true;
  }

  // board: 'unoq' (default), 'nanoesp32' or 'xiaoc3'; selects the pin map and APIs of the mock core.
  function compileAndRun(code, board = 'unoq') {
    stop();
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    const target = BOARDS[board] ?? BOARDS.unoq;

    const sourceFile = path.join(BUILD_DIR, 'main.cpp');
    const exeFile = path.join(BUILD_DIR, process.platform === 'win32' ? 'main.exe' : 'main');

    // We write the code appending the Arduino mock header include if not present
    let finalCode = code;
    if (!finalCode.includes('#include "Arduino.h"')) {
      finalCode = '#include "Arduino.h"\n' + finalCode;
    }
    fs.writeFileSync(sourceFile, finalCode, 'utf8');

    return new Promise((resolve) => {
      onConsole(`> Compiling for ${target.name}...\n`);

      const compiler = spawn('g++', [
        sourceFile,
        path.join(MOCK_CORE_DIR, 'Arduino.cpp'),
        path.join(MOCK_CORE_DIR, 'Wire.cpp'),
        '-I', MOCK_CORE_DIR,
        '-o', exeFile,
        '-std=c++17',
        ...target.flags,
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

        // ARDUINO_VIRTUAL_NVS: the Preferences store, one file per board for this app session.
        const proc = spawn(exeFile, [], {
          env: { ...process.env, ARDUINO_VIRTUAL_IPC: '1', ARDUINO_VIRTUAL_NVS: path.join(BUILD_DIR, `nvs-${board}.txt`) }
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
