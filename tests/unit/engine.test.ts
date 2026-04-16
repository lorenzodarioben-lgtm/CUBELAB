import { beforeAll, describe, expect, it } from 'vitest';
import { CubeEngine } from '../../src/core/engine/cubeEngine';
import type { CommitEvent, EngineEvent } from '../../src/core/engine/cubeEngine';
import { agrees, applyMoves, isSolved, sameLogicalState, stateFacelets } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { SOLVED_FACELETS } from '../../src/core/puzzle/facelets';
import { formatAlg, mv, parseAlg } from '../../src/core/puzzle/notation';
import { fakeClock, randomMoves, seededRandom, solvedState } from './helpers';

let solved: CubeState;
beforeAll(async () => {
  solved = await solvedState();
});

function setup(initial: CubeState = solved) {
  const clock = fakeClock();
  const engine = new CubeEngine(initial, { now: clock.now });
  const events: EngineEvent[] = [];
  engine.subscribe((e) => events.push(e));
  const commits = () => events.filter((e): e is CommitEvent => e.type === 'commit');
  /** Advances the fake clock in frame-sized steps until the engine is idle. */
  const run = (frame = 16, limit = 100_000) => {
    let guard = 0;
    while (engine.isBusy() && guard++ < limit) engine.tick(clock.advance(frame));
  };
  return { clock, engine, events, commits, run };
}

describe('turn queue', () => {
  it('commits a turn exactly once, at the end of its animation', () => {
    const { engine, clock, commits } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 100 });
    expect(engine.version).toBe(0);
    engine.tick(clock.advance(50));
    // Mid-animation: logical state untouched, visual layer half way.
    expect(engine.version).toBe(0);
    expect(stateFacelets(engine.state)).toBe(SOLVED_FACELETS);
    const visual = engine.getVisualTurn();
    expect(visual?.axis).toBe(0);
    expect(visual?.cubies).toHaveLength(9);
    expect(Math.abs(visual!.angle)).toBeGreaterThan(0);
    expect(Math.abs(visual!.angle)).toBeLessThan(Math.PI / 2);
    engine.tick(clock.advance(50));
    expect(engine.version).toBe(1);
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.at).toBe(1100); // exact animation end, not frame time
    for (let i = 0; i < 20; i++) engine.tick(clock.advance(16));
    expect(commits()).toHaveLength(1);
    expect(engine.getVisualTurn()).toBeNull();
  });

  it('serialises rapid input: each queued op commits once, in order', () => {
    const { engine, commits, run } = setup();
    const moves = parseAlg("R U R' U' F2 B");
    for (const m of moves) engine.enqueue(m, { source: 'manual', durationMs: 120 });
    run();
    expect(formatAlg(commits().map((c) => c.move))).toBe("R U R' U' F2 B");
    expect(sameLogicalState(engine.state, applyMoves(solved, moves))).toBe(true);
    expect(agrees(engine.state)).toBe(true);
  });

  it('R followed by R′ restores the state, visually and logically', () => {
    const { engine, run } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 100 });
    engine.enqueue(mv('R', 3), { source: 'manual', durationMs: 100 });
    run();
    expect(stateFacelets(engine.state)).toBe(SOLVED_FACELETS);
    expect(isSolved(engine.state)).toBe(true);
  });

  it('caps the user backlog so held keys cannot build an endless queue', () => {
    const clock = fakeClock();
    const engine = new CubeEngine(solved, { now: clock.now, maxPendingUserTurns: 3 });
    const accepted = [1, 2, 3, 4, 5].map(() => engine.enqueue(mv('U', 1), { source: 'manual', durationMs: 100 }));
    expect(accepted).toEqual([true, true, true, false, false]);
  });

  it('instant and animated routes reach the identical state', () => {
    const moves = randomMoves(seededRandom(42), 60);
    const a = setup();
    a.engine.enqueueMany(moves, { source: 'scramble', durationMs: 70 });
    a.run();
    const b = setup();
    b.engine.applyInstant(moves, 'scramble');
    expect(sameLogicalState(a.engine.state, b.engine.state)).toBe(true);
    expect(stateFacelets(a.engine.state)).toBe(stateFacelets(b.engine.state));
    expect(a.commits()).toHaveLength(60);
    expect(b.commits()).toHaveLength(60);
  });

  it('fastForward completes the in-flight and queued turns in order', () => {
    const { engine, clock, commits } = setup();
    engine.enqueueMany(parseAlg('R U F'), { source: 'scramble', durationMs: 200 });
    engine.tick(clock.advance(50));
    engine.fastForward();
    expect(engine.isBusy()).toBe(false);
    expect(formatAlg(commits().map((c) => c.move))).toBe('R U F');
  });

  it('replaceState abandons the in-flight turn uncommitted and cancels the queue', () => {
    const { engine, clock, commits, events } = setup();
    engine.enqueueMany(parseAlg('R U F D'), { source: 'solver', durationMs: 200 });
    engine.tick(clock.advance(100));
    const scrambled = applyMoves(solved, parseAlg('L B'));
    engine.replaceState(scrambled, 'test');
    for (let i = 0; i < 50; i++) engine.tick(clock.advance(16));
    expect(commits()).toHaveLength(0);
    expect(engine.state).toBe(scrambled);
    expect(engine.version).toBe(1);
    expect(events.some((e) => e.type === 'replace')).toBe(true);
    expect(engine.isBusy()).toBe(false);
  });

  it('cancelPending drops only the matching queued sources', () => {
    const { engine, run, commits } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 50 });
    engine.enqueueMany(parseAlg('U U U'), { source: 'solver', durationMs: 50 });
    engine.cancelPending((s) => s === 'solver');
    run();
    expect(commits().map((c) => c.source)).toEqual(['manual']);
  });

  it('whenIdle resolves after the last commit', async () => {
    const { engine, clock } = setup();
    engine.enqueueMany(parseAlg('R U'), { source: 'manual', durationMs: 100 });
    let idle = false;
    const p = engine.whenIdle().then(() => {
      idle = true;
    });
    engine.tick(clock.advance(100));
    await Promise.resolve();
    expect(idle).toBe(false);
    for (let i = 0; i < 20; i++) engine.tick(clock.advance(16));
    await p;
    expect(idle).toBe(true);
  });

  it('does not double-commit when ticks arrive late or repeatedly', () => {
    const { engine, clock, commits } = setup();
    engine.enqueue(mv('F', 1), { source: 'manual', durationMs: 100 });
    engine.tick(clock.advance(5000));
    engine.tick(clock.advance(0));
    engine.tick(clock.advance(1));
    expect(commits()).toHaveLength(1);
  });
});

describe('undo / redo', () => {
  it('undo and redo walk the manual history and restore prior states', () => {
    const { engine, run } = setup();
    const moves = parseAlg("R U F' D2");
    for (const m of moves) engine.enqueue(m, { source: 'manual', durationMs: 50 });
    run();
    const after = engine.state;
    expect(engine.canUndo()).toBe(true);
    for (let i = 0; i < 4; i++) engine.requestUndo(50);
    run();
    expect(stateFacelets(engine.state)).toBe(SOLVED_FACELETS);
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(true);
    for (let i = 0; i < 4; i++) engine.requestRedo(50);
    run();
    expect(sameLogicalState(engine.state, after)).toBe(true);
    expect(engine.canRedo()).toBe(false);
  });

  it('a new move after undo invalidates the redo branch', () => {
    const { engine, run } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 50 });
    engine.enqueue(mv('U', 1), { source: 'manual', durationMs: 50 });
    run();
    engine.requestUndo(50);
    run();
    expect(engine.canRedo()).toBe(true);
    engine.enqueue(mv('F', 1), { source: 'manual', durationMs: 50 });
    run();
    expect(engine.canRedo()).toBe(false);
    expect(engine.requestRedo(50)).toBe(false);
    expect(sameLogicalState(engine.state, applyMoves(solved, parseAlg('R F')))).toBe(true);
  });

  it('projects queued undos so rapid presses never over-undo', () => {
    const { engine, run } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 50 });
    run();
    expect(engine.requestUndo(100)).toBe(true);
    expect(engine.canUndo()).toBe(false);
    expect(engine.requestUndo(100)).toBe(false);
    run();
    expect(isSolved(engine.state)).toBe(true);
  });

  it('scramble and solver commits clear the undo history', () => {
    const { engine, run } = setup();
    engine.enqueue(mv('R', 1), { source: 'manual', durationMs: 50 });
    run();
    engine.applyInstant(parseAlg('U F'), 'scramble');
    expect(engine.canUndo()).toBe(false);
  });
});

describe('drag twists', () => {
  it('previews a layer without committing, then commits on release', () => {
    const { engine, run, commits } = setup();
    expect(engine.beginDrag()).toBe(true);
    engine.updateDrag({ axis: 0, layer: 1, angle: -0.6 });
    expect(engine.getVisualTurn()?.cubies).toHaveLength(9);
    expect(engine.version).toBe(0);
    engine.endDrag({ move: mv('R', 1), fromAngle: -0.6, targetAngle: -Math.PI / 2, quarterDurationMs: 150 });
    run();
    expect(commits()).toHaveLength(1);
    expect(commits()[0]!.move).toEqual(mv('R', 1));
    expect(commits()[0]!.source).toBe('manual');
  });

  it('settles back without committing when released below the threshold', () => {
    const { engine, run, commits } = setup();
    engine.beginDrag();
    engine.updateDrag({ axis: 1, layer: 1, angle: 0.2 });
    engine.endDrag(null);
    expect(engine.getVisualTurn()).not.toBeNull();
    run();
    expect(commits()).toHaveLength(0);
    expect(engine.getVisualTurn()).toBeNull();
    expect(engine.isBusy()).toBe(false);
  });

  it('refuses to start a drag while solver or scramble playback is pending', () => {
    const { engine } = setup();
    engine.enqueueMany(parseAlg('R U'), { source: 'solver', durationMs: 200 });
    expect(engine.beginDrag()).toBe(false);
  });

  it('holds keyboard turns queued during a drag until it ends', () => {
    const { engine, run, commits } = setup();
    engine.beginDrag();
    engine.enqueue(mv('U', 1), { source: 'manual', durationMs: 50 });
    expect(commits()).toHaveLength(0);
    engine.endDrag({ move: mv('R', 1), fromAngle: -1, targetAngle: -Math.PI / 2, quarterDurationMs: 100 });
    run();
    expect(formatAlg(commits().map((c) => c.move))).toBe('R U');
  });
});
