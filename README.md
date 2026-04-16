# CUBELAB

**The interactive cubing studio.** A 3×3×3 cube you can turn with your fingers, mouse or keyboard,
scramble with real random-state WCA scrambles, time against an accurate clock, and auto-solve from
whatever state it is in — with the solution played back move by move.

Everything runs locally in the browser. There are no accounts, no servers, no analytics; solves and
settings live in this browser's `localStorage` only.

![Desktop studio](artifacts/desktop-1440-scrambled.png)

## Quick start

Requires Node.js ≥ 22.3 (cubing.js needs `process.getBuiltinModule`).

```bash
npm install
```

```bash
npm run dev          # http://localhost:5317
```

```bash
npm run build        # typecheck + production bundle in dist/
```

```bash
npm run preview      # serves dist/ at http://localhost:4317
```

```bash
npm test             # Vitest unit/integration suite (real cubing.js solver, nothing mocked)
```

```bash
npm run test:e2e     # Playwright against the production build (builds + previews automatically)
```

| Script               | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server on port 5317                                         |
| `npm run build`      | `tsc -b` then `vite build`                                           |
| `npm run preview`    | Serve the production build on port 4317                              |
| `npm run typecheck`  | Strict TypeScript project build                                      |
| `npm run lint`       | ESLint (typescript-eslint + React Compiler hook rules)               |
| `npm test`           | Vitest suite                                                         |
| `npm run test:e2e`   | Playwright suite (desktop 1440×900, phone 390×844 touch, no-WebGL)   |
| `npm run test:all`   | Everything above, in order                                           |
| `npm run screenshots`| Re-capture `artifacts/*.png` (needs `npm run preview` running)       |

First Playwright run on a new machine: `npx playwright install chromium`.

## Using the studio

### Gestures

- **Twist** — press on a sticker and push it along its row or column. The outer layer under your
  finger follows the drag; release past ~25° (or flick) to commit the turn, otherwise it springs back.
  A small label beside the pointer shows the move you are about to make (`R`, `U'`, `F2`…).
- **Orbit** — drag the empty background. Right-drag, middle-drag or Shift/Alt/Ctrl-drag orbits from
  anywhere, including over the cube.
- **Zoom** — scroll wheel, or pinch. Two fingers also orbit.
- Middle slices are deliberately not turnable: every move the app can produce is one of the six
  outer faces, which is exactly the vocabulary of the timer, notation and solver. Dragging a middle
  row shows a hint instead of turning the wrong layer.
- On touch screens a **Twist / Orbit** switch under the cube makes single-finger drags unambiguous.

### Move Pad and keyboard

The Move Pad has dedicated buttons for all 18 moves (`U D L R F B`, each clockwise, `'` and `2`).

| Keys                                    | Action                                            |
| --------------------------------------- | ------------------------------------------------- |
| `U D L R F B` (Faces layout, default)   | Turn clockwise; with `Shift` counter-clockwise    |
| `I K J F H G D E S L W O` (Speed layout)| R R' U U' F F' L L' D D' B B' (qqTimer/csTimer style) |
| `N`                                     | New Scramble                                      |
| `A`                                     | Auto Solve                                        |
| `P` · `,` `.`                           | Play/pause solution · step back/forward           |
| `Ctrl+Z` · `Ctrl+Shift+Z` / `Ctrl+Y`    | Undo · redo                                       |
| `Space`                                 | Spacebar timer: inspect / hold to arm / stop (DNF)|
| Arrow keys · `C`                        | Orbit camera · reset camera                       |
| `Z` · `M` · `?` · `Esc`                 | Zen mode · Move Pad · help · close / cancel       |

Keys use `KeyboardEvent.code`, so they work on any keyboard layout. Shortcuts are ignored while
typing in a field or while a dialog is open.

### Timer modes

- **Casual (default)** — after **New Scramble** the status reads READY. The clock starts on the
  commit of your first turn and stops on the commit of the turn that solves the cube (both instants
  are taken from the same turn pipeline, so animation length cancels out).
- **Spacebar** — optional 15 s inspection, then hold `Space` (or press and hold the clock on touch
  screens) for 300 ms until it turns green, and release to start. Turning is blocked until the clock
  runs; only a genuine solve stops it, and pressing `Space` while running records a DNF. Inspection
  thresholds mirror current WCA practice for training purposes (< 15 s clean, ≥ 15 s `+2`,
  ≥ 17 s DNF) — this is not an official or certified timer.

**Integrity:** undo/redo during an attempt saves it as *practice* (kept in history, excluded from PB
and averages). Auto Solve ends the attempt without recording it. Scramble playback and solver moves
never reach the timer as turns, and camera movement never touches the puzzle.

### Statistics

Best single, current ao5 and ao12, best ao5, and session mean, computed only from clean solves:
effective time includes `+2`; ao*N* drops one best and one worst; one DNF is the dropped worst, two or
more make the average DNF. Singles are truncated to hundredths and averages rounded, per WCA
convention. Turn counts are recorded in both HTM (each `U`, `U'`, `U2` = 1) and QTM (`U2` = 2).
History supports per-solve detail, delete with confirmation, clear-all with confirmation and CSV export.

### Other features

New Scramble (animated or instant, with skip), Auto Solve with Play/Pause, Step back/forward,
Replay, Stop and Slow/Normal/Fast speed, Undo/Redo, Reset (confirms if it would discard a running
attempt), camera reset, copy scramble, shareable scramble links (`?scramble=R%20U%20F'`), Zen mode
(fullscreen when available), sticker letters for colour-vision differences, gloss/matte finish,
render quality (auto/high/low), reduced motion (system/reduced/full), orbit sensitivity, optional
synthesized sound (off by default), and a 2D net fallback when WebGL is unavailable.

## Architecture

```
src/
  core/                     framework-free, unit-tested
    puzzle/   notation, integer geometry, 26-cubie model, facelet layout, KPattern bridge, CubeState
    engine/   CubeEngine: the single serialized move pipeline (queue, animation, drag, undo/redo)
    scramble/ random-state scrambles via cubing.js (lazy, web worker)
    solver/   state-based solving via cubing.js + verification
    timing/   timer state machine (casual / spacebar / inspection)
    stats/    WCA-style averages and time formatting
    persistence/ versioned, validated localStorage (settings, history, cube snapshot)
    audio/    optional Web Audio feedback
  app/        Studio controller (vanilla Zustand store), UI store, actions, debug hooks
  components/ stage (R3F canvas, camera rig, pointer arbitration), cube (meshes, gestures),
              controls, panels, ui primitives
  hooks/      keyboard, environment (visibility, reduced motion, fullscreen)
tests/
  unit/       Vitest: puzzle, engine, solver, timer, stats, persistence, gestures, studio flows
  e2e/        Playwright: desktop, touch phone, no-WebGL, reduced motion
```

### One authoritative state

`CubeState` (`src/core/puzzle/cubeState.ts`) is a single immutable value holding two synchronised
views of the same cube:

- `pattern` — the cubing.js `KPattern`, canonical for solving, solved detection and scramble checks;
- `cubies` — one exact integer rotation matrix per cubie (stable ids), which the renderer draws.

Both are advanced only by `applyMove`. Because every face turn applies the same rotation to a
cubie's position and orientation, `position = orientation · home` always holds, so position is
derived, never stored, and long sequences cannot drift. `agrees(state)` compares facelets derived
independently from each view; the tests run it after every move of thousands of random moves.

Coordinates are fixed to the cube, matching three.js: **+X = R, +Y = U, +Z = F**. A face turn is
clockwise as seen looking at that face; that is a negative rotation about +axis for R/U/F and a
positive one for L/D/B. The camera never changes notation.

### The move pipeline

`CubeEngine` (`src/core/engine/cubeEngine.ts`) serializes every change — pointer twists, keys, Move
Pad, undo/redo, scramble playback and solver playback. A turn commits **exactly once, when its
animation completes**; until then the logical state is the pre-turn state, so reset/solve/undo never
see a half-applied move and an aborted animation needs no rollback. Time is injected, so the whole
pipeline is driven by a fake clock in tests. The renderer reads `getVisualTurn()` each frame and
rebuilds every cubie transform from the committed integer state plus the in-flight rotation —
nothing accumulates frame to frame.

### Model ↔ render agreement

`readVisualFacelets()` reads sticker colours back out of the actual three.js scene graph (world
transforms of each sticker mesh). The browser tests compare it with the canonical model after
twists, Move Pad turns, scrambles, undo/redo, playback steps and solves.

### Solver and scrambles

`randomScrambleForEvent('333')` and `experimentalSolve3x3x3IgnoringCenters(pattern)` from cubing.js
run in cubing.js's own module worker, loaded lazily and pre-warmed when the browser is idle. Auto
Solve captures the current `KPattern` (after the queue is idle) and its engine version, solves it,
verifies the returned algorithm actually solves the captured state, and only plays it if the cube is
still at that version. Playback re-checks the version before every move, so a stale solution can
never overwrite a newer user action.

`vite.config.ts` groups cubing.js's shared modules into their own chunk and disables Vite's
DOM-based module-preload helper, so the worker never imports app code in production builds.

## Debug / verification hooks

`window.__CUBELAB__` exposes read-only inspection (`facelets()`, `patternFacelets()`,
`visualFacelets()`, `project(point)`, `camera()`, `timer()`, `solver()` …) used by the browser tests.
Nothing on it can change state.

## Known limitations

See `CUBELAB_HANDOFF.md` for the full, candid list. In short: only outer-face turns (no slices or
rotations) are supported by design; the timer is a training tool, not WCA-certified; solve history is
per-browser; touch gestures were verified with Chromium touch emulation, not on physical devices.
