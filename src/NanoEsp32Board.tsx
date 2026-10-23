import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { Box, Cylinder, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { BoardPin, PinHitbox, Glow, SILK_FONT } from './UnoQBoard';
import topTextureUrl from './assets/nano-esp32-top.jpg';

// Arduino Nano ESP32 (ABX00083) 3D model.
//
// Scene units: 1 unit = 10 mm. The board lies in the XZ plane with the USB-C connector at -Z:
//   X: -0.889 (D13 / A0-A7 side) .. +0.889 (D12-D2 side)
//   Z: -2.159 (USB-C end) .. +2.159 (antenna end)
// Dimensions and part positions come from the official STEP model (43.18 x 17.78 mm PCB); the
// official top-view render (datasheet, Documents/ABX00083) is the PCB texture.
// From PCB millimetres (x along the board from the USB end, y from the D13 edge):
//   X = (y_mm - 8.89) / 10,  Z = (x_mm - 21.59) / 10

const PCB_W = 1.778;
const PCB_L = 4.318;
const PCB_THICKNESS = 0.16;
const HEADER_H = 0.25; // male header plastic the board sits on
export const NANO_PCB_TOP = HEADER_H + PCB_THICKNESS;
const PITCH = 0.254;
const ROW_X = 0.762; // rows are 0.6" apart
const PIN_Z0 = -1.778; // first pin (next to USB-C)
const PIN_Y = NANO_PCB_TOP + 0.06;

const GOLD = { color: '#d9b54a', metalness: 0.9, roughness: 0.3 };
const SILVER = { color: '#c8ccd0', metalness: 1, roughness: 0.28 };

function texUV(x: number, z: number): [number, number] {
  return [(z * 10 + 21.59) / 43.18, (x * 10 + 8.89) / 17.78];
}

// ---------------------------------------------------------------------------
// Pin map (Arduino pin numbering, the Nano ESP32 default)
// ---------------------------------------------------------------------------

const RIGHT_ROW: [string, string][] = [
  ['12', 'D12'], ['11', 'D11'], ['10', 'D10'], ['9', 'D9'], ['8', 'D8'], ['7', 'D7'], ['6', 'D6'], ['5', 'D5'],
  ['4', 'D4'], ['3', 'D3'], ['2', 'D2'], ['GND_1', 'GND'], ['RST', 'RST'], ['0', 'D0/RX'], ['1', 'D1/TX'],
];
const LEFT_ROW: [string, string][] = [
  ['13', 'D13'], ['3V3', '3V3'], ['B0', 'B0'], ['17', 'A0'], ['18', 'A1'], ['19', 'A2'], ['20', 'A3'], ['21', 'A4'],
  ['22', 'A5'], ['23', 'A6'], ['24', 'A7'], ['VBUS', 'VBUS'], ['B1', 'B1'], ['GND_2', 'GND'], ['VIN', 'VIN'],
];

export const NANO_PINS: BoardPin[] = [
  ...RIGHT_ROW.map(([id, label], i) => ({ id, label, pos: [ROW_X, PIN_Y, PIN_Z0 + i * PITCH] as [number, number, number], pinType: 'pad' as const, showLabel: true, side: 1 as const })),
  ...LEFT_ROW.map(([id, label], i) => ({ id, label, pos: [-ROW_X, PIN_Y, PIN_Z0 + i * PITCH] as [number, number, number], pinType: 'pad' as const, showLabel: true, side: -1 as const })),
];

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

// Box whose top face shows the matching region of the board render.
function TexturedBox({ tex, x0, x1, z0, z1, y0, h, side, metal = false }: { tex: THREE.Texture; x0: number; x1: number; z0: number; z1: number; y0: number; h: number; side: string; metal?: boolean }) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 8; i < 12; i++) { // +Y face
      const [u, v] = texUV(cx + p.getX(i), cz + p.getZ(i));
      uv.setXY(i, u, v);
    }
    return g;
  }, [x0, x1, z0, z1, h, cx, cz]);
  return (
    <mesh geometry={geo} position={[cx, y0 + h / 2, cz]}>
      {[0, 1, 2, 3, 4, 5].map(i => i === 2
        ? <meshStandardMaterial key={i} attach={`material-${i}`} map={tex} roughness={metal ? 0.35 : 0.55} metalness={metal ? 0.4 : 0.05} />
        : <meshStandardMaterial key={i} attach={`material-${i}`} color={side} roughness={metal ? 0.3 : 0.7} metalness={metal ? 0.9 : 0.1} />)}
    </mesh>
  );
}

function Headers() {
  return (
    <group>
      {[-ROW_X, ROW_X].map(x => (
        <group key={x}>
          <Box args={[PITCH, HEADER_H, PITCH * 15]} position={[x, HEADER_H / 2, PIN_Z0 + PITCH * 7]}>
            <meshStandardMaterial color="#1c1c1c" roughness={0.7} />
          </Box>
          {/* pin tips and solder through the castellated pads */}
          {Array.from({ length: 15 }).map((_, i) => (
            <group key={i} position={[x, NANO_PCB_TOP, PIN_Z0 + i * PITCH]}>
              <Cylinder args={[0.06, 0.07, 0.03, 12]} position={[0, 0.015, 0]}>
                <meshStandardMaterial color="#d4d6d8" metalness={0.95} roughness={0.25} />
              </Cylinder>
              <Box args={[0.064, 0.06, 0.064]} position={[0, 0.03, 0]}>
                <meshStandardMaterial {...GOLD} />
              </Box>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function UsbC() {
  return (
    <group position={[0, NANO_PCB_TOP + 0.13, -1.93]}>
      <RoundedBox args={[0.894, 0.32, 0.68]} radius={0.15} smoothness={4}>
        <meshStandardMaterial {...SILVER} />
      </RoundedBox>
      <RoundedBox args={[0.8, 0.24, 0.02]} radius={0.11} smoothness={4} position={[0, 0, -0.335]}>
        <meshStandardMaterial color="#0c0c0c" roughness={0.9} />
      </RoundedBox>
      <Box args={[0.6, 0.06, 0.02]} position={[0, 0, -0.34]}>
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
      </Box>
    </group>
  );
}

function ResetButton() {
  return (
    <group position={[-0.004, NANO_PCB_TOP, -1.074]}>
      <Box args={[0.45, 0.1, 0.29]} position={[0, 0.05, 0]}>
        <meshStandardMaterial color="#d6d8da" metalness={0.6} roughness={0.35} />
      </Box>
      <Cylinder args={[0.07, 0.07, 0.06, 24]} position={[0, 0.13, 0]}>
        <meshStandardMaterial color="#f4f4f2" roughness={0.4} />
      </Cylinder>
    </group>
  );
}

function SmdLed({ x, z, color, on }: { x: number; z: number; color: THREE.ColorRepresentation; on: number }) {
  return (
    <group position={[x, NANO_PCB_TOP, z]}>
      <Box args={[0.08, 0.04, 0.16]} position={[0, 0.02, 0]}>
        <meshStandardMaterial color={on > 0 ? color : '#e9e7e1'} emissive={color} emissiveIntensity={on * 2.5} toneMapped={on <= 0} />
      </Box>
      <Glow position={[0, 0.06, 0]} size={0.4} color={color} opacity={Math.min(0.9, on)} />
    </group>
  );
}

function RgbLed({ rgb }: { rgb: number[] }) {
  const on = Math.max(rgb[0], rgb[1], rgb[2]) / 255;
  const color = useMemo(() => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255), [rgb]);
  return (
    <group position={[0.351, NANO_PCB_TOP, -1.079]}>
      <Box args={[0.1, 0.03, 0.1]} position={[0, 0.015, 0]}>
        <meshStandardMaterial color={on > 0 ? color : '#e9e7e1'} emissive={color} emissiveIntensity={on * 2.5} toneMapped={on <= 0} />
      </Box>
      <Glow position={[0, 0.05, 0]} size={0.4} color={color} opacity={on > 0 ? 0.9 : 0} />
    </group>
  );
}

function PinLabels() {
  return (
    <group>
      {NANO_PINS.map(p => (
        <Text
          key={p.id}
          font={SILK_FONT}
          position={[p.pos[0] + (p.side ?? 1) * 0.2, 0.01, p.pos[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={p.label.length > 3 ? 0.065 : 0.085}
          color="#ffffff"
          anchorX={(p.side ?? 1) > 0 ? 'left' : 'right'}
          anchorY="middle"
        >
          {p.label}
        </Text>
      ))}
    </group>
  );
}

// `ledState`: LED_BUILTIN (D13). `rgb1`: the onboard RGB LED, already converted from its
// active-LOW pins (D14-D16) to 0-255 brightness by the app.
export function NanoEsp32Board({ ledState, rgb1, onPinClick, onPinRightClick, selectedPin }: any) {
  const tex = useLoader(THREE.TextureLoader, topTextureUrl);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }, [tex]);

  return (
    <group>
      <Headers />
      {/* PCB, textured from the official render */}
      <TexturedBox tex={tex} x0={-PCB_W / 2} x1={PCB_W / 2} z0={-PCB_L / 2} z1={PCB_L / 2} y0={HEADER_H} h={PCB_THICKNESS} side="#1d5f86" />
      {/* NORA-W106 module: green carrier with antenna, then the shield can */}
      <TexturedBox tex={tex} x0={-0.519} x1={0.521} z0={0.721} z1={2.151} y0={NANO_PCB_TOP} h={0.05} side="#2f8f3a" />
      <TexturedBox tex={tex} x0={-0.489} x1={0.481} z0={0.761} z1={1.801} y0={NANO_PCB_TOP + 0.05} h={0.13} side="#b9bec2" metal />
      {/* flash / power ICs */}
      <TexturedBox tex={tex} x0={-0.059} x1={0.551} z0={-0.609} z1={-0.099} y0={NANO_PCB_TOP} h={0.06} side="#1d1d1f" />
      <UsbC />
      <ResetButton />
      <SmdLed x={0.58} z={-2.02} color="#33ff55" on={1} />{/* power */}
      <SmdLed x={-0.58} z={-2.02} color="#ffb21a" on={ledState > 0 ? 1 : 0} />{/* LED_BUILTIN */}
      <RgbLed rgb={rgb1} />
      <PinLabels />

      {NANO_PINS.map(p => (
        <PinHitbox
          key={p.id}
          pin={{ ...p, showLabel: false }}
          selected={selectedPin?.compId === 'BOARD' && selectedPin?.pinId === p.id}
          onClick={() => onPinClick('BOARD', p.id)}
          onRightClick={() => onPinRightClick('BOARD', p.id)}
        />
      ))}
    </group>
  );
}
