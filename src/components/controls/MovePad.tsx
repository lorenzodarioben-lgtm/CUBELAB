import { ChevronDown } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { formatMove, isFace, isRotation, mv } from '../../core/puzzle/notation';
import type { MoveFamily, Turns } from '../../core/puzzle/notation';
import { SPEED_KEYS } from '../../hooks/keymap';
import { Segmented } from '../ui/primitives';
import { cx } from '../ui/cx';

const FACE_BANK: readonly MoveFamily[] = ['U', 'D', 'L', 'R', 'F', 'B'];
const SLICE_BANK: readonly MoveFamily[] = ['M', 'E', 'S'];
const ROTATION_BANK: readonly MoveFamily[] = ['x', 'y', 'z'];

/** The face each whole-cube rotation turns like. */
const ROTATION_INFO: Readonly<Record<'x' | 'y' | 'z', string>> = {
  x: 'like R',
  y: 'like U',
  z: 'like F',
};

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
  // Rotation keys are the same in both layouts.
  if (keyMap === 'faces' || isRotation(family)) return turns === 1 ? family.toUpperCase() : `⇧${family.toUpperCase()}`;
  const entry = Object.entries(SPEED_KEYS).find(([, m]) => m.family === family && m.turns === turns);
  return entry ? entry[0].toUpperCase() : null;
}

function familyLabel(family: MoveFamily): string {
  if (family === 'M' || family === 'E' || family === 'S') return `${family} slice, ${SLICE_INFO[family].between}`;
  if (family === 'x' || family === 'y' || family === 'z') return `the whole cube (${family}, ${ROTATION_INFO[family]})`;
  return `${FACE_COLORS[family].name} face (${family})`;
}

const BANK_FAMILIES = { faces: FACE_BANK, slices: SLICE_BANK, rotations: ROTATION_BANK } as const;

export function MovePad() {
  const { studio } = useServices();
  const open = useStudio((s) => s.settings.movePadOpen);
  const keyMap = useStudio((s) => s.settings.keyMap);
  const bank = useStudio((s) => s.settings.padLayers);
  const lastMove = useStudio((s) => s.lastMove);
  // The matching key remounts per move (keyed by move id) so its one-shot CSS flash replays.
  const flash = lastMove && lastMove.source !== 'scramble' ? formatMove(lastMove.move) : null;
  const families = BANK_FAMILIES[bank];

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
              { value: 'rotations', label: 'Rotate', title: 'Whole-cube rotations x y z' },
            ]}
          />
        )}
      </header>
      {open && (
        <>
          <div
            id="movepad-grid"
            className={cx('movepad', `movepad--${bank === 'faces' ? 'faces' : 'slices'}`)}
            role="group"
            aria-label={bank === 'slices' ? 'Slice turns' : bank === 'rotations' ? 'Whole-cube rotations' : 'Face turns'}
          >
            {families.map((family) => {
              const isFaceFamily = isFace(family);
              const hint =
                family === 'M' || family === 'E' || family === 'S'
                  ? `${SLICE_INFO[family].between} · ${SLICE_INFO[family].follows}`
                  : family === 'x' || family === 'y' || family === 'z'
                    ? `Whole cube, ${ROTATION_INFO[family]}`
                    : undefined;
              return (
                <div
                  key={family}
                  className={cx('movepad__col', !isFaceFamily && 'movepad__col--slice')}
                  style={isFaceFamily ? { ['--face' as string]: FACE_COLORS[family].hex } : undefined}
                >
                  <span className="movepad__face" aria-hidden title={hint}>
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
              : bank === 'rotations'
                ? 'Keys X Y Z · ⇧ prime · turns the whole cube; U is always the top'
                : keyMap === 'faces'
                  ? 'Keys U D L R F B · ⇧ prime'
                  : 'Speed keys I K J F H G D E S L W O'}
          </p>
        </>
      )}
    </section>
  );
}
