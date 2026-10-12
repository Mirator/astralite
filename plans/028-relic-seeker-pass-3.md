# Plan 028: The Relic Seeker, pass 3 — values the game camera can read, a poncho with points, motion judged moving

> Executor: read this entire file before editing. It is self-contained. Implement only this plan, one stage at a
> time, in order; each stage has its own gates.
>
> Planned against `main` at `4671572` (PR #106 merged: plan 027), 2026-10-12. Unlike plan 027, a little was
> measured while writing it: one bench sheet and nine gameplay frames, **SwiftShader only, one seed, sample points
> picked by eye** (scratch script, `game/outputs/pass3/`, ignored). Treat those numbers as the reason for a stage,
> not as its baseline: Stage 0 re-measures them properly. Numbers marked *target* are starting values.

## Why

PR #106 closed with a seven-item "what could be improved next" list. This plan takes that list as input, not as
instructions: two of its items name the wrong cause, one proposes a fix that makes the problem worse, and the
biggest problem in the game frames is not on it.

Reference: `plans/relic-seeker-design.md` and `plans/relic-seeker-turnaround.png` (the sheet).

## Findings

| # | Item | What the code and the frames show | Where |
| --- | --- | --- | --- |
| 1 | **The figure is overexposed in game** (not on the PR's list) | Floor 1, idle, facing the camera: the poncho samples `#ffd560`, the cowl `#fec152` (red channel at 255, so it is clipping), the face `#fabd7a`, the hair `#e4955d`, the tunic skirt `#ffe9b9`. That is L* 87 / 82 / 81 / 69 / 93. **The face and the cowl are about 1 L* apart.** The albedos are well separated: hair 35, ochre 62, skin 68, tunic 86. The lighting removes the separation. Ochre, skin and hair all carry warm emissives. On top of that the player has a warm fill (`0xffdfbe`, intensity 46, decay 2), which plan 014 tuned for *dark steel plate and a red cape*, under ACES at exposure 1.42. A matte, light cloth figure under that light clips. | `dungeon-game.tsx` ~576 (tone mapping), ~714 and ~2600 (`fill`); `dungeon-knight.ts` ~296-309 (materials) |
| 2 | "The head merges into one orange shape" (PR item 2) | The symptom is real, but the PR blames the hair, and hair vs skin is the largest albedo step on the figure (33 L*). The merge is **face against cowl**: skin and ochre are 6 L* apart in albedo, have the same hue, and both clip in game (finding 1). Darkening the hair alone leaves the chin sitting in a band of orange. | as above |
| 3 | The bench lies about value | `/bench` lights the figure differently from the game. On the bench the poncho is a mid ochre and the head reads clearly. In game the same model is a near-yellow blob. Plan 027 judged colour on the bench, so every colour decision in this plan is judged **in game frames**, and the bench is used only for shape. | `dungeon-bench.tsx` |
| 4 | The poncho reads as a dome (PR item 1) | The ochre material **is already `flatShading`**. The roundness is in the geometry. `HEM` spreads each point over three columns (`.1, .19, .1` at the front, `.09, .17, .09` at the back), so the point is a blunt trapezoid about 45° wide. The drop then fades linearly over `HEM_FADE` .33 across only 5 profile rings, so no edge forms. The PR's "fewer columns" would make each point a whole octant wide, which is the opposite of what is needed. Sharpening comes from the neighbours' drops and from a ring near the hem, not from the column count. | `HEM`, `HEM_FADE`, `PONCHO` in `dungeon-knight.ts` |
| 5 | The trim is invisible | `poncho-trim` is a vertical band .048 tall (radius .392 → .39). From the camera's pitch it is seen almost edge-on and covers about 3 px at 720p. On the bench it is barely visible, and in game it is gone. The brief wants a thin edge accent, so it should be thin, but it has to be seen. | `poncho-trim` in `KNIGHT_SPEC` |
| 6 | The strap reads as a belt (not on the PR's list) | `STRAP_FROM` [-.32, .375] → `STRAP_TO` [.3, .07] is about 26° from horizontal in the torso's front plane, before the camera's pitch flattens it further. In bench facings 1-3 it is a horizontal band around the chest. The brief names the "dark diagonal strap" as one of the four identifying shapes, and the sheet runs it at roughly 45-55°. | `STRAP_FROM`, `STRAP_TO`, `STRAP_BAG` |
| 7 | Pale blocks compete with the poncho | `sleeve-r` (a pale box, .15×.27×.16) sticks out under the right slit like a pauldron in facings 1-3. `tunic-skirt` (pale, r .29-.32) clips to L* 93 in game, the brightest thing on the figure. The brief makes the poncho the dominant shape; right now the brightest one is the skirt. | `sleeve-r`, `tunic-skirt`, `body` |
| 8 | Boots and bag (PR item 5) | Boot `0x7a4e32` is L* 37.5 and leather `0x6a4a38` is L* 34.5, 3 L* apart, so the PR is right. Lighten the boots, not the bag: the bag hangs over the dark trousers, so darkening it would lose it. | materials |
| 9 | Hair tufts | Four `unitSpike` tufts and two fringe spikes. On the bench at zoom they read as small horns on the crown. The brief says "avoid exaggerated hair spikes". This is minor, and it gets cheaper to fix once the value fix lands. | `tuft-*`, `fringe-*` |
| 10 | Motion (PR item 3) | The turn into a sprint read .084 against a .07 target, and that measurement was taken before the spring was stiffened. The free elbow passes .009 outside the diagonal's edge mid-run, and B-test 3 holds the elbow **only at rest**, so it would not catch a run-time clip. No one has looked at the motion as motion. | `dungeon-cloth.ts`, `tests/dungeon-figures.test.ts` |
| 11 | Menu backdrop (PR item 4) | This is real but cosmetic. It is fixed in `scripts/backdrop.ts`, not in the game. | `scripts/backdrop.ts` |
| 12 | Mesh-budget wins (PR item 6) | **Rejected.** The figure is 32 of 64 meshes, and the scenes are at roughly 400 calls, so one call is 0.25%. Merging the cowl into the poncho would also take away the cheapest lever for finding 2: the cowl is already its own unbaked mesh, so it can wear its own material for 0 extra calls. | — |
| 13 | `models-drop-crossbow` (PR item 7) | This is a capture-fixture bug in `shots.spec.ts`/`helpers.ts`, not the model. It is **out of scope** here and is filed as its own task. | — |

## Decisions

| ID | Item | Decision |
| --- | --- | --- |
| D1 | Which lever fixes the exposure | **Recommended: the figure's materials, not the fill light.** Drop the emissives on ochre, skin and hair (or cut them to a quarter). Lower ochre's albedo toward the sheet's mid ochre under game light. Pull the tunic down. The fill is shared with the floor pool, with the enemies next to the player and with the art-direction tests, and retuning it is a scene-wide change. Use the fill only if the material route cannot reach the targets without the bench looking muddy, and then **ask the operator first**. *Open: operator to confirm.* |
| D2 | Separating face from cowl | Give the cowl its own material, a darker and slightly redder ochre (start `0x9a6326`), so a value step sits under the chin. It costs 0 calls because the cowl is already its own mesh. Plan 027's 0.06 chin gap stays. Darkening the hair toward the sheet's `0x382820` is the second lever, judged in game after D1 and the cowl. |
| D3 | Poncho points | Keep 16 columns. Sharpen with the neighbours' drops and one extra profile ring near the hem. Do not lower the column count. |
| D4 | Strap | Steepen it to ≥ 40° in the torso's front plane, ending lower and nearer the front point. Keep left shoulder → right hip, and keep the satchel's hinge on the strap's end (plan 027 B-test 5). |
| D5 | Pale underlayers | Shrink `sleeve-r` to a sleeve, not a block (narrower, rounded, shorter), and pull the tunic's albedo down so it stays the second-brightest shape, below the trim. |
| D6 | Budget | This is a shape and value pass. **No new mesh** is expected (a material swap on an unbaked mesh, an extra lathe ring, and a reshape all cost 0 calls). If a stage adds one, the scene ceilings rise by +2 calls each, and the step is recorded as in plan 027 Stage C. |
| D7 | Is the read a gate test | **Yes, one.** Plan 014's fill retune caused finding 1 silently, because nothing held the figure's value structure. One pooled scenario in `art-direction.spec.ts` holds it (Stage A, A-test 1). The three geometry rules are node tests. Motion stays scratch-and-eye, apart from the existing `sprint.spec.ts` wiring. |

## Targets

Measured **in game**: floors 1, 2 and 3, idle facing the camera, using the Stage 0 read script. Every number is a
*target* until Stage 0 confirms the "today" column.

| Quantity | Today (this plan's eyeball sample) | Target |
| --- | --- | --- |
| Figure pixels with any channel at 255 | poncho and cowl clip | ≤ 2% of the figure's pixels |
| ΔL* face vs cowl, at the chin | ~1 | ≥ 12 |
| ΔL* face vs hair | ~12 | ≥ 15 |
| ΔL* poncho vs tunic skirt | ~6, skirt brighter | ≥ 8, **poncho brighter** |
| Poncho mean L* | 87 | 60-75 (ochre, not yellow) |
| ΔL* boot vs satchel (albedo) | 3 | ≥ 8 |
| Front point: the neighbours' drop / the point's drop (columns 7, 9 vs 8; 15, 1 vs 0) | .53 | ≤ .3 |
| Front and back point, lowest world y | .78 / .80 | unchanged ±.03 (plan 027's A-test 2 still holds) |
| Trim: projected height at the camera's pitch | ~3 px at 720p | 4-6 px, and visible in the frame's ID mask from facings 0, 1, 7 |
| Strap angle, front plane, shoulder → hem | ~26° | ≥ 40° |
| Free elbow outside the poncho, all 64 run phases at top speed | .009 at worst | ≥ .02 |
| Hem on a turn into a sprint | .084 (stale) | re-measure first, then ≤ .07 or record why not |
| Meshes / triangles | 32 / 1,808 | 32 ± 1 / ≤ 2,200; ceilings stay 64 / 9,975 |

## Stages

### Stage 0 — Measure what the game draws

1. `git switch -c art/relic-seeker-pass-3 origin/main`.
2. **A read script with an ID pass** (scratch, `game/outputs/relic-read.ts`, ignored). It reaches the scene the way
   `tests/browser/figure-mask.ts` does (the devtools hook, an init script, a reload).
   - For each pose, draw the frame twice inside one evaluated task. The first draw is normal. In the second, every
     material on the player is swapped for a `MeshBasicMaterial` in a unique flat ID colour, one per **source
     material** (ochre, cowl once it exists, trim, skin, hair, pale, red, leather, boot, trousers, relic), with tone
     mapping off for that draw.
   - The ID frame tells you which pixel belongs to which part. The normal frame gives each pixel's rendered colour.
   - Report per part: pixel count, mean L*, the share of pixels at 255 in any channel, and the ΔL*s in the Targets
     table. Report "face vs cowl" over the pixels within 3 px of the boundary between the two parts, so the number is
     taken at the chin, not averaged over the whole garment.
   - Poses: idle facing the camera, idle side-on, and 450 ms into a run, on floors 1, 2 and 3 (`dungeonTest.buildFloor`)
     and in the hall. Same seed, renderer recorded.
3. A geometry script (`game/outputs/relic-metrics.ts`, as in plan 027) extended with these rows: neighbour/point
   drop ratio, the trim's projected height (project the trim's rings through the game camera's pitch, read from
   `dungeon-game.tsx`), the strap angle (fit a line through the strap's front-run vertices in torso x-y), and the free
   elbow's worst margin over 64 phases.
4. Capture the "before": the bench (`npm run figures -- --figures knight`), the read script's table, and its crops.
   Record all three in progress.md, with the renderer and date.

Gates: `npm run typecheck`, `npm test`.

### Stage A — Values (D1, D2, D5 colour half, finding 8)

1. Materials in `makeKnight` (`dungeon-knight.ts` ~296):
   - emissives on ochre, skin and hair down to ≤ ¼;
   - ochre albedo down until the poncho's in-game mean L* is 60-75;
   - a new `cowl` material (start `0x9a6326`, flat-shaded like ochre), worn by the `cowl` mesh;
   - tunic `pale` down until the skirt sits below the poncho;
   - boot up to about L* 45 (start `0x94603c`).
   
   Iterate with the read script, not by eye on the bench. The trim keeps its cream: it is supposed to be the brightest
   line.
2. If the targets cannot be met without the bench looking muddy, stop and take D1's fallback to the operator. Do not
   change `fill` or `toneMappingExposure` without their answer.
3. Only then judge the hair. If face vs hair is < 15 in game, move the hair toward `0x382820`, and check the hair
   against the darkest floor in the read script's crops (it must not vanish into the floor).
4. **A-test 1** (`tests/browser/art-direction.spec.ts`, one pooled scenario):
   - Setup: floor 1, idle, the knight facing the camera. Use the ID-pass technique from Stage 0, moved into a helper
     next to `figure-mask.ts`.
   - Assert: the figure's clipped share is ≤ the measured value + margin; face vs cowl ΔL* at the chin is ≥ the
     measured value − margin; the poncho is brighter than the skirt.
   - Precondition: each part's ID mask holds ≥ N pixels (the measured count × .5), so an empty mask fails rather than
     passes.
   - Log the numbers. Write the measurement, renderer and date beside the bounds. Bound both sides, so a black figure
     fails too: set a floor on the poncho's mean L*.
   - Plants: restore the old emissives, which fails the clip and chin checks with their own messages; the cowl back on
     `ochre`, which fails the chin check; `fill` at 92 (double), which fails the clip check. That last plant is the
     regression this test exists for.
5. Node: no rule changes, so no node test here. Say so in the commit.

Visual: read-script crops from floors 1-3, and the hall. The bench is used only to check that nothing went muddy.

Gates: typecheck, lint, `npm test`, the browser gate.

### Stage B — Shape (D3, D4, D5 shape half, findings 5, 9)

1. **Points.** In `HEM`, bring the point's neighbours down to ≤ .3 × the point's drop (front: columns 7 and 9 to about
   .05; back: columns 15 and 1 to about .05). Keep the point drops, so plan 027's A-test 2 window still holds. Add one
   `PONCHO` ring about .06 above the hem ring, so the drop's fade bends there and a facet edge forms. If the diagonals
   then sit outside .92-1.00, re-tune their drops and say so.
2. **Trim.** Make it a flared band: the bottom ring out by about .015 and down, so it faces the camera's pitch instead of
   being seen edge-on. Its height goes to about .06. Target: 4-6 px projected. Keep it one mesh.
3. **Strap.** Move `STRAP_TO` lower and toward the front point (start [.18, -.04]), with `STRAP_BAG` to match, so the
   front run is ≥ 40°. The satchel hinge and plan 027's B-test 5 anchor rule hold.
4. **Sleeve.** Replace `sleeve-r`'s box with a rounded, narrower sleeve (a short cylinder or `roundedUnitBox` at about
   .11 × .22 × .12) that sits inside the slit's shadow. Plan 027's hand test still passes.
5. **Hair.** Shorten the four tufts and two fringe spikes by about 40% and lay them flatter (a smaller `rot.x` toward the
   skull). They are still 6 meshes merged into the hair batch: no change in calls.
6. Tests (`tests/dungeon-figures.test.ts`, each measuring the built tree):
   - **B-test 1, points:** for the front and the back, the neighbours' lowest world y sits ≥ .1 above the point's.
     Plant: plan 027's `HEM`.
   - **B-test 2, trim faces the camera:** the trim's bottom ring is at a larger radius than its top ring in every
     column, and its projected height at the game pitch is ≥ the floor set from the measurement. Plant: today's
     vertical band.
   - **B-test 3, strap diagonal:** the line fit over the strap's front-run vertices (torso x-y) is ≥ 40°. Precondition:
     ≥ 6 vertices in the front run. Plant: today's `STRAP_TO`.

Gates: typecheck, lint, `npm test`, the browser gate (A-test 1 must still pass, since the shapes change which pixels are
which).

### Stage C — Motion, judged moving (finding 10)

1. **A sequence recorder** (scratch, `game/outputs/relic-motion.ts`): step `advanceTime(1000/60, true)` and read the canvas
   each step through a scripted path. The path is idle 0.5 s → sprint right 1 s → a turn to down while sprinting →
   dash → stop → idle 1.5 s → a strike with each arm. Crop around the player and encode with `ffmpeg` to
   `outputs/relic-pass3/motion.mp4` at 60 fps, plus a 0.25× slow version.
   - This is deterministic, because the clock is `advanceTime`, so a before and an after can be compared frame for
     frame.
   - Record "before" first.
2. **Elbow under the cloth.** Extend plan 027's B-test 3 so that it holds the free elbow (not only the glove and fist)
   outside the poncho by ≥ .02 at **all 64 run phases** at top speed, not only at rest. Run it on today's code first:
   it should fail at about .009, which is the planted bug already present. Then fix it, either with a wider slit
   (diagonal neighbours of 4/12) or a smaller elbow `arm` swing. Prefer the swing if the slit would read as a hole on
   the bench.
3. **Turn into a sprint.** Re-measure the hem through the recorder's turn. If it is > .07, lower the yaw-rate gain
   (`.03` per rad/s) before touching the spring. Record the before and after values.
4. **Tune by eye from the video.** The hem should trail a start by a beat and settle without a second visible bounce.
   The satchel should swing less than the hem. Any constant changed here keeps plan 027's `dungeon-cloth.test.ts`
   bounds; if one has to move, show from the video why the old bound was wrong.

Gates: typecheck, lint, `npm test`, the browser gate (`sprint.spec.ts` covers the wiring).

### Stage D — Menu, baseline, records

1. **Backdrop** (`scripts/backdrop.ts` only): frame the figure larger. Read the player's projected screen position
   before the canvas read. Crop and scale the canvas around a point at about a third of the width from the right (the
   menu covers the left half), and keep the output at its present size. Then `npm run backdrop`. Check it at 1280×720 and
   on a phone viewport.
2. **Baseline:** as plan 027 Stage D (SwiftShader, two captures, overwrite `output/shots/baseline/*.png`, regenerate
   `STABILITY.txt`).
3. `game/progress.md`: append a "plan 028" entry with these items:
   - the before/after read table per floor;
   - the before/after geometry rows;
   - every planted bug and the message it failed with;
   - the motion video paths;
   - D1's outcome;
   - budgets: unchanged, or the measured +2 steps.
   
   `plans/README.md`: add a row.

Gates: typecheck, lint, `npm test`, the PR-gate browser run, `npm run build`. Publishing is opt-in, per AGENTS.md.

## Risks

- **Reading the game's colour off SwiftShader.** The plan's eyeball sample came from SwiftShader. ACES and the lights are
  the same on d3d11, but GTAO and bloom quality differ. Run the read script on both renderers in Stage 0. If the two
  disagree by more than a few L*, set the A-test 1 bounds from the lower-margin one and write both values down.
- **A-test 1 flakes.** It is a pixel test on a pooled page. Use the margins from two repeats plus a buffer. It reads
  means over hundreds of pixels, not single pixels. If it flakes under `--repeat-each=3`, widen the margin from the
  measured spread. Do not drop the test.
- **The fill light does more than light the figure.** If D1 falls back to the fill, the floor pool around the player and
  every enemy next to him change. That is the operator's call, and the art-direction telegraph test has to be re-run.
- **Sharper points vs the hem deform.** A sharper V concentrates the hem drop on one column. `swayCloth`'s radial push
  must still keep that column outside the tunic. Plan 027's cloak B-test 2 grid covers this. If it fails, fix the push,
  not the grid.

## Out of scope

The fill light and exposure (unless the operator answers D1's fallback); weapon models; enemies; combat rules; the HUD;
renaming identifiers; mesh-count cuts (finding 12); the `models-drop-crossbow` capture (finding 13, its own task).
