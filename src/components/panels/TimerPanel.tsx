/**
 * The clock. The readout repaints itself with requestAnimationFrame straight
 * into the DOM (no React re-render per frame); the value is always derived
 * from timestamps, so it is exact regardless of frame rate or tab switches.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useServices, useStudio, useUi } from '../../app/context';
import { HOLD_TO_ARM_MS, INSPECTION_LIMIT_MS, elapsedMs, inspectionElapsedMs } from '../../core/timing/timerMachine';
import type { TimerState } from '../../core/timing/timerMachine';
import { formatTime, formatTps } from '../../core/stats/format';
import { bestSingle, effectiveMs } from '../../core/stats/stats';
import { cx } from '../ui/cx';

type Tone = 'idle' | 'ready' | 'live' | 'hold' | 'armed' | 'inspect' | 'warn' | 'done' | 'muted' | 'busy';

function describe(timer: TimerState, scrambling: boolean): { label: string; tone: Tone } {
  if (scrambling || timer.phase === 'scrambling') return { label: 'Scrambling', tone: 'busy' };
  switch (timer.phase) {
    case 'idle':
      return { label: 'Free play', tone: 'idle' };
    case 'ready':
      return { label: 'Ready', tone: 'ready' };
    case 'inspecting':
      return { label: 'Inspection', tone: 'inspect' };
    case 'arming':
      return { label: 'Hold', tone: 'hold' };
    case 'running':
      return { label: timer.assisted ? 'Solving · assisted' : 'Solving', tone: 'live' };
    case 'solved':
      return { label: timer.last?.assisted ? 'Solved · practice' : 'Solved', tone: 'done' };
    case 'interrupted':
      return { label: 'DNF', tone: 'warn' };
    case 'assisted':
      return { label: 'Assisted', tone: 'muted' };
    default:
      return { label: 'Free play', tone: 'idle' };
  }
}

function guidance(timer: TimerState, scrambling: boolean, solved: boolean): string {
  if (scrambling || timer.phase === 'scrambling') return 'Applying a random-state scramble…';
  const spacebar = timer.mode === 'spacebar';
  switch (timer.phase) {
    case 'idle':
      return solved ? 'New Scramble starts a timed attempt.' : 'Free play — turns are not timed. New Scramble starts an attempt.';
    case 'ready':
      if (!spacebar) return 'Turn any face to start the clock.';
      return timer.inspection ? 'Press Space (or tap the clock) to begin 15 s inspection.' : 'Hold Space (or the clock), release to start.';
    case 'inspecting':
      return 'Inspect freely by orbiting. Hold Space, release to start.';
    case 'arming':
      return 'Release to start…';
    case 'running':
      return spacebar ? 'Solve it — the clock stops on the solving turn. Space = stop (DNF).' : 'The clock stops on the turn that solves the cube.';
    case 'solved': {
      const last = timer.last;
      if (!last) return 'Solved.';
      const tps = formatTps(last.turnsSTM, last.durationMs);
      return `${last.turnsSTM} turns${tps ? ` · ${tps} tps` : ''}${last.assisted ? ' · undo used, saved as practice' : ''}`;
    }
    case 'interrupted':
      return timer.last?.note === 'inspection-timeout' ? 'Inspection passed 17 s — recorded as DNF.' : 'Stopped before solved — recorded as DNF.';
    case 'assisted':
      return 'Auto Solve was used, so this attempt is not timed.';
  }
}

function TimerReadout({ timer }: { timer: TimerState }) {
  const wholeRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const paint = () => {
      const now = performance.now();
      const root = rootRef.current;
      let whole = '0';
      let frac = '.00';
      let armed = false;
      const fromInspection = timer.phase === 'inspecting' || (timer.phase === 'arming' && timer.armingFrom === 'inspecting');
      if (fromInspection) {
        const used = inspectionElapsedMs(timer, now);
        const left = Math.ceil((INSPECTION_LIMIT_MS - used) / 1000);
        whole = left > 0 ? String(left) : '+2';
        frac = '';
      } else if (timer.phase === 'running' || timer.phase === 'solved' || timer.phase === 'interrupted') {
        if (timer.phase === 'interrupted') {
          whole = 'DNF';
          frac = '';
        } else {
          const text = formatTime(elapsedMs(timer, now));
          const dot = text.lastIndexOf('.');
          whole = text.slice(0, dot);
          frac = text.slice(dot);
        }
      }
      if (timer.phase === 'arming' && timer.holdStartedAt !== null) armed = now - timer.holdStartedAt >= HOLD_TO_ARM_MS;
      if (wholeRef.current && wholeRef.current.textContent !== whole) wholeRef.current.textContent = whole;
      if (fracRef.current && fracRef.current.textContent !== frac) fracRef.current.textContent = frac;
      if (root) root.dataset.armed = armed ? 'true' : 'false';
    };
    paint();
    const live = timer.phase === 'running' || timer.phase === 'inspecting' || timer.phase === 'arming';
    if (!live) return;
    let frame = 0;
    const loop = () => {
      paint();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [timer]);

  return (
    <div ref={rootRef} className="readout" data-phase={timer.phase}>
      <span ref={wholeRef} className="readout__whole">
        0
      </span>
      <span ref={fracRef} className="readout__frac">
        .00
      </span>
    </div>
  );
}

export function TimerPanel() {
  const { studio } = useServices();
  const timer = useStudio((s) => s.timer);
  const scrambleStatus = useStudio((s) => s.scramble.status);
  const solved = useStudio((s) => s.solved);
  const history = useStudio((s) => s.history);
  const celebration = useStudio((s) => s.celebration);
  const gestureHint = useUi((s) => s.gestureHint);
  const scrambling = scrambleStatus === 'generating' || scrambleStatus === 'applying';
  const status = describe(timer, scrambling);
  const spacebar = timer.mode === 'spacebar';

  // A new personal best: the last completed attempt is the best eligible single.
  const isPB = useMemo(() => {
    const last = history[history.length - 1];
    if (!last || timer.phase !== 'solved' || last.assisted || last.penalty === 'DNF') return false;
    const previous = bestSingle(history.slice(0, -1));
    return previous === null ? history.filter((r) => !r.assisted).length > 1 : effectiveMs(last) < previous;
  }, [history, timer.phase]);

  const pressable = spacebar && ['ready', 'inspecting', 'arming', 'running'].includes(timer.phase);

  return (
    <section className={cx('panel-timer', celebration && timer.phase === 'solved' && 'is-celebrating')} aria-label="Timer" key={celebration?.id ?? 0}>
      <div className="panel-timer__meta">
        <span className={cx('status-pill', `status-pill--${status.tone}`)}>
          <span className="status-pill__dot" aria-hidden />
          {status.label}
        </span>
        <span className="panel-timer__mode">
          {spacebar ? `Spacebar${timer.inspection ? ' · 15 s inspection' : ''}` : 'Casual timer'}
          {timer.penalty === '+2' && timer.phase !== 'idle' && <span className="tag tag--warn">+2</span>}
          {isPB && <span className="tag tag--accent">Personal best</span>}
        </span>
      </div>
      <div
        className={cx('panel-timer__clock', pressable && 'is-pressable')}
        {...(pressable
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': timer.phase === 'running' ? 'Stop timer (records DNF)' : 'Hold to arm the timer, release to start',
              onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                studio.spaceDown(e.timeStamp);
              },
              onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => studio.spaceUp(e.timeStamp),
              onPointerCancel: () => studio.cancelArming(),
            }
          : {})}
      >
        <TimerReadout timer={timer} />
      </div>
      <p className="panel-timer__hint" aria-live="off">
        {guidance(timer, scrambling, solved)}
      </p>
      {gestureHint && (
        <p className="panel-timer__gesture">
          Drag stickers to twist — middle rows turn slices
          <br />
          Drag outside the cube to orbit
        </p>
      )}
    </section>
  );
}
