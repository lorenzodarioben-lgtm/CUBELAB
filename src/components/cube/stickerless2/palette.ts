/**
 * Stickerless v2 plastic colours (sRGB). Separate from `FACE_COLORS`, which
 * Classic Stickered, the Move Pad and the other puzzles share.
 *
 * White is production's white (under production's lighting, as v2 now uses),
 * the anchor for how the cube's white should read. The other colours keep the
 * v2 adjustments: blue nearer the references' ultramarine, green a little more
 * yellow, and orange toward yellow so it stays clear of red under a sheen.
 */
import type { Face } from '../../../core/puzzle/notation';
import { FACE_COLORS } from '../../../core/puzzle/colors';

export const V2_PALETTE: Readonly<Record<Face, string>> = {
  U: FACE_COLORS.U.hex,
  D: '#ffd20a',
  F: '#18c048',
  B: '#2a4df0',
  R: '#e8201f',
  L: '#ff8205',
};

/** Mechanism plastic (core and arms), light grey as glimpsed in the references. */
export const V2_MECHANISM = '#c9cacb';
