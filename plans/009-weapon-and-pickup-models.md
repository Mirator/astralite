# Plan 009: Bake the armoury and sharpen what each arm says from above

> Executor: read this entire file before editing. It is self-contained and does
> not require the original conversation. Implement only this plan. Follow the
> numerical starting values; tune only within the stated ranges. Record actual
> visual checks as well as test results. A passing counter is not proof of good art.
>
> Planned against commit `c45664f` (branch `feat/shot-compare`), 2026-09-22.
> Mesh and triangle counts below were measured in node from the live builders;
> nothing here has been implemented or runtime-validated.

First of three model plans (009 weapons, 010 knight, 011 enemies). This one goes
first because it introduces the shared bake helper, the shared diagnostic and the
shared capture scenes that 010 and 011 reuse, and because it is the lowest-risk
of the three.

## Repository contract and verification

- Repository root: `C:/Users/Miroslav Pavelek/Documents/astralite`; application:
  `game/`. Paths below are relative to the root. Run package commands from
  `game/`. Node >= 22.13. PowerShell syntax below.
- Read `AGENTS.md`, `docs/art-direction.md` and `game/tests/README.md` first.
  Edit the dense `dungeon-game.tsx` in place without reformatting it. Keep
  `dungeon-floor.ts` and `dungeon-combat.ts` free of rendering imports.
- Requires `npm run shots:compare` (commit `c45664f`). If that commit is not on
  the branch being worked, stop and say so; do not re-implement the tool.
- No new dependency, downloaded asset, texture, post-processing, HUD element,
  gameplay rule, camera change or palette redesign. Weapon reach, damage,
  timing and pickup rules in `dungeon-weapon.ts` are out of scope.
- No commit, push, PR, merge, deploy or workflow trigger is authorised by this
  plan. Work on a branch only if one is needed. Preserve unrelated working-tree
  edits (at planning time: balance scripts, `deploy-pages.yml`, `package.json`).
- Append results to `game/progress.md`; update only this plan's row in
  `plans/README.md`. `output/` is read-only history.

| Gate | Command (from `game/`) |
| --- | --- |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Node suite | `npm test` |
| Browser, local | `$env:GAME_TEST_GL='d3d11'; npm run test:browser` |
| Production | `npm run build` |
| Whitespace (root) | `git diff --check` |

Run heavy work serially: one browser run or capture at a time.

### Budgets

`tests/browser/frame-budget.spec.ts` holds global ceilings (flooded hall 439
calls / 198,818 triangles; junction 502 / 343,716; strike contact 447 /
236,196). Do not raise them. The flooded hall was measured *at* its ceiling, so
assume zero triangle headroom until you have measured otherwise: anything this
plan adds in triangles must be paid for inside this plan. This plan is expected
to come in **lower** on draw calls; record the new figures but do not lower the
ceilings (010 and 011 spend the difference — see 011's closing step).

## Current state (measured)

Every part of every arm is its own `THREE.Mesh`, never merged
(`game/app/dungeon-armory.ts`, `makeWeapon`). One draw call per part, twice
over for parts that cast shadows:

| Arm | In hand: meshes / tris | On the floor (`makeWeaponDrop`): meshes / tris |
| --- | --- | --- |
| tideblade | 10 / 228 | 14 / 476 |
| fangs | 5 / 120 | 9 / 368 |
| spear | 7 / 192 | 11 / 440 |
| cleaver | 5 / 136 | 9 / 384 |
| maul | 8 / 112 | 12 / 360 |
| crossbow | 10 / 124 | 14 / 372 |
| flask | 7 / 328 | 11 / 576 |

The knight's own static trim is already merged per joint and material by
`dressing()` in `dungeon-characters.ts`; the armoury never got the same.
`makeBolt` is 4 meshes (brass, steel, 2x dark) per pooled bolt, 8 pooled.

What reads badly at gameplay scale (1000x700, orthographic camera at
`(+9.2, 12.5, +11.5)` from the focus, about 40 degrees down; the knight is
~50 px tall): the camera sees **top faces**. Arms are laid flat so their broad
face points up, which is right, but several spend their identity on parts that
are dark-on-dark or a few pixels wide:

- **fangs**: two 0.10-wide blades with nothing joining them read as two slivers.
- **spear**: a 0.17-wide head on a leather haft; the three iron bindings are
  meant to show length and vanish against leather.
- **crossbow**: the prod (`bow`, 0.96 wide) is `iron`, the darkest material, so
  the T that says "crossbow" is lost against the floor.
- tideblade, cleaver, maul and flask read acceptably; they only get baked.

Constraints the arms carry and must keep:
- `inner` and `tip` per arm are sampled by the slash ribbon
  (`dungeon-weapon-trail.ts`, `tests/dungeon-weapon-trail.test.ts`,
  `tests/browser/slash.spec.ts`). **Do not change them.**
- Materials belong to the knight (`ArmoryPalette`) and outlive every swap;
  `disposeWeapon` disposes geometry only. `steel` in the palette is the pale
  `blade` material: a long bright blade is the knight's marker and no skeleton
  may carry one (see the comment above `blade` in `dungeon-game.tsx`).
- `makeWeaponDrop` scales the arm 1.45 and plants it point-down in a plinth;
  the ring (1.02–1.3) and the glow sphere are transparent `MeshBasicMaterial`.
- Firing must not allocate (`makeBolt`/`makeFlask` are pooled; the suite
  asserts on allocations per floor).

## Scope and drift check

Modify only:
- NEW `game/app/dungeon-bake.ts` — the shared static bake (below).
- NEW `game/tests/dungeon-bake.test.ts`, NEW `game/tests/dungeon-armory.test.ts`.
- `game/app/dungeon-armory.ts` — bake arms, drops and bolts; three silhouette edits.
- `game/app/dungeon-game.tsx` — only the new `actorStats` diagnostic on
  `dungeonTest` and its type on `window`.
- `game/tests/browser/helpers.ts` — typing for the diagnostic only.
- `game/tests/browser/shots.spec.ts` — the new `models` scenes (below).
- NEW `game/tests/browser/models.spec.ts` — structural assertions.
- `game/progress.md`, this plan's row in `plans/README.md`.

Drift check (root): `git diff --stat c45664f..HEAD -- game/app/dungeon-armory.ts game/app/dungeon-characters.ts game/app/dungeon-game.tsx game/tests/browser/shots.spec.ts game/tests/browser/frame-budget.spec.ts`.
Reconcile any change there before editing; stop on an unexplained behavioural mismatch.

## Design

### 1. `dungeon-bake.ts` — one merge helper for all three plans

```ts
/** Merge every opaque Mesh under `root` into one Mesh per material, in root-local space. */
export function bakeStatic(root: THREE.Object3D, options?: {
  keep?: Iterable<THREE.Object3D>;   // subtrees left alone (animated joints, pooled FX)
  cacheKey?: string;                 // reuse merged geometry across instances; marks it userData.shared
}): { meshes: number; merged: number };
```

Rules, all covered by the node test:
- Only `THREE.Mesh` with a single `MeshStandardMaterial` whose `transparent` is
  false. Basic/transparent meshes (flask ember, drop glow and ring) are left as
  they are.
- `root` itself is never removed or merged into anything; only its descendants
  are. An invisible `root` is left untouched (011: the stalker's and warden's
  hidden shield is still a joint that death animates). A `root` that is itself a
  Mesh keeps its own geometry and material.
- A mesh is merged only if no node on its path up to `root` is in `keep` and
  every node on that path is `visible`. Invisible meshes are **removed**, not
  merged (the knight carries two hidden pauldrons today — 010 relies on this).
- Geometry is converted to non-indexed, transformed by the mesh's matrix
  relative to `root`, `uv` deleted unless the material has a `map`, groups
  cleared. Mixed attribute sets must not throw: normalise to position+normal.
- `castShadow`/`receiveShadow` are part of the batch key, so a non-casting part
  never starts casting.
- With `cacheKey`, the merged **geometry** for (key, batch index) is built once
  and reused, `userData.shared = true`, so floor teardown does not dispose it.
  The cache holds geometry only: every call builds fresh `Mesh` objects that use
  **that call's own** materials, so per-instance enemy materials (011) survive.
  Batch order must be deterministic (traversal order, then first appearance of
  each material), and a call whose batch structure does not match the cached one
  must throw rather than bind a material to the wrong geometry.
  Without `cacheKey`, the geometry belongs to the caller.
- Source geometries flagged `userData.shared` are never disposed by the bake;
  unshared sources are disposed after merging.
- Draw order and world-space result are unchanged: world bounding box equal to
  1e-5, triangle count equal.

Do not refactor `dressing()` in `dungeon-characters.ts` onto this helper in this
plan; it works and 010/011 touch that file.

### 2. Bake the arms

At the end of each `makeWeapon` branch, call `bakeStatic(group)` (no cache:
swaps are rare, the arm is owned by the knight and disposed by `disposeWeapon`).
`inner`/`tip` are untouched. Targets:

| | Meshes after | Note |
| --- | --- | --- |
| each arm in hand | <= 4 | one per palette material used |
| flask in hand | <= 5 | the ember stays separate (Basic, transparent) |
| each drop | <= 8 | arm <= 4, plinth + collar <= 2, glow 1, ring 1 |
| bolt (pooled) | 3 | brass shaft, steel head, one dark fletch batch |

`makeWeaponDrop` builds the arm via `makeWeapon`, so bake the drop's plinth and
collar with the arm's own batches where materials coincide — bake the whole drop
group once, after scaling and posing the arm, with the ring and glow excluded
by the transparency rule. Return shape `{ group, ring, blade }` is unchanged;
`blade.group` must still be the arm's group (check every consumer of `blade`
with a search before relying on it).

### 3. Three silhouette edits (top face only, never the value of `steel`)

| Arm | Change | Range | Triangle cost |
| --- | --- | --- | --- |
| fangs | Blade outline half-width 0.05/0.055 -> 0.065/0.07. Add one brass knuckle bar joining the two guards: box 0.20 x 0.035 x 0.05 at (0, 0.036, 0.06). | half-width 0.06–0.075 | +12 |
| spear | Head half-width 0.07/0.085 -> 0.09/0.11. Add two brass lugs either side of the socket: box 0.18 x 0.03 x 0.05 at z = -1.22. Bindings `iron` -> `brass`. | half-width 0.085–0.12 | +24 |
| crossbow | Prod (`bow`) `iron` -> `steel`. Limbs unchanged. | — | 0 |

Use plain `THREE.BoxGeometry` (12 triangles), not `RoundedBoxGeometry`
(108 triangles at the settings `dungeon-characters.ts` uses). Tip and inner
points stay exactly where they are. No arm's drop silhouette may exceed the
1.3 drop ring in top-down projection.

### 4. `dungeonTest.actorStats()` — the shared diagnostic

Add to the `dungeonTest` object in `dungeon-game.tsx` (next to
`cutawayDiagnostics`) and type it in `helpers.ts`:

```ts
actorStats?: () => {
  knight: { meshes: number; triangles: number; height: number };
  enemies: { kind: string; meshes: number; triangles: number; height: number }[];
  drop: { kind: string; meshes: number; triangles: number } | null;
}
```

Counts are visible `Mesh` objects under the actor (contact shadow included,
since it draws); `height` is the world-space bounding-box height of visible
meshes, contact shadow excluded. It reads state only, allocates nothing per
frame, and changes nothing a reset would need to restore.

### 5. Capture scenes shared by 009–011

Add a `models` describe block to `game/tests/browser/shots.spec.ts` so
`shots:compare` includes it. Use one pinned seed and one lit, uncluttered room
(choose it with `openSpot`/`roomCentre` and record why in a comment). Settle
with a fixed `game.step` before each capture, as the other scenes do.

| Name | Content |
| --- | --- |
| `models-armoury-<id>` x7 | Knight at rest in the room centre holding each arm via `dungeonTest.equip`, facing screen-down (toward the camera) |
| `models-armoury-profile-<id>` x7 | The same, facing screen-right |
| `models-drop-<id>` x6 | The floor's own weapon drop of each found kind, framed at the default camera. Find one seed per kind with a node script over the pure generator (`floor.weaponDrop.kind`), and pin the seeds in the spec. |
| `models-knight-strip` | Knight turned through 8 facings, 45 degrees apart (for 010) |
| `models-cast` | One guard, one stalker, one warden and the knight in a row, idle, no windups (for 010 and 011). Use `game.configureCombat` with long cooldowns. |

These are captures, not assertions. Keep them to one describe block so a later
plan can extend it.

### 6. Regression tests

`dungeon-armory.ts` imports only three and `dungeon-weapon.ts`, so it runs in
node (the planning counts above were taken exactly that way, with a stand-in
`plate` that copies the knight's extrude settings). Put the bulk of the guard
there:

NEW `game/tests/dungeon-armory.test.ts`:
- Pin `inner` and `tip` for all seven arms to their current values, recorded
  **before** any edit. This is the regression guard for the trail contract.
- Mesh count per arm, per drop and per bolt within the section 2 targets.
- The tideblade, cleaver, maul and flask keep their triangle counts exactly
  (228 / 136 / 112 / 328); the three edited arms stay within +30 triangles.
- No arm's drop, projected onto the floor plane, extends past radius 1.3.

NEW `game/tests/browser/models.spec.ts`, using `test, expect` from `./helpers`:
- `actorStats().drop.meshes <= 8` for the seed's drop.
- Equipping every arm in turn and back to the tideblade leaves
  `render.geometries` where it started (no leaked merged geometry).
- Pooled scenarios must reset cleanly; do not widen `DRIFTS`.

## Steps

1. `git status --short`, drift check, then run the six gates on the untouched
   tree and record the result. A failing pre-existing gate is reported, not fixed here.
2. Add `actorStats` and the `models` scenes only (no model change). Run
   `npm run shots:compare -- --base HEAD` and keep its `after/` directory —
   call it **B0**. That is the "before" for 009, 010 and 011 (the base commit
   does not have the new scenes, so only B0 can serve). Record the flooded
   hall, junction and strike-contact counters, and `actorStats()` for the
   tideblade knight and one drop, in `progress.md`.
3. Write `dungeon-bake.ts` and its node test first; make the test pass.
4. Bake arms, drops and bolts. Re-run the node suite, `weapon.spec.ts`,
   `slash.spec.ts`, `ranged.spec.ts`, `frame-budget.spec.ts`.
5. The three silhouette edits.
6. `npm run shots:compare -- --before <B0>` and review the sheet at native
   size: every `models-armoury-*` and `models-drop-*` row, plus the existing
   strike and dash strips (the arm is in every frame of both).
7. All gates once. Log in `progress.md`: gate results, before/after counters
   for the three budget scenes, per-arm mesh counts, sheet path, and a written
   visual verdict per arm (reads better / same / worse, and why).

## Acceptance

- All gates pass; budget ceilings unchanged; all three scenes' draw calls are
  lower than or equal to step 2's figures; triangles are not higher than step 2's.
- Mesh targets in the table in section 2 are met and asserted in node.
- Every `inner`/`tip` pinned and unchanged; trail and slash specs unchanged and passing.
- Visual: in the sheet, fangs read as one paired weapon, the spear head and its
  length are visible at native size, the crossbow T is visible from above.
  Tideblade, cleaver, maul and flask are pixel-identical or differ only by
  sub-pixel noise at the merge (report the sheet's changed-pixel counts).

## Stop rules

- If baking changes the look of an arm that was meant to be unchanged beyond
  sub-pixel noise, find out why (normals, flat shading, a lost shadow flag)
  before continuing. Do not accept it as art.
- If the flooded hall's triangles rise at all, remove the added parts before
  touching anything else.
- If a drop's `blade` consumer depends on individual child meshes, keep the arm
  unbaked inside the drop and bake only the plinth, then report it.
- Mark BLOCKED with the measured shortfall rather than raising a ceiling.
