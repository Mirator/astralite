# Plan 010: Make the knight read from above: head over shoulders, red at every facing

> Executor: read this entire file before editing. It is self-contained and does
> not require the original conversation. Implement only this plan. Follow the
> numerical starting values; tune only within the stated ranges. Record actual
> visual checks as well as test results. A passing counter is not proof of good art.
>
> Planned against commit `c45664f` (branch `feat/shot-compare`), 2026-09-22.
> Mesh counts below are a static count from source; triangle costs of the
> primitives were measured in node. Nothing here is implemented or runtime-validated.

Second of three model plans (009 weapons, 010 knight, 011 enemies). **Requires
009 to be DONE**: it reuses `bakeStatic` (`game/app/dungeon-bake.ts`),
`dungeonTest.actorStats()` and the `models` capture scenes, and its "before"
frames are 009's **B0** directory. If 009 is not done, stop.

## Repository contract and verification

- Repository root: `C:/Users/Miroslav Pavelek/Documents/astralite`; application:
  `game/`. Run package commands from `game/`. Node >= 22.13. PowerShell below.
- Read `AGENTS.md`, `docs/art-direction.md` (especially "Carved work sits under
  the paving" and the knight/warden history) and `game/tests/README.md`.
  Edit `dungeon-game.tsx` in place without reformatting.
- No new dependency, texture, post-processing, HUD element, gameplay rule,
  camera change or palette redesign. The knight's materials keep their current
  colours unless a row below changes one explicitly.
- No commit, push, PR, merge, deploy or workflow trigger is authorised.
  Preserve unrelated working-tree edits.
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

Run heavy work serially. Budgets: `frame-budget.spec.ts` ceilings are global
and are not raised. Triangles added here must be paid for here (step 3 is where
the payment comes from). Draw calls must come in at or below 009's final figures.

## Current state

The knight is built in `makeKnight` in `game/app/dungeon-game.tsx` (around lines
95–176 at `c45664f`) plus `knightDetails` in `game/app/dungeon-characters.ts`.

Static count at `c45664f`: about **59 visible meshes** — 35 base parts (8 on the
head and body, 13 torso trim pieces, 10 across the two legs, 3 on the arm, the
cape) plus ~14 `knightDetails` batches, the contact shadow, and the arm (10 before
009; 4 or fewer after). Two pauldrons with rims are built and then hidden
(`pauldrons.forEach(shoulder=>{shoulder.visible=false;})`). Every part that casts
a shadow draws twice.

Animated joints (must stay separate nodes, with unchanged positions and rest
rotations): `torso`, `cape` (cloth, `animateCloth`), `swordPivot`
(`userData.sword`; carries the swapped arm), `arm`, both hips (`userData.legs`)
and their `userData.knee`. `userData.boot` is used by footsteps (plan 008) —
keep that reference valid (it may point at a merged node that owns the boot, or
at a bare `Object3D` placed where the boot was: check how `dungeon-footsteps`
reads it and keep that working). `head` is **not** animated; it is a static
child of the torso. `restPose` (around line 622) records every node after the
knight is built, so baking inside `makeKnight` is picked up automatically.

What reads badly at 1000x700 (see `output/shots/baseline/`, and more reliably
009's B0 frames `models-knight-strip` and `models-cast`):

1. **Head and shoulders merge.** The camera is about 40 degrees down, so most of
   the knight's pixels are upward faces. The helmet top (`steel`, 0x64668c),
   the top pauldron plate (`steel`) and the brass rims all sit in one light
   value band, and the head is only about 0.39 tall on a 1.75 figure. From above
   he is a pale block with a red flick, not a helmeted head on shoulders.
   The reference (`docs/reference/dungeons-beyond-concept.png`, "Character &
   gear") has a large, bright helmet clearly separate from dark shoulders.
2. **The red only shows from behind.** At rest the cape is deliberately a
   sliver (see the comment in `dungeon-cloak.ts`: widening it made it cover more
   of the frame than the knight in the dash and strike strips, so **do not widen
   the cape**). Facing the camera, the knight carries almost no red.
3. **Detail spends triangles where nobody can see them.** `knightDetails` uses
   `RoundedBoxGeometry(1,1,1,1,.08)` — 108 triangles each against 12 for a box —
   for about 21 pieces, most 0.02–0.1 units across, where a 0.08 bevel is under
   a pixel. That is roughly 2,000 triangles per knight.

## Scope and drift check

Modify only:
- `game/app/dungeon-game.tsx` — `makeKnight` only.
- `game/app/dungeon-characters.ts` — `knightDetails` only (the enemies'
  `enemyDetails` is 011's).
- `game/tests/browser/models.spec.ts` — knight assertions and the separation
  measurement below.
- `game/progress.md`, `docs/art-direction.md` (one short paragraph recording
  what changed and what it measured), this plan's row in `plans/README.md`.

Drift check (root): `git diff --stat c45664f..HEAD -- game/app/dungeon-game.tsx game/app/dungeon-characters.ts game/app/dungeon-cloak.ts game/app/dungeon-attack-pose.ts game/app/dungeon-run-pose.ts`.

Out of scope: poses, gait, cape shape and motion, sword pivot position, trail,
contact shadow radius/strength, hit radii, the lantern, enemy models.

## Design

### 1. Bake the static parts (draw calls down first)

At the end of `makeKnight`, after `knightDetails` and after the pauldrons are
hidden (so `bakeStatic` removes them), call `bakeStatic` on each joint, with the
child joints in `keep`:

- `torso` — keep `cape`, `swordPivot`, `arm`. The head's parts merge into the
  torso batches.
- `swordPivot` — keep the arm's group (`armed.group`) so `equip` can still swap
  it; the glove and sleeve merge.
- `arm`, each hip (keep its knee), each knee.

Use `cacheKey` (`'knight:torso'` and so on) so a remount does not rebuild
geometry. Leave `g.userData.body` pointing at something valid (search for
readers first; at planning time nothing outside `makeKnight` reads it).

**Target: at most 32 visible meshes including the arm and the contact shadow**
(torso <= 7 materials, cape 1, pivot <= 2, arm group <= 4, arm joint <= 5,
hips 2, knees <= 10, shadow 1). Record the actual figure.

### 2. Stop paying for invisible bevels

In `dungeon-characters.ts`, give `knightDetails` a plain unit
`THREE.BoxGeometry` instead of the shared rounded `box` for pieces whose
smallest dimension is under 0.06. Keep the rounded box on pieces that are
larger than that on two axes (the three pauldron plates per side) — a rounded
edge on a large plate catches a highlight line that may be visible; the
contact sheet decides. Expected saving: about 1,500–2,000 triangles per knight.
Record the measured figure from `actorStats()`.

Because `dressing()` caches merged geometry by preset and batch index,
changing the inputs changes the cached geometry; nothing else caches it.

### 3. Head over shoulders

| Change | Starting value | Range | Why |
| --- | --- | --- | --- |
| Scale the `head` group uniformly about its own origin | 1.18 | 1.10–1.25 | A bigger helmet is most of what the reference does; the origin sits at the neck, so it grows up and out, not into the chest. |
| Top pauldron plate in `knightDetails` (`i === 0 ? m.steel : m.iron`) | `iron` for all three | — | Shoulders go dark; the brass rim along the top edge (already there) becomes the edge that separates them from the head. |
| A dark gorget between head and shoulders: the existing red `collar` torus | leave red, raise 0.03 | 0–0.05 | Red directly under the helmet puts some red on every facing, including toward the camera. |
| Visor | Tilt the `visor` group and `face` plate forward (rotation.x) | -0.20 rad | -0.10 to -0.30 | At 40 degrees down, a vertical face plate is foreshortened to a line; tilting it toward the camera shows the dark slits. |

The helmet (`steel`) becomes the single brightest large mass on the figure other
than the blade. Do **not** brighten `steel` itself: `docs/art-direction.md` and
the comment above the materials record that the knight's value range was
measured and tuned, and brightening is the lazy route that earlier rounds
rejected.

### 4. Red at every facing, without widening the cape

Add a short red mantle across the back and top of the shoulders, static on the
torso (merged into the torso's `red` batch): one `plate` outline roughly a
shallow trapezoid 0.62 wide at the top, 0.5 at the bottom, 0.16 tall, depth
0.05, at about (0, 0.43, 0.14) in torso space, pitched back 0.5 rad so its broad
face points upward. Starting values; tune within +/-20% so it does not show
through the pauldrons or intersect the cape pivot at `(0, 1.2, .22)` in any
frame of the dash and strike strips. Cost: about 30 triangles.

### 5. Separation measurement (the regression guard for art, not a picture)

Add to `models.spec.ts` a measurement built like the tell test in
`tests/browser/art-direction.spec.ts`: draw the `models-knight-strip` frames
once with the knight visible and once with him hidden, reading pixels
synchronously inside one `page.evaluate` (the renderer does not preserve the
drawing buffer). Pixels that changed are the knight's mask. For each of the 8
facings, compute CIE L* over the mask and over a surround ring 6–14 px wide
around the mask's bounding box. Assert, and log:

- the mask's 75th-percentile L* is above the surround's median in all 8 facings;
- its 25th-percentile L* is below the surround's median in all 8 facings (the
  "found by the range he carries" property `makeKnight`'s comments describe);
- **new**: over the mask's top third (the head), the median L* exceeds the
  median L* of the mask's middle third (shoulders and chest) by at least 8 in
  at least 6 of 8 facings. That is claim 1 above, measured. Record the
  before value from B0-equivalent code by running the measurement before step 3.

Do not tune the threshold to pass. If the "before" code already passes it,
raise the threshold to the before value + 5 and say so in `progress.md`.

### 6. Structural assertions

In `models.spec.ts`: `actorStats().knight.meshes <= 32`; knight triangles no
higher than the value recorded before step 1; knight `height` within +/-0.08 of
the recorded before value (the head grows, nothing else should); all joints in
the snapshot (`torso`, `arm`, `legs`, `knees`, `cape`, `sword`) report the same
rest values as before.

## Steps

1. Status, drift check, all gates on the untouched tree; record.
2. Record `actorStats().knight` and the three budget scenes' counters.
3. Section 1 (bake), then section 2 (bevels). Run `character-life.spec.ts`,
   `dash.spec.ts`, `slash.spec.ts`, `footsteps.spec.ts`, `occlusion.spec.ts`,
   `frame-budget.spec.ts`. The sheet for this step must show **no visible
   change** apart from the bevel trial; investigate anything else.
4. Section 5's measurement on the step-3 tree, to record the before values.
5. Sections 3 and 4.
6. `npm run shots:compare -- --before <B0>`; review at native size: the
   knight strip, `models-cast`, `models-armoury-*`, and the existing dash and
   strike strips frame by frame (the cape, the mantle and the head all move
   through those). Also review one isolated phone capture at 390x844.
7. All gates once. Log in `progress.md`: gates, counters, `actorStats` before
   and after, the separation numbers for all 8 facings before and after, sheet
   path, and a written verdict per claim (1, 2, 3).

## Acceptance

- All gates pass; ceilings unchanged; the three scenes' draw calls at or below
  009's final values and triangles at or below them.
- Knight <= 32 meshes; triangles lower than before the plan even after the
  additions.
- Separation assertions pass, and the head-over-shoulders delta improved by at
  least 5 L* in the median facing.
- Visual: in the knight strip the helmet reads as a separate, larger mass on
  dark shoulders from all 8 facings, and some red is visible in every facing.
  No clipping of mantle, cape or head through anything in the dash and strike strips.

## Stop rules

- If the bake alone changes the image visibly, stop and find out why.
- If the separation guard's first two properties fail after section 3 in any
  facing, back out the pauldron material change first, then the head scale,
  and report which one broke it.
- If the head scale pushes the knight's `height` out of range or clips with the
  crest under the occlusion cutaway, reduce it within range; below 1.10, leave
  the head at 1.0 and report it.
- Do not widen the cape, brighten `steel`, or raise a ceiling to make this pass.
