/**
 * Keyboard layouts for turning.
 *
 * faces (default): the letter turns clockwise, Shift + letter counter-
 *   clockwise, for all nine families U D L R F B M E S. Uses
 *   `KeyboardEvent.code`, so it works on any keyboard layout.
 * speed: the classic two-hand speedcubing layout used by qqTimer, csTimer and
 *   cubing.js's twisty player (I/K = R/R', J/F = U/U', H/G = F/F', D/E = L/L',
 *   S/L = D/D', W/O = B/B'), with slices on the number row:
 *   5/6 = M/M', 2/3 = E/E', 8/9 = S/S'.
 *
 * Whole-cube rotations X / Y / Z (Shift = prime) work in both layouts.
 *
 * Action shortcuts deliberately avoid every key used by either layout:
 * N new scramble, A auto solve, P play/pause, , and . step, C camera,
 * backquote zen, ? help.
 */
import { mv } from '../core/puzzle/notation';
import type { Move, MoveFamily } from '../core/puzzle/notation';
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
  '5': mv('M', 1),
  '6': mv('M', 3),
  '2': mv('E', 1),
  '3': mv('E', 3),
  '8': mv('S', 1),
  '9': mv('S', 3),
};

const FAMILY_CODES: Readonly<Record<string, MoveFamily>> = {
  KeyU: 'U',
  KeyD: 'D',
  KeyL: 'L',
  KeyR: 'R',
  KeyF: 'F',
  KeyB: 'B',
  KeyM: 'M',
  KeyE: 'E',
  KeyS: 'S',
};

const ROTATION_CODES: Readonly<Record<string, MoveFamily>> = { KeyX: 'x', KeyY: 'y', KeyZ: 'z' };

export function moveForKey(event: Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey'>, keyMap: KeyMap): Move | null {
  const rotation = ROTATION_CODES[event.code];
  if (rotation) return mv(rotation, event.shiftKey ? 3 : 1);
  if (keyMap === 'faces') {
    const family = FAMILY_CODES[event.code];
    return family ? mv(family, event.shiftKey ? 3 : 1) : null;
  }
  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.code.startsWith('Digit') ? event.code.slice(5) : '';
  return SPEED_KEYS[key] ?? null;
}
