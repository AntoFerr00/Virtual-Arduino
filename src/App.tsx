import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import Board3D from './Board3D';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const DEFAULT_CODE = `void setup() {
  Serial.begin(115200);
  Serial.println("Circuit Simulator Online!");
  
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(5, OUTPUT); // External LED on Pin 5
  pinMode(4, INPUT);  // Pushbutton on Pin 4
}

void loop() {
  // If button on pin 4 is pressed, turn on external LED and built-in LED
  int btnState = digitalRead(4);
  
  if (btnState == HIGH) {
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
  state: number; // For LED/Buzzer: 0 or 1. For Button/Switch: 0 or 1. For Pot/Servo: 0-255.
  value?: string;
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

  const resolveNet = (startCompId: string, startPinId: string, currentWires: Wire[], currentComps: ExternalComponent[]) => {
    const visited = new Set<string>();
    const stack = [{ compId: startCompId, pinId: startPinId }];
    const result: { compId: string, pinId: string }[] = [];

    while (stack.length > 0) {
      const node = stack.pop()!;
      const key = `${node.compId}:${node.pinId}`;
      if (visited.has(key)) continue;
      visited.add(key);
      result.push(node);

      // Follow wires
      for (const w of currentWires) {
        if (w.startCompId === node.compId && w.startPinId === node.pinId) {
          stack.push({ compId: w.endCompId, pinId: w.endPinId });
        }
        if (w.endCompId === node.compId && w.endPinId === node.pinId) {
          stack.push({ compId: w.startCompId, pinId: w.startPinId });
        }
      }

      // Follow internal breadboard connections
      if (node.compId !== 'BOARD') {
        const comp = currentComps.find(c => c.id === node.compId);
        if (comp && comp.type === 'Breadboard') {
          const parts = node.pinId.split('_');
          let connectedPins: string[] = [];
          if (parts[0] === 'L' && parts[1] === 'neg') {
            for(let i=0; i<25; i++) connectedPins.push(`L_neg_${i}`);
          } else if (parts[0] === 'L' && parts[1] === 'pos') {
            for(let i=0; i<25; i++) connectedPins.push(`L_pos_${i}`);
          } else if (parts[0] === 'R' && parts[1] === 'pos') {
            for(let i=0; i<25; i++) connectedPins.push(`R_pos_${i}`);
          } else if (parts[0] === 'R' && parts[1] === 'neg') {
            for(let i=0; i<25; i++) connectedPins.push(`R_neg_${i}`);
          } else if (parts[0] === 'rowL') {
            const r = parts[1];
            for(let c=0; c<5; c++) connectedPins.push(`rowL_${r}_${c}`);
          } else if (parts[0] === 'rowR') {
            const r = parts[1];
            for(let c=0; c<5; c++) connectedPins.push(`rowR_${r}_${c}`);
          }
          for (const p of connectedPins) {
            stack.push({ compId: node.compId, pinId: p });
          }
        }
      }
    }
    return result;
  };

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onConsoleOutput((newOutput: string) => {
        setOutput(prev => prev + newOutput);
      });

      window.electronAPI.onIpcMessage((msg: any) => {
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
          else {
            const net = resolveNet('BOARD', msg.pin.toString(), wiresRef.current, componentsRef.current);
            const affectedCompIds = new Set(net.filter(n => n.compId !== 'BOARD').map(n => n.compId));
            
            if (affectedCompIds.size > 0) {
              setComponents(prev => prev.map(c => 
                affectedCompIds.has(c.id) ? { ...c, state: ['Servo', 'Motor', 'OLED', 'Breadboard'].includes(c.type) ? msg.value : (msg.value > 0 ? 1 : 0) } : c
              ));
            }
          }
        }
        else if (msg.action === 'matrix') {
          setMatrixFrame(msg.frame);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [output]);

  const handleRun = async () => {
    if (isRunning) return;
    setOutput('');
    setIsRunning(true);
    if (window.electronAPI) {
      const res = await window.electronAPI.compileAndRun(code);
      if (!res.success) {
        setIsRunning(false);
      }
    }
  };

  const handleStop = async () => {
    if (!isRunning) return;
    if (window.electronAPI) {
      await window.electronAPI.stopRun();
    }
    setIsRunning(false);
    setLedState(0);
    setMatrixFrame(Array(8).fill(Array(13).fill(0)));
    setRgb1([0,0,0]); setRgb2([0,0,0]); setRgb3([0,0,0]); setRgb4([0,0,0]);
    setComponents(prev => prev.map(c => ({...c, state: 0})));
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
    let defaultValue = '';
    if (type === 'Resistor') defaultValue = '10kΩ';
    else if (type === 'Capacitor') defaultValue = '100nF';
    else if (type === 'Inductor') defaultValue = '10µH';

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

  const onComponentInteract = (id: string, val: number) => {
    const comp = components.find(c => c.id === id);
    if (comp && ['Button', 'Switch', 'Potentiometer'].includes(comp.type)) {
      setComponents(prev => prev.map(c => c.id === id ? { ...c, state: val } : c));
      
      const pinsToCheck = comp.type === 'Button' ? ['1', '2'] : ['1', '2', '3'];
      const hitBoardPins = new Set<string>();
      
      for (const p of pinsToCheck) {
         const net = resolveNet(id, p, wiresRef.current, componentsRef.current);
         net.filter(n => n.compId === 'BOARD').forEach(n => hitBoardPins.add(n.pinId));
      }

      if (window.electronAPI) {
        hitBoardPins.forEach(pinStr => {
          const pinInt = parseInt(pinStr, 10);
          window.electronAPI.sendInput({ pin: isNaN(pinInt) ? pinStr : pinInt, val });
        });
      }
    }
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
            const isPassive = ['Resistor', 'Capacitor', 'Inductor'].includes(comp.type);
            return (
              <div style={{
                position: 'absolute', top: 10, right: 10, zIndex: 10, 
                background: 'rgba(20,20,20,0.9)', border: '1px solid #444', 
                borderRadius: '6px', padding: '15px', color: '#fff',
                minWidth: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(10px)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: '#60a5fa' }}>{comp.type} Properties</h3>
                  <button onClick={() => setSelectedCompId(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '16px' }}>&times;</button>
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>ID: {comp.id}</div>
                {isPassive && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px' }}>Parameter Value:</label>
                    <input 
                      type="text" 
                      value={comp.value || ''} 
                      onChange={(e) => {
                        setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, value: e.target.value } : c));
                      }}
                      style={{ 
                        background: '#111', color: '#fff', border: '1px solid #555', 
                        padding: '6px 8px', borderRadius: '4px', outline: 'none' 
                      }}
                    />
                  </div>
                )}
                <button 
                  style={{ width: '100%', padding: '10px', background: '#cc0000', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: 'auto' }}
                  onClick={() => requestRemoveComponent(selectedCompId)}
                >
                  Delete Component
                </button>
              </div>
            );
          })()}

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
