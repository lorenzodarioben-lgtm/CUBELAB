/**
 * 2D unfolded net of the current facelets. Used as the no-WebGL fallback, so
 * the whole studio (Move Pad, keyboard, timer, solver) still works without 3D.
 */
import { FACE_COLORS } from '../../core/puzzle/colors';
import type { Face } from '../../core/puzzle/notation';

const LAYOUT: ReadonlyArray<{ face: Face; col: number; row: number }> = [
  { face: 'U', col: 2, row: 1 },
  { face: 'L', col: 1, row: 2 },
  { face: 'F', col: 2, row: 2 },
  { face: 'R', col: 3, row: 2 },
  { face: 'B', col: 4, row: 2 },
  { face: 'D', col: 2, row: 3 },
];
const OFFSET: Readonly<Record<Face, number>> = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

export function FaceNet({ facelets }: { facelets: string }) {
  return (
    <div className="face-net" role="img" aria-label="Unfolded cube net showing every sticker">
      {LAYOUT.map(({ face, col, row }) => (
        <div key={face} className="face-net__face" style={{ gridColumn: col, gridRow: row }} aria-hidden>
          {Array.from({ length: 9 }, (_, i) => {
            const color = facelets[OFFSET[face] + i] as Face;
            return (
              <span key={i} className="face-net__sticker" style={{ background: FACE_COLORS[color].hex }}>
                {i === 4 ? face : ''}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
