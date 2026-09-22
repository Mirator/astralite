# Plan 011: Three enemies, three silhouettes — guard, stalker, warden

> Executor: read this entire file before editing. It is self-contained and does
> not require the original conversation. Implement only this plan. Follow the
> numerical starting values; tune only within the stated ranges. Record actual
> visual checks as well as test results. A passing counter is not proof of good art.
>
> Planned against commit `c45664f` (branch `feat/shot-compare`), 2026-09-22.
> Observations come from `output/shots/baseline/` (captured 2026-09-19 at
> `84548e7`), which **predates several colour changes** to the enemies; confirm
> every observation against 009's fresh B0 frames before acting on it.
> Nothing here is implemented or runtime-validated.

Third of three model plans (009 weapons, 010 knight, 011 enemies). **Requires
009 DONE** (`bakeStatic`, `actorStats`, the `models` scenes, B0) and **should
follow 010** so the knight/enemy separation is judged against the final knight.
It has four stages. Each stage is independently landable and gets its own gate
run and its own `progress.md` entry; stop between stages if one fails review.

## Repository contract and verification

- Repository root: `C:/Users/Miroslav Pavelek/Documents/astralite`; application:
  `game/`. Run package commands from `game/`. Node >= 22.13. PowerShell below.
- Read `AGENTS.md`, `docs/art-direction.md` (the tell, "One colour for all three
  kinds", and why the warden's bone and plate were moved) and
  `game/tests/README.md`. Edit `dungeon-game.tsx` in place without reformatting.
- No new dependency, texture, post-processing, HUD element, camera change or
  palette redesign. No gameplay change: enemy scale, hit and reach radii,
  speeds, windups, the tell (`THREAT` 0xff4529, `COMMIT` 0xffd6c2), eye colours,
  poses (`dungeon-enemy-pose.ts`) and death (`dungeon-death.ts`) are out of scope.
- No commit, push, PR, merge, deploy or workflow trigger is authorised.
- Append results to `game/progress.md`; update only this plan's row in
  `plans/README.md`. `output/` is read-only.

| Gate | Command (from `game/`) |
| --- | --- |
| Types | `npm run typecheck` |
| Lint | `npm run lint` |
| Node suite | `npm test` |
| Browser, local | `$env:GAME_TEST_GL='d3d11'; npm run test:browser` |
| Production | `npm run build` |
| Whitespace (root) | `git diff --check` |

Run heavy work serially. `frame-budget.spec.ts` ceilings are global and not
raised. The flooded hall holds three guards and was measured at its triangle
ceiling, so every triangle a guard gains is paid three times: stage A is where
that payment comes from.

## Current state

Built by `makeSkeleton(kind)` in `game/app/dungeon-game.tsx` (around lines
220–300 at `c45664f`) with shared `BONES` geometry, plus `enemyDetails` in
`game/app/dungeon-characters.ts` (static trim already merged per joint and
material by `dressing()`, cached per kind).

Contracts the models carry — keep every one:
- **Per-instance materials.** `bone`, `iron`, `brass`, `eye` and, in
  `enemyDetails`, `shadow` and `clothMaterial` are created per enemy. The hit
  and windup flash (around line 1828) traverses the group and sets `emissive` on
  every `MeshStandardMaterial`; `startDeath` clears it. A material shared across
  enemies would flash every enemy at once. Geometry may be shared; materials may not.
- **Joints.** `userData.rig` (height, pitch, yaw), `userData.limbs` (4 pivots),
  `userData.weapon`, `userData.shield`, `userData.skull` (idle yaw) and
  `userData.eyes` are animated or read by poses, death, the snapshot and tests.
  Keep them as separate nodes with the same positions and rest rotations.
  The limbs' rest rotation is overwritten by the pose every frame, so a limb's
  look can only change through its geometry.
- **Eyes** are `MeshBasicMaterial`, unlit, fogged, one hue per kind. Unchanged.
- **Colour roles** (`docs/art-direction.md`): enemies wear the cold half of the
  wheel; warm belongs to the knight. **No skeleton carries a long pale blade** —
  that is the knight's marker. Enemy gold stays below the knight's.
- Death grounds the corpse from the visible meshes' bounds, so any new part
  also lands on the floor correctly; check each kind's death in `character-life.spec.ts`.

What reads badly (baseline crops, to be re-confirmed on B0):
- **Guard.** The helmet (`BONES.armor`, an iron dodecahedron at scale
  .94 x .6 x .94, y 1.53) covers most of the skull from the 40-degree camera, so
  the one thing that says "skeleton" is hidden under a dark lump. The sword
  (`BONES.weapon`, a 0.09 x 0.09 x 0.92 iron bar) is a few dark pixels. The
  shield, iron on a dark floor, reads mainly through its eight brass studs.
- **Stalker.** Reads as a thin, upright pale figure with a big head. The claws —
  its whole archetype, the long lane — are three 0.055 x 0.48 iron cones at the
  bottom of each arm: a tiny dark rake. The hunch (`rig.rotation.x = -.38`)
  barely shows from above.
- **Warden.** Reads as heavy and crowned, which is right, but the chest is one
  black slab (`BONES.plate`, iron 0.72 x 0.48 x 0.34) and the pelvis is a pale
  bone box under it, so the torso reads as dark-over-pale blocks rather than an
  armoured body.
- **All three.** `enemyDetails` uses the rounded `box` (108 triangles) for
  about 18 small pieces per guard and similar per kind; at 0.03–0.1 units a 0.08
  bevel is under a pixel. Base parts are not merged: about 25 meshes per enemy.

## Scope and drift check

Modify only:
- `game/app/dungeon-game.tsx` — `makeSkeleton` and `BONES` only.
- `game/app/dungeon-characters.ts` — `enemyDetails` only (the knight's
  `knightDetails` is 010's).
- `game/tests/browser/models.spec.ts` — enemy assertions and measurements.
- NEW or extended `game/tests/dungeon-bake.test.ts` cases only if stage A needs
  a helper behaviour 009 did not cover.
- `game/progress.md`, `docs/art-direction.md` (a short paragraph per kind), this
  plan's row in `plans/README.md`.

Drift check (root): `git diff --stat c45664f..HEAD -- game/app/dungeon-game.tsx game/app/dungeon-characters.ts game/app/dungeon-enemy.ts game/app/dungeon-enemy-pose.ts game/app/dungeon-death.ts`.

## Stage A — Bake and stop paying for invisible bevels (all kinds, no visible change)

1. In `makeSkeleton`, after `enemyDetails`, call `bakeStatic` on `rig` with
   `skull`, `limbs`, `weapon`, `shield` and the `eyes` in `keep`, then on each
   of those joints with nothing kept (the eyes are Basic and skipped anyway).
   Use a `cacheKey` per kind and joint (e.g. `guard:rig`) so a floor of twelve
   guards merges once. 009's cache holds geometry only and binds each call's
   own materials; confirm that with a node test that bakes two instances with
   different materials and asserts each baked mesh carries its own instance's
   material. If 009 did not implement it that way, fix the helper first.
2. In `enemyDetails`, use a plain unit `BoxGeometry` for pieces whose smallest
   dimension is under 0.06; keep the rounded box for the warden's pauldron
   plates. The contact sheet decides whether any lost highlight matters.
3. Floor teardown must not dispose cached geometry (`userData.shared`), and
   `render.geometries` must not grow across `dungeonTest.buildFloor` calls —
   the existing leak tests hold that; run them.

Target: **guard <= 14, stalker <= 14, warden <= 16 visible meshes**, including
the eyes and the contact shadow; triangles per guard down by at least 1,200.
Record all figures from `actorStats()`. The sheet for this stage must show no
visible change beyond the bevel trial.

## Stage B — Guard: show the skull, give the sword width

| Change | Starting value | Range |
| --- | --- | --- |
| Helmet becomes an open cap on the crown and back of the skull: same `BONES.armor`, scale (.90, .42, .95), position (0, 1.60, .10) | as stated | y 1.57–1.63, z .06–.14 |
| Sword: replace the 0.09-square bar with a flat blade, 0.16 wide x 0.035 thick x 0.92 long (a new shared `BONES.blade`), and keep the spike tip from `enemyDetails` | width .16 | .13–.19 |
| Shield rim: a brass torus on the shield face, radius .36, tube .025, 4 x 16 segments, merged into the shield's brass batch | as stated | radius .34–.37 |

The sword stays `iron`: width, not value. Its broad face must point up in the
idle pose (check with the pose applied, not the rest rotation). Triangle cost
is about +140 per guard; stage A must have paid for it three times over.

Guard acceptance: at native size in `models-cast` and the flooded-hall scene,
the bone skull (brow, sockets, jaw) is visible under the cap from the default
camera, and the sword reads as a blade. The guard still reads as a different
figure from the knight (section "Separation" below).

## Stage C — Stalker: make the claws the silhouette

| Change | Starting value | Range |
| --- | --- | --- |
| Claws: material `iron` -> `bone` | — | — |
| Claw length: `BONES.claw` height .48 -> .62, radius .055 -> .065 | .62 | .55–.70 |
| Claw fan: x offsets (i-1)*.11 -> (i-1)*.15, with each outer claw yawed outward .25 rad | .15 / .25 | .12–.18 / .15–.35 |
| Spine spikes (`enemyDetails`, 5 bone cones): height +25% | +25% | +15% to +35% |

Claws stay inside the stalker's existing reach: no claw tip may move further
from the arm pivot than the current tip plus 0.15, since the tell's lane was
sized to the old arm. Check the lane in `combat.spec.ts` and the stalker windup
capture. If the claws would need to go further to read, stop and report.

Stalker acceptance: from the default camera, the two claw fans read as pale
hooked hands in front of the body at native size, and the stalker is
recognisable in silhouette (the separation test's mask, filled flat) as
low and long-armed rather than as a small upright skeleton.

## Stage D — Warden: an armoured body, not two blocks

| Change | Starting value | Range |
| --- | --- | --- |
| Breastplate relief: brass rim along the top edge of `BONES.plate` (box .70 x .03 x .06 at its top-front edge) and a vertical iron-on-iron rib (box .05 x .40 x .03, front face) | as stated | — |
| Faulds over the pelvis: three overlapping `iron` plates (boxes .50 x .10 x .30, stepped down .08 and out .02 each), so the armour runs from shoulder to thigh and bone shows only at limbs and skull | 3 plates | 2–3 |
| Warden brass stays 0x7a6c43; warden iron stays 0x27302d | — | — |

Do not revert the warden's bone value (0x776e5d) or plate hue: both were moved
for measured reasons recorded in `makeSkeleton`'s comments.

Warden acceptance: the torso reads as one armoured mass with a gold edge, no
pale box at the hips, and the crown and hammer still dominate the silhouette.

## Separation (measured, all stages)

Extend `models.spec.ts` using the same visible/hidden framebuffer-difference
method 010 uses for the knight (read pixels synchronously in one
`page.evaluate`), on `models-cast`:
- a mask per actor; mean CIE Lab per mask;
- assert mean ΔE between the knight's mask and each enemy's mask is at least
  the B0 value minus 1 (no regression), and log all six pairwise values;
- assert each pair of enemy kinds differs by at least the B0 value minus 1 as well.

Colour is not the main tool in this plan — shape is — so these are guards
against regression, not targets. Record before (on B0-equivalent code) and after.

Structural, in `models.spec.ts`: per kind, mesh targets from stage A;
`height` within +/-0.10 of the B0 value; the snapshot's joint rest values
unchanged; one windup per kind still flashes the whole body (sample one
material's emissive on the baked rig mesh and one on a limb during the windup).

## Steps

1. Status, drift check, all gates on the untouched tree; record. Record
   `actorStats()` for one of each kind and the three budget scenes' counters.
2. Take the separation measurements on the unchanged enemies (they are the
   "before" values).
3. Stage A. Run `character-life.spec.ts`, `combat.spec.ts`, `polish.spec.ts`,
   `occlusion.spec.ts`, `art-direction.spec.ts`, `frame-budget.spec.ts`, then
   `npm run shots:compare -- --before <B0>`. Log.
4. Stage B, then the same runs and sheet. Log. Stop here if it fails review.
5. Stage C, same. Log.
6. Stage D, same. Log.
7. All gates once, then `npm run test:browser -- --repeat-each=3` once for
   stability. In `progress.md`, add a table of the three budget scenes' calls
   and triangles at B0, after 009, after 010 and after 011, and **propose**
   (do not apply) tightened ceilings at the final measured values, for the
   owner to accept.

## Acceptance

- All gates pass; ceilings unchanged; the flooded hall's triangles and calls at
  or below the step-1 values.
- Stage A mesh targets met and asserted; no leaked geometry across floors.
- The windup tell, the flash, death and corpse grounding behave as before for
  all three kinds (existing specs pass unmodified).
- Written visual verdict per kind against its acceptance line, citing the
  sheet rows, plus one isolated phone capture (390x844) reviewed.

## Stop rules

- Any stage whose sheet shows an unintended change outside its kind: stop and
  explain before the next stage.
- If making a material shared would be needed to meet a mesh target, keep the
  target missed and report it; never share an enemy material.
- If the stalker's claws cannot read without extending its reach, or the
  guard's cap cannot reveal the skull without the helmet reading as a hat
  floating off it, leave that change out and report it with the capture.
- Do not raise a ceiling, touch the tell colours or change eye hues to make
  anything pass.
