// Parsing and formatting of component values with SI prefixes ("220Ω", "4.7k", "100nF", "10µH").

const PREFIX: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, G: 1e9,
};

// Returns NaN when the text is not a valid value. "4k7" style is accepted too.
export function parseValue(text: string | undefined): number {
  if (!text) return NaN;
  const s = text.trim().replace(/\s+/g, '').replace(/(Ω|ohms?|F|H)$/i, '');
  const rkm = s.match(/^(\d+)([pnuµμmkKMG])(\d+)$/);
  if (rkm) return parseFloat(`${rkm[1]}.${rkm[3]}`) * PREFIX[rkm[2]];
  const m = s.match(/^([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)([pnuµμmkKMG]?)$/i);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] ?? 1 : 1);
}

export function formatSI(value: number, unit: string, digits = 3): string {
  if (!isFinite(value)) return `— ${unit}`;
  const abs = Math.abs(value);
  if (abs < 1e-12) return `0 ${unit}`;
  const steps: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  for (const [f, p] of steps) {
    if (abs >= f * 0.9995) return `${parseFloat((value / f).toPrecision(digits))} ${p}${unit}`;
  }
  return `${parseFloat((value / 1e-12).toPrecision(digits))} p${unit}`;
}
