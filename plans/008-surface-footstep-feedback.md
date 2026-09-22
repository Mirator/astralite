# Plan 008: Add restrained surface feedback at real foot contacts

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

- Priority P3; effort M (1–2 days including lifecycle tests); risk LOW/MED.
- Depends on: none technically; recommended after 004–007 for cumulative budget
  verification and settled-paving integration.
- Original recommendation: 5, visually connect footsteps to the surface.
- Result: restrained contact puffs on dusty stone and tiny drops from wet boots,
  emitted only when a real step occurs. The effect supports weight and material.

## Current state and anchors

`game/app/dungeon-game.tsx:1526–1533` already derives footsteps from REAL
displacement, not input or elapsed time:

```ts
const groundSpeed=dashTime<=0&&dt>0?travelled/dt:0;
gaitSpeed=THREE.MathUtils.damp(gaitSpeed,groundSpeed,14,dt);
const previousPhase=walkPhase;
if(groundSpeed>.05)walkPhase+=travelled*strideRate(gaitSpeed);
if(Math.floor((previousPhase+Math.PI/2)/Math.PI)!==Math.floor((walkPhase+Math.PI/2)/Math.PI))audio.play('step');
locomotion=playerRunPose(walkPhase,gaitSpeed);
```

`dungeon-run-pose.ts` explicitly states one cycle contains two footfalls.
`dungeon-game.tsx:148–156` creates each hip/knee/boot, but does not retain a
named boot reference. Add one if needed; do not search the scene every frame.
Existing `burst` at line 686 creates Mesh/material instances per emission:
DO NOT reuse that allocation pattern for frequent footsteps.
Use the bounded-lifetime pattern of `impactEffects` and its
`game/tests/dungeon-impact.test.ts`, but implement this as a single batch.
`clearFloor` at 804–812 and `dungeonTest.teleport/reset` at 1828/1843 are
explicit cleanup boundaries.

Water is BELOW the walkway (around y=-2.8); flooded-theme stone is not a
walkable water plane. Do not emit circular water ripples on solid paving or
pretend the actor stands in the sea.

## Scope and drift check

Modify only:
- NEW `game/app/dungeon-footsteps.ts` (bounded graphical pool).
- NEW `game/app/dungeon-footstep-rules.ts` (pure contact/material selection).
- `game/app/dungeon-surface.ts` and `game/tests/dungeon-surface.test.ts`:
  reuse 006's support interface; create it here only when 006 is not installed,
  using the self-contained contract below. Do not create a competing lookup.
- `game/app/dungeon-game.tsx`: retain boot anchors, emit after leg posing,
  update/clear/dispose, compact diagnostics.
- `game/app/dungeon-art.ts`: only add `walkingSurface` tags to motif meshes if
  implementing standalone before 004/006; do not change their geometry/materials.
- NEW `game/tests/dungeon-footstep-rules.test.ts`,
  `game/tests/dungeon-footsteps.test.ts`,
  `game/tests/browser/footsteps.spec.ts`.
- `game/tests/browser/helpers.ts` diagnostics typing only;
  `docs/art-direction.md`, `game/progress.md`, index row.

Root: `git diff --stat cc6fb85..HEAD -- game/app/dungeon-game.tsx game/app/dungeon-art.ts game/app/dungeon-footsteps.ts game/app/dungeon-footstep-rules.ts game/app/dungeon-surface.ts game/tests docs/art-direction.md`.
No changes to movement speed, strideRate, footstep audio timing, damage,
dash effects, player leg poses, water shader, room generator or stored settings.

## Visual specification

| Surface | Emission per contact | Size and lifetime | Behavior |
| --- | --- | --- | --- |
| keep stone | 1–2 faint cool-gray dust flecks | 0.035–0.08 world-unit diameter, 0.18–0.25 s | Small sideways spreading, height <=0.10 |
| ruins stone | 2–3 muted ochre-gray flecks | 0.05–0.12 diameter, 0.22–0.32 s | Brief low puff, height <=0.16, never a smoke cloud |
| flooded stone | 2–3 desaturated gray-cyan droplets | width 0.02–0.035, length 0.04–0.075, 0.16–0.24 s | Short ballistic flick from the boot, peak height <=0.15; disappear on landing |
| wood or unknown support | none in this iteration | — | No dust from bridges; no invented wood splinters |

- Classification is explicit theme/material feedback: flooded rooms suggest
  moisture carried by boots, not simulated puddle depth. For corridors use
  `roomByCell` when present, otherwise nearest chamber, matching the existing
  material selection; wood always wins. Never classify from current global mood
  alone, which can still be blending while a boot is on another surface.
- Dust starts at the planted foot's world x/z and support y+0.015.
  Brightness stays close to the support material, with normal blending,
  no emission, no additive flash, no hard ring. Start alpha 0.12–0.22 for dust,
  0.20–0.30 for droplets; fade smoothly to zero.
- Particles remain within 0.35 of their contact point and below ankle height.
  No camera-facing cloud over the knight's torso or red attack cue.
- Real stance anchor: take boot world position AFTER pose and matrix updates,
  project to the support top for the visual contact. Do not emit at hip height.
  If the boot is outside a valid stone support tile, skip that contact.
- Use alternating feet associated with the existing phase crossing. Do not add
  extra footsteps when a frame is subdivided, the game pauses, a wall blocks
  movement, or a dash moves the body.
- Max 32 simultaneously live particles, one rendering batch, zero draw calls
  when empty. No extra light or texture. Evict oldest particles on overflow.
- In reduced-motion mode use one small fleck/drop with <=0.12 s life and <=0.03
  travel, keeping some surface feedback. Do not modify the setting or its defaults.

## Implementation steps

### 1. Isolate event and support rules without changing locomotion

Capture a short real-input walk on stone and wood before editing.
Create pure rules that map the EXISTING previousPhase/currentPhase crossing
to a side and event serial, then choose surface from the support cell.
Use the same integer threshold `floor((phase+PI/2)/PI)`.
Preserve the existing audio event exactly; do not retime it to a new animation.
For ordinary subdivided game updates at most one contact should occur.
For unusually large deltas, enumerate only actual crossings with a small cap
(e.g. 2) and no unbounded catch-up burst. Reset event serial on restart.

Retain the boot under `hip.userData.boot` (or typed rig reference) at construction.
Queue the contact event when phase crosses; resolve the boot world point only
after leg/player transforms are updated. This prevents using the previous frame's
boot transform. Tie side mapping to the actual rig; inspect four directions
rather than guessing which phase means the left leg.

Use `cellKey(Math.round(x/TILE), Math.round(z/TILE))`, matching canStand's point
conversion in dungeon-floor.ts:200. Do not use floor, truncation or a custom
negative-coordinate rule. The collision radius remains canStand's concern.
Sample the actual top, including existing groove/dish/settled geometry; a fixed
y=0.02 fallback would already be wrong before 006. Reuse or introduce this exact
pure contract in dungeon-surface.ts:

```ts
type SurfaceHit = { cell: string; y: number; theme: 'keep'|'ruins'|'flooded'; wood: boolean };
// surfaceCell(x,z), buildSurfaceIndex(triangleRecords,cellMetadata),
// sampleSurface(index,x,z): SurfaceHit | null
```

During floor construction tag ordinary/pair stone tops, wood tops and motif tops
`userData.walkingSurface=true`. After assembly, a one-time bridge in
dungeon-game.tsx transforms their indexed/nonindexed and instanced geometry
triangles into world numeric records, keeps upward support faces, and bins them
by intersected cell. The pure index tests barycentric x/z containment and returns
the highest support under the boot, or null in a seam/hole. Metadata comes from
floor tiles and nearest-room corridor ownership. It holds no Three.js objects
and does not participate in collision. Discard it on floor replacement. If 006
already supplies it, reuse it unchanged; otherwise implement it within this scope
and test ordinary, tilted, grooved and motif-covered tops plus negative cells.
Read-only diagnostics report the last actual support cell and y used to emit,
reset to null on reset. Skip a contact with no support; do not invent a plane.

**Verify:** `node --experimental-strip-types --test tests/dungeon-footstep-rules.test.ts`.
Also run `node --experimental-strip-types --test tests/dungeon-surface.test.ts`
when introducing or reusing the support index; its tests must pass unchanged.
Cover boundary crossings, equal phases, negative cells, wood priority, corridor
theme, floor replacement, missing support, and explicit no-event for dash,
hitstop or zero displacement. `npm run typecheck` passes.

### 2. Build one reusable particle batch

Create `footstepEffects(capacity=32)` returning group, emit, update, clear,
dispose and a compact active-count/surface diagnostic. Preallocate particles,
positions, colors, alpha, and indices. Use one BufferGeometry and one material
with up to 32 small billboard quads (2 triangles each), compact active quads
into the draw range. Per-vertex alpha plus a procedural soft fragment mask avoids
a texture. Droplets can use a narrower billboard shape; no second draw required.
Depth testing stays on, depth writes off, no shadow casting/receiving.

Set the batch invisible when empty, not merely alpha=0. Use camera right/up
vectors for the quad axes; convert sizes to world units consistently.
Keep a conservative correct bounding sphere, or update it with preallocated
scratch storage. Do not use a stale initial zero-sized bound.

Use a deterministic private event serial/hash for visual scatter, never gameplay
RNG or Date.now. A new effect must allocate no Mesh, Material, Geometry or Texture.
Age using simulation dt: hitstop/pause freeze contact effects; zero dt is a no-op.
Dust fades and spreads; droplets follow fixed short ballistic paths and expire
on their support plane, never falling into the sea below the floor.

**Verify:** `node --experimental-strip-types --test tests/dungeon-footsteps.test.ts`.
Model test structure on `dungeon-impact.test.ts`: bounded overflow, immutable
geometry/material identity over 1000 emissions, active draw range, invisible
empty pool, zero-time/pause stability, finite positions, expiry and clear.
Also assert height/radius/lifetime bounds and reduced-motion limits.

### 3. Integrate lifecycle and real input

Construct once for the mounted game, attach to world. Emit only in the playing
movement path when grounded contact occurred. Advance/update after movement and
camera updates with the proper dt and camera axes. Do not accidentally switch
impactEffects to simulation dt; it deliberately uses frameDt for hit accents.

Clear on teleport, restart, floor replacement, player death/end state, and
context reset where other effects reset. Dispose owned buffers/material once
on unmount; the generic cleanup only visits Mesh, so document ownership if the
implementation uses a different render object type. Restore diagnostic counters
and event serial during pooled reset; do not amend DRIFTS.
No new effects on a ready/title screen or during a loading veil.

**Verify:** types, lint, both new node suites, then existing
`$env:GAME_TEST_GL='d3d11'; npm run test:browser -- sprint.spec.ts dash.spec.ts frame-budget.spec.ts`.
At most one new active draw; zero in stationary scenes after expiry.
If this breaks an existing tight budget, do not hide footsteps in that fixture:
use real savings left by prior plans or report the shortfall.

### 4. Browser regression and visual timing

Create `footsteps.spec.ts`, fixed seed, actual keyboard movement with deterministic
time. Find legal long stone/wood paths using floor cells; freeze nearby attackers
with fixtures rather than reducing gameplay damage. Read actual pool diagnostics
for assertions and capture the rendered contact.

Required tests: no effects at rest, pushing into a wall, during dash, hitstop and
zero-time draws; positive effects during stone walk; correct surface kind for each
theme; no effects on wood; same contact behavior at 16 ms and subdivided larger
steps; stable pause; expiry after stopping; no old particles after teleport/reset;
same resource counts after repeat runs. Test all four screen-relative directions,
and mobile/reduced motion using the established isolated context/settings pattern.

**Verify:** `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- footsteps.spec.ts sprint.spec.ts dash.spec.ts frame-budget.spec.ts`.

**Capture:** `Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue; $env:GAME_TEST_CAPTURE='1'; npm run test:browser -- footsteps.spec.ts --output=test-results/graphics-008-after`.
Pre-edit baseline uses the existing sprint/polish scenes, same renderer,
`test-results/graphics-008-before`. Final phase sheet includes contact and
+60/+120/+240 ms at identical movement, plus one live combat frame.

Open native-size frames. A step should briefly anchor the boot, not look like
smoke, sparks, a damage proc or a trail following the torso. Check feet on settled
paving if 006 is installed; do not fix misalignment by enlarging particles.
Record counts and allocations, update art direction, run full gates.

## Specific acceptance and maintenance

- Effects are linked to actual distance-based footfalls and actual support.
- One bounded batch, <=32 live particles; no per-step GPU resource creation.
- No changes to displacement, stride, audio cadence or combat state.
- No droplets/water rings on wood or simulated sea contact under raised floors.
- Deterministic pause/reset and both ordinary/reduced-motion captures inspected.
- Future terrain types extend the explicit support selector. Future stride
  changes must update the contact-side test and phase sheets together.
- Stop if feet cannot be aligned without changing the existing gait; that is a
  separate animation task, not permission to rewrite movement in this plan.

## Copyable pre-edit capture command

Run from `game/` before implementation. This uses only already-existing specs:

```powershell
Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue
$env:GAME_TEST_CAPTURE='1'
npm run test:browser -- sprint.spec.ts polish.spec.ts --output=test-results/graphics-008-before
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
