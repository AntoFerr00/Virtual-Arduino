// Electrical parameters of the parts in the component library.
import { parseValue } from './units';

export const VT = 0.025852; // thermal voltage at 300 K

export const LED_COLORS = {
  red: { vf: 2.0, color: '#ff2a1a' },
  yellow: { vf: 2.1, color: '#ffd21a' },
  green: { vf: 2.2, color: '#33ff44' },
  blue: { vf: 3.1, color: '#2a6bff' },
  white: { vf: 3.1, color: '#f4f6ff' },
} as const;
export type LedColor = keyof typeof LED_COLORS;

export function ledColorOf(value?: string): LedColor {
  return value && value in LED_COLORS ? (value as LedColor) : 'red';
}

// 5 mm through-hole LED: Vf at 20 mA by colour, 20 mA rated, 30 mA absolute max, 5 V reverse.
export const LED = {
  n: 2,
  rs: 5,
  iRated: 0.020,
  iAbsMax: 0.030,
  vReverseMax: 5,
  saturation(color: LedColor) {
    const vj = LED_COLORS[color].vf - LED.iRated * LED.rs;
    return LED.iRated / (Math.exp(vj / (LED.n * VT)) - 1);
  },
};

export const DIODE = { is: 7e-9, n: 1.8, rs: 0.04, iMax: 1.0 }; // 1N4007
export const BJT = { is: 1e-14, betaF: 200, betaR: 2, icMax: 0.6, pMax: 0.5 }; // 2N2222A (NPN)
export const RESISTOR_P_MAX = 0.25; // 1/4 W
export const POT_P_MAX = 0.25;
export const BUTTON_R_ON = 0.05;
export const BUZZER = { r: 180, iSound: 0.004 }; // active buzzer, polarised (internal diode)
export const MOTOR = { r: 10, iStart: 0.1, iFull: 0.4 }; // small 3-6 V brushed DC motor
export const SERVO = { rLoad: 500, rSignal: 1e6, vMin: 4.0, vMax: 7.2, vAbsMax: 8.0 }; // SG90

// Servo models (the part's value). Idle supply load, supply range and the voltage that kills it.
export const SERVO_MODELS = {
  SG90: { label: 'SG90 (9 g)', rLoad: SERVO.rLoad, vMin: SERVO.vMin, vMax: SERVO.vMax, vAbsMax: SERVO.vAbsMax },
  'Micro 1S': { label: 'Micro 1S (2–5 g, e.g. DM-S0020)', rLoad: 900, vMin: 3.4, vMax: 6.0, vAbsMax: 6.5 },
} as const;
export type ServoModel = keyof typeof SERVO_MODELS;

export function servoOf(value?: string): (typeof SERVO_MODELS)[ServoModel] {
  return value && value in SERVO_MODELS ? SERVO_MODELS[value as ServoModel] : SERVO_MODELS.SG90;
}

// Servo signal: with a known PWM frequency (ledcAttach, ESP32Servo) the servo reads the pulse
// width like a real one, 544-2400 µs over 0-180° (Arduino Servo defaults); pulses outside
// 400-2600 µs or a frame rate outside 40-400 Hz are not a servo signal. With analogWrite
// (frequency unknown) the duty itself is the position.
export const SERVO_PULSE = { minUs: 544, maxUs: 2400, validMinUs: 400, validMaxUs: 2600, freqMin: 40, freqMax: 400 };

// FSR 402 force-sensing resistor (12.7 mm disc). Released it is an open circuit (> 10 MΩ); from
// ≈ 20 g its resistance falls roughly as force^-0.9: ≈ 16 kΩ at 100 g, ≈ 2 kΩ at 1 kg, ≈ 250 Ω
// at 10 kg. It is rated for ≈ 1 mA/cm² (≈ 1.3 mA over the disc).
export const FSR = { rOpen: 10e6, rFull: 250, fFullKg: 10, fMinKg: 0.02, exponent: 0.9, iMax: 0.0013 };

export function fsrResistance(forceKg: number): number {
  if (forceKg < FSR.fMinKg) return FSR.rOpen;
  return Math.min(FSR.rOpen, FSR.rFull * Math.pow(FSR.fFullKg / Math.min(forceKg, FSR.fFullKg), FSR.exponent));
}

// The FSR's value is the force applied while it is held down: "2 kg", "300 g" (default 2 kg).
export function fsrForceOf(value?: string): number {
  const m = (value ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  if (!m) return 2;
  const n = parseFloat(m[1]);
  return m[2]?.toLowerCase() === 'g' ? n / 1000 : n;
}

// WS2812B-2020 strip, 8 pixels at 160 LEDs/m: 3.5-5.3 V, ≈ 1 mA per pixel idle and up to 12 mA
// per colour channel at full brightness. DIN reads a high level above 0.7 × VDD.
export const NEOPIXEL = { count: 8, vMin: 3.5, vMax: 5.3, vAbsMax: 6.0, iIdle: 0.001, iChannel: 0.012, vNominal: 4.0, rDin: 1e6, vihRatio: 0.7 };

// 10 mm coin vibration motor (1027): 3 V nominal (2.5-4.2 V), ≈ 80 mA running, ≈ 35 Ω.
export const VIBRO = { r: 35, iStart: 0.035, iFull: 0.09, vMax: 4.2, vAbsMax: 5.5 };

export const OLED = { rLoad: 220, rPullup: 4.7e3, vMin: 3.0, vMax: 5.5, vAbsMax: 6.0 }; // SSD1306 module
export const INDUCTOR_DCR = 0.2;
export const ELECTROLYTIC_MIN_C = 1e-6; // >= 1 µF is assumed to be a polarised electrolytic

// 1500 mAh 75C LiPo pack: ≈ 4 mΩ internal resistance per cell, 120 A continuous.
// Small pouch cells (< 1000 mAh, e.g. a 402030) are ≈ 150 mΩ at 250 mAh and allow ≈ 2C.
export const LIPO = { rCell: 0.004, iMax: 120, mAh: 1500, vCellEmpty: 3.0, vCellFull: 4.2, vCellHv: 4.35 };
export const LIPO_POUCH = { rCellAt250: 0.15, cRate: 2 };

export interface LipoSpec { cells: number; vCell: number; mAh: number; rCell: number; iMax: number }

// "4S 3.9V" (cell voltage) or "4S 15.6V" (pack voltage), optionally with the capacity
// ("1S 3.9V 200mAh"); a missing part means a charged 4S 1500 mAh drone pack.
export function lipoOf(value?: string): LipoSpec {
  const s = (value ?? '').replace(',', '.');
  const cellsMatch = s.match(/(\d+)\s*S/i);
  const voltsMatch = s.match(/(\d+(?:\.\d+)?)\s*V/i);
  const mAhMatch = s.match(/(\d+)\s*mAh/i);
  const cells = Math.min(12, Math.max(1, cellsMatch ? parseInt(cellsMatch[1], 10) : 4));
  let vCell = voltsMatch ? parseFloat(voltsMatch[1]) : LIPO.vCellFull;
  if (vCell > 5) vCell /= cells;
  const mAh = mAhMatch ? Math.max(10, parseInt(mAhMatch[1], 10)) : LIPO.mAh;
  const pouch = mAh < 1000;
  return {
    cells,
    vCell: Math.max(0, vCell),
    mAh,
    rCell: pouch ? LIPO_POUCH.rCellAt250 * 250 / mAh : LIPO.rCell * LIPO.mAh / mAh,
    iMax: pouch ? LIPO_POUCH.cRate * mAh / 1000 : LIPO.iMax * mAh / LIPO.mAh,
  };
}

// 30 A BLHeli ESC driving a 2207 brushless motor with a 5" prop. The battery current grows with
// throttle^1.5 (propeller load) up to `iFull` at full throttle on a charged 4S pack; it has a
// 5 V 2 A BEC. When the sketch sets the PWM frequency (ledcAttach) the ESC reads the pulse width
// like a real one: 1000 us = stop, 2000 us = full, at 40-500 Hz; pulses outside 800-2200 us are
// not a valid signal. With analogWrite (frequency unknown) the duty itself is the throttle.
export const ESC = {
  vMin: 6.0, vMax: 25.2, vAbsMax: 26, iRated: 30, vNominal: 16.8, iIdle: 0.03, iFull: 15,
  rSignal: 100e3, vSignalHigh: 1.5, vSignalMax: 5.0, deadband: 0.02,
  bec: { v: 5.0, r: 0.05, iMax: 2 },
  pulse: { minUs: 1000, maxUs: 2000, validMinUs: 800, validMaxUs: 2200, freqMin: 40, freqMax: 500 },
};

// "CW 15A": propeller direction (CW / CCW, seen from above) and the current at full throttle.
export function escOf(value?: string): { dir: 1 | -1; iFull: number } {
  const s = value ?? '';
  const amps = s.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*A/i);
  return { dir: /\bCCW\b/i.test(s) ? -1 : 1, iFull: amps ? Math.max(0, parseFloat(amps[1])) : ESC.iFull };
}

// GY-521 module: MPU-6050 behind a 3.3 V LDO, with its I2C pull-ups to the LDO output (so a 5 V
// supply never reaches SDA/SCL). INT is a push-pull output that idles low.
export const IMU = { address: 0x68, rLoad: 680, rPullup: 4.7e3, vReg: 3.3, vDropout: 0.25, rInt: 1e3, vMin: 3.0, vMax: 5.5, vAbsMax: 6.0 };

// ExpressLRS receiver (ESP8285 + SX1280 behind a 3.3 V LDO): ≈ 60 mA, 3.3 V UART that idles high.
export const ELRS = { rLoad: 82, vMin: 4.0, vMax: 5.5, vAbsMax: 6.5, vTx: 3.3, rTx: 100, rRx: 1e6, vRxMax: 3.6 };

export const DEFAULT_VALUES: Partial<Record<string, string>> = {
  Resistor: '220Ω',
  Capacitor: '100nF',
  Inductor: '10µH',
  Potentiometer: '10kΩ',
  LED: 'red',
  LiPo: '4S 4.2V',
  ESC: 'CW 15A',
  Servo: 'SG90',
  FSR: '2 kg',
};

export function valueOr(text: string | undefined, fallback: number, min = 0): number {
  const v = parseValue(text);
  return isFinite(v) && v > min ? v : fallback;
}
