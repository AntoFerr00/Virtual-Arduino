// Real-time electrical simulation of the breadboard circuit attached to the main board.
//
// Each tick the circuit is rebuilt from components/wires, then integrated in time with
// backward-Euler steps (capacitors/inductors) and solved with Newton-Raphson (LEDs, diodes,
// transistors). The results drive the 3D view, feed digitalRead()/analogRead() of the sketch,
// and decide when a part is over-stressed and burns out.
import type { ExternalComponent, Wire } from '../App';
import { NodalSystem, limexp, pnjlim } from './solver';
import { PIN_MODE, RailName, BoardElectrical, PinRole } from './board';
import {
  VT, LED, LED_COLORS, ledColorOf, DIODE, BJT, RESISTOR_P_MAX, POT_P_MAX, BUTTON_R_ON, BUZZER,
  MOTOR, SERVO, OLED, INDUCTOR_DCR, ELECTROLYTIC_MIN_C, valueOr,
  LIPO, lipoOf, ESC, escOf, IMU, ELRS,
  servoOf, SERVO_PULSE, FSR, fsrResistance, fsrForceOf, NEOPIXEL, VIBRO,
} from './components';
import { formatSI } from './units';

export interface PinDrive {
  mode: number; // PIN_MODE
  duty: number; // OUTPUT level: 0 = LOW, 1 = HIGH, in between = PWM (analogWrite)
  freq?: number; // PWM frequency in Hz, when the sketch set it (ledcAttach): ESCs then read the pulse width
}

export interface CompResult {
  v: number; // voltage across the part's main terminals
  i: number; // current through it
  p: number; // dissipated power
  stress: number; // worst ratio against its ratings (> 1 = over-stressed)
  brightness?: number; // LED, 0..~1.5
  color?: string;
  speed?: number; // DC motor, -1..1
  powered?: boolean;
  sounding?: boolean;
  angle?: number; // servo, 0..255
  i2c?: number[]; // addresses the part answers on the board's I2C bus (A4 SDA, A5 SCL)
  pixels?: number[]; // WS2812B strip: 0xRRGGBB per pixel, when powered and fed by the sketch
  extra?: Record<string, number>;
}

export interface PinReading {
  v: number;
  digital: 0 | 1;
  analog: number; // millivolts seen by the ADC (the sketch scales them to its resolution)
  floating: boolean;
  current: number; // sourced by the pin (negative = sinking)
}

export interface SimWarning {
  key: string;
  level: 'warn' | 'error';
  text: string;
  compId?: string;
}

export interface SimOutput {
  comps: Record<string, CompResult>;
  pins: Record<number, PinReading>;
  warnings: SimWarning[];
  burnt: { id: string; reason: string }[];
}

export interface SimInput {
  board: BoardElectrical;
  components: ExternalComponent[];
  wires: Wire[];
  pinLabel: (pinId: string) => string;
  pins: Map<number, PinDrive>;
  running: boolean;
  pixels?: Map<number, number[]>; // last NeoPixel frame the sketch sent on each GPIO
}

const GMIN = 1e-12;
const FLOATING_R = 5e6; // Thevenin resistance above which an input is considered floating
type Volt = (node: number) => number;
interface Ctx { dt: number; high: boolean }
type Measure = Record<string, number>;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

abstract class Device {
  reactive = false;
  constructor(readonly comp: ExternalComponent) {}
  abstract stamp(sys: NodalSystem, V: Volt, ctx: Ctx): boolean; // true = junction limited
  abstract measure(V: Volt, ctx: Ctx): Measure;
  commit(_V: Volt, _ctx: Ctx) {}
}

class ResistorDev extends Device {
  constructor(comp: ExternalComponent, readonly a: number, readonly b: number, readonly r: number) { super(comp); }
  stamp(sys: NodalSystem) { sys.addConductance(this.a, this.b, 1 / this.r); return false; }
  measure(V: Volt) {
    const v = V(this.a) - V(this.b);
    return { v, i: v / this.r, p: (v * v) / this.r };
  }
}

class PotDev extends Device {
  readonly r1: number;
  readonly r2: number;
  constructor(comp: ExternalComponent, readonly n1: number, readonly nw: number, readonly n3: number, readonly r: number) {
    super(comp);
    const pos = Math.min(1, Math.max(0, comp.state / 255));
    this.r1 = Math.max(pos * r, 0.5); // 0.5 Ω wiper contact resistance
    this.r2 = Math.max((1 - pos) * r, 0.5);
  }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.n1, this.nw, 1 / this.r1);
    sys.addConductance(this.nw, this.n3, 1 / this.r2);
    return false;
  }
  measure(V: Volt) {
    const v1 = V(this.n1) - V(this.nw);
    const v2 = V(this.nw) - V(this.n3);
    const p1 = (v1 * v1) / this.r1;
    const p2 = (v2 * v2) / this.r2;
    // Heat concentrates in the active part of the track: rate each section by its length.
    const s1 = p1 / (POT_P_MAX * Math.max(this.r1 / this.r, 0.02));
    const s2 = p2 / (POT_P_MAX * Math.max(this.r2 / this.r, 0.02));
    return { v: V(this.n1) - V(this.n3), i: v1 / this.r1, p: p1 + p2, vw: V(this.nw), sect: Math.max(s1, s2) };
  }
}

class CapacitorDev extends Device {
  reactive = true;
  constructor(comp: ExternalComponent, readonly p: number, readonly m: number, readonly c: number, private store: Map<string, number>) { super(comp); }
  private get vPrev() { return this.store.get(`${this.comp.id}:vc`) ?? 0; }
  stamp(sys: NodalSystem, _V: Volt, ctx: Ctx) {
    const g = this.c / ctx.dt;
    sys.addConductance(this.p, this.m, g + 1e-10); // + tiny leakage
    sys.addCurrent(this.p, g * this.vPrev);
    sys.addCurrent(this.m, -g * this.vPrev);
    return false;
  }
  measure(V: Volt, ctx: Ctx) {
    const v = V(this.p) - V(this.m);
    return { v, i: (this.c / ctx.dt) * (v - this.vPrev), p: 0 };
  }
  commit(V: Volt) { this.store.set(`${this.comp.id}:vc`, V(this.p) - V(this.m)); }
}

class InductorDev extends Device {
  reactive = true;
  constructor(comp: ExternalComponent, readonly a: number, readonly b: number, readonly l: number, private store: Map<string, number>) { super(comp); }
  private get iPrev() { return this.store.get(`${this.comp.id}:il`) ?? 0; }
  private companion(dt: number) {
    const rl = this.l / dt;
    const g = 1 / (rl + INDUCTOR_DCR);
    return { g, ieq: g * rl * this.iPrev };
  }
  stamp(sys: NodalSystem, _V: Volt, ctx: Ctx) {
    const { g, ieq } = this.companion(ctx.dt);
    sys.addConductance(this.a, this.b, g);
    sys.addCurrent(this.a, -ieq);
    sys.addCurrent(this.b, ieq);
    return false;
  }
  measure(V: Volt, ctx: Ctx) {
    const { g, ieq } = this.companion(ctx.dt);
    const v = V(this.a) - V(this.b);
    const i = g * v + ieq;
    return { v, i, p: i * i * INDUCTOR_DCR };
  }
  commit(V: Volt, ctx: Ctx) { this.store.set(`${this.comp.id}:il`, this.measure(V, ctx).i); }
}

// Shockley junction with series resistance (LED, rectifier diode, active buzzer).
class DiodeDev extends Device {
  private vd: number;
  private readonly nvt: number;
  private readonly vcrit: number;
  constructor(
    comp: ExternalComponent, readonly a: number, readonly k: number, readonly mid: number,
    readonly is: number, n: number, readonly rs: number, private store: Map<string, number>,
  ) {
    super(comp);
    this.nvt = n * VT;
    this.vcrit = this.nvt * Math.log(this.nvt / (Math.SQRT2 * is));
    this.vd = store.get(`${comp.id}:vd`) ?? 0;
  }
  private current(vd: number) {
    const [e, de] = limexp(vd / this.nvt);
    return { id: this.is * (e - 1) + GMIN * vd, gd: (this.is / this.nvt) * de + GMIN };
  }
  stamp(sys: NodalSystem, V: Volt) {
    sys.addConductance(this.a, this.mid, 1 / this.rs);
    const raw = V(this.mid) - V(this.k);
    const vd = pnjlim(raw, this.vd, this.nvt, this.vcrit);
    this.vd = vd;
    this.store.set(`${this.comp.id}:vd`, vd);
    const { id, gd } = this.current(vd);
    sys.addNonlinear([this.mid, this.k], [id, -id], [[gd, -gd], [-gd, gd]], [V(this.k) + vd, V(this.k)]);
    return Math.abs(vd - raw) > 1e-9;
  }
  measure(V: Volt) {
    const v = V(this.a) - V(this.k);
    const i = (V(this.a) - V(this.mid)) / this.rs;
    return { v, i, p: v * i };
  }
}

// NPN bipolar transistor, Ebers-Moll transport model.
class BjtDev extends Device {
  private vbe: number;
  private vbc: number;
  private readonly vcrit = VT * Math.log(VT / (Math.SQRT2 * BJT.is));
  constructor(comp: ExternalComponent, readonly c: number, readonly b: number, readonly e: number, private store: Map<string, number>) {
    super(comp);
    this.vbe = store.get(`${comp.id}:vbe`) ?? 0;
    this.vbc = store.get(`${comp.id}:vbc`) ?? 0;
  }
  private evaluate(vbe: number, vbc: number) {
    const [ebe, debe] = limexp(vbe / VT);
    const [ebc, debc] = limexp(vbc / VT);
    const ibeF = BJT.is * (ebe - 1);
    const ibcR = BJT.is * (ebc - 1);
    const gbe = (BJT.is / VT) * debe;
    const gbc = (BJT.is / VT) * debc;
    const ic = ibeF - ibcR - ibcR / BJT.betaR;
    const ib = ibeF / BJT.betaF + ibcR / BJT.betaR;
    const dIc = { be: gbe, bc: -gbc - gbc / BJT.betaR };
    const dIb = { be: gbe / BJT.betaF, bc: gbc / BJT.betaR };
    return { ic, ib, dIc, dIb };
  }
  stamp(sys: NodalSystem, V: Volt) {
    const rawBe = V(this.b) - V(this.e);
    const rawBc = V(this.b) - V(this.c);
    const vbe = pnjlim(rawBe, this.vbe, VT, this.vcrit);
    const vbc = pnjlim(rawBc, this.vbc, VT, this.vcrit);
    this.vbe = vbe; this.vbc = vbc;
    this.store.set(`${this.comp.id}:vbe`, vbe);
    this.store.set(`${this.comp.id}:vbc`, vbc);
    const { ic, ib, dIc, dIb } = this.evaluate(vbe, vbc);
    // Columns: d/dVc, d/dVb, d/dVe  (Vbe = Vb - Ve, Vbc = Vb - Vc)
    const rowC = [-dIc.bc, dIc.be + dIc.bc, -dIc.be];
    const rowB = [-dIb.bc, dIb.be + dIb.bc, -dIb.be];
    const rowE = rowC.map((x, j) => -(x + rowB[j]));
    const ve = V(this.e);
    const vb = ve + vbe;
    const vc = vb - vbc;
    sys.addNonlinear([this.c, this.b, this.e], [ic, ib, -(ic + ib)], [rowC, rowB, rowE], [vc, vb, ve]);
    return Math.abs(vbe - rawBe) > 1e-9 || Math.abs(vbc - rawBc) > 1e-9;
  }
  measure(V: Volt) {
    const { ic, ib } = this.evaluate(V(this.b) - V(this.e), V(this.b) - V(this.c));
    const vce = V(this.c) - V(this.e);
    const vbe = V(this.b) - V(this.e);
    return { v: vce, i: ic, p: vce * ic + vbe * ib, ib, vbe };
  }
}

// Linear load between two pins plus optional extra resistors (servo, OLED, motor).
class LoadDev extends Device {
  constructor(comp: ExternalComponent, readonly a: number, readonly b: number, readonly r: number, readonly extra: [number, number, number][] = []) { super(comp); }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.a, this.b, 1 / this.r);
    for (const [x, y, r] of this.extra) sys.addConductance(x, y, 1 / r);
    return false;
  }
  measure(V: Volt) {
    const v = V(this.a) - V(this.b);
    return { v, i: v / this.r, p: (v * v) / this.r };
  }
}

// Voltage source `v` behind `r` between two nodes (Norton equivalent), `pos` above `neg`.
function stampFloatingSource(sys: NodalSystem, pos: number, neg: number, v: number, r: number) {
  sys.addConductance(pos, neg, 1 / r);
  sys.addCurrent(pos, v / r);
  sys.addCurrent(neg, -v / r);
}

// LiPo pack: open-circuit voltage behind its internal resistance.
class LipoDev extends Device {
  constructor(comp: ExternalComponent, readonly p: number, readonly m: number, readonly emf: number, readonly r: number) { super(comp); }
  stamp(sys: NodalSystem) { stampFloatingSource(sys, this.p, this.m, this.emf, this.r); return false; }
  measure(V: Volt) {
    const v = V(this.p) - V(this.m);
    const i = (this.emf - v) / this.r; // discharge current
    return { v, i, p: v * i };
  }
}

// Pulse width the ESC sees, or undefined when the PWM frequency is unknown (analogWrite).
function escPulseUs(duty: number, freq?: number): number | undefined {
  return freq ? (duty * 1e6) / freq : undefined;
}

function escThrottle(duty: number, freq?: number): number {
  const us = escPulseUs(duty, freq);
  if (us === undefined || !freq) return duty < ESC.deadband ? 0 : Math.min(1, duty);
  const { minUs, maxUs, validMinUs, validMaxUs, freqMin, freqMax } = ESC.pulse;
  if (freq < freqMin || freq > freqMax || us < validMinUs || us > validMaxUs) return 0;
  const t = (us - minUs) / (maxUs - minUs);
  return t < ESC.deadband ? 0 : Math.min(1, t);
}

// ESC + brushless motor ('-' and the signal GND are the same copper, joined in the netlist).
// Battery draw and BEC follow the state of the previous tick (powered, signal seen), so each
// tick stays a linear solve. The BEC's own draw on the battery is left out (< 2 % of the motor's).
class EscDev extends Device {
  readonly powered: boolean;
  private readonly signalSeen: boolean;
  private throttle = 0;
  signalPeak = 0; // highest S-to-GND level during this tick
  constructor(
    comp: ExternalComponent, readonly p: number, readonly m: number, readonly s: number, readonly bec: number,
    readonly iFull: number, private store: Map<string, number>,
  ) {
    super(comp);
    const vin = store.get(`${comp.id}:vin`) ?? 0;
    this.powered = vin >= ESC.vMin && vin <= ESC.vAbsMax;
    this.signalSeen = (store.get(`${comp.id}:sig`) ?? 0) >= ESC.vSignalHigh;
  }
  setDuty(duty: number, freq?: number) { this.throttle = this.powered && this.signalSeen ? escThrottle(duty, freq) : 0; }
  private get g() { return (ESC.iIdle + (this.powered ? this.iFull * Math.pow(this.throttle, 1.5) : 0)) / ESC.vNominal; }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.p, this.m, this.g);
    sys.addConductance(this.s, this.m, 1 / ESC.rSignal);
    if (this.powered) stampFloatingSource(sys, this.bec, this.m, ESC.bec.v, ESC.bec.r);
    return false;
  }
  measure(V: Volt) {
    const v = V(this.p) - V(this.m);
    this.signalPeak = Math.max(this.signalPeak, V(this.s) - V(this.m));
    const ibec = this.powered ? (ESC.bec.v - (V(this.bec) - V(this.m))) / ESC.bec.r : 0;
    return { v, i: v * this.g, p: v * v * this.g, ibec };
  }
  commit(V: Volt) {
    this.store.set(`${this.comp.id}:vin`, V(this.p) - V(this.m));
    this.store.set(`${this.comp.id}:sig`, this.signalPeak);
  }
}

// GY-521 IMU module: supply load, I2C pull-ups to its LDO output, INT idling low.
class ImuDev extends Device {
  private readonly vReg: number;
  constructor(
    comp: ExternalComponent, readonly vcc: number, readonly gnd: number, readonly scl: number, readonly sda: number,
    readonly int: number, private store: Map<string, number>,
  ) {
    super(comp);
    this.vReg = Math.min(IMU.vReg, Math.max(0, (store.get(`${comp.id}:vcc`) ?? 0) - IMU.vDropout));
  }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.vcc, this.gnd, 1 / IMU.rLoad);
    stampFloatingSource(sys, this.scl, this.gnd, this.vReg, IMU.rPullup);
    stampFloatingSource(sys, this.sda, this.gnd, this.vReg, IMU.rPullup);
    sys.addConductance(this.int, this.gnd, this.vReg > 2 ? 1 / IMU.rInt : 1e-6);
    return false;
  }
  measure(V: Volt) {
    const v = V(this.vcc) - V(this.gnd);
    return { v, i: v / IMU.rLoad, p: (v * v) / IMU.rLoad };
  }
  commit(V: Volt) { this.store.set(`${this.comp.id}:vcc`, V(this.vcc) - V(this.gnd)); }
}

// ExpressLRS receiver: supply load, TX idling high once powered, high-impedance RX.
class ElrsDev extends Device {
  readonly powered: boolean;
  rxPeak = 0; // highest RX-to-GND level during this tick
  constructor(
    comp: ExternalComponent, readonly vcc: number, readonly gnd: number, readonly tx: number, readonly rx: number,
    private store: Map<string, number>,
  ) {
    super(comp);
    const v = store.get(`${comp.id}:vcc`) ?? 0;
    this.powered = v >= ELRS.vMin && v <= ELRS.vAbsMax;
  }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.vcc, this.gnd, 1 / ELRS.rLoad);
    sys.addConductance(this.rx, this.gnd, 1 / ELRS.rRx);
    if (this.powered) stampFloatingSource(sys, this.tx, this.gnd, ELRS.vTx, ELRS.rTx);
    return false;
  }
  measure(V: Volt) {
    const v = V(this.vcc) - V(this.gnd);
    this.rxPeak = Math.max(this.rxPeak, V(this.rx) - V(this.gnd));
    return { v, i: v / ELRS.rLoad, p: (v * v) / ELRS.rLoad };
  }
  commit(V: Volt) { this.store.set(`${this.comp.id}:vcc`, V(this.vcc) - V(this.gnd)); }
}

// WS2812B strip: each pixel draws its idle current plus up to `iChannel` per lit colour channel.
// The frame comes from the sketch (Adafruit_NeoPixel::show) on the GPIO wired to DIN, so the
// supply load follows what is lit; DIN itself is a high-impedance input.
class NeoPixelDev extends Device {
  pin?: number; // GPIO driving DIN
  frame?: number[];
  private iLoad = NEOPIXEL.count * NEOPIXEL.iIdle;
  constructor(comp: ExternalComponent, readonly vdd: number, readonly din: number, readonly gnd: number) { super(comp); }
  setFrame(pin: number | undefined, frame: number[] | undefined) {
    this.pin = pin;
    this.frame = frame;
    let i = NEOPIXEL.count * NEOPIXEL.iIdle;
    for (const c of (frame ?? []).slice(0, NEOPIXEL.count)) {
      i += (((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)) / 255 * NEOPIXEL.iChannel;
    }
    this.iLoad = i;
  }
  private get g() { return this.iLoad / NEOPIXEL.vNominal; }
  stamp(sys: NodalSystem) {
    sys.addConductance(this.vdd, this.gnd, this.g);
    sys.addConductance(this.din, this.gnd, 1 / NEOPIXEL.rDin);
    return false;
  }
  measure(V: Volt) {
    const v = V(this.vdd) - V(this.gnd);
    return { v, i: v * this.g, p: v * v * this.g, vdin: V(this.din) - V(this.gnd) };
  }
}

class SourceDev {
  constructor(readonly node: number, readonly kind: 'rail' | 'gpio', readonly name: string, readonly r: number, private vOf: (ctx: Ctx) => number) {}
  voltage(ctx: Ctx) { return this.vOf(ctx); }
  stamp(sys: NodalSystem, ctx: Ctx) { sys.addTheveninToGround(this.node, this.voltage(ctx), this.r); }
  current(V: Volt, ctx: Ctx) { return (this.voltage(ctx) - V(this.node)) / this.r; }
}

// ---------------------------------------------------------------------------
// Netlist
// ---------------------------------------------------------------------------

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    while (p !== x) {
      const gp = this.parent.get(p)!;
      this.parent.set(x, gp);
      x = p;
      p = this.parent.get(x)!;
    }
    return x;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function breadboardGroups(): string[][] {
  const groups: string[][] = [];
  for (const rail of ['L_neg', 'L_pos', 'R_pos', 'R_neg']) groups.push(Array.from({ length: 25 }, (_, i) => `${rail}_${i}`));
  for (let r = 0; r < 30; r++) {
    groups.push(Array.from({ length: 5 }, (_, c) => `rowL_${r}_${c}`));
    groups.push(Array.from({ length: 5 }, (_, c) => `rowR_${r}_${c}`));
  }
  return groups;
}
const BREADBOARD_GROUPS = breadboardGroups();

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

interface Heat { level: number }

// Thermal stress model: above its rating a part heats up (faster the higher the overload)
// and burns once `level` reaches 1; far above it, it fails immediately.
const DAMAGE = {
  LED: { tau: 0.5, instant: 3.3 },
  Resistor: { tau: 2, instant: 8 },
  Potentiometer: { tau: 1, instant: 8 },
  Diode: { tau: 1, instant: 20 },
  Transistor: { tau: 1, instant: 4 },
  Capacitor: { tau: 0.3, instant: 3 },
  Servo: { tau: 0.05, instant: 1.0001 },
  OLED: { tau: 0.05, instant: 1.0001 },
  NeoPixel: { tau: 0.05, instant: 1.0001 },
  LiPo: { tau: 2, instant: 4 },
  ESC: { tau: 1, instant: 3 },
  IMU: { tau: 0.05, instant: 1.0001 },
  ELRS: { tau: 0.05, instant: 1.0001 },
} as Record<string, { tau: number; instant: number }>;

export class CircuitSimulator {
  private store = new Map<string, number>(); // reactive + junction state, survives rebuilds
  private heat = new Map<string, Heat>();
  private tripped = new Set<RailName>();
  private trippedSignature = '';
  private floatingBits = new Map<number, { digital: 0 | 1; analog: number; next: number }>();
  private lastDigital = new Map<number, 0 | 1>();
  private time = 0;

  step(input: SimInput, elapsed: number): SimOutput {
    this.time += elapsed;
    const board = input.board;
    const net = this.build(input);
    const signature = net.signature;
    if (signature !== this.trippedSignature) this.tripped.clear(); // re-arm after rewiring

    const reactive = net.devices.some(d => d.reactive);
    const nSub = reactive ? Math.min(20, Math.max(1, Math.ceil(elapsed / 0.001))) : 1;
    const dt = Math.max(elapsed / nSub, 1e-5);
    const pwmSources = net.gpio.filter(s => s.duty > 0 && s.duty < 1);
    const duty = pwmSources.length ? pwmSources.reduce((a, s) => a + s.duty, 0) / pwmSources.length : 1;

    let vHigh: Float64Array = new Float64Array(net.n);
    let vLow = vHigh;
    let sysHigh: NodalSystem | null = null;
    const burnt: { id: string; reason: string }[] = [];
    const measures = new Map<Device, Measure>();

    for (let s = 0; s < nSub; s++) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const high = this.newton(net, { dt, high: true }, vHigh);
        vHigh = high.v; sysHigh = high.sys;
        vLow = pwmSources.length ? this.newton(net, { dt, high: false }, vLow).v : vHigh;
        // Rail protection: an overloaded rail switches off (USB-C input switch / LDO limit).
        const Vh = nodeFn(vHigh);
        const over = net.sources.filter(r => r.kind === 'rail' && !this.tripped.has(r.name as RailName) && Math.abs(r.current(Vh, { dt, high: true })) > (board.rails[r.name as RailName]?.iLimit ?? Infinity));
        if (!over.length) break;
        over.forEach(r => this.tripped.add(r.name as RailName));
        this.trippedSignature = signature;
      }
      const Vh = nodeFn(vHigh), Vl = nodeFn(vLow);
      const Vavg: Volt = n => duty * Vh(n) + (1 - duty) * Vl(n);
      for (const d of net.devices) {
        const m = this.mix(d.measure(Vh, { dt, high: true }), pwmSources.length ? d.measure(Vl, { dt, high: false }) : null, duty);
        measures.set(d, m);
        const reason = this.accumulateHeat(d.comp, m, dt);
        if (reason && !burnt.some(b => b.id === d.comp.id)) burnt.push({ id: d.comp.id, reason });
      }
      for (const d of net.devices) d.commit(Vavg, { dt, high: true });
    }

    const Vh = nodeFn(vHigh), Vl = nodeFn(vLow);
    const ctxH = { dt, high: true }, ctxL = { dt, high: false };
    const Vavg: Volt = n => duty * Vh(n) + (1 - duty) * Vl(n);
    const out: SimOutput = { comps: {}, pins: {}, warnings: [], burnt };
    const names = displayNames(input.components);

    // Component results
    for (const d of net.devices) out.comps[d.comp.id] = this.describe(d, measures.get(d)!, net, names, out.warnings);
    // Paralleled BECs fight each other: only one ESC's red wire should power the board.
    const becs = new Map<number, string[]>();
    for (const d of net.devices) {
      if (d instanceof EscDev && d.powered && d.bec >= 0) becs.set(d.bec, [...(becs.get(d.bec) ?? []), names[d.comp.id]]);
    }
    for (const list of becs.values()) {
      if (list.length > 1) out.warnings.push({ key: `bec:${list.join(',')}`, level: 'warn', text: `The BECs of ${list.join(' and ')} are wired together: connect the 5 V (red) wire of only one ESC.` });
    }
    for (const c of input.components) {
      if (c.damaged) {
        out.comps[c.id] = { v: 0, i: 0, p: 0, stress: 0 };
        out.warnings.push({ key: `burnt:${c.id}`, level: 'error', compId: c.id, text: `${names[c.id]} is burnt out${c.damageNote ? ` (${c.damageNote})` : ''}. Select it and press Replace.` });
      }
    }

    // Board pins
    for (const src of net.gpio) {
      const v = Vavg(src.node);
      const iH = src.dev.current(Vh, ctxH);
      const iL = src.dev.current(Vl, ctxL);
      const isPwm = pwmSources.includes(src);
      const current = isPwm ? src.duty * iH + (1 - src.duty) * iL : iH;
      out.pins[src.pin] = this.readPin(board, src.pin, v, current, false);
      const peak = isPwm && Math.abs(iL) > Math.abs(iH) ? iL : iH;
      if (src.mode === PIN_MODE.OUTPUT && Math.abs(peak) > board.iRated) {
        const abs = Math.abs(peak);
        const absMax = peak < 0 ? board.iSinkMax : board.iSourceMax;
        out.warnings.push({
          key: `pin-i:${src.pin}`, level: abs > absMax ? 'error' : 'warn',
          text: `${board.gpioName(src.pin)} ${peak < 0 ? 'sinks' : 'sources'} ${formatSI(abs, 'A')}, over the ${formatSI(board.iRated, 'A')} a pin can handle${abs > absMax ? ' (this damages the MCU)' : ''}. Add a resistor, or use a transistor for loads like motors.`,
        });
      }
    }
    for (const [pin, node] of net.gpioNodes) {
      const drive = input.running ? input.pins.get(pin) : undefined;
      const mode = drive?.mode ?? PIN_MODE.INPUT;
      if (mode === PIN_MODE.OUTPUT) continue;
      const v = Vavg(node);
      let floating = false;
      if (sysHigh && node >= 0 && mode === PIN_MODE.INPUT) {
        const e = new Float64Array(net.n); e[node] = 1;
        const x = sysHigh.solve(e);
        floating = !x || x[node] > FLOATING_R;
      }
      if (!out.pins[pin]) out.pins[pin] = this.readPin(board, pin, v, 0, floating);
      if (floating && input.running && input.pins.has(pin)) {
        out.warnings.push({ key: `float:${pin}`, level: 'warn', text: `${board.gpioName(pin)} is floating: its reading is random. Add a pull-down/pull-up resistor (e.g. 10 kΩ) or use INPUT_PULLUP.` });
      }
      const vMax = board.maxInputVoltage(pin);
      if (v > vMax + 0.05) {
        out.warnings.push({ key: `pin-v:${pin}`, level: 'error', text: `${board.gpioName(pin)} sees ${formatSI(v, 'V')}: above its ${vMax} V limit${board.overVoltageNote?.(pin) ?? ''}.` });
      }
    }
    for (const rail of this.tripped) {
      out.warnings.push({ key: `rail:${rail}`, level: 'error', text: `Short circuit on the ${rail} rail: its protection switched it off. Remove the short to restore it.` });
    }
    return out;
  }

  private readPin(board: BoardElectrical, pin: number, v: number, current: number, floating: boolean): PinReading {
    if (floating) {
      // An unconnected CMOS input picks up noise: the reading wanders.
      let f = this.floatingBits.get(pin);
      if (!f || this.time >= f.next) {
        f = { digital: Math.random() < 0.5 ? 0 : 1, analog: Math.round(800 + Math.random() * 1700), next: this.time + 0.08 + Math.random() * 0.3 };
        this.floatingBits.set(pin, f);
      }
      return { v, digital: f.digital, analog: f.analog, floating, current };
    }
    const prev = this.lastDigital.get(pin) ?? 0;
    const digital: 0 | 1 = v >= 0.7 * board.vddIo ? 1 : v <= 0.3 * board.vddIo ? 0 : prev; // Schmitt trigger
    this.lastDigital.set(pin, digital);
    const analog = Math.round(Math.min(board.vddIo, Math.max(0, v)) * 1000);
    return { v, digital, analog, floating, current };
  }

  private mix(a: Measure, b: Measure | null, duty: number): Measure {
    if (!b) return a;
    const out: Measure = {};
    for (const k of Object.keys(a)) out[k] = duty * a[k] + (1 - duty) * (b[k] ?? 0);
    return out;
  }

  // Returns a reason string when the part burns out during this step.
  private accumulateHeat(comp: ExternalComponent, m: Measure, dt: number): string | null {
    const spec = DAMAGE[comp.type];
    if (!spec) return null;
    const { ratio, reason } = stressOf(comp, m);
    let h = this.heat.get(comp.id);
    if (!h) { h = { level: 0 }; this.heat.set(comp.id, h); }
    if (ratio >= spec.instant) { h.level = 0; return reason; }
    if (ratio > 1) h.level += (dt * (ratio - 1)) / spec.tau;
    else h.level = Math.max(0, h.level - dt / (spec.tau * 4));
    if (h.level >= 1) { h.level = 0; return reason; }
    return null;
  }

  private newton(net: Netlist, ctx: Ctx, guess: Float64Array): { v: Float64Array; sys: NodalSystem | null } {
    if (net.n === 0) return { v: guess, sys: null };
    const sys = new NodalSystem(net.n);
    let v: Float64Array = guess.length === net.n ? Float64Array.from(guess) : new Float64Array(net.n);
    let last: NodalSystem | null = null;
    for (let it = 0; it < 200; it++) {
      sys.clear();
      for (let k = 0; k < net.n; k++) sys.addJ(k, k, GMIN);
      const V = nodeFn(v);
      let limited = false;
      for (const s of net.sources) {
        if (s.kind === 'rail' && this.tripped.has(s.name as RailName)) continue;
        s.stamp(sys, ctx);
      }
      for (const d of net.devices) if (d.stamp(sys, V, ctx)) limited = true;
      const x = sys.solve();
      if (!x) break;
      let maxDelta = 0;
      for (let k = 0; k < net.n; k++) maxDelta = Math.max(maxDelta, Math.abs(x[k] - v[k]));
      v = x;
      last = sys;
      if (!limited && maxDelta < 1e-7) break;
    }
    return { v, sys: last };
  }

  private build(input: SimInput): Netlist {
    const uf = new UnionFind();
    const board = input.board;
    const roles = new Map<string, PinRole>();
    const boardKey = (pinId: string) => {
      let role = roles.get(pinId);
      if (!role) { role = board.pinRole(pinId, input.pinLabel(pinId)); roles.set(pinId, role); }
      switch (role.kind) {
        case 'gnd': return 'GND';
        case 'rail': return `RAIL:${role.rail}`;
        case 'gpio': return `GPIO:${role.pin}`;
        default: return `BOARD:${pinId}`;
      }
    };
    const key = (compId: string, pinId: string) => (compId === 'BOARD' ? boardKey(pinId) : `${compId}:${pinId}`);
    for (const w of input.wires) uf.union(key(w.startCompId, w.startPinId), key(w.endCompId, w.endPinId));
    for (const c of input.components) {
      if (c.type === 'Breadboard') {
        for (const g of BREADBOARD_GROUPS) for (let i = 1; i < g.length; i++) uf.union(`${c.id}:${g[0]}`, `${c.id}:${g[i]}`);
      }
      if (c.type === 'ESC') uf.union(`${c.id}:-`, `${c.id}:GND`); // signal GND = battery negative
    }

    const gndRoot = uf.find('GND');
    const index = new Map<string, number>();
    let n = 0;
    const nodeOfKey = (k: string) => {
      const root = uf.find(k);
      if (root === gndRoot) return -1;
      let i = index.get(root);
      if (i === undefined) { i = n++; index.set(root, i); }
      return i;
    };
    const node = (compId: string, pinId: string) => nodeOfKey(`${compId}:${pinId}`);
    // Every wired terminal gets a node, so e.g. a pin wired to an open button can still be read.
    for (const w of input.wires) { nodeOfKey(key(w.startCompId, w.startPinId)); nodeOfKey(key(w.endCompId, w.endPinId)); }
    const internal = () => n++;
    const devices: Device[] = [];

    for (const c of input.components) {
      if (c.damaged) continue;
      const p = (pin: string) => node(c.id, pin);
      switch (c.type) {
        case 'Resistor':
          devices.push(new ResistorDev(c, p('1'), p('2'), valueOr(c.value, 220, 1e-3)));
          break;
        case 'Button':
          if (c.state > 0) devices.push(new ResistorDev(c, p('1'), p('2'), BUTTON_R_ON));
          break;
        case 'Switch': // SPDT, common = middle pin; the knob sits towards pin 1 when off
          devices.push(new ResistorDev(c, p('2'), c.state > 0 ? p('3') : p('1'), BUTTON_R_ON));
          break;
        case 'Potentiometer':
          devices.push(new PotDev(c, p('1'), p('2'), p('3'), valueOr(c.value, 10e3, 1)));
          break;
        case 'Capacitor':
          devices.push(new CapacitorDev(c, p('+'), p('-'), valueOr(c.value, 100e-9, 1e-15), this.store));
          break;
        case 'Inductor':
          devices.push(new InductorDev(c, p('1'), p('2'), valueOr(c.value, 10e-6, 1e-12), this.store));
          break;
        case 'LED': {
          const color = ledColorOf(c.value);
          devices.push(new DiodeDev(c, p('A'), p('C'), internal(), LED.saturation(color), LED.n, LED.rs, this.store));
          break;
        }
        case 'Diode':
          devices.push(new DiodeDev(c, p('A'), p('K'), internal(), DIODE.is, DIODE.n, DIODE.rs, this.store));
          break;
        case 'Buzzer':
          devices.push(new DiodeDev(c, p('+'), p('-'), internal(), DIODE.is, DIODE.n, BUZZER.r, this.store));
          break;
        case 'Transistor':
          devices.push(new BjtDev(c, p('C'), p('B'), p('E'), this.store));
          break;
        case 'Motor':
          devices.push(new LoadDev(c, p('1'), p('2'), MOTOR.r));
          break;
        case 'Servo':
          devices.push(new LoadDev(c, p('VCC'), p('GND'), servoOf(c.value).rLoad, [[p('S'), p('GND'), SERVO.rSignal]]));
          break;
        case 'FSR': // pressed while the user holds it down (state 1), with the force in its value
          devices.push(new ResistorDev(c, p('1'), p('2'), c.state > 0 ? fsrResistance(fsrForceOf(c.value)) : FSR.rOpen));
          break;
        case 'NeoPixel':
          devices.push(new NeoPixelDev(c, p('5V'), p('DIN'), p('GND')));
          break;
        case 'Vibro':
          devices.push(new LoadDev(c, p('+'), p('-'), VIBRO.r));
          break;
        case 'OLED':
          devices.push(new LoadDev(c, p('VCC'), p('GND'), OLED.rLoad, [[p('SCL'), p('VCC'), OLED.rPullup], [p('SDA'), p('VCC'), OLED.rPullup]]));
          break;
        case 'LiPo': {
          const { cells, vCell, rCell } = lipoOf(c.value);
          devices.push(new LipoDev(c, p('+'), p('-'), cells * vCell, cells * rCell));
          break;
        }
        case 'ESC':
          devices.push(new EscDev(c, p('+'), p('-'), p('S'), p('5V'), escOf(c.value).iFull, this.store));
          break;
        case 'IMU':
          devices.push(new ImuDev(c, p('VCC'), p('GND'), p('SCL'), p('SDA'), p('INT'), this.store));
          break;
        case 'ELRS':
          devices.push(new ElrsDev(c, p('5V'), p('GND'), p('TX'), p('RX'), this.store));
          break;
      }
    }

    // Board sources only where something is actually connected.
    const sources: SourceDev[] = [];
    const gpio: GpioInfo[] = [];
    const gpioNodes = new Map<number, number>();
    // A board terminal wired straight to GND sits on node -1 (its source then sees a dead short).
    // (An unreferenced key is its own singleton root, so it gets no node and no source.)
    const boardNode = (k: string) => {
      const root = uf.find(k);
      return root === gndRoot ? -1 : index.get(root);
    };
    for (const [rail, spec] of Object.entries(board.rails) as [RailName, { v: number; r: number }][]) {
      const i = boardNode(`RAIL:${rail}`);
      if (i !== undefined) sources.push(new SourceDev(i, 'rail', rail, spec.r, () => spec.v));
    }
    for (let pin = 0; pin <= board.maxGpio; pin++) {
      const i = boardNode(`GPIO:${pin}`);
      if (i !== undefined) gpioNodes.set(pin, i);
    }
    for (const [pin, nodeIdx] of gpioNodes) {
      const drive = input.running ? input.pins.get(pin) : undefined;
      const mode = drive?.mode ?? PIN_MODE.INPUT;
      const duty = drive?.duty ?? 0;
      const freq = drive?.freq;
      let dev: SourceDev | null = null;
      if (mode === PIN_MODE.OUTPUT) {
        dev = new SourceDev(nodeIdx, 'gpio', board.gpioName(pin), board.gpioROut, ctx => (duty >= 1 ? board.vddIo : duty <= 0 ? 0 : ctx.high ? board.vddIo : 0));
      } else if (mode === PIN_MODE.INPUT_PULLUP) {
        dev = new SourceDev(nodeIdx, 'gpio', board.gpioName(pin), board.pullR, () => board.vddIo);
      } else if (mode === PIN_MODE.INPUT_PULLDOWN) {
        dev = new SourceDev(nodeIdx, 'gpio', board.gpioName(pin), board.pullR, () => 0);
      }
      if (dev) {
        sources.push(dev);
        gpio.push({ pin, node: nodeIdx, mode, duty: mode === PIN_MODE.OUTPUT ? duty : 1, freq, dev });
      }
    }
    for (const d of devices) {
      if (d instanceof EscDev) {
        const driver = gpio.find(g => g.node === d.s && g.mode === PIN_MODE.OUTPUT);
        d.setDuty(driver?.duty ?? 0, driver?.freq);
      }
      if (d instanceof NeoPixelDev) {
        const pin = dataPinOf(d.din, devices, gpioNodes);
        d.setFrame(pin, pin !== undefined && input.running ? input.pixels?.get(pin) : undefined);
      }
    }

    const signature = input.wires.map(w => `${w.startCompId}:${w.startPinId}-${w.endCompId}:${w.endPinId}`).sort().join('|')
      + '#' + input.components.map(c => `${c.id}:${c.value ?? ''}:${c.damaged ? 1 : 0}`).sort().join('|');
    return { n, devices, sources, gpio, gpioNodes, i2c: board.i2c, vddIo: board.vddIo, signature };
  }

  private describe(d: Device, m: Measure, net: Netlist, names: Record<string, string>, warnings: SimWarning[]): CompResult {
    const c = d.comp;
    const name = names[c.id];
    const { ratio } = stressOf(c, m);
    const r: CompResult = { v: m.v, i: m.i, p: m.p, stress: ratio };
    switch (c.type) {
      case 'LED': {
        const color = ledColorOf(c.value);
        r.color = LED_COLORS[color].color;
        r.brightness = Math.max(0, m.i) / LED.iRated;
        if (m.i > LED.iRated * 1.02) {
          warnings.push({ key: `led:${c.id}`, level: m.i > LED.iAbsMax ? 'error' : 'warn', compId: c.id, text: `${name}: ${formatSI(m.i, 'A')} is over its ${formatSI(LED.iRated, 'A')} rating${m.i > LED.iAbsMax ? ' — it is burning' : ''}. Add a series resistor (≈ ${suggestResistor(color)} for 5 V, 68 Ω–150 Ω for a 3.3 V pin).` });
        }
        if (-m.v > LED.vReverseMax * 0.9) {
          warnings.push({ key: `ledrev:${c.id}`, level: 'warn', compId: c.id, text: `${name} is reverse biased at ${formatSI(-m.v, 'V')} (max ${LED.vReverseMax} V).` });
        }
        break;
      }
      case 'Resistor':
      case 'Potentiometer':
        if (ratio > 1) warnings.push({ key: `hot:${c.id}`, level: 'error', compId: c.id, text: `${name} dissipates ${formatSI(m.p, 'W')}, more than its ${formatSI(c.type === 'Resistor' ? RESISTOR_P_MAX : POT_P_MAX, 'W')} rating: it is overheating.` });
        break;
      case 'Transistor':
        r.extra = { ib: m.ib, vbe: m.vbe };
        if (ratio > 1) warnings.push({ key: `bjt:${c.id}`, level: 'error', compId: c.id, text: `${name} is overloaded (Ic ${formatSI(m.i, 'A')}, ${formatSI(m.p, 'W')}): max ${formatSI(BJT.icMax, 'A')} / ${formatSI(BJT.pMax, 'W')}.` });
        break;
      case 'Capacitor':
        if (valueOr(c.value, 100e-9, 1e-15) >= ELECTROLYTIC_MIN_C && m.v < -0.5) {
          warnings.push({ key: `cap:${c.id}`, level: 'error', compId: c.id, text: `${name} is an electrolytic connected backwards (${formatSI(m.v, 'V')}): it will burst. Put + towards the higher voltage.` });
        }
        break;
      case 'Buzzer':
        r.sounding = m.i > BUZZER.iSound;
        break;
      case 'Motor': {
        const mag = Math.abs(m.i) < MOTOR.iStart ? 0 : Math.min(1, (Math.abs(m.i) - MOTOR.iStart) / (MOTOR.iFull - MOTOR.iStart) + 0.15);
        r.speed = Math.sign(m.i) * mag;
        if (Math.abs(m.i) > 0.005 && mag === 0) warnings.push({ key: `motor:${c.id}`, level: 'warn', compId: c.id, text: `${name} gets ${formatSI(Math.abs(m.i), 'A')}: not enough to start (needs ≈ ${formatSI(MOTOR.iStart, 'A')}). Drive it from 5 V through a transistor.` });
        break;
      }
      case 'Servo': {
        const model = servoOf(c.value);
        r.powered = m.v >= model.vMin && m.v <= model.vMax;
        const sNode = (d as LoadDev).extra[0][0];
        const driver = net.gpio.find(g => g.node === sNode && g.mode === PIN_MODE.OUTPUT);
        const freq = driver?.freq;
        if (driver && freq) {
          // Real servo signal (ledcAttach / ESP32Servo): the pulse width sets the angle.
          const pulse = (driver.duty * 1e6) / freq;
          r.extra = { pulse };
          const valid = freq >= SERVO_PULSE.freqMin && freq <= SERVO_PULSE.freqMax && pulse >= SERVO_PULSE.validMinUs && pulse <= SERVO_PULSE.validMaxUs;
          const pos = Math.min(1, Math.max(0, (pulse - SERVO_PULSE.minUs) / (SERVO_PULSE.maxUs - SERVO_PULSE.minUs)));
          r.angle = r.powered && valid ? Math.round(pos * 255) : undefined;
          if (!valid && driver.duty > 0) warnings.push({ key: `servo-sig:${c.id}`, level: 'warn', compId: c.id, text: `${name}: ${Math.round(pulse)} µs pulses at ${Math.round(freq)} Hz are not a servo signal. Send ${SERVO_PULSE.minUs}–${SERVO_PULSE.maxUs} µs pulses at 50 Hz (e.g. ESP32Servo, or ledcAttach(pin, 50, 16)).` });
        } else {
          r.angle = r.powered && driver ? Math.round(driver.duty * 255) : undefined;
        }
        if (!r.powered && Math.abs(m.v) > 0.5 && m.v < model.vMin) warnings.push({ key: `servo:${c.id}`, level: 'warn', compId: c.id, text: `${name} needs ${model.vMin}–${model.vMax} V on VCC (has ${formatSI(m.v, 'V')}). ${model.vMin < 3.7 ? 'Use a 1S LiPo or the 5V pin.' : 'Use the 5V pin.'}` });
        break;
      }
      case 'FSR': {
        const pressed = c.state > 0;
        const rFsr = pressed ? fsrResistance(fsrForceOf(c.value)) : FSR.rOpen;
        r.extra = { force: pressed ? fsrForceOf(c.value) : 0, rfsr: rFsr };
        if (ratio > 1) warnings.push({ key: `fsr:${c.id}`, level: 'warn', compId: c.id, text: `${name} carries ${formatSI(Math.abs(m.i), 'A')}, over the ≈ ${formatSI(FSR.iMax, 'A')} it is rated for. Read it through a divider (e.g. 10 kΩ to GND), not straight across the supply.` });
        break;
      }
      case 'NeoPixel': {
        const strip = d as NeoPixelDev;
        r.powered = m.v >= NEOPIXEL.vMin && m.v <= NEOPIXEL.vMax;
        r.pixels = r.powered && strip.frame ? strip.frame.slice(0, NEOPIXEL.count) : undefined;
        r.extra = { lit: (strip.frame ?? []).slice(0, NEOPIXEL.count).filter(px => px & 0xffffff).length };
        if (!r.powered && m.v > 0.5 && m.v < NEOPIXEL.vMin) warnings.push({ key: `np-v:${c.id}`, level: 'warn', compId: c.id, text: `${name} needs ${NEOPIXEL.vMin}–${NEOPIXEL.vMax} V on 5V (has ${formatSI(m.v, 'V')}). Use a 1S LiPo or the 5V pin.` });
        if (r.powered && strip.pin !== undefined && net.vddIo < NEOPIXEL.vihRatio * m.v) {
          warnings.push({ key: `np-din:${c.id}`, level: 'warn', compId: c.id, text: `${name}: at ${formatSI(m.v, 'V')} DIN needs ${formatSI(NEOPIXEL.vihRatio * m.v, 'V')} for a high level, more than the ${net.vddIo} V pin gives. Power the strip from a LiPo (≤ 4.7 V) or add a level shifter.` });
        }
        break;
      }
      case 'Vibro': {
        const mag = Math.abs(m.i) < VIBRO.iStart ? 0 : Math.min(1, (Math.abs(m.i) - VIBRO.iStart) / (VIBRO.iFull - VIBRO.iStart) + 0.3);
        r.speed = mag;
        if (Math.abs(m.v) > VIBRO.vMax + 0.1) warnings.push({ key: `vibro:${c.id}`, level: 'warn', compId: c.id, text: `${name} gets ${formatSI(Math.abs(m.v), 'V')}: it is a 3 V motor (max ${VIBRO.vMax} V). Power it from a 1S LiPo or 3V3.` });
        break;
      }
      case 'OLED':
        r.powered = m.v >= OLED.vMin && m.v <= OLED.vMax;
        break;
      case 'LiPo': {
        const { cells, vCell, iMax } = lipoOf(c.value);
        r.extra = { vcell: m.v / cells };
        if (ratio > 1) warnings.push({ key: `lipo-i:${c.id}`, level: 'error', compId: c.id, text: `${name} delivers ${formatSI(m.i, 'A')}, over its ${formatSI(iMax, 'A')} rating: it is overheating. A shorted LiPo can catch fire.` });
        if (vCell < LIPO.vCellEmpty) {
          warnings.push({ key: `lipo-low:${c.id}`, level: 'warn', compId: c.id, text: `${name} is over-discharged (${formatSI(vCell, 'V')} per cell): below ${LIPO.vCellEmpty} V a LiPo cell is damaged. Recharge it.` });
        } else if (vCell > LIPO.vCellHv + 0.005) {
          warnings.push({ key: `lipo-high:${c.id}`, level: 'warn', compId: c.id, text: `${name} is overcharged (${formatSI(vCell, 'V')} per cell): a LiPo cell stops at ${LIPO.vCellFull} V (${LIPO.vCellHv} V for LiHV).` });
        }
        break;
      }
      case 'ESC': {
        const esc = d as EscDev;
        const powered = m.v >= ESC.vMin && m.v <= ESC.vAbsMax;
        const driver = net.gpio.find(g => g.node === esc.s && g.mode === PIN_MODE.OUTPUT);
        const duty = driver?.duty ?? 0;
        const freq = driver?.freq;
        const seen = esc.signalPeak >= ESC.vSignalHigh;
        const throttle = powered && seen ? escThrottle(duty, freq) : 0;
        const pulse = escPulseUs(duty, freq);
        r.powered = powered;
        r.speed = escOf(c.value).dir * throttle;
        r.extra = { throttle, ibec: m.ibec, ...(pulse !== undefined ? { pulse } : {}) };
        if (freq && duty > 0 && (freq < ESC.pulse.freqMin || freq > ESC.pulse.freqMax)) {
          warnings.push({ key: `esc-freq:${c.id}`, level: 'warn', compId: c.id, text: `${name}: a ${Math.round(freq)} Hz PWM is not an ESC signal. Send ${ESC.pulse.minUs}–${ESC.pulse.maxUs} µs pulses at ${ESC.pulse.freqMin}–${ESC.pulse.freqMax} Hz, e.g. ledcAttach(pin, 400, 14).` });
        } else if (pulse !== undefined && duty > 0 && duty < 1 && (pulse < ESC.pulse.validMinUs || pulse > ESC.pulse.validMaxUs)) {
          warnings.push({ key: `esc-pulse:${c.id}`, level: 'warn', compId: c.id, text: `${name}: ${Math.round(pulse)} µs pulses are outside the ${ESC.pulse.minUs}–${ESC.pulse.maxUs} µs an ESC reads, so the motor stays off.` });
        }
        if (!powered && m.v > -0.5 && m.v < ESC.vMin && (driver || m.v > 0.5)) {
          warnings.push({ key: `esc-pwr:${c.id}`, level: 'warn', compId: c.id, text: `${name} has no battery power (${formatSI(m.v, 'V')} on + and -): it needs a 2S–6S LiPo (${ESC.vMin}–${ESC.vMax} V).` });
        }
        if (powered && duty >= ESC.deadband && !seen) {
          warnings.push({ key: `esc-gnd:${c.id}`, level: 'warn', compId: c.id, text: `${name} does not see the throttle signal: wire its GND to the board GND (the signal needs a common ground).` });
        }
        if (esc.signalPeak > ESC.vSignalMax + 0.05) {
          warnings.push({ key: `esc-sig:${c.id}`, level: 'error', compId: c.id, text: `${name}: the signal input sees ${formatSI(esc.signalPeak, 'V')}, over the ${ESC.vSignalMax} V it accepts. Drive S from a board pin.` });
        }
        if (m.ibec > ESC.bec.iMax) {
          warnings.push({ key: `esc-bec:${c.id}`, level: 'error', compId: c.id, text: `${name}: its BEC delivers ${formatSI(m.ibec, 'A')}, over its ${formatSI(ESC.bec.iMax, 'A')} rating. Check the 5V wire for a short.` });
        }
        if (m.i > ESC.iRated) {
          warnings.push({ key: `esc-i:${c.id}`, level: 'error', compId: c.id, text: `${name} draws ${formatSI(m.i, 'A')}, over its ${formatSI(ESC.iRated, 'A')} rating: it is overheating. Use a smaller motor/prop.` });
        }
        break;
      }
      case 'IMU': {
        const imu = d as ImuDev;
        r.powered = m.v >= IMU.vMin && m.v <= IMU.vMax;
        if (!r.powered && m.v > 0.5 && m.v < IMU.vMin) warnings.push({ key: `imu:${c.id}`, level: 'warn', compId: c.id, text: `${name} needs ${IMU.vMin}–${IMU.vMax} V on VCC (has ${formatSI(m.v, 'V')}). Use the 3V3 or 5V pin.` });
        const sda = net.gpioNodes.get(net.i2c.sda), scl = net.gpioNodes.get(net.i2c.scl); // A4, A5
        const onBus = imu.sda >= 0 && imu.scl >= 0 && imu.sda !== imu.scl && imu.sda === sda && imu.scl === scl;
        if (r.powered && onBus) r.i2c = [IMU.address];
        if (imu.sda >= 0 && imu.scl >= 0 && imu.sda === scl && imu.scl === sda) {
          warnings.push({ key: `imu-swap:${c.id}`, level: 'warn', compId: c.id, text: `${name}: SDA and SCL are swapped. SDA goes to A4, SCL to A5.` });
        }
        break;
      }
      case 'ELRS': {
        const rx = d as ElrsDev;
        r.powered = m.v >= ELRS.vMin && m.v <= ELRS.vMax;
        if (!r.powered && m.v > 0.5 && m.v < ELRS.vMin) warnings.push({ key: `elrs:${c.id}`, level: 'warn', compId: c.id, text: `${name} needs ${ELRS.vMin}–${ELRS.vMax} V on 5V (has ${formatSI(m.v, 'V')}). Use the board's 5V pin or a BEC.` });
        if (rx.rxPeak > ELRS.vRxMax) warnings.push({ key: `elrs-rx:${c.id}`, level: 'error', compId: c.id, text: `${name}: its RX pin sees ${formatSI(rx.rxPeak, 'V')}, but the receiver runs at 3.3 V and is not 5 V tolerant.` });
        if ((rx.tx >= 0 && net.gpioNodes.get(1) === rx.tx) || (rx.rx >= 0 && net.gpioNodes.get(0) === rx.rx)) {
          warnings.push({ key: `elrs-swap:${c.id}`, level: 'warn', compId: c.id, text: `${name}: TX and RX are swapped. The receiver's TX goes to D0 (RX), its RX to D1 (TX).` });
        }
        break;
      }
    }
    return r;
  }
}

interface GpioInfo { pin: number; node: number; mode: number; duty: number; freq?: number; dev: SourceDev }
interface Netlist {
  n: number;
  devices: Device[];
  sources: SourceDev[];
  gpio: GpioInfo[];
  gpioNodes: Map<number, number>;
  i2c: { sda: number; scl: number };
  vddIo: number; // the board's GPIO high level
  signature: string;
}

// GPIO driving a data input such as a WS2812B's DIN, which is usually fed through a series
// resistor (300-500 Ω): follow resistors up to 10 kΩ, a few hops at most.
function dataPinOf(node: number, devices: Device[], gpioNodes: Map<number, number>): number | undefined {
  if (node < 0) return undefined;
  const pinAt = new Map([...gpioNodes].map(([pin, n]) => [n, pin]));
  const series = devices.filter((d): d is ResistorDev => d instanceof ResistorDev && d.r <= 10e3);
  const seen = new Set([node]);
  let frontier = [node];
  for (let hop = 0; hop < 3 && frontier.length; hop++) {
    for (const n of frontier) if (pinAt.has(n)) return pinAt.get(n);
    frontier = series.flatMap(r => (frontier.includes(r.a) ? [r.b] : frontier.includes(r.b) ? [r.a] : [])).filter(n => n >= 0 && !seen.has(n));
    frontier.forEach(n => seen.add(n));
  }
  for (const n of frontier) if (pinAt.has(n)) return pinAt.get(n);
  return undefined;
}

function nodeFn(v: Float64Array): Volt {
  return node => (node < 0 ? 0 : v[node] ?? 0);
}

// Worst ratio between what the part withstands and what it gets.
function stressOf(c: ExternalComponent, m: Measure): { ratio: number; reason: string } {
  switch (c.type) {
    case 'LED':
      if (-m.v > LED.vReverseMax * 1.6) return { ratio: 99, reason: `reverse voltage ${formatSI(-m.v, 'V')}` };
      return { ratio: Math.max(0, m.i) / LED.iAbsMax, reason: `${formatSI(m.i, 'A')} without a current-limiting resistor` };
    case 'Resistor':
      return { ratio: m.p / RESISTOR_P_MAX, reason: `${formatSI(m.p, 'W')} on a ${formatSI(RESISTOR_P_MAX, 'W')} resistor` };
    case 'Potentiometer':
      return { ratio: m.sect ?? 0, reason: `${formatSI(m.p, 'W')} through the track` };
    case 'Diode':
      return { ratio: Math.abs(m.i) / DIODE.iMax, reason: `${formatSI(m.i, 'A')} forward current` };
    case 'Transistor':
      return { ratio: Math.max(Math.abs(m.i) / BJT.icMax, m.p / BJT.pMax), reason: `Ic ${formatSI(m.i, 'A')}, ${formatSI(m.p, 'W')}` };
    case 'Capacitor':
      if (valueOr(c.value, 100e-9, 1e-15) < ELECTROLYTIC_MIN_C) return { ratio: 0, reason: '' };
      return { ratio: Math.max(0, -m.v), reason: `electrolytic reversed at ${formatSI(m.v, 'V')}` };
    case 'Servo':
      return { ratio: m.v / servoOf(c.value).vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    case 'FSR':
      return { ratio: Math.abs(m.i) / FSR.iMax, reason: `${formatSI(Math.abs(m.i), 'A')} through the sensor` };
    case 'NeoPixel':
      return { ratio: m.v / NEOPIXEL.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    case 'Vibro':
      return { ratio: Math.abs(m.v) / VIBRO.vAbsMax, reason: `${formatSI(Math.abs(m.v), 'V')} on a 3 V motor` };
    case 'OLED':
      return { ratio: m.v / OLED.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    case 'LiPo':
      return { ratio: Math.abs(m.i) / lipoOf(c.value).iMax, reason: `${formatSI(Math.abs(m.i), 'A')} short-circuit current` };
    case 'ESC':
      if (m.v < -0.5) return { ratio: 99, reason: `battery connected backwards (${formatSI(m.v, 'V')})` };
      if (m.v > ESC.vAbsMax) return { ratio: 99, reason: `${formatSI(m.v, 'V')} battery, over 6S` };
      return { ratio: Math.max(m.v / ESC.vAbsMax, m.i / ESC.iRated), reason: `${formatSI(m.i, 'A')} motor current` };
    case 'IMU':
      return { ratio: m.v / IMU.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    case 'ELRS':
      return { ratio: m.v / ELRS.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    default:
      return { ratio: 0, reason: '' };
  }
}

export function displayNames(components: ExternalComponent[]): Record<string, string> {
  const count: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const c of components) {
    count[c.type] = (count[c.type] ?? 0) + 1;
    names[c.id] = `${c.type} ${count[c.type]}`;
  }
  return names;
}

function suggestResistor(color: keyof typeof LED_COLORS): string {
  const r = (5 - LED_COLORS[color].vf) / 0.015;
  const e12 = [100, 120, 150, 180, 220, 270, 330, 390, 470];
  return `${e12.find(x => x >= r) ?? 470} Ω`;
}
