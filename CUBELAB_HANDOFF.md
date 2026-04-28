# CUBELAB — Handoff

Status (2026-10-13): eighth pass complete — **photoreal stickerless plastic** (its own studio
reflections, per-piece finish, parting line, lit honeycomb/track interior mid-turn) and **speedcube turn
audio** (synthesised sliding friction, rattle and magnetic snaps, driven by real turn motion and speed).
Seventh pass: the **Classic Stickered cube rebuilt as a premium GAN-style stickered cube** (moulded
glossy-black bodies, shaped stickers, honeycomb interior). Sixth pass: softly
domed ("pillowy") stickerless faces. Fifth pass: **two cube styles** (Classic Stickered, recovered from the
third pass, and Premium Stickerless, the default) on one shared puzzle state, switchable live from
Settings and persisted; the stickerless **corner pieces' inner corners** made crisp to match the GAN
references (centres and edges unchanged).
Earlier passes: stickerless GAN-style pieces (fourth), free-tumbling view and `x y z` rotations
(third), M / E / S slices and the premium redesign (second). This document is deliberately candid
about what was and was not verified.

## Repository state

- The folder had no Git repository; one was initialised for this pass.
  - `main` — `53229f6` *Baseline: CUBELAB v1* (the delivered v1, untouched).
  - `premium-slices-upgrade` (checked out) — second pass in three commits (slices, visual overhaul,
    hardening + docs) plus the third, fourth and fifth passes on top. Nothing is pushed anywhere; merge when happy
    (`git checkout main && git merge premium-slices-upgrade`).
- `.gitattributes` normalises line endings to LF.
- Screenshots: `artifacts/before/` (v1), `artifacts/after/` (current default style) and
  `artifacts/styles/` (both styles side by side, selector, live switch).

## Eighth pass — photoreal stickerless plastic + speedcube turn audio

Brief: make the Premium Stickerless cube as physically convincing as the stickered one (without
re-opening its geometry), keep the Classic Stickered look exactly, and replace the turn "click" with a
convincing speedcube sound — sliding plastic, rattle and magnetic snap, responsive to speed.

**Baseline (before any change, at `cd49a40`)**: typecheck ✓, lint ✓, unit 263/263 ✓, build ✓,
browser 31/31 ✓ (desktop 27, phone 2, Firefox 1, WebKit 1). Working tree clean.

### Why the stickerless cube looked less real (diagnosis from same-view screenshots)

1. Glossy coloured plastic shows its form through what it reflects; in the dark studio a domed face
   mirrors near-black, so every face rendered as one flat tone (the stickered cube hides this: its
   glossy black frame carries the reflections).
2. Mid-turn, the mechanism was black under full occlusion — a void.
3. Nothing marked where the coloured shell ends and the black body begins.
4. Every piece reflected identically.

### Stickerless changes (geometry unchanged — dome 0.018, rim 0.055, cuts 0.37 / 0.37 / 0.08)

- **Own reflection map** (`studioEnvironment.ts`, `STICKERLESS_REFLECTORS`; wired via
  `styleReflections.ts`): the same studio plus soft-edged reflector cards placed just above where the F
  and R faces mirror from the home view, and a dim scrim behind the camera. Each domed face now carries
  a soft highlight fading across it. Only the stickerless materials use it (`material.envMap`); the
  shared scene environment is untouched. An over-bright first version washed red to pink and was
  dialled back until colours stayed saturated.
- **Plastic**: broad satin sheen (roughness 0.26) under a sharp clear coat (0.78 / 0.07), reflections at
  1.0 of the dedicated map; matte keeps its satin values. **Per-piece variation**: a deterministic
  ±7 % roughness and ±20 % coat-roughness offset per piece (seeded once, never per render). **Waviness**:
  a very low-frequency bump (amplitude 0.0009) on the shell so highlight bands bend slightly differently
  on each piece. No scratches, noise or texture maps.
- **Shell and mechanism** (shader options, each behind its own define): the **parting line** where the
  coloured shell meets the black body (side walls, visible mid-turn); a charcoal (#17171a) interior with
  the **honeycomb** and a moulded **track** ring groove (radius 1.16 from the turning axis) on internal
  faces; and the **turn-driven exposure** already used by the stickered cube (seams and openings stay
  deep black while the cube is closed; the faces a turn exposes are lit while it is open). The low tier
  keeps only the parting line.
- Verified at the reference-style views: no new artifacts (the thin rim highlight seen under
  magnification exists identically in the before capture), colours saturated, low/medium/phone, matte
  and hover unaffected.

### Classic Stickered: protected

Same-state, same-camera captures before and after this pass are **pixel-identical in all 9 views**
(solved, scrambled, macro, R/M/E/S mid-turn, internals, upside-down; max channel difference 0). The
shared shader changes are compiled out for it (defines), and it uses the scene environment as before.

**Correction to the seventh pass**: its notes claim "stronger studio reflections (`envMapIntensity`
1.9)" for the black bodies. That setting never took effect — three.js uses `scene.environmentIntensity`
for any material that falls back to the scene environment. The no-op is removed (output unchanged,
proven by the pixel diff) and the option now documents when it applies.

### Turn audio (`src/core/audio/`)

**Baseline found**: one 60 ms decaying white-noise burst through a fixed 1.9 kHz band-pass, fired at
the commit (the end of the animation) for every manual/undo/redo/solver move; scramble moves silent.

**Sources — procedural, no recordings.** No speedcube recordings with clear provenance were available
in this environment (downloading sound packs or extracting audio from videos was not an option), so
every sound is synthesised from a small physical model (`synth.ts`), rendered once at start into a
sound bank (3 friction loops, 6 rattle pings, 8 snaps; deterministic seeds):
- *friction*: Poisson micro stick-slip impacts (1400/s, exponential strengths) plus a little noise,
  split across three slightly different banks of strongly damped plastic modes (1.1–9.6 kHz, τ
  0.9–2.6 ms) with a breath of broadband noise, high-passed at 300 Hz, soft-limited; seamless loops;
- *rattle*: short, bright modal pings (3–9 kHz, τ ≤ 3 ms);
- *snap*: a hard sub-millisecond contact into lighter-damped modes (0.56–8.7 kHz) plus a second,
  softer contact 2.5–5 ms later as the piece settles.

**Event flow.** The engine now emits motion events (`cubeEngine.ts`): `turn` when an animated turn
starts (move, source, duration, start/end angle, easing, from-drag), `drag` begin / move / release /
cancel for pointer twists, and the existing `commit`. The studio forwards every engine event to the
player (`studio.ts`); nothing else (camera, style, settings, React renders) reaches it. The pure
`TurnPlanner` (`turnPlanner.ts`) turns events into voices, and `VoiceExecutor` (`sound.ts`) schedules
them on the audio clock:
- **slide** from the turn's first frame for its whole duration, its level following the layer's
  actual angular speed along the easing curve (strongest early for snapping user turns, mid-turn for
  smooth playback), brightness (low-pass 1.7–6.8 kHz) and level rising with angular speed
  (`intensityOf`: 3 rad/s lazy → 22 rad/s flick);
- **rattle**: 0–2 quiet knocks, only on fast turns (a first version allowed 3 and averaged 2.5 per
  turn in fast sequences — busy over a long solve);
- **snap** at the commit — the instant the layer lands — louder and brighter for faster turns;
- **double turns** add a faint detent tick when the layer passes the intermediate quarter;
- **slices** a shade darker; **x y z rotations silent** (a re-grip in the hand);
- **drags**: a continuous friction voice follows the drag's smoothed (40 ms), clamped angular velocity
  and ticks faintly when dragged past a magnet; release hands the flick's speed to the release turn;
  cancel springs back with a soft slide and only a faint settle (≤ 0.07) — never a full snap;
- **instant turns** (reduced motion, skipped scramble): one compact sound, at most one per 50 ms, so a
  skipped scramble is one sound; scramble/solver playback are quieter (0.5 / 0.75);
- variation: random friction loop and offset, snap variant and ±3 % rate per turn.

**Mix & safety**: master gain = volume² → limiter (−10 dB, 12:1) → output; demo peak −7.6 dBFS at
70 %, no clipped samples. Voices are capped (24 soft: optional detail dropped; 40 hard: oldest slide
stopped), counted from their scheduled end on the audio clock — a first version counted until each
`ended` event, which arrives late on a busy main thread, and wrongly hit the cap in fast bursts
(peak 40 → now 3 for 40 rapid turns, nothing dropped). Nodes disconnect on end. The context is created
only when sound is enabled and resumed on the next pointer/key gesture; without Web Audio the player
is a silent no-op.

**Controls**: Sound on/off (header + Settings), **Volume** slider (persisted `soundVolume`, 0–1, default
0.7; old settings load at 0.7) and **Preview** (plays slow R, normal U, fast R U R' U', R2, M without
touching the cube).

**Listening — honest status**: I cannot hear audio in this environment. The sound was evaluated by
signal inspection only: offline renders of the demonstration through the real player code (Chromium
OfflineAudioContext), spectrograms, level/centroid measurements and automated checks. Measured (demo,
70 %): slide centroid 2.4 kHz (slow) → 3.4–3.6 kHz (fast), slide RMS 0.027 → 0.071, snaps 12–16 dB
above the slide level, M slice darker (2.7 kHz), spectral flatness of the friction 0.35 (noise-like,
not tonal; an earlier version had ringing bands and was fixed). Whether it *sounds* like a real cube
still needs a human ear: listen to `artifacts/audio/turn-demo.wav` or press Preview.

**If real recordings become available** (the better long-term source): a quiet room, a small-diaphragm
condenser 20–30 cm from a magnetic 3×3, 48 kHz/24-bit; per sample type 10–20 takes — slow, normal and
fast quarter turns, double turns, slices, isolated magnet snaps, light rattles — trimmed to the
transient, normalised to −6 dBFS peak, no reverb. The planner's voice kinds map one-to-one onto those
takes; only `toBuffers` would change from synthesis to decoding.

### Problems found in this pass and fixed

1. **Disposal vs background shader compile (latent since the fifth pass)**: the idle pre-warm uses
   three's `compileAsync`, which polls its materials until their programs are ready. A quality/finish
   change disposed those materials mid-poll and three threw `Cannot read properties of undefined
   (reading 'isReady')`. The longer-compiling stickerless variants widened the window enough for the
   stress spec to catch it. `CubeVisuals.trackCompile` now makes disposal wait for any in-flight
   compile (unit-tested, incl. a rejected compile; stress + style specs passed 3× in a row).
2. Voice counting by `ended` events (see Mix & safety) — now by scheduled end time.
3. Tonal friction (ringing modal bands) in the first synthesis — spread over three jittered banks with
   shorter decays plus broadband noise; friction peaks soft-limited below 1.
4. The stickered `envMapIntensity` no-op (see above).

### Tests added

- `tests/unit/audio.test.ts` (25): synthesis (determinism, finiteness, no clipping, friction is
  noise-like not tonal, seamless loop, sharp snap onset and fast decay); planner (slide from first frame
  / snap at landing, speed → level & brightness, envelope follows easing, rattles only on fast turns,
  double-turn detent, slices darker, rotations silent, source levels, instant batch → one sound, drag
  smoothing and clamp, cancel never snaps, flick hand-over, replace stops all, 300-turn stress);
  player against a fake Web Audio context (no context until enabled, mute, voice caps and release,
  volume clamp and squaring, suspended resume, missing Web Audio, preview, determinism).
- `tests/unit/studio.test.ts` (+7): the player sees turn/undo/redo starts and landings, drag phases,
  cancel without commit, instant-scramble commits only; nothing from style/settings/preview or view
  tumbling; sound settings persistence and sanitising.
- `tests/unit/styles.test.ts` (+5): stickerless defines per tier vs stickered (honeycomb only, no
  per-material reflection strength), stable per-piece variation within bounds, reflection map and
  shared exposure; disposal waits for an in-flight compile (and still happens if it fails).
- `tests/e2e/audio.spec.ts` (3): real click enables audio (context running); one slide + one snap per
  turn; rotations, tumbling, style switch and mute silent; Preview plays without touching the cube; a
  40-key burst sounds once per accepted turn, stays bounded and releases every voice; the offline demo
  render never clips, the slide is audible, fast turns are louder and brighter than slow.

### Verification (final tree)

`npm run test:all`: typecheck ✓, lint ✓, unit **300 / 300** ✓ (13 files), build ✓, browser **34 / 34** ✓
(Chromium desktop 30 incl. the new 3-test `audio.spec.ts`, phone emulation 2, Firefox smoke 1, WebKit
smoke 1). Touch is Chromium emulation, not a physical phone.

### Browser coverage and performance

- Chromium (desktop + phone emulation): everything above. Firefox (ad-hoc): both styles render, live
  audio context runs, one slide + one snap per turn, offline demo renders; no errors. Playwright's
  Windows WebKit build has **no Web Audio API at all** — the player stays silent and nothing breaks
  (verified); audio in real Safari is untested.
- Frame time while turning continuously (RTX 3050, ANGLE/D3D11, high tier): stickerless sound off /
  on and stickered sound on — median 16.7 ms, p95 ≤ 16.8 ms (vsync-bound) in all three. Enabling sound
  (click → context running, including rendering the sound bank once): 0.2–0.35 s. During 60 rapid turns:
  peak 8 voices, none dropped. Stickered resource counts unchanged; stickerless adds one reflection map
  (256² PMREM on high, 128² otherwise).

### Artifacts

- `artifacts/stickerless-realism/before/` and `after/` — same views, same scramble: solved, scrambled,
  macro, R/M/E/S mid-turn, internals close-up, upside-down.
- `artifacts/styles/` regenerated (both styles, incl. low tier, desktop and mobile UI; selector with
  the new stickerless preview); `artifacts/after/` regenerated.
- `artifacts/audio/turn-demo.wav` (3.3 s) and `turn-demo-spectrogram.png`; regenerate the WAV with
  `node scripts/render-audio-demo.mjs` (needs `npm run preview`).

### Audio demonstration procedure

1. `npm run dev`, open http://localhost:5317, click the speaker icon (top right) to enable sound.
2. Settings → Display & sound → **Preview**: slow R, normal U, fast R U R' U', R2, M.
3. On the cube: a slow drag of R (friction follows your finger, snap on landing), a normal `u`, a fast
   `r u R U` (Shift = prime), `Shift+F` then `f` held, a double via the Move Pad, `m`, then Auto Solve.
4. Drag a layer part-way and let go before it commits: a soft spring-back, no snap.

## Seventh pass — Classic Stickered as a premium GAN-style stickered cube

Brief: the Classic Stickered cube looked plain next to three supplied product photos of a black-plastic
GAN stickered speedcube (GAN 356 style); make it substantially more realistic. Where brief and photos
differed, the photos won (e.g. the brief's "raised tiles" vs the photos' thin vinyl stickers).

What the photos show, and the old model lacked: stickers shaped like their piece (round centres,
D-shaped edges, near-square corners) instead of identical rounded squares; a thin, even black border;
glossy black with a soft sheen on flat areas and bright lines on the rolled rims; rounded outer cube
edges; a moulded honeycomb on the internal faces seen mid-turn; nothing reading as a flat black void.

**Geometry** (`stickeredResources.ts`, `pieceGeometry.ts`):
- Bodies are now moulded pieces from the same SDF mesher as the stickerless cube, with their own design
  `STICKERED_SHAPE` (`PieceShape` added so one mesher serves both): inner cuts centre 0.48 / edge 0.40 /
  corner 0.08, rim roll 0.07, flat faces (no dome), outer cube rounding 0.095 (stickerless 0.075).
  Meshes are shared through the reference-counted cache now in `pieceMeshes.ts`, keyed by design.
- Stickers: thin (0.009) extrusions of the piece's own outline inset by a 0.088 black border, with
  0.003 rounded edges, laid flat with a hand-laid in-plane rotation < 0.3° and offset < 0.0025. Nine
  outlines cover the cube (one centre, four edge and four corner orientations). A test checks every
  point under every sticker is solid body (no floating edges at the rounded cube edge).

**Materials** (`pieceMaterial.ts` options; stickerless defaults unchanged):
- Body: the piece shader with every cap black. Broad sheen (roughness 0.30) under a sharp clear coat
  (0.85 / 0.06), so flat black reads as polished plastic and the rims carry bright lines. (These notes
  originally also listed `envMapIntensity` 1.9; that never took effect — see the eighth pass.) Interior a deep charcoal (#1a1a1e) with a
  procedural **honeycomb** on internal faces (bump-mapped in the shader, no textures, high/medium tiers).
- **Turn-driven occlusion**: closed, seams stay fully shaded (no glints on any tier); while a layer is
  part-way round, a shared `uExposure` uniform (|sin 2θ| of the turn in flight, set each frame from
  the engine) eases the seam/cavity shading so the faces the turn exposes are lit and show their form.
- Stickers: vinyl, a touch less glossy than the body (roughness 0.24, coat 0.55), four print batches
  per colour. The old orange-peel normal maps and roughness textures are gone (no textures at all).

**Lighting**: unchanged studio; the black bodies' stronger reflection is a material setting, so the
stickerless cube is untouched — verified pixel-identical to the previous build (max channel
difference 0 on the solved capture).

**Architecture**: no change to the dual-style system. New shared modules `pieceFrames.ts` (piece
frames + facelet frames/outline masks, used by stickers and the hover outline) and `pieceMeshes.ts`;
`CubeVisuals.setTurnExposure` forwards the turn exposure; the hover ring traces each sticker's shape.

**Screenshots**: `artifacts/styles/stickered/` (solved, scrambled, macro, midturn-R, midturn-M,
upside-down, quality-low, desktop, mobile), the selector shots with the new preview, and
`artifacts/after/` (default style, refreshed).

**Verification**: typecheck ✓, lint ✓, unit **263 / 263** ✓, build ✓, browser **31 / 31** ✓ (desktop 27, phone emulation 2, Firefox 1, WebKit 1; the stickered style was also checked by hand in Firefox and WebKit: renders, turns, live-switches, render == model, no errors); style matrix and
screenshots regenerated with no console warnings or errors. Frame time while turning on the stickered
style (high tier): median 16.7 ms, p95 16.7 ms. Tests added (`styles.test.ts`): sticker outlines per
kind, stickers inside the rims and fully seated, design parameters (and stickerless parameters pinned),
honeycomb + exposure wiring with stickerless uniform defaults pinned, resource ownership with shared
body meshes.

**Limitations**: no logo cap on the white centre (deliberate); the honeycomb is a shading detail, not
modelled geometry, and is off on the low tier; the internal mechanism has no modelled core arms.

## Sixth pass — pillowy stickerless faces

User feedback: the stickerless faces looked very flat; they should be ever so slightly more pillowy,
close to a supplied product photo of a stickerless speedcube with softly domed faces.

Cause: the "pillow" was a plateau — 0.0045 of lift reached within 0.22 of each edge and flat across
the rest of the face — so every face rendered as one flat tone. Changes (`pieceGeometry.ts`, stickerless
only; Classic Stickered untouched):
- **Dome**: each face is now a smooth dome, `PILLOW` 0.018 high in the middle (≈ 0.3 mm on a 19 mm
  piece), falling to exactly zero at every seam (`facePillow`: product of two `1 − t²` profiles across
  the face). Smooth everywhere — a dome built from distance-to-outline would crease along the
  diagonals and break the reflections — and zero at the seams, so it never grows into a neighbour.
- **Edge roll**: the seam rim fillet `RIM_RADIUS` 0.03 → 0.055, so each face rolls softly into its seam
  like the reference; the plan-view corners between pieces follow (0.055). Corner pieces' crisp inner
  corner (0.08) and the 0.37 arcs of centres and edges are unchanged, as are the exterior rounding,
  caps, colours and lighting.
- The hover outline is draped over the dome (its vertices follow `facePillow`) instead of floating flat
  at the peak.
- Look-dev: 0.012 / 0.045 was tried first — better but still flatter than the photo — then 0.018 /
  0.055, compared side by side with the photo; checked mid-turn, upside down, Low tier, phone (no seam
  glints) and the hover outline. Frame time unchanged (16.7 ms).
- Tests (`pieces.test.ts`, +3): the dome peaks at `PILLOW` and falls monotonically; no crease across the
  diagonals (a distance-based dome fails this by 10×); seam walls stay inside the cell at every depth
  for every piece kind.
- Verification: typecheck ✓, lint ✓, unit **259 / 259** ✓, build ✓, browser **31 / 31** ✓ (desktop 27,
  phone emulation 2, Firefox 1, WebKit 1); `artifacts/styles/` (incl. the new Settings preview) and
  `artifacts/after/` regenerated with no console warnings or errors.

## Fifth pass — two cube styles + precision GAN corners

Brief: let users choose between the earlier **Classic Stickered** cube and the current **Premium
Stickerless** one (state-preserving, persisted, premium selector), and correct the stickerless pieces'
inner-facing corners, which the user circled as too round ("melted") against the GAN reference photos.

**Baseline (before any change, at `9825bf2`)**: typecheck ✓, lint ✓, unit 238/238 ✓, build ✓,
browser 26/26 ✓ (desktop 22, phone 2, Firefox 1, WebKit 1). Working tree clean.

### Where the Classic Stickered model came from

`65bf5ff` (third pass) is the last commit with the stickered cube: rounded black bodies, raised
bevelled tiles with an orange-peel coat, four moulding variants per colour and per-tile seats (tilt
< 0.5°, offset < 0.0035). Its geometry, materials, procedural textures and seats were recovered from
that commit's `cubeResources.ts` / `CubeModel.tsx` into `src/components/cube/stickeredResources.ts`
— no revert; the seats are generated with the same seed in the same order, so the tiles sit exactly
where they did. It is lit by today's studio and uses today's palette (very close to the old one).

### Architecture (one state, two models)

- One puzzle state, one `CubeEngine`, one set of 26 cubie groups in `CubeModel.tsx` whose transforms
  are rebuilt every frame from the engine (committed state + turn in flight). A style only decides
  what hangs on each group: `StickeredPiece` (body + tiles) or `StickerlessPiece` (one moulded mesh).
- Because the groups and their transforms are untouched by a style change, switching is safe at any
  moment, including mid-turn: the new model appears on the same groups in the same pose on the next
  frame. No queueing is needed; a dedicated test switches during slow solver playback (moves in
  flight) and during inspection.
- Interaction is model-independent: twists hit-test an analytic cube in cube coordinates, and the
  render read-back uses invisible per-facelet anchors at the face plane (`ANCHOR_OFFSET`), present
  in both styles. The hover outline follows the style (`HoverState` stores the facelet, piece kind and
  cut mask; `HoverIndicator` draws the tile ring or the exact stickerless outline at that style's
  surface).
- `CubeVisuals` (`cubeResources.ts`) owns all GPU resources for one tier + finish: each style's set is
  created on first use and kept until the tier/finish changes or the stage unmounts. Stickerless piece
  meshes (~80 ms to build) are cached CPU-side and reference-counted, so their GPU buffers are freed
  when no set uses them and they re-upload on next use without rebuilding.
- At idle after the stage settles, `useWarmOtherStyle` builds the hidden style's resources and
  compiles its shaders with `compileAsync` on a staging scene (nothing visible, nothing uploaded):
  the first switch went from ~790 ms to ~50 ms to paint.
- Setting: `cubeStyle: 'stickerless' | 'stickered'` in the existing versioned settings
  (`settings.ts`), default Stickerless. Settings saved before this pass have no field and load as
  Stickerless with every other preference intact; unknown/corrupt values fall back to Stickerless. No
  storage version bump was needed; history is untouched.
- The studio controller never sees the style: `updateSettings` only saves it, so the timer, attempt,
  inspection, move log, undo/redo, solver and history cannot be affected — asserted in unit tests by
  snapshotting all of them across 25 switches mid-attempt.

### Selector

Settings → Cube → **Cube style**: two cards (Classic Stickered — "Black-frame cube with raised coloured
tiles."; Premium Stickerless — "Modern speedcube with moulded coloured plastic.") in a native radio
group (arrow keys, focus ring, screen-reader names). Previews are renders of the real models with a
transparent background (`scripts/capture-style-previews.mjs` → `src/assets/cube-styles/*.webp`,
13–17 KB each), so no extra WebGL renderers run in Settings. Selected = ivory border and filled mark.
A quick switch next to the cube was considered and left out: the stage corner already holds the view
controls, and the choice is a set-and-forget preference.

### Stickerless inner corners (the circled areas) — corner pieces only

The fourth pass cut every outline corner that points at the face centre with the same circular arc of
radius 0.37, so the corner pieces' inner corner was scooped like an edge's. In the GAN photos the
edges keep that large round end and the centre its round cap, but a corner piece's inner corner is
crisp and nearly square. Now (`pieceGeometry.ts`, `INNER_RADIUS`):
- **corner pieces**: inner-corner radius 0.37 → **0.08** (circular). Along the diagonal the cut now
  reaches 0.033 instead of 0.153, so the corner keeps its colour almost to the lattice point;
- **centres and edges: unchanged** (0.37 circular arc — the same SDF maths as `9825bf2`);
- exterior rounding (0.075), seam fillets (0.03), pillow, caps and colour are unchanged. Each black
  opening is now framed by three rounded pieces and one crisp corner, as in the reference.

Correction log: the first version of this pass also re-cut the centres (0.40) and edges (0.27) and
switched every inner cut to a superellipse. The user pointed out that only the corner pieces were
meant to change, so centres and edges were restored exactly and the superellipse code removed. The
face-on before/after (corner 0.37 vs 0.08, everything else identical) was captured at the same view
as the user's annotation to confirm.

### Tests added

- `tests/unit/pieces.test.ts` (+): measured cut depth per kind — centres and edges must keep the
  0.37 arc (cut 0.153 along the diagonal), corner pieces must stay crisp (cut < 0.05, > 0.015); openings are real geometry (all four pieces clear of
  the lattice point); mesh validity (finite data, indices in range, zero inverted triangles).
- `tests/unit/styles.test.ts` (new): default/migration/corruption/round trip of `cubeStyle`; every
  stickered tile seated on the right face of the right cubie, tilt < 0.0085 rad; disposal of every
  stickered resource; reference-counted stickerless meshes (shared, freed only by the last user,
  idempotent dispose); tier detail ordering.
- `tests/unit/studio.test.ts` (+4): switching during a running attempt with undo/redo history (25
  switches, full session snapshot unchanged, then redo/turn/auto-solve), during inspection, during
  solver playback, and persistence across reload with history intact.
- `tests/e2e/cube-style.spec.ts` (new, 5): default + switch + reload persistence; the exact user
  scenario (scramble, R U M E' x2 F2, tumble, switch, compare cube/timer/log/view/solver, keep turning,
  switch back, auto-solve); drags, slices, rotations, Move Pad and undo on the stickered model with
  render == model; switching during inspection and during slow solver playback; **100 switches** with
  geometry/texture/program counts identical after warm-up.

### Visual comparison

`artifacts/styles/` (new): `stickered/` and `stickerless/` each hold `solved`, `scrambled`, `macro`,
`midturn-R`, `midturn-M`, `upside-down`, `quality-low`, `desktop`, `mobile`; plus
`selector-{desktop,mobile}-{stickered,stickerless}.png` and `switch-1-stickerless.png` /
`switch-2-stickered.png` (same scrambled session before and after a live switch). `artifacts/after/`
was refreshed (default style, refined corners). Regenerate with `node scripts/capture-style-matrix.mjs`.

### Performance (RTX 3050, ANGLE/D3D11, 1440×900)

Continuous face/slice/rotation turning: both styles, high and low tier, median 16.7 ms, p95 ≤ 16.8 ms
(vsync-bound 60 fps). Switch latency (click → new model painted): ~40–50 ms warm and, with the idle
pre-warm, ~50 ms for the first switch. GPU counts across three rounds of Low/Auto + Matte/Gloss +
style switches return exactly to baseline (8 geometries, 10 textures, 8 programs).

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

Windows 11, Node 22.19.0, run in this directory on the final tree of the fifth pass
(`npm run test:all`, ~5 min end to end):

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm test` | **256 / 256** passed, 12 files (new: `styles.test.ts`; extended: `pieces.test.ts`, `studio.test.ts`) |
| `npm run build` | pass |
| `npm run test:e2e` | **31 / 31** passed (3.2 min): Chromium desktop 1440×900 (27, incl. the new 5-test `cube-style.spec.ts`), Chromium phone 390×844 touch emulation (2), Firefox smoke (1), WebKit smoke (1) |
| Ad-hoc Firefox + WebKit, Classic Stickered | renders, turns (`R M x U'`), live-switches both ways; render == model; no console errors |
| `npm run screenshots` | 28 captures in `artifacts/after/`; no console warnings or errors |
| `node scripts/capture-style-matrix.mjs` | 18 per-style captures + selector + live-switch shots in `artifacts/styles/`; render == model after the switch; no console warnings or errors |
| Frame time, both styles, high + low tier, continuous turning | median 16.7 ms, p95 ≤ 16.8 ms (vsync-bound) |
| GPU resources, 100 switches (e2e) and 3 rounds of tier/finish/style changes | identical counts after warm-up |

The Firefox/WebKit Playwright projects run the smoke spec only (default style); the stickered model
was checked in both engines with the ad-hoc script above. Touch is Chromium's emulation, not a
physical phone. (Earlier passes: 238 / 26, 223 / 26, 178 / 23.)

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
| Shared cubie model + style switch + pre-warm | `src/components/cube/CubeModel.tsx` |
| Style resource owner (`CubeVisuals`), surfaces | `src/components/cube/cubeResources.ts` |
| Classic Stickered model (bodies, stickers, materials) | `src/components/cube/stickeredResources.ts` |
| Piece/facelet frames, shared mesh cache | `src/components/cube/pieceFrames.ts`, `pieceMeshes.ts` |
| Premium Stickerless resources, piece frames | `src/components/cube/stickerlessResources.ts` |
| Piece shapes (SDF + mesher, inner cuts) | `src/components/cube/pieceGeometry.ts` |
| Stickerless material (caps, cavity, seams) | `src/components/cube/pieceMaterial.ts` |
| Cube style setting | `src/core/persistence/settings.ts` |
| Style selector | `src/components/panels/CubeStylePicker.tsx`, `SettingsDialog.tsx`, `src/assets/cube-styles/` |
| Free view (trackball) | `src/components/stage/orbitRig.ts` |
| Studio environment (IBL) | `src/components/stage/studioEnvironment.ts` |
| Lighting, tiers, framing, cube frame | `src/components/stage/StageCanvas.tsx` |
| Design system | `src/styles/tokens.css`, `layout.css`, `components.css` |
| Worker bundling | `vite.config.ts` |
| Slice tests | `tests/unit/slices.test.ts`, `tests/e2e/slices.spec.ts`, `tests/e2e/stress.spec.ts` |
| Rotation / free-view tests | `tests/unit/rotations.test.ts`, `tests/unit/gestures.test.ts`, `tests/e2e/rotations.spec.ts` |
| Piece geometry / material tests | `tests/unit/pieces.test.ts` |
| Cube style tests | `tests/unit/styles.test.ts`, `tests/unit/studio.test.ts`, `tests/e2e/cube-style.spec.ts` |
| Turn audio: synthesis, planner, Web Audio player | `src/core/audio/synth.ts`, `turnPlanner.ts`, `sound.ts` |
| Engine motion events (turn start, drag, commit) | `src/core/engine/cubeEngine.ts` |
| Stickerless reflection map, reflector cards | `src/components/stage/studioEnvironment.ts`, `src/components/cube/styleReflections.ts` |
| Audio tests | `tests/unit/audio.test.ts`, `tests/unit/studio.test.ts`, `tests/e2e/audio.spec.ts` |

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
- Cube styles: the switch is an immediate swap (no crossfade — a blend would need both models drawn
  at once, with doubled draw calls). The style previews in Settings are static renders: re-run
  `scripts/capture-style-previews.mjs` after visual changes to either model. Both styles share one
  palette and one studio; per-style lighting was not needed.

## Exact next action

Run `npm run test:e2e` on real devices (BrowserStack or a USB-connected Android with
`adb reverse tcp:4317 tcp:4317`, plus Safari on iOS) focusing on finger twists of middle strips and
the tap-after-drag behaviour, then merge `premium-slices-upgrade` into `main`.

Further improvements, in order: move per-commit store updates into one `setState` to cut React work;
modelled black internals (core arms, honeycomb) for close mid-turn views; full Playwright suite on
Firefox/WebKit; a "settle upright" option for the trackball; visual-regression snapshots of
`artifacts/after/`.
