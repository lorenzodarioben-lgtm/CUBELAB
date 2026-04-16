/**
 * Keyboard layouts for turning.
 *
 * faces (default): the face letter turns clockwise, Shift + letter turns
 *   counter-clockwise. Uses `KeyboardEvent.code`, so it works on any layout.
 * speed: the classic two-hand speedcubing layout used by qqTimer, csTimer and
 *   cubing.js's twisty player (I/K = R/R', J/F = U/U', H/G = F/F', D/E = L/L',
 *   S/L = D/D', W/O = B/B').
 *
 * Action shortcuts deliberately avoid every letter used by either layout:
 * N new scramble, A auto solve, P play/pause, , and . step, C camera, Z zen,
 * M move pad, ? help.
 */
import { mv } from '../core/puzzle/notation';
import type { Face, Move } from '../core/puzzle/notation';
import type { KeyMap } from '../core/persistence/settings';

export const SPEED_KEYS: Readonly<Record<string, Move>> = {
  i: mv('R', 1),
  k: mv('R', 3),
  j: mv('U', 1),
  f: mv('U', 3),
  h: mv('F', 1),
  g: mv('F', 3),
  d: mv('L', 1),
  e: mv('L', 3),
  s: mv('D', 1),
  l: mv('D', 3),
  w: mv('B', 1),
  o: mv('B', 3),
};

const FACE_CODES: Readonly<Record<string, Face>> = {
  KeyU: 'U',
  KeyD: 'D',
  KeyL: 'L',
  KeyR: 'R',
  KeyF: 'F',
  KeyB: 'B',
};

export function moveForKey(event: Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey'>, keyMap: KeyMap): Move | null {
  if (keyMap === 'faces') {
    const face = FACE_CODES[event.code];
    return face ? mv(face, event.shiftKey ? 3 : 1) : null;
  }
  const letter = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : '';
  return SPEED_KEYS[letter] ?? null;
}
