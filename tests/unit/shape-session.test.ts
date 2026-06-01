import { describe, expect, it } from 'vitest';
import { puzzles } from 'cubing/puzzles';
import { applyShapeSolution, createShapeSession, deriveShapeSolution, invertShapeMove, isShapeSolved, redoShapeSession, scrambleShapeSession, turnShapeSession, undoShapeSession } from '../../src/core/shapes/session';
import { generateShapeScramble } from '../../src/core/shapes/scramble';

describe.each([['pyram', 'pyraminx', 'U', "U'"], ['skewb', 'skewb', 'R', "R'"], ['minx', 'megaminx', 'R++', 'R--']] as const)('%s puzzle model', (eventId, puzzleId, move, inverse) => {
  it('applies a scramble and times a solved attempt', async () => {
    const kpuzzle = await puzzles[puzzleId]!.kpuzzle();
    let session = scrambleShapeSession(createShapeSession(eventId, kpuzzle), move);
    expect(isShapeSolved(session.pattern)).toBe(false);
    session = turnShapeSession(session, inverse, 100, 200, 'one');
    expect(session.phase).toBe('solved');
    expect(session.solves).toHaveLength(1);
    expect(isShapeSolved(session.pattern)).toBe(true);
  });

  it('checks scramble generation against the real puzzle model', async () => {
    const kpuzzle = await puzzles[puzzleId]!.kpuzzle();
    await expect(generateShapeScramble(eventId, kpuzzle, async () => move)).resolves.toBe(move);
    await expect(generateShapeScramble(eventId, kpuzzle, async () => `${move} ${inverse}`)).rejects.toThrow('valid scramble');
  });

  it('undoes and redoes a turn without keeping a false solved status', async () => {
    const kpuzzle = await puzzles[puzzleId]!.kpuzzle();
    let session = scrambleShapeSession(createShapeSession(eventId, kpuzzle), move);
    session = turnShapeSession(session, inverse, 100, 200, 'one');
    session = undoShapeSession(session);
    expect(session.phase).toBe('idle');
    expect(isShapeSolved(session.pattern)).toBe(false);
    session = redoShapeSession(session, 120, 220, 'two');
    expect(isShapeSolved(session.pattern)).toBe(true);
    expect(session.solves).toHaveLength(1);
    expect(invertShapeMove(move)).toBe(inverse);
  });

  it('verifies a practice solution without recording a timed solve', async () => {
    const kpuzzle = await puzzles[puzzleId]!.kpuzzle();
    const session = scrambleShapeSession(createShapeSession(eventId, kpuzzle), move);
    const answer = deriveShapeSolution(session)!;
    expect(isShapeSolved(session.pattern.applyAlg(answer.text))).toBe(true);
    const solved = applyShapeSolution(session, answer);
    expect(solved.phase).toBe('solved');
    expect(solved.solves).toHaveLength(0);
    expect(solved.assisted).toBe(true);
  });
});

it('marks a solve assisted when undo or redo is used while timing', async () => {
  const kpuzzle = await puzzles.skewb!.kpuzzle();
  let session = scrambleShapeSession(createShapeSession('skewb', kpuzzle), 'R U');
  session = turnShapeSession(session, "U'", 100, 200, 'one');
  session = undoShapeSession(session);
  session = redoShapeSession(session, 120, 220, 'two');
  session = turnShapeSession(session, "R'", 200, 300, 'three');
  expect(session.solves.at(-1)?.assisted).toBe(true);
});
