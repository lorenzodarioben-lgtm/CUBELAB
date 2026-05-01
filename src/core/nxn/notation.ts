import type { Face } from '../puzzle/notation';
import type { NxMove } from './model';

export class NxNotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NxNotationError';
  }
}

export function formatNxMove(move: NxMove): string {
  const family = move.width === 1 ? move.face : `${move.width > 2 ? move.width : ''}${move.face}w`;
  return family + (move.turns === 1 ? '' : move.turns === 2 ? '2' : "'");
}

export function formatNxAlg(moves: readonly NxMove[]): string {
  return moves.map(formatNxMove).join(' ');
}

/** WCA face and wide-turn notation, including the common lowercase wide alias. */
export function parseNxMove(token: string, size: number): NxMove {
  const normalized = token.trim().replace(/[’′`]/g, "'");
  const match = /^(\d*)([URFDLBurfdlb])(w?)(\d*)('?)(?:)$/.exec(normalized);
  if (!match) throw new NxNotationError(`Unsupported ${size}×${size} move “${token}”.`);
  const [, prefix, letter, wide, amountText, prime] = match;
  const lower = letter !== letter!.toUpperCase();
  if (prefix && !wide) throw new NxNotationError(`A layer count needs “w” in “${token}”.`);
  const width = prefix ? Number(prefix) : lower || wide ? 2 : 1;
  const amount = amountText ? Number(amountText) : 1;
  const turns = (((prime ? -amount : amount) % 4) + 4) % 4;
  if (!Number.isInteger(width) || width < 1 || width >= size || ![1, 2, 3].includes(turns)) {
    throw new NxNotationError(`Move “${token}” is not valid on a ${size}×${size} cube.`);
  }
  return { face: letter!.toUpperCase() as Face, width, turns: turns as NxMove['turns'] };
}

export function parseNxAlg(text: string, size: number): NxMove[] {
  return text.trim() ? text.trim().split(/\s+/).map((token) => parseNxMove(token, size)) : [];
}
