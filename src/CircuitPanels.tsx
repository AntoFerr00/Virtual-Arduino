import { useEffect, useRef } from 'react';
import type { ExternalComponent } from './App';
import type { CompResult, SimOutput, SimWarning } from './circuit/simulator';
import { LED_COLORS, LED, RESISTOR_P_MAX, POT_P_MAX, BJT, DIODE } from './circuit/components';
import { formatSI } from './circuit/units';

const VALUE_LABEL: Partial<Record<string, string>> = {
  Resistor: 'Resistance',
  Potentiometer: 'Total resistance',
  Capacitor: 'Capacitance (≥ 1 µF = polarised electrolytic)',
  Inductor: 'Inductance',
};

const RATINGS: Partial<Record<string, string>> = {
  LED: `${formatSI(LED.iRated, 'A')} continuous, ${formatSI(LED.iAbsMax, 'A')} max, ${LED.vReverseMax} V reverse`,
  Resistor: `${formatSI(RESISTOR_P_MAX, 'W')}`,
  Potentiometer: `${formatSI(POT_P_MAX, 'W')}`,
  Transistor: `NPN 2N2222A — Ic ${formatSI(BJT.icMax, 'A')}, ${formatSI(BJT.pMax, 'W')}`,
  Diode: `1N4007 — ${formatSI(DIODE.iMax, 'A')}`,
  Servo: 'SG90 — 4–7.2 V supply',
  OLED: 'SSD1306 module — 3–5.5 V supply',
  Motor: 'Small DC motor — ≈ 100 mA to start, ≈ 400 mA full speed',
  Buzzer: 'Active buzzer — polarised, 3–5 V',
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

      {showMeasures && (
        <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={row}><span>Voltage</span><b>{formatSI(result.v, 'V')}</b></div>
          <div style={row}><span>Current</span><b>{formatSI(result.i, 'A')}</b></div>
          <div style={row}><span>Power</span><b>{formatSI(result.p, 'W')}</b></div>
          {result.extra?.ib !== undefined && <div style={row}><span>Base current</span><b>{formatSI(result.extra.ib, 'A')}</b></div>}
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
      {RATINGS[comp.type] && <div style={{ fontSize: 11, color: '#888' }}>Rating: {RATINGS[comp.type]}</div>}

      <button
        style={{ width: '100%', padding: 10, background: '#cc0000', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        onClick={onDelete}
      >
        Delete Component
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
    parts.push(`${id}:${Math.round((r.brightness ?? 0) * 40)}:${Math.round((r.speed ?? 0) * 20)}:${r.sounding ? 1 : 0}:${r.powered ? 1 : 0}:${r.angle ?? ''}`);
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
