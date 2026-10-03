// Real-time electrical simulation of the breadboard circuit attached to the UNO Q.
//
// Each tick the circuit is rebuilt from components/wires, then integrated in time with
// backward-Euler steps (capacitors/inductors) and solved with Newton-Raphson (LEDs, diodes,
// transistors). The results drive the 3D view, feed digitalRead()/analogRead() of the sketch,
// and decide when a part is over-stressed and burns out.
import type { ExternalComponent, Wire } from '../App';
import { NodalSystem, limexp, pnjlim } from './solver';
import {
  VDD_IO, GPIO_R_OUT, GPIO_I_RATED, GPIO_I_ABS_MAX, PULL_R, V_IH, V_IL, ADC_MAX, PIN_MODE,
  RAILS, RailName, pinRole, gpioName, gpioMaxInputVoltage,
} from './board';
import {
  VT, LED, LED_COLORS, ledColorOf, DIODE, BJT, RESISTOR_P_MAX, POT_P_MAX, BUTTON_R_ON, BUZZER,
  MOTOR, SERVO, OLED, INDUCTOR_DCR, ELECTROLYTIC_MIN_C, valueOr,
} from './components';
import { formatSI } from './units';

export interface PinDrive {
  mode: number; // PIN_MODE
  duty: number; // OUTPUT level: 0 = LOW, 1 = HIGH, in between = PWM (analogWrite)
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
  extra?: Record<string, number>;
}

export interface PinReading {
  v: number;
  digital: 0 | 1;
  analog: number;
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
  components: ExternalComponent[];
  wires: Wire[];
  pinLabel: (pinId: string) => string;
  pins: Map<number, PinDrive>;
  running: boolean;
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
        const over = net.sources.filter(r => r.kind === 'rail' && !this.tripped.has(r.name as RailName) && Math.abs(r.current(Vh, { dt, high: true })) > RAILS[r.name as RailName].iLimit);
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
      out.pins[src.pin] = this.readPin(src.pin, v, current, false);
      const peak = isPwm && Math.abs(iL) > Math.abs(iH) ? iL : iH;
      if (src.mode === PIN_MODE.OUTPUT && Math.abs(peak) > GPIO_I_RATED) {
        const abs = Math.abs(peak);
        out.warnings.push({
          key: `pin-i:${src.pin}`, level: abs > GPIO_I_ABS_MAX ? 'error' : 'warn',
          text: `${gpioName(src.pin)} ${peak < 0 ? 'sinks' : 'sources'} ${formatSI(abs, 'A')}, over the ${formatSI(GPIO_I_RATED, 'A')} a pin can handle${abs > GPIO_I_ABS_MAX ? ' (this damages the MCU)' : ''}. Add a resistor, or use a transistor for loads like motors.`,
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
      if (!out.pins[pin]) out.pins[pin] = this.readPin(pin, v, 0, floating);
      if (floating && input.running && input.pins.has(pin)) {
        out.warnings.push({ key: `float:${pin}`, level: 'warn', text: `${gpioName(pin)} is floating: its reading is random. Add a pull-down/pull-up resistor (e.g. 10 kΩ) or use INPUT_PULLUP.` });
      }
      if (v > gpioMaxInputVoltage(pin) + 0.05) {
        out.warnings.push({ key: `pin-v:${pin}`, level: 'error', text: `${gpioName(pin)} sees ${formatSI(v, 'V')}: above its ${gpioMaxInputVoltage(pin)} V limit${pin === 14 || pin === 15 ? ' (A0/A1 are not 5 V tolerant)' : ''}.` });
      }
    }
    for (const rail of this.tripped) {
      out.warnings.push({ key: `rail:${rail}`, level: 'error', text: `Short circuit on the ${rail} rail: its protection switched it off. Remove the short to restore it.` });
    }
    return out;
  }

  private readPin(pin: number, v: number, current: number, floating: boolean): PinReading {
    if (floating) {
      // An unconnected CMOS input picks up noise: the reading wanders.
      let f = this.floatingBits.get(pin);
      if (!f || this.time >= f.next) {
        f = { digital: Math.random() < 0.5 ? 0 : 1, analog: Math.round(250 + Math.random() * 500), next: this.time + 0.08 + Math.random() * 0.3 };
        this.floatingBits.set(pin, f);
      }
      return { v, digital: f.digital, analog: f.analog, floating, current };
    }
    const prev = this.lastDigital.get(pin) ?? 0;
    const digital: 0 | 1 = v >= V_IH ? 1 : v <= V_IL ? 0 : prev; // Schmitt trigger
    this.lastDigital.set(pin, digital);
    const analog = Math.round(Math.min(ADC_MAX, Math.max(0, (v / VDD_IO) * ADC_MAX)));
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
    const roles = new Map<string, ReturnType<typeof pinRole>>();
    const boardKey = (pinId: string) => {
      let role = roles.get(pinId);
      if (!role) { role = pinRole(pinId, input.pinLabel(pinId)); roles.set(pinId, role); }
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
      if (c.type !== 'Breadboard') continue;
      for (const g of BREADBOARD_GROUPS) for (let i = 1; i < g.length; i++) uf.union(`${c.id}:${g[0]}`, `${c.id}:${g[i]}`);
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
          devices.push(new LoadDev(c, p('VCC'), p('GND'), SERVO.rLoad, [[p('S'), p('GND'), SERVO.rSignal]]));
          break;
        case 'OLED':
          devices.push(new LoadDev(c, p('VCC'), p('GND'), OLED.rLoad, [[p('SCL'), p('VCC'), OLED.rPullup], [p('SDA'), p('VCC'), OLED.rPullup]]));
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
    for (const rail of Object.keys(RAILS) as RailName[]) {
      const i = boardNode(`RAIL:${rail}`);
      if (i !== undefined) sources.push(new SourceDev(i, 'rail', rail, RAILS[rail].r, () => RAILS[rail].v));
    }
    for (let pin = 0; pin <= 21; pin++) {
      const i = boardNode(`GPIO:${pin}`);
      if (i !== undefined) gpioNodes.set(pin, i);
    }
    for (const [pin, nodeIdx] of gpioNodes) {
      const drive = input.running ? input.pins.get(pin) : undefined;
      const mode = drive?.mode ?? PIN_MODE.INPUT;
      const duty = drive?.duty ?? 0;
      let dev: SourceDev | null = null;
      if (mode === PIN_MODE.OUTPUT) {
        dev = new SourceDev(nodeIdx, 'gpio', gpioName(pin), GPIO_R_OUT, ctx => (duty >= 1 ? VDD_IO : duty <= 0 ? 0 : ctx.high ? VDD_IO : 0));
      } else if (mode === PIN_MODE.INPUT_PULLUP) {
        dev = new SourceDev(nodeIdx, 'gpio', gpioName(pin), PULL_R, () => VDD_IO);
      } else if (mode === PIN_MODE.INPUT_PULLDOWN) {
        dev = new SourceDev(nodeIdx, 'gpio', gpioName(pin), PULL_R, () => 0);
      }
      if (dev) {
        sources.push(dev);
        gpio.push({ pin, node: nodeIdx, mode, duty: mode === PIN_MODE.OUTPUT ? duty : 1, dev });
      }
    }

    const signature = input.wires.map(w => `${w.startCompId}:${w.startPinId}-${w.endCompId}:${w.endPinId}`).sort().join('|')
      + '#' + input.components.map(c => `${c.id}:${c.value ?? ''}:${c.damaged ? 1 : 0}`).sort().join('|');
    return { n, devices, sources, gpio, gpioNodes, signature };
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
        r.powered = m.v >= SERVO.vMin && m.v <= SERVO.vMax;
        const sNode = (d as LoadDev).extra[0][0];
        const driver = net.gpio.find(g => g.node === sNode && g.mode === PIN_MODE.OUTPUT);
        r.angle = r.powered && driver ? Math.round(driver.duty * 255) : undefined;
        if (!r.powered && Math.abs(m.v) > 0.5 && m.v < SERVO.vMin) warnings.push({ key: `servo:${c.id}`, level: 'warn', compId: c.id, text: `${name} needs ${SERVO.vMin}–${SERVO.vMax} V on VCC (has ${formatSI(m.v, 'V')}). Use the 5V pin.` });
        break;
      }
      case 'OLED':
        r.powered = m.v >= OLED.vMin && m.v <= OLED.vMax;
        break;
    }
    return r;
  }
}

interface GpioInfo { pin: number; node: number; mode: number; duty: number; dev: SourceDev }
interface Netlist {
  n: number;
  devices: Device[];
  sources: SourceDev[];
  gpio: GpioInfo[];
  gpioNodes: Map<number, number>;
  signature: string;
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
      return { ratio: m.v / SERVO.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
    case 'OLED':
      return { ratio: m.v / OLED.vAbsMax, reason: `${formatSI(m.v, 'V')} supply` };
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
