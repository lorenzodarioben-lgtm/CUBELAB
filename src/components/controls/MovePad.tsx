import { ChevronDown } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { formatMove, mv } from '../../core/puzzle/notation';
import type { MoveFamily, Turns } from '../../core/puzzle/notation';
import { SPEED_KEYS } from '../../hooks/keymap';
import { Segmented } from '../ui/primitives';
import { cx } from '../ui/cx';

const FACE_BANK: readonly MoveFamily[] = ['U', 'D', 'L', 'R', 'F', 'B'];
const SLICE_BANK: readonly MoveFamily[] = ['M', 'E', 'S'];

/** What each slice is, in words (for labels and tooltips). */
const SLICE_INFO: Readonly<Record<'M' | 'E' | 'S', { between: string; follows: string }>> = {
  M: { between: 'between L and R', follows: 'turns like L' },
  E: { between: 'between U and D', follows: 'turns like D' },
  S: { between: 'between F and B', follows: 'turns like F' },
};

const ROWS: ReadonlyArray<{ turns: Turns; label: string }> = [
  { turns: 1, label: 'clockwise' },
  { turns: 3, label: 'counter-clockwise' },
  { turns: 2, label: 'double' },
];

function keyHint(family: MoveFamily, turns: Turns, keyMap: 'faces' | 'speed'): string | null {
  if (turns === 2) return null;
  if (keyMap === 'faces') return turns === 1 ? family : `⇧${family}`;
  const entry = Object.entries(SPEED_KEYS).find(([, m]) => m.family === family && m.turns === turns);
  return entry ? entry[0].toUpperCase() : null;
}

function familyLabel(family: MoveFamily): string {
  if (family === 'M' || family === 'E' || family === 'S') return `${family} slice, ${SLICE_INFO[family].between}`;
  return `${FACE_COLORS[family].name} face (${family})`;
}

export function MovePad() {
  const { studio } = useServices();
  const open = useStudio((s) => s.settings.movePadOpen);
  const keyMap = useStudio((s) => s.settings.keyMap);
  const bank = useStudio((s) => s.settings.padLayers);
  const lastMove = useStudio((s) => s.lastMove);
  // The matching key remounts per move (keyed by move id) so its one-shot CSS flash replays.
  const flash = lastMove && lastMove.source !== 'scramble' ? formatMove(lastMove.move) : null;
  const families = bank === 'slices' ? SLICE_BANK : FACE_BANK;

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
        {open && (
          <Segmented
            label="Move pad layers"
            size="sm"
            value={bank}
            onChange={(padLayers) => studio.updateSettings({ padLayers })}
            options={[
              { value: 'faces', label: 'Faces', title: 'Outer faces U D L R F B' },
              { value: 'slices', label: 'Slices', title: 'Middle slices M E S' },
            ]}
          />
        )}
      </header>
      {open && (
        <>
          <div id="movepad-grid" className={cx('movepad', `movepad--${bank}`)} role="group" aria-label={bank === 'slices' ? 'Slice turns' : 'Face turns'}>
            {families.map((family) => {
              const isSliceFamily = family === 'M' || family === 'E' || family === 'S';
              return (
                <div
                  key={family}
                  className={cx('movepad__col', isSliceFamily && 'movepad__col--slice')}
                  style={isSliceFamily ? undefined : { ['--face' as string]: FACE_COLORS[family].hex }}
                >
                  <span className="movepad__face" aria-hidden title={isSliceFamily ? `${SLICE_INFO[family].between} · ${SLICE_INFO[family].follows}` : undefined}>
                    <span className="movepad__swatch" />
                    {family}
                  </span>
                  {ROWS.map(({ turns, label }) => {
                    const move = mv(family, turns);
                    const notation = formatMove(move);
                    const hint = keyHint(family, turns, keyMap);
                    return (
                      <button
                        key={flash === notation ? `${turns}-${lastMove?.id}` : turns}
                        type="button"
                        className={cx('keycap', flash === notation && 'is-flash')}
                        onClick={() => studio.turn(move)}
                        aria-label={`${notation}: turn ${familyLabel(family)} ${label}`}
                        title={hint ? `${notation} — key ${hint}` : notation}
                      >
                        <span className="keycap__label">{notation}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="panel__meta movepad__legend">
            {bank === 'slices'
              ? keyMap === 'faces'
                ? 'Keys M E S · ⇧ prime · M follows L, E follows D, S follows F'
                : 'Keys 5/6 M · 2/3 E · 8/9 S'
              : keyMap === 'faces'
                ? 'Keys U D L R F B · ⇧ prime'
                : 'Speed keys I K J F H G D E S L W O'}
          </p>
        </>
      )}
    </section>
  );
}
