import { describe, expect, it } from 'vitest';
import { isNxSolved } from '../../src/core/nxn/model';
import { parseNxAlg } from '../../src/core/nxn/notation';
import { applyNxSolution, bestNxSingle, createNxSession, redoNxSession, scrambleNxSession, turnNxSession, undoNxSession } from '../../src/core/nxn/session';

describe('NxN practice session', () => {
  it('starts on the first move and records a completed solve', () => {
    const scramble = { text: 'R', moves: parseNxAlg('R', 2) };
    let session = scrambleNxSession(createNxSession(2), scramble);
    expect(session.phase).toBe('ready');
    session = turnNxSession(session, parseNxAlg("R'", 2)[0]!, 1000, 42, 'a');
    expect(session.phase).toBe('solved');
    expect(isNxSolved(session.cube)).toBe(true);
    expect(session.solves[0]).toMatchObject({ id: 'a', durationMs: 0, scramble: 'R', assisted: false });
  });

  it('keeps undo and redo solves out of clean records', () => {
    let session = scrambleNxSession(createNxSession(2), { text: 'R U', moves: parseNxAlg('R U', 2) });
    session = turnNxSession(session, parseNxAlg("U'", 2)[0]!, 100, 1, 'a');
    session = undoNxSession(session, 110);
    session = redoNxSession(session, 120, 1, 'b');
    session = turnNxSession(session, parseNxAlg("R'", 2)[0]!, 210, 1, 'c');
    expect(session.phase).toBe('solved');
    expect(session.solves.at(-1)?.assisted).toBe(true);
    expect(bestNxSingle(session.solves)).toBeNull();
  });

  it('auto solution solves without adding a timed record', () => {
    const session = scrambleNxSession(createNxSession(2), { text: 'R U', moves: parseNxAlg('R U', 2) });
    const solved = applyNxSolution(session, parseNxAlg("U' R'", 2));
    expect(isNxSolved(solved.cube)).toBe(true);
    expect(solved.phase).toBe('solved');
    expect(solved.solves).toHaveLength(0);
    expect(solved.assisted).toBe(true);
  });

  it('leaves solved status when a solved cube is turned again', () => {
    const move = parseNxAlg('R', 2)[0]!;
    let session = scrambleNxSession(createNxSession(2), { text: 'R', moves: parseNxAlg('R', 2) });
    session = turnNxSession(session, parseNxAlg("R'", 2)[0]!, 200, 2, 'b');
    expect(session.phase).toBe('solved');
    session = turnNxSession(session, move, 300, 3, 'c');
    expect(session.phase).toBe('idle');
    expect(isNxSolved(session.cube)).toBe(false);
    session = undoNxSession(session, 400);
    expect(session.phase).toBe('idle');
    expect(isNxSolved(session.cube)).toBe(true);
  });

  it('leaves solved status after undoing a completed attempt', () => {
    let session = scrambleNxSession(createNxSession(2), { text: 'R', moves: parseNxAlg('R', 2) });
    session = turnNxSession(session, parseNxAlg("R'", 2)[0]!, 100, 2, 'a');
    expect(session.phase).toBe('solved');
    session = undoNxSession(session, 120);
    expect(session.phase).toBe('idle');
    expect(isNxSolved(session.cube)).toBe(false);
  });
});
