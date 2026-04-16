/**
 * WCA outer-face notation for the 3×3×3.
 *
 * Only the six outer faces are part of the puzzle vocabulary: `U D L R F B`,
 * each clockwise, counter-clockwise (`'`) or doubled (`2`). Slices, wide moves
 * and cube rotations are deliberately rejected so that every move the app can
 * produce is one the solver, the timer and the renderer all agree on.
 *
 * "Clockwise" always means clockwise when looking straight at that face from
 * outside the cube. Camera orbit never changes what a letter means.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

/** Clockwise quarter turns: 1 → `R`, 2 → `R2`, 3 → `R'`. */
export type Turns = 1 | 2 | 3;

export interface Move {
  readonly face: Face;
  readonly turns: Turns;
}

export class NotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotationError';
  }
}

const MOVE_CACHE = new Map<string, Move>();

/** Interned move objects so equal moves are cheap to compare and allocate. */
export function mv(face: Face, turns: Turns): Move {
  const key = face + turns;
  let cached = MOVE_CACHE.get(key);
  if (!cached) {
    cached = Object.freeze({ face, turns });
    MOVE_CACHE.set(key, cached);
  }
  return cached;
}

export function isFace(value: unknown): value is Face {
  return typeof value === 'string' && (FACES as readonly string[]).includes(value);
}

export function formatMove(move: Move): string {
  if (move.turns === 1) return move.face;
  if (move.turns === 2) return `${move.face}2`;
  return `${move.face}'`;
}

export function formatAlg(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

const TOKEN = /^([UDLRFB])(\d{0,2})('?)$/;

/** Parses a single outer-face token such as `R`, `U'`, `F2`, `B2'` or `D3`. */
export function parseMove(token: string): Move {
  const normalized = token.trim().replace(/[’′`]/g, "'");
  const match = TOKEN.exec(normalized);
  if (!match) {
    throw new NotationError(`Unsupported move "${token}". Only U D L R F B face turns are allowed.`);
  }
  const [, face, digits, prime] = match;
  const amount = digits ? Number.parseInt(digits, 10) : 1;
  const signed = prime ? -amount : amount;
  const turns = (((signed % 4) + 4) % 4) as 0 | Turns;
  if (turns === 0) {
    throw new NotationError(`Move "${token}" is a no-op.`);
  }
  return mv(face as Face, turns);
}

/** Parses whitespace-separated outer-face notation. Empty input yields `[]`. */
export function parseAlg(text: string): Move[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(parseMove);
}

export function invertMove(move: Move): Move {
  return mv(move.face, (4 - move.turns) as Turns);
}

export function invertAlg(moves: readonly Move[]): Move[] {
  return moves.slice().reverse().map(invertMove);
}

/** Half-turn metric (= face-turn metric for outer-face-only notation): every token counts 1. */
export function countHTM(moves: readonly Move[]): number {
  return moves.length;
}

/** Quarter-turn metric: a double turn counts 2. */
export function countQTM(moves: readonly Move[]): number {
  let total = 0;
  for (const m of moves) total += quarterTurnCost(m);
  return total;
}

export function quarterTurnCost(move: Move): number {
  return move.turns === 2 ? 2 : 1;
}
