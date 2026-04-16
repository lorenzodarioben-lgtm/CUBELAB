/**
 * WCA notation for the 3×3×3: the six outer faces plus the three middle slices.
 *
 *   U D L R F B   outer faces, clockwise as seen looking straight at that face
 *   M             middle slice between L and R, turning in the same direction as L
 *   E             middle slice between U and D, turning in the same direction as D
 *   S             middle slice between F and B, turning in the same direction as F
 *
 * Each turns clockwise, counter-clockwise (`'`) or doubled (`2`). Wide moves
 * and whole-cube rotations are rejected so every move the app produces is one
 * the solver, the timer and the renderer agree on. Camera orbit never changes
 * what a letter means.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

export const SLICES = ['M', 'E', 'S'] as const;
export type Slice = (typeof SLICES)[number];

/** Every turnable layer family: six faces and three slices. */
export const MOVE_FAMILIES = [...FACES, ...SLICES] as const;
export type MoveFamily = Face | Slice;

/** Clockwise quarter turns: 1 → `R`, 2 → `R2`, 3 → `R'`. */
export type Turns = 1 | 2 | 3;

export interface Move {
  readonly family: MoveFamily;
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
export function mv(family: MoveFamily, turns: Turns): Move {
  const key = family + turns;
  let cached = MOVE_CACHE.get(key);
  if (!cached) {
    cached = Object.freeze({ family, turns });
    MOVE_CACHE.set(key, cached);
  }
  return cached;
}

export function isFace(value: unknown): value is Face {
  return typeof value === 'string' && (FACES as readonly string[]).includes(value);
}

export function isSlice(family: MoveFamily): family is Slice {
  return family === 'M' || family === 'E' || family === 'S';
}

export function formatMove(move: Move): string {
  if (move.turns === 1) return move.family;
  if (move.turns === 2) return `${move.family}2`;
  return `${move.family}'`;
}

export function formatAlg(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

const TOKEN = /^([UDLRFBMES])(\d{0,2})('?)$/;

/** Parses a single token such as `R`, `U'`, `F2`, `B2'`, `M'`, `E2` or `S3`. */
export function parseMove(token: string): Move {
  const normalized = token.trim().replace(/[’′`]/g, "'");
  const match = TOKEN.exec(normalized);
  if (!match) {
    throw new NotationError(`Unsupported move "${token}". Allowed: U D L R F B and the slices M E S.`);
  }
  const [, family, digits, prime] = match;
  const amount = digits ? Number.parseInt(digits, 10) : 1;
  const signed = prime ? -amount : amount;
  const turns = (((signed % 4) + 4) % 4) as 0 | Turns;
  if (turns === 0) {
    throw new NotationError(`Move "${token}" is a no-op.`);
  }
  return mv(family as MoveFamily, turns);
}

/** Parses whitespace-separated notation. Empty input yields `[]`. */
export function parseAlg(text: string): Move[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(parseMove);
}

export function invertMove(move: Move): Move {
  return mv(move.family, (4 - move.turns) as Turns);
}

export function invertAlg(moves: readonly Move[]): Move[] {
  return moves.slice().reverse().map(invertMove);
}

/**
 * Turn metrics for one move.
 *  - STM (slice turn metric): any layer turn, any angle, counts 1. This is the
 *    "turns" figure shown in the UI — one physical turn, one count.
 *  - HTM (half/face turn metric): outer turns count 1; a slice counts 2,
 *    because M = L′ R (plus a rotation).
 *  - QTM (quarter turn metric): outer quarter turns; doubles count 2, and a
 *    slice is twice its outer-face equivalent.
 */
export interface MoveMetrics {
  readonly stm: number;
  readonly htm: number;
  readonly qtm: number;
}

export function moveMetrics(move: Move): MoveMetrics {
  const layers = isSlice(move.family) ? 2 : 1;
  return { stm: 1, htm: layers, qtm: layers * (move.turns === 2 ? 2 : 1) };
}

export function countSTM(moves: readonly Move[]): number {
  return moves.length;
}

export function countHTM(moves: readonly Move[]): number {
  return moves.reduce((total, m) => total + moveMetrics(m).htm, 0);
}

export function countQTM(moves: readonly Move[]): number {
  return moves.reduce((total, m) => total + moveMetrics(m).qtm, 0);
}
