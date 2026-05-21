import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Redo2, RotateCcw, Shuffle, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { mv } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import { formatAverage, formatTime } from '../../core/stats/format';
import { effectiveMs } from '../../core/stats/stats';
import { cubeEvent } from '../../core/nxn/catalog';
import type { CubeEventId } from '../../core/nxn/catalog';
import { invertNxMove, isNxSolved } from '../../core/nxn/model';
import type { NxMove } from '../../core/nxn/model';
import { formatNxAlg, formatNxMove } from '../../core/nxn/notation';
import { generateNxScramble } from '../../core/nxn/scramble';
import { applyNxSolution, bestNxSingle, createNxSession, redoNxSession, resetNxSession, scrambleNxSession, turnNxSession, undoNxSession } from '../../core/nxn/session';
import { solveTwoByTwo } from '../../core/nxn/solver';
import { loadNxHistory, saveNxHistory } from '../../core/nxn/storage';
import { browserStore } from '../../core/persistence/storage';
import { Button, IconButton, Spinner } from '../ui/primitives';
import { NxNCanvas } from './NxNCanvas';
import { NxNNet } from './NxNNet';
import { useServices } from '../../app/context';
import { parseManualTime } from '../../core/nxn/manualTime';
import { addManualNxSolve, deleteNxSolve, setNxPenalty } from '../../core/nxn/session';
import type { Penalty } from '../../core/timing/timerMachine';
import { summarizeNx } from '../../core/nxn/stats';

const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
type ActiveTurn = { readonly token: number; readonly move: NxMove; readonly kind: 'manual' | 'undo' | 'redo'; readonly durationMs: number };

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch { return false; }
}

export function NxNStudio({ eventId }: { readonly eventId: CubeEventId }) {
  const { studio } = useServices();
  const event = cubeEvent(eventId)!;
  const storage = useMemo(() => browserStore(), []);
  const [session, setSession] = useState(() => createNxSession(event.size, loadNxHistory(storage, eventId)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(1);
  const [now, setNow] = useState(() => performance.now());
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deletePending, setDeletePending] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState('');
  const [manualPenalty, setManualPenalty] = useState<Penalty>('none');
  const [solving, setSolving] = useState(false);
  const [solution, setSolution] = useState<readonly NxMove[] | null>(null);
  const [active, setActive] = useState<ActiveTurn | null>(null);
  const activeRef = useRef<ActiveTurn | null>(null);
  const turnSerial = useRef(0);
  const request = useRef(0);
  const solveRequest = useRef(0);
  const webgl = useMemo(() => canUseWebGL(), []);

  useEffect(() => () => { request.current++; solveRequest.current++; document.body.style.cursor = ''; }, []);
  useEffect(() => { saveNxHistory(storage, eventId, session.solves); }, [storage, eventId, session.solves]);
  useEffect(() => {
    if (session.phase !== 'running') return;
    const id = window.setInterval(() => setNow(performance.now()), 40);
    return () => window.clearInterval(id);
  }, [session.phase]);

  const applyTurn = useCallback((entry: ActiveTurn) => {
    const at = performance.now();
    const wallClock = Date.now();
    const id = crypto.randomUUID();
    setNow(at);
    setSession((current) => {
      if (entry.kind === 'undo') return undoNxSession(current, at);
      if (entry.kind === 'redo') return redoNxSession(current, at, wallClock, id);
      return turnNxSession(current, entry.move, at, wallClock, id);
    });
  }, []);

  const beginTurn = useCallback((move: NxMove, kind: ActiveTurn['kind']) => {
    if (loading || activeRef.current) return;
    solveRequest.current++;
    setSolving(false);
    setSolution(null);
    const entry: ActiveTurn = { token: ++turnSerial.current, move, kind, durationMs: 175 + 25 * (move.width - 1) };
    const instant = !webgl || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pitch = (event.size === 2 ? 1.065 : 1 - Math.max(0, event.size - 3) * 0.018) - (move.width - 1) * 0.012;
    studio.playPracticeTurn(mv(move.face, move.turns), instant ? 0 : entry.durationMs, pitch);
    if (instant) {
      applyTurn(entry);
      return;
    }
    activeRef.current = entry;
    setActive(entry);
  }, [loading, webgl, applyTurn, event.size, studio]);

  const finishTurn = useCallback((token: number) => {
    const entry = activeRef.current;
    if (!entry || entry.token !== token) return;
    activeRef.current = null;
    setActive(null);
    applyTurn(entry);
  }, [applyTurn]);

  const turn = useCallback((face: Face, inverse: boolean) => {
    beginTurn({ face, width, turns: inverse ? 3 : 1 }, 'manual');
  }, [beginTurn, width]);

  const newScramble = useCallback(async () => {
    activeRef.current = null;
    setActive(null);
    solveRequest.current++;
    setSolving(false);
    setSolution(null);
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const scramble = await generateNxScramble(eventId);
      if (request.current === id) setSession((current) => scrambleNxSession(current, scramble));
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'Scramble failed. Try again.');
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [eventId]);

  const findSolution = async () => {
    if (event.size !== 2 || isNxSolved(session.cube) || active || loading) return;
    const id = ++solveRequest.current;
    setSolving(true);
    setSolution(null);
    setError(null);
    try {
      const answer = await solveTwoByTwo(session.cube, session.scramble, session.moves);
      if (solveRequest.current === id) setSolution(answer);
    } catch (cause) {
      if (solveRequest.current === id) setError(cause instanceof Error ? cause.message : 'Could not solve this 2×2.');
    } finally {
      if (solveRequest.current === id) setSolving(false);
    }
  };

  const undo = useCallback(() => {
    const move = session.undo.at(-1);
    if (move) beginTurn(invertNxMove(move), 'undo');
  }, [session.undo, beginTurn]);
  const redo = useCallback(() => {
    const move = session.redo.at(-1);
    if (move) beginTurn(move, 'redo');
  }, [session.redo, beginTurn]);

  useEffect(() => {
    const onKey = (key: KeyboardEvent) => {
      const target = key.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      if ((key.ctrlKey || key.metaKey) && key.code === 'KeyZ') {
        key.preventDefault();
        if (key.shiftKey) redo(); else undo();
        return;
      }
      if (key.ctrlKey || key.metaKey || key.altKey || key.repeat) return;
      if (key.code === 'KeyN') { key.preventDefault(); void newScramble(); return; }
      const face = key.key.toUpperCase();
      if (FACE_ORDER.includes(face as Face)) {
        key.preventDefault();
        turn(face as Face, key.shiftKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newScramble, redo, turn, undo]);

  const duration = session.phase === 'running' && session.startedAt !== null
    ? Math.max(0, now - session.startedAt)
    : session.phase === 'ready' ? 0 : session.lastDurationMs;
  const best = bestNxSingle(session.solves);
  const statistics = useMemo(() => summarizeNx(eventId, session.solves), [eventId, session.solves]);
  const cleanCount = session.solves.filter((solve) => !solve.assisted && solve.penalty !== 'DNF').length;
  const maxWidth = Math.floor(event.size / 2);

  const copy = async () => {
    if (!session.scramble) return;
    try {
      await navigator.clipboard.writeText(session.scramble);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { setError('Clipboard unavailable. Select the scramble text to copy it.'); }
  };

  const saveManualTime = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const duration = manualPenalty === 'DNF' && !manualTime.trim() ? 0 : parseManualTime(manualTime);
    if (duration === null) {
      setError('Enter a time like 12.34 or 1:02.34.');
      return;
    }
    setSession((current) => addManualNxSolve(current, duration, manualPenalty, Date.now(), crypto.randomUUID()));
    setManualOpen(false);
    setManualTime('');
    setManualPenalty('none');
    setShowHistory(true);
    setError(null);
  };

  return (
    <main className="nxn-layout" aria-label={`${event.label} practice studio`}>
      <section className="nxn-readouts" aria-label="Practice readouts">
        <div className="nxn-clock">
          <span className="nxn-label">{session.phase === 'running' ? 'SOLVING' : session.phase === 'ready' ? 'READY' : session.phase === 'solved' ? 'SOLVED' : 'PRACTICE TIMER'}</span>
          <strong className="nxn-clock__time" role="timer">{formatTime(duration)}</strong>
          <span className="nxn-clock__note">{session.phase === 'ready' ? 'First turn starts the clock' : session.phase === 'running' ? 'Solve the puzzle to stop' : 'Use New Scramble for a timed attempt'}</span>
        </div>
        <div className="nxn-readout">
          <div className="nxn-readout__head"><h2>Scramble</h2><IconButton label="Copy scramble" size="sm" disabled={!session.scramble} onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconButton></div>
          <p className="nxn-scramble">{session.scramble ?? 'Generate a scramble to begin.'}</p>
          {error && <p className="nxn-error" role="alert">{error}</p>}
        </div>
        <div className="nxn-readout nxn-records">
          <h2>Session</h2>
          <dl>
            <div><dt>Best single</dt><dd>{formatTime(best)}</dd></div>
            <div><dt>{statistics.currentLabel}</dt><dd>{formatAverage(statistics.current)}</dd></div>
            <div><dt>{statistics.secondaryLabel}</dt><dd>{formatAverage(statistics.secondary)}</dd></div>
            <div><dt>Session mean</dt><dd>{formatAverage(statistics.mean)}</dd></div>
            <div><dt>Clean solves</dt><dd>{cleanCount}</dd></div>
            <div><dt>Moves</dt><dd>{session.moves.length}</dd></div>
          </dl>
          <button type="button" className="nxn-history-toggle" onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}>
            {showHistory ? 'Hide' : 'Show'} recent solves
          </button>
          <button type="button" className="nxn-history-toggle nxn-add-time" onClick={() => setManualOpen((value) => !value)} aria-expanded={manualOpen}>
            {manualOpen ? 'Cancel entry' : 'Add physical solve'}
          </button>
          {manualOpen && <form className="nxn-manual-form" onSubmit={saveManualTime}>
            <label>Time <input type="text" inputMode="decimal" placeholder="12.34" value={manualTime} onChange={(event) => setManualTime(event.target.value)} /></label>
            <label>Penalty <select value={manualPenalty} onChange={(event) => setManualPenalty(event.target.value as Penalty)}><option value="none">None</option><option value="+2">+2</option><option value="DNF">DNF</option></select></label>
            <button type="submit">Save result</button>
          </form>}
          {showHistory && <ol className="nxn-history">{session.solves.slice(-8).reverse().map((solve) => <li key={solve.id}>
            <span>{new Date(solve.at).toLocaleDateString()}</span>
            <strong>{formatTime(effectiveMs(solve))}</strong>
            {solve.assisted && <small>practice</small>}{solve.source === 'manual' && <small>physical</small>}
            <select aria-label={`Penalty for solve ${solve.id}`} value={solve.penalty} onChange={(event) => setSession((current) => setNxPenalty(current, solve.id, event.target.value as Penalty))}>
              <option value="none">OK</option><option value="+2">+2</option><option value="DNF">DNF</option>
            </select>
            {deletePending === solve.id ? <span className="nxn-history__confirm">
              <button type="button" onClick={() => { setSession((current) => deleteNxSolve(current, solve.id)); setDeletePending(null); }}>Delete</button>
              <button type="button" onClick={() => setDeletePending(null)}>Cancel</button>
            </span> : <button type="button" className="nxn-history__delete" aria-label={`Remove solve ${solve.id}`} title="Remove solve" onClick={() => setDeletePending(solve.id)}><Trash2 size={13} /></button>}
          </li>)}</ol>}
        </div>
      </section>

      <section className="nxn-stage" aria-label={`${event.label} interactive cube`}>
        {webgl ? <NxNCanvas state={session.cube} active={active} onTurn={turn} onGestureTurn={(move) => beginTurn(move, 'manual')} onTurnComplete={finishTurn} /> : <div className="nxn-no-webgl"><NxNNet state={session.cube} onTurn={turn} /><p>3D is unavailable here. The net and turn controls remain playable.</p></div>}
        <p className="nxn-stage__hint">{webgl ? 'Tap a coloured face to turn · Shift + tap for inverse · Drag the background to orbit' : 'Tap a face to turn · Shift + tap for inverse'}</p>
      </section>

      <section className="nxn-controls" aria-label="Puzzle controls">
        <div className="nxn-controls__actions">
          <Button variant="primary" size="lg" icon={loading ? <Spinner /> : <Shuffle size={17} />} busy={loading} onClick={() => void newScramble()}>
            {loading ? 'Generating…' : 'New Scramble'}
          </Button>
          <div className="nxn-controls__row">
            <Button variant="ghost" size="lg" icon={<RotateCcw size={16} />} onClick={() => { request.current++; solveRequest.current++; activeRef.current = null; setActive(null); setLoading(false); setSolving(false); setSolution(null); setError(null); setSession(resetNxSession); }}>Reset</Button>
            <IconButton label="Undo" disabled={!session.undo.length || !!active || loading} onClick={undo}><Undo2 size={17} /></IconButton>
            <IconButton label="Redo" disabled={!session.redo.length || !!active || loading} onClick={redo}><Redo2 size={17} /></IconButton>
          </div>
          {event.size === 2 && <Button variant="accent" size="lg" icon={solving ? <Spinner /> : <Sparkles size={16} />} busy={solving} disabled={isNxSolved(session.cube) || loading || !!active} onClick={() => void findSolution()}>
            {solving ? 'Solving…' : 'Find Solution'}
          </Button>}
          {solution && <div className="nxn-solution"><p>{formatNxAlg(solution)}</p><Button variant="ghost" size="sm" onClick={() => { setSession((current) => applyNxSolution(current, solution)); setSolution(null); }}>Apply solution</Button></div>}
        </div>
        <div className="nxn-turns">
          <h2>Turn layers</h2>
          <div className="nxn-width" role="group" aria-label="Layer width">
            {Array.from({ length: maxWidth }, (_, index) => index + 1).map((value) => (
              <button key={value} type="button" className={value === width ? 'is-active' : ''} onClick={() => setWidth(value)} aria-pressed={value === width}>
                {value === 1 ? 'Outer' : value === 2 ? 'Wide 2' : `Wide ${value}`}
              </button>
            ))}
          </div>
          <div className="nxn-move-grid">
            {FACE_ORDER.map((face) => (
              <div className="nxn-move-pair" key={face}>
                <button type="button" onClick={() => turn(face, false)} title={`Turn ${face} clockwise`} disabled={loading || !!active}>{formatNxMove({ face, width, turns: 1 })}</button>
                <button type="button" onClick={() => turn(face, true)} title={`Turn ${face} counter-clockwise`} disabled={loading || !!active}>{formatNxMove({ face, width, turns: 3 })}</button>
              </div>
            ))}
          </div>
          <p className="nxn-last-turn" aria-live="polite">Last turn <strong>{session.moves.length ? formatNxMove(session.moves.at(-1)!) : '—'}</strong></p>
          <p className="nxn-controls__tip">Keyboard: U R F D L B · hold Shift for inverse · N for scramble · Ctrl+Z to undo</p>
        </div>
        <p className="nxn-solved-indicator" aria-live="polite">{isNxSolved(session.cube) ? 'Puzzle solved' : `${event.shortLabel} in progress`}</p>
      </section>
    </main>
  );
}
