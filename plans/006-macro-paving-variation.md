# Plan 006: Break the paving grid with bounded masonry patches

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

- Priority P2; effort L (2–4 days including placement and visual regression); risk MED.
- Depends on: 004's `decorReservations(floor)` contract.
- Original recommendation: 3, break large-scale floor repetition.
- Result: patches of longer stones and locally settled paving interrupt the
  square rhythm without changing where actors can walk.

## Current state and anchors

`dungeon-art.ts:523–529` fixes the slab footprint to 1.43, while TILE is 1.48.
`pavingGeometry` makes flat-shaded plain/groove/dish slabs; `pavingKind`
chooses per cell. Keep these successful small-scale details.

`game/app/dungeon-game.tsx:866,891–912`:

```ts
const tileGeometry=pavingGeometry('plain'),grooveGeometry=pavingGeometry('groove'),dishGeometry=pavingGeometry('dish'),foundationGeometry=new THREE.BoxGeometry(1.49,2.65,1.49);
// ...
const variants:Record<'groove'|'dish',typeof stoneTiles>={groove:[],dish:[]};
const paving=new Map<string,typeof stoneTiles>();
for(const tile of stoneTiles){
  const key=`${Math.floor(tile.x/12)},${Math.floor(tile.z/12)}`;
  const batch=paving.get(key);if(batch)batch.push(tile);else paving.set(key,[tile]);
}
```

The loop separately builds foundations for EVERY stone tile. A merged top must
remove only the two ordinary top slabs, never either foundation. Existing
`slabTint` carries room palette; `weatherStone` shades by world position.
`stoneTexture` also has edge shading in UVs, so stretched UVs can accidentally
paint a false seam through a supposedly merged slab.

## Scope and drift check

Modify only:
- `game/app/dungeon-game.tsx` within floor construction and diagnostics.
- NEW `game/app/dungeon-paving-layout.ts` (pure deterministic pairing/patches).
- NEW `game/app/dungeon-paving-patches.ts` (rectangular bevel geometry).
- NEW `game/app/dungeon-surface.ts` and `game/tests/dungeon-surface.test.ts`
  (pure support-height index, specified below and reused by 008).
- `game/app/dungeon-decor-layout.ts` only if a missing reservation is found;
  preserve the 004 API and explain the additive change.
- NEW `game/tests/dungeon-paving-layout.test.ts`,
  `game/tests/dungeon-paving-patches.test.ts`,
  `game/tests/browser/macro-paving.spec.ts`.
- `game/tests/browser/helpers.ts` diagnostics only; `docs/art-direction.md`,
  `game/progress.md`, index row.

Root: `git diff --stat cc6fb85..HEAD -- game/app/dungeon-game.tsx game/app/dungeon-decor-layout.ts game/app/dungeon-paving-layout.ts game/app/dungeon-paving-patches.ts game/app/dungeon-surface.ts game/tests docs/art-direction.md`.
Do not edit `dungeon-floor.ts`, TILE, floor cells, pathfinding, collision,
water height, stair geometry, or the existing small-slab generator.
No loose physics debris or new obstacles.

## Visual specification

Use only two new treatments in this iteration:

1. **A real two-cell slab.** Outer dimensions 2.91 x 1.43 (2*TILE-0.05 by
   TILE-0.05), at the midpoint of two adjacent cells. One continuous top face;
   no central joint, fake dividing line or duplicated old slab underneath.
   Preserve physical bevel width 0.075, TOP=0.09, BASE=-0.09, and existing
   world top y=0.02 after translation -0.07.
2. **A settled strip.** Three or four ordinary slabs in an offset/staggered
   group, lowered an additional 0.025–0.045, with maximum 0.03-radian tilt.
   This is uneven masonry, not a hole. Never expose a black missing floor or
   raise a corner above normal paving. Keep foundations underneath.

| Theme | Long-slab arrangement | Settled treatment |
| --- | --- | --- |
| keep | Short orderly courses following the room's long axis; break after 2–3 pairs | One sparse edge patch; ~5% of eligible singles |
| ruins | Offset pairs in 2–3 local clusters, alternate orientation per cluster | 1–2 staggered strips near room edges; up to 12% of eligible singles |
| flooded | Pairs forming broken channels toward room edges, not a uniform stripe across the whole room | One shallow strip following the long axis; ~8% of eligible singles |

- Pair 20–30% of ELIGIBLE cells in rooms with >=24 eligible cells. This is a
  starting coverage target, not permission to violate reservations. Small rooms
  may have zero pairs. Coverage counts consumed CELLS: 5 pairs consume 10 cells.
  Leave >=65% of total room stone cells with a single-cell top, including settled
  singles. Invariants: `2*pairs <= 0.35*roomStoneCells` and no tile counted twice.
  Settled percentages below are a separate quota within the remaining singles;
  they do not count as additional paired cells.
- Eligible: both cells in same room, stone, four cardinal neighbors also belong
  to that room's stone footprint; neither touches a prop hole, wood or corridor.
  Exclude `decorReservations`, gauntlets, door approaches (within 2 tile steps
  of an ownership/wood transition), and a 0.3 margin around reservations.
- Never cross a 12x12 tile spatial batch boundary. All special tops stay in their
  source culling region. No floor-wide merged mesh.
- No palette changes. Use a blended/averaged source `slabTint` for the pair.
  Keep the normal world-space weathering, physical roughness and stone grain.
- Pair selection should form deliberate clusters, not uniformly scattered
  random dominoes. Cluster centers are deterministic room-relative candidates;
  score nearby eligible pairs, then accept without overlap.
- No radial grids, new bright outlines, piles of extra pebbles or decorative
  rubble in walking lanes. The visual change is a quieter, less regular seam
  pattern with locally varied height.

## Implementation steps

### 1. Build a pure coverage plan before rendering it

Read 004's actual reservations and tests; if it is not implemented, this plan is
BLOCKED on 004. Capture baseline theme and junction scenes.

Implement `planPavingPatches(floor)` in the new pure module. Return pair
descriptors (owner, both tile keys, midpoint, orientation, batch key), a set of
consumed single-top keys, and settled single descriptors. Stable sort room/cell
candidates; seed a private hash from floor.seed + room.id + coordinates.
Do not reuse/mutate generator randomness or modify source floor arrays.

Placement order: reservations -> doorway exclusion -> pair clusters -> settled
singles. A cell belongs to at most one treatment. A rejected candidate falls
back to the existing ordinary paving path, never to an empty slot.

**Verify:** `node --experimental-strip-types --test tests/dungeon-paving-layout.test.ts`.
Across seeds 1..100 and levels 1..3: same input gives same output; every original
stone tile has exactly one top owner (single or pair); pairs share an edge;
no overlaps, wood, holes, forbidden areas or batch-boundary crossings; floor
serialization/cell membership unchanged. Include negative coordinates.

### 2. Make rectangular geometry with constant bevel width

Create an 18-triangle rectangular slab matching the existing plain slab's
four rim quads, four side quads, and top quad. Build each of four edges
explicitly using independent halfWidth/halfDepth; copying the square helper's
quarter-turn ring will produce incorrect corners for a rectangle.
Use shared geometry for X-oriented pairs, rotate 90 degrees for Z orientation.
Normals remain flat per facet; joint side shading remains comparable to existing
JOINT=.52. Compute bounding boxes/spheres for frustum culling.

Map the entire rectangle over 0..1 UV once so the existing texture edge shading
falls only on the outside boundary. This stretches fine grain slightly; do not
tile the complete bordered texture twice, which would recreate a center seam.
Do not change the shared texture globally to fix this local case.

**Verify:** `node --experimental-strip-types --test tests/dungeon-paving-patches.test.ts`.
Assert bounds 2.91x1.43, top height, outward/upward normals, no degenerate faces,
18 triangles and no central side wall. `npm run typecheck` and lint pass.

### 3. Integrate tops, keep foundations and culling

Calculate patches once in `buildFloor`. Filter consumed pair cells out of plain,
groove and dish TOP batches; leave original foundation iteration untouched.
Use one InstancedMesh for long slabs per existing nonempty 12-tile batch.
Apply settled transforms only to remaining singles; do not stack the old
settled transform with the new offset. Existing variants outside patches stay.

Geometry ownership is floor-local and follows clearFloor disposal.
Also implement the following presentation-only support contract, used by 008:

```ts
type SurfaceHit = { cell: string; y: number; theme: 'keep'|'ruins'|'flooded'; wood: boolean };
// In dungeon-surface.ts, pure numeric data; no Three.js imports:
// surfaceCell(x,z): cellKey(Math.round(x/TILE), Math.round(z/TILE))
// buildSurfaceIndex(triangleRecords, cellMetadata): SurfaceIndex
// sampleSurface(index,x,z): SurfaceHit | null
```

After floor visuals (including motifs) are built, collect only meshes explicitly
tagged `userData.walkingSurface=true`: original stone tops, new pair tops, wood
tops, and 004's motif tops. Never collect walls, water or foundation faces.
This one-time bridge in dungeon-game.tsx reads the realized mesh/instance matrix
and position attributes, transforms triangles into numeric world coordinates,
keeps upward support faces, and bins them into every intersected cell. It handles
indexed and nonindexed geometry and InstancedMesh. Retain only the numeric index;
no mesh references in the pure module. Rebuild/discard it with the floor.
Sampling checks barycentric x/z containment and returns the highest upward face
under the point; no hit in an actual seam/hole means null, never an invented plane.
Source metadata comes from the floor's stone/wood tiles, with nearest-room theme
only for corridor cells. This lookup is PRESENTATION ONLY; collision continues
to use the original floor.cells. Do not alter canStand or movement to match it.
The motifs are excluded from new settlement by reservations, but including their
real top is necessary for precise foot contacts. Test rotated, tilted, grooved,
merged and motif-covered surfaces, negative cells and no-hit gaps. No per-frame
scene traversal or Three.Raycaster is needed to sample a foot.
If additional batch draws exceed global ceilings, coalesce the region's single
and long opaque tops into one static BufferGeometry with per-vertex tint
equivalent to instance tint. Keep the same region boundaries and material;
measure memory/build time. This bounded fallback is authorized; a global mesh,
reduced draw distance, or disappearing details in test scenes is not.

**Verify:** `node --experimental-strip-types --test tests/dungeon-surface.test.ts`,
types, lint, node tests, then
`$env:GAME_TEST_GL='d3d11'; npm run test:browser -- frame-budget.spec.ts art-direction.spec.ts polish.spec.ts`.
Keep foundation counts unchanged; record same-seed before/after draw counts,
triangles, buildMs and memory, without converting noisy build timings into CI limits.

### 4. Integration tests and visual proof

Create `macro-paving.spec.ts`: actual live geometry descriptors, deterministic
rebuilds, full coverage, all themes, narrow room, junction and bridge transition.
Use real movement across a long slab and settled strip, with a legal fixture
start: player displacement/collision and attack range remain identical.
Do not test walking by changing floor.cells to accommodate the new mesh.
If adding diagnostics, derive realized top coverage from batches and keep it
compact; no full geometry buffers in `render_game_to_text`.

**Verify:** `$env:GAME_TEST_GL='d3d11'; npm run test:browser -- macro-paving.spec.ts art-direction.spec.ts frame-budget.spec.ts`.

**Capture:** `Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue; $env:GAME_TEST_CAPTURE='1'; npm run test:browser -- macro-paving.spec.ts art-direction.spec.ts --output=test-results/graphics-006-after`.
Baseline uses existing art/frame scenes before edits, output
`test-results/graphics-006-before`.

At native size, long slabs must visibly remove seams across at least two adjacent
cells, and patches must read as intentional construction. Inspect edge gaps,
rotated pairs, doorway transitions, knight feet and warden telegraphs on mobile.
Reject texture-painted center seams, floating feet, holes, or a uniform new
striped pattern replacing the old grid. Run full gates and document results.

## Specific acceptance and maintenance

- 300 pure layout cases prove exact coverage and unchanged collision data.
- Original single-slab geometry and reservations remain backward compatible.
- Pair treatment preserves culling regions, world-space shader variation and
  foundation count; at least one eligible room per theme in seed sample uses it.
- No coverage target is reached by placing slabs in reserved areas.
- Future motif/features must reserve their footprint before pair selection.
- Stop if the feature can fit budget only by deleting architecture outside this
  scope, or if settlement makes more than a 0.06-unit visual foot gap.

## Copyable pre-edit capture command

Run from `game/` before implementation. This uses only already-existing specs:

```powershell
Remove-Item Env:GAME_TEST_GL -ErrorAction SilentlyContinue
$env:GAME_TEST_CAPTURE='1'
npm run test:browser -- art-direction.spec.ts frame-budget.spec.ts --output=test-results/graphics-006-before
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
