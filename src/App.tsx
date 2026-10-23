import { useState, useEffect, useRef, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import Board3D from './Board3D';
import { BOARDS, BoardId, boardOf } from './boards';
import { CircuitSimulator, SimOutput, PinDrive, SimWarning, displayNames } from './circuit/simulator';
import { PIN_MODE } from './circuit/board';
import { DEFAULT_VALUES } from './circuit/components';
import { PropertiesPanel, WarningsPanel, WirePanel, visualSignature, useBuzzerSound } from './CircuitPanels';
import { endpointKind, defaultWireColor } from './wireColors';

declare global {
  interface Window {
    electronAPI: any;
  }
}

export type CompType = 'LED' | 'Button' | 'Resistor' | 'Capacitor' | 'Inductor' | 'Diode' | 'Transistor' | 'Potentiometer' | 'Switch' | 'Buzzer' | 'Servo' | 'Motor' | 'OLED' | 'Breadboard';

export interface ExternalComponent {
  id: string;
  type: CompType;
  x: number;
  z: number;
  state: number; // User input: Button/Switch 0 or 1, Potentiometer 0-255.
  value?: string; // Resistance/capacitance/inductance, or LED colour
  damaged?: boolean; // burnt out by the circuit simulation
  damageNote?: string;
}

export interface Wire {
  id: string;
  startCompId: string;
  startPinId: string;
  endCompId: string;
  endPinId: string;
  color?: string; // insulation colour; missing in older circuit files (then picked by convention)
}

function App() {
  // Main board: what the sketch is compiled for and what the circuit is wired to.
  const [boardId, setBoardId] = useState<BoardId>('unoq');
  const board = BOARDS[boardId];
  const boardRef = useRef(board);
  useEffect(() => { boardRef.current = board; }, [board]);

  const [code, setCode] = useState(board.defaultCode);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  
  // Hardware States
  const [ledState, setLedState] = useState(0);
  const [matrixFrame, setMatrixFrame] = useState<number[][]>(Array(8).fill(Array(13).fill(0)));
  const [rgb1, setRgb1] = useState([0,0,0]);
  const [rgb2, setRgb2] = useState([0,0,0]);
  const [rgb3, setRgb3] = useState([0,0,0]);
  const [rgb4, setRgb4] = useState([0,0,0]);

  // Circuit States
  const [components, setComponents] = useState<ExternalComponent[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [compToDelete, setCompToDelete] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  
  // To keep track of states synchronously for the IPC closure without dependency hell
  const wiresRef = useRef<Wire[]>(wires);
  useEffect(() => { wiresRef.current = wires; }, [wires]);

  const componentsRef = useRef<ExternalComponent[]>(components);
  useEffect(() => { componentsRef.current = components; }, [components]);

  // Electrical simulation state (refs: read by the simulation loop and the IPC handler)
  const [sim, setSim] = useState<SimOutput | null>(null);
  const runningRef = useRef(false);
  const pinDrivesRef = useRef(new Map<number, PinDrive>());
  const lastSentRef = useRef(new Map<number, string>());
  const [writeWithoutOutput, setWriteWithoutOutput] = useState<number[]>([]);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Electron preload or, in the browser, the dev-server bridge (src/webRunner.ts).
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribeConsole = window.electronAPI.onConsoleOutput((newOutput: string) => {
      setOutput(prev => prev + newOutput);
    });

    const unsubscribeIpc = window.electronAPI.onIpcMessage((msg: any) => {
      const maxGpio = boardRef.current.electrical.maxGpio;
      if (msg.action === 'pinMode' && msg.pin <= maxGpio) {
        const prev = pinDrivesRef.current.get(msg.pin);
        pinDrivesRef.current.set(msg.pin, { mode: msg.mode, duty: prev?.duty ?? 0 });
      }
      if ((msg.action === 'digitalWrite' || msg.action === 'analogWrite') && msg.pin <= maxGpio) {
        // Header pins: hand the new level to the circuit simulation.
        const prev = pinDrivesRef.current.get(msg.pin) ?? { mode: PIN_MODE.INPUT, duty: 0 };
        if (msg.action === 'analogWrite') {
          pinDrivesRef.current.set(msg.pin, { mode: PIN_MODE.OUTPUT, duty: Math.min(1, Math.max(0, msg.value / 255)) });
        } else {
          pinDrivesRef.current.set(msg.pin, { ...prev, duty: msg.value ? 1 : 0 });
          if (prev.mode !== PIN_MODE.OUTPUT) setWriteWithoutOutput(w => (w.includes(msg.pin) ? w : [...w, msg.pin]));
        }
      }
      if (msg.action === 'digitalWrite' || msg.action === 'analogWrite') {
        const val = msg.action === 'digitalWrite' ? (msg.value ? 255 : 0) : msg.value;

        if (msg.pin === 13) setLedState(msg.value);
        else if (boardRef.current.id === 'nanoesp32') {
          // Nano ESP32 RGB LED on D14 (red), D15 (green), D16 (blue): active LOW
          const channel = msg.pin - 14;
          if (channel >= 0 && channel <= 2) setRgb1(r => r.map((c, i) => (i === channel ? 255 - val : c)));
        }
        else if (msg.pin === 141) setRgb1(r => [val, r[1], r[2]]);
        else if (msg.pin === 142) setRgb1(r => [r[0], val, r[2]]);
        else if (msg.pin === 160) setRgb1(r => [r[0], r[1], val]);
        else if (msg.pin === 139) setRgb2(r => [val, r[1], r[2]]);
        else if (msg.pin === 140) setRgb2(r => [r[0], val, r[2]]);
        else if (msg.pin === 147) setRgb2(r => [r[0], r[1], val]);
        else if (msg.pin === 210) setRgb3(r => [val, r[1], r[2]]);
        else if (msg.pin === 211) setRgb3(r => [r[0], val, r[2]]);
        else if (msg.pin === 212) setRgb3(r => [r[0], r[1], val]);
        else if (msg.pin === 213) setRgb4(r => [val, r[1], r[2]]);
        else if (msg.pin === 214) setRgb4(r => [r[0], val, r[2]]);
        else if (msg.pin === 215) setRgb4(r => [r[0], r[1], val]);
      }
      else if (msg.action === 'matrix') {
        setMatrixFrame(msg.frame);
      }
    });
    return () => {
      unsubscribeConsole?.();
      unsubscribeIpc?.();
    };
  }, []);

  // Circuit simulation loop: solves the circuit ~50 times a second, burns overloaded parts,
  // and feeds the resulting input-pin levels back to the running sketch.
  useEffect(() => {
    const simulator = new CircuitSimulator();
    const labelCache = new Map<string, Map<string, string>>();
    const pinLabel = (id: string) => {
      const b = boardRef.current;
      let labels = labelCache.get(b.id);
      if (!labels) { labels = new Map(b.pins.map(p => [p.id, p.label])); labelCache.set(b.id, labels); }
      return labels.get(id) ?? '';
    };
    let last = performance.now();
    let lastPublish = 0;
    let lastSignature = '';
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const out = simulator.step({
        board: boardRef.current.electrical,
        components: componentsRef.current,
        wires: wiresRef.current,
        pinLabel,
        pins: pinDrivesRef.current,
        running: runningRef.current,
      }, elapsed);

      if (out.burnt.length) {
        setComponents(prev => prev.map(c => {
          const b = out.burnt.find(x => x.id === c.id);
          return b ? { ...c, damaged: true, damageNote: b.reason } : c;
        }));
      }

      if (runningRef.current && window.electronAPI) {
        const sent = lastSentRef.current;
        for (const [pinStr, r] of Object.entries(out.pins)) {
          const pin = Number(pinStr);
          if ((pinDrivesRef.current.get(pin)?.mode ?? PIN_MODE.INPUT) === PIN_MODE.OUTPUT) continue;
          const state = `${r.digital}:${r.analog}`;
          if (sent.get(pin) !== state) {
            sent.set(pin, state);
            window.electronAPI.sendInput({ pin, val: r.digital, analog: r.analog });
          }
        }
        for (const pin of [...sent.keys()]) {
          if (!(pin in out.pins)) { // no longer wired
            sent.delete(pin);
            window.electronAPI.sendInput({ pin, val: 0, analog: 0 });
          }
        }
      }

      const signature = visualSignature(out);
      if (signature !== lastSignature || now - lastPublish > 250) {
        lastSignature = signature;
        lastPublish = now;
        setSim(out);
      }
    }, 20);
    return () => clearInterval(timer);
  }, []);

  useBuzzerSound(sim, components);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [output]);

  const resetPins = () => {
    pinDrivesRef.current = new Map();
    lastSentRef.current = new Map();
    setWriteWithoutOutput([]);
  };

  const handleRun = async () => {
    if (isRunning) return;
    setOutput('');
    resetPins();
    runningRef.current = true;
    setIsRunning(true);
    if (window.electronAPI) {
      const res = await window.electronAPI.compileAndRun(code, boardId);
      if (!res.success) {
        runningRef.current = false;
        setIsRunning(false);
      } else {
        // Inputs sent while g++ was compiling were dropped (no process yet): forget them so the
        // next simulation tick re-sends every input pin, including ones that never change.
        lastSentRef.current = new Map();
      }
    }
  };

  const handleStop = async () => {
    if (!isRunning) return;
    if (window.electronAPI) {
      await window.electronAPI.stopRun();
    }
    runningRef.current = false;
    resetPins();
    setIsRunning(false);
    setLedState(0);
    setMatrixFrame(Array(8).fill(Array(13).fill(0)));
    setRgb1([0,0,0]); setRgb2([0,0,0]); setRgb3([0,0,0]); setRgb4([0,0,0]);
  };

  const handleSaveFile = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sketch.ino';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUploadFile = (e: any) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCode(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleSaveCircuit = () => {
    const config = { board: boardId, components, wires };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadCircuit = (e: any) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          try {
            const config = JSON.parse(event.target.result as string);
            if (config.components && config.wires) {
              const next = boardOf(config.board);
              if (next.id !== boardId) {
                if (isRunning) handleStop();
                if (code === board.defaultCode) setCode(next.defaultCode);
                setBoardId(next.id);
              }
              setComponents(config.components);
              setWires(config.wires);
              setSelectedWireId(null);
            } else {
              alert('Invalid circuit file format.');
            }
          } catch (err) {
            alert('Failed to parse circuit file.');
          }
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const addComponent = (type: CompType) => {
    const defaultValue = DEFAULT_VALUES[type] ?? '';

    const newComp: ExternalComponent = {
      id: type + '_' + Date.now(),
      type,
      x: 5 + Math.random() * 2,
      z: -2 + Math.random() * 4,
      state: 0,
      value: defaultValue
    };
    setComponents(prev => [...prev, newComp]);
  };

  const kindOf = (compId: string, pinId: string) => endpointKind(compId, pinId, id => board.electrical.pinRole(id, board.pins.find(p => p.id === id)?.label));

  // Wires from older circuit files have no colour: pick one by convention, in a stable order.
  const autoWireColors = useMemo(() => {
    const colors = new Map<string, string>();
    let signals = 0;
    for (const w of wires) {
      const a = kindOf(w.startCompId, w.startPinId), b = kindOf(w.endCompId, w.endPinId);
      const color = defaultWireColor(a, b, signals);
      if (a === 'signal' && b === 'signal') signals++;
      colors.set(w.id, color);
    }
    return colors;
  }, [wires, board]);
  const wireColor = (w: Wire) => w.color ?? autoWireColors.get(w.id) ?? '#facc15';

  const onWireAdded = (startCompId: string, startPinId: string, endCompId: string, endPinId: string) => {
    setWires(prev => {
      const rest = prev.filter(w => !(
        (w.startCompId === startCompId && w.startPinId === startPinId && w.endCompId === endCompId && w.endPinId === endPinId) ||
        (w.startCompId === endCompId && w.startPinId === endPinId && w.endCompId === startCompId && w.endPinId === startPinId)
      ));
      const signalWires = rest.filter(w => kindOf(w.startCompId, w.startPinId) === 'signal' && kindOf(w.endCompId, w.endPinId) === 'signal').length;
      return [...rest, {
        id: 'w_' + Date.now(),
        startCompId, startPinId, endCompId, endPinId,
        color: defaultWireColor(kindOf(startCompId, startPinId), kindOf(endCompId, endPinId), signalWires),
      }];
    });
  };

  // Switching board keeps the parts and the wires whose header pin also exists on the new board.
  const changeBoard = (id: BoardId) => {
    if (id === boardId) return;
    if (isRunning) handleStop();
    const next = BOARDS[id];
    const valid = new Set(next.pins.map(p => p.id));
    const orphan = (w: Wire) => (w.startCompId === 'BOARD' && !valid.has(w.startPinId)) || (w.endCompId === 'BOARD' && !valid.has(w.endPinId));
    const dropped = wires.filter(orphan).length;
    setWires(prev => prev.filter(w => !orphan(w)));
    setSelectedWireId(null);
    if (code === board.defaultCode) setCode(next.defaultCode);
    setBoardId(id);
    setOutput(`> Board: ${next.name}${dropped ? ` (${dropped} wire${dropped > 1 ? 's' : ''} to pins it does not have were removed)` : ''}\n`);
  };

  // Buttons, switches and potentiometers only change their own state: what the sketch reads
  // follows from the circuit simulation.
  const onComponentInteract = (id: string, val: number) => {
    setComponents(prev => prev.map(c => c.id === id && ['Button', 'Switch', 'Potentiometer'].includes(c.type) ? { ...c, state: val } : c));
  };

  const onComponentMove = (id: string, x: number, z: number) => {
    setComponents(prev => prev.map(c => c.id === id ? { ...c, x, z } : c));
  };

  const requestRemoveComponent = (id: string) => {
    setCompToDelete(id);
  };

  const confirmRemoveComponent = () => {
    if (compToDelete) {
      setComponents(prev => prev.filter(c => c.id !== compToDelete));
      setWires(prev => prev.filter(w => w.startCompId !== compToDelete && w.endCompId !== compToDelete));
      if (selectedCompId === compToDelete) setSelectedCompId(null);
      setCompToDelete(null);
    }
  };

  const removeWire = (compId: string, pinId: string) => {
    setWires(prev => prev.filter(w => !(
      (w.startCompId === compId && w.startPinId === pinId) ||
      (w.endCompId === compId && w.endPinId === pinId)
    )));
  };

  const removeWireById = (wireId: string) => {
    setWires(prev => prev.filter(w => w.id !== wireId));
    if (selectedWireId === wireId) setSelectedWireId(null);
  };

  const describeEndpoint = (compId: string, pinId: string) => {
    if (compId === 'BOARD') return `${board.name.replace('Arduino ', '')} ${board.pins.find(p => p.id === pinId)?.label ?? pinId}`;
    const name = displayNames(components)[compId] ?? compId;
    return `${name} (${pinId})`;
  };

  const warnings: SimWarning[] = [
    ...(sim?.warnings ?? []),
    ...writeWithoutOutput.map(pin => ({
      key: `nowrite:${pin}`, level: 'warn' as const,
      text: `digitalWrite(${pin}, …) has no effect: ${board.electrical.gpioName(pin)} is not set as an output. Add pinMode(${pin}, OUTPUT) in setup().`,
    })),
  ];

  return (
    <div className="app-container">
      <div className="toolbar">
        <div className="brand">Virtual Arduino Simulator</div>
        <div style={{ display: 'flex', gap: '10px', marginRight: 'auto', marginLeft: '20px' }}>
          <select
            title="Main board: the sketch is compiled for it and the circuit is wired to it"
            value={boardId}
            onChange={(e) => changeBoard(e.target.value as BoardId)}
            style={{ padding: '8px', borderRadius: '4px', background: '#0b3d40', color: '#fff', border: '1px solid #00979d', fontWeight: 600 }}
          >
            {Object.values(BOARDS).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select 
            style={{ padding: '8px', borderRadius: '4px', background: '#333', color: '#fff', border: '1px solid #555' }}
            onChange={(e) => { 
              if(e.target.value) { 
                addComponent(e.target.value as CompType); 
                e.target.value = ''; 
              } 
            }}
          >
            <option value="">+ Add Component...</option>
            <optgroup label="Board Tools">
              <option value="Breadboard">Breadboard (Half)</option>
            </optgroup>
            <optgroup label="Outputs">
              <option value="LED">LED</option>
              <option value="Buzzer">Buzzer</option>
              <option value="Servo">Servo Motor</option>
              <option value="Motor">DC Motor</option>
              <option value="OLED">OLED Display</option>
            </optgroup>
            <optgroup label="Inputs">
              <option value="Button">Pushbutton</option>
              <option value="Switch">Slide Switch</option>
              <option value="Potentiometer">Potentiometer</option>
            </optgroup>
            <optgroup label="Passives">
              <option value="Resistor">Resistor</option>
              <option value="Capacitor">Capacitor</option>
              <option value="Inductor">Inductor</option>
              <option value="Diode">Diode</option>
              <option value="Transistor">Transistor</option>
            </optgroup>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn" onClick={handleSaveFile}>Save Code</button>
          <label className="btn" style={{ margin: 0, cursor: 'pointer' }}>
            Upload Code
            <input type="file" accept=".ino,.txt" style={{ display: 'none' }} onChange={handleUploadFile} />
          </label>
          <div style={{ width: '1px', background: '#555', margin: '0 5px' }}></div>
          <button className="btn" style={{ background: '#4b5563' }} onClick={handleSaveCircuit}>Save Circuit</button>
          <label className="btn" style={{ background: '#4b5563', margin: 0, cursor: 'pointer' }}>
            Load Circuit
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoadCircuit} />
          </label>
        </div>
        {!isRunning ? (
          <button className="btn" onClick={handleRun}>Run</button>
        ) : (
          <button className="btn btn-danger" onClick={handleStop}>Stop</button>
        )}
      </div>
      <div className="main-content">
        <div className="editor-pane">
          <div className="editor-container">
            <Editor
              height="100%"
              defaultLanguage="cpp"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              options={{ minimap: { enabled: false }, fontSize: 14, fontFamily: "'Fira Code', monospace" }}
            />
          </div>
          <div className="console-pane">
            <div className="console-header">Serial Monitor & Build Log</div>
            <div className="console-output">
              {output}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </div>
        <div className="canvas-pane">
          <div className={`status-badge ${isRunning ? 'running' : ''}`}>
            {isRunning ? 'Running' : 'Idle'}
          </div>
          <div style={{position: 'absolute', top: 10, left: 10, color: '#aaa', fontSize: 12, zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '5px', borderRadius: '4px'}}>
            Drag components to move them.<br/>
            Click a pin, then another pin, to connect them with a wire.<br/>
            Click a wire to change its colour or delete it (right click deletes it).<br/>
            Click a component to edit it, right click to delete it.<br/>
            Right click a pin to remove its wires.
          </div>
          
          {selectedWireId && !selectedCompId && (() => {
            const w = wires.find(x => x.id === selectedWireId);
            if (!w) return null;
            return (
              <WirePanel
                from={describeEndpoint(w.startCompId, w.startPinId)}
                to={describeEndpoint(w.endCompId, w.endPinId)}
                color={wireColor(w)}
                onColor={color => setWires(prev => prev.map(x => x.id === w.id ? { ...x, color } : x))}
                onDelete={() => removeWireById(w.id)}
                onClose={() => setSelectedWireId(null)}
              />
            );
          })()}

          {selectedCompId && (() => {
            const comp = components.find(c => c.id === selectedCompId);
            if (!comp) return null;
            return (
              <PropertiesPanel
                comp={comp}
                name={displayNames(components)[comp.id]}
                result={sim?.comps[comp.id]}
                onValue={value => setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, value } : c))}
                onReplace={() => setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, damaged: false, damageNote: undefined } : c))}
                onDelete={() => requestRemoveComponent(comp.id)}
                onClose={() => setSelectedCompId(null)}
              />
            );
          })()}

          <WarningsPanel warnings={warnings} onSelect={setSelectedCompId} />

          {compToDelete && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000
            }}>
              <div style={{
                background: '#222', padding: '24px', borderRadius: '8px', 
                color: 'white', border: '1px solid #444',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                maxWidth: '400px', width: '100%',
                textAlign: 'center'
              }}>
                <h2 style={{ margin: '0 0 16px 0' }}>Delete Component?</h2>
                <p style={{ margin: '0 0 24px 0', color: '#ccc' }}>Are you sure you want to remove this component? Any connected wires will also be removed.</p>
                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                  <button 
                    style={{ padding: '8px 24px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flex: 1 }}
                    onClick={() => setCompToDelete(null)}
                  >
                    Cancel
                  </button>
                  <button 
                    style={{ padding: '8px 24px', background: '#cc0000', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flex: 1 }}
                    onClick={confirmRemoveComponent}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          <Board3D 
            board={board}
            sim={sim}
            ledState={ledState} 
            matrixFrame={matrixFrame} 
            rgb1={rgb1} rgb2={rgb2} rgb3={rgb3} rgb4={rgb4}
            components={components}
            wires={wires}
            onWireAdded={onWireAdded}
            onComponentInteract={onComponentInteract}
            onComponentMove={onComponentMove}
            onComponentRemove={requestRemoveComponent}
            onWireRemove={removeWire}
            onWireRemoveById={removeWireById}
            selectedWireId={selectedWireId}
            onWireSelect={id => { setSelectedWireId(id); if (id) setSelectedCompId(null); }}
            wireColor={wireColor}
            onComponentSelect={id => { setSelectedCompId(id); if (id) setSelectedWireId(null); }}
            selectedCompId={selectedCompId}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
