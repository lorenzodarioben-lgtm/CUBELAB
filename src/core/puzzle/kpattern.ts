/**
 * Bridge to cubing.js `KPattern`, the canonical logical state of the puzzle.
 *
 * cubing.js's 3×3×3 definition has three orbits. Piece order and the sticker
 * order inside each piece name are fixed by that definition:
 *
 *   EDGES   UF UR UB UL DF DR DB DL FR FL BR BL            (2 orientations)
 *   CORNERS UFR URB UBL ULF DRF DFL DLB DBR                (3 orientations)
 *   CENTERS U L F R B D       (spin not tracked: orientationMod = 1)
 *
 * Outer turns never move centres; slice turns (M E S) permute them, exactly as
 * on a physical cube. Only whole-cube arrangements of the centres (the 24
 * rotations) are reachable.
 *
 * `pieces[slot]` is the piece currently sitting in `slot`, and
 * `orientation[slot] = o` means facelet k of that slot shows sticker
 * `(k + o) mod n` of the piece. That convention was derived from the R and F
 * transformations and is cross-checked against the independent integer cubie
 * model on thousands of random sequences in the test suite.
 */
import type { KPattern, KPatternData, KPuzzle, KTransformation } from 'cubing/kpuzzle';
import { isCubeRotation, mulVec } from './geometry';
import type { Mat3, Vec3 } from './geometry';
import { formatMove } from './notation';
import type { Move } from './notation';

const EDGE_NAMES = ['UF', 'UR', 'UB', 'UL', 'DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BR', 'BL'] as const;
const CORNER_NAMES = ['UFR', 'URB', 'UBL', 'ULF', 'DRF', 'DFL', 'DLB', 'DBR'] as const;
const CENTER_NAMES = ['U', 'L', 'F', 'R', 'B', 'D'] as const;

/** Facelet indices (see facelets.ts) of each slot, in the slot name's sticker order. */
const EDGE_FACELETS: readonly (readonly number[])[] = [
  [7, 19], // UF: U7 F1
  [5, 10], // UR: U5 R1
  [1, 46], // UB: U1 B1
  [3, 37], // UL: U3 L1
  [28, 25], // DF: D1 F7
  [32, 16], // DR: D5 R7
  [34, 52], // DB: D7 B7
  [30, 43], // DL: D3 L7
  [23, 12], // FR: F5 R3
  [21, 41], // FL: F3 L5
  [48, 14], // BR: B3 R5
  [50, 39], // BL: B5 L3
];

const CORNER_FACELETS: readonly (readonly number[])[] = [
  [8, 20, 9], // UFR: U8 F2 R0
  [2, 11, 45], // URB: U2 R2 B0
  [0, 47, 36], // UBL: U0 B2 L0
  [6, 38, 18], // ULF: U6 L2 F0
  [29, 15, 26], // DRF: D2 R6 F8
  [27, 24, 44], // DFL: D0 F6 L8
  [33, 42, 53], // DLB: D6 L6 B8
  [35, 51, 17], // DBR: D8 B6 R8
];

const CENTER_FACELETS: readonly number[] = [4, 40, 22, 13, 49, 31]; // U L F R B D

let kpuzzlePromise: Promise<KPuzzle> | null = null;

/** Loads (once) the cubing.js 3×3×3 puzzle definition. */
export function loadKPuzzle(): Promise<KPuzzle> {
  kpuzzlePromise ??= import('cubing/puzzles').then(({ cube3x3x3 }) => cube3x3x3.kpuzzle());
  return kpuzzlePromise;
}

const transformationCache = new WeakMap<KPuzzle, Map<string, KTransformation>>();

export function applyMoveToPattern(pattern: KPattern, move: Move): KPattern {
  let cache = transformationCache.get(pattern.kpuzzle);
  if (!cache) {
    cache = new Map();
    transformationCache.set(pattern.kpuzzle, cache);
  }
  const key = formatMove(move);
  let transformation = cache.get(key);
  if (!transformation) {
    transformation = pattern.kpuzzle.moveToTransformation(key);
    cache.set(key, transformation);
  }
  return pattern.applyTransformation(transformation);
}

/** Solved ignoring centre spin and whole-puzzle orientation, exactly what a cuber means by "solved". */
export function isPatternSolved(pattern: KPattern): boolean {
  return pattern.experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
}

/** Independent facelet projection of a `KPattern`, for model ↔ view agreement checks. */
export function patternFacelets(pattern: KPattern): string {
  const out = new Array<string>(54).fill('?');
  const data = pattern.patternData;
  const edges = data['EDGES']!;
  const corners = data['CORNERS']!;
  const centers = data['CENTERS']!;
  for (let slot = 0; slot < 12; slot++) {
    const name = EDGE_NAMES[edges.pieces[slot]!]!;
    const o = edges.orientation[slot]!;
    EDGE_FACELETS[slot]!.forEach((facelet, k) => {
      out[facelet] = name[(k + o) % 2]!;
    });
  }
  for (let slot = 0; slot < 8; slot++) {
    const name = CORNER_NAMES[corners.pieces[slot]!]!;
    const o = corners.orientation[slot]!;
    CORNER_FACELETS[slot]!.forEach((facelet, k) => {
      out[facelet] = name[(k + o) % 3]!;
    });
  }
  for (let slot = 0; slot < 6; slot++) {
    out[CENTER_FACELETS[slot]!] = CENTER_NAMES[centers.pieces[slot]!]!;
  }
  return out.join('');
}

function isPermutation(values: unknown, size: number): values is number[] {
  if (!Array.isArray(values) || values.length !== size) return false;
  const seen = new Set<number>();
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v >= size || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

function isOrientationArray(values: unknown, size: number, modulus: number): values is number[] {
  return (
    Array.isArray(values) &&
    values.length === size &&
    values.every((v) => Number.isInteger(v) && v >= 0 && v < modulus)
  );
}

function permutationParity(perm: readonly number[]): number {
  const visited = new Array<boolean>(perm.length).fill(false);
  let parity = 0;
  for (let i = 0; i < perm.length; i++) {
    if (visited[i]) continue;
    let length = 0;
    for (let j = i; !visited[j]; j = perm[j]!) {
      visited[j] = true;
      length++;
    }
    parity ^= (length - 1) & 1;
  }
  return parity;
}

/** Outward normals of the centre slots/pieces, in cubing.js order U L F R B D. */
const CENTER_NORMALS: readonly Vec3[] = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [1, 0, 0],
  [0, 0, -1],
  [0, -1, 0],
];

/** True when the centre permutation is one of the 24 whole-cube rotations. */
export function isRotationOfCenters(pieces: readonly number[]): boolean {
  const slotOf = new Array<number>(6);
  pieces.forEach((piece, slot) => (slotOf[piece] = slot));
  // Columns: where the R (x), U (y) and F (z) centres went.
  const r = CENTER_NORMALS[slotOf[3]!]!;
  const u = CENTER_NORMALS[slotOf[0]!]!;
  const f = CENTER_NORMALS[slotOf[2]!]!;
  const m: Mat3 = [r[0], u[0], f[0], r[1], u[1], f[1], r[2], u[2], f[2]];
  if (!isCubeRotation(m)) return false;
  return CENTER_NORMALS.every((normal, piece) => {
    const moved = mulVec(m, normal);
    const target = CENTER_NORMALS[slotOf[piece]!]!;
    return moved[0] === target[0] && moved[1] === target[1] && moved[2] === target[2];
  });
}

/** True when every centre sits in its home slot. */
export function centersAtHome(pattern: KPattern): boolean {
  return pattern.patternData['CENTERS']!.pieces.every((piece, slot) => piece === slot);
}

/**
 * Validates untrusted pattern data (e.g. from localStorage) and checks that it
 * is reachable with face and slice turns: legal permutations, centres in a
 * rotational arrangement, zero twist/flip sums, and the parity law
 * parity(edges) ⊕ parity(corners) = parity(centres) — an outer quarter turn
 * cycles 4 edges and 4 corners, a slice quarter turn 4 edges and 4 centres.
 */
export function isReachablePatternData(raw: unknown): raw is KPatternData {
  if (typeof raw !== 'object' || raw === null) return false;
  const data = raw as Record<string, { pieces?: unknown; orientation?: unknown }>;
  const edges = data['EDGES'];
  const corners = data['CORNERS'];
  const centers = data['CENTERS'];
  if (!edges || !corners || !centers) return false;
  if (!isPermutation(edges.pieces, 12) || !isOrientationArray(edges.orientation, 12, 2)) return false;
  if (!isPermutation(corners.pieces, 8) || !isOrientationArray(corners.orientation, 8, 3)) return false;
  if (!isPermutation(centers.pieces, 6) || !isRotationOfCenters(centers.pieces)) return false;
  const flip = edges.orientation.reduce((a, b) => a + b, 0);
  const twist = corners.orientation.reduce((a, b) => a + b, 0);
  if (flip % 2 !== 0 || twist % 3 !== 0) return false;
  return (permutationParity(edges.pieces) ^ permutationParity(corners.pieces)) === permutationParity(centers.pieces);
}

/** Plain-JSON copy of the orbit data for persistence. */
export function serializePattern(pattern: KPattern): KPatternData {
  const out: KPatternData = {};
  for (const [orbit, value] of Object.entries(pattern.patternData)) {
    out[orbit] = {
      pieces: [...value.pieces],
      orientation: [...value.orientation],
      ...(value.orientationMod ? { orientationMod: [...value.orientationMod] } : {}),
    };
  }
  return out;
}

