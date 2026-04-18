import { useEffect, useRef } from 'react';
import { useStudio } from '../../app/context';
import { formatMove, isSlice } from '../../core/puzzle/notation';
import { cx } from '../ui/cx';

const VISIBLE = 24;

/**
 * The user's own turns since the last scramble or reset — faces and slices —
 * with a running STM count. Undo removes the last entry, so the tape always
 * reads as the path from the scramble to the cube on screen.
 */
export function MoveLog() {
  const log = useStudio((s) => s.moveLog);
  const count = useStudio((s) => s.moveCount);
  const tapeRef = useRef<HTMLOListElement>(null);
  const recent = log.slice(-VISIBLE);
  const offset = count - recent.length;

  useEffect(() => {
    const tape = tapeRef.current;
    if (tape) tape.scrollLeft = tape.scrollWidth;
  }, [count]);

  return (
    <section className="panel panel-moves" aria-labelledby="moves-title">
      <header className="panel__header">
        <h2 id="moves-title" className="eyebrow">
          Turns
        </h2>
        <span className="moves__count" aria-label={`${count} turns`}>
          {count}
          <span className="moves__unit">STM</span>
        </span>
      </header>
      {count === 0 ? (
        <p className="panel__empty panel__empty--inline">Faces and slices you turn appear here.</p>
      ) : (
        <ol ref={tapeRef} className="moves" aria-label={`Last ${recent.length} turns`}>
          {offset > 0 && (
            <li className="moves__more" aria-hidden>
              …
            </li>
          )}
          {recent.map((move, i) => (
            <li
              key={offset + i}
              className={cx('moves__item', i === recent.length - 1 && 'is-latest', isSlice(move.family) && 'is-slice')}
            >
              {formatMove(move)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
