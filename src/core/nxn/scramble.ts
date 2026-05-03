import { cubeEvent } from './catalog';
import type { CubeEventId } from './catalog';
import { applyNxMoves, createNxState, isNxSolved } from './model';
import type { NxMove } from './model';
import { formatNxAlg, parseNxAlg } from './notation';

export interface NxScramble {
  readonly text: string;
  readonly moves: readonly NxMove[];
}

export type NxScrambleSource = (event: CubeEventId) => Promise<string>;

let modulePromise: Promise<typeof import('cubing/scramble')> | null = null;

export const cubingNxScrambleSource: NxScrambleSource = async (event) => {
  modulePromise ??= import('cubing/scramble').catch((error: unknown) => {
    modulePromise = null;
    throw error;
  });
  const { randomScrambleForEvent } = await modulePromise;
  return (await randomScrambleForEvent(event)).toString();
};

/** Generate a practice scramble and verify that our physical model can apply it. */
export async function generateNxScramble(
  eventId: CubeEventId,
  source: NxScrambleSource = cubingNxScrambleSource,
  attempts = 3,
): Promise<NxScramble> {
  const event = cubeEvent(eventId);
  if (!event) throw new Error(`Unknown puzzle event: ${eventId}`);
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const moves = parseNxAlg(await source(eventId), event.size);
      if (moves.length && !isNxSolved(applyNxMoves(createNxState(event.size), moves))) {
        return { moves, text: formatNxAlg(moves) };
      }
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(`Could not generate a valid ${event.shortLabel} practice scramble.`, { cause: failure });
}
