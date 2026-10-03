import { useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Box, Cylinder, RoundedBox, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { PCB_OUTLINE, PCB_HOLES } from './unoQOutline';
import topTextureUrl from './assets/uno-q-top.jpg';
import bottomTextureUrl from './assets/uno-q-bottom.jpg';
import { configureTextBuilder } from 'troika-three-text';
import silkscreenFontUrl from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff';

// The app's CSP blocks troika's blob workers and its CDN-hosted default font, which made every
// <Text> (and with it the whole scene) fail: build text on the main thread with a bundled font.
configureTextBuilder({ useWorker: false, defaultFontURL: silkscreenFontUrl });
export const SILK_FONT = silkscreenFontUrl;

// Arduino UNO Q (ABX00162) 3D model.
//
// Scene units: 1 unit = 10 mm. The board lies portrait in the XZ plane:
//   X: -2.665 (JANALOG/power side) .. +2.669 (JDIGITAL side)
//   Z: -3.43 (USB-C edge, far from camera) .. +3.43 (JSPI/QWIIC edge)
// Component positions come from the official STEP model and the official top-view
// render (Documents/ABX00162-ABX00173-datasheet.pdf), which is also used as the PCB texture.
// The bottom texture is the official back-view product photo (store.arduino.cc), mirrored so
// both textures share the same UV mapping.
// Converting from datasheet millimetres (landscape, USB-C on the left, origin bottom-left):
//   X = (y_mm - 26.65) / 10,  Z = (x_mm - 34.8) / 10

const PCB_THICKNESS = 0.16;
export const PCB_TOP = PCB_THICKNESS / 2;
const PCB_BOTTOM = -PCB_THICKNESS / 2;
const PITCH = 0.254;

const HEADER_H = 0.82; // female header height (8.5 mm)
const FEMALE_PIN_Y = PCB_TOP + HEADER_H;
const MALE_BASE_H = 0.25;
const MALE_PIN_Y = PCB_TOP + 0.6;
const BOTTOM_CONN_H = 0.4; // JMISC/JMEDIA receptacles (STEP: 5 mm)
const BOTTOM_PIN_Y = PCB_BOTTOM - BOTTOM_CONN_H - 0.01;

const PCB_EDGE_COLOR = '#16405f';
const GOLD = { color: '#d9b54a', metalness: 0.9, roughness: 0.3 };
const SILVER = { color: '#c8ccd0', metalness: 1, roughness: 0.28 };

// Texture coordinate of a board point; identical for the top and the (mirrored) bottom texture.
function texUV(x: number, z: number): [number, number] {
  return [(z * 10 + 34.3) / 68.6, (x * 10 + 26.65) / 53.3];
}

// ---------------------------------------------------------------------------
// Pin map
// ---------------------------------------------------------------------------

export type BoardPin = {
  id: string;
  pos: [number, number, number];
  label: string;
  pinType: 'female' | 'male' | 'smd' | 'bottom';
  showLabel?: boolean;
  side?: 1 | -1;
};

const DIGITAL_X = 2.487;
const ANALOG_X = -2.46;
const DIGITAL_HI_Z0 = -1.546; // D21
const DIGITAL_LO_Z0 = 1.218; // D7
const POWER_Z0 = -0.615; // BOOT
const ANALOG_Z0 = 1.725; // A0

const JCTL_X0 = 1.735;
const JCTL_Z0 = -2.128;
const JSPI_X0 = -0.118;
const JSPI_Z0 = 2.947;
const QWIIC_X0 = -1.355;
const QWIIC_Z = 3.17;
const JMEDIA_Z = -2.205;
const JMISC_Z = 2.467;
const BOTTOM_X0 = 1.842;
const BOTTOM_PITCH = 0.127;

export const PINS: BoardPin[] = (() => {
  const pins: BoardPin[] = [];

  // JDIGITAL (right edge, top to bottom)
  ['21', '20', 'AREF', 'GND', '13', '12', '11', '10', '9', '8'].forEach((lbl, i) => {
    pins.push({ id: lbl, pos: [DIGITAL_X, FEMALE_PIN_Y, DIGITAL_HI_Z0 + i * PITCH], label: lbl === '21' || lbl === '20' ? `D${lbl}` : lbl, pinType: 'female', showLabel: true, side: 1 });
  });
  ['7', '6', '5', '4', '3', '2', '1', '0'].forEach((lbl, i) => {
    pins.push({ id: lbl, pos: [DIGITAL_X, FEMALE_PIN_Y, DIGITAL_LO_Z0 + i * PITCH], label: lbl, pinType: 'female', showLabel: true, side: 1 });
  });

  // Power header (left edge)
  ['BOOT', 'IOREF', 'RESET', '3V3', '5V', 'GND_1', 'GND_2', 'VIN'].forEach((lbl, i) => {
    pins.push({ id: lbl, pos: [ANALOG_X, FEMALE_PIN_Y, POWER_Z0 + i * PITCH], label: lbl.replace('_1', '').replace('_2', ''), pinType: 'female', showLabel: true, side: -1 });
  });

  // JANALOG (A0..A5 = pins 14..19)
  ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach((lbl, i) => {
    pins.push({ id: (14 + i).toString(), pos: [ANALOG_X, FEMALE_PIN_Y, ANALOG_Z0 + i * PITCH], label: lbl, pinType: 'female', showLabel: true, side: -1 });
  });

  // JCTL (2x5, 1.8 V)
  const jctlLabels = ['VBUS', 'PMIC', 'GP13', 'GP12', 'GP95', '1V8', 'GND_J1', 'V_UP', 'V_DN', 'GND_J2'];
  const jctlNames = ['VBUS_DISABLE', 'PMIC_RESET', 'GPIO_13 / SE4_RX', 'GPIO_12 / SE4_TX', 'GPIO_95 / USB_BOOT', '+1V8', 'GND', 'VOL_UP', 'VOL_DOWN', 'GND'];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const idx = r * 5 + c;
      pins.push({ id: `JCTL_${jctlLabels[idx]}`, pos: [JCTL_X0 + r * PITCH, MALE_PIN_Y, JCTL_Z0 + c * PITCH], label: `JCTL ${jctlNames[idx]}`, pinType: 'male' });
    }
  }

  // QWIIC (JST SH, 1 mm pitch)
  ['GND', '3V3', 'SDA', 'SCL'].forEach((lbl, i) => {
    pins.push({ id: `QW_${lbl}`, pos: [QWIIC_X0 + i * 0.1, PCB_TOP + 0.3, QWIIC_Z], label: `QWIIC ${lbl}`, pinType: 'smd' });
  });

  // JMISC / JMEDIA (bottom side, 2x30). Pins 1/2 at the JDIGITAL end, even pins towards USB-C.
  const jmiscOdd = ['PC6', 'PC7', 'PD5', 'PC9', 'PB4', 'PH4', 'PH5', 'PD7', 'PD9', 'PH6', 'PD8', 'PA5', 'PA10', 'GND', 'MIC2_P', 'MIC2_N', 'M_BIAS', 'GND', 'S_G0', 'S_G1', 'S_G2', 'S_G3', 'S_G5', 'S_G62', 'S_G10', 'S_G20', '3V3', '3V3', '1V8', 'VDDIN'];
  const jmiscEven = ['CMD', 'T_CLK', 'T_D0', 'T_D2', 'T_D3', 'PE7', 'PE8', 'I2C4_C', 'I2C4_D', 'OPA_O', 'OPA_P', 'OPA_N', 'GND', 'EAR_P', 'EAR_N', 'LOUT_P', 'LOUT_N', 'HPH_L', 'HPH_R', 'H_REF', 'HS_D', 'GND', 'S_G98', 'S_G99', 'S_G100', 'S_G101', '5V', '5V', 'GND', 'VBAT'];
  const jmediaOdd = ['GND', 'DSI_C_M', 'DSI_C_P', 'GND', 'DSI_2_M', 'DSI_2_P', 'GND', 'DSI_3_M', 'DSI_3_P', 'GND', 'CSI_C0_M', 'CSI_D0_P', 'GND', 'CSI_D1_M', 'CSI_A1_P', 'GND', 'CSI_A0_M', 'CSI_A0_P', 'GND', 'CSI_A2_M', 'CSI_C1_P', 'GND', 'CSI_C2_M', 'CSI_D2_P', 'GND', 'I2C0_C', 'I2C0_D', 'GND', 'VIN', 'VIN'];
  const jmediaEven = ['GND', 'DSI_1_P', 'DSI_1_M', 'GND', 'DSI_0_P', 'DSI_0_M', 'GND', 'CAM_M0', 'CAM_M1', 'GND', 'I2C1_D', 'I2C1_C', 'GND', 'CSI_D2_P', 'CSI_C2_M', 'GND', 'CSI_C1_P', 'CSI_A2_M', 'GND', 'CSI_A0_P', 'CSI_A0_M', 'GND', 'CSI_A1_P', 'CSI_D1_M', 'GND', 'CSI_D0_P', 'CSI_C0_M', 'GND', '3V3', '3V3'];
  const addBottom = (name: string, zc: number, odd: string[], even: string[]) => {
    for (let i = 0; i < 30; i++) {
      const x = BOTTOM_X0 - i * BOTTOM_PITCH;
      pins.push({ id: `${name}_${i * 2 + 1}`, pos: [x, BOTTOM_PIN_Y, zc + 0.07], label: `${name} ${i * 2 + 1}: ${odd[i]}`, pinType: 'bottom' });
      pins.push({ id: `${name}_${i * 2 + 2}`, pos: [x, BOTTOM_PIN_Y, zc - 0.07], label: `${name} ${i * 2 + 2}: ${even[i]}`, pinType: 'bottom' });
    }
  };
  addBottom('JMISC', JMISC_Z, jmiscOdd, jmiscEven);
  addBottom('JMEDIA', JMEDIA_Z, jmediaOdd, jmediaEven);

  // JSPI (2x3): row 0 RST/SCK/MISO, row 1 GND/MOSI/5V
  const jspiGrid = [['RST', 'SCK', 'MISO'], ['GND', 'MOSI', '5V']];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const lbl = jspiGrid[r][c];
      pins.push({ id: `SPI2_${lbl}`, pos: [JSPI_X0 + c * PITCH, MALE_PIN_Y, JSPI_Z0 + r * PITCH], label: `JSPI ${lbl}`, pinType: 'male' });
    }
  }

  return pins;
})();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let glowTexture: THREE.Texture | null = null;
function getGlowTexture() {
  if (!glowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  return glowTexture;
}

// Flat additive halo lying just above the board, to fake LED bloom.
function Glow({ position, size, color, opacity }: { position: [number, number, number]; size: number; color: THREE.ColorRepresentation; opacity: number }) {
  if (opacity <= 0) return null;
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={getGlowTexture()} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// A raised block whose outer face shows the matching region of the board texture (chips, modules).
// With `bottom` it hangs under the PCB and uses its -Y face.
function TexturedBlock({ tex, x0, x1, z0, z1, h, side = '#1d1d1f', metal = false, bottom = false }: { tex: THREE.Texture; x0: number; x1: number; z0: number; z1: number; h: number; side?: string; metal?: boolean; bottom?: boolean }) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const face = bottom ? 3 : 2; // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = face * 4; i < face * 4 + 4; i++) {
      const [u, v] = texUV(cx + p.getX(i), cz + p.getZ(i));
      uv.setXY(i, u, v);
    }
    return g;
  }, [x0, x1, z0, z1, h, cx, cz, face]);
  return (
    <mesh geometry={geo} position={[cx, bottom ? PCB_BOTTOM - h / 2 : PCB_TOP + h / 2, cz]}>
      {[0, 1, 2, 3, 4, 5].map(i => i === face
        ? <meshStandardMaterial key={i} attach={`material-${i}`} map={tex} roughness={metal ? 0.35 : 0.6} metalness={metal ? 0.5 : 0.1} />
        : <meshStandardMaterial key={i} attach={`material-${i}`} color={side} roughness={metal ? 0.3 : 0.7} metalness={metal ? 0.9 : 0.1} />)}
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Board parts
// ---------------------------------------------------------------------------

function PCB({ tex, bottomTex }: { tex: THREE.Texture; bottomTex: THREE.Texture }) {
  const { body, top } = useMemo(() => {
    const shape = new THREE.Shape(PCB_OUTLINE.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = PCB_HOLES.map(h => new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const body = new THREE.ExtrudeGeometry(shape, { depth: PCB_THICKNESS, bevelEnabled: false });
    const top = new THREE.ShapeGeometry(shape);
    const p = top.attributes.position;
    const uv = top.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const [u, v] = texUV(p.getX(i), -p.getY(i));
      uv.setXY(i, u, v);
    }
    return { body, top };
  }, []);

  return (
    <group>
      <mesh geometry={body} rotation={[-Math.PI / 2, 0, 0]} position={[0, PCB_BOTTOM, 0]}>
        <meshStandardMaterial color={PCB_EDGE_COLOR} roughness={0.6} />
      </mesh>
      <mesh geometry={top} rotation={[-Math.PI / 2, 0, 0]} position={[0, PCB_TOP + 0.0005, 0]}>
        <meshStandardMaterial map={tex} roughness={0.5} metalness={0.05} />
      </mesh>
      {/* same UVs, seen from below */}
      <mesh geometry={top} rotation={[-Math.PI / 2, 0, 0]} position={[0, PCB_BOTTOM - 0.0005, 0]}>
        <meshStandardMaterial map={bottomTex} side={THREE.BackSide} roughness={0.5} metalness={0.05} />
      </mesh>
    </group>
  );
}

function FemaleHeader({ x, z0, count }: { x: number; z0: number; count: number }) {
  const len = count * PITCH;
  const zc = z0 + (count - 1) * PITCH / 2;
  return (
    <group>
      <Box args={[PITCH, HEADER_H, len]} position={[x, PCB_TOP + HEADER_H / 2, zc]}>
        <meshStandardMaterial color="#2a2928" roughness={0.65} />
      </Box>
      {Array.from({ length: count }).map((_, i) => (
        <group key={i} position={[x, FEMALE_PIN_Y, z0 + i * PITCH]}>
          {/* tapered entry + hole */}
          <Box args={[0.2, 0.004, 0.2]} position={[0, 0.002, 0]}><meshStandardMaterial color="#4a4846" roughness={0.5} /></Box>
          <Box args={[0.1, 0.006, 0.1]} position={[0, 0.003, 0]}><meshStandardMaterial color="#050505" roughness={1} /></Box>
        </group>
      ))}
    </group>
  );
}

function MalePin({ x, z }: { x: number; z: number }) {
  return (
    <Box args={[0.064, MALE_PIN_Y - PCB_TOP, 0.064]} position={[x, (MALE_PIN_Y + PCB_TOP) / 2, z]}>
      <meshStandardMaterial {...GOLD} />
    </Box>
  );
}

function JctlHeader() {
  const xc = JCTL_X0 + PITCH / 2;
  const zc = JCTL_Z0 + 2 * PITCH;
  return (
    <group>
      <Box args={[0.5, 0.2, 1.27]} position={[xc, PCB_TOP + 0.1, zc]}>
        <meshStandardMaterial color="#45423f" roughness={0.6} />
      </Box>
      {[0, 1].map(r => [0, 1, 2, 3, 4].map(c => {
        const x = JCTL_X0 + r * PITCH;
        const z = JCTL_Z0 + c * PITCH;
        return (
          <group key={`${r}-${c}`}>
            <MalePin x={x} z={z} />
            {/* SMD foot */}
            <Box args={[0.16, 0.02, 0.06]} position={[xc + (r === 0 ? -0.3 : 0.3), PCB_TOP + 0.01, z]}>
              <meshStandardMaterial {...SILVER} />
            </Box>
          </group>
        );
      }))}
    </group>
  );
}

function JspiHeader() {
  const xc = JSPI_X0 + PITCH;
  const zc = JSPI_Z0 + PITCH / 2;
  return (
    <group>
      <Box args={[0.76, MALE_BASE_H, 0.5]} position={[xc, PCB_TOP + MALE_BASE_H / 2, zc]}>
        <meshStandardMaterial color="#3a3836" roughness={0.6} />
      </Box>
      {[0, 1].map(r => [0, 1, 2].map(c => <MalePin key={`${r}-${c}`} x={JSPI_X0 + c * PITCH} z={JSPI_Z0 + r * PITCH} />))}
    </group>
  );
}

function QwiicConnector() {
  const xc = QWIIC_X0 + 0.15;
  return (
    <group>
      <Box args={[0.62, 0.3, 0.44]} position={[xc, PCB_TOP + 0.15, QWIIC_Z + 0.02]}>
        <meshStandardMaterial color="#ece8de" roughness={0.55} />
      </Box>
      {/* mating opening facing the board edge */}
      <Box args={[0.46, 0.16, 0.02]} position={[xc, PCB_TOP + 0.15, QWIIC_Z + 0.235]}>
        <meshStandardMaterial color="#6d6a63" roughness={0.8} />
      </Box>
      {[0, 1, 2, 3].map(i => (
        <Box key={i} args={[0.04, 0.02, 0.14]} position={[QWIIC_X0 + i * 0.1, PCB_TOP + 0.01, QWIIC_Z - 0.26]}>
          <meshStandardMaterial {...SILVER} />
        </Box>
      ))}
      {[-1, 1].map(s => (
        <Box key={s} args={[0.08, 0.12, 0.18]} position={[xc + s * 0.36, PCB_TOP + 0.06, QWIIC_Z + 0.08]}>
          <meshStandardMaterial {...SILVER} />
        </Box>
      ))}
    </group>
  );
}

function UsbC() {
  return (
    <group position={[1.118, PCB_TOP + 0.16, -3.05]}>
      <RoundedBox args={[0.894, 0.32, 0.82]} radius={0.15} smoothness={4}>
        <meshStandardMaterial {...SILVER} />
      </RoundedBox>
      <RoundedBox args={[0.8, 0.24, 0.02]} radius={0.11} smoothness={4} position={[0, 0, -0.405]}>
        <meshStandardMaterial color="#0c0c0c" roughness={0.9} />
      </RoundedBox>
      <Box args={[0.6, 0.06, 0.02]} position={[0, 0, -0.41]}>
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
      </Box>
    </group>
  );
}

function PowerButton() {
  return (
    <group position={[2.285, PCB_TOP, -2.86]}>
      <Box args={[0.62, 0.15, 0.62]} position={[0, 0.075, 0]}>
        <meshStandardMaterial color="#d6d8da" metalness={0.6} roughness={0.35} />
      </Box>
      <Cylinder args={[0.17, 0.17, 0.07, 32]} position={[0, 0.185, 0]}>
        <meshStandardMaterial color="#f4f4f2" roughness={0.4} />
      </Cylinder>
      {[[-0.22, -0.38], [0.22, -0.38], [-0.22, 0.38], [0.22, 0.38], [0, 0.38]].map(([x, z], i) => (
        <Box key={i} args={[0.12, 0.03, 0.12]} position={[x, 0.015, z]}>
          <meshStandardMaterial {...SILVER} />
        </Box>
      ))}
    </group>
  );
}

function PowerLed() {
  const pos: [number, number, number] = [0.545, PCB_TOP + 0.025, -3.17];
  return (
    <group>
      <Box args={[0.08, 0.05, 0.16]} position={pos}>
        <meshStandardMaterial color="#9dff9d" emissive="#22ff44" emissiveIntensity={1.6} toneMapped={false} />
      </Box>
      <Glow position={[pos[0], PCB_TOP + 0.06, pos[2]]} size={0.5} color="#33ff55" opacity={0.6} />
    </group>
  );
}

function RgbLed({ position, colorArr }: { position: [number, number, number]; colorArr: number[] }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const on = colorArr[0] > 0 || colorArr[1] > 0 || colorArr[2] > 0;
  const glowColor = useMemo(() => new THREE.Color(colorArr[0] / 255, colorArr[1] / 255, colorArr[2] / 255), [colorArr]);
  useFrame(() => {
    if (!ref.current) return;
    const target = on ? glowColor : new THREE.Color('#000000');
    ref.current.emissive.lerp(target, 0.15);
    ref.current.color.lerp(on ? glowColor.clone().lerp(new THREE.Color('#ffffff'), 0.4) : new THREE.Color('#e9e7e1'), 0.15);
  });
  return (
    <group>
      <Box args={[0.1, 0.06, 0.1]} position={[position[0], PCB_TOP + 0.03, position[2]]}>
        <meshStandardMaterial ref={ref} color="#e9e7e1" emissiveIntensity={2.5} roughness={0.4} toneMapped={false} />
      </Box>
      <Glow position={[position[0], PCB_TOP + 0.07, position[2]]} size={0.45} color={glowColor} opacity={on ? 0.9 : 0} />
    </group>
  );
}

// 8 x 13 blue matrix. Row 0 is the row nearest JDIGITAL, column 0 the one nearest USB-C,
// i.e. the frame reads correctly when the board is viewed with USB-C on the left.
function LedMatrix({ frame }: { frame: number[][] }) {
  const dots = useMemo(() => {
    const d: { r: number; c: number; x: number; z: number }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 13; c++) {
        d.push({ r, c, x: -0.708 - r * 0.2, z: -0.213 + c * 0.2107 });
      }
    }
    return d;
  }, []);
  return (
    <group>
      {dots.map(dot => {
        const isOn = frame?.[dot.r]?.[dot.c] === 1;
        return (
          <group key={`${dot.r}-${dot.c}`} position={[dot.x, PCB_TOP, dot.z]}>
            <Box args={[0.16, 0.035, 0.08]} position={[0, 0.0175, 0]} rotation={[0, -Math.PI / 4, 0]}>
              <meshStandardMaterial
                color={isOn ? '#bfe0ff' : '#e6e4dc'}
                emissive={isOn ? '#1c7cff' : '#000000'}
                emissiveIntensity={isOn ? 3 : 0}
                roughness={0.45}
                toneMapped={!isOn}
              />
            </Box>
            {isOn && <Glow position={[0, 0.045, 0]} size={0.34} color="#2a7fff" opacity={0.7} />}
          </group>
        );
      })}
    </group>
  );
}

// 2x30 1.27 mm female receptacle on the bottom side, with its SMD leads soldered on both sides.
function BottomConnector({ zc }: { zc: number }) {
  const xc = BOTTOM_X0 - 29 * BOTTOM_PITCH / 2;
  const len = 30 * BOTTOM_PITCH + 0.06;
  const face = PCB_BOTTOM - BOTTOM_CONN_H;
  return (
    <group>
      <Box args={[len, BOTTOM_CONN_H, 0.32]} position={[xc, PCB_BOTTOM - BOTTOM_CONN_H / 2, zc]}>
        <meshStandardMaterial color="#4a4948" roughness={0.75} />
      </Box>
      {Array.from({ length: 30 }).map((_, i) => {
        const x = BOTTOM_X0 - i * BOTTOM_PITCH;
        return (
          <group key={i}>
            {[1, -1].map(side => (
              <group key={side}>
                {/* socket opening */}
                <Box args={[0.075, 0.004, 0.075]} position={[x, face - 0.002, zc + side * 0.067]}>
                  <meshStandardMaterial color="#0a0a0a" roughness={1} />
                </Box>
                {/* contact visible inside the socket */}
                <Box args={[0.02, 0.003, 0.05]} position={[x, face - 0.004, zc + side * 0.067]}>
                  <meshStandardMaterial {...GOLD} />
                </Box>
                {/* SMD lead (odd pins on +Z, even pins on -Z) */}
                <Box args={[0.05, 0.016, 0.15]} position={[x, PCB_BOTTOM - 0.008, zc + side * 0.235]}>
                  <meshStandardMaterial {...GOLD} />
                </Box>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// Through-hole leads of the top headers, sticking out under the board with their solder joints.
function ThroughHoleLeads() {
  const leads = PINS.filter(p => p.pinType === 'female' || p.id.startsWith('SPI2_'));
  return (
    <group>
      {leads.map(p => (
        <group key={p.id} position={[p.pos[0], PCB_BOTTOM, p.pos[2]]}>
          <Cylinder args={[0.085, 0.05, 0.035, 16]} position={[0, -0.0175, 0]}>
            <meshStandardMaterial color="#d4d6d8" metalness={0.95} roughness={0.25} />
          </Cylinder>
          <Box args={[0.064, 0.14, 0.064]} position={[0, -0.07, 0]}>
            <meshStandardMaterial color="#c9cbcd" metalness={1} roughness={0.3} />
          </Box>
        </group>
      ))}
    </group>
  );
}

function BottomSide({ tex }: { tex: THREE.Texture }) {
  return (
    <group>
      <BottomConnector zc={JMISC_Z} />
      <BottomConnector zc={JMEDIA_Z} />
      <ThroughHoleLeads />
      <TexturedBlock tex={tex} bottom x0={-0.718} x1={0.571} z0={0.715} z1={1.85} h={0.1} />{/* eMMC */}
      <TexturedBlock tex={tex} bottom x0={-1.834} x1={-1.128} z0={0.63} z1={1.315} h={0.08} />{/* STM32U585 */}
    </group>
  );
}

// Clickable pin: invisible until hovered/selected; shows its name on hover.
function PinHitbox({ pin, selected, onClick, onRightClick }: { pin: BoardPin; selected: boolean; onClick: () => void; onRightClick: () => void }) {
  const [hover, setHover] = useState(false);
  const size: [number, number, number] =
    pin.pinType === 'female' ? [0.22, 0.06, 0.22] :
    pin.pinType === 'male' ? [0.12, 0.14, 0.12] :
    pin.pinType === 'smd' ? [0.08, 0.06, 0.12] :
    [0.11, 0.05, 0.12];
  const active = hover || selected;
  return (
    <group position={pin.pos}>
      <mesh
        onClick={e => { e.stopPropagation(); onClick(); }}
        onContextMenu={e => { e.stopPropagation(); onRightClick(); }}
        onPointerOver={e => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={selected ? '#00ff66' : '#ffd700'}
          emissive={selected ? '#00ff66' : '#ff9900'}
          emissiveIntensity={0.8}
          transparent
          opacity={active ? 0.75 : 0}
          depthWrite={false}
        />
      </mesh>
      {hover && !pin.showLabel && (
        <Html position={[0, 0.12, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(15,18,24,0.9)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap', border: '1px solid #00979d' }}>
            {pin.label}
          </div>
        </Html>
      )}
    </group>
  );
}

function HeaderLabels() {
  return (
    <group>
      {PINS.filter(p => p.showLabel).map(p => (
        <Text
          font={SILK_FONT}
          key={p.id}
          position={[p.pos[0] + (p.side ?? 1) * 0.2, PCB_TOP + 0.002, p.pos[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={p.label.length > 3 ? 0.065 : 0.09}
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

export function UnoQBoard({ matrixFrame, rgb1, rgb2, rgb3, rgb4, onPinClick, onPinRightClick, selectedPin }: any) {
  const [tex, bottomTex] = useLoader(THREE.TextureLoader, [topTextureUrl, bottomTextureUrl]);
  useMemo(() => {
    for (const t of [tex, bottomTex]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
    }
  }, [tex, bottomTex]);

  return (
    <group>
      <PCB tex={tex} bottomTex={bottomTex} />

      {/* Chips and modules (top faces textured from the render) */}
      <TexturedBlock tex={tex} x0={-2.075} x1={-0.475} z0={-2.88} z1={-1.68} h={0.2} side="#b9bec2" metal />{/* WCBN3536A Wi-Fi/BT module */}
      <TexturedBlock tex={tex} x0={1.025} x1={2.025} z0={-0.72} z1={0.73} h={0.1} />{/* LPDDR4X */}
      <TexturedBlock tex={tex} x0={-0.285} x1={0.915} z0={-0.62} z1={0.62} h={0.1} />{/* QRB2210 */}
      <TexturedBlock tex={tex} x0={0.705} x1={1.535} z0={1.49} z1={2.15} h={0.1} />{/* PM4125 */}
      <TexturedBlock tex={tex} x0={0.735} x1={1.135} z0={-2.02} z1={-1.62} h={0.08} />{/* ANX7625 */}
      <TexturedBlock tex={tex} x0={-1.545} x1={-0.955} z0={-1.06} z1={-0.46} h={0.1} side="#a9adb1" metal />

      <UsbC />
      <PowerButton />
      <PowerLed />

      <FemaleHeader x={DIGITAL_X} z0={DIGITAL_HI_Z0} count={10} />
      <FemaleHeader x={DIGITAL_X} z0={DIGITAL_LO_Z0} count={8} />
      <FemaleHeader x={ANALOG_X} z0={POWER_Z0} count={8} />
      <FemaleHeader x={ANALOG_X} z0={ANALOG_Z0} count={6} />
      <JctlHeader />
      <JspiHeader />
      <QwiicConnector />

      <LedMatrix frame={matrixFrame} />
      <RgbLed position={[1.555, 0, 3.08]} colorArr={rgb1} />
      <RgbLed position={[1.745, 0, 3.08]} colorArr={rgb2} />
      <RgbLed position={[1.935, 0, 3.08]} colorArr={rgb3} />
      <RgbLed position={[2.125, 0, 3.08]} colorArr={rgb4} />

      <BottomSide tex={bottomTex} />
      <HeaderLabels />

      {PINS.map(p => (
        <PinHitbox
          key={p.id}
          pin={p}
          selected={selectedPin?.compId === 'BOARD' && selectedPin?.pinId === p.id}
          onClick={() => onPinClick('BOARD', p.id)}
          onRightClick={() => onPinRightClick('BOARD', p.id)}
        />
      ))}
    </group>
  );
}
