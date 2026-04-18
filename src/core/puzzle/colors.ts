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
  U: { name: 'white', hex: '#f3f3ef' },
  D: { name: 'yellow', hex: '#ffd31a' },
  F: { name: 'green', hex: '#0fa958' },
  B: { name: 'blue', hex: '#1d5ad6' },
  R: { name: 'red', hex: '#d42a36' },
  L: { name: 'orange', hex: '#ff6a17' },
};

export const OPPOSITE_FACE: Readonly<Record<Face, Face>> = {
  U: 'D',
  D: 'U',
  F: 'B',
  B: 'F',
  R: 'L',
  L: 'R',
};
