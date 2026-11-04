import { useEffect, useRef } from 'react';
import type { ExternalComponent } from './App';
import type { CompResult, SimOutput, SimWarning } from './circuit/simulator';
import { LED_COLORS, LED, RESISTOR_P_MAX, POT_P_MAX, BJT, DIODE, LIPO, ESC, IMU, ELRS, SERVO_MODELS, servoOf, SERVO_PULSE, lipoOf, FSR, NEOPIXEL, VIBRO } from './circuit/components';
import { formatSI } from './circuit/units';
import { WIRE_COLORS } from './wireColors';

const VALUE_LABEL: Partial<Record<string, string>> = {
  Resistor: 'Resistance',
  Potentiometer: 'Total resistance',
  Capacitor: 'Capacitance (≥ 1 µF = polarised electrolytic)',
  Inductor: 'Inductance',
  LiPo: 'Cells, charge and capacity (e.g. 4S 3.9V, or 1S 3.9V 200mAh)',
  ESC: 'Prop direction and full-throttle current (e.g. CW 15A, CCW 15A)',
  FSR: 'Force while you hold it down (e.g. 2 kg, 300 g)',
};

// Part-specific readings shown under voltage / current / power.
const EXTRA_ROWS: Record<string, [label: string, format: (v: number) => string]> = {
  ib: ['Base current', v => formatSI(v, 'A')],
  vcell: ['Per cell', v => formatSI(v, 'V')],
  throttle: ['Throttle', v => `${Math.round(v * 100)}%`],
  pulse: ['Signal pulse', v => `${Math.round(v)} µs`],
  ibec: ['BEC current', v => formatSI(Math.abs(v) < 1e-6 ? 0 : v, 'A')], // hide solver noise on an unloaded BEC
  force: ['Force', v => (v > 0 ? `${v < 1 ? `${Math.round(v * 1000)} g` : `${v} kg`}` : 'released')],
  rfsr: ['Sensor resistance', v => (v >= FSR.rOpen ? 'open (> 10 MΩ)' : formatSI(v, 'Ω'))],
  lit: ['Lit pixels', v => `${v} / ${NEOPIXEL.count}`],
};

// Ratings that depend on the part's value.
function ratingOf(comp: ExternalComponent): string | undefined {
  if (comp.type === 'Servo') {
    const m = servoOf(comp.value);
    return `${m.label} — ${m.vMin}–${m.vMax} V supply; signal ${SERVO_PULSE.minUs}–${SERVO_PULSE.maxUs} µs pulses at 50 Hz (with ledcAttach / ESP32Servo), PWM duty with analogWrite`;
  }
  if (comp.type === 'LiPo') {
    const { mAh, rCell, iMax } = lipoOf(comp.value);
    return `${mAh} mAh — ${formatSI(rCell, 'Ω')} per cell, ${formatSI(iMax, 'A')} continuous, ${LIPO.vCellEmpty}–${LIPO.vCellFull} V per cell`;
  }
  return RATINGS[comp.type];
}

const RATINGS: Partial<Record<string, string>> = {
  LED: `${formatSI(LED.iRated, 'A')} continuous, ${formatSI(LED.iAbsMax, 'A')} max, ${LED.vReverseMax} V reverse`,
  Resistor: `${formatSI(RESISTOR_P_MAX, 'W')}`,
  Potentiometer: `${formatSI(POT_P_MAX, 'W')}`,
  Transistor: `NPN 2N2222A — Ic ${formatSI(BJT.icMax, 'A')}, ${formatSI(BJT.pMax, 'W')}`,
  Diode: `1N4007 — ${formatSI(DIODE.iMax, 'A')}`,
  OLED: 'SSD1306 module — 3–5.5 V supply',
  FSR: `FSR 402 — open (> 10 MΩ) when released, ≈ 16 kΩ at 100 g, ≈ 2 kΩ at 1 kg, ≈ 250 Ω at 10 kg; ≈ ${formatSI(FSR.iMax, 'A')} max. Read it through a divider (10 kΩ to GND). Hold the mouse on the disc to press it.`,
  NeoPixel: `WS2812B-2020 × ${NEOPIXEL.count} — ${NEOPIXEL.vMin}–${NEOPIXEL.vMax} V, ≈ ${formatSI(NEOPIXEL.iIdle, 'A')} per pixel idle, up to ${formatSI(NEOPIXEL.iChannel * 3, 'A')} per pixel at full white; DIN high above ${NEOPIXEL.vihRatio} × VDD. Driven with Adafruit_NeoPixel.`,
  Vibro: `1027 coin motor — 3 V nominal (2.5–${VIBRO.vMax} V), ≈ ${formatSI(VIBRO.iFull, 'A')} running. Drive it through a transistor with a flyback diode.`,
  Motor: 'Small DC motor — ≈ 100 mA to start, ≈ 400 mA full speed',
  Buzzer: 'Active buzzer — polarised, 3–5 V',
  ESC: `${ESC.iRated} A ESC — 2S–6S (${ESC.vMin}–${ESC.vMax} V), signal ≤ ${ESC.vSignalMax} V (throttle = ${ESC.pulse.minUs}–${ESC.pulse.maxUs} µs pulse with ledcAttach, PWM duty with analogWrite), BEC ${ESC.bec.v} V ${ESC.bec.iMax} A`,
  IMU: `GY-521 — ${IMU.vMin}–${IMU.vMax} V supply, ${formatSI(IMU.rPullup, 'Ω')} I2C pull-ups to its 3.3 V regulator; answers at 0x68 on the board's A4 (SDA) / A5 (SCL) as a level, motionless sensor`,
  ELRS: `ExpressLRS receiver — ${ELRS.vMin}–${ELRS.vMax} V supply, 3.3 V UART (RX not 5 V tolerant)`,
};

const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' };
const input: React.CSSProperties = { background: '#111', color: '#fff', border: '1px solid #555', padding: '6px 8px', borderRadius: 4, outline: 'none' };

export function PropertiesPanel({ comp, name, result, onValue, onReplace, onDelete, onClose }: {
  comp: ExternalComponent;
  name: string;
  result?: CompResult;
  onValue: (value: string) => void;
  onReplace: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const valueLabel = VALUE_LABEL[comp.type];
  const showMeasures = result && comp.type !== 'Breadboard' && !comp.damaged;
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10, zIndex: 10,
      background: 'rgba(20,20,20,0.92)', border: '1px solid #444',
      borderRadius: 6, padding: 15, color: '#fff', width: 250,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#60a5fa' }}>{name}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>&times;</button>
      </div>

      {comp.damaged && (
        <div style={{ background: '#3b0d0d', border: '1px solid #7f1d1d', borderRadius: 4, padding: 8, fontSize: 12 }}>
          <b style={{ color: '#f87171' }}>Burnt out</b>{comp.damageNote ? `: ${comp.damageNote}` : ''}.
          <button onClick={onReplace} style={{ marginTop: 8, width: '100%', padding: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Replace with a new one
          </button>
        </div>
      )}

      {valueLabel && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          {valueLabel}
          <input type="text" value={comp.value || ''} onChange={e => onValue(e.target.value)} style={input} />
        </label>
      )}
      {comp.type === 'LED' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          Colour
          <select value={comp.value || 'red'} onChange={e => onValue(e.target.value)} style={input}>
            {Object.entries(LED_COLORS).map(([k, v]) => <option key={k} value={k}>{k} (Vf ≈ {v.vf} V)</option>)}
          </select>
        </label>
      )}
      {comp.type === 'Servo' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          Model
          <select value={comp.value && comp.value in SERVO_MODELS ? comp.value : 'SG90'} onChange={e => onValue(e.target.value)} style={input}>
            {Object.entries(SERVO_MODELS).map(([k, m]) => <option key={k} value={k}>{m.label}, {m.vMin}–{m.vMax} V</option>)}
          </select>
        </label>
      )}

      {showMeasures && (
        <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={row}><span>Voltage</span><b>{formatSI(result.v, 'V')}</b></div>
          <div style={row}><span>Current</span><b>{formatSI(result.i, 'A')}</b></div>
          <div style={row}><span>Power</span><b>{formatSI(result.p, 'W')}</b></div>
          {Object.entries(result.extra ?? {}).filter(([k]) => k in EXTRA_ROWS).map(([k, v]) => (
            <div key={k} style={row}><span>{EXTRA_ROWS[k][0]}</span><b>{EXTRA_ROWS[k][1](v)}</b></div>
          ))}
          {result.stress > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ ...row, color: '#aaa' }}><span>Load vs rating</span><span>{Math.round(result.stress * 100)}%</span></div>
              <div style={{ height: 5, background: '#333', borderRadius: 3 }}>
                <div style={{ height: 5, borderRadius: 3, width: `${Math.min(100, result.stress * 100)}%`, background: result.stress > 1 ? '#ef4444' : result.stress > 0.7 ? '#f59e0b' : '#22c55e' }} />
              </div>
            </div>
          )}
        </div>
      )}
      {ratingOf(comp) && <div style={{ fontSize: 11, color: '#888' }}>Rating: {ratingOf(comp)}</div>}

      <button
        style={{ width: '100%', padding: 10, background: '#cc0000', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        onClick={onDelete}
      >
        Delete Component
      </button>
    </div>
  );
}

// Selected jumper wire: what it connects, its colour, delete.
export function WirePanel({ from, to, color, onColor, onDelete, onClose }: {
  from: string;
  to: string;
  color: string;
  onColor: (color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10, zIndex: 10,
      background: 'rgba(20,20,20,0.92)', border: '1px solid #444',
      borderRadius: 6, padding: 15, color: '#fff', width: 250,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#60a5fa' }}>Wire</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>&times;</button>
      </div>
      <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{from}<br />↳ {to}</div>
      <div style={{ fontSize: 12 }}>Colour</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {WIRE_COLORS.map(c => (
          <button
            key={c.hex}
            title={c.name}
            onClick={() => onColor(c.hex)}
            style={{
              height: 26, borderRadius: 4, cursor: 'pointer', background: c.hex,
              border: c.hex === color ? '2px solid #60a5fa' : '1px solid #555',
              boxShadow: c.hex === color ? '0 0 0 2px rgba(96,165,250,0.35)' : 'none',
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#888' }}>Convention: black = GND, red = 5 V, orange = 3.3 V.</div>
      <button
        style={{ width: '100%', padding: 10, background: '#cc0000', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        onClick={onDelete}
      >
        Delete Wire
      </button>
    </div>
  );
}

export function WarningsPanel({ warnings, onSelect }: { warnings: SimWarning[]; onSelect: (compId: string) => void }) {
  if (!warnings.length) return null;
  const sorted = [...warnings].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return (
    <div style={{
      position: 'absolute', left: 10, bottom: 10, zIndex: 10, maxWidth: 'min(520px, calc(100% - 20px))',
      display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '40%', overflowY: 'auto',
    }}>
      {sorted.slice(0, 8).map(w => (
        <div
          key={w.key}
          onClick={() => w.compId && onSelect(w.compId)}
          style={{
            background: w.level === 'error' ? 'rgba(69,10,10,0.92)' : 'rgba(66,46,5,0.92)',
            border: `1px solid ${w.level === 'error' ? '#b91c1c' : '#b45309'}`,
            color: '#fde8e8', borderRadius: 5, padding: '6px 10px', fontSize: 12, lineHeight: 1.35,
            cursor: w.compId ? 'pointer' : 'default',
          }}
        >
          {w.level === 'error' ? '⚠ ' : '• '}{w.text}
        </div>
      ))}
      {sorted.length > 8 && <div style={{ fontSize: 11, color: '#aaa' }}>+{sorted.length - 8} more</div>}
    </div>
  );
}

// Compact fingerprint of what the UI shows, so the simulation only re-renders on real changes.
export function visualSignature(out: SimOutput): string {
  const parts: string[] = [];
  for (const [id, r] of Object.entries(out.comps)) {
    parts.push(`${id}:${Math.round((r.brightness ?? 0) * 40)}:${Math.round((r.speed ?? 0) * 20)}:${r.sounding ? 1 : 0}:${r.powered ? 1 : 0}:${r.angle ?? ''}:${r.pixels?.join(',') ?? ''}:${r.extra?.rfsr ?? ''}`);
  }
  for (const w of out.warnings) parts.push(w.key);
  for (const b of out.burnt) parts.push(`burnt:${b.id}`);
  return parts.join('|');
}

// Active buzzers sound at their fixed ~2.3 kHz while enough current flows through them.
export function useBuzzerSound(sim: SimOutput | null, components: ExternalComponent[]) {
  const audio = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  const sounding = !!sim && components.some(c => c.type === 'Buzzer' && sim.comps[c.id]?.sounding);
  useEffect(() => {
    if (sounding && !audio.current) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 2300;
        gain.gain.value = 0.03;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        audio.current = { ctx, osc, gain };
      } catch { /* audio unavailable */ }
    } else if (!sounding && audio.current) {
      audio.current.osc.stop();
      audio.current.ctx.close();
      audio.current = null;
    }
  }, [sounding]);
  useEffect(() => () => { audio.current?.ctx.close(); }, []);
}
