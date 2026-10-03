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
export const OLED = { rLoad: 220, rPullup: 4.7e3, vMin: 3.0, vMax: 5.5, vAbsMax: 6.0 }; // SSD1306 module
export const INDUCTOR_DCR = 0.2;
export const ELECTROLYTIC_MIN_C = 1e-6; // >= 1 µF is assumed to be a polarised electrolytic

export const DEFAULT_VALUES: Partial<Record<string, string>> = {
  Resistor: '220Ω',
  Capacitor: '100nF',
  Inductor: '10µH',
  Potentiometer: '10kΩ',
  LED: 'red',
};

export function valueOr(text: string | undefined, fallback: number, min = 0): number {
  const v = parseValue(text);
  return isFinite(v) && v > min ? v : fallback;
}
