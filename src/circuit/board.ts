// Electrical model of the Arduino UNO Q headers.
// Sources: ABX00162 datasheet + pinout. MCU GPIOs (STM32U585) run at 3.3 V; all of them are
// 5 V tolerant except A0/A1. The board is assumed powered over USB-C (5 V rail live).

export const VDD_IO = 3.3;
export const GPIO_R_OUT = 40; // output driver impedance (STM32: ~0.4 V drop at 8-10 mA)
export const GPIO_I_RATED = 0.020; // recommended max per pin
export const GPIO_I_ABS_MAX = 0.025; // absolute max per pin
export const PULL_R = 40e3; // internal pull-up / pull-down
export const V_IH = 0.7 * VDD_IO; // Schmitt-trigger thresholds
export const V_IL = 0.3 * VDD_IO;
export const ADC_MAX = 1023; // analogRead() default 10-bit resolution

export const PIN_MODE = { INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3 } as const;

export type RailName = '5V' | '3V3' | '1V8';
export const RAILS: Record<RailName, { v: number; r: number; iLimit: number }> = {
  '5V': { v: 5.0, r: 0.05, iLimit: 1.5 }, // USB-C VBUS, protected by the input switch
  '3V3': { v: 3.3, r: 0.1, iLimit: 1.0 },
  '1V8': { v: 1.8, r: 0.3, iLimit: 0.3 },
};

export type PinRole =
  | { kind: 'gnd' }
  | { kind: 'rail'; rail: RailName }
  | { kind: 'gpio'; pin: number }
  | { kind: 'nc' };

const GND_IDS = new Set(['GND', 'GND_1', 'GND_2', 'QW_GND', 'SPI2_GND', 'JCTL_GND_J1', 'JCTL_GND_J2']);
// JSPI shares the SPI lines with D11-D13.
const ALIASES: Record<string, number> = { SPI2_SCK: 13, SPI2_MISO: 12, SPI2_MOSI: 11 };

// `label` is the human-readable pin label (needed for the JMISC/JMEDIA power pins).
export function pinRole(id: string, label = ''): PinRole {
  if (GND_IDS.has(id) || /: GND$/.test(label)) return { kind: 'gnd' };
  if (id === '5V' || id === 'SPI2_5V' || /: 5V$/.test(label)) return { kind: 'rail', rail: '5V' };
  if (id === '3V3' || id === 'IOREF' || id === 'QW_3V3' || /: 3V3$/.test(label)) return { kind: 'rail', rail: '3V3' };
  if (id === 'JCTL_1V8' || /: 1V8$/.test(label)) return { kind: 'rail', rail: '1V8' };
  if (/^\d+$/.test(id)) return { kind: 'gpio', pin: Number(id) };
  if (id in ALIASES) return { kind: 'gpio', pin: ALIASES[id] };
  return { kind: 'nc' };
}

export function gpioName(pin: number): string {
  return pin >= 14 && pin <= 19 ? `A${pin - 14}` : `D${pin}`;
}

// A0 and A1 are the only MCU pins that are not 5 V tolerant.
export function gpioMaxInputVoltage(pin: number): number {
  return pin === 14 || pin === 15 ? 3.6 : 5.5;
}
