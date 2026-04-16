import { ChevronDown } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { formatMove, mv } from '../../core/puzzle/notation';
import type { Face, Turns } from '../../core/puzzle/notation';
import { SPEED_KEYS } from '../../hooks/keymap';
import { cx } from '../ui/cx';

const PAD_FACES: readonly Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];
const ROWS: ReadonlyArray<{ turns: Turns; label: string }> = [
  { turns: 1, label: 'Clockwise' },
  { turns: 3, label: 'Counter-clockwise' },
  { turns: 2, label: 'Double' },
];

function keyHint(face: Face, turns: Turns, keyMap: 'faces' | 'speed'): string | null {
  if (turns === 2) return null;
  if (keyMap === 'faces') return turns === 1 ? face : `⇧${face}`;
  const entry = Object.entries(SPEED_KEYS).find(([, m]) => m.face === face && m.turns === turns);
  return entry ? entry[0].toUpperCase() : null;
}

export function MovePad() {
  const { studio } = useServices();
  const open = useStudio((s) => s.settings.movePadOpen);
  const keyMap = useStudio((s) => s.settings.keyMap);
  const lastMove = useStudio((s) => s.lastMove);
  // The matching key remounts per move (keyed by move id) so its one-shot CSS flash replays.
  const flash = lastMove && lastMove.source !== 'scramble' ? formatMove(lastMove.move) : null;

  return (
    <section className={cx('panel panel-movepad', !open && 'is-collapsed')} aria-labelledby="movepad-title">
      <header className="panel__header">
        <h2 id="movepad-title" className="eyebrow">
          <button
            type="button"
            className="collapse-toggle"
            aria-expanded={open}
            aria-controls="movepad-grid"
            onClick={() => studio.updateSettings({ movePadOpen: !open })}
          >
            Move pad
            <ChevronDown size={14} className="collapse-toggle__chevron" aria-hidden />
          </button>
        </h2>
        <span className="panel__meta">{keyMap === 'faces' ? 'Keys U D L R F B · ⇧ prime' : 'Speed keys'}</span>
      </header>
      {open && (
        <div id="movepad-grid" className="movepad" role="group" aria-label="Face turns">
          {PAD_FACES.map((face) => (
            <div key={face} className="movepad__col" style={{ ['--face' as string]: FACE_COLORS[face].hex }}>
              <span className="movepad__face" aria-hidden>
                <span className="movepad__swatch" />
                {face}
              </span>
              {ROWS.map(({ turns, label }) => {
                const move = mv(face, turns);
                const notation = formatMove(move);
                const hint = keyHint(face, turns, keyMap);
                return (
                  <button
                    key={flash === notation ? `${turns}-${lastMove?.id}` : turns}
                    type="button"
                    className={cx('keycap', flash === notation && 'is-flash')}
                    onClick={() => studio.turn(move)}
                    aria-label={`${notation}: turn ${FACE_COLORS[face].name} face (${face}) ${label.toLowerCase()}`}
                    title={hint ? `${notation} — key ${hint}` : notation}
                  >
                    <span className="keycap__label">{notation}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
