// Electrical models of the supported main boards (what the circuit simulation sees at the headers).
// Both boards are assumed powered over USB-C, so their 5 V / 3.3 V rails are live.

export const PIN_MODE = { INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3 } as const;

export type RailName = '5V' | '3V3' | '1V8';
export interface RailSpec { v: number; r: number; iLimit: number }

export type PinRole =
  | { kind: 'gnd' }
  | { kind: 'rail'; rail: RailName }
  | { kind: 'gpio'; pin: number }
  | { kind: 'nc' };

export interface BoardElectrical {
  vddIo: number; // GPIO logic level
  gpioROut: number; // output driver impedance
  iRated: number; // recommended max current per pin
  iSourceMax: number; // absolute max when the pin sources current (HIGH)
  iSinkMax: number; // absolute max when it sinks current (LOW)
  pullR: number; // internal pull-up / pull-down
  rails: Partial<Record<RailName, RailSpec>>;
  maxGpio: number; // highest Arduino pin number
  // `label` is the human-readable pin label (needed for the UNO Q JMISC/JMEDIA power pins).
  pinRole(id: string, label?: string): PinRole;
  gpioName(pin: number): string;
  maxInputVoltage(pin: number): number;
  overVoltageNote?(pin: number): string;
}

// ---------------------------------------------------------------------------
// Arduino UNO Q (ABX00162): STM32U585 GPIOs at 3.3 V, all 5 V tolerant except A0/A1.
// ---------------------------------------------------------------------------

const UNO_Q_GND_IDS = new Set(['GND', 'GND_1', 'GND_2', 'QW_GND', 'SPI2_GND', 'JCTL_GND_J1', 'JCTL_GND_J2']);
// JSPI shares the SPI lines with D11-D13.
const UNO_Q_ALIASES: Record<string, number> = { SPI2_SCK: 13, SPI2_MISO: 12, SPI2_MOSI: 11 };

export const UNO_Q_ELECTRICAL: BoardElectrical = {
  vddIo: 3.3,
  gpioROut: 40, // STM32: ~0.4 V drop at 8-10 mA
  iRated: 0.020,
  iSourceMax: 0.025,
  iSinkMax: 0.025,
  pullR: 40e3,
  rails: {
    '5V': { v: 5.0, r: 0.05, iLimit: 1.5 }, // USB-C VBUS, protected by the input switch
    '3V3': { v: 3.3, r: 0.1, iLimit: 1.0 },
    '1V8': { v: 1.8, r: 0.3, iLimit: 0.3 },
  },
  maxGpio: 21,
  pinRole(id, label = '') {
    if (UNO_Q_GND_IDS.has(id) || /: GND$/.test(label)) return { kind: 'gnd' };
    if (id === '5V' || id === 'SPI2_5V' || /: 5V$/.test(label)) return { kind: 'rail', rail: '5V' };
    if (id === '3V3' || id === 'IOREF' || id === 'QW_3V3' || /: 3V3$/.test(label)) return { kind: 'rail', rail: '3V3' };
    if (id === 'JCTL_1V8' || /: 1V8$/.test(label)) return { kind: 'rail', rail: '1V8' };
    if (/^\d+$/.test(id)) return { kind: 'gpio', pin: Number(id) };
    if (id in UNO_Q_ALIASES) return { kind: 'gpio', pin: UNO_Q_ALIASES[id] };
    return { kind: 'nc' };
  },
  gpioName: pin => (pin >= 14 && pin <= 19 ? `A${pin - 14}` : `D${pin}`),
  maxInputVoltage: pin => (pin === 14 || pin === 15 ? 3.6 : 5.5),
  overVoltageNote: pin => (pin === 14 || pin === 15 ? ' (A0/A1 are not 5 V tolerant)' : ''),
};

// ---------------------------------------------------------------------------
// Arduino Nano ESP32 (ABX00083): ESP32-S3 (u-blox NORA-W106). Every pin is 3.3 V only.
// GPIOs source up to 40 mA and sink up to 28 mA. 5 V is only available on VBUS (from USB);
// VIN is a 6-21 V input. A0-A7 are Arduino pins 17-24.
// ---------------------------------------------------------------------------

export const NANO_ESP32_ELECTRICAL: BoardElectrical = {
  vddIo: 3.3,
  gpioROut: 30, // ESP32-S3 at the default drive strength
  iRated: 0.020,
  iSourceMax: 0.040,
  iSinkMax: 0.028,
  pullR: 45e3,
  rails: {
    '5V': { v: 5.0, r: 0.1, iLimit: 1.0 }, // VBUS, straight from the USB-C connector
    '3V3': { v: 3.3, r: 0.1, iLimit: 1.0 }, // MP2322 step-down output
  },
  maxGpio: 24,
  pinRole(id) {
    if (id === 'GND_1' || id === 'GND_2') return { kind: 'gnd' };
    if (id === 'VBUS') return { kind: 'rail', rail: '5V' };
    if (id === '3V3') return { kind: 'rail', rail: '3V3' };
    if (/^\d+$/.test(id)) return { kind: 'gpio', pin: Number(id) };
    return { kind: 'nc' }; // VIN (input), RST, B0/B1 (boot)
  },
  gpioName: pin => (pin >= 17 && pin <= 24 ? `A${pin - 17}` : `D${pin}`),
  maxInputVoltage: () => 3.6,
  overVoltageNote: () => ' (the Nano ESP32 pins are 3.3 V only)',
};
