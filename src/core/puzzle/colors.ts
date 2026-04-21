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
  // Bright stickerless plastics: vivid but not neon, white neutral rather than grey.
  U: { name: 'white', hex: '#f5f5f1' },
  D: { name: 'yellow', hex: '#ffdc1c' },
  F: { name: 'green', hex: '#0fae4f' },
  B: { name: 'blue', hex: '#1f62e4' },
  R: { name: 'red', hex: '#ec1e2e' },
  L: { name: 'orange', hex: '#ff7816' },
};

export const OPPOSITE_FACE: Readonly<Record<Face, Face>> = {
  U: 'D',
  D: 'U',
  F: 'B',
  B: 'F',
  R: 'L',
  L: 'R',
};
