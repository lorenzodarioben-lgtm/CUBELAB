import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, RotateCcw, Shuffle, Square, X } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { requestAutoSolve, requestNewScramble } from '../../app/actions';
import { formatMove } from '../../core/puzzle/notation';
import { Button, IconButton, Segmented, Spinner } from '../ui/primitives';
import { cx } from '../ui/cx';

export function PlaybackPanel() {
  const services = useServices();
  const { studio } = services;
  const solver = useStudio((s) => s.solver);
  const speed = useStudio((s) => s.settings.playbackSpeed);
  const stripRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>('.is-current') ?? strip?.querySelector<HTMLElement>('.is-done:last-of-type');
    if (strip && current) {
      const left = current.offsetLeft - strip.clientWidth / 2 + current.clientWidth / 2;
      strip.scrollTo({ left, behavior: 'smooth' });
    }
  }, [solver.cursor, solver.moves]);

  if (solver.status === 'idle') return null;

  const total = solver.moves.length;
  const playing = solver.status === 'playing';
  const paused = solver.status === 'paused';
  const done = solver.status === 'done';
  const hasSession = playing || paused || done;

  const statusText = {
    solving: solver.warm ? 'Computing a solution…' : 'Warming up the solver (first run)…',
    playing: 'Playing',
    paused: 'Paused',
    done: `Solved in ${total} moves`,
    stale: 'The cube changed — this solution no longer applies.',
    error: solver.error ?? 'The solver failed.',
    idle: '',
  }[solver.status];

  return (
    <section className={cx('panel panel-playback', `is-${solver.status}`)} aria-label="Auto Solve playback">
      <header className="panel-playback__header">
        <div className="panel-playback__title">
          <span className="eyebrow">Auto Solve</span>
          <span className="panel-playback__status" role="status">
            {solver.status === 'solving' && <Spinner size={12} />}
            {statusText}
          </span>
        </div>
        {hasSession && (
          <span className="panel-playback__count" aria-label={`${solver.cursor} of ${total} moves applied`}>
            <strong>{solver.cursor}</strong> / {total}
          </span>
        )}
        {!playing && solver.status !== 'solving' && (
          <IconButton label="Close solution" size="sm" onClick={() => studio.dismissSolver()}>
            <X size={15} />
          </IconButton>
        )}
      </header>

      {hasSession && (
        <ol ref={stripRef} className="solution-strip" aria-label="Solution moves">
          {solver.moves.map((move, i) => (
            <li key={i} className={cx('solution-strip__move', i < solver.cursor && 'is-done', i === solver.cursor && !done && 'is-current')}>
              {formatMove(move)}
            </li>
          ))}
        </ol>
      )}

      {hasSession && (
        <div className="transport">
          <div className="transport__buttons" role="group" aria-label="Playback controls">
            <IconButton label="Replay from the start" onClick={() => studio.playbackReplay()} disabled={solver.stepping}>
              <RotateCcw size={16} />
            </IconButton>
            <IconButton label="Step back (,)" onClick={() => studio.playbackStep(-1)} disabled={playing || solver.stepping || solver.cursor === 0}>
              <ChevronLeft size={18} />
            </IconButton>
            {playing ? (
              <IconButton label="Pause (P)" className="transport__play" onClick={() => studio.playbackPause()}>
                <Pause size={18} />
              </IconButton>
            ) : (
              <IconButton label={done ? 'Replay (P)' : 'Play (P)'} className="transport__play" onClick={() => studio.playbackPlay()} disabled={solver.stepping}>
                <Play size={18} />
              </IconButton>
            )}
            <IconButton label="Step forward (.)" onClick={() => studio.playbackStep(1)} disabled={playing || solver.stepping || solver.cursor >= total}>
              <ChevronRight size={18} />
            </IconButton>
            <IconButton label="Stop — keep the cube as it is" onClick={() => studio.playbackStop()} disabled={done}>
              <Square size={14} />
            </IconButton>
          </div>
          <Segmented
            label="Playback speed"
            size="sm"
            value={speed}
            onChange={(playbackSpeed) => studio.updateSettings({ playbackSpeed })}
            options={[
              { value: 'slow', label: 'Slow' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
          />
        </div>
      )}

      {(solver.status === 'stale' || solver.status === 'error') && (
        <div className="panel-playback__actions">
          <Button size="sm" variant="accent" icon={<RefreshCw size={14} />} onClick={() => requestAutoSolve(services)}>
            Solve current state
          </Button>
        </div>
      )}
      {done && (
        <div className="panel-playback__actions">
          <Button size="sm" variant="primary" icon={<Shuffle size={14} />} onClick={() => requestNewScramble(services)}>
            New Scramble
          </Button>
        </div>
      )}
    </section>
  );
}
