// In the browser (npm run dev) there is no Electron bridge: provide the same `electronAPI`
// on top of the Vite dev server, whose `arduino-runner` plugin compiles and runs the sketch.
export function installWebRunner() {
  const hot = import.meta.hot;
  if (window.electronAPI || !hot) return;

  let nextId = 0;
  const pending = new Map<number, (result: { success: boolean; error?: string }) => void>();
  hot.on('arduino:result', (r: { id: number; success: boolean; error?: string }) => {
    pending.get(r.id)?.(r);
    pending.delete(r.id);
  });

  const subscribe = (event: string, callback: (value: any) => void) => {
    hot.on(event, callback);
    return () => hot.off(event, callback);
  };

  window.electronAPI = {
    compileAndRun: (code: string) => new Promise(resolve => {
      const id = ++nextId;
      pending.set(id, resolve);
      hot.send('arduino:compile', { id, code });
    }),
    stopRun: async () => hot.send('arduino:stop'),
    sendInput: (msg: unknown) => hot.send('arduino:input', msg),
    onConsoleOutput: (callback: (text: string) => void) => subscribe('arduino:console', callback),
    onIpcMessage: (callback: (msg: any) => void) => subscribe('arduino:ipc', callback),
  };
}
