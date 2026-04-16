/**
 * The physical cubie model: 26 pieces with stable identities.
 *
 * Every cubie keeps its id for life. Its only mutable property is its
 * orientation `O`, an exact integer rotation matrix taking the piece from its
 * home pose to its current pose. Because every face turn applies the same
 * rotation `M` to both a cubie's position and its orientation, the invariant
 *
 *     position = O · home
 *
 * holds forever, so position is derived rather than stored. Stickers are
 * attached to cubies in the home frame; a sticker's current outward normal is
 * `O · homeNormal`. Colours therefore travel with their piece — nothing is ever
 * recoloured by screen or world position.
 */
import { IDENTITY, MOVE_AXIS, faceFromNormal, moveQuarterTurns, mulMat, mulVec, quarterRotation } from './geometry';
import type { Axis, Mat3, Vec3 } from './geometry';
import { faceletIndex } from './facelets';
import type { Face, Move } from './notation';

export type CubieKind = 'corner' | 'edge' | 'center';

export interface StickerDef {
  /** Outward normal in the cubie's home frame. */
  readonly normal: Vec3;
  /** Colour identity: the face this sticker belongs to when solved. */
  readonly color: Face;
}

export interface CubieDef {
  readonly id: number;
  readonly name: string;
  readonly kind: CubieKind;
  readonly home: Vec3;
  readonly stickers: readonly StickerDef[];
}

/** Orientation of every cubie, indexed by cubie id. */
export type CubieOrientations = readonly Mat3[];

function buildCubieDefs(): CubieDef[] {
  const defs: CubieDef[] = [];
  for (let y = 1; y >= -1; y--) {
    for (let z = 1; z >= -1; z--) {
      for (let x = -1; x <= 1; x++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const stickers: StickerDef[] = [];
        if (y !== 0) stickers.push({ normal: [0, y, 0], color: y > 0 ? 'U' : 'D' });
        if (z !== 0) stickers.push({ normal: [0, 0, z], color: z > 0 ? 'F' : 'B' });
        if (x !== 0) stickers.push({ normal: [x, 0, 0], color: x > 0 ? 'R' : 'L' });
        const kind: CubieKind = stickers.length === 3 ? 'corner' : stickers.length === 2 ? 'edge' : 'center';
        defs.push({
          id: defs.length,
          name: stickers.map((s) => s.color).join(''),
          kind,
          home: [x, y, z],
          stickers,
        });
      }
    }
  }
  return defs;
}

export const CUBIE_DEFS: readonly CubieDef[] = buildCubieDefs();

export const SOLVED_ORIENTATIONS: CubieOrientations = CUBIE_DEFS.map(() => IDENTITY);

export function cubiePosition(orientations: CubieOrientations, id: number): Vec3 {
  return mulVec(orientations[id]!, CUBIE_DEFS[id]!.home);
}

/** Ids of the cubies currently occupying the given layer. */
export function cubiesInLayer(orientations: CubieOrientations, axis: Axis, layer: number): number[] {
  const ids: number[] = [];
  for (const def of CUBIE_DEFS) {
    if (cubiePosition(orientations, def.id)[axis] === layer) ids.push(def.id);
  }
  return ids;
}

/**
 * Applies one layer turn — an outer face (9 cubies) or a middle slice (8
 * visible cubies: four edges and four centres; the core is implicit). Untouched
 * cubies keep their matrix by reference.
 */
export function applyMoveToCubies(orientations: CubieOrientations, move: Move): CubieOrientations {
  const { axis, layer } = MOVE_AXIS[move.family];
  const rotation = quarterRotation(axis, moveQuarterTurns(move));
  return orientations.map((o, id) => {
    const pos = mulVec(o, CUBIE_DEFS[id]!.home);
    return pos[axis] === layer ? mulMat(rotation, o) : o;
  });
}

/** Projects the cubie model to the 54-facelet string (see facelets.ts). */
export function cubieFacelets(orientations: CubieOrientations): string {
  const out: string[] = new Array<string>(54).fill('?');
  for (const def of CUBIE_DEFS) {
    const o = orientations[def.id]!;
    const pos = mulVec(o, def.home);
    for (const sticker of def.stickers) {
      const face = faceFromNormal(mulVec(o, sticker.normal));
      out[faceletIndex(face, pos)] = sticker.color;
    }
  }
  return out.join('');
}

/** Facelet index → (cubie id, sticker index) for the current arrangement. */
export function stickerAtFacelet(orientations: CubieOrientations): Array<{ cubie: number; sticker: number }> {
  const out = new Array<{ cubie: number; sticker: number }>(54);
  for (const def of CUBIE_DEFS) {
    const o = orientations[def.id]!;
    const pos = mulVec(o, def.home);
    def.stickers.forEach((sticker, index) => {
      out[faceletIndex(faceFromNormal(mulVec(o, sticker.normal)), pos)] = { cubie: def.id, sticker: index };
    });
  }
  return out;
}

