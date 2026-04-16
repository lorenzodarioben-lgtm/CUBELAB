import { describe, expect, it } from 'vitest';
import {
  HOLD_TO_ARM_MS,
  createTimerState,
  elapsedMs,
  inspectionPenalty,
  timerTransition,
  turnPolicy,
} from '../../src/core/timing/timerMachine';
import type { CompletedAttempt, TimerEvent, TimerState } from '../../src/core/timing/timerMachine';

function play(state: TimerState, events: TimerEvent[]): { state: TimerState; completed: CompletedAttempt[] } {
  const completed: CompletedAttempt[] = [];
  let s = state;
  for (const e of events) {
    const out = timerTransition(s, e);
    s = out.state;
    if (out.completed) completed.push(out.completed);
  }
  return { state: s, completed };
}

const turn = (at: number, solved = false, quarterTurns = 1): TimerEvent => ({ type: 'manualTurn', at, quarterTurns, solved });
const scrambled = (): TimerEvent[] => [{ type: 'scrambleStarted' }, { type: 'scrambleApplied', scramble: "R U F'" }];

describe('casual mode', () => {
  it('starts on the first manual turn and stops on the solving turn', () => {
    const { state, completed } = play(createTimerState('casual'), [...scrambled(), turn(1000), turn(1500, false, 2), turn(4321.5, true)]);
    expect(state.phase).toBe('solved');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.durationMs).toBe(3321.5);
    expect(completed[0]!.turnsHTM).toBe(3);
    expect(completed[0]!.turnsQTM).toBe(4);
    expect(completed[0]!.assisted).toBe(false);
    expect(completed[0]!.scramble).toBe("R U F'");
  });

  it('does not start without a scramble (free play) and never records', () => {
    const { state, completed } = play(createTimerState('casual'), [turn(10), turn(20, true)]);
    expect(state.phase).toBe('idle');
    expect(completed).toHaveLength(0);
  });

  it('scramble playback blocks turns and does not start the clock', () => {
    const s = timerTransition(createTimerState('casual'), { type: 'scrambleStarted' }).state;
    expect(s.phase).toBe('scrambling');
    expect(turnPolicy(s).allowed).toBe(false);
    expect(s.startedAt).toBeNull();
  });

  it('auto solve during an attempt ends it unrecorded', () => {
    const { state, completed } = play(createTimerState('casual'), [...scrambled(), turn(100), { type: 'assist', kind: 'solver' }]);
    expect(state.phase).toBe('assisted');
    expect(completed).toHaveLength(0);
  });

  it('auto solve on a fresh scramble never produces a time', () => {
    const { state, completed } = play(createTimerState('casual'), [...scrambled(), { type: 'assist', kind: 'solver' }]);
    expect(state.phase).toBe('assisted');
    expect(completed).toHaveLength(0);
  });

  it('undo during an attempt marks the result assisted', () => {
    const { completed } = play(createTimerState('casual'), [
      ...scrambled(),
      turn(100),
      { type: 'assist', kind: 'undo' },
      turn(200),
      turn(900, true),
    ]);
    expect(completed[0]!.assisted).toBe(true);
  });

  it('discard / reset drops an attempt', () => {
    const { state, completed } = play(createTimerState('casual'), [...scrambled(), turn(100), { type: 'discard' }]);
    expect(state.phase).toBe('idle');
    expect(completed).toHaveLength(0);
  });

  it('elapsed time is computed from timestamps, independent of frame count', () => {
    const s = play(createTimerState('casual'), [...scrambled(), turn(1000)]).state;
    expect(elapsedMs(s, 1000)).toBe(0);
    expect(elapsedMs(s, 61_234.56)).toBeCloseTo(60_234.56, 6);
  });

  it('turning after a finished solve returns to free play', () => {
    const { state } = play(createTimerState('casual'), [...scrambled(), turn(1), turn(2, true), turn(3)]);
    expect(state.phase).toBe('idle');
    expect(state.last).not.toBeNull();
  });
});

describe('spacebar mode', () => {
  const base = () => play(createTimerState('spacebar', false), scrambled()).state;

  it('blocks turning until the clock runs', () => {
    expect(turnPolicy(base()).allowed).toBe(false);
  });

  it('a short tap does not arm; a hold of 300 ms arms and release starts', () => {
    let s = base();
    s = play(s, [{ type: 'spaceDown', at: 0 }, { type: 'spaceUp', at: HOLD_TO_ARM_MS - 1 }]).state;
    expect(s.phase).toBe('ready');
    s = play(s, [{ type: 'spaceDown', at: 1000 }, { type: 'spaceUp', at: 1000 + HOLD_TO_ARM_MS }]).state;
    expect(s.phase).toBe('running');
    expect(s.startedAt).toBe(1300);
    expect(turnPolicy(s).allowed).toBe(true);
  });

  it('ignores key-repeat spaceDown events while arming', () => {
    const s = play(base(), [
      { type: 'spaceDown', at: 0 },
      { type: 'spaceDown', at: 50 },
      { type: 'spaceDown', at: 100 },
      { type: 'spaceUp', at: 400 },
    ]).state;
    expect(s.phase).toBe('running');
    expect(s.startedAt).toBe(400);
  });

  it('stops only on a genuine solve; Space while running is a DNF, never a PB', () => {
    const { state, completed } = play(base(), [
      { type: 'spaceDown', at: 0 },
      { type: 'spaceUp', at: 400 },
      { type: 'spaceDown', at: 450 },
    ]);
    expect(state.phase).toBe('interrupted');
    expect(completed[0]!.penalty).toBe('DNF');
    expect(completed[0]!.note).toBe('stopped-early');
  });

  it('records the solve on the solving turn', () => {
    const { completed } = play(base(), [{ type: 'spaceDown', at: 0 }, { type: 'spaceUp', at: 500 }, turn(800), turn(5500, true)]);
    expect(completed[0]!.durationMs).toBe(5000);
    expect(completed[0]!.penalty).toBe('none');
  });

  describe('inspection', () => {
    const inspecting = () => play(createTimerState('spacebar', true), [...scrambled(), { type: 'spaceDown', at: 0 }, { type: 'spaceUp', at: 50 }]).state;

    it('starts inspection on the first press and swallows its release', () => {
      const s = inspecting();
      expect(s.phase).toBe('inspecting');
      expect(s.inspectionStartedAt).toBe(0);
    });

    it.each([
      [14_999, 'none'],
      [15_000, '+2'],
      [16_999, '+2'],
    ] as const)('starting at %i ms of inspection gives penalty %s', (releaseAt, penalty) => {
      const s = play(inspecting(), [
        { type: 'spaceDown', at: releaseAt - 400 },
        { type: 'spaceUp', at: releaseAt },
      ]).state;
      expect(s.phase).toBe('running');
      expect(s.penalty).toBe(penalty);
    });

    it('17 s of inspection is a DNF (tick)', () => {
      const { state, completed } = play(inspecting(), [{ type: 'tick', at: 16_999 }, { type: 'tick', at: 17_000 }]);
      expect(state.phase).toBe('interrupted');
      expect(completed[0]!.penalty).toBe('DNF');
      expect(completed[0]!.note).toBe('inspection-timeout');
    });

    it('17 s reached while holding Space is also a DNF on release', () => {
      const { completed } = play(inspecting(), [{ type: 'spaceDown', at: 16_500 }, { type: 'spaceUp', at: 17_000 }]);
      expect(completed[0]!.penalty).toBe('DNF');
    });

    it('+2 penalty is carried into the completed attempt', () => {
      const { completed } = play(inspecting(), [{ type: 'spaceDown', at: 15_000 }, { type: 'spaceUp', at: 15_500 }, turn(16_000), turn(20_500, true)]);
      expect(completed[0]!.penalty).toBe('+2');
      expect(completed[0]!.durationMs).toBe(5000);
      expect(completed[0]!.inspectionMs).toBe(15_500);
    });
  });

  it('inspection thresholds are strict at 15 s and 17 s', () => {
    expect(inspectionPenalty(14_999.9)).toBe('none');
    expect(inspectionPenalty(15_000)).toBe('+2');
    expect(inspectionPenalty(16_999.9)).toBe('+2');
    expect(inspectionPenalty(17_000)).toBe('DNF');
  });

  it('space does nothing in casual mode', () => {
    const s = play(createTimerState('casual'), [...scrambled(), { type: 'spaceDown', at: 0 }, { type: 'spaceUp', at: 900 }]).state;
    expect(s.phase).toBe('ready');
  });
});

describe('configuration', () => {
  it('changing mode mid-attempt restarts it without recording', () => {
    const { state, completed } = play(createTimerState('casual'), [...scrambled(), turn(1), { type: 'configure', mode: 'spacebar', inspection: false }]);
    expect(state.mode).toBe('spacebar');
    expect(state.phase).toBe('idle');
    expect(completed).toHaveLength(0);
  });
});
