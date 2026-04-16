/**
 * CubeEngine — the one move pipeline.
 *
 * Every change to the puzzle (pointer twists, keyboard, Move Pad, undo/redo,
 * scramble playback, solver playback) is a queued operation processed here,
 * strictly one at a time. The engine owns the authoritative `CubeState`; the
 * renderer only *reads* `getVisualTurn()` to animate the layer in flight.
 *
 * Atomic commit boundary: a turn changes the logical state exactly once, when
 * its animation completes (or immediately for instant/zero-duration turns).
 * While a turn is in flight the logical state is still the pre-turn state, so
 * the solver, reset or undo can never observe a half-applied move. Aborting an
 * in-flight turn (reset, replaceState) therefore needs no rollback.
 *
 * Time is injected (`now`) and progress is driven by `tick()`, so the whole
 * pipeline runs deterministically under a fake clock in unit tests.
 */
import { applyMove, isSolved } from '../puzzle/cubeState';
import type { CubeState } from '../puzzle/cubeState';
import { cubiesInLayer } from '../puzzle/cubies';
import { FACE_AXIS, moveAngle } from '../puzzle/geometry';
import type { Axis, Layer } from '../puzzle/geometry';
import { invertMove } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';

export type MoveSource = 'manual' | 'undo' | 'redo' | 'scramble' | 'solver';

export function isUserSource(source: MoveSource): boolean {
  return source === 'manual' || source === 'undo' || source === 'redo';
}

export interface CommitEvent {
  readonly type: 'commit';
  readonly move: Move;
  readonly source: MoveSource;
  readonly tag: string | undefined;
  readonly before: CubeState;
  readonly after: CubeState;
  /** Engine version after this commit. */
  readonly version: number;
  /** Commit instant on the engine clock (exact animation end, not frame time). */
  readonly at: number;
  readonly solved: boolean;
}

export interface ReplaceEvent {
  readonly type: 'replace';
  readonly state: CubeState;
  readonly version: number;
  readonly reason: string;
}

export interface ActivityEvent {
  readonly type: 'activity';
}

export type EngineEvent = CommitEvent | ReplaceEvent | ActivityEvent;

export interface VisualTurn {
  readonly axis: Axis;
  readonly layer: Layer;
  /** Radians about the +axis (right-hand rule). */
  readonly angle: number;
  readonly cubies: readonly number[];
}

export interface DragPreview {
  readonly axis: Axis;
  readonly layer: Layer;
  readonly angle: number;
}

export interface DragRelease {
  readonly move: Move;
  /** Current drag angle about +axis. */
  readonly fromAngle: number;
  /** Final angle about +axis (keeps the direction the user dragged, even for doubles). */
  readonly targetAngle: number;
  /** Duration of a full quarter turn; the remaining fraction is animated. */
  readonly quarterDurationMs: number;
}

export interface EnqueueOptions {
  readonly source: MoveSource;
  /** Duration of the whole move in ms (0 = instant). */
  readonly durationMs: number;
  readonly tag?: string;
}

export interface EngineOptions {
  readonly now?: () => number;
  /** Ask the host to call `tick()` on the next animation frame. */
  readonly scheduleFrame?: (callback: () => void) => void;
  /** Cap on queued user turns so a held key cannot build an endless backlog. */
  readonly maxPendingUserTurns?: number;
}

type Easing = (t: number) => number;
const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Op {
  readonly kind: 'turn' | 'undo' | 'redo';
  readonly move: Move | null;
  readonly source: MoveSource;
  readonly tag: string | undefined;
  readonly durationMs: number;
  readonly fromAngle: number | null;
  readonly targetAngle: number | null;
}

interface ActiveTurn {
  readonly move: Move;
  readonly source: MoveSource;
  readonly tag: string | undefined;
  readonly axis: Axis;
  readonly layer: Layer;
  readonly cubies: readonly number[];
  readonly from: number;
  readonly to: number;
  readonly startedAt: number;
  readonly duration: number;
  readonly easing: Easing;
}

interface Settle {
  readonly axis: Axis;
  readonly layer: Layer;
  readonly cubies: readonly number[];
  readonly from: number;
  readonly startedAt: number;
  readonly duration: number;
}

interface DragState {
  preview: (DragPreview & { cubies: readonly number[] }) | null;
}

const SETTLE_MS = 160;

export class CubeEngine {
  #state: CubeState;
  #version = 0;
  #queue: Op[] = [];
  #active: ActiveTurn | null = null;
  #settle: Settle | null = null;
  #drag: DragState | null = null;
  #undo: Move[] = [];
  #redo: Move[] = [];
  #instant = false;
  #pumping = false;
  #frameRequested = false;
  #disposed = false;
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  #idleWaiters: Array<() => void> = [];
  readonly #now: () => number;
  readonly #scheduleFrame: ((callback: () => void) => void) | undefined;
  readonly #maxPendingUserTurns: number;

  constructor(initial: CubeState, options: EngineOptions = {}) {
    this.#state = initial;
    this.#now = options.now ?? (() => performance.now());
    this.#scheduleFrame = options.scheduleFrame;
    this.#maxPendingUserTurns = options.maxPendingUserTurns ?? 8;
  }

  // ── Queries ────────────────────────────────────────────────────────────

  get state(): CubeState {
    return this.#state;
  }

  /** Incremented on every commit and every state replacement. */
  get version(): number {
    return this.#version;
  }

  now(): number {
    return this.#now();
  }

  isBusy(): boolean {
    return this.#active !== null || this.#queue.length > 0 || this.#settle !== null || this.#drag !== null;
  }

  isAnimating(): boolean {
    return this.#active !== null || this.#settle !== null || this.#drag !== null;
  }

  isDragging(): boolean {
    return this.#drag !== null;
  }

  pendingCount(): number {
    return this.#queue.length + (this.#active ? 1 : 0);
  }

  /** True when an op from one of `sources` is queued or in flight. */
  hasWorkFrom(...sources: MoveSource[]): boolean {
    if (this.#active && sources.includes(this.#active.source)) return true;
    return this.#queue.some((op) => sources.includes(op.source));
  }

  canUndo(): boolean {
    return this.#projectedStacks().undo > 0;
  }

  canRedo(): boolean {
    return this.#projectedStacks().redo > 0;
  }

  /** Undo/redo depth after every queued op has run (so rapid presses stay consistent). */
  #projectedStacks(): { undo: number; redo: number } {
    let undo = this.#undo.length;
    let redo = this.#redo.length;
    const ops: Array<{ kind: Op['kind']; source: MoveSource }> = [];
    if (this.#active) {
      const source = this.#active.source;
      ops.push({ kind: source === 'undo' ? 'undo' : source === 'redo' ? 'redo' : 'turn', source });
    }
    ops.push(...this.#queue);
    for (const op of ops) {
      if (op.kind === 'undo') {
        if (undo > 0) {
          undo--;
          redo++;
        }
      } else if (op.kind === 'redo') {
        if (redo > 0) {
          redo--;
          undo++;
        }
      } else if (op.source === 'manual') {
        undo++;
        redo = 0;
      } else if (!isUserSource(op.source)) {
        undo = 0;
        redo = 0;
      }
    }
    return { undo, redo };
  }

  /**
   * The layer rotation the renderer should display right now, or null when the
   * cube is at rest. Cubie membership is taken from the committed state.
   */
  getVisualTurn(now: number = this.#now()): VisualTurn | null {
    if (this.#drag) {
      const p = this.#drag.preview;
      return p ? { axis: p.axis, layer: p.layer, angle: p.angle, cubies: p.cubies } : null;
    }
    if (this.#settle) {
      const s = this.#settle;
      const t = clamp01((now - s.startedAt) / s.duration);
      return { axis: s.axis, layer: s.layer, angle: s.from * (1 - easeOutCubic(t)), cubies: s.cubies };
    }
    if (this.#active) {
      const a = this.#active;
      const t = a.duration <= 0 ? 1 : clamp01((now - a.startedAt) / a.duration);
      return { axis: a.axis, layer: a.layer, angle: a.from + (a.to - a.from) * a.easing(t), cubies: a.cubies };
    }
    return null;
  }

  // ── Commands ───────────────────────────────────────────────────────────

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Queues one move. Returns false if refused (user backlog full). */
  enqueue(move: Move, options: EnqueueOptions): boolean {
    if (this.#disposed) return false;
    if (isUserSource(options.source) && this.#pendingUserOps() >= this.#maxPendingUserTurns) return false;
    this.#queue.push({
      kind: 'turn',
      move,
      source: options.source,
      tag: options.tag,
      durationMs: options.durationMs,
      fromAngle: null,
      targetAngle: null,
    });
    this.#afterEnqueue();
    return true;
  }

  enqueueMany(moves: readonly Move[], options: EnqueueOptions): void {
    if (this.#disposed) return;
    for (const move of moves) {
      this.#queue.push({
        kind: 'turn',
        move,
        source: options.source,
        tag: options.tag,
        durationMs: options.durationMs,
        fromAngle: null,
        targetAngle: null,
      });
    }
    this.#afterEnqueue();
  }

  /** Queues an undo; the move is resolved from the stack when the op starts. */
  requestUndo(durationMs: number): boolean {
    if (!this.canUndo() || this.#pendingUserOps() >= this.#maxPendingUserTurns) return false;
    this.#queue.push({ kind: 'undo', move: null, source: 'undo', tag: undefined, durationMs, fromAngle: null, targetAngle: null });
    this.#afterEnqueue();
    return true;
  }

  requestRedo(durationMs: number): boolean {
    if (!this.canRedo() || this.#pendingUserOps() >= this.#maxPendingUserTurns) return false;
    this.#queue.push({ kind: 'redo', move: null, source: 'redo', tag: undefined, durationMs, fromAngle: null, targetAngle: null });
    this.#afterEnqueue();
    return true;
  }

  /** Finishes everything queued, then commits `moves` synchronously (one commit event each). */
  applyInstant(moves: readonly Move[], source: MoveSource, tag?: string): void {
    this.fastForward();
    const now = this.#now();
    for (const move of moves) this.#commit(move, source, tag, now);
    this.#notifyIdleIfNeeded();
  }

  /**
   * Completes the in-flight turn and every queued op immediately, in order.
   * Used for "skip animation" and when the page is hidden. An active drag
   * preview is dropped (not committed).
   */
  fastForward(): void {
    const now = this.#now();
    const hadDrag = this.#drag !== null;
    this.#drag = null;
    this.#settle = null;
    if (this.#active) {
      const a = this.#active;
      this.#active = null;
      this.#commit(a.move, a.source, a.tag, now);
    }
    const previous = this.#instant;
    this.#instant = true;
    this.#pump(now);
    this.#instant = previous;
    if (hadDrag) this.#emit({ type: 'activity' });
    this.#notifyIdleIfNeeded();
  }

  /** Drops queued (not yet started) ops, optionally only those matching `predicate`. */
  cancelPending(predicate: (source: MoveSource) => boolean = () => true): void {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((op) => !predicate(op.source));
    if (this.#queue.length !== before) {
      this.#emit({ type: 'activity' });
      this.#notifyIdleIfNeeded();
    }
  }

  /**
   * Replaces the puzzle state wholesale (reset, replay, restore). Everything
   * pending is cancelled and the in-flight turn is abandoned *uncommitted*,
   * which is safe because commits only happen at animation end.
   */
  replaceState(state: CubeState, reason: string): void {
    this.#queue = [];
    this.#active = null;
    this.#settle = null;
    this.#drag = null;
    this.#undo = [];
    this.#redo = [];
    this.#state = state;
    this.#version++;
    this.#emit({ type: 'replace', state, version: this.#version, reason });
    this.#notifyIdleIfNeeded();
  }

  /** While true (e.g. page hidden), turns commit immediately with no animation. */
  setInstantMode(on: boolean): void {
    this.#instant = on;
    if (on) this.fastForward();
  }

  /**
   * Starts a pointer twist. Refused while scramble/solver work is pending; the
   * user's own queued turns are completed first so the drag starts from rest.
   */
  beginDrag(): boolean {
    if (this.#disposed || this.#drag) return false;
    if (this.hasWorkFrom('scramble', 'solver')) return false;
    if (this.#active || this.#queue.length > 0 || this.#settle) this.fastForward();
    this.#drag = { preview: null };
    this.#emit({ type: 'activity' });
    return true;
  }

  updateDrag(preview: DragPreview | null): void {
    if (!this.#drag) return;
    this.#drag.preview = preview
      ? { ...preview, cubies: cubiesInLayer(this.#state.cubies, preview.axis, preview.layer) }
      : null;
    this.#requestFrame();
  }

  /** Ends the twist: commit `release.move` (animating the rest of the way) or settle back. */
  endDrag(release: DragRelease | null): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    const now = this.#now();
    if (release) {
      const remaining = Math.abs(release.targetAngle - release.fromAngle) / (Math.PI / 2);
      this.#queue.unshift({
        kind: 'turn',
        move: release.move,
        source: 'manual',
        tag: 'drag',
        durationMs: Math.max(60, release.quarterDurationMs * Math.min(2, remaining)),
        fromAngle: release.fromAngle,
        targetAngle: release.targetAngle,
      });
    } else if (drag.preview && Math.abs(drag.preview.angle) > 1e-4 && !this.#instant) {
      const p = drag.preview;
      this.#settle = { axis: p.axis, layer: p.layer, cubies: p.cubies, from: p.angle, startedAt: now, duration: SETTLE_MS };
    }
    this.#pump(now);
    this.#emit({ type: 'activity' });
    this.#requestFrame();
    this.#notifyIdleIfNeeded();
  }

  /** Advances animations; commits a finished turn and starts the next queued op. */
  tick(now: number = this.#now()): void {
    if (this.#disposed) return;
    if (this.#settle && now >= this.#settle.startedAt + this.#settle.duration) {
      this.#settle = null;
      this.#emit({ type: 'activity' });
    }
    if (this.#active && now >= this.#active.startedAt + this.#active.duration) {
      const a = this.#active;
      this.#active = null;
      this.#commit(a.move, a.source, a.tag, a.startedAt + a.duration);
    }
    this.#pump(now);
    if (this.isAnimating()) this.#requestFrame();
    this.#notifyIdleIfNeeded();
  }

  /** Resolves once nothing is queued, animating or being dragged. */
  whenIdle(): Promise<void> {
    if (!this.isBusy()) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  dispose(): void {
    this.#disposed = true;
    this.#queue = [];
    this.#active = null;
    this.#settle = null;
    this.#drag = null;
    this.#listeners.clear();
    this.#notifyIdleIfNeeded();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  #pendingUserOps(): number {
    let n = this.#queue.filter((op) => isUserSource(op.source)).length;
    if (this.#active && isUserSource(this.#active.source)) n++;
    return n;
  }

  #afterEnqueue(): void {
    this.#pump(this.#now());
    this.#emit({ type: 'activity' });
    this.#notifyIdleIfNeeded();
  }

  #resolveOp(op: Op): Move | null {
    if (op.kind === 'undo') {
      const last = this.#undo[this.#undo.length - 1];
      return last ? invertMove(last) : null;
    }
    if (op.kind === 'redo') {
      return this.#redo[this.#redo.length - 1] ?? null;
    }
    return op.move;
  }

  #effectiveDuration(op: Op): number {
    if (this.#instant) return 0;
    if (!isUserSource(op.source) || op.fromAngle !== null) return op.durationMs;
    // Speed up when the user is ahead of the animation so input never feels laggy.
    const backlog = Math.min(this.#queue.filter((o) => isUserSource(o.source)).length, 6);
    return Math.max(op.durationMs > 0 ? 45 : 0, op.durationMs / (1 + 0.55 * backlog));
  }

  #pump(now: number): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (!this.#active && !this.#drag && !this.#settle && this.#queue.length > 0 && !this.#disposed) {
        const op = this.#queue.shift()!;
        const move = this.#resolveOp(op);
        if (!move) continue;
        const duration = this.#effectiveDuration(op);
        if (duration <= 0) {
          this.#commit(move, op.source, op.tag, now);
          continue;
        }
        const { axis, layer } = FACE_AXIS[move.face];
        this.#active = {
          move,
          source: op.source,
          tag: op.tag,
          axis,
          layer,
          cubies: cubiesInLayer(this.#state.cubies, axis, layer),
          from: op.fromAngle ?? 0,
          to: op.targetAngle ?? moveAngle(move),
          startedAt: now,
          duration,
          easing: isUserSource(op.source) ? easeOutCubic : easeInOutCubic,
        };
        this.#requestFrame();
      }
    } finally {
      this.#pumping = false;
    }
  }

  #commit(move: Move, source: MoveSource, tag: string | undefined, at: number): void {
    const before = this.#state;
    const after = applyMove(before, move);
    this.#state = after;
    this.#version++;
    if (source === 'manual') {
      this.#undo.push(move);
      this.#redo = [];
    } else if (source === 'undo') {
      const undone = this.#undo.pop();
      if (undone) this.#redo.push(undone);
    } else if (source === 'redo') {
      const redone = this.#redo.pop();
      if (redone) this.#undo.push(redone);
    } else {
      this.#undo = [];
      this.#redo = [];
    }
    this.#emit({ type: 'commit', move, source, tag, before, after, version: this.#version, at, solved: isSolved(after) });
  }

  #requestFrame(): void {
    if (!this.#scheduleFrame || this.#frameRequested || this.#disposed) return;
    this.#frameRequested = true;
    this.#scheduleFrame(() => {
      this.#frameRequested = false;
      this.tick(this.#now());
    });
  }

  #emit(event: EngineEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  #notifyIdleIfNeeded(): void {
    if (this.isBusy() || this.#idleWaiters.length === 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
