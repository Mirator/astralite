# Plan 007: Reveal occluded actors through a small local architecture cutaway

> Executor: read this entire file before editing. It is self-contained and does
> not require the original conversation. Implement only this plan. Follow the
> numerical starting values; tune only within the stated ranges. Record actual
> visual checks as well as test results. A passing counter is not proof of good art.
>
> Planned against commit `cc6fb85`, 2026-09-21. These are proposed designs,
> not implemented or runtime-validated changes.

## Repository contract and verification

- Repository root: `C:/Users/Miroslav Pavelek/Documents/astralite`; application:
  `game/`. Paths below are relative to the repository root.
- React 19 + Three.js on vinext/Vite; Node >=22.13. Run package commands from
  `game/`, never the repository root. PowerShell syntax is used below.
- Read `AGENTS.md`, `docs/art-direction.md`, and `game/tests/README.md`.
  Edit the dense `dungeon-game.tsx` locally without reformatting it.
  Keep `dungeon-floor.ts` and `dungeon-combat.ts` free of rendering dependencies.
- No new dependency, downloaded asset, postprocessing pipeline, persistent HUD,
  gameplay rule, camera angle, or palette redesign. Do not alter threat,
  healing, stair, or weapon-pickup semantics to accommodate decoration.
- Work on a `codex/` branch only if a branch is needed; no commit, push, PR,
  merge, deployment, or workflow trigger is authorized by this plan.
- Before editing, run `git status --short` and the drift check below from root.
  Preserve unrelated edits. Read live symbols, not just line numbers.
  Changes explicitly produced by another plan in 004–008 are expected:
  reconcile its documented interface and keep its tests. Stop for an unexplained
  behavioral mismatch; do not overwrite earlier work to match an old excerpt.
- Append results to `game/progress.md`; update only this plan's status in
  `plans/README.md`. Historical `output/` is read-only.

All commands below run from `game/`, unless explicitly marked root.
Each must exit 0; test commands must report no failures or unexpected skips.

| Gate | Command |
| --- | --- |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Node rules and graphics units | `npm test` |
| Browser, ordinary local run | `$env:GAME_TEST_GL='d3d11'; npm run test:browser` |
| Production | `npm run build` |
| Whitespace, from root | `git diff --check` |

The suite starts its own server; use a free `GAME_TEST_PORT` if 3000 is occupied.
Do not kill an unrelated process. Chromium must already be available; missing
runtime/dependencies are setup blockers, not an excuse to delete tests.
Run existing focused tests before editing to establish the baseline, then the
new focused tests while iterating. At the end run all gates once.

### Visual evidence and budgets

- New browser specs import `test, expect` and helpers from `./helpers`.
  Use `game.enter()`, `game.floor()`, `game.teleport(x,z)`,
  `game.configureCombat(...)`, `game.step(ms, draw)`, and real key input.
  `teleport` sets position/mood but does not itself settle the camera.
  Advance a documented fixed time before every comparison.
- `advanceTime(0)` enters manual time. Zero-time draws must not animate effects.
  `game.capture(name)` only writes when `GAME_TEST_CAPTURE=1`, using
  `testInfo.outputPath`, and attaches the PNG to the report.
- Put NEW captures in ignored `game/test-results/graphics-NNN-before/` and
  `graphics-NNN-after/` via Playwright `--output`. Never overwrite `output/`.
  Use identical seed, scene, time, viewport, DPR, and renderer for before/after.
  Set `$env:GAME_TEST_CAPTURE='1'` and remove `GAME_TEST_GL` for comparable
  SwiftShader art captures; restore d3d11 and remove CAPTURE for ordinary tests.
  Do not compare local GPU images numerically with historical SwiftShader images.
- Desktop: 1000x700. Also review 390x844 using an isolated mobile context
  (`test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })`).
  Review full frames at native size; close-ups supplement them.
- Preserve `art-direction.spec.ts` measured color/contrast tests. Framebuffer
  measurements must draw and read pixels synchronously inside one page evaluate;
  the renderer does not use `preserveDrawingBuffer`.
- Preserve `frame-budget.spec.ts` ceilings: flooded hall 439 calls / 198818
  triangles; junction 502 / 343716; strike contact 447 / 236196. These are
  GLOBAL ceilings, not extra allowance for each plan. Do not raise or weaken
  them. First remove redundant work inside this feature; if still over, report
  the measured shortfall and leave the plan BLOCKED.
- Pooled tests compare the entire reset snapshot. Restore new state in
  `dungeonTest.reset` / floor cleanup. Never widen `DRIFTS`.
  Use `GAME_TEST_ISOLATE=1` only to diagnose contamination, not hide it.

## Status and purpose

- Priority P2; effort L (2–4 days, including a shader prototype); risk MED/HIGH.
- Depends on: none technically. Execute after 004–006 so geometry is stable.
- Original recommendation: 4, readable actors behind near architecture.
- Chosen solution: a small camera-facing dithered cutaway in the actual opaque
  obstruction. Do NOT implement a permanent through-wall character outline.
  This makes a definite choice between the audit's two proposed approaches.

## Current state and anchors

`dungeon-art.ts:17–21` and its callers constrain height relative to a room
center, not the moving actor:

```ts
export const headroom = (a: number, b: number, clear = 1.05) => {
  const base = screenUp(a, b);
  return base >= 0 ? Infinity : (-clear - base) / RISE;
};
// in addCarvedArchitecture:
const near = headroom(tx - room.x * TILE, tz - room.z * TILE);
```

`dungeon-atmosphere.ts:111–115` similarly sizes pillars relative to the center.
Existing near architecture intentionally adds depth; do not lower it all again.
`dungeon-game.tsx:1044–1045` creates the depth-tested threat cue and faint
depth-free ghost. Preserve both, their colors, timings, and opacity.
Camera tracks actor focus and is updated at lines 1796–1801.
Materials use `weatherStone` in `dungeon-motion.ts:109–190`, with custom
shader hooks and cache keys. A naive `material.clone()` loses those hooks.

Locally installed Three source confirms `<project_vertex>` computes
`mvPosition` AFTER instancing, then `gl_Position`. Use that position for
the cutaway; do not calculate it from raw untransformed vertex coordinates.
These are internal shader anchors: explicitly validate their existence on upgrades.

## Scope and drift check

Modify only:
- NEW `game/app/dungeon-occlusion.ts` (controller, uniforms, material wrapper).
- `game/app/dungeon-art.ts`, `game/app/dungeon-atmosphere.ts`: mark eligible
  architecture meshes at creation; no new geometry or layout.
- `game/app/dungeon-game.tsx`: register floor architecture, update view uniforms,
  clear/dispose/reset, dev diagnostics.
- NEW `game/tests/dungeon-occlusion.test.ts`,
  `game/tests/browser/occlusion.spec.ts`.
- `game/tests/browser/helpers.ts`: typed read-only diagnostics and a narrow,
  development-only fixture toggle if needed for framebuffer A/B.
- `docs/art-direction.md`, `game/progress.md`, index row.

Root: `git diff --stat cc6fb85..HEAD -- game/app/dungeon-art.ts game/app/dungeon-atmosphere.ts game/app/dungeon-game.tsx game/app/dungeon-occlusion.ts game/tests docs/art-direction.md`.
Do not edit combat rules, awareness, walls/collisions, camera offset/zoom,
renderer pipeline, lights, threat ghost, character rigs, or permanent UI.

## Visual and activation specification

- Cutaway is spatial: only obstruction pixels in front of a relevant actor,
  inside a small ellipse, and above the walking surface can disappear.
  Clear-control scenes with no eligible architecture inside the actor window
  must be pixel-identical with the feature enabled/disabled. The window includes
  a small margin around the body; an obstruction in that margin can be cut even
  if it only grazes the character silhouette. Do not claim silhouette-perfect
  detection or add a separate full-scene raycast to approximate it.
- Three fixed slots maximum: player, then at most two nearest alive, visible,
  awake enemies in the active room within 4 world units of the player.
  An enemy is eligible only while windup>0 or during its actual attack release.
  Read the existing enemy state machine to identify release; an idle guard,
  corpse, dormant ambush, or neighbor-room enemy never opens a window.
- Player slot remains at full strength while playing. Enemy slots fade in over
  0.10 s, out over 0.16 s; stable identity/index ordering prevents flicker when
  equal-distance enemies swap. Targets stay attached to their actors during fade.
  Death, hidden state or room change clears enemy slot immediately.
- Starting ellipse in CAMERA VIEW world units: player radii (0.68,1.05), centered
  at world body y+0.9; guard/stalker (0.65,1.0), warden (0.92,1.35), centered
  at y+1.0 / y+1.25 respectively. Tune radii only +/-15% after mobile review.
  The window contains head and torso, not the entire swing or floor cue.
- Maximum 90% pixel removal at ellipse center; 0 outside the ellipse. Smooth
  spatial edge from elliptical radius 0.65 to 1.0. Use a fixed 4x4 Bayer
  screen-pixel threshold, no temporal noise, shimmer, white edge or added glow.
- Keep depthTest/depthWrite enabled and material opaque. Discard pixels, do not
  set whole-material opacity or switch to transparent sorting.
- Do not cut a fragment if world y<=0.18 or if it is behind the target.
  Front-depth gap must be >=0.10 and <=6.0 world units. This stops distant
  structures being erased along a long view ray.
- Eligible: opaque pillar shafts/caps, high wall masonry, carved gate spans and
  near buttresses. Exclude floor tops, foundations, water, cloth, foliage,
  braziers/flames, props used as pickups, characters, bars and telegraphs.
- Keep shadow rendering solid: camera cutaway is a readability device, not a
  physical hole that should suddenly move the room's shadows.
- No extra rendering pass, cloned character, render target, full-screen shader,
  per-frame raycast over the entire floor or extra draw calls.

## Implementation steps

### 1. Prove the shader in a bounded prototype

Before integrating, capture one actual pillar-occluded player/enemy and an
unobstructed control at 1000x700 and 390x844. Find legal positions using floor
props/cells and `canStand`; do not assume room-center fixtures are occluded.
A narrow dev fixture can list registered obstruction bounds for test setup;
do not expose full renderer objects to production.

Create controller API equivalent to:

```ts
register(mesh: THREE.Mesh): void;
update(camera, targets, dt): void;
clear(): void;
dispose(): void;
```

Keep fixed uniform storage for three centers/radii/strengths, allocated once.
Hook the standard material vertex shader AFTER `#include <project_vertex>`:
store `mvPosition.xyz` in a varying; compute world y using a shared uniform
camera.matrixWorld multiplied by mvPosition. mvPosition already includes
instance transforms. Fragment shader computes elliptical view-space distance
and positive eye-depth gap; apply discard after clipping and before final color.
Use unique shader symbols: `cutawayViewPosition`, `cutawayWorldY`,
`uCutawayCameraWorld`, `uCutawayCenters[3]`, `uCutawayRadii[3]`, and
`uCutawayStrengths[3]`. Declare `uCutawayCameraWorld` explicitly as a mat4 in
the vertex shader and install it in `shader.uniforms`; it is NOT a built-in
Three uniform and `camera.matrixWorld` is not a GLSL identifier. Keep one
`{ value: new THREE.Matrix4() }` holder and copy the current camera.matrixWorld
into it after camera matrix updates. The injected vertex assignments are:

```glsl
cutawayViewPosition = mvPosition.xyz;
cutawayWorldY = (uCutawayCameraWorld * mvPosition).y;
```

All relevant varyings must be declared in both stages. Never reuse/redeclare
`stoneWorld` from weatherStone. Verify each anchor appears exactly once before
replacement; a missing/duplicate anchor is a compilation-prototype failure.

For clarity, view z is negative in front of the camera. Compute:
`fragmentDepth = -viewPosition.z`,
`targetDepth = -targetView.z`,
`gap = targetDepth - fragmentDepth`.
Cut only when 0.10<=gap<=6.0. Do not compare nonlinear gl_FragCoord.z with
linear world/view units. Combine overlapping target cut strengths with max,
not sum; overlap must never remove more than 90%.

**Verify:** `node --experimental-strip-types --test tests/dungeon-occlusion.test.ts`.
Test view/depth math, behind-target rejection, ellipse limits, overlap bound,
three-slot capacity and stable target identity. Then `npm run typecheck`.
Unit tests do not validate GLSL: require an actual WebGL compilation and
before/after pixels in step 3 before proceeding to polish.

### 2. Register materials without losing weathering or color updates

At creation, mark only eligible meshes with one explicit tag, e.g.
`userData.cameraOccluder=true`. Do not identify geometry by color, dimensions,
or class names. Register once after floor assembly, never traverse every frame.

Create one cutaway material variant per original material, shared by every
eligible mesh using that original. Preserve the source `onBeforeCompile`
explicitly and call it first; append your injection afterward. Compose the
source `customProgramCacheKey` with a stable version suffix such as
`|actor-cutaway-v1`. Never let uniform values enter the program cache key.
Do not assume `clone()` copies callbacks.
Capture the two original functions BEFORE installing the wrapper. Call the
captured hook exactly once per compilation, then inject the uniquely prefixed
cutaway code; do not wrap a material that is already a variant. For example:

```ts
const priorCompile = source.onBeforeCompile;
const priorKey = source.customProgramCacheKey.bind(source);
variant.onBeforeCompile = (shader, renderer) => {
  priorCompile.call(variant, shader, renderer);
  // install shared uniforms, validate anchors, append cutaway code once
};
variant.customProgramCacheKey = () => priorKey() + '|actor-cutaway-v1';
```

Atmosphere updates the original material colors each frame. Keep a small
source->variant table and synchronize the actual animated color/emissive and
other changed scalar properties after atmosphere updates, without invoking
Material.copy or creating materials each frame. Reuse original textures.
Do not apply cutaway to the source itself when an excluded object shares it.

After camera lookAt, call its matrix update before transforming target centers;
update uniforms on zero-time draws too, without aging fades. Resize and camera
shake must naturally use the current matrix. Use simulation dt for fades so
pause/hitstop freeze them. An unchanged timestamp produces unchanged pixels.
Keep shadow/depth materials unmodified; do not assign cutaway customDepthMaterial.

Floor replacement clears targets, releases variant mappings and references.
Assign one explicit disposer for variants: restore original materials before
controller disposal so the floor traversal cannot retain disposed variants.
Do not dispose source textures shared with the rest of the scene.
Maintain an explicit registration table of `{ mesh, originalMaterial,
variantMaterial }`, accepting Mesh and InstancedMesh and preserving any material
array structure. `clear()` resets slots only; `releaseFloor()` restores every
registered mesh material, disposes each unique variant once, and clears both
registration/cache tables. Add releaseFloor to the controller API above.
Call it FIRST in clearFloor, before atmosphere.dispose and floorGroup traversal;
call it before final scene traversal on unmount too. Actual topology is
`addAtmosphere(floorGroup,floor) -> addCarvedArchitecture(world,floor)`, where
the callee's parameter named world is the same floorGroup. Do not relocate
architecture or treat this parameter name as proof it lives outside the floor.

**Verify:** units cover hook composition, one variant per source, synchronized
color, clear/dispose and no stale target references. Run types/lint and
`$env:GAME_TEST_GL='d3d11'; npm run test:browser -- art-direction.spec.ts frame-budget.spec.ts polish.spec.ts`.
Draw calls/triangles should be unchanged, although shader CPU/GPU time must also
be measured manually in representative scenes.

### 3. Test real occlusion and unchanged clear views

Create `occlusion.spec.ts`. Use fixed seeds and legal positions from real
pillar/wall geometry; park other enemies using configureCombat. Add a tightly
scoped dev-only enable/disable control solely for same-frame pixel comparison,
default enabled, restored by reset, absent from production. Typed diagnostics
report actual target IDs, radii, strengths, registered material count, and
projected target bounds. They must not substitute for pixel verification.

In one evaluate: draw disabled and copy framebuffer; draw enabled at the same
time and copy framebuffer. Compare masks:
- Occluded head/torso region has changed pixels.
- Pixels outside the union of expanded target ellipses are unchanged (allow
  <=1 channel value for copying/rounding, not a broad percentage of the frame).
- Unobstructed control has no changed pixels under the same tolerance.
- Ground-only control stays unchanged.
- Instanced wall and ordinary pillar both work; camera-aspect changes work.
- Idle/dormant/dead/neighbor-room enemies alone never add target slots.
- Three simultaneous threats never allocate more than two enemy slots.
- Paused/zero-time drawings match; moving away closes the effect; restart,
  teleport, floor rebuild and pooled reset remove stale target IDs.
- Existing telegraph contrast remains above its unchanged thresholds.

**Verify:** `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- occlusion.spec.ts art-direction.spec.ts frame-budget.spec.ts`.
Use `--repeat-each=3` for the new spec after the first pass to expose target
selection instability. Do not weaken the outside-window assertion to mask
uniform leakage.

### 4. Visual review and performance decision

**Capture:** `Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue; $env:GAME_TEST_CAPTURE='1'; npm run test:browser -- occlusion.spec.ts --output=test-results/graphics-007-after`.
Baseline captured before edits under `test-results/graphics-007-before`;
the dev A/B in the final test also supplies a same-build comparison.

Review player behind pillar, warden windup behind wall, movement across its edge,
two overlapping windows, clear doorway, pause and mobile. Keep stone recognizable
around the small opening. Reject glass-like whole walls, a large circular hole
covering the fight, flickering checkerboards, disappearing floors or flattened
shadows. Measure median same-scene update/draw CPU times after warmup on d3d11;
record values as diagnostics, not flaky wall-clock CI assertions.
A consistent >10% frame-time regression is a STOP for design review even when
draw counters pass. Run full gates and document the shader contract.

## Specific acceptance and maintenance

- Actual pixel A/B proves the window helps and changes nothing outside its scope.
- No new passes/draws, no uniform state shared incorrectly across materials.
- All original weatherStone behavior and theme transitions remain visible.
- Solid shadow maps, intact floor depth, readable threat cues.
- Stop if there is no reliable insertion point for shader composition, if
  instancing uses incorrect transforms, or if a whole-wall fade is needed.
- Three upgrades must revalidate shader anchors and material-copy behavior.
  Adding a new tall architecture type must explicitly opt it into registration.

## Copyable pre-edit capture command

Run from `game/` before implementation. This uses only already-existing specs:

```powershell
Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue
$env:GAME_TEST_CAPTURE='1'
npm run test:browser -- art-direction.spec.ts shots.spec.ts --output=test-results/graphics-007-before
Remove-Item Env:GAME_TEST_CAPTURE -ErrorAction SilentlyContinue
$env:GAME_TEST_GL='d3d11'
```

Keep these artifacts until the corresponding after-set has been reviewed.
Additional new fixtures may be staged before the production edits, but do not
invoke a new feature-dependent assertion as if it were an existing baseline.

## Completion and stop rules

- [ ] All commands in the gate table pass; new targeted tests pass.
- [ ] Before/after and mobile captures were opened and inspected, not just saved.
- [ ] No palette/telegraph regression; existing frame ceilings are unchanged.
- [ ] Repeated identical-seed floor rebuilds settle at the same geometry/texture
      counts after warmup; no monotonically growing buffers or materials.
- [ ] Zero-time redraw, pause, teleport, restart, and floor replacement behave as
      specified; pooled reset comparison passes with unchanged `DRIFTS`.
- [ ] `git status --short` contains no unexpected source changes or tracked
      generated files. Preserve any pre-existing edits.
- [ ] Progress log records tests, render counts, capture locations, visual verdict,
      and remaining limitations; index status is updated accurately.

Stop and report if a source assumption has unexplained drift, a required change
falls outside Scope, a gate remains broken after two focused repair attempts,
or the feature requires gameplay changes, budget increases, new dependencies,
or a different renderer. A pre-existing failure must be recorded separately;
do not label the implementation fully verified while a required gate is red.
