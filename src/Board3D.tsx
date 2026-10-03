import { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, QuadraticBezierLine, Text, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { ExternalComponent, Wire } from './App';
import { UnoQBoard, PINS, SILK_FONT } from './UnoQBoard';

interface Board3DProps {
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
    case 'Transistor': return pinId === 'C' ? [-0.15, 0.2, 0] : pinId === 'B' ? [0, 0.2, 0] : [0.15, 0.2, 0];
    case 'Potentiometer': return pinId === '1' ? [-0.2, 0.1, 0.3] : pinId === '2' ? [0, 0.1, 0.3] : [0.2, 0.1, 0.3];
    case 'Switch': return pinId === '1' ? [-0.3, 0.1, 0.2] : pinId === '2' ? [0, 0.1, 0.2] : [0.3, 0.1, 0.2];
    case 'Buzzer': return pinId === '-' ? [-0.1, 0.2, 0] : [0.1, 0.2, 0];
    case 'Servo': return pinId === 'GND' ? [-0.3, 0.1, 0.2] : pinId === 'VCC' ? [-0.3, 0.1, 0.3] : [-0.3, 0.1, 0.4];
    case 'Motor': return pinId === '1' ? [-0.4, 0.4, 0.2] : [-0.4, 0.4, -0.2];
    case 'OLED': return pinId === 'GND' ? [-0.3, 0.2, -0.7] : pinId === 'VCC' ? [-0.1, 0.2, -0.7] : pinId === 'SCL' ? [0.1, 0.2, -0.7] : [0.3, 0.2, -0.7];
    default: return [0, 0.4, 0];
  }
}

function ExtLED({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);

  useFrame(() => {
    if (ref.current) {
      const targetColor = comp.state > 0 ? new THREE.Color(0xff0000) : new THREE.Color(0x220000);
      const targetEmissive = comp.state > 0 ? new THREE.Color(0xff0000) : new THREE.Color(0x000000);
      ref.current.color.lerp(targetColor, 0.1);
      ref.current.emissive.lerp(targetEmissive, 0.1);
      ref.current.emissiveIntensity = comp.state > 0 ? 2 : 0;
    }
  });

  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[-0.1, 0.25, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.5]} position={[0.1, 0.25, 0]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.2, 0.2, 0.3]} position={[0, 0.6, 0]}><meshStandardMaterial ref={ref} color="#220000" emissive="#000000" transparent opacity={0.9} /></Cylinder>
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

function ExtResistor({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Cylinder args={[0.02, 0.02, 1.0]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.1, 0.1, 0.6]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#d4a373" /></Cylinder>
      <Cylinder args={[0.105, 0.105, 0.05]} position={[-0.2, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#8b4513" /></Cylinder>
      <Cylinder args={[0.105, 0.105, 0.05]} position={[0, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#000" /></Cylinder>
      <Cylinder args={[0.105, 0.105, 0.05]} position={[0.2, 0.1, 0]} rotation={[0, 0, Math.PI/2]}><meshStandardMaterial color="#ff0000" /></Cylinder>
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

function ExtBuzzer({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const isRing = comp.state > 0;
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

function ExtServo({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const angle = (comp.state / 255) * Math.PI; 
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
    </group>
  );
}

function ExtMotor({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current && comp.state > 0) {
      ref.current.rotation.x += 0.5;
    }
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

function ExtOLED({ comp, onClick, onRightClick, onDragStart, onDrag, onDragEnd }: any) {
  const bind = useCompDrag(comp, onDragStart, onDragEnd, onDrag);
  return (
    <group position={[comp.x, 0, comp.z]} {...(bind() as any)} onContextMenu={(e) => { e.stopPropagation(); onRightClick(); }}>
      <Box args={[1.5, 0.1, 1.5]} position={[0, 0.4, 0]}><meshStandardMaterial color="#1e3a8a" /></Box>
      <Box args={[1.2, 0.12, 0.8]} position={[0, 0.4, 0.2]}>
         <meshStandardMaterial color={comp.state > 0 ? "#111" : "#000"} emissive={comp.state > 0 ? "#222" : "#000"} />
      </Box>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.3, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[-0.1, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.1, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0.3, 0.2, -0.7]}><meshStandardMaterial color="#ccc" /></Cylinder>
      <CompHitbox pos={getCompPinOffset('OLED', 'GND')} onClick={() => onClick('GND')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'VCC')} onClick={() => onClick('VCC')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'SCL')} onClick={() => onClick('SCL')} />
      <CompHitbox pos={getCompPinOffset('OLED', 'SDA')} onClick={() => onClick('SDA')} />
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
          key: c.id,
          comp: c,
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
          default: return null;
        }
      })}

      <OrbitControls makeDefault enabled={!isDragging} minPolarAngle={0} maxPolarAngle={Math.PI} />
    </Canvas>
  );
}
