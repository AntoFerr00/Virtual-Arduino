import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import Board3D from './Board3D';
import { PINS } from './UnoQBoard';
import { CircuitSimulator, SimOutput, PinDrive, SimWarning, displayNames } from './circuit/simulator';
import { PIN_MODE, gpioName } from './circuit/board';
import { DEFAULT_VALUES } from './circuit/components';
import { PropertiesPanel, WarningsPanel, visualSignature, useBuzzerSound } from './CircuitPanels';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const DEFAULT_CODE = `void setup() {
  Serial.begin(115200);
  Serial.println("Circuit Simulator Online!");
  
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(5, OUTPUT);       // D5 -> 220 ohm resistor -> LED -> GND
  pinMode(4, INPUT_PULLUP); // D4 -> pushbutton -> GND (internal pull-up)
}

void loop() {
  // With the pull-up, the pin reads LOW while the button is pressed
  int btnState = digitalRead(4);

  if (btnState == LOW) {
    digitalWrite(LED_BUILTIN, HIGH);
    digitalWrite(5, HIGH);
  } else {
    digitalWrite(LED_BUILTIN, LOW);
    digitalWrite(5, LOW);
  }
  
  delay(10);
}
`;

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
}

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
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

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onConsoleOutput((newOutput: string) => {
        setOutput(prev => prev + newOutput);
      });

      window.electronAPI.onIpcMessage((msg: any) => {
        if (msg.action === 'pinMode' && msg.pin <= 21) {
          const prev = pinDrivesRef.current.get(msg.pin);
          pinDrivesRef.current.set(msg.pin, { mode: msg.mode, duty: prev?.duty ?? 0 });
        }
        if ((msg.action === 'digitalWrite' || msg.action === 'analogWrite') && msg.pin <= 21) {
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
    }
  }, []);

  // Circuit simulation loop: solves the circuit ~50 times a second, burns overloaded parts,
  // and feeds the resulting input-pin levels back to the running sketch.
  useEffect(() => {
    const simulator = new CircuitSimulator();
    const labels = new Map(PINS.map(p => [p.id, p.label]));
    const pinLabel = (id: string) => labels.get(id) ?? '';
    let last = performance.now();
    let lastPublish = 0;
    let lastSignature = '';
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const out = simulator.step({
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
      const res = await window.electronAPI.compileAndRun(code);
      if (!res.success) {
        runningRef.current = false;
        setIsRunning(false);
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
    const config = { components, wires };
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
              setComponents(config.components);
              setWires(config.wires);
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

  const onWireAdded = (startCompId: string, startPinId: string, endCompId: string, endPinId: string) => {
    setWires(prev => [...prev.filter(w => !(
      (w.startCompId === startCompId && w.startPinId === startPinId && w.endCompId === endCompId && w.endPinId === endPinId) ||
      (w.startCompId === endCompId && w.startPinId === endPinId && w.endCompId === startCompId && w.endPinId === startPinId)
    )), {
      id: 'w_' + Date.now(),
      startCompId, startPinId, endCompId, endPinId
    }]);
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
  };

  const warnings: SimWarning[] = [
    ...(sim?.warnings ?? []),
    ...writeWithoutOutput.map(pin => ({
      key: `nowrite:${pin}`, level: 'warn' as const,
      text: `digitalWrite(${pin}, …) has no effect: ${gpioName(pin)} is not set as an output. Add pinMode(${pin}, OUTPUT) in setup().`,
    })),
  ];

  return (
    <div className="app-container">
      <div className="toolbar">
        <div className="brand">Virtual Arduino Simulator</div>
        <div style={{ display: 'flex', gap: '10px', marginRight: 'auto', marginLeft: '20px' }}>
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
            Left Click a Pin, then click a Component to wire them up!<br/>
            Left Click a Component to select it and edit parameters.<br/>
            Right Click a Component to delete it.<br/>
            Right Click a Pin to remove its wire.
          </div>
          
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
            onComponentSelect={setSelectedCompId}
            selectedCompId={selectedCompId}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
