import { useState } from 'react';
import { Check, Copy, FastForward, Link2 } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { formatMove } from '../../core/puzzle/notation';
import { IconButton, Segmented } from '../ui/primitives';
import { cx } from '../ui/cx';
import { copyText } from '../../app/clipboard';

export function ScramblePanel() {
  const { studio } = useServices();
  const scramble = useStudio((s) => s.scramble);
  const style = useStudio((s) => s.settings.scrambleStyle);
  const [copied, setCopied] = useState<'text' | 'link' | null>(null);

  const copy = async (kind: 'text' | 'link') => {
    if (!scramble.text) return;
    const payload =
      kind === 'text' ? scramble.text : `${location.origin}${location.pathname}?scramble=${encodeURIComponent(scramble.text)}`;
    const ok = await copyText(payload);
    if (ok) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
      studio.notify('success', kind === 'text' ? 'Scramble copied' : 'Share link copied');
    } else {
      studio.notify('warn', 'Clipboard unavailable — select the scramble text to copy it manually.');
    }
  };

  const origin =
    scramble.origin === 'shared' ? 'Shared link' : scramble.origin === 'restored' ? 'Restored' : scramble.origin === 'random' ? 'Random state' : null;

  return (
    <section className="panel panel-scramble" aria-labelledby="scramble-title">
      <header className="panel__header">
        <h2 id="scramble-title" className="eyebrow">
          Scramble
          {origin && <span className="panel__badge">{origin}</span>}
        </h2>
        <div className="panel__tools">
          {scramble.status === 'applying' && (
            <IconButton label="Skip scramble animation" size="sm" onClick={() => studio.skipScrambleAnimation()}>
              <FastForward size={15} />
            </IconButton>
          )}
          <IconButton label="Copy scramble" size="sm" disabled={!scramble.text} onClick={() => void copy('text')}>
            {copied === 'text' ? <Check size={15} /> : <Copy size={15} />}
          </IconButton>
          <IconButton label="Copy share link" size="sm" disabled={!scramble.text} onClick={() => void copy('link')}>
            {copied === 'link' ? <Check size={15} /> : <Link2 size={15} />}
          </IconButton>
        </div>
      </header>

      {scramble.status === 'generating' && (
        <div className="scramble-skeleton" role="status">
          <span className="sr-only">Generating a random-state scramble</span>
          {Array.from({ length: 19 }, (_, i) => (
            <span key={i} className="scramble-skeleton__token" style={{ animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      )}

      {scramble.status === 'error' && <p className="panel__error">{scramble.error ?? 'Scramble failed.'}</p>}

      {!scramble.text && scramble.status !== 'generating' && scramble.status !== 'error' && (
        <p className="panel__empty">
          <span className="serif">No scramble yet.</span> Press <strong>New Scramble</strong> for a random-state WCA scramble.
        </p>
      )}

      {scramble.text && scramble.status !== 'generating' && (
        <p className="notation" aria-label={`Scramble: ${scramble.text}`}>
          {scramble.moves.map((move, i) => (
            <span
              key={i}
              className={cx(
                'notation__token',
                scramble.status === 'applying' && i < scramble.applied && 'is-done',
                scramble.status === 'applying' && i === scramble.applied && 'is-current',
              )}
            >
              {formatMove(move)}
            </span>
          ))}
        </p>
      )}

      <footer className="panel__footer">
        <Segmented
          label="Scramble playback"
          size="sm"
          value={style}
          onChange={(scrambleStyle) => studio.updateSettings({ scrambleStyle })}
          options={[
            { value: 'animate', label: 'Animate' },
            { value: 'instant', label: 'Instant' },
          ]}
        />
        <span className="panel__meta">{scramble.moves.length > 0 ? `${scramble.moves.length} moves · HTM` : 'WCA notation'}</span>
      </footer>
    </section>
  );
}
