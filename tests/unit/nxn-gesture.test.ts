import { describe, expect, it } from 'vitest';
import { moveForNxDrag } from '../../src/core/nxn/gesture';

describe('NxN face drags', () => {
  it('turns the top layer when dragging its front sticker left', () => {
    expect(moveForNxDrag(3, [2, 2, 2], [0, 0, 1], [-1, 0, 0], 0.2))
      .toEqual({ face: 'U', width: 1, turns: 1 });
  });

  it('selects a real wide turn when dragging an inner row', () => {
    expect(moveForNxDrag(4, [3, 1, 3], [0, 0, 1], [-1, 0, 0], 0.2))
      .toEqual({ face: 'U', width: 2, turns: 1 });
  });

  it('respects direction and the face on the negative side', () => {
    expect(moveForNxDrag(4, [-3, -3, 3], [0, 0, 1], [1, 0, 0], 0.2))
      .toEqual({ face: 'D', width: 1, turns: 1 });
  });

  it('waits for an intentional movement', () => {
    expect(moveForNxDrag(2, [1, 1, 1], [0, 0, 1], [0.02, 0, 0], 0.2)).toBeNull();
  });
});
