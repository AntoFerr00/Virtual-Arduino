// Modified nodal analysis on a dense matrix. Every source in the circuit has an internal
// resistance, so plain nodal analysis (unknowns = node voltages) is enough. Node -1 is ground.

export class NodalSystem {
  readonly G: Float64Array;
  readonly rhs: Float64Array;

  constructor(readonly n: number) {
    this.G = new Float64Array(n * n);
    this.rhs = new Float64Array(n);
  }

  clear() {
    this.G.fill(0);
    this.rhs.fill(0);
  }

  // Raw Jacobian entry d(current leaving `row`)/d(V of `col`).
  addJ(row: number, col: number, value: number) {
    if (row >= 0 && col >= 0) this.G[row * this.n + col] += value;
  }

  // Linear conductance between two nodes.
  addConductance(a: number, b: number, g: number) {
    this.addJ(a, a, g);
    this.addJ(b, b, g);
    this.addJ(a, b, -g);
    this.addJ(b, a, -g);
  }

  // Current source pushing `i` amperes into node `a`.
  addCurrent(a: number, i: number) {
    if (a >= 0) this.rhs[a] += i;
  }

  // Thevenin source (voltage `v` behind resistance `r`) between node `a` and ground.
  addTheveninToGround(a: number, v: number, r: number) {
    this.addJ(a, a, 1 / r);
    this.addCurrent(a, v / r);
  }

  // Stamps a nonlinear device given the current flowing *into the device* at each terminal,
  // its Jacobian with respect to the terminal voltages, and the voltages it was linearised at.
  addNonlinear(nodes: number[], current: number[], jac: number[][], v: number[]) {
    for (let k = 0; k < nodes.length; k++) {
      let ieq = current[k];
      for (let j = 0; j < nodes.length; j++) {
        this.addJ(nodes[k], nodes[j], jac[k][j]);
        ieq -= jac[k][j] * v[j];
      }
      this.addCurrent(nodes[k], -ieq);
    }
  }

  // Solves G·x = b (Gaussian elimination with partial pivoting). Does not modify the system.
  solve(b: Float64Array = this.rhs): Float64Array | null {
    const n = this.n;
    const a = Float64Array.from(this.G);
    const x = Float64Array.from(b);
    for (let col = 0; col < n; col++) {
      let piv = col;
      let best = Math.abs(a[col * n + col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(a[r * n + col]);
        if (v > best) { best = v; piv = r; }
      }
      if (best < 1e-30) return null;
      if (piv !== col) {
        for (let c = col; c < n; c++) {
          const t = a[col * n + c]; a[col * n + c] = a[piv * n + c]; a[piv * n + c] = t;
        }
        const t = x[col]; x[col] = x[piv]; x[piv] = t;
      }
      const d = a[col * n + col];
      for (let r = col + 1; r < n; r++) {
        const f = a[r * n + col] / d;
        if (f === 0) continue;
        for (let c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c];
        x[r] -= f * x[col];
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = x[r];
      for (let c = r + 1; c < n; c++) s -= a[r * n + c] * x[c];
      x[r] = s / a[r * n + r];
    }
    return x;
  }
}

// exp() that grows linearly past a threshold, so Newton iterations cannot overflow.
const EXP_CAP = 90; // a blue/white LED junction sits around x ≈ 60 at its rated current
const E_CAP = Math.exp(EXP_CAP);
export function limexp(x: number): [value: number, derivative: number] {
  if (x < EXP_CAP) {
    const e = Math.exp(x);
    return [e, e];
  }
  return [E_CAP * (1 + x - EXP_CAP), E_CAP];
}

// SPICE junction voltage limiting: keeps Newton steps on an exponential from overshooting.
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}
