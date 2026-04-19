# CUBELAB — Handoff

Status (2026-10-12): second pass complete — **M / E / S middle slices end to end** and a **premium
visual overhaul** of the cube and the whole interface. All automated gates are green. This document is
deliberately candid about what was and was not verified.

## Repository state

- The folder had no Git repository; one was initialised for this pass.
  - `main` — `53229f6` *Baseline: CUBELAB v1* (the delivered v1, untouched).
  - `premium-slices-upgrade` (checked out) — this pass, in three commits: slices, visual overhaul,
    hardening + docs. Nothing is pushed anywhere; merge when happy (`git checkout main && git merge
    premium-slices-upgrade`).
- `.gitattributes` normalises line endings to LF.
- Screenshots: `artifacts/before/` (v1) and `artifacts/after/` (this pass).

## Baseline before changes (recorded first)

`npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` 119/119 ✓ · `npm run build` ✓ ·
`npm run test:e2e` 15/15 ✓. No pre-existing failures.

## Verification after changes

Windows 11, Node 22.19.0, run in this directory on the final tree:

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm test` | **178 / 178** passed, 9 files (~10 s; real cubing.js scrambler + solver) |
| `npm run build` | pass, no warnings |
| `npm run test:e2e` | **23 / 23** passed (5.0 min): Chromium desktop 1440×900 (19), Chromium phone 390×844 touch (2), Firefox smoke (1), WebKit smoke (1) |
| `npm run screenshots` | 24 captures in `artifacts/after/`; the script reported no console warnings or errors |
| Dev server (`npm run dev`) smoke | real scramble → auto-solve → solved; console shows only React's dev-mode DevTools notice |

Firefox and WebKit both ran the real WebGL stage (not the fallback) with rendered stickers equal to
the model.

## M / E / S — representation and guarantees

- **Notation** (`src/core/puzzle/notation.ts`): nine families `U D L R F B M E S`; `Move = { family,
  turns }`. M turns like L, E like D, S like F. Rotations and wide moves are still rejected.
- **Geometry** (`geometry.ts`): `MOVE_AXIS` gives axis + layer (slices at layer 0) and an explicit
  clockwise sign table (R/U/F/S −; L/D/B/M/E +) — no sign is inferred.
- **Cubie model** (`cubies.ts`): unchanged mechanism; a slice rotates the 8 visible cubies of layer 0
  (4 edges + 4 centres). Centres now move and keep their spin; the core is implicit.
- **KPattern** (`kpattern.ts`): cubing.js's own `M/E/S` transformations; the `CENTERS` orbit permutes.
  Legality for stored data: centres must form one of the 24 rotations and
  `parity(edges) ⊕ parity(corners) = parity(centres)`.
- **Solved**: orientation-insensitive, so a cube that is solved but rotated (e.g. after `R M' L'`)
  stops the clock — both detectors agree on 1 500-move slice-heavy sequences.
- **Solver** (`src/core/solver/solver.ts`): cubing.js's 3×3 solver ignores centres, so displaced centres
  are first homed with the shortest slice sequence (BFS over 24 arrangements, ≤ 3 turns), then the
  outer-face state is solved. Full solution = homing prefix + solve, verified against the captured
  state; the cube ends white-top/green-front. Full real-solver runs on 30 seeded slice-heavy states,
  lone slices, odd-parity states and reload-with-no-history; centre homing alone on 120 more states.
- **Gestures** (`src/components/cube/gestures.ts`): the layer is `round(hit · axis)` with axis =
  n × locked tangent; layer 0 resolves to M/E/S. Ambiguity uses an **angular** margin (12°) instead of
  a cosine difference, which fixed false "ambiguous" results at grazing camera angles. Verified under
  three real perspective cameras (home, back-left orbit, from below), both directions, adjacent outer
  strips, and with real mouse and touch drags in the browser.
- **Everything else**: engine queue/preview/undo/redo unchanged and slice-agnostic; keyboard `M E S`
  (+Shift) or `5/6 2/3 8/9` (speed layout); Move Pad Faces/Slices bank; turn tape and STM counter;
  timer records STM/HTM/QTM (slice = 1 STM, 2 HTM); history **schema v2** with a lossless v1 migration
  (`turnsSTM = turnsHTM`, exact because v1 had no slices) and a one-time backup of the v1 payload;
  share links accept slices; persisted cube snapshots with displaced centres reload exactly.
- **2D fallback**: the net reflects slice turns (Move Pad/keyboard work there); there is no on-net
  drag gesture, by design, since the fallback has no 3D surface to push.

## Visual direction (what changed and why)

Audit of v1: the cube read as clean CG plastic (uniform roundover, flat stickers, no self-shadowing,
faint cyan seam tint); the UI leaned "sci-fi dashboard" (lavender/cyan glows, orbit rings, frosted
cards everywhere, lavender gradient button); no move list.

- **Cube**: tighter seams, bevelled tiles inside each face's flat area, procedural micro-roughness on
  the plastic, dark core, pad-printed mark on the white centre cap, calibrated colours; neutral studio
  lighting (softbox, key strip, rim strip, frontal and right fills, hemisphere) with soft self-shadowing
  on the high tier; 27° telephoto camera; light-ripple-on-the-floor celebration instead of a big ring;
  hover outline on the sticker under the mouse; ~1.5 % snap overshoot on manual turns.
- **System**: warm-neutral charcoal tokens; colour only on the cube and in semantic status signals
  (live / hold / ready / fault); Instrument Sans tabular numerals (unslashed zeros), Geist Mono for
  notation, Instrument Serif italic only for titles/empty states; one radius, spacing and motion scale.
- **Composition**: frameless instrument column (clock, turn tape, scramble, session) + a single solid
  control deck (ivory New Scramble, outlined Auto Solve, quiet Reset, physical keycaps); studio sweep
  backdrop; transport floats bottom-centre and the camera re-frames around it (no occlusion); tablet
  gets a two-column arrangement; 320 px bar shortens labels (accessible names unchanged); stacked
  toasts sit above the action bar.

## Problems found in this pass and fixed

1. Gesture ambiguity at grazing angles (cosine margin) → angular margin.
2. WebKit raised `Unexpected token '<'` in production: cubing.js first resolves its worker as
   `assets/search-worker-entry.js`, which the hashed build didn't contain → the entry chunk now keeps
   that stable name.
3. Touch devices on Auto rendered three passes per frame (≈ 10 fps under 4× CPU throttle) → new
   **medium** tier for coarse pointers (same materials, no shadow passes).
4. 320 px action bar pushed Redo off-screen → compact labels.
5. Celebration ring read as an overlay in stills → floor ripple.
6. Solved check ran three times per commit (≈ 0.25 ms each, orientation-insensitive) → reuse the
   engine's per-commit flag.

## Performance (measured, headless Chromium + RTX 3050 via ANGLE/D3D11)

- Desktop 1440×900, high tier, continuous turning: ≈ 55–57 fps, p95 16.8–33 ms.
- Phone emulation 390×844 at DPR 2.6 with **4× CPU throttle**: idle 57 fps; while turning ≈ 30 fps
  (medium and low tiers perform alike there — the remaining cost is per-commit React work and native
  WebGL/compositing, not shader effects).
- 300 consecutive face/slice turns: render == model; geometry/texture counts unchanged after three
  quality/finish rebuild cycles (no GPU resource leak).
- Bundle: three/R3F chunk ≈ 936 kB (≈ 267 kB gzip), lazy-loaded after the UI shell; no new runtime
  dependencies in this pass.

## Key files

| Concern | File |
| --- | --- |
| Notation, metrics | `src/core/puzzle/notation.ts` |
| Axis/layer/sign tables | `src/core/puzzle/geometry.ts` |
| Legality, centre arrangement | `src/core/puzzle/kpattern.ts` |
| Centre homing + verified solve | `src/core/solver/solver.ts` |
| Turn tape, STM, commit handling | `src/app/studio.ts`, `src/components/panels/MoveLog.tsx` |
| Gestures, hover | `src/components/cube/gestures.ts`, `hoverState.ts`, `HoverIndicator.tsx`, `src/components/stage/Interaction.tsx` |
| Physical cube | `src/components/cube/cubeResources.ts`, `CubeModel.tsx` |
| Lighting, tiers, framing | `src/components/stage/StageCanvas.tsx` |
| Design system | `src/styles/tokens.css`, `layout.css`, `components.css` |
| Worker bundling | `vite.config.ts` |
| Slice tests | `tests/unit/slices.test.ts`, `tests/e2e/slices.spec.ts`, `tests/e2e/stress.spec.ts` |

## Known limitations and trade-offs

- **Touch on physical devices is untested.** Touch was verified with Chromium's CDP touch emulation.
  That emulation swallows the first tap after a synthetic touch drag even on a bare page (documented
  artifact; the phone spec absorbs it with a tap on inert text). Real iOS/Android hardware is the next
  thing to test.
- Firefox and WebKit are covered by one smoke test each, not the full suite.
- Whole-cube rotations (`x y z`) and wide moves are not in the notation; Auto Solve uses slice turns to
  home centres instead of a rotation.
- Auto-solve solutions that start from displaced centres begin with up to three slice turns.
- The stable worker-entry filename is unhashed; on a deployed site, configure revalidation for it so a
  new deploy's entry isn't served from a stale cache (local use is unaffected).
- Throttled-phone turning frame rate (~30 fps) is limited by per-commit work; further gains would need
  reducing React work per commit (see next steps).
- Singles truncate and means round (WCA convention), so a one-solve session can show 0.33 vs 0.34.
- Not covered by automated tests: audible sound, clipboard copy, CSV download, browser fullscreen.

## Exact next action

Run `npm run test:e2e` on real devices (BrowserStack or a USB-connected Android with
`adb reverse tcp:4317 tcp:4317`, plus Safari on iOS) focusing on finger twists of middle strips and
the tap-after-drag behaviour, then merge `premium-slices-upgrade` into `main`.

Further improvements, in order: move per-commit store updates into one `setState` to cut React work;
instanced sticker meshes for low-end GPUs; full Playwright suite on Firefox/WebKit; optional
whole-cube rotations (`x y z`) once the camera/notation interplay is designed; visual-regression
snapshots of `artifacts/after/`.
