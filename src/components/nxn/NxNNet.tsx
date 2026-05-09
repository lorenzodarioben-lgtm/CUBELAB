import { useMemo } from 'react';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import { nxFacelets } from '../../core/nxn/facelets';
import type { NxState } from '../../core/nxn/model';

/** Fully playable face net for devices without a 3D context. */
export function NxNNet({ state, onTurn }: { readonly state: NxState; readonly onTurn: (face: Face, inverse: boolean) => void }) {
  const colors = useMemo(() => nxFacelets(state), [state]);
  return (
    <div className="nxn-net" role="group" aria-label={`${state.size}×${state.size} cube net`}>
      {FACES.map((face) => (
        <button
          key={face}
          className={`nxn-net__face nxn-net__face--${face}`}
          type="button"
          aria-label={`Turn ${face} face (Shift for inverse)`}
          title={`${face}: click to turn, Shift-click for inverse`}
          style={{ gridTemplateColumns: `repeat(${state.size}, minmax(0, 1fr))` }}
          onClick={(event) => onTurn(face, event.shiftKey)}
        >
          {colors[face].map((color, index) => <span key={index} className="nxn-net__sticker" style={{ backgroundColor: FACE_COLORS[color].hex }} />)}
        </button>
      ))}
    </div>
  );
}
