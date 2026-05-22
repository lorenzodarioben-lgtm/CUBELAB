import { randomScrambleForEvent } from 'cubing/scramble';
import type { KPuzzle } from 'cubing/kpuzzle';
import type { ShapeEventId } from './catalog';
import { isShapeSolved } from './session';

export type ShapeScrambleSource = (eventId: ShapeEventId) => Promise<string>;
const defaultSource: ShapeScrambleSource = async (eventId) => (await randomScrambleForEvent(eventId)).toString();

export async function generateShapeScramble(eventId: ShapeEventId, kpuzzle: KPuzzle, source: ShapeScrambleSource = defaultSource): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = (await source(eventId)).trim();
    if (text && !isShapeSolved(kpuzzle.defaultPattern().applyAlg(text))) return text;
  }
  throw new Error('Could not generate a valid scramble. Try again.');
}
