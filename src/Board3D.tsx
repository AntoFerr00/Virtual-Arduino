import { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, QuadraticBezierLine, Text, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { ExternalComponent, Wire } from './App';
import { UnoQBoard, PINS, SILK_FONT } from './UnoQBoard';
import type { SimOutput, CompResult } from './circuit/simulator';
import { parseValue } from './circuit/units';
import { ESC, escOf, lipoOf } from './circuit/components';

interface Board3DProps {
  sim?: SimOutput | null;
  ledState: number;
  matrixFrame: number[][];
  rgb1: number[];
  rgb2: number[];
  rgb3: number[];
  rgb4: number[];
  components: ExternalComponent[];
  wires: Wire[];
  onWireAdded: (startCompId: string, startPinId: string, endCompId: string, endPinId: string) => void;
  onComponentInteract: (id: string, val: number) => void;
  onComponentMove: (id: string, x: number, z: number) => void;
  onComponentRemove: (id: string) => void;
  onWireRemove: (compId: string, pinId: string) => void;
  onWireRemoveById?: (wireId: string) => void;
  onComponentSelect?: (id: string | null) => void;
  selectedCompId?: string | null;
}

// Reusable hook for dragging components
function useCompDrag(comp: ExternalComponent, onDragStart: ()=>void, onDragEnd: ()=>void, onDrag: (x:number, z:number)=>void) {
  const { camera, raycaster, pointer } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const offsetRef = useRef<[number, number]>([0, 0]);

  return useDrag(({ active, first }) => {
    if (active) {
      raycaster.setFromCamera(pointer, camera);
      const intersect = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersect);
      
      if (first) {
        onDragStart();
        if (intersect) {
          offsetRef.current = [comp.x - intersect.x, comp.z - intersect.z];
        }
      } else if (intersect) {
        onDrag(intersect.x + offsetRef.current[0], intersect.z + offsetRef.current[1]);
      }
    } else {
      onDragEnd();
    }
  }, { triggerAllEvents: true });
}

function CompHitbox({ pos, onClick, isHole=false }: { pos: [number, number, number], onClick: () => void, isHole?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <Box args={isHole ? [0.06, 0.02, 0.06] : [0.3, 0.3, 0.3]} position={pos} 
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}>
      <meshStandardMaterial color={hover ? "#ffcc00" : (isHole ? "#222" : "#ffffff")} transparent opacity={hover ? 0.8 : (isHole ? 1.0 : 0.0)} />
    </Box>
  );
}

const BREADBOARD_PINS = (() => {
  const pins: { id: string, pos: [number, number, number] }[] = [];
  const startX = -0.85;
  const startZ = -1.45;
  for(let i=0; i<25; i++) {
    const z = startZ + i * 0.12;
    pins.push({ id: `L_neg_${i}`, pos: [startX, 0.15, z] });
    pins.push({ id: `L_pos_${i}`, pos: [startX + 0.1, 0.15, z] });
  }
  for(let r=0; r<30; r++) {
    const z = startZ + r * 0.1;
    for(let c=0; c<5; c++) pins.push({ id: `rowL_${r}_${c}`, pos: [startX + 0.3 + c*0.1, 0.15, z] });
    for(let c=0; c<5; c++) pins.push({ id: `rowR_${r}_${c}`, pos: [startX + 1.1 + c*0.1, 0.15, z] });
  }
  for(let i=0; i<25; i++) {
    const z = startZ + i * 0.12;
    pins.push({ id: `R_pos_${i}`, pos: [startX + 1.7, 0.15, z] });
    pins.push({ id: `R_neg_${i}`, pos: [startX + 1.8, 0.15, z] });
  }
  return pins;
})();

function getCompPinOffset(type: string, pinId?: string): [number, number, number] {
  if (type === 'Breadboard' && pinId) {
    const pin = BREADBOARD_PINS.find(p => p.id === pinId);
    if (pin) return pin.pos;
  }
  if (!pinId) return [0, 0.4, 0];
  switch (type) {
    case 'LED': return pinId === 'C' ? [-0.1, 0.25, 0] : [0.1, 0.25, 0];
    case 'Button': return pinId === '1' ? [-0.2, 0.1, 0] : [0.2, 0.1, 0];
    case 'Resistor': return pinId === '1' ? [-0.4, 0.1, 0] : [0.4, 0.1, 0];
    case 'Capacitor': return pinId === '-' ? [-0.1, 0.2, 0] : [0.1, 0.2, 0];
    case 'Inductor': return pinId === '1' ? [-0.4, 0.1, 0] : [0.4, 0.1, 0];
    case 'Diode': return pinId === 'A' ? [-0.4, 0.1, 0] : [0.4, 0.1, 0];
    case 'Transistor': return pinId === 'E' ? [-0.15, 0.2, 0] : pinId === 'B' ? [0, 0.2, 0] : [0.15, 0.2, 0];
    case 'Potentiometer': return pinId === '1' ? [-0.2, 0.1, 0.3] : pinId === '2' ? [0, 0.1, 0.3] : [0.2, 0.1, 0.3];
    case 'Switch': return pinId === '1' ? [-0.3, 0.1, 0.2] : pinId === '2' ? [0, 0.1, 0.2] : [0.3, 0.1, 0.2];
    case 'Buzzer': return pinId === '-' ? [-0.1, 0.2, 0] : [0.1, 0.2, 0];
    case 'Servo': return pinId === 'GND' ? [-0.3, 0.1, 0.2] : pinId === 'VCC' ? [-0.3, 0.1, 0.3] : [-0.3, 0.1, 0.4];
    case 'Motor': return pinId === '1' ? [-0.4, 0.4, 0.2] : [-0.4, 0.4, -0.2];
    case 'OLED': return pinId === 'GND' ? [-0.3, 0.2, -0.7] : pinId === 'VCC' ? [-0.1, 0.2, -0.7] : pinId === 'SCL' ? [0.1, 0.2, -0.7] : [0.3, 0.2, -0.7];
    default: return DRONE_PINS[type]?.[pinId] ?? [0, 0.4, 0];
  }
}

// Terminals of the drone parts, in the part's own frame.
const DRONE_PINS: Record<string, Record<string, [number, number, number]>> = {
  LiPo: { '+': [-1.78, 0.3, -0.15], '-': [-1.78, 0.3, 0.15] },
  ESC: { '+': [-0.88, 0.08, -0.15], '-': [-0.88, 0.08, 0.15], S: [-0.25, 0.08, 0.66], '5V': [0, 0.08, 0.66], GND: [0.25, 0.08, 0.66] },
  IMU: { VCC: [-0.4, 0.15, 0.4], GND: [-0.2, 0.15, 0.4], SCL: [0, 0.15, 0.4], SDA: [0.2, 0.15, 0.4], INT: [0.4, 0.15, 0.4] },
  ELRS: { GND: [-0.3, 0.12, 0.32], '5V': [-0.1, 0.12, 0.32], TX: [0.1, 0.12, 0.32], RX: [0.3, 0.12, 0.32] },
};

// Wisps of smoke rising from a part the simulation burnt out.
function Smoke({ y = 0.6 }: { y?: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    group.current?.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.35 + i / 3) % 1;
      m.position.set(Math.sin(t * 6 + i) * 0.06, y + t * 0.9, Math.cos(t * 5 + i) * 0.06);
      m.scale.setScalar(0.08 + t * 0.22);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.45 * (1 - t);
    });
  });
  return (
    <group ref={group} raycast={() => null}>
      {[0, 1, 2].map(i => (
        <mesh key={i} raycast={() => null}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshStandardMaterial color="#6b6b6b" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function ExtLED({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const r = sim as CompResult | undefined;
  const ledColor = useMemo(() => new THREE.Color(r?.color ?? '#ff2a1a'), [r?.color]);
  // Perceived brightness grows roughly with the square root of the current.
  const glow = comp.damaged ? 0 : Math.min(1.6, Math.sqrt(Math.max(0, r?.brightness ?? 0)));
  // One material for the epoxy body and dome.
  const lens = useMemo(() => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.92, roughness: 0.25 }), []);

  useFrame(() => {
    const off = comp.damaged ? new THREE.Color('#2a2420') : ledColor.clone().multiplyScalar(0.28);
    const on = ledColor.clone().lerp(new THREE.Color('#ffffff'), Math.min(0.15, glow * 0.08));
    lens.color.lerp(glow > 0.02 ? on : off, 0.25);
    lens.emissive.lerp(glow > 0.02 ? ledColor : new THREE.Color('#000000'), 0.25);
    lens.emissiveIntensity += (glow * 2.5 - lens.emissiveIntensity) * 0.25;
  });

  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[-0.1, 0.25, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[0.1, 0.25, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <mesh position={[0, 0.6, 0]} material={lens}><cylinderGeometry args={[0.2, 0.2, 0.3, 24]} /></mesh>
      <mesh position={[0, 0.75, 0]} material={lens}><sphereGeometry args={[0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      {glow > 0.02 && <pointLight position={[0, 0.9, 0]} color={ledColor} intensity={glow * 0.8} distance={1.5} />}
      {comp.damaged && <Smoke y={0.9} />}
      <SilkscreenText text="-" position={[-0.1, 0.05, 0.15]} size={0.15} color="#fff" />
      <SilkscreenText text="+" position={[0.1, 0.05, 0.15]} size={0.15} color="#fff" />
      <CompHitbox pos={getCompPinOffset('LED', 'C')} onClick={() => onClick('C')} />
      <CompHitbox pos={getCompPinOffset('LED', 'A')} onClick={() => onClick('A')} />
    </group>
  );
}

function ExtButton({ comp, onClick, onRightClick, onInteract, onDragStart, onDrag, onDragEnd }: any) {
  const isPressed = comp.state > 0;
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);

  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[0.6, 0.2, 0.6]} position={[0, 0.1, 0]}>
        <meshStandardMaterial color="#333" />
      </Box>
      <Cylinder args={[0.15, 0.15, 0.2]} position={[0, isPressed ? 0.15 : 0.25, 0]} raycast={() => null}>
        <meshStandardMaterial color="#ef4444" />
      </Cylinder>
      {/* Fixed, slightly larger hit area: the moving cap itself would slip out from under the
          cursor when pressed. The press lasts until the mouse button is released anywhere. */}
      <Cylinder args={[0.16, 0.16, 0.3]} position={[0, 0.25, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          onInteract(1);
          window.addEventListener('pointerup', () => onInteract(0), { once: true });
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </Cylinder>
      <CompHitbox pos={getCompPinOffset('Button', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Button', '2')} onClick={() => onClick('2')} />
    </group>
  );
}

// 4-band colour code (digit, digit, multiplier, ±5 % gold) for the resistor's value.
const BAND_COLORS = ['#111111', '#7a3b10', '#e01b1b', '#f07a10', '#f2d21b', '#1d9b3a', '#1f4fd6', '#7c3aed', '#8a8a8a', '#f5f5f5'];
function resistorBands(value?: string): string[] {
  const ohms = parseValue(value);
  if (!isFinite(ohms) || ohms <= 0) return ['#7a3b10', '#111111', '#f07a10', '#c9a227'];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / Math.pow(10, exp));
  if (digits >= 100) { digits = Math.round(digits / 10); exp += 1; }
  const mult = exp < 0 ? (exp === -1 ? '#c9a227' : '#b8b8b8') : BAND_COLORS[Math.min(9, exp)];
  return [BAND_COLORS[Math.floor(digits / 10)], BAND_COLORS[digits % 10], mult, '#c9a227'];
}

function ExtResistor({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const hot = Math.min(1, Math.max(0, ((sim as CompResult | undefined)?.stress ?? 0) - 0.5));
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 1.0]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.1, 0.1, 0.6]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color={comp.damaged ? '#2b1d14' : '#d4a373'} emissive="#ff3300" emissiveIntensity={comp.damaged ? 0 : hot * 0.8} /></Cylinder>
      {comp.damaged && <Smoke y={0.25} />}
      {resistorBands(comp.value).map((color, i) => (
        <Cylinder key={i} args={[0.105, 0.105, 0.045]} position={[[-0.2, -0.11, -0.02, 0.2][i], 0.1, 0]} rotation={[0, 0, Math.PI/2]}>
          <meshStandardMaterial color={comp.damaged ? '#1d140e' : color} />
        </Cylinder>
      ))}
      <CompHitbox pos={getCompPinOffset('Resistor', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Resistor', '2')} onClick={() => onClick('2')} />
    </group>
  );
}

function ExtCapacitor({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.1, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.1, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.2, 0.2, 0.5]} position={[0, 0.65, 0]}><meshStandardMaterial color="#1e3a8a" /></Cylinder>
      <Box args={[0.1, 0.5, 0.41]} position={[0, 0.65, 0]}><meshStandardMaterial color="#93c5fd" /></Box>
      {comp.damaged && (
        <>
          <Cylinder args={[0.14, 0.2, 0.08]} position={[0, 0.94, 0]}><meshStandardMaterial color="#3a3a3a" roughness={1} /></Cylinder>
          <Smoke y={1.0} />
        </>
      )}
      <SilkscreenText text="-" position={[-0.1, 0.65, 0.21]} size={0.15} color="#fff" />
      <SilkscreenText text="+" position={[0.1, 0.65, 0.21]} size={0.15} color="#fff" />
      <CompHitbox pos={getCompPinOffset('Capacitor', '-')} onClick={() => onClick('-')} />
      <CompHitbox pos={getCompPinOffset('Capacitor', '+')} onClick={() => onClick('+')} />
    </group>
  );
}

function ExtInductor({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 1.0]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.2, 0.2, 0.6]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#111" /></Cylinder>
      <Cylinder args={[0.21, 0.21, 0.1]} position={[-0.2, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#b45309" /></Cylinder>
      <Cylinder args={[0.21, 0.21, 0.1]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#b45309" /></Cylinder>
      <Cylinder args={[0.21, 0.21, 0.1]} position={[0.2, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#b45309" /></Cylinder>
      <CompHitbox pos={getCompPinOffset('Inductor', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Inductor', '2')} onClick={() => onClick('2')} />
    </group>
  );
}

function ExtDiode({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 1.0]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.1, 0.1, 0.5]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#111" /></Cylinder>
      <Cylinder args={[0.105, 0.105, 0.05]} position={[0.2, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#d4d4d8" /></Cylinder>
      <SilkscreenText text="A" position={[-0.15, 0.25, 0]} size={0.12} color="#fff" />
      <SilkscreenText text="K" position={[0.15, 0.25, 0]} size={0.12} color="#fff" />
      <CompHitbox pos={getCompPinOffset('Diode', 'A')} onClick={() => onClick('A')} />
      <CompHitbox pos={getCompPinOffset('Diode', 'K')} onClick={() => onClick('K')} />
      {comp.damaged && <Smoke y={0.25} />}
    </group>
  );
}

function ExtTransistor({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.15, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.15, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Box args={[0.5, 0.4, 0.2]} position={[0, 0.6, 0.05]}><meshStandardMaterial color="#222" /></Box>
      <Cylinder args={[0.25, 0.25, 0.4]} position={[0, 0.6, 0.05]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#222" /></Cylinder>
      <SilkscreenText text="E" position={[-0.15, 0.6, 0.16]} size={0.12} color="#fff" />
      <SilkscreenText text="B" position={[0, 0.6, 0.16]} size={0.12} color="#fff" />
      <SilkscreenText text="C" position={[0.15, 0.6, 0.16]} size={0.12} color="#fff" />
      {comp.damaged && <Smoke y={0.85} />}
      <CompHitbox pos={getCompPinOffset('Transistor', 'C')} onClick={() => onClick('C')} />
      <CompHitbox pos={getCompPinOffset('Transistor', 'B')} onClick={() => onClick('B')} />
      <CompHitbox pos={getCompPinOffset('Transistor', 'E')} onClick={() => onClick('E')} />
    </group>
  );
}

function ExtPotentiometer({ comp, onClick, onRightClick, onInteract, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const angle = (comp.state / 255) * 4.7 - 2.35;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[0.6, 0.4, 0.6]} position={[0, 0.2, 0]}>
        <meshStandardMaterial color="#1e40af" />
      </Box>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[-0.2, 0.1, 0.3]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[0, 0.1, 0.3]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[0.2, 0.1, 0.3]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <group position={[0, 0.45, 0]} rotation={[0, angle, 0]} onClick={(e) => { e.stopPropagation(); onInteract((comp.state + 32) % 256); }}>
        <Cylinder args={[0.2, 0.2, 0.3]} position={[0, 0, 0]}><meshStandardMaterial color="#222" /></Cylinder>
        <Box args={[0.05, 0.35, 0.2]} position={[0, 0, -0.1]}><meshStandardMaterial color="#fff" /></Box>
      </group>
      <CompHitbox pos={getCompPinOffset('Potentiometer', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Potentiometer', '2')} onClick={() => onClick('2')} />
      <CompHitbox pos={getCompPinOffset('Potentiometer', '3')} onClick={() => onClick('3')} />
      {comp.damaged && <Smoke y={0.7} />}
    </group>
  );
}

function ExtSwitch({ comp, onClick, onRightClick, onInteract, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[0.8, 0.3, 0.4]} position={[0, 0.15, 0]}>
        <meshStandardMaterial color="#444" />
      </Box>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[-0.3, 0.1, 0.2]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[0, 0.1, 0.2]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.2]} position={[0.3, 0.1, 0.2]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Box args={[0.2, 0.2, 0.2]} position={[comp.state > 0 ? 0.2 : -0.2, 0.4, 0]} onClick={(e) => { e.stopPropagation(); onInteract(comp.state > 0 ? 0 : 1); }}>
        <meshStandardMaterial color="#111" />
      </Box>
      <CompHitbox pos={getCompPinOffset('Switch', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Switch', '2')} onClick={() => onClick('2')} />
      <CompHitbox pos={getCompPinOffset('Switch', '3')} onClick={() => onClick('3')} />
    </group>
  );
}

function ExtBuzzer({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const isRing = !!(sim as CompResult | undefined)?.sounding;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.1, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.1, 0.2, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.3, 0.3, 0.4]} position={[0, 0.6, 0]}>
        <meshStandardMaterial color="#111" emissive={isRing ? "#444" : "#000"} />
      </Cylinder>
      <Cylinder args={[0.1, 0.1, 0.41]} position={[0, 0.6, 0]}><meshStandardMaterial color="#000" /></Cylinder>
      <SilkscreenText text="-" position={[-0.15, 0.81, 0]} rotation={[-Math.PI/2, 0, 0]} size={0.15} color="#fff" />
      <SilkscreenText text="+" position={[0.15, 0.81, 0]} rotation={[-Math.PI/2, 0, 0]} size={0.15} color="#fff" />
      <CompHitbox pos={getCompPinOffset('Buzzer', '-')} onClick={() => onClick('-')} />
      <CompHitbox pos={getCompPinOffset('Buzzer', '+')} onClick={() => onClick('+')} />
    </group>
  );
}

function ExtServo({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const held = useRef(0);
  const target = (sim as CompResult | undefined)?.angle;
  if (target !== undefined) held.current = target;
  const angle = (held.current / 255) * Math.PI;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[0.8, 0.6, 0.4]} position={[0, 0.3, 0]}><meshStandardMaterial color="#1e40af" /></Box>
      <Box args={[1.0, 0.1, 0.4]} position={[0, 0.5, 0]}><meshStandardMaterial color="#1e40af" /></Box>
      <group position={[0.2, 0.65, 0]} rotation={[0, angle, 0]}>
        <Cylinder args={[0.15, 0.15, 0.1]} position={[0, 0, 0]}><meshStandardMaterial color="#fff" /></Cylinder>
        <Box args={[0.1, 0.05, 0.6]} position={[0, 0.05, 0]}><meshStandardMaterial color="#fff" /></Box>
      </group>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[-0.3, 0.1, 0.2]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#ef4444" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[-0.3, 0.1, 0.3]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#8b4513" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[-0.3, 0.1, 0.4]} rotation={[Math.PI/2, 0, 0]}><meshStandardMaterial color="#f59e0b" /></Cylinder>
      <CompHitbox pos={getCompPinOffset('Servo', 'GND')} onClick={() => onClick('GND')} />
      <CompHitbox pos={getCompPinOffset('Servo', 'VCC')} onClick={() => onClick('VCC')} />
      <CompHitbox pos={getCompPinOffset('Servo', 'S')} onClick={() => onClick('S')} />
      {comp.damaged && <Smoke y={0.8} />}
    </group>
  );
}

function ExtMotor({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const ref = useRef<THREE.Group>(null);
  const speed = (sim as CompResult | undefined)?.speed ?? 0;
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.x += speed * delta * 30;
  });
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.4, 0.4, 0.8]} position={[0, 0.4, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#d4d4d8" metalness={0.8} /></Cylinder>
      <group ref={ref} position={[0.4, 0.4, 0]}>
         <Cylinder args={[0.05, 0.05, 0.4]} position={[0.2, 0, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ccc" /></Cylinder>
         <Box args={[0.05, 0.4, 0.1]} position={[0.4, 0, 0]}><meshStandardMaterial color="#111" /></Box>
      </group>
      <Cylinder args={[0.05, 0.05, 0.2]} position={[-0.4, 0.4, 0.2]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#b45309" /></Cylinder>
      <Cylinder args={[0.05, 0.05, 0.2]} position={[-0.4, 0.4, -0.2]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#b45309" /></Cylinder>
      <CompHitbox pos={getCompPinOffset('Motor', '1')} onClick={() => onClick('1')} />
      <CompHitbox pos={getCompPinOffset('Motor', '2')} onClick={() => onClick('2')} />
    </group>
  );
}

function ExtOLED({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const powered = !!(sim as CompResult | undefined)?.powered;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[1.5, 0.1, 1.5]} position={[0, 0.4, 0]}><meshStandardMaterial color="#1e3a8a" /></Box>
      <Box args={[1.2, 0.12, 0.8]} position={[0, 0.4, 0.2]}>
         <meshStandardMaterial color={powered ? "#0b1a2a" : "#000"} emissive={powered ? "#1d4ed8" : "#000"} emissiveIntensity={powered ? 0.25 : 0} />
      </Box>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.3, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.1, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.1, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.3, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <CompHitbox pos={getCompPinOffset('OLED', 'GND')} onClick={() => onClick('GND')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'VCC')} onClick={() => onClick('VCC')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'SCL')} onClick={() => onClick('SCL')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'SDA')} onClick={() => onClick('SDA')} />
      {comp.damaged && <Smoke y={0.6} />}
    </group>
  );
}

const flat: [number, number, number] = [-Math.PI / 2, 0, 0];

function ExtLiPo({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const { cells, vCell } = lipoOf(comp.value);
  const hot = Math.min(1, Math.max(0, ((sim as CompResult | undefined)?.stress ?? 0) - 0.5));
  const puff = comp.damaged ? 1.25 : 1; // a ruined LiPo swells
  const top = 0.9 * puff + 0.01;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <group scale={[1, puff, 1]}>
        <Box args={[2.4, 0.9, 1.1]} position={[0, 0.45, 0]}>
          <meshStandardMaterial color={comp.damaged ? '#1a1a1a' : '#1f2937'} emissive="#ff3300" emissiveIntensity={comp.damaged ? 0 : hot * 0.8} />
        </Box>
        <Box args={[1.5, 0.91, 1.11]} position={[0.25, 0.45, 0]}><meshStandardMaterial color={comp.damaged ? '#2a1a1a' : '#b91c1c'} /></Box>
      </group>
      <SilkscreenText text={`${cells}S LiPo 1500mAh`} position={[0.25, top, -0.2]} rotation={flat} size={0.15} />
      <SilkscreenText text={`${(cells * vCell).toFixed(2)} V  ·  ${vCell.toFixed(2)} V/cell`} position={[0.25, top, 0.18]} rotation={flat} size={0.11} />
      {/* main leads and XT60 */}
      <Cylinder args={[0.045, 0.045, 0.35]} position={[-1.37, 0.3, -0.15]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#dc2626" /></Cylinder>
      <Cylinder args={[0.045, 0.045, 0.35]} position={[-1.37, 0.3, 0.15]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#111" /></Cylinder>
      <Box args={[0.22, 0.2, 0.5]} position={[-1.62, 0.3, 0]}><meshStandardMaterial color="#facc15" /></Box>
      <SilkscreenText text="+" position={[-1.62, 0.41, -0.15]} rotation={flat} size={0.14} color="#111" />
      <SilkscreenText text="-" position={[-1.62, 0.41, 0.15]} rotation={flat} size={0.14} color="#111" />
      {/* balance lead */}
      <Cylinder args={[0.02, 0.02, 0.25]} position={[-1.32, 0.72, 0.35]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#e5e7eb" /></Cylinder>
      <Box args={[0.1, 0.08, 0.3]} position={[-1.48, 0.72, 0.35]}><meshStandardMaterial color="#f5f5f5" /></Box>
      {comp.damaged && <Smoke y={1.2} />}
      <CompHitbox pos={getCompPinOffset('LiPo', '+')} onClick={() => onClick('+')} />
      <CompHitbox pos={getCompPinOffset('LiPo', '-')} onClick={() => onClick('-')} />
    </group>
  );
}

function ExtESC({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const r = sim as CompResult | undefined;
  const { dir } = escOf(comp.value);
  const prop = useRef<THREE.Group>(null);
  const blur = useRef<THREE.MeshStandardMaterial>(null);
  const spin = useRef(0);
  const target = comp.damaged ? 0 : r?.speed ?? 0;
  useFrame((_, delta) => {
    spin.current += (target - spin.current) * Math.min(1, delta * 3); // the rotor spins up and down
    if (prop.current) prop.current.rotation.y -= spin.current * delta * 40; // CW seen from above
    if (blur.current) blur.current.opacity = Math.min(0.35, Math.abs(spin.current) * 0.7);
  });
  const powered = !!r?.powered && !comp.damaged;
  const propColor = dir > 0 ? '#f97316' : '#22d3ee';
  const pins = DRONE_PINS.ESC;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      {/* ESC in heat-shrink, with its status LED */}
      <Box args={[1.0, 0.16, 0.5]} position={[0, 0.1, 0]}><meshStandardMaterial color={comp.damaged ? '#1f1f1f' : '#1d4ed8'} roughness={0.6} /></Box>
      <SilkscreenText text={`ESC ${ESC.iRated}A`} position={[-0.12, 0.185, 0]} rotation={flat} size={0.13} />
      <Box args={[0.06, 0.03, 0.06]} position={[0.38, 0.19, -0.17]}>
        <meshStandardMaterial color={powered ? '#22c55e' : '#14532d'} emissive={powered ? '#22c55e' : '#000'} emissiveIntensity={powered ? 1.5 : 0} />
      </Box>
      {/* battery leads */}
      <Cylinder args={[0.035, 0.035, 0.4]} position={[-0.7, 0.08, -0.15]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#dc2626" /></Cylinder>
      <Cylinder args={[0.035, 0.035, 0.4]} position={[-0.7, 0.08, 0.15]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#111" /></Cylinder>
      <SilkscreenText text="+" position={[-0.88, 0.25, -0.15]} rotation={flat} size={0.14} />
      <SilkscreenText text="-" position={[-0.88, 0.25, 0.15]} rotation={flat} size={0.14} />
      {/* signal lead: S, BEC 5 V, GND */}
      {([['S', '#f5f5f5'], ['5V', '#dc2626'], ['GND', '#3f2a1d']] as const).map(([id, color]) => (
        <group key={id}>
          <Cylinder args={[0.015, 0.015, 0.42]} position={[pins[id][0], 0.08, 0.45]} rotation={[Math.PI / 2, 0, 0]}><meshStandardMaterial color={color} /></Cylinder>
          <SilkscreenText text={id} position={[pins[id][0], 0.01, 0.85]} rotation={flat} size={0.08} />
        </group>
      ))}
      <Box args={[0.7, 0.09, 0.1]} position={[0, 0.08, 0.66]}><meshStandardMaterial color="#111" /></Box>
      {/* motor phase wires */}
      {[-0.08, 0, 0.08].map(z => (
        <Cylinder key={z} args={[0.018, 0.018, 0.6]} position={[0.78, 0.08, z]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#111" /></Cylinder>
      ))}
      {/* brushless motor and propeller */}
      <group position={[1.35, 0, 0]}>
        <Cylinder args={[0.3, 0.32, 0.1]} position={[0, 0.05, 0]}><meshStandardMaterial color="#27272a" /></Cylinder>
        <Cylinder args={[0.3, 0.3, 0.22]} position={[0, 0.21, 0]}><meshStandardMaterial color={comp.damaged ? '#2a2a2a' : '#a1a1aa'} metalness={0.8} roughness={0.3} /></Cylinder>
        <group ref={prop} position={[0, 0.36, 0]}>
          <Cylinder args={[0.08, 0.08, 0.1]}><meshStandardMaterial color={propColor} /></Cylinder>
          <Box args={[0.85, 0.02, 0.14]} position={[0.47, 0, 0]} rotation={[dir * 0.3, 0, 0]}><meshStandardMaterial color={propColor} /></Box>
          <Box args={[0.85, 0.02, 0.14]} position={[-0.47, 0, 0]} rotation={[-dir * 0.3, 0, 0]}><meshStandardMaterial color={propColor} /></Box>
        </group>
        <mesh position={[0, 0.36, 0]} rotation={flat} raycast={() => null}>
          <circleGeometry args={[0.9, 40]} />
          <meshStandardMaterial ref={blur} color={propColor} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <SilkscreenText text={dir > 0 ? 'CW' : 'CCW'} position={[0, 0.01, 0.45]} rotation={flat} size={0.1} />
      </group>
      {comp.damaged && <Smoke y={0.3} />}
      {Object.keys(pins).map(id => <CompHitbox key={id} pos={pins[id]} onClick={() => onClick(id)} />)}
    </group>
  );
}

function ExtIMU({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const powered = !!(sim as CompResult | undefined)?.powered && !comp.damaged;
  const pins = DRONE_PINS.IMU;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[1.0, 0.05, 0.6]} position={[0, 0.3, 0]}><meshStandardMaterial color={comp.damaged ? '#1f1f1f' : '#1d4ed8'} /></Box>
      <Box args={[0.22, 0.05, 0.22]} position={[0.08, 0.345, -0.06]}><meshStandardMaterial color="#111" /></Box>
      <Box args={[0.12, 0.04, 0.08]} position={[-0.32, 0.34, -0.16]}><meshStandardMaterial color="#111" /></Box>
      <Box args={[0.06, 0.03, 0.04]} position={[0.38, 0.34, -0.2]}>
        <meshStandardMaterial color={powered ? '#ff3b2a' : '#4a1410'} emissive={powered ? '#ff2a1a' : '#000'} emissiveIntensity={powered ? 1.5 : 0} />
      </Box>
      <SilkscreenText text="GY-521" position={[-0.28, 0.33, 0.02]} rotation={flat} size={0.08} />
      <SilkscreenText text="MPU-6050" position={[0.08, 0.375, -0.06]} rotation={flat} size={0.035} color="#bbb" />
      <Box args={[0.98, 0.08, 0.1]} position={[0, 0.27, 0.4]}><meshStandardMaterial color="#111" /></Box>
      {Object.entries(pins).map(([id, pos]) => (
        <group key={id}>
          <Cylinder args={[0.02, 0.02, 0.3]} position={[pos[0], 0.15, pos[2]]}><meshStandardMaterial color="#d4af37" metalness={0.8} /></Cylinder>
          <SilkscreenText text={id} position={[pos[0], 0.33, 0.22]} rotation={flat} size={0.055} />
          <CompHitbox pos={pos} onClick={() => onClick(id)} />
        </group>
      ))}
      {comp.damaged && <Smoke y={0.5} />}
    </group>
  );
}

function ExtELRS({ comp, sim, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const powered = !!(sim as CompResult | undefined)?.powered && !comp.damaged;
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    // Slow blink: powered, waiting for the transmitter.
    const on = powered && Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (led.current) {
      led.current.emissiveIntensity = on ? 2 : 0;
      led.current.color.set(on ? '#22c55e' : '#14532d');
    }
  });
  const pins = DRONE_PINS.ELRS;
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[0.8, 0.05, 0.45]} position={[0, 0.25, 0]}><meshStandardMaterial color={comp.damaged ? '#1f1f1f' : '#111827'} /></Box>
      <Box args={[0.2, 0.04, 0.2]} position={[-0.12, 0.29, -0.05]}><meshStandardMaterial color="#374151" metalness={0.6} /></Box>
      <Box args={[0.06, 0.03, 0.05]} position={[0.3, 0.29, -0.15]}><meshStandardMaterial ref={led} color="#14532d" emissive="#22c55e" emissiveIntensity={0} /></Box>
      <SilkscreenText text="ELRS 2.4G" position={[0.12, 0.28, 0.0]} rotation={flat} size={0.06} />
      {/* T antenna */}
      <Cylinder args={[0.012, 0.012, 0.5]} position={[0.25, 0.25, -0.47]} rotation={[Math.PI / 2, 0, 0]}><meshStandardMaterial color="#111" /></Cylinder>
      <Cylinder args={[0.015, 0.015, 0.6]} position={[0.25, 0.25, -0.72]} rotation={[0, 0, Math.PI / 2]}><meshStandardMaterial color="#e5e7eb" /></Cylinder>
      {Object.entries(pins).map(([id, pos]) => (
        <group key={id}>
          <Cylinder args={[0.02, 0.02, 0.25]} position={[pos[0], 0.125, pos[2]]}><meshStandardMaterial color="#d4af37" metalness={0.8} /></Cylinder>
          <SilkscreenText text={id} position={[pos[0], 0.28, 0.15]} rotation={flat} size={0.055} />
          <CompHitbox pos={pos} onClick={() => onClick(id)} />
        </group>
      ))}
      {comp.damaged && <Smoke y={0.45} />}
    </group>
  );
}

function ExtBreadboard({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[2.0, 0.25, 3.2]} position={[0.05, 0.125, 0]}>
        <meshStandardMaterial color="#f0f0f0" roughness={0.9} />
      </Box>
      <Box args={[0.05, 0.26, 3.2]} position={[-0.9, 0.125, 0]}><meshStandardMaterial color="#0000ff" /></Box>
      <Box args={[0.05, 0.26, 3.2]} position={[-0.75, 0.125, 0]}><meshStandardMaterial color="#ff0000" /></Box>
      <Box args={[0.05, 0.26, 3.2]} position={[0.85, 0.125, 0]}><meshStandardMaterial color="#ff0000" /></Box>
      <Box args={[0.05, 0.26, 3.2]} position={[1.0, 0.125, 0]}><meshStandardMaterial color="#0000ff" /></Box>
      <Box args={[0.2, 0.26, 3.2]} position={[0.05, 0.125, 0]}><meshStandardMaterial color="#ddd" /></Box>
      
      {BREADBOARD_PINS.map(p => (
         <CompHitbox key={p.id} pos={[p.pos[0], 0.26, p.pos[2]]} onClick={() => onClick(p.id)} isHole={true} />
      ))}
    </group>
  );
}

function SilkscreenText({ text, position, rotation = [0,0,0], size = 0.08, color = "white" }: any) {
  return (
    <Text font={SILK_FONT} position={position} rotation={rotation as any} fontSize={size} color={color} anchorX="center" anchorY="middle">
      {text}
    </Text>
  );
}

function DynamicWire({ selectedNode, components }: { selectedNode: {compId:string, pinId:string}, components: ExternalComponent[] }) {
  const { camera, pointer, raycaster } = useThree();
  const [endPos, setEndPos] = useState<[number, number, number]>([0, 0, 0]);

  let startPos = [0,0,0];
  if (selectedNode.compId === 'BOARD') {
     startPos = PINS.find(p => p.id === selectedNode.pinId)?.pos || [0,0,0];
  } else {
     const comp = components.find(c => c.id === selectedNode.compId);
     if (comp) {
       const offset = getCompPinOffset(comp.type, selectedNode.pinId);
       startPos = [comp.x + offset[0], offset[1], comp.z + offset[2]];
     }
  }

  useFrame(() => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
    raycaster.setFromCamera(pointer, camera);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);
    if (intersectPoint) {
      setEndPos([intersectPoint.x, intersectPoint.y, intersectPoint.z]);
    }
  });

  if (!startPos) return null;
  const midPoint = [(startPos[0] + endPos[0])/2, Math.max(startPos[1], endPos[1]) + 2, (startPos[2] + endPos[2])/2];
  
  return <QuadraticBezierLine start={startPos as any} mid={midPoint as any} end={endPos as any} color="yellow" lineWidth={3} />;
}

function InteractiveWire({ w, startPos, midPoint, endPos, onRemove }: any) {
  const [hover, setHover] = useState(false);
  return (
    <QuadraticBezierLine 
      start={startPos} 
      mid={midPoint} 
      end={endPos} 
      color={hover ? "#ff4444" : "yellow"} 
      lineWidth={hover ? 6 : 3} 
      onClick={(e) => { 
        e.stopPropagation(); 
        if (onRemove) onRemove(w.id); 
      }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
    />
  );
}

export default function Board3D(props: Board3DProps) {
  const [selectedNode, setSelectedNode] = useState<{ compId: string, pinId: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePinClick = (compId: string, pinId: string) => {
    if (selectedNode !== null && (selectedNode.compId !== compId || selectedNode.pinId !== pinId)) {
      props.onWireAdded(selectedNode.compId, selectedNode.pinId, compId, pinId);
      setSelectedNode(null);
    } else {
      setSelectedNode({ compId, pinId });
      if (props.onComponentSelect) props.onComponentSelect(null);
    }
  };

  return (
    <Canvas camera={{ position: [0, 6, 10], fov: 45 }} onPointerMissed={() => { setSelectedNode(null); if(props.onComponentSelect) props.onComponentSelect(null); }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 10, 6]} intensity={2.2} />
      <directionalLight position={[-6, 4, -4]} intensity={0.6} />
      <directionalLight position={[2, -10, 3]} intensity={1.4} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />
      <Environment resolution={256}>
        <Lightformer intensity={2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer intensity={1} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer intensity={1} position={[6, 2, -2]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
      </Environment>
      
      <Suspense fallback={null}>
        <UnoQBoard {...props} onPinClick={handlePinClick} onPinRightClick={props.onWireRemove} selectedPin={selectedNode} />
      </Suspense>
      
      {selectedNode && <DynamicWire selectedNode={selectedNode} components={props.components} />}
      
      {props.wires.map(w => {
        let startPos = [0,0,0];
        let endPos = [0,0,0];

        if (w.startCompId === 'BOARD') {
           startPos = PINS.find(p => p.id === w.startPinId)?.pos || [0,0,0];
        } else {
           const comp = props.components.find(c => c.id === w.startCompId);
           if (comp) {
             const offset = getCompPinOffset(comp.type, w.startPinId);
             startPos = [comp.x + offset[0], offset[1], comp.z + offset[2]];
           }
        }

        if (w.endCompId === 'BOARD') {
           endPos = PINS.find(p => p.id === w.endPinId)?.pos || [0,0,0];
        } else {
           const comp = props.components.find(c => c.id === w.endCompId);
           if (comp) {
             const offset = getCompPinOffset(comp.type, w.endPinId);
             endPos = [comp.x + offset[0], offset[1], comp.z + offset[2]];
           }
        }

        const midPoint = [(startPos[0] + endPos[0])/2, Math.max(startPos[1], endPos[1]) + 2, (startPos[2] + endPos[2])/2];
        return <InteractiveWire key={w.id} w={w} startPos={startPos as any} midPoint={midPoint as any} endPos={endPos as any} onRemove={props.onWireRemoveById} />;
      })}

      {props.components.map(c => {
        const commonProps = {
          comp: c,
          sim: props.sim?.comps[c.id],
          onClick: (compPin?: string) => {
            if (compPin) {
              handlePinClick(c.id, compPin);
            } else {
              if (selectedNode !== null) setSelectedNode(null);
              if (props.onComponentSelect) props.onComponentSelect(c.id);
            }
          },
          onRightClick: () => props.onComponentRemove(c.id),
          onInteract: (val: number) => props.onComponentInteract(c.id, val),
          onDragStart: () => setIsDragging(true),
          onDragEnd: () => setIsDragging(false),
          onDrag: (x: number, z: number) => props.onComponentMove(c.id, x, z)
        };
        const part = (() => {
        switch (c.type) {
          case 'LED': return <ExtLED {...commonProps} />;
          case 'Button': return <ExtButton {...commonProps} />;
          case 'Resistor': return <ExtResistor {...commonProps} />;
          case 'Capacitor': return <ExtCapacitor {...commonProps} />;
          case 'Inductor': return <ExtInductor {...commonProps} />;
          case 'Diode': return <ExtDiode {...commonProps} />;
          case 'Transistor': return <ExtTransistor {...commonProps} />;
          case 'Potentiometer': return <ExtPotentiometer {...commonProps} />;
          case 'Switch': return <ExtSwitch {...commonProps} />;
          case 'Buzzer': return <ExtBuzzer {...commonProps} />;
          case 'Servo': return <ExtServo {...commonProps} />;
          case 'Motor': return <ExtMotor {...commonProps} />;
          case 'OLED': return <ExtOLED {...commonProps} />;
          case 'Breadboard': return <ExtBreadboard {...commonProps} />;
          case 'LiPo': return <ExtLiPo {...commonProps} />;
          case 'ESC': return <ExtESC {...commonProps} />;
          case 'IMU': return <ExtIMU {...commonProps} />;
          case 'ELRS': return <ExtELRS {...commonProps} />;
          default: return null;
        }
        })();
        // Clicking the body selects the part (pins and controls stop propagation themselves).
        return (
          <group key={c.id} onClick={(e) => { e.stopPropagation(); commonProps.onClick(); }}>
            {part}
          </group>
        );
      })}

      <OrbitControls makeDefault enabled={!isDragging} minPolarAngle={0} maxPolarAngle={Math.PI} />
    </Canvas>
  );
}
