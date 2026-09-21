# Plan 004: Give each room family a distinct floor motif

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

- Priority P2; effort M (roughly 1–2 focused days including visual review); risk MED.
- Depends on: none. Original recommendation: 1, room identity.
- Result: three recognizable, quiet floor motifs instead of a compass in almost
  every chamber. They remain decorative, never new objects to interact with.

## Current state and anchors

`game/app/dungeon-art.ts:176–256`, `addCarvedArchitecture`, owns the carvings,
materials, and this repeated center treatment:

```ts
const x = room.x * TILE, z = room.z * TILE, radius = room.shape === 'round' ? 3.15 : 2.35;
if (room.encounter !== 'gauntlet') {
  const disk = mesh(new THREE.CircleGeometry(radius, 64), dark, x, .028, z);
  disk.rotation.x = -Math.PI / 2;
  for (const r of [radius, radius - .16, radius * .65]) {
    const ring = mesh(new THREE.RingGeometry(r - .025, r, 64), lip, x, .031, z);
    ring.rotation.x = -Math.PI / 2;
  }
```

The following code adds the same 16-point compass and 24 ticks.
Existing `dark`, `inlay`, and `lip` materials deliberately put the broad
engraving BELOW paving value; a bright bronze ring previously competed with
the stair. Reuse their live mood updates in `dungeon-atmosphere.ts:310–313`.
The separate seals at `dungeon-atmosphere.ts:262–265,325` express room state;
do not remove or redesign them as if they were this decorative compass.

`dungeon-floor.ts:4–7,196` supplies room theme, footprint, encounter, role,
tiles, props, and a singular `weaponDrop`. Positions in floor data are tile
coordinates; rendered coordinates multiply by `TILE = 1.48`.

## Scope and drift check

Modify only:
- `game/app/dungeon-art.ts` (replace motif construction; preserve architecture).
- NEW `game/app/dungeon-decor-layout.ts` (pure placement/reservation descriptors).
- NEW `game/app/dungeon-floor-motifs.ts` (Three.js motif geometry/batching).
- `game/app/dungeon-game.tsx` and `game/tests/browser/helpers.ts` only for a
  compact read-only graphics diagnostic if browser integration needs it.
- NEW `game/tests/dungeon-decor-layout.test.ts`,
  `game/tests/dungeon-floor-motifs.test.ts`,
  `game/tests/browser/floor-motifs.spec.ts`.
- `docs/art-direction.md`, `game/progress.md`, this plan's index row.

Root: `git diff --stat cc6fb85..HEAD -- game/app/dungeon-art.ts game/app/dungeon-decor-layout.ts game/app/dungeon-floor-motifs.ts game/app/dungeon-game.tsx game/tests docs/art-direction.md`.
Do not edit floor generation, encounter layout, signal colors, HUD, or existing
seal behavior. Existing tests may be read but not weakened.

## Visual specification

All dimensions are world units, not pixels. This is carved stone, without
emission, floating symbols, particle effects, or clickable markers.

| Theme | Shape, placement and silhouette | Detail |
| --- | --- | --- |
| keep | An octagonal bed, radius up to 2.35 (3.15 in round rooms); a broad shield cut into its center | Shield width 0.95r, height 1.2r; pointed bottom and flat shoulders; a simple vertical split, no text or miniature heraldry |
| ruins | Three separated polygonal sectors of a once octagonal bed; no continuous outer circle | Sector gaps 0.12–0.22; each carries one broken edge of an old chevron; keep 25–35% of the former bed uncovered so paving shows through |
| flooded | Three parallel, shallow dark channel strips crossed by two broken stone bars; no disk | Strip width 0.10–0.14; lengths 2.6–3.8; spacing 0.45–0.65; restrained moss-colored tips using existing dark stone value, no luminous green |

- Bed at y=0.028, cuts at 0.033, narrow lips at 0.038; no point above 0.045.
  Keep tiny layer separation stable at the default camera; no z fighting.
- Existing broad `dark` / `inlay` values stay unchanged. Use `lip` only on
  narrow edges 0.02–0.035 wide. No new bright gold, restore green or threat red.
- Keep and ruins: at most one deliberately incomplete outer border; flooded:
  no concentric rings. This must be distinguishable in grayscale at native size.
- Seed selects quarter-turn orientation and one missing fragment, not arbitrary
  sizes/colors. Two variants per theme are enough. Stable floor seed + room ID;
  never consume the generator's PRNG or `Math.random()`.
- Skip gauntlet and goal rooms entirely. For sanctuary, leave a central radius
  1.6 clear; use only outer fragments, or no motif if it will not fit.
  Clip/reject geometry overlapping the weapon drop's reservation.
- No motif may bridge a missing tile, wood, a prop hole, or a corridor. Reduce
  radius conservatively; skip rather than spill onto open water in small rooms.
- Maintain the knight as the focal point. The motif must remain less visually
  prominent than a live threat cue in keep, ruins and flooded lighting.

## Implementation steps

### 1. Record baseline and add pure placement rules

Run existing `art-direction.spec.ts` and `frame-budget.spec.ts` first.
Capture the three theme scenes before editing.

Create `dungeon-decor-layout.ts` with no Three.js, DOM, React or mutable RNG.
Use type-only floor/room imports and explicit `.ts` imports where needed by
Node stripping. Suggested public contracts:

```ts
type Rect = { minX:number; maxX:number; minZ:number; maxZ:number };
type MotifLayout = { room:number; theme:'keep'|'ruins'|'flooded';
  x:number; z:number; radius:number; turn:0|1|2|3; variant:0|1 };
// exported: decorReservations(floor), planRoomMotif(floor, room)
```

`decorReservations` returns conservative WORLD-space rectangles for every
room center (half-size planned radius +0.2), goal (at least 2.2), sanctuary
(at least 1.6), and weapon drop (half-size 1.5). A gauntlet reserves its whole
room. This is the shared placement contract for later macro paving; export it
now even when a motif is skipped. Clip candidates against occupied stone cells;
test all intersected cells of each component's bounding box, not just its center.
The center rectangle reserves space FOR the motif against later paving; it is
not an exclusion applied to that same motif. `planRoomMotif` rejects only actual
special-feature reservations (drop, goal, gauntlet, sanctuary center) and invalid
support. Keep those two uses explicit so a motif does not reject itself.
Do not mutate `floor.cells`, `tiles`, `props`, or `weaponDrop`.

**Verify:** `node --experimental-strip-types --test tests/dungeon-decor-layout.test.ts`.
Cover repeatability, all three themes, no mutation, narrow/cross/court footprints,
negative coordinates, prop holes, goal/gauntlet exclusions and drop clearance.

### 2. Build and replace motif geometry

Create `dungeon-floor-motifs.ts` to consume descriptors and existing materials.
Build simple indexed/nonindexed flat polygons with deliberate winding and normals.
Reuse the existing material set; no per-fragment material. Batch disconnected
polygons into geometry by material and spatial region (same 12-tile regions used
by paving are a reasonable default), rather than adding one mesh per tick.
Do not combine the entire floor into one always-visible batch.
Remove the old disk/rings/star/ticks block completely; do not layer motifs over it.

Motif geometry belongs to the floor group and is disposed by its traversal.
The call chain is `buildFloor -> addAtmosphere(floorGroup, floor) ->
addCarvedArchitecture(world, floor)`: the helper parameter named `world` IS
the passed floorGroup, not the outer scene's world group. Keep that call chain;
do not move new motifs to the outer world. Tag their top-surface meshes with
`userData.walkingSurface=true` for the later surface-height index in 006/008.
Do not mark newly allocated per-floor geometry `userData.shared`.
For new helper resources not attached to a mesh, provide explicit disposal.

**Verify:** unit test finite coordinates, positive triangle areas, upward faces,
bounds, <0.045 maximum y, and reservations. `npm run typecheck` and `npm run lint`
pass. Render budgets must not increase beyond existing ceilings; the removal of
many separate rings is the feature's first source of savings.

### 3. Verify the real scene, not just descriptors

Create `floor-motifs.spec.ts`, seed 0x1, all three themes, settle 640 ms.
If adding a read-only `graphics.motifs` snapshot, report actual attached batches
and realized descriptors, not a second recomputation of desired data.
No test-only switches in normal gameplay and no additional DOM overlay.

New checks: three different realized motif types, no motif in goal/gauntlet,
sanctuary/drop clear areas, same result after pinned-seed reset, and stable GPU
counts after warmup/rebuild. Keep a fixture with a live warden tell over each motif
and run the existing framebuffer contrast tests unchanged.

**Verify:** `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- floor-motifs.spec.ts art-direction.spec.ts frame-budget.spec.ts`.

### 4. Capture, review, and document

**Verify/capture:** `Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue; $env:GAME_TEST_CAPTURE='1'; npm run test:browser -- floor-motifs.spec.ts art-direction.spec.ts --output=test-results/graphics-004-after`.
The baseline uses the same command with the existing art spec and the suffix
`graphics-004-before`; run that before source edits.

Open the PNGs: each motif must read as a different construction at native size,
without needing the theme color; the hero, drop, shrine and red tell remain
immediately legible. Include desktop and mobile, plus small-room and sanctuary
cases. Do not accept a flooded motif that looks like a new hazard grate.
Document this vocabulary in art direction, append validation results, run all gates.

## Specific acceptance and maintenance

- Theme differences are geometric, not merely new colors.
- Existing seal/clear animation and all collision data are unchanged.
- New layout tests check occupied coverage and feature clearances across at least
  50 seeds and all three floor levels; skip decisions must be deterministic.
- A reviewer sees the 3-theme contact sheet and one combat frame per theme.
- When future special room features are added, extend `decorReservations` first.
  Plan 006 consumes this interface; do not change its units or semantics silently.
- Stop if the conservative fit removes motifs from every eligible room of a theme
  in the 50-seed sample; fix the footprint logic rather than bypassing validation.

## Copyable pre-edit capture command

Run from `game/` before implementation. This uses only already-existing specs:

```powershell
Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue
$env:GAME_TEST_CAPTURE='1'
npm run test:browser -- art-direction.spec.ts --output=test-results/graphics-004-before
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
