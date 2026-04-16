# CUBELAB — Handoff

Status: feature-complete against the build brief, all automated gates green on 2026-10-12.
This document is deliberately candid about what was and was not verified.

## Verified commands and results

All run on Windows 11, Node 22.19.0, npm 10.9.3, in this directory.

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc -b`, strict) | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm test` (Vitest) | **119 / 119 passed**, 8 files (~25 s; the solver suite runs the real cubing.js worker) |
| `npm run build` | pass, no warnings |
| `npm run test:e2e` (Playwright, production build via `vite preview`) | **15 / 15 passed** (desktop 1440×900, phone 390×844 with touch, no-WebGL, reduced motion) |
| Dev server smoke (`npm run dev` → New Scramble → Auto Solve) | scramble applied, solved; console shows only React's dev-mode DevTools notice |
| Production console during load + scramble + auto-solve | completely empty (no errors, no warnings) |

Ports: dev **5317**, preview **4317** (5173 was occupied by another process on this machine, so
CUBELAB uses its own fixed ports; see `vite.config.ts`).

## Screenshots (`artifacts/`)

Captured from the production build with `npm run screenshots` (real GPU via ANGLE/D3D11):

- `desktop-1440-fresh.png`, `-scrambled.png`, `-timing.png`, `-playback.png`, `-solved-stats.png`
  (includes the solved halo and stats from six real keyboard solves), `-history.png`,
  `-settings.png`, `-help.png`, `-zen.png`
- `laptop-1280x720.png`, `tablet-768.png`
- `mobile-390-fresh.png`, `-scrambled.png`, `-playback.png`, `-full.png` (full page; the fixed bottom
  bar appears mid-page only because of how full-page captures render fixed elements)

## Architecture map

| Concern | File(s) |
| --- | --- |
| Notation (outer faces only), parse/format/invert, HTM/QTM | `src/core/puzzle/notation.ts` |
| Integer geometry, axis/face conventions (+X=R, +Y=U, +Z=F) | `src/core/puzzle/geometry.ts` |
| 26-cubie model with stable ids, `position = O·home` | `src/core/puzzle/cubies.ts` |
| 54-facelet layout (Kociemba order) | `src/core/puzzle/facelets.ts` |
| cubing.js `KPattern` bridge, independent facelet projection, legality checks | `src/core/puzzle/kpattern.ts` |
| `CubeState` = { KPattern, cubies }, single `applyMove` | `src/core/puzzle/cubeState.ts` |
| Serialized move pipeline, commit-at-animation-end, drag preview, undo/redo | `src/core/engine/cubeEngine.ts` |
| Random-state scrambles (lazy, worker) | `src/core/scramble/scrambler.ts` |
| State-based solve + verification + timeout | `src/core/solver/solver.ts` |
| Timer state machine (casual / spacebar / inspection) | `src/core/timing/timerMachine.ts` |
| WCA-style averages, formatting | `src/core/stats/stats.ts`, `format.ts` |
| Versioned, validated persistence, backups of discarded data | `src/core/persistence/storage.ts`, `settings.ts` |
| Product controller (engine ↔ timer ↔ scramble ↔ solver ↔ history), async race guards | `src/app/studio.ts` |
| Pointer arbitration (twist vs orbit vs pinch), touch-action handling | `src/components/stage/Interaction.tsx` |
| Gesture math (ray–box, tangent locking, slice refusal, snap/flick) | `src/components/cube/gestures.ts` |
| Cube meshes, per-frame transform rebuild | `src/components/cube/CubeModel.tsx`, `cubeResources.ts` |
| Scene-graph facelet reader (render ↔ model check) | `src/components/cube/visualFacelets.ts` |
| Canvas, lighting, panel-aware camera framing, demand rendering | `src/components/stage/StageCanvas.tsx`, `orbitRig.ts` |
| WebGL detection, error boundary, 2D net fallback, skeleton | `src/components/stage/Stage.tsx`, `FaceNet.tsx` |
| Bundling constraints for the cubing.js worker | `vite.config.ts` |

## Dependencies (exact pins)

Runtime: react / react-dom 19.3.0, three **0.182.0**, @react-three/fiber 9.8.1,
@react-three/drei 10.7.9, cubing 0.65.1, zustand 5.0.15, lucide-react 1.55.0, Fontsource
(Instrument Sans variable, Instrument Serif, Geist Mono variable) 5.3.0 — fonts are self-hosted.

Dev: typescript **6.0.3**, vite 8.3.4 (Rolldown), @vitejs/plugin-react 6.1.2, vitest 5.0.3,
@playwright/test 1.64.0, eslint 10.12.0, typescript-eslint 8.71.1, eslint-plugin-react-hooks 7.1.1.

Version decisions:
- **three 0.182** rather than 0.186: three deprecated `THREE.Clock` in r183 and R3F 9.8 still creates
  one, which prints a console warning on every load. 0.182 is the last release without it.
- **TypeScript 6.0** rather than 7.0: typescript-eslint 8.71 supports TypeScript < 6.1.

## Problems found during verification and how they were fixed

1. **Solver/scrambler broke in the production bundle.** Rolldown hoisted cubing.js modules shared
   with its search worker into the app entry chunk, and wrapped dynamic imports in Vite's DOM-based
   preload helper; the worker then executed app code and died with `document is not defined`.
   Fixed in `vite.config.ts` (dedicated `cubing-core` chunk group + `modulePreload: false`). The
   chunk graph was checked: worker entry → `cubing-core` → runtime only.
2. **Phone layout zoomed out.** A later `.segmented` rule overrode the header's mobile `display:none`,
   overflowing the header; the phone zoomed out and pushed the fixed action bar off-screen.
3. **Touch twist could start a browser pan/fling.** `touch-action` does not cross a scroll container,
   and R3F's wrapper (`overflow:hidden`) is one, so the canvas itself still allowed panning. The canvas
   and its wrappers now set `touch-action: none` directly.
4. **Playback panel covered the cube on desktop**; camera framing now accounts for the transport (and
   for zen mode) and eases between framings.
5. Zen exit button was mis-positioned (cascade order); fixed.

## Known limitations (honest)

- **Touch was verified with Chromium touch emulation (CDP), not on physical phones/tablets.**
  iOS Safari and Android Chrome on real hardware were not tested. Only Chromium runs in the E2E
  suite (no Firefox/WebKit projects).
- **Emulation artifact in the touch test:** Chromium's CDP touch emulation swallows the first tap
  after a synthetic touch drag. This reproduces on a bare page with no app code (0/6 clicks in a
  minimal repro), so the mobile spec absorbs it with a tap on inert text
  (`absorbEmulatedTap` in `tests/e2e/helpers.ts`). It is documented rather than hidden.
- Only the six outer faces are supported. Slices (`M E S`) and rotations (`x y z`) are intentionally
  not exposed; dragging a middle row shows a hint.
- The timer mirrors WCA inspection thresholds for training; it is not an official/certified timer.
  Singles are truncated and means rounded, so a one-solve session can show best 0.18 and mean 0.19.
- A running attempt is not restored after a page refresh (the cube state, scramble, settings and
  history are).
- Not covered by automated tests: audible sound output (synthesized Web Audio, off by default),
  clipboard copy / share-link copy, CSV export download, browser fullscreen in zen mode, the 17 s
  inspection DNF in the browser (covered by unit tests at the exact 15 s / 17 s boundaries).
- No formal FPS profiling. Rendering is on-demand (frames only while something moves), DPR is capped
  (1–1.75 auto, 1–2 high, 1–1.25 low) and `quality: auto` drops to the low profile via drei's
  `PerformanceMonitor`.
- Bundle: the three.js/R3F chunk is ~936 kB (~267 kB gzip) and is lazy-loaded after the UI shell.
  cubing.js ships extra chunks for other puzzles (e.g. a 656 kB `twips` WASM wrapper) that are emitted
  but not loaded by this app.
- The first scramble/solve boots cubing.js's worker and tables (~0.5–1.2 s); the app pre-warms it in
  idle time, and the UI labels the first run "Warming solver…".
- The directory was not a Git repository, so no repository was initialised and nothing was committed.

## Recommended next steps

1. Run the E2E suite on real devices (BrowserStack or local iOS/Android) and add WebKit/Firefox
   Playwright projects.
2. Add slice moves and whole-cube rotations end to end (KPattern supports them; the solver would need
   center-aware canonicalisation before solving).
3. Visual-regression snapshots of the artifacts set to guard the design.
4. Multiple named sessions, per-session charts, and import/export of history as JSON.
5. Optional PWA manifest + service worker for fully offline use after first load.
6. Instanced meshes for stickers if lower-end mobile profiling shows draw-call pressure.
