import type { PinRole } from './circuit/board';

// Jumper wire colours, following the usual bench convention: black for ground, red for 5 V,
// orange for 3.3 V, the other colours for signals.
export const WIRE_COLORS = [
  { name: 'Black', hex: '#1f1f1f' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#facc15' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'White', hex: '#f5f5f5' },
  { name: 'Grey', hex: '#8b8f96' },
  { name: 'Brown', hex: '#8b4513' },
] as const;

const SIGNAL_COLORS = ['#facc15', '#16a34a', '#2563eb', '#9333ea', '#f5f5f5', '#8b4513', '#8b8f96'];

// What an endpoint carries, as far as wire colouring goes.
export type EndpointKind = 'gnd' | '5v' | '3v3' | 'signal';

export function endpointKind(compId: string, pinId: string, boardRole: (pinId: string) => PinRole): EndpointKind {
  if (compId === 'BOARD') {
    const role = boardRole(pinId);
    if (role.kind === 'gnd') return 'gnd';
    if (role.kind === 'rail') return role.rail === '5V' ? '5v' : '3v3';
    return 'signal';
  }
  // Breadboard power rails: blue (-) and red (+) lines
  if (/^[LR]_neg_/.test(pinId)) return 'gnd';
  if (/^[LR]_pos_/.test(pinId)) return '5v';
  return 'signal';
}

// Colour for a new wire: power and ground by convention, signals cycle through the palette.
export function defaultWireColor(a: EndpointKind, b: EndpointKind, signalIndex: number): string {
  const kinds = [a, b];
  if (kinds.includes('gnd')) return '#1f1f1f';
  if (kinds.includes('5v')) return '#dc2626';
  if (kinds.includes('3v3')) return '#f97316';
  return SIGNAL_COLORS[signalIndex % SIGNAL_COLORS.length];
}
