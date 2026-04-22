/**
 * End-to-end product flows at the controller level (no React, no WebGL):
 * scramble → timed manual solve, auto-solve integrity, playback controls,
 * async race protection and persistence.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { KPuzzle } from 'cubing/kpuzzle';
import { Studio } from '../../src/app/studio';
import type { StudioDeps } from '../../src/app/studio';
import { applyMoves, createSolvedState, isSolved } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { isFaceletStringSolved } from '../../src/core/puzzle/facelets';
import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import { formatAlg, invertAlg, mv, parseAlg } from '../../src/core/puzzle/notation';
import type { Move } from '../../src/core/puzzle/notation';
import { createMemoryStore } from '../../src/core/persistence/storage';
import type { KeyValueStore } from '../../src/core/persistence/storage';
import { fakeClock } from './helpers';

let kpuzzle: KPuzzle;
const studios: Studio[] = [];

beforeAll(async () => {
  kpuzzle = await loadKPuzzle();
});

afterEach(() => {
  studios.splice(0).forEach((s) => s.dispose());
});

const SCRAMBLE = "R U F' L2 D B R' U2 F L' D2 B'";

function setup(overrides: Partial<StudioDeps> = {}, storage: KeyValueStore = createMemoryStore()) {
  const clock = fakeClock();
  let ids = 0;
  const studio = new Studio({
    kpuzzle,
    storage,
    now: clock.now,
    wallClock: () => 1_700_000_000_000 + clock.now(),
    scrambleSource: async () => SCRAMBLE,
    newId: () => `id-${++ids}`,
    persistDelayMs: 0,
    ...overrides,
  });
  studios.push(studio);
  const run = () => {
    let guard = 0;
    while (studio.engine.isBusy() && guard++ < 100_000) studio.engine.tick(clock.advance(16));
  };
  /** Lets pending promise continuations run, ticking the engine between them. */
  const settle = async (rounds = 30) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise((r) => setTimeout(r, 0));
      run();
    }
  };
  /** Turns one move at a time like a person would (the engine caps queued user turns). */
  const turnAll = (moves: readonly Move[]) => {
    for (const m of moves) {
      expect(studio.turn(m)).toBe(true);
      run();
    }
  };
  /** Advances a bounded number of frames (lets playback progress part-way). */
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) studio.engine.tick(clock.advance(16));
  };
  return { studio, clock, run, settle, storage, turnAll, frames };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('scramble → timed manual solve', () => {
  it('applies the displayed scramble, starts on the first turn and records the solve', async () => {
    const { studio, run, settle, clock, turnAll } = setup();
    await studio.newScramble();
    await settle();
    const s = studio.state;
    expect(s.scramble.status).toBe('applied');
    expect(s.scramble.text).toBe(SCRAMBLE);
    expect(s.timer.phase).toBe('ready');
    expect(studio.engine.state.pattern.isIdentical(kpuzzle.defaultPattern().applyAlg(SCRAMBLE))).toBe(true);
    expect(s.timer.startedAt).toBeNull();

    // Solve by hand with the inverse (a legal sequence of manual turns).
    const solution = invertAlg(parseAlg(SCRAMBLE));
    studio.turn(solution[0]!);
    run();
    expect(studio.state.timer.phase).toBe('running');
    clock.advance(2000);
    turnAll(solution.slice(1));
    const after = studio.state;
    expect(after.solved).toBe(true);
    expect(after.timer.phase).toBe('solved');
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.assisted).toBe(false);
    expect(after.history[0]!.turnsHTM).toBe(solution.length);
    expect(after.history[0]!.durationMs).toBeGreaterThan(2000);
    expect(after.celebration?.kind).toBe('timed');
  });

  it('scramble playback never starts the clock or counts turns', async () => {
    const { studio, settle } = setup();
    await studio.newScramble();
    await settle();
    expect(studio.state.timer.turnsHTM).toBe(0);
    expect(studio.state.history).toHaveLength(0);
  });

  it('blocks manual turns while scrambling', async () => {
    const gate = deferred<string>();
    const { studio } = setup({ scrambleSource: () => gate.promise });
    const pending = studio.newScramble();
    expect(studio.turn(mv('R', 1))).toBe(false);
    expect(studio.state.hint?.text).toMatch(/Scrambling/);
    gate.resolve(SCRAMBLE);
    await pending;
  });

  it('drops a scramble result that arrives after a reset', async () => {
    const gate = deferred<string>();
    const { studio, settle } = setup({ scrambleSource: () => gate.promise });
    const pending = studio.newScramble();
    studio.reset({ force: true });
    gate.resolve(SCRAMBLE);
    await pending;
    await settle();
    expect(studio.state.solved).toBe(true);
    expect(studio.state.scramble.status).toBe('idle');
  });

  it('asks for confirmation before discarding a running attempt', async () => {
    const { studio, run, settle } = setup();
    await studio.newScramble();
    await settle();
    studio.turn(mv('U', 1));
    run();
    expect(studio.reset()).toBe('confirm');
    expect(await studio.newScramble()).toBe('confirm');
    expect(studio.reset({ force: true })).toBe('done');
    expect(studio.state.timer.phase).toBe('idle');
    expect(studio.state.history).toHaveLength(0);
  });

  it('undo during an attempt produces an assisted (practice) record', async () => {
    const { studio, run, settle, turnAll } = setup();
    await studio.newScramble();
    await settle();
    studio.turn(mv('U', 1));
    run();
    studio.undo();
    run();
    turnAll(invertAlg(parseAlg(SCRAMBLE)));
    expect(studio.state.history).toHaveLength(1);
    expect(studio.state.history[0]!.assisted).toBe(true);
  });
});

describe('auto solve', () => {
  it('solves scramble + manual moves without creating a competitive time', async () => {
    const { studio, run, settle } = setup();
    await studio.newScramble();
    await settle();
    for (const m of parseAlg("R U' F2 D")) studio.turn(m);
    run();
    expect(studio.state.timer.phase).toBe('running');
    await studio.autoSolve();
    await settle();
    run();
    expect(studio.state.solver.status).toBe('done');
    expect(studio.state.solved).toBe(true);
    expect(isSolved(studio.engine.state)).toBe(true);
    expect(studio.state.timer.phase).toBe('assisted');
    expect(studio.state.history).toHaveLength(0);
  });

  it('pause, step back/forward, replay and stop keep the cube consistent', async () => {
    const { studio, run, settle, frames } = setup({ initialState: applyMoves(createSolvedState(kpuzzle), parseAlg("R U F' L D2 B'")) });
    await studio.autoSolve();
    expect(studio.state.solver.status).toBe('playing');
    frames(50);
    studio.playbackPause();
    run();
    const paused = studio.state.solver;
    expect(paused.status).toBe('paused');
    const cursor = paused.cursor;
    expect(cursor).toBeGreaterThan(0);

    studio.playbackStep(-1);
    run();
    expect(studio.state.solver.cursor).toBe(cursor - 1);
    studio.playbackStep(1);
    run();
    expect(studio.state.solver.cursor).toBe(cursor);

    studio.playbackReplay();
    run();
    expect(studio.state.solver.status).toBe('done');
    expect(studio.state.solved).toBe(true);

    // Step back from the end, then stop: cube stays in a valid, unsolved state.
    studio.playbackStep(-1);
    run();
    studio.playbackStop();
    run();
    expect(studio.state.solver.status).toBe('idle');
    expect(studio.state.solved).toBe(false);
    // Subsequent manual moves and a fresh solve both work.
    studio.turn(mv('F', 1));
    run();
    await studio.autoSolve();
    await settle();
    run();
    expect(studio.state.solved).toBe(true);
  });

  it('never applies a solution computed for a stale state', async () => {
    const gate = deferred<Move[]>();
    const start = applyMoves(createSolvedState(kpuzzle), parseAlg('R U'));
    const { studio, run, settle } = setup({ initialState: start, solve: () => gate.promise });
    const pending = studio.autoSolve();
    await settle(2);
    // While solving, manual turns are refused…
    expect(studio.turn(mv('F', 1))).toBe(false);
    // …but a reset is not, and it must invalidate the request.
    studio.reset({ force: true });
    gate.resolve(parseAlg("U' R'"));
    await pending;
    run();
    expect(studio.state.solver.status).toBe('idle');
    expect(studio.state.solved).toBe(true);
    expect(studio.engine.version).toBe(1);
  });

  it('marks a paused solution stale after a manual turn and blocks turns while playing', async () => {
    const { studio, run, frames } = setup({ initialState: applyMoves(createSolvedState(kpuzzle), parseAlg("R U F' L")) });
    await studio.autoSolve();
    frames(5);
    expect(studio.state.solver.status).toBe('playing');
    expect(studio.turn(mv('D', 1))).toBe(false);
    studio.playbackPause();
    run();
    expect(studio.turn(mv('D', 1))).toBe(true);
    run();
    expect(studio.state.solver.status).toBe('stale');
    studio.playbackPlay();
    run();
    expect(studio.state.solver.status).toBe('stale');
  });

  it('reports solver failures without claiming success', async () => {
    const start: CubeState = applyMoves(createSolvedState(kpuzzle), parseAlg('R'));
    const { studio, settle } = setup({ initialState: start, solve: () => Promise.reject(new Error('boom')) });
    await studio.autoSolve();
    await settle();
    expect(studio.state.solver.status).toBe('error');
    expect(studio.state.solved).toBe(false);
    expect(studio.state.notice?.tone).toBe('error');
  });
});

describe('persistence', () => {
  it('history, settings and the cube survive a reload', async () => {
    const storage = createMemoryStore();
    const first = setup({}, storage);
    await first.studio.newScramble();
    await first.settle();
    first.turnAll(invertAlg(parseAlg(SCRAMBLE)));
    first.studio.updateSettings({ finish: 'matte', sound: false, timerMode: 'spacebar' });
    first.studio.turn(mv('R', 1));
    first.run();
    first.studio.flushPersistence();

    const second = setup({}, storage);
    expect(second.studio.state.history).toHaveLength(1);
    expect(second.studio.state.settings.finish).toBe('matte');
    expect(second.studio.state.timer.mode).toBe('spacebar');
    expect(second.studio.engine.state.pattern.isIdentical(createSolvedState(kpuzzle).pattern.applyAlg('R'))).toBe(true);
  });
});

describe('slices through the whole controller', () => {
  it('slice turns start, count (STM/HTM/QTM) and finish a timed attempt; the log follows undo', async () => {
    const { studio, run, settle, turnAll } = setup({ scrambleSource: async () => "M E' S2 R" });
    await studio.newScramble();
    await settle();
    turnAll(parseAlg("R' S2 E"));
    expect(studio.state.timer.phase).toBe('running');
    expect(formatAlg(studio.state.moveLog)).toBe("R' S2 E");
    studio.undo();
    run();
    expect(formatAlg(studio.state.moveLog)).toBe("R' S2");
    turnAll(parseAlg("E M'"));
    expect(studio.state.solved).toBe(true);
    const record = studio.state.history[0]!;
    expect(record.assisted).toBe(true); // undo was used
    expect(record.turnsSTM).toBe(6); // R', S2, E, the undo turn E', E, M'
    expect(record.turnsHTM).toBe(1 + 2 + 2 + 2 + 2 + 2);
  });

  it('reset abandons an in-flight slice turn without committing it', () => {
    const { studio, frames } = setup();
    studio.turn(mv('M', 1));
    frames(3);
    expect(studio.engine.getVisualTurn()?.cubies).toHaveLength(8);
    expect(studio.reset()).toBe('done');
    frames(40);
    expect(studio.state.solved).toBe(true);
    expect(studio.engine.version).toBe(1);
    expect(studio.state.moveCount).toBe(0);
  });

  it('a cancelled slice drag preview commits nothing; the next drag still works', () => {
    const { studio, run } = setup();
    expect(studio.beginTwist()).toBe(true);
    studio.engine.updateDrag({ axis: 0, layer: 0, angle: 0.3 });
    expect(studio.engine.getVisualTurn()?.cubies).toHaveLength(8);
    studio.engine.endDrag(null);
    run();
    expect(studio.state.solved).toBe(true);
    expect(studio.engine.version).toBe(0);
    expect(studio.beginTwist()).toBe(true);
    studio.engine.updateDrag({ axis: 2, layer: 0, angle: -1.4 });
    studio.engine.endDrag({ move: mv('S', 1), fromAngle: -1.4, targetAngle: -Math.PI / 2, quarterDurationMs: 120 });
    run();
    expect(formatAlg(studio.state.moveLog)).toBe('S');
  });

  it('rapid mixed face/slice input is serialised in order and never double-commits', () => {
    const { studio, run } = setup();
    const moves = parseAlg("M R E' U S2 L'");
    for (const m of moves) expect(studio.turn(m)).toBe(true);
    run();
    expect(formatAlg(studio.state.moveLog)).toBe("M R E' U S2 L'");
    expect(studio.engine.version).toBe(moves.length);
    expect(studio.engine.state.pattern.isIdentical(applyMoves(createSolvedState(kpuzzle), moves).pattern)).toBe(true);
  });

  it('auto-solves a slice-scrambled cube after the history is wiped by a reload', async () => {
    const storage = createMemoryStore();
    const first = setup({}, storage);
    first.turnAll(parseAlg("M E S M' R U"));
    first.studio.flushPersistence();
    const second = setup({}, storage);
    expect(second.studio.engine.canUndo()).toBe(false);
    await second.studio.autoSolve();
    await second.settle();
    second.run();
    expect(second.studio.state.solver.status).toBe('done');
    // Solved in whichever orientation needed fewer turns (centre homing or the current frame).
    expect(second.studio.state.solved).toBe(true);
    expect(isFaceletStringSolved(second.studio.state.facelets)).toBe(true);
  });
});

describe('whole-cube rotations through the controller', () => {
  it('re-grip without starting the clock or counting turns; U then turns the new top', async () => {
    const { studio, run, settle, turnAll } = setup();
    await studio.newScramble();
    await settle();
    turnAll(parseAlg('x2'));
    expect(studio.state.timer.phase).toBe('ready');
    expect(studio.state.moveCount).toBe(0);
    expect(formatAlg(studio.state.moveLog)).toBe('x2');
    expect(studio.state.facelets.slice(4, 5)).not.toBe('U'); // white centre is no longer on top
    turnAll(parseAlg('U'));
    expect(studio.state.timer.phase).toBe('running');
    expect(studio.state.moveCount).toBe(1);
    const expected = applyMoves(createSolvedState(kpuzzle), parseAlg(`${SCRAMBLE} x2 U`));
    expect(studio.engine.state.pattern.isIdentical(expected.pattern)).toBe(true);
    studio.undo();
    run();
    expect(formatAlg(studio.state.moveLog)).toBe('x2');
  });

  it('are allowed during spacebar inspection, while face turns are not', async () => {
    const { studio, settle, run } = setup();
    studio.updateSettings({ timerMode: 'spacebar', inspection: true });
    await studio.newScramble();
    await settle();
    studio.spaceDown(0);
    studio.spaceUp(50);
    expect(studio.state.timer.phase).toBe('inspecting');
    expect(studio.turn(mv('y', 1))).toBe(true);
    run();
    expect(studio.state.timer.phase).toBe('inspecting');
    expect(studio.turn(mv('R', 1))).toBe(false);
  });

  it('auto solve keeps the chosen orientation after x2', async () => {
    const { studio, run, settle, turnAll } = setup();
    turnAll(parseAlg("x2 R U'"));
    await studio.autoSolve();
    await settle();
    run();
    expect(studio.state.solver.status).toBe('done');
    expect(studio.state.solved).toBe(true);
    expect(studio.state.facelets.slice(0, 9)).toBe('DDDDDDDDD'); // yellow stays on top
  });
});

describe('cube style is a visual preference, never a puzzle event', () => {
  /** Everything a style change must leave exactly as it was. */
  function snapshot(studio: Studio) {
    const s = studio.state;
    return {
      version: studio.engine.version,
      pattern: JSON.stringify(studio.engine.state.pattern.patternData),
      facelets: s.facelets,
      solved: s.solved,
      timer: { ...s.timer },
      scramble: s.scramble.text,
      moveLog: formatAlg(s.moveLog),
      moveCount: s.moveCount,
      history: s.history.length,
      canUndo: studio.engine.canUndo(),
      canRedo: studio.engine.canRedo(),
      solver: { status: s.solver.status, cursor: s.solver.cursor, moves: formatAlg(s.solver.moves) },
    };
  }

  it('switching during a running attempt with undo/redo history changes nothing but the setting', async () => {
    const { studio, run, settle, turnAll, clock } = setup();
    await studio.newScramble();
    await settle();
    turnAll(parseAlg("R U M E' x2 F2"));
    studio.undo();
    run();
    expect(studio.state.timer.phase).toBe('running');
    clock.advance(1234);
    const before = snapshot(studio);
    for (let i = 0; i < 25; i++) {
      studio.updateSettings({ cubeStyle: i % 2 === 0 ? 'stickered' : 'stickerless' });
      expect(snapshot(studio)).toEqual(before);
    }
    expect(studio.state.settings.cubeStyle).toBe('stickered');
    // The session carries on: redo, keep turning, auto-solve.
    studio.redo();
    run();
    turnAll(parseAlg("R U'"));
    await studio.autoSolve();
    await settle();
    run();
    expect(studio.state.solver.status).toBe('done');
    expect(studio.state.solved).toBe(true);
  });

  it('switching during spacebar inspection keeps the inspection clock', async () => {
    const { studio, settle } = setup();
    studio.updateSettings({ timerMode: 'spacebar', inspection: true });
    await studio.newScramble();
    await settle();
    studio.spaceDown(0);
    studio.spaceUp(50);
    expect(studio.state.timer.phase).toBe('inspecting');
    const before = snapshot(studio);
    studio.updateSettings({ cubeStyle: 'stickered' });
    expect(snapshot(studio)).toEqual(before);
  });

  it('switching during solver playback lets the solution play out', async () => {
    const { studio, run, frames } = setup({ initialState: applyMoves(createSolvedState(kpuzzle), parseAlg("R U F' L D2 B' M")) });
    await studio.autoSolve();
    expect(studio.state.solver.status).toBe('playing');
    frames(20);
    const before = snapshot(studio);
    studio.updateSettings({ cubeStyle: 'stickered' });
    expect(snapshot(studio)).toEqual(before);
    run();
    expect(studio.state.solver.status).toBe('done');
    expect(studio.state.solved).toBe(true);
  });

  it('never creates a solve record, and the choice survives a reload with history intact', async () => {
    const storage = createMemoryStore();
    const first = setup({}, storage);
    await first.studio.newScramble();
    await first.settle();
    first.turnAll(invertAlg(parseAlg(SCRAMBLE)));
    expect(first.studio.state.history).toHaveLength(1);
    first.studio.updateSettings({ cubeStyle: 'stickered' });
    expect(first.studio.state.history).toHaveLength(1);
    first.studio.flushPersistence();
    const second = setup({}, storage);
    expect(second.studio.state.settings.cubeStyle).toBe('stickered');
    expect(second.studio.state.history).toHaveLength(1);
  });
});
