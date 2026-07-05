import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, QuadraticBezierLine, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { ExternalComponent, Wire } from './App';

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
      <Cylinder args={[0.15, 0.15, 0.2]} position={[0, isPressed ? 0.15 : 0.25, 0]} 
        onPointerDown={(e) => { e.stopPropagation(); onInteract(1); }}
        onPointerUp={(e) => { e.stopPropagation(); onInteract(0); }}
        onPointerOut={(e) => { e.stopPropagation(); onInteract(0); }}
      >
        <meshStandardMaterial color="#ef4444" />
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
    <Text position={position} rotation={rotation as any} fontSize={size} color={color} anchorX="center" anchorY="middle">
      {text}
    </Text>
  );
}

function ICChip({ id, pos, size, pins = 8 }: { id:string, pos:[number,number,number], size:[number,number,number], pins?: number }) {
  return (
    <group position={pos}>
      <Box args={size as any} position={[0, size[1]/2, 0]}>
        <meshStandardMaterial color="#111" roughness={0.9} />
      </Box>
      <SilkscreenText text={id} position={[0, size[1] + 0.001, 0]} rotation={[-Math.PI/2, 0, 0]} size={Math.min(size[0], size[2]) * 0.3} />
      {Array.from({ length: pins / 2 }).map((_, i) => (
        <group key={i}>
           <Box args={[size[0]*1.1, 0.02, 0.04]} position={[0, 0.01, -size[2]/2 + 0.08 + i * 0.08]}>
             <meshStandardMaterial color="#c0c0c0" metalness={0.8} />
           </Box>
        </group>
      ))}
    </group>
  );
}

function RGBLED({ position, colorArr }: { position: [number, number, number], colorArr: number[] }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (ref.current) {
      const r = colorArr[0] / 255;
      const g = colorArr[1] / 255;
      const b = colorArr[2] / 255;
      const targetColor = new THREE.Color(r, g, b);
      const targetEmissive = new THREE.Color(r, g, b);
      ref.current.color.lerp(targetColor, 0.1);
      ref.current.emissive.lerp(targetEmissive, 0.1);
      ref.current.emissiveIntensity = (r > 0 || g > 0 || b > 0) ? 2 : 0;
    }
  });
  return (
    <Box args={[0.15, 0.05, 0.15]} position={position}>
      <meshStandardMaterial ref={ref} color="#111" />
    </Box>
  );
}

// PINS MAPPING
// Coordinate system: Board is 5.334 wide (X) x 6.858 tall (Z)
// X: -2.667 (left) to +2.667 (right)
// Z: -3.429 (top/far) to +3.429 (bottom/near camera)
// Schematic mapping:
//   Top edge (Z≈-3.4): POWER LED, USB-C, Power Button, JCTL
//   Bottom edge (Z≈+3.4): LED matrix, SPI2, QWIIC
//   Left edge (X≈-2.6): Power header (BOOT→VIN), Analog (A0→A5)
//   Right edge (X≈+2.6): Digital header (D21→D0)
const PINS = (() => {
  const pins: {id: string, pos: [number,number,number], label: string, txtRot?: [number,number,number], txtPos?: [number,number,number], txtSize?: number, pinType?: 'female' | 'male' | 'smd'}[] = [];
  
  // === RIGHT EDGE: Digital Pins (top to bottom) ===
  // D21, D20, AREF, GND, D13, D12, D11, D10, D9, D8  (upper block)
  const dBlock2Labels = ["21", "20", "AREF", "GND", "13", "12", "11", "10", "9", "8"];
  dBlock2Labels.forEach((lbl, i) => {
    const z = -2.8 + i * 0.2;
    pins.push({ id: lbl, pos: [2.4, 0.48, z], label: lbl, txtSize: 0.08, txtRot: [-Math.PI/2, 0, 0], txtPos: [0.35, -0.39, 0], pinType: 'female' });
  });
  
  // D7, D6, D5, D4, D3, D2, D1, D0  (lower block)
  const dBlock1Labels = ["7", "6", "5", "4", "3", "2", "1", "0"];
  dBlock1Labels.forEach((lbl, i) => {
    const z = -0.4 + i * 0.2;
    pins.push({ id: lbl, pos: [2.4, 0.48, z], label: lbl, txtSize: 0.1, txtRot: [-Math.PI/2, 0, 0], txtPos: [0.35, -0.39, 0], pinType: 'female' });
  });

  // === LEFT EDGE: Power Header (top to bottom) ===
  const pBlock1Labels = ["BOOT", "IOREF", "RESET", "3V3", "5V", "GND_1", "GND_2", "VIN"];
  pBlock1Labels.forEach((lbl, i) => {
    const z = -2.8 + i * 0.2;
    pins.push({ id: lbl, pos: [-2.4, 0.48, z], label: lbl.replace("_1","").replace("_2",""), txtSize: 0.07, txtRot: [-Math.PI/2, 0, 0], txtPos: [-0.35, -0.39, 0], pinType: 'female' });
  });

  // === LEFT EDGE: Analog Pins (continuing down) ===
  const aLabels = ["A0", "A1", "A2", "A3", "A4", "A5"];
  aLabels.forEach((lbl, i) => {
    const z = -0.4 + i * 0.2;
    pins.push({ id: (14 + i).toString(), pos: [-2.4, 0.48, z], label: lbl, txtSize: 0.1, txtRot: [-Math.PI/2, 0, 0], txtPos: [-0.35, -0.39, 0], pinType: 'female' });
  });

  // === TOP-RIGHT: JCTL Header (2x5) ===
  const jctlLabels = ["VBUS", "PMIC", "GP13", "GP12", "GP95", "1V8", "GND_J1", "V_UP", "V_DN", "GND_J2"];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const idx = r * 5 + c;
      pins.push({ 
        id: `JCTL_${jctlLabels[idx]}`, 
        pos: [1.5 + r * 0.2, 0.1, -2.9 + c * 0.2], 
        label: jctlLabels[idx].replace("_J1","").replace("_J2",""), 
        txtSize: 0.04, 
        txtRot: [-Math.PI/2, 0, 0], 
        txtPos: [r === 0 ? -0.12 : 0.12, -0.15, 0], 
        pinType: 'male' 
      });
    }
  }
  
  // === BOTTOM: QWIIC Header (1x4) ===
  const qwLabels = ["GND", "3V3", "SDA", "SCL"];
  qwLabels.forEach((lbl, i) => {
    pins.push({ 
      id: `QW_${lbl}`, 
      pos: [-1.0 + i * 0.2, 0.3, 3.0], 
      label: lbl, 
      txtSize: 0.05, 
      txtRot: [-Math.PI/2, 0, 0],
      txtPos: [0, -0.15, 0.15], 
      pinType: 'smd' 
    });
  });

  // === BOTTOM SIDE HEADERS (JMISC & JMEDIA) ===
  const jmiscOdd = ["PC6", "PC7", "PD5", "PC9", "PB4", "PH4", "PH5", "PD7", "PD9", "PH6", "PD8", "PA5", "PA10", "GND", "MIC2_P", "MIC2_N", "M_BIAS", "GND", "S_G0", "S_G1", "S_G2", "S_G3", "S_G5", "S_G62", "S_G10", "S_G20", "3V3", "3V3", "1V8", "VDDIN"];
  const jmiscEven = ["CMD", "T_CLK", "T_D0", "T_D2", "T_D3", "PE7", "PE8", "I2C4_C", "I2C4_D", "OPA_O", "OPA_P", "OPA_N", "GND", "EAR_P", "EAR_N", "LOUT_P", "LOUT_N", "HPH_L", "HPH_R", "H_REF", "HS_D", "GND", "S_G98", "S_G99", "S_G100", "S_G101", "5V", "5V", "GND", "VBAT"];
  
  for(let i=0; i<30; i++) {
    const x = -2.175 + i * 0.15;
    pins.push({
      id: `JMISC_${i*2 + 1}`, pos: [x, -0.1, 1.4], label: jmiscOdd[i],
      txtSize: 0.035, txtRot: [Math.PI/2, 0, Math.PI/2], txtPos: [0, 0.018, -0.25], pinType: 'smd'
    });
    pins.push({
      id: `JMISC_${i*2 + 2}`, pos: [x, -0.1, 1.6], label: jmiscEven[i],
      txtSize: 0.035, txtRot: [Math.PI/2, 0, Math.PI/2], txtPos: [0, 0.018, 0.25], pinType: 'smd'
    });
  }

  const jmediaOdd = ["GND", "DSI_C_M", "DSI_C_P", "GND", "DSI_2_M", "DSI_2_P", "GND", "DSI_3_M", "DSI_3_P", "GND", "CSI_C0_M", "CSI_D0_P", "GND", "CSI_D1_M", "CSI_A1_P", "GND", "CSI_A0_M", "CSI_A0_P", "GND", "CSI_A2_M", "CSI_C1_P", "GND", "CSI_C2_M", "CSI_D2_P", "GND", "I2C0_C", "I2C0_D", "GND", "VIN", "VIN"];
  const jmediaEven = ["GND", "DSI_1_P", "DSI_1_M", "GND", "DSI_0_P", "DSI_0_M", "GND", "CAM_M0", "CAM_M1", "GND", "I2C1_D", "I2C1_C", "GND", "CSI_D2_P", "CSI_C2_M", "GND", "CSI_C1_P", "CSI_A2_M", "GND", "CSI_A0_P", "CSI_A0_M", "GND", "CSI_A1_P", "CSI_D1_M", "GND", "CSI_D0_P", "CSI_C0_M", "GND", "3V3", "3V3"];

  for(let i=0; i<30; i++) {
    const x = -2.175 + i * 0.15;
    pins.push({
      id: `JMEDIA_${i*2 + 1}`, pos: [x, -0.1, -1.6], label: jmediaOdd[i],
      txtSize: 0.035, txtRot: [Math.PI/2, 0, Math.PI/2], txtPos: [0, 0.018, -0.25], pinType: 'smd'
    });
    pins.push({
      id: `JMEDIA_${i*2 + 2}`, pos: [x, -0.1, -1.4], label: jmediaEven[i],
      txtSize: 0.035, txtRot: [Math.PI/2, 0, Math.PI/2], txtPos: [0, 0.018, 0.25], pinType: 'smd'
    });
  }

  // === BOTTOM: SPI2 Header (3 cols x 2 rows) ===
  // Row 0 (top): RST, SCK, MISO
  // Row 1 (bottom): GND, MOSI, 5V
  const icspGrid = [
    ["RST", "SCK", "MISO"],
    ["GND", "MOSI", "5V"]
  ];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const lbl = icspGrid[r][c];
      pins.push({ 
        id: `SPI2_${lbl}`, 
        pos: [0.0 + c * 0.2, 0.1, 2.6 + r * 0.2], 
        label: lbl, 
        txtSize: 0.05, 
        txtRot: [-Math.PI/2, 0, 0],
        txtPos: [0, -0.15, r === 0 ? -0.15 : 0.15], 
        pinType: 'male' 
      });
    }
  }

  return pins;
})();

function ArduinoBoard({ ledState, matrixFrame, rgb1, rgb2, rgb3, rgb4, onPinClick, onPinRightClick, selectedPin }: any) {
  const builtinLedRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (builtinLedRef.current) {
      const targetColor = ledState > 0 ? new THREE.Color(0xff0000) : new THREE.Color(0x220000);
      const targetEmissive = ledState > 0 ? new THREE.Color(0xff0000) : new THREE.Color(0x000000);
      builtinLedRef.current.color.lerp(targetColor, 0.1);
      builtinLedRef.current.emissive.lerp(targetEmissive, 0.1);
      builtinLedRef.current.emissiveIntensity = ledState > 0 ? 2 : 0;
    }
  });

  const matrixDots = useMemo(() => {
    const dots = [];
    // Rotated 90°: 8 columns along X (r), 13 rows along Z (c) to match schematic mapping
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 13; c++) {
        dots.push({ id: `m-${r}-${c}`, r, c, x: -1.9 + r * 0.12, z: 0.6 + c * 0.13 });
      }
    }
    return dots;
  }, []);

  return (
    <group position={[0, 0, 0]}>
      {/* PCB Base - 5.334 wide (X) x 6.858 tall (Z) */}
      <Box args={[5.334, 0.16, 6.858]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#0b1b36" roughness={0.7} metalness={0.2} />
      </Box>

      <SilkscreenText text="ARDUINO UNO Q" position={[0, 0.081, -0.5]} rotation={[-Math.PI/2, 0, 0]} size={0.16} />
      
      {/* === TOP EDGE: POWER LED, USB-C, Power Button (left to right) === */}
      {/* POWER LED (ON) - top-left */}
      <Box args={[0.15, 0.05, 0.15]} position={[-1.6, 0.11, -3.2]}>
        <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={1} />
      </Box>
      <SilkscreenText text="ON" position={[-1.6, 0.081, -3.0]} rotation={[-Math.PI/2, 0, 0]} size={0.1} />

      {/* USB-C connector - top-center */}
      <Box args={[0.7, 0.32, 0.9]} position={[-0.2, 0.24, -3.3]}>
        <meshStandardMaterial color="#cccccc" metalness={0.8} roughness={0.2} />
      </Box>
      <SilkscreenText text="USB-C" position={[-0.2, 0.081, -2.7]} rotation={[-Math.PI/2, 0, 0]} size={0.1} />

      {/* Power Button - top-right */}
      <Box args={[0.3, 0.1, 0.3]} position={[1.6, 0.13, -3.1]}>
        <meshStandardMaterial color="#ddd" />
      </Box>
      <Cylinder args={[0.08, 0.08, 0.05]} position={[1.6, 0.18, -3.1]}>
        <meshStandardMaterial color="#fff" />
      </Cylinder>
      <SilkscreenText text="POWER" position={[1.6, 0.081, -2.7]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      {/* === CHIPS: matching schematic layout === */}
      {/* WCBN3536A (top-left, large shielded module) */}
      <Box args={[1.4, 0.15, 1.2]} position={[-1.6, 0.155, -2.0]}>
        <meshStandardMaterial color="#d0d0d0" metalness={0.9} roughness={0.4} />
      </Box>
      <SilkscreenText text="WCBN3536A" position={[-1.6, 0.231, -2.0]} rotation={[-Math.PI/2, 0, 0]} size={0.12} />

      {/* ANX7625 (top-right, near WCBN) */}
      <ICChip id="ANX7625" pos={[0.2, 0.08, -2.0]} size={[0.6, 0.05, 0.5]} pins={16} />

      {/* QRB2210 (center-left) */}
      <ICChip id="QRB2210" pos={[-0.1, 0.08, -0.2]} size={[1.0, 0.05, 1.0]} pins={48} />
      
      {/* LPDDR4 RAM (center-right, next to QRB2210) */}
      <ICChip id="LPDDR4" pos={[1.3, 0.08, -0.2]} size={[0.9, 0.05, 0.8]} pins={32} />

      {/* PM4125 (bottom-center) */}
      <ICChip id="PM4125" pos={[0.8, 0.08, 1.2]} size={[0.8, 0.05, 0.8]} pins={24} />

      {/* === JCTL Header base (top-right) === */}
      <Box args={[0.4, 0.05, 1.0]} position={[1.6, 0.1, -2.5]}>
        <meshStandardMaterial color="#111" />
      </Box>
      <SilkscreenText text="JCTL" position={[1.2, 0.081, -2.5]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      {/* === SPI2 (ICSP) Male Base (bottom-center, 3 cols x 2 rows) === */}
      <Box args={[0.6, 0.05, 0.4]} position={[0.2, 0.1, 2.7]}>
        <meshStandardMaterial color="#111" />
      </Box>
      <SilkscreenText text="SPI2" position={[0.2, 0.081, 2.3]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      {/* === QWIIC Connector (bottom-left) === */}
      <Box args={[0.8, 0.2, 0.25]} position={[-0.7, 0.18, 3.0]}>
         <meshStandardMaterial color="#e0e0e0" />
      </Box>
      <SilkscreenText text="QWIIC" position={[-0.7, 0.081, 3.2]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      {/* === LED Matrix (between analog pins and QRB2210, rotated 90°: 8x13) === */}
      <Box args={[1.1, 0.05, 1.8]} position={[-1.48, 0.11, 1.38]}>
        <meshStandardMaterial color="#111111" />
      </Box>
      {matrixDots.map(dot => {
        const isOn = matrixFrame && matrixFrame[dot.r] && matrixFrame[dot.r][dot.c] === 1;
        return (
          <Box key={dot.id} args={[0.08, 0.02, 0.08]} position={[dot.x, 0.14, dot.z]}>
             <meshStandardMaterial color={isOn ? "#0088ff" : "#112233"} emissive={isOn ? "#0088ff" : "#000000"} emissiveIntensity={isOn ? 2 : 0} />
          </Box>
        );
      })}

      {/* 4 RGB LEDs at Bottom Right */}
      <RGBLED position={[1.1, 0.11, 3.0]} colorArr={rgb1} />
      <SilkscreenText text="1" position={[1.1, 0.081, 3.2]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      <RGBLED position={[1.4, 0.11, 3.0]} colorArr={rgb2} />
      <SilkscreenText text="2" position={[1.4, 0.081, 3.2]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      <RGBLED position={[1.7, 0.11, 3.0]} colorArr={rgb3} />
      <SilkscreenText text="3" position={[1.7, 0.081, 3.2]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      <RGBLED position={[2.0, 0.11, 3.0]} colorArr={rgb4} />
      <SilkscreenText text="4" position={[2.0, 0.081, 3.2]} rotation={[-Math.PI/2, 0, 0]} size={0.08} />

      {/* === BOTTOM HEADERS (JMISC & JMEDIA) === */}
      {/* JMISC */}
      <Box args={[4.6, 0.05, 0.3]} position={[0, -0.08, 1.5]}>
        <meshStandardMaterial color="#111" />
      </Box>
      <SilkscreenText text="JMISC" position={[-2.5, -0.082, 1.5]} rotation={[Math.PI/2, 0, Math.PI/2]} size={0.12} />
      
      {/* JMEDIA */}
      <Box args={[4.6, 0.05, 0.3]} position={[0, -0.08, -1.5]}>
        <meshStandardMaterial color="#111" />
      </Box>
      <SilkscreenText text="JMEDIA" position={[-2.5, -0.082, -1.5]} rotation={[Math.PI/2, 0, Math.PI/2]} size={0.12} />

      {/* === MAIN HEADERS (black plastic housings) === */}
      {/* Left: Power Header */}
      <Box args={[0.25, 0.8, 1.6]} position={[-2.4, 0.48, -2.1]}>
        <meshStandardMaterial color="#111" />
      </Box>
      {/* Left: Analog Header */}
      <Box args={[0.25, 0.8, 1.2]} position={[-2.4, 0.48, 0.1]}>
        <meshStandardMaterial color="#111" />
      </Box>
      {/* Right: Digital Upper (D21→D8) */}
      <Box args={[0.25, 0.8, 2.0]} position={[2.4, 0.48, -1.9]}>
        <meshStandardMaterial color="#111" />
      </Box>
      {/* Right: Digital Lower (D7→D0) */}
      <Box args={[0.25, 0.8, 1.6]} position={[2.4, 0.48, 0.3]}>
        <meshStandardMaterial color="#111" />
      </Box>

      {/* Header Hitboxes and Labels */}
      {PINS.map(p => {
        const isMale = p.pinType === 'male';
        const isSmd = p.pinType === 'smd';
        const hitBoxArgs = isMale ? [0.05, 0.3, 0.05] : isSmd ? [0.1, 0.05, 0.1] : [0.1, 0.05, 0.1];
        const hitBoxPos = isMale ? [0, 0.15, 0] : isSmd ? [0, 0.0, 0] : [0, 0.4, 0];
        
        return (
          <group key={p.id} position={p.pos as any}>
            <Box args={hitBoxArgs as any} position={hitBoxPos as any} onClick={(e) => { e.stopPropagation(); onPinClick('BOARD', p.id); }} onContextMenu={(e) => { e.stopPropagation(); onPinRightClick('BOARD', p.id); }}>
              <meshStandardMaterial 
                color={selectedPin?.compId === 'BOARD' && selectedPin?.pinId === p.id ? "#00ff00" : "#ffd700"} 
                transparent opacity={0.8} 
                emissive={selectedPin?.compId === 'BOARD' && selectedPin?.pinId === p.id ? "#00ff00" : "#ff8800"} 
                emissiveIntensity={selectedPin?.compId === 'BOARD' && selectedPin?.pinId === p.id ? 0.8 : 0.2} 
              />
            </Box>
            <SilkscreenText 
              text={p.label} 
              position={p.txtPos || [0, -0.39, -0.3]} 
              rotation={p.txtRot || [-Math.PI/2, 0, 0]} 
              size={p.txtSize || 0.1} 
            />
          </group>
        );
      })}
    </group>
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
      <ambientLight intensity={1.5} />
      <directionalLight position={[10, 10, 5]} intensity={2} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />
      
      <ArduinoBoard {...props} onPinClick={handlePinClick} onPinRightClick={props.onWireRemove} selectedPin={selectedNode} />
      
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
