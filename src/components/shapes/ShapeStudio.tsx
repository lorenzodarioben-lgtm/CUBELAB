import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { puzzles } from 'cubing/puzzles';
import { TwistyPlayer } from 'cubing/twisty';
import { Check, Copy, Redo2, RotateCcw, Shuffle, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useServices } from '../../app/context';
import { mv } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import { formatAverage, formatTime } from '../../core/stats/format';
import { bestSingle, currentAverage, effectiveMs, sessionMean } from '../../core/stats/stats';
import { browserStore } from '../../core/persistence/storage';
import { shapeEvent } from '../../core/shapes/catalog';
import type { ShapeEventId } from '../../core/shapes/catalog';
import { generateShapeScramble } from '../../core/shapes/scramble';
import { addManualShapeSolve, applyShapeSolution, deleteShapeSolve, deriveShapeSolution, isShapeSolved, redoShapeSession, resetShapeSession, scrambleShapeSession, setShapePenalty, turnShapeSession, undoShapeSession } from '../../core/shapes/session';
import type { ShapeSession, ShapeSolution } from '../../core/shapes/session';
import { loadShapeHistory, saveShapeHistory } from '../../core/shapes/storage';
import { exportShapeHistory, importShapeHistory, mergeShapeHistory } from '../../core/shapes/transfer';
import { loadShapeCurrent, saveShapeCurrent } from '../../core/shapes/current';
import { exportPracticeCsv } from '../../core/stats/csv';
import { Button, IconButton, Spinner } from '../ui/primitives';
import { parseManualTime } from '../../core/nxn/manualTime';
import type { Penalty } from '../../core/timing/timerMachine';

export function ShapeStudio({ eventId }: { readonly eventId: ShapeEventId }) {
  const event = shapeEvent(eventId)!;
  const { studio } = useServices();
  const storage = useMemo(() => browserStore(), []);
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<TwistyPlayer | null>(null);
  const request = useRef(0);
  const [session, setSession] = useState<ShapeSession | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deletePending, setDeletePending] = useState<string | null>(null);
  const [solution, setSolution] = useState<ShapeSolution | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState('');
  const [manualPenalty, setManualPenalty] = useState<Penalty>('none');
  const solves = session?.solves;

  useEffect(() => {
    let cancelled = false;
    const requestRef = request;
    const mount = async () => {
      try {
        const kpuzzle = await puzzles[event.puzzle]!.kpuzzle();
        if (cancelled || !stage.current) return;
        const view = new TwistyPlayer({
          puzzle: event.puzzle,
          visualization: '3D',
          background: 'none',
          controlPanel: 'none',
          viewerLink: 'none',
          hintFacelets: 'none',
          experimentalMovePressInput: 'none',
          experimentalFaceletScale: 0.94,
          ...(eventId === 'pyram' ? { cameraLatitude: 27, cameraLongitude: 30 } : {}),
        });
        view.setAttribute('aria-label', `${event.label} 3D puzzle`);
        stage.current.append(view);
        player.current = view;
        const restored = loadShapeCurrent(storage, eventId, kpuzzle, loadShapeHistory(storage, eventId, kpuzzle));
        view.experimentalSetupAlg = restored.scramble ?? '';
        view.alg = restored.moves.join(' ');
        view.jumpToEnd({ flash: false });
        setSession(restored);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this puzzle.');
      }
    };
    void mount();
    return () => { cancelled = true; requestRef.current++; player.current?.remove(); player.current = null; };
  }, [eventId, event, storage]);

  useEffect(() => {
    if (solves) saveShapeHistory(storage, eventId, solves);
  }, [solves, storage, eventId]);
  useEffect(() => { if (session) saveShapeCurrent(storage, session); }, [session, storage]);
  useEffect(() => {
    if (session?.phase !== 'running') return;
    const id = window.setInterval(() => setNow(performance.now()), 40);
    return () => window.clearInterval(id);
  }, [session?.phase]);

  const turn = useCallback((move: string, inverse = false) => {
    if (!session || loading) return;
    try {
      setSolution(null);
      const at = performance.now();
      setSession((current) => current ? turnShapeSession(current, move, at, Date.now(), crypto.randomUUID()) : current);
      player.current?.experimentalAddMove(move);
      setNow(at);
      studio.playPracticeTurn(mv(move.charAt(0).toUpperCase() as Face, inverse ? 3 : 1), 175, eventId === 'pyram' ? 1.09 : 1.025);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This turn could not be applied.'); }
  }, [session, loading, studio, eventId]);

  const newScramble = useCallback(async () => {
    if (!session) return;
    const id = ++request.current;
    setLoading(true);
    setSolution(null);
    setError(null);
    try {
      const scramble = await generateShapeScramble(eventId, session.kpuzzle);
      if (request.current !== id) return;
      setSession((current) => current ? scrambleShapeSession(current, scramble) : current);
      if (player.current) {
        player.current.experimentalSetupAlg = scramble;
        player.current.alg = '';
        player.current.jumpToEnd({ flash: false });
      }
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'Scramble failed. Try again.');
    } finally { if (request.current === id) setLoading(false); }
  }, [eventId, session]);

  const reset = () => {
    request.current++;
    setLoading(false);
    setError(null);
    setSolution(null);
    setSession((current) => current ? resetShapeSession(current) : current);
    if (player.current) { player.current.experimentalSetupAlg = ''; player.current.alg = ''; player.current.jumpToEnd({ flash: false }); }
  };

  const undo = useCallback(() => {
    const move = session?.undo.at(-1);
    if (!move) return;
    setSolution(null);
    setSession((current) => current ? undoShapeSession(current) : current);
    player.current?.experimentalRemoveFinalChild();
    studio.playPracticeTurn(mv(move.charAt(0).toUpperCase() as Face, 3), 175, eventId === 'pyram' ? 1.09 : 1.025);
  }, [session, studio, eventId]);

  const redo = useCallback(() => {
    const move = session?.redo.at(-1);
    if (!move) return;
    setSolution(null);
    setSession((current) => current ? redoShapeSession(current, performance.now(), Date.now(), crypto.randomUUID()) : current);
    player.current?.experimentalAddMove(move);
    studio.playPracticeTurn(mv(move.charAt(0).toUpperCase() as Face, move.endsWith("'") || move.endsWith('--') ? 3 : 1), 175, eventId === 'pyram' ? 1.09 : 1.025);
  }, [session, studio, eventId]);

  const copyScramble = async () => {
    if (!session?.scramble) return;
    try {
      await navigator.clipboard.writeText(session.scramble);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { setError('Clipboard unavailable. Select the scramble text to copy it.'); }
  };

  const findSolution = () => {
    if (!session || isShapeSolved(session.pattern)) return;
    try { setSolution(deriveShapeSolution(session)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not find a practice solution.'); }
  };

  const useSolution = () => {
    if (!solution || !session || !player.current) return;
    try {
      const solved = applyShapeSolution(session, solution);
      player.current.alg = solved.moves.join(' ');
      player.current.jumpToEnd({ flash: false });
      setSession(solved);
      setSolution(null);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the practice solution.'); }
  };

  const saveManualTime = (form: React.FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const duration = manualPenalty === 'DNF' && !manualTime.trim() ? 0 : parseManualTime(manualTime);
    if (duration === null) { setError('Enter a time like 12.34 or 1:02.34.'); return; }
    setSession((current) => current ? addManualShapeSolve(current, duration, manualPenalty, Date.now(), crypto.randomUUID()) : current);
    setManualOpen(false);
    setManualTime('');
    setManualPenalty('none');
    setHistoryOpen(true);
    setError(null);
  };

  const exportResults = () => {
    if (!session) return;
    const content = exportShapeHistory(eventId, session.solves);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cubelab-${eventId}-results-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTransferMessage(`Exported ${session.solves.length} ${event.label} results.`);
  };

  const exportCsv = () => {
    if (!session) return;
    const content = exportPracticeCsv(eventId, session.solves);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cubelab-${eventId}-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTransferMessage(`Exported ${session.solves.length} rows as CSV.`);
  };

  const importResults = async (file: File | undefined) => {
    if (!file || !session) return;
    try {
      if (file.size > 1_000_000) throw new Error('That results file is too large.');
      const incoming = importShapeHistory(await file.text(), eventId, session.kpuzzle);
      setSession((current) => current ? { ...current, solves: mergeShapeHistory(current.solves, incoming) } : current);
      setHistoryOpen(true);
      setTransferMessage(`Imported ${incoming.length} ${event.label} results.`);
      setError(null);
    } catch (cause) {
      setTransferMessage(null);
      setError(cause instanceof Error ? cause.message : 'Could not import results.');
    }
  };

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
      const pair = event.turns.find((value) => value.key && value.key === key.key.toLowerCase());
      if (pair) { key.preventDefault(); turn(key.shiftKey ? pair.ccw : pair.cw, key.shiftKey); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event.turns, newScramble, turn, undo, redo]);

  const duration = session?.phase === 'running' && session.startedAt !== null
    ? Math.max(0, now - session.startedAt)
    : session?.phase === 'ready' ? 0 : session?.lastDurationMs ?? null;
  const solved = session ? isShapeSolved(session.pattern) : true;

  return <main className="nxn-layout shape-layout" aria-label={`${event.label} practice studio`}>
    <section className="nxn-readouts" aria-label="Practice readouts">
      <div className="nxn-clock">
        <span className="nxn-label">{session?.phase === 'running' ? 'SOLVING' : session?.phase === 'ready' ? 'READY' : session?.phase === 'solved' ? 'SOLVED' : 'PRACTICE TIMER'}</span>
        <strong className="nxn-clock__time" role="timer">{formatTime(duration)}</strong>
        <span className="nxn-clock__note">{session?.phase === 'ready' ? 'First turn starts the clock' : 'New Scramble prepares a timed attempt'}</span>
      </div>
      <div className="nxn-readout">
        <div className="nxn-readout__head"><h2>Scramble</h2><IconButton label="Copy scramble" size="sm" disabled={!session?.scramble} onClick={() => void copyScramble()}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconButton></div>
        <p className="nxn-scramble">{session?.scramble ?? 'Generate a scramble to begin.'}</p>{error && <p className="nxn-error" role="alert">{error}</p>}
      </div>
      <div className="nxn-readout nxn-records">
        <h2>Session</h2>
        <dl>
          <div><dt>Best single</dt><dd>{formatTime(bestSingle(session?.solves ?? []))}</dd></div>
          <div><dt>Current ao5</dt><dd>{formatAverage(currentAverage(session?.solves ?? [], 5))}</dd></div>
          <div><dt>Session mean</dt><dd>{formatAverage(sessionMean(session?.solves ?? []))}</dd></div>
          <div><dt>Solves</dt><dd>{session?.solves.length ?? 0}</dd></div>
          <div><dt>Moves</dt><dd>{session?.moves.length ?? 0}</dd></div>
        </dl>
        <button type="button" className="nxn-history-toggle" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}>{historyOpen ? 'Hide' : 'Show'} recent solves</button>
        <button type="button" className="nxn-history-toggle nxn-add-time" onClick={() => setManualOpen((value) => !value)} aria-expanded={manualOpen}>{manualOpen ? 'Cancel entry' : 'Add physical solve'}</button>
        {manualOpen && <form className="nxn-manual-form" onSubmit={saveManualTime}>
          <label>Time <input type="text" inputMode="decimal" placeholder="12.34" value={manualTime} onChange={(change) => setManualTime(change.target.value)} /></label>
          <label>Penalty <select value={manualPenalty} onChange={(change) => setManualPenalty(change.target.value as Penalty)}><option value="none">None</option><option value="+2">+2</option><option value="DNF">DNF</option></select></label>
          <button type="submit">Save result</button>
        </form>}
        {historyOpen && <ol className="nxn-history">{session?.solves.slice(-8).reverse().map((solve) => <li key={solve.id}>
          <span>{new Date(solve.at).toLocaleDateString()}</span><strong>{formatTime(effectiveMs(solve))}</strong><small>{solve.source === 'manual' ? 'physical' : `${solve.moves} moves`}</small>
          <select aria-label={`Penalty for solve ${solve.id}`} value={solve.penalty} onChange={(change) => setSession((current) => current ? setShapePenalty(current, solve.id, change.target.value as Penalty) : current)}>
            <option value="none">OK</option><option value="+2">+2</option><option value="DNF">DNF</option>
          </select>
          {deletePending === solve.id ? <span className="nxn-history__confirm">
            <button type="button" onClick={() => { setSession((current) => current ? deleteShapeSolve(current, solve.id) : current); setDeletePending(null); }}>Delete</button>
            <button type="button" onClick={() => setDeletePending(null)}>Cancel</button>
          </span> : <button type="button" className="nxn-history__delete" aria-label={`Remove solve ${solve.id}`} title="Remove solve" onClick={() => setDeletePending(solve.id)}><Trash2 size={13} /></button>}
        </li>)}</ol>}
        <div className="nxn-transfer">
          <button type="button" disabled={!session} onClick={exportResults}>Export results</button>
          <button type="button" disabled={!session} onClick={exportCsv}>Export CSV</button>
          <label>Import results<input type="file" accept=".json,application/json" aria-label="Import results file" onChange={(change) => { void importResults(change.target.files?.[0]); change.target.value = ''; }} /></label>
        </div>
        {transferMessage && <p className="nxn-transfer__message" role="status">{transferMessage}</p>}
      </div>
    </section>
    <section className="nxn-stage shape-stage" aria-label={`${event.label} interactive puzzle`}>
      <div ref={stage} className="shape-player" />
      {!session && <p className="shape-loading" role="status">Preparing {event.label}…</p>}
      <p className="nxn-stage__hint">Drag the background to orbit · Use the buttons to turn</p>
    </section>
    <section className="nxn-controls" aria-label="Puzzle controls">
      <div className="nxn-controls__actions">
        <Button variant="primary" size="lg" icon={loading ? <Spinner /> : <Shuffle size={17} />} busy={loading} disabled={!session} onClick={() => void newScramble()}>{loading ? 'Generating…' : 'New Scramble'}</Button>
        <div className="nxn-controls__row">
          <Button variant="ghost" size="lg" icon={<RotateCcw size={16} />} disabled={!session} onClick={reset}>Reset</Button>
          <IconButton label="Undo" disabled={!session?.undo.length || loading} onClick={undo}><Undo2 size={17} /></IconButton>
          <IconButton label="Redo" disabled={!session?.redo.length || loading} onClick={redo}><Redo2 size={17} /></IconButton>
        </div>
        <Button variant="accent" size="lg" icon={<Sparkles size={16} />} disabled={!session || solved || loading} onClick={findSolution}>Find Solution</Button>
        {solution && <div className="nxn-solution"><p>{solution.text}</p><Button variant="ghost" size="sm" onClick={useSolution}>Apply solution</Button></div>}
      </div>
      <div className="nxn-turns">
        <h2>Turn puzzle</h2>
        <div className="shape-turn-grid">{event.turns.map((pair) => <div className="nxn-move-pair" key={pair.cw}>
          <button type="button" title={`Turn ${pair.label} clockwise`} disabled={!session || loading} onClick={() => turn(pair.cw)}>{pair.cw}</button>
          <button type="button" title={`Turn ${pair.label} counter-clockwise`} disabled={!session || loading} onClick={() => turn(pair.ccw, true)}>{pair.ccw}</button>
        </div>)}</div>
        <p className="nxn-controls__tip">Keyboard: {event.turns.filter((pair) => pair.key).map((pair) => pair.label).join(' ')} · Shift for inverse · N for scramble · Ctrl+Z to undo</p>
      </div>
      <p className="nxn-solved-indicator" aria-live="polite">{solved ? 'Puzzle solved' : `${event.label} in progress`}</p>
    </section>
  </main>;
}
