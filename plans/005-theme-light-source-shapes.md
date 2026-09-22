# Plan 005: Give witchfire, flame and bioluminescence distinct forms

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

- Priority P2; effort M (1–2 days including captures); risk LOW/MED.
- Depends on: none technically; execute after 004 to avoid overlapping edits.
- Original recommendation: 2, physically distinct light sources.
- Result: witchfire, ordinary flame, and bioluminescence differ in silhouette
  and rhythm while retaining the established violet/orange/cyan palette.

## Current state and anchors

`game/app/dungeon-atmosphere.ts:31–38` creates shared prop geometry:

```ts
const keep = <T extends THREE.BufferGeometry>(geometry: T) => {
  geometry.userData.shared = true; return geometry;
};
const PROP = {
  // ...
  flame: keep(new THREE.OctahedronGeometry(.24)),
};
```

At lines 89–93 every brazier gets a body, smaller core, and halo.
At line 318 every body gets the same motion:

```ts
flames.forEach((f,i)=>{
  f.scale.set(.9+Math.sin(t*7+i)*.1,1.65+Math.sin(t*9+i)*.3,.85);
  f.rotation.y=t+i;
});
```

Lines 281–290 update shared body/core colors from the current chamber's
`fire`; core is only 18% toward white so halos do not wash the hue out.
`dungeon-game.tsx:1397–1401` controls existing torch light flicker.
Do not alter light intensity/count or the shared mood transition in this plan.
The geometry used by a brazier can be chosen from its owning `p.room` even
while the existing palette continues to follow the player's chamber.

## Scope and drift check

Modify only:
- `game/app/dungeon-atmosphere.ts`.
- NEW `game/app/dungeon-flame.ts` (geometry and deterministic poses).
- NEW `game/tests/dungeon-flame.test.ts`,
  `game/tests/browser/theme-flames.spec.ts`.
- `game/app/dungeon-game.tsx`, `game/tests/browser/helpers.ts` only for
  compact actual-render diagnostics, if required.
- `docs/art-direction.md`, `game/progress.md`, index row.

Root: `git diff --stat cc6fb85..HEAD -- game/app/dungeon-atmosphere.ts game/app/dungeon-flame.ts game/app/dungeon-game.tsx game/tests docs/art-direction.md`.
No edits to bowls, room generation, shader tone mapping, light budget,
weapon/impact effects, threat colors, or global motion settings.

## Visual specification

Use the SAME two meshes per source (body and core), the same halo, and the same
six ember slots. Build three geometries, not three extra layers per fire.
Each body/core geometry has at most 8 triangles, matching the old octahedron.
No new texture, point light, additive full-screen effect or dynamic allocation.

Dimensions in the table are the FINAL world-space envelope after animation;
do not multiply a 0.24-radius model by these as if they were raw scale factors.

| Family | Rest envelope width x height x depth | Silhouette | Motion |
| --- | --- | --- | --- |
| keep | 0.32 x 0.85 x 0.30 | One narrow, asymmetric diamond/flame, tip slightly offset; visibly suspended above the bowl | Slow vertical breathing +/-5%, bob +/-0.025 at 0.65 Hz; no continuous full rotation |
| ruins | 0.50 x 0.65 x 0.35 | Two connected-looking unequal tongues, one roughly 65% the height of the other; construct two closed tetrahedra in one mesh | Height +/-12%, tip sway +/-0.05 at mixed 1.7 and 2.9 Hz; motion is irregular-looking but deterministic |
| flooded | 0.52 x 0.38 x 0.43 | Low broad faceted organic bud with an off-center peak, resting in the bowl; no tall flame tip | Width +/-4%, height +/-6% at 0.45 Hz; no vertical shooting or spin |

- Source base remains above the bowl/rim, never below y=1.03. Preserve existing
  lamp position and halo center unless a <=0.1 vertical correction is necessary
  to align the visible body. No detached core or hovering halo unrelated to body.
  Start body centers at y=1.52 (keep), 1.43 (ruins), and 1.28 (flooded); the old
  universal y=1.33 would let the taller profile penetrate its bowl. Include
  breathing and bob extrema when checking the y=1.03 minimum.
- Violet witchfire is restrained and vertical; orange flame is lively and forked;
  cyan growth is low and slow. Distinguish them without relying on hue.
- Retain `ROOM_MOOD.fire`, body `toneMapped:false`, and core's current hue.
  Core is approximately 45–55% body width, at most 65% its height; it must not
  completely fill the body or create a white cap.
- Halo may shrink to match each profile (never exceed its current 2.7x3.5
  footprint or existing peak opacity). Do not enlarge glow to fake volume.
- Keep 6 particle slots/source. Reuse their buffers: rising embers for ruins,
  slow vertical drift for keep, short local motes for flooded. Fewer visible
  flooded motes are fine; no additional draw call.
- Use time in seconds and explicitly convert Hz to angular phase with 2*PI.
  Seeded phase per source avoids synchronized breathing. No `Math.random()`
  during animation.
- At 1000x700, the flooded profile should be noticeably wider than tall and keep
  noticeably taller than wide. Check the visible core/body union, not halo size.

## Implementation steps

### 1. Baseline and bounded geometry/pose module

Capture existing three themes with seed 0x1 at 640 ms, then 0/150/300/600 ms
offsets. Run existing art direction/frame budget specs before editing.

Create `dungeon-flame.ts`. Export a three-geometry factory and a pure
`flamePose(theme, time, phase)` calculation, or equivalent clear functions.
Use floor-owned geometry, with a lazy cache keyed by theme inside each atmosphere
instance. Create a geometry only when that theme has a brazier, then attach it
to every body/core of that theme. Remove the unused shared `PROP.flame` entry;
do not introduce a module-global replacement cache. New geometries are NOT
marked shared and are released by floorGroup traversal on rebuild/unmount.
The local cache must not survive that atmosphere instance. Unit tests may create
all three geometries and explicitly dispose them after asserting their bounds.

Build all eight faces with finite vertices, correct outward winding and normals.
For two tongues, merge the two tetrahedra into one BufferGeometry; do not use
groups with different materials, which would add draws.
Pose accepts absolute time so repeated calls at the same time cannot drift.

**Verify:** `node --experimental-strip-types --test tests/dungeon-flame.test.ts`.
Assert <=8 triangles, valid bounds at sampled phases, three distinct aspect
profiles, stable repeated time, phase variation, and no geometry allocation in
pose evaluation. `npm run typecheck` must pass.

### 2. Attach owning theme and replace common animation

Change `flames` into records of mesh, core, owning theme and phase (or use
typed companion arrays). Resolve theme from `floor.rooms[p.room]`; do not infer
it from fire RGB or the current camera room. Keep torchPositions order intact:
lighting and ember indexing depend on it.

Replace only the common scale/rotation update with the theme pose. Apply core
local scale once, then let it inherit the body pose. Update the existing ember
buffer by the same records; no new materials per source.
Use the same `t` passed into atmosphere update; pause and zero-time redraw remain
frozen. If reduced motion is extended later, this module should accept a motion
amplitude rather than reading browser settings itself; do not add that setting now.

**Verify:** `npm run typecheck`, `npm run lint`, and flame units.
Run `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- art-direction.spec.ts frame-budget.spec.ts polish.spec.ts`.
No extra body/core draws or triangles, no hue/contrast regression.

### 3. Integration and lifecycle regressions

Create `theme-flames.spec.ts` with seed 0x1 and actual rooms of all three themes.
Use the art spec's room selection strategy (rooms containing braziers), settle
640 ms, and capture four phases. If a diagnostic is needed, expose theme, actual
body/core bounds and source counts from attached meshes, not just config values.

Assert two meshes per body/core pair and unchanged source count. Same phase and
zero-time redraw give unchanged transforms. Pausing freezes source poses.
A transition to another room changes the existing light mood but never swaps
an old brazier's geometry to the new room's theme.
Pinned-seed rebuild after all three shapes were drawn has stable resources.

**Verify:** `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- theme-flames.spec.ts art-direction.spec.ts frame-budget.spec.ts polish.spec.ts`.

### 4. Readability review and completion

**Capture:** `Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue; $env:GAME_TEST_CAPTURE='1'; npm run test:browser -- theme-flames.spec.ts art-direction.spec.ts --output=test-results/graphics-005-after`.
Before-source baseline: existing art spec, same flags, output
`test-results/graphics-005-before`.

Inspect full scene and body crop, all themes, desktop/mobile, idle and warden
windup. Reject white washed-out sources, three profiles that still look like
spinning crystals, or a growing cyan bud that resembles a healing pickup.
Run the unchanged chroma, lightness and telegraph measurements.
Document the profiles and their scale/time units; run the full gate table.

## Specific acceptance and maintenance

- Three distinct geometry silhouettes AND three different pose rhythms.
- <=8 triangles/body or core and <=2 body/core draws per source.
- Existing shared light count, ownership/order and shader color tests preserved.
- Existing halo and ember allocations remain bounded and reusable.
- Sample pose bounds over at least 10 seconds; no source intersects its bowl.
- Review phase sheets; static geometry unit tests alone cannot validate the motion.
- Future theme additions must define both geometry and motion explicitly.
  Stop if the geometry needs extra light sources or the budget can only pass by
  suppressing source visibility in the budget scenes.

## Copyable pre-edit capture command

Run from `game/` before implementation. This uses only already-existing specs:

```powershell
Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue
$env:GAME_TEST_CAPTURE='1'
npm run test:browser -- art-direction.spec.ts --output=test-results/graphics-005-before
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
