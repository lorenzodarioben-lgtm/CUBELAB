import { describe, expect, it } from 'vitest';
import { puzzles } from 'cubing/puzzles';
import { createShapeSession, isShapeSolved, scrambleShapeSession, turnShapeSession } from '../../src/core/shapes/session';
import { generateShapeScramble } from '../../src/core/shapes/scramble';

describe.each([['pyram', 'pyraminx', 'U', "U'"], ['skewb', 'skewb', 'R', "R'"]] as const)('%s puzzle model', (eventId, puzzleId, move, inverse) => {
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
});
