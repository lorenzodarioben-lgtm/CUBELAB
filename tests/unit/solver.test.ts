/**
 * Proof that Auto Solve solves the *current state*, not a remembered history.
 * These tests use the real cubing.js scrambler and solver — nothing is mocked.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { KPuzzle } from 'cubing/kpuzzle';
import { CubeEngine } from '../../src/core/engine/cubeEngine';
import { agrees, applyMoves, createSolvedState, isSolved, stateFacelets } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { isFaceletStringSolved } from '../../src/core/puzzle/facelets';
import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import { formatAlg, parseAlg } from '../../src/core/puzzle/notation';
import { generateScramble } from '../../src/core/scramble/scrambler';
import { SolverError, solveState } from '../../src/core/solver/solver';
import { fakeClock, randomMoves, seededRandom } from './helpers';

let kpuzzle: KPuzzle;
let solved: CubeState;

beforeAll(async () => {
  kpuzzle = await loadKPuzzle();
  solved = createSolvedState(kpuzzle);
}, 60_000);

function runUntilIdle(engine: CubeEngine, clock: ReturnType<typeof fakeClock>) {
  let guard = 0;
  while (engine.isBusy() && guard++ < 100_000) engine.tick(clock.advance(16));
}

describe('random-state scramble', () => {
  it('generates parseable notation and applying it yields exactly that state', async () => {
    for (let i = 0; i < 3; i++) {
      const scramble = await generateScramble(kpuzzle);
      expect(scramble.moves.length).toBeGreaterThan(10);
      const viaEngine = new CubeEngine(solved);
      viaEngine.applyInstant(scramble.moves, 'scramble');
      const expected = kpuzzle.defaultPattern().applyAlg(scramble.text);
      expect(viaEngine.state.pattern.isIdentical(expected)).toBe(true);
      expect(agrees(viaEngine.state)).toBe(true);
      expect(isSolved(viaEngine.state)).toBe(false);
    }
  });

  it('retries when a source returns something unusable', async () => {
    const answers = ['', "R R'", "R U F'"];
    const scramble = await generateScramble(kpuzzle, async () => answers.shift()!);
    expect(scramble.text).toBe("R U F'");
  });
});

describe('state-based auto solve', () => {
  it('solves scramble + arbitrary manual moves with history discarded (real scrambles)', async () => {
    for (let seed = 1; seed <= 4; seed++) {
      const clock = fakeClock();
      // reset → scramble → manual moves, all through the shared pipeline
      const engine = new CubeEngine(solved, { now: clock.now });
      const scramble = await generateScramble(kpuzzle);
      engine.applyInstant(scramble.moves, 'scramble');
      for (const m of randomMoves(seededRandom(seed), 7 + seed)) engine.enqueue(m, { source: 'manual', durationMs: 90 });
      runUntilIdle(engine, clock);

      // Discard every trace of history: a brand-new engine that only knows the state.
      const amnesiac = new CubeEngine(engine.state, { now: clock.now });
      expect(amnesiac.canUndo()).toBe(false);

      const captured = amnesiac.state;
      const solution = await solveState(captured);
      expect(solution.length).toBeGreaterThan(0);
      amnesiac.enqueueMany(solution, { source: 'solver', durationMs: 100 });
      runUntilIdle(amnesiac, clock);
      expect(isSolved(amnesiac.state)).toBe(true);
      expect(isFaceletStringSolved(stateFacelets(amnesiac.state))).toBe(true);
    }
  });

  it('solves many deterministic seeded states of varied depth', async () => {
    for (let seed = 1000; seed < 1040; seed++) {
      const rand = seededRandom(seed);
      const state = applyMoves(solved, randomMoves(rand, 3 + Math.floor(rand() * 60)));
      const solution = await solveState(state);
      const end = applyMoves(state, solution);
      expect(isSolved(end), `seed ${seed}: ${formatAlg(solution)}`).toBe(true);
      expect(solution.length).toBeLessThanOrEqual(30);
    }
  });

  it('solves states reached through undo/redo and mixed sources', async () => {
    const clock = fakeClock();
    const engine = new CubeEngine(solved, { now: clock.now });
    engine.applyInstant(parseAlg("R U2 F' L D B2"), 'scramble');
    for (const m of parseAlg("U R' F D'")) engine.enqueue(m, { source: 'manual', durationMs: 50 });
    runUntilIdle(engine, clock);
    engine.requestUndo(50);
    engine.requestUndo(50);
    engine.requestRedo(50);
    runUntilIdle(engine, clock);
    const solution = await solveState(engine.state);
    expect(isSolved(applyMoves(engine.state, solution))).toBe(true);
  });

  it('returns an empty solution for a solved cube', async () => {
    expect(await solveState(solved)).toEqual([]);
  });

  it('solves a partially played-back state after a cancelled playback', async () => {
    const state = applyMoves(solved, randomMoves(seededRandom(77), 30));
    const solution = await solveState(state);
    const halfway = applyMoves(state, solution.slice(0, Math.floor(solution.length / 2)));
    const again = await solveState(halfway);
    expect(isSolved(applyMoves(halfway, again))).toBe(true);
  });

  it('exposes typed errors', () => {
    const err = new SolverError('timeout', 'x');
    expect(err.code).toBe('timeout');
    expect(err).toBeInstanceOf(Error);
  });
});
