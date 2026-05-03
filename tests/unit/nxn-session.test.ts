import { describe, expect, it } from 'vitest';
import { isNxSolved } from '../../src/core/nxn/model';
import { parseNxAlg } from '../../src/core/nxn/notation';
import { bestNxSingle, createNxSession, redoNxSession, scrambleNxSession, turnNxSession, undoNxSession } from '../../src/core/nxn/session';

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
});
