import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

// Dev server only: compiles and runs sketches for the web interface (npm run dev), the same
// way the Electron main process does, talking to the page over Vite's WebSocket.
function arduinoRunner(): Plugin {
  return {
    name: 'arduino-runner',
    apply: 'serve',
    configureServer(server) {
      const require = createRequire(import.meta.url)
      const { createRunner } = require(fileURLToPath(new URL('./electron/runner.js', import.meta.url)))
      const runner = createRunner({
        onConsole: (text: string) => server.ws.send('arduino:console', text),
        onIpc: (msg: unknown) => server.ws.send('arduino:ipc', msg),
      })
      server.ws.on('arduino:compile', async (data: { id: number; code: string }, client) => {
        const result = await runner.compileAndRun(data.code)
        client.send('arduino:result', { id: data.id, ...result })
      })
      server.ws.on('arduino:stop', () => {
        if (runner.stop()) server.ws.send('arduino:console', '> Process stopped by user.\n')
      })
      server.ws.on('arduino:input', (msg: unknown) => runner.sendInput(msg))
      server.httpServer?.on('close', () => runner.stop())
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), arduinoRunner()],
  base: './', // important for Electron
})
