import type { ComponentType } from 'react';
import { UnoQBoard, PINS as UNO_Q_PINS, BoardPin } from './UnoQBoard';
import { NanoEsp32Board, NANO_PINS } from './NanoEsp32Board';
import { UNO_Q_ELECTRICAL, NANO_ESP32_ELECTRICAL, BoardElectrical } from './circuit/board';
import unoQExample from '../test.ino?raw';
import nanoEsp32Example from '../esp_test.ino?raw';

export type BoardId = 'unoq' | 'nanoesp32';

// A main board: what the sketch is compiled for and what the circuit is wired to.
export interface BoardDef {
  id: BoardId;
  name: string;
  electrical: BoardElectrical;
  pins: BoardPin[];
  Model: ComponentType<any>;
  camera: [number, number, number]; // initial camera position (looking at the origin)
  defaultCode: string;
}

export const BOARDS: Record<BoardId, BoardDef> = {
  unoq: {
    id: 'unoq',
    name: 'Arduino UNO Q',
    electrical: UNO_Q_ELECTRICAL,
    pins: UNO_Q_PINS,
    Model: UnoQBoard,
    camera: [0, 6, 10],
    defaultCode: unoQExample,
  },
  nanoesp32: {
    id: 'nanoesp32',
    name: 'Arduino Nano ESP32',
    electrical: NANO_ESP32_ELECTRICAL,
    pins: NANO_PINS,
    Model: NanoEsp32Board,
    camera: [0, 5, 7],
    defaultCode: nanoEsp32Example,
  },
};

export function boardOf(id: string | undefined): BoardDef {
  return BOARDS[(id as BoardId) in BOARDS ? (id as BoardId) : 'unoq'];
}
