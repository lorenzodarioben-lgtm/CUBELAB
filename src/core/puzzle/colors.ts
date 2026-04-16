/**
 * Conventional (Western / WCA) colour scheme: white top, green front.
 * Opposite pairs are white/yellow, green/blue, red/orange.
 */
import type { Face } from './notation';

export interface FaceColor {
  readonly name: string;
  /** Sticker colour in sRGB. */
  readonly hex: string;
}

export const FACE_COLORS: Readonly<Record<Face, FaceColor>> = {
  U: { name: 'white', hex: '#fafaf6' },
  D: { name: 'yellow', hex: '#ffd83d' },
  F: { name: 'green', hex: '#14b866' },
  B: { name: 'blue', hex: '#2563eb' },
  R: { name: 'red', hex: '#e2313f' },
  L: { name: 'orange', hex: '#ff7a1c' },
};

export const OPPOSITE_FACE: Readonly<Record<Face, Face>> = {
  U: 'D',
  D: 'U',
  F: 'B',
  B: 'F',
  R: 'L',
  L: 'R',
};
