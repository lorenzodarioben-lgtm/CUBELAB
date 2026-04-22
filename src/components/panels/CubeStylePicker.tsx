/**
 * Cube style chooser: two cards, each with a preview rendered from the real
 * model (see scripts/capture-style-previews.mjs). A native radio group, so
 * arrow keys, focus and screen readers behave as expected. Choosing a style
 * only changes the physical model on screen — the cube, timer and history
 * carry on untouched.
 */
import type { CubeStyle } from '../../core/persistence/settings';
import stickeredPreview from '../../assets/cube-styles/stickered.webp';
import stickerlessPreview from '../../assets/cube-styles/stickerless.webp';
import { cx } from '../ui/cx';

const OPTIONS: ReadonlyArray<{ value: CubeStyle; title: string; description: string; image: string }> = [
  {
    value: 'stickered',
    title: 'Classic Stickered',
    description: 'Black-frame cube with raised coloured tiles.',
    image: stickeredPreview,
  },
  {
    value: 'stickerless',
    title: 'Premium Stickerless',
    description: 'Modern speedcube with moulded coloured plastic.',
    image: stickerlessPreview,
  },
];

export function CubeStylePicker({ value, onChange }: { value: CubeStyle; onChange: (style: CubeStyle) => void }) {
  return (
    <fieldset className="style-picker">
      <legend className="sr-only">Cube style</legend>
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <label key={option.value} className={cx('style-card', selected && 'is-selected')}>
            <input
              className="style-card__input"
              type="radio"
              name="cube-style"
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
            />
            <span className="style-card__preview" aria-hidden>
              <img src={option.image} alt="" width={144} height={144} decoding="async" draggable={false} />
            </span>
            <span className="style-card__text">
              <span className="style-card__title">{option.title}</span>
              <span className="style-card__description">{option.description}</span>
            </span>
            <span className="style-card__mark" aria-hidden />
          </label>
        );
      })}
    </fieldset>
  );
}
