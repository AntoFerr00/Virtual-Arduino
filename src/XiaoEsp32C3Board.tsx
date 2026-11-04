import { useMemo } from 'react';
import { Box, Cylinder, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { BoardPin, PinHitbox, SILK_FONT } from './UnoQBoard';

// Seeed Studio XIAO ESP32C3 3D model.
//
// Scene units: 1 unit = 10 mm. The board lies in the XZ plane with the USB-C connector at -Z:
//   X: -0.89 (D0-D6 side) .. +0.89 (5V/GND/3V3/D10-D7 side)
//   Z: -1.05 (USB-C end) .. +1.05 (antenna connector end)
// Dimensions from the published drawing: 21 x 17.8 mm PCB, 2 rows of 7 castellated pads at
// 2.54 mm pitch, 15.24 mm (0.6") apart, so it sits across a breadboard like the Nano. BAT+ / BAT-
// are pads under the board. There is no official render in Documents/ for this board, so the
// PCB and shield artwork is drawn on canvases rather than taken from a photo.

const PCB_W = 1.78;
const PCB_L = 2.1;
const PCB_THICKNESS = 0.12;
const HEADER_H = 0.25; // male header plastic the board sits on
export const XIAO_PCB_TOP = HEADER_H + PCB_THICKNESS;
const PITCH = 0.254;
const ROW_X = 0.762;
const PIN_Z0 = -0.762; // first pin, next to USB-C
const PIN_Y = XIAO_PCB_TOP + 0.06;
const BAT_Z = 0.5;
const BAT_X = 0.26;

const GOLD = { color: '#d9b54a', metalness: 0.9, roughness: 0.3 };
const SILVER = { color: '#c8ccd0', metalness: 1, roughness: 0.28 };

// ---------------------------------------------------------------------------
// Pin map: ids are ESP32-C3 GPIO numbers (Arduino-ESP32 XIAO_ESP32C3 variant)
// ---------------------------------------------------------------------------

const LEFT_ROW: [string, string][] = [
  ['2', 'D0/A0'], ['3', 'D1/A1'], ['4', 'D2/A2'], ['5', 'D3/A3'], ['6', 'D4/SDA'], ['7', 'D5/SCL'], ['21', 'D6/TX'],
];
const RIGHT_ROW: [string, string][] = [
  ['5V', '5V'], ['GND', 'GND'], ['3V3', '3V3'], ['10', 'D10/MOSI'], ['9', 'D9/MISO'], ['8', 'D8/SCK'], ['20', 'D7/RX'],
];

export const XIAO_PINS: BoardPin[] = [
  ...LEFT_ROW.map(([id, label], i) => ({ id, label, pos: [-ROW_X, PIN_Y, PIN_Z0 + i * PITCH] as [number, number, number], pinType: 'pad' as const, showLabel: true, side: -1 as const })),
  ...RIGHT_ROW.map(([id, label], i) => ({ id, label, pos: [ROW_X, PIN_Y, PIN_Z0 + i * PITCH] as [number, number, number], pinType: 'pad' as const, showLabel: true, side: 1 as const })),
  // Battery pads on the underside (charger input / output, 1S LiPo)
  { id: 'BAT+', label: 'BAT+', pos: [BAT_X, HEADER_H - 0.015, BAT_Z], pinType: 'bottom' },
  { id: 'BAT-', label: 'BAT-', pos: [-BAT_X, HEADER_H - 0.015, BAT_Z], pinType: 'bottom' },
];

// ---------------------------------------------------------------------------
// Canvas artwork
// ---------------------------------------------------------------------------

const PX = 400; // canvas pixels per scene unit (40 px/mm)

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Top of the PCB, seen from above with the USB-C end at the top of the image.
function drawTop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#17191d';
  ctx.fillRect(0, 0, w, h);
  const cx = (x: number) => (x + PCB_W / 2) * PX;
  const cy = (z: number) => (z + PCB_L / 2) * PX;
  ctx.textBaseline = 'middle';
  ctx.font = '600 24px "Roboto Mono", monospace';
  for (const [rows, x, align] of [[LEFT_ROW, -ROW_X, 'left'], [RIGHT_ROW, ROW_X, 'right']] as const) {
    rows.forEach(([, label], i) => {
      const px = cx(x), py = cy(PIN_Z0 + i * PITCH);
      const edge = x < 0 ? 0 : w;
      // castellated pad: copper from the hole to the board edge, half hole cut at the edge
      ctx.fillStyle = '#d9b54a';
      ctx.fillRect(Math.min(px, edge), py - 34, Math.abs(px - edge), 68);
      ctx.beginPath(); ctx.arc(px, py, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b0b0d';
      ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(edge, py, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2f2f2';
      ctx.textAlign = align;
      ctx.fillText(label.split('/')[0], x < 0 ? px + 46 : px - 46, py);
    });
  }
  // silkscreen around the parts that are modelled in 3D
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx(-0.55), cy(-0.41), cx(0.55) - cx(-0.55), cy(0.69) - cy(-0.41)); // shield
  ctx.fillStyle = '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.font = '600 22px "Roboto Mono", monospace';
  ctx.fillText('B', cx(-0.55), cy(-0.45));
  ctx.fillText('R', cx(0.55), cy(-0.45));
  ctx.fillText('CHG', cx(0.25), cy(-0.43));
  ctx.font = '600 20px "Roboto Mono", monospace';
  ctx.fillText('Seeed Studio', cx(-0.12), cy(0.92));
}

// Shield can: brushed metal with the laser-etched markings.
function drawShield(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d6d9dc');
  g.addColorStop(1, '#b8bcc0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5b5f64';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 92px "Roboto Mono", monospace';
  ctx.fillText('XIAO', w / 2, h * 0.32);
  ctx.font = '700 46px "Roboto Mono", monospace';
  ctx.fillText('ESP32C3', w / 2, h * 0.53);
  ctx.font = '500 28px "Roboto Mono", monospace';
  ctx.fillText('Seeed Studio', w / 2, h * 0.7);
  ctx.font = '500 22px "Roboto Mono", monospace';
  ctx.fillText('FCC  CE  RoHS', w / 2, h * 0.85);
}

// Underside, seen from below (mirrored so the text reads correctly when looking up).
function drawBottom(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#17191d';
  ctx.fillRect(0, 0, w, h);
  const cx = (x: number) => (PCB_W / 2 - x) * PX;
  const cy = (z: number) => (z + PCB_L / 2) * PX;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [x, label] of [[BAT_X, 'BAT+'], [-BAT_X, 'BAT-']] as const) {
    ctx.fillStyle = '#d9b54a';
    ctx.fillRect(cx(x) - 40, cy(BAT_Z) - 28, 80, 56);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = '600 26px "Roboto Mono", monospace';
    ctx.fillText(label, cx(x), cy(BAT_Z) + 62);
  }
  ctx.font = '700 34px "Roboto Mono", monospace';
  ctx.fillText('XIAO ESP32C3', w / 2, cy(-0.35));
}

// Box with a canvas on its top (+Y) or bottom (-Y) face, mapped by world position.
function ArtBox({ tex, x0, x1, z0, z1, y0, h, side, face = 'top', metal = false, mirror = false }: {
  tex: THREE.Texture; x0: number; x1: number; z0: number; z1: number; y0: number; h: number; side: string;
  face?: 'top' | 'bottom'; metal?: boolean; mirror?: boolean;
}) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const idx = face === 'top' ? 2 : 3; // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = idx * 4; i < idx * 4 + 4; i++) {
      const u = (cx + p.getX(i) - x0) / (x1 - x0);
      uv.setXY(i, mirror ? 1 - u : u, 1 - (cz + p.getZ(i) - z0) / (z1 - z0));
    }
    return g;
  }, [x0, x1, z0, z1, h, cx, cz, idx, mirror]);
  return (
    <mesh geometry={geo} position={[cx, y0 + h / 2, cz]}>
      {[0, 1, 2, 3, 4, 5].map(i => i === idx
        ? <meshStandardMaterial key={i} attach={`material-${i}`} map={tex} roughness={metal ? 0.35 : 0.6} metalness={metal ? 0.6 : 0.05} />
        : <meshStandardMaterial key={i} attach={`material-${i}`} color={side} roughness={metal ? 0.3 : 0.7} metalness={metal ? 0.9 : 0.1} />)}
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function Headers() {
  return (
    <group>
      {[-ROW_X, ROW_X].map(x => (
        <group key={x}>
          <Box args={[PITCH, HEADER_H, PITCH * 7]} position={[x, HEADER_H / 2, PIN_Z0 + PITCH * 3]}>
            <meshStandardMaterial color="#1c1c1c" roughness={0.7} />
          </Box>
          {Array.from({ length: 7 }).map((_, i) => (
            <group key={i} position={[x, XIAO_PCB_TOP, PIN_Z0 + i * PITCH]}>
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
    <group position={[0, XIAO_PCB_TOP + 0.16, -0.93]}>
      <RoundedBox args={[0.894, 0.32, 0.74]} radius={0.15} smoothness={4}>
        <meshStandardMaterial {...SILVER} />
      </RoundedBox>
      <RoundedBox args={[0.8, 0.24, 0.02]} radius={0.11} smoothness={4} position={[0, 0, -0.365]}>
        <meshStandardMaterial color="#0c0c0c" roughness={0.9} />
      </RoundedBox>
      <Box args={[0.6, 0.06, 0.02]} position={[0, 0, -0.37]}>
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
      </Box>
    </group>
  );
}

// BOOT (B) and RESET (R) tactile switches, either side of the USB-C connector.
function TactSwitch({ x }: { x: number }) {
  return (
    <group position={[x, XIAO_PCB_TOP, -0.62]}>
      <Box args={[0.3, 0.09, 0.18]} position={[0, 0.045, 0]}>
        <meshStandardMaterial color="#d6d8da" metalness={0.6} roughness={0.35} />
      </Box>
      <Box args={[0.14, 0.05, 0.1]} position={[0, 0.115, 0]}>
        <meshStandardMaterial color="#f4f4f2" roughness={0.4} />
      </Box>
    </group>
  );
}

// u.FL connector for the external 2.4 GHz antenna.
function AntennaConnector() {
  return (
    <group position={[0.52, XIAO_PCB_TOP, 0.86]}>
      <Box args={[0.26, 0.04, 0.26]} position={[0, 0.02, 0]}>
        <meshStandardMaterial {...GOLD} />
      </Box>
      <Cylinder args={[0.1, 0.1, 0.1, 24]} position={[0, 0.09, 0]}>
        <meshStandardMaterial {...GOLD} />
      </Cylinder>
      <Cylinder args={[0.035, 0.035, 0.11, 12]} position={[0, 0.1, 0]}>
        <meshStandardMaterial color="#f4f4f2" roughness={0.5} />
      </Cylinder>
    </group>
  );
}

function Passives() {
  const parts: [number, number, number, number, string][] = [
    // x, z, width (x), length (z), colour
    [-0.12, -0.5, 0.28, 0.15, '#1d1d1f'], // ME6211 LDO
    [0.12, -0.5, 0.08, 0.16, '#b08a52'],
    [-0.72, 0.86, 0.16, 0.08, '#b08a52'],
    [-0.3, 0.86, 0.3, 0.18, '#1d1d1f'], // charger IC
    [0.05, 0.86, 0.08, 0.16, '#b08a52'],
  ];
  return (
    <group>
      {parts.map(([x, z, w, l, color], i) => (
        <Box key={i} args={[w, 0.05, l]} position={[x, XIAO_PCB_TOP + 0.025, z]}>
          <meshStandardMaterial color={color} roughness={0.6} />
        </Box>
      ))}
    </group>
  );
}

function PinLabels() {
  return (
    <group>
      {XIAO_PINS.filter(p => p.showLabel).map(p => (
        <Text
          key={p.id}
          font={SILK_FONT}
          position={[p.pos[0] + (p.side ?? 1) * 0.2, 0.01, p.pos[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={p.label.length > 5 ? 0.06 : 0.075}
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

// The XIAO ESP32C3 has no user LED: its charge LED (CHG) is driven by the charger, not the MCU.
export function XiaoEsp32C3Board({ onPinClick, onPinRightClick, selectedPin }: any) {
  const textures = useMemo(() => ({
    top: canvasTexture(drawTop, Math.round(PCB_W * PX), Math.round(PCB_L * PX)),
    bottom: canvasTexture(drawBottom, Math.round(PCB_W * PX), Math.round(PCB_L * PX)),
    shield: canvasTexture(drawShield, 520, 540),
  }), []);

  return (
    <group>
      <Headers />
      {/* PCB: artwork on top and bottom */}
      <ArtBox tex={textures.top} x0={-PCB_W / 2} x1={PCB_W / 2} z0={-PCB_L / 2} z1={PCB_L / 2} y0={HEADER_H} h={PCB_THICKNESS} side="#17191d" />
      <ArtBox tex={textures.bottom} x0={-PCB_W / 2} x1={PCB_W / 2} z0={-PCB_L / 2} z1={PCB_L / 2} y0={HEADER_H - 0.001} h={0.001} side="#17191d" face="bottom" mirror />
      {/* RF shield over the ESP32-C3 and its flash */}
      <ArtBox tex={textures.shield} x0={-0.52} x1={0.52} z0={-0.38} z1={0.66} y0={XIAO_PCB_TOP} h={0.16} side="#b9bec2" metal />
      <UsbC />
      <TactSwitch x={-0.55} />
      <TactSwitch x={0.55} />
      {/* CHG LED, off: the simulation powers the board from USB with no battery charging */}
      <Box args={[0.08, 0.04, 0.12]} position={[0.25, XIAO_PCB_TOP + 0.02, -0.55]}>
        <meshStandardMaterial color="#e9e7e1" />
      </Box>
      <AntennaConnector />
      <Passives />
      <PinLabels />

      {XIAO_PINS.map(p => (
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
