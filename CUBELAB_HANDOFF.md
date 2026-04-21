# CUBELAB — Handoff

Status (2026-10-12): fourth pass complete — the cube is now a **stickerless GAN-style speedcube**
(moulded pieces with the characteristic rounded cuts, coloured plastic caps over black mechanism,
glossy UV-coat materials). Earlier passes: free-tumbling view and `x y z` rotations (third), M / E / S
slices and the premium redesign (second). This document is deliberately candid about what was and was
not verified.

## Repository state

- The folder had no Git repository; one was initialised for this pass.
  - `main` — `53229f6` *Baseline: CUBELAB v1* (the delivered v1, untouched).
  - `premium-slices-upgrade` (checked out) — second pass in three commits (slices, visual overhaul,
    hardening + docs) plus the third and fourth passes on top. Nothing is pushed anywhere; merge when happy
    (`git checkout main && git merge premium-slices-upgrade`).
- `.gitattributes` normalises line endings to LF.
- Screenshots: `artifacts/before/` (v1) and `artifacts/after/` (this pass).

## Fourth pass — stickerless GAN-style cube

Brief: make the 3D cube read as a premium stickerless GAN-style speedcube, using four supplied product
photos as the reference (where the written brief and the photos differed, the photos won: flatter
faces and crisper edges than "softly inflated"). No branding copied; nothing else in the app changed
behaviour.

**Geometry** (`src/components/cube/pieceGeometry.ts`, new). The old model was a rounded box per
cubie with flat raised tiles on top. Pieces are now solid moulded parts defined by signed distance
fields and meshed once per tier:
- Each visible face is a *rounded extrusion* of that face's 2D outline; the piece is the intersection
  of its faces' extrusions, plain planes on hidden sides, and one rounded box over the whole cube.
- Outline corners that point at the face centre get the large GAN cut (radius 0.37 of a 1.0 cell):
  the centre is a rounded "coin", edges have two cuts, corners one, so a small four-pointed black
  opening shows the mechanism at every diagonal, as in the photos.
- Seam rims have a tight 0.03 fillet (seams read as thin dark grooves); the cube's own edges and
  corners are rounded 0.075 as a whole (soft silhouette, spherical corners); faces are pillowed by
  0.0045 toward their middle; seams are 0.014.
- Meshing: a grid on a slightly larger box (sin-spaced, dense at the box edges where the fillets are)
  is projected radially onto the surface (the solid is star-shaped about the piece centre) with an
  Illinois root finder; normals come from the SDF gradient, so shading is smooth at any tessellation.
  Three canonical shapes (corner, edge, centre) are built per tier — 40 / 30 / 24 grid cells per box
  face (19.2k / 10.8k / 6.9k triangles per piece) — about 80 ms for all three at the high tier — and
  each cubie shows its kind turned to its home pose (`PIECE_FRAMES` in `cubeResources.ts`).

**Materials** (`src/components/cube/pieceMaterial.ts`, new). Colour is the plastic, so it is decided
per fragment, not baked into a mesh or sticker: each visible face has a coloured cap 0.13 deep and
everything deeper is black mechanism plastic; where two caps meet on a cube edge the one the point is
further into wins, so colours meet on the edge's 45° line like two-shot moulding. Boundaries are
anti-aliased with screen-space derivatives. On top of `MeshPhysicalMaterial`: glossy UV-coat
(roughness 0.2, clear coat 0.6 at 0.1) or satin matte; black internals satin (0.34) with a thinner
coat; a faint low-frequency roughness drift; a *cavity* term (light falls off with depth below the
nearest visible face, reflections less than diffuse) so the diagonal openings and the insides exposed
mid-turn read as deep mechanism rather than lit grey or a flat void; and a *seam* term (surfaces
facing into a neighbouring piece's cell are shaded by it) so seams stay dark and never sparkle, even on
tiers without shadow maps. Palette retuned to bright stickerless plastics (`colors.ts`; the Move Pad
swatches and 2D fallback follow). Per-tile tilt/variants from the third pass are gone (a moulded
stickerless part has no separate tiles).

**Lighting** (`studioEnvironment.ts`, `StageCanvas.tsx`). Same studio, rebalanced for brighter
plastics: a larger, brighter right-side strip and stronger right fill and sky fill, so shadow-side
orange stays orange and white stays neutral; the two bounce cards that the front and right faces
mirror are larger and brighter, so big faces carry a soft gradient reflection instead of flat colour.

**Other**: facelet read-back now uses invisible per-facelet anchors riding on the cubie groups (same
verification strength as before); face letters sit on the anchors; the hover outline traces the
hovered piece's real outline (round on centres). Medium/low tiers keep the same look minus shadow maps.

**Screenshots to inspect** (`artifacts/after/`): `cube-solved.png` (solved, home view),
`cube-macro.png` (close-up: miters, seams, openings), `cube-midturn-R.png` (face move part-way),
`cube-midturn-M.png` / `-E` / `-S` (slices part-way), `cube-white-down.png` (tumbled, white to the
floor), plus `desktop-1440-*.png` and `mobile-*.png` for the page.

**Look-dev log**: iterated on real GPU captures. First pass was too soft and inflated (fillet 0.055,
pillow 0.009) and the diagonal openings showed lit coloured walls → crisper seams, separate cube-edge
rounding, flatter faces, thinner caps, stronger cavity. Shadow-side orange went brown and white grey →
more right fill. Medium/low tiers showed specular sparkles in the seams (no shadow maps) → the seam
term.

**Remaining limitations of the look**: the black mechanism is plain (no modelled internals or the
honeycomb texture some GAN cubes show), so very deep looks mid-turn read as smooth black; the cap/body
split is a shading boundary on a single solid, not a separate modelled cap; on the medium tier a
hairline glint can survive at the diagonal openings at phone pixel densities.

## Third pass — free view, x/y/z rotations, realism, no logo

User feedback on v2: the cube did not look realistic enough, it should carry no logo, and it could not
be turned so that white faces down.

**Why white could not face down.** The camera was a turntable: a fixed world-up vector and the polar
angle clamped to [0.16, π − 0.16] rad. The view could never pass over a pole, so U always stayed in
the upper half of the screen. Nothing in the notation offered a re-grip either.

**Free view** (`src/components/stage/orbitRig.ts`): the view is now a quaternion trackball with no
fixed up. Drags rotate about the screen's own axes (the cube follows the pointer); keep dragging and
it rolls over. Arrow keys nudge about the same axes; `C` slerps home. The stage applies the view by
turning the **cube** inside a fixed studio (camera, lights, floor fixed) rather than flying the camera,
so lighting stays physically plausible upside down: lights from above, shadow on the floor (the floor
drops under a corner-down cube), reflections moving across the tiles. Ray hit tests are carried into
cube coordinates and projections back out; `visualFacelets()` reads stickers relative to the cube root,
so render-equals-model checks are view-independent. `camera()` now also reports `up` (y < 0 = U at the
bottom of the screen).

**Whole-cube rotations** `x y z` (like R, U, F) are first-class moves end to end: notation/parser,
axis tables (`layer: null` = all 26 cubies), cubie model, KPattern (cubing.js's own transformations),
engine animation, undo/redo, persistence, share links, keyboard `X Y Z` (+Shift, both layouts), and a
**Rotate** bank on the Move Pad. Moves name positions: after `x2` yellow is on top and `U` turns it
(`x2 U ≡ D x2`, tested). Rotations count 0 in STM/HTM/QTM, never start the clock, are allowed during
spacebar inspection (blocked only while scrambling or while the solver drives the cube) and show dimmed
in the turn tape. Zen moved from `Z` to `` ` ``.

**Solver after rotations/slices** (`src/core/solver/solver.ts`): candidates (a) ≤ 3 slice turns that
solve outright (depth-limited search, so `M2 E' S` returns its inverse), (b) slice-home the centres then
solve (canonical orientation), (c) solve in the held frame ρ and relabel each face turn as ρ·m·ρ⁻¹
(verified by transformation equality, not a table). Shortest wins, ties go to canonical. So `x2 R U'`
solves in 2 turns with yellow staying on top, a lone `M` returns `M'`, and every solution is verified.
Consequence: after mixed scrambles the cube may end solved in another orientation when that is
shorter; tests assert "solved in some orientation" there.

**No logo**: the pad-printed mark on the white centre (mesh, texture, material) is removed.

**Realism** (`cubeResources.ts`, `CubeModel.tsx`, `src/components/stage/studioEnvironment.ts`):
- Image-based lighting from a small photographic studio built in code and prefiltered once with PMREM
  (dark graded cyclorama; overhead softbox; a strip box placed so its edge crosses the top face's
  mirror direction from the home view — half the top face carries a soft reflection; key and rim
  strips; fill card; bounce cards where the F and R faces mirror). Replaces drei's Lightformer rig;
  fill lights reduced so reflections, not lamps, shape the faces.
- Tiles: fine orange-peel normal map under a smooth clear coat (gloss) or satin texture (matte), mottled
  roughness, four deterministic moulding variants per colour (±tone, ±sheen); each tile seated with a
  deterministic tilt < 0.5° and offset < 0.004 so neighbours catch reflections differently.
- Body plastic: frosted grain normal map, lower roughness and a thin coat, so piece roundovers carry
  soft edge highlights instead of reading as flat black.
- Look-dev was iterated on real GPU screenshots (hero, macro, tumbled): first pass of the orange-peel
  map was far too coarse (crumpled-foil look) and was reduced ~3× in strength and ~2× in scale; the
  back bounce card was lowered after it greyed the R-face reds.

**Problems found in this pass and fixed**
1. GPU leak on render-tier changes: drei's `ContactShadows` never frees its plane geometry or its two
   render targets, so remounting it on every Low ↔ Auto switch leaked +1 geometry and +2 textures per
   cycle (measured 4 → 8 geometries, 10 → 16 textures over three cycles; the stress spec caught it —
   in v2 the old Lightformer environment's own geometries had masked the count). It is now mounted
   once and switched off (`visible`, `frames = 0`) below the high tier: counts stay flat.
2. The first dual-candidate solver could answer `M2 E' S` with a longer outer-face solve ending
   rotated, because its single centre-homing path was not the one that undoes the slices → the direct
   ≤ 3-slice search (candidate a above).
3. The React Compiler lint rejected mutating ref props inside `useFrame` → the per-frame cube/floor
   posing lives in a module-level helper.

## Baseline before the second pass (recorded first)

`npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` 119/119 ✓ · `npm run build` ✓ ·
`npm run test:e2e` 15/15 ✓. No pre-existing failures.

## Verification after changes

Windows 11, Node 22.19.0, run in this directory on the final tree of the fourth pass:

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm test` | **238 / 238** passed, 11 files (new: `pieces.test.ts` — frames/colour slots, SDF and mesh invariants, hover outline, shader hooks) |
| `npm run build` | pass |
| `npm run test:e2e` | **26 / 26** passed (5.2 min): Chromium desktop 1440×900 (22), Chromium phone 390×844 touch (2), Firefox smoke (1), WebKit smoke (1) |
| `npm run screenshots` | 28 captures in `artifacts/after/` (new: `cube-solved`, `cube-midturn-R`); no console warnings or errors |
| Frame time, desktop high tier, continuous face + slice turns | median 16.7 ms, p95 16.8 ms (vsync-bound 60 fps) |

The first full gate of this pass had one failure: the no-WebGL spec hard-coded the old green; the 2D
net was correctly showing the new palette. The spec now derives the expected colour from
`FACE_COLORS`, and the complete browser suite was re-run green. Firefox and WebKit ran the real WebGL
stage with rendered facelets equal to the model. (Earlier passes: 223 / 26, 178 / 23.)

## M / E / S — representation and guarantees

- **Notation** (`src/core/puzzle/notation.ts`): nine families `U D L R F B M E S`; `Move = { family,
  turns }`. M turns like L, E like D, S like F. (Rotations `x y z` were added in the third pass;
  wide moves are still rejected.)
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
  the plastic, dark core, pad-printed mark on the white centre cap (removed in the third pass), calibrated colours; neutral studio
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
| Piece shapes (SDF + mesher) | `src/components/cube/pieceGeometry.ts` |
| Stickerless material (caps, cavity, seams) | `src/components/cube/pieceMaterial.ts` |
| Physical cube (resources, frames, model) | `src/components/cube/cubeResources.ts`, `CubeModel.tsx` |
| Free view (trackball) | `src/components/stage/orbitRig.ts` |
| Studio environment (IBL) | `src/components/stage/studioEnvironment.ts` |
| Lighting, tiers, framing, cube frame | `src/components/stage/StageCanvas.tsx` |
| Design system | `src/styles/tokens.css`, `layout.css`, `components.css` |
| Worker bundling | `vite.config.ts` |
| Slice tests | `tests/unit/slices.test.ts`, `tests/e2e/slices.spec.ts`, `tests/e2e/stress.spec.ts` |
| Rotation / free-view tests | `tests/unit/rotations.test.ts`, `tests/unit/gestures.test.ts`, `tests/e2e/rotations.spec.ts` |
| Piece geometry / material tests | `tests/unit/pieces.test.ts` |

## Known limitations and trade-offs

- **Touch on physical devices is untested.** Touch was verified with Chromium's CDP touch emulation.
  That emulation swallows the first tap after a synthetic touch drag even on a bare page (documented
  artifact; the phone spec absorbs it with a tap on inert text). Real iOS/Android hardware is the next
  thing to test.
- Firefox and WebKit are covered by one smoke test each, not the full suite.
- Wide moves (`Rw`, `r`…) are not in the notation.
- After mixed scrambles with displaced centres, Auto Solve may finish in a different (still solved)
  orientation when that is shorter; it never inserts rotations into a solution.
- The trackball accumulates roll by design (it is a free tumble); `C` returns to the upright home view.
- The tumble moves the cube, not the camera, so the studio lighting is tuned for the home view; other
  views are physically consistent but not individually art-directed.
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
modelled black internals (core arms, honeycomb) for close mid-turn views; full Playwright suite on
Firefox/WebKit; a "settle upright" option for the trackball; visual-regression snapshots of
`artifacts/after/`.
