# Plan 027: The Relic Seeker, pass 2 — proportions, a poncho that moves, budgets, baseline, menu

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan, one
> stage at a time, in the order below; each stage has its own gates.
>
> Planned against `main` at `4269398` (PR #105 merged, the Relic Seeker
> redraw), 2026-10-12. Source was read; **nothing was run or measured while
> writing it.** Every number marked *target* is a starting design value to be
> confirmed on the bench and in game frames; every number marked *measured*
> must come from your own run. Line numbers drift; search for the names.
> The operator's decisions (2026-10-12) are recorded as **Settled**.

## Why

Operator request, verbatim:

> "Raise budget for the player by 2X. it feels currently weird and not dynamic enough, the poncho is super weird, the
> head looks too small. then fix the outut/shots/baseline and the main menu"

Reference: `plans/relic-seeker-design.md` and `plans/relic-seeker-turnaround.png` (the sheet). Recent renders of the
current figure: `game/outputs/critique/r3-*.png`, `game/outputs/assess/*.png` (ignored folder, may be absent).

## Findings (what the code does today)

| # | Item | Today | Where |
| --- | --- | --- | --- |
| 1 | Figure budget | `dungeon-figures.test.ts` caps the knight at meshes 29..32, triangles 1800..4987 (`floor(3990*1.25)`), height 1.8243±0.08. Measured at PR #105: 31 meshes, 1876 triangles, 1.822 tall. **Meshes bind**, triangles do not. Its comments still cite `models.spec.ts`, deleted in `73ba0ad`; the `dungeonTest.actorStats()` hook it mirrors still exists (`dungeon-game.tsx` ~2773, `helpers.ts` `actorStats`). | `game/tests/dungeon-figures.test.ts` |
| 2 | Scene budgets | `frame-budget.spec.ts`'s `BUDGET` has 14 keys but **only two are live**: `flooded-hall` and `wave-chamber` are the only `spend()` calls. The other 12 (`widest-chamber`, `strike-contact`, `caller-chamber`, the five boss chambers, `furnished`/`plain-chamber`, `bomber`/`guard-pair`) lost their scenes in `7d093d1` ("delete PR-gate tests that never caught a bug") and are dead data. Both live ceilings were measured on **SwiftShader**; the file says d3d11 disagrees by up to 13 calls on some scenes. Every kept, shadow-casting knight mesh costs about +2 calls (scene pass + shadow pass) in each scene. | `game/tests/browser/frame-budget.spec.ts` |
| 3 | What moves | Animated: hips and knees (`playerRunPose`), the free arm's x only (one rigid box chain, no elbow), the sword pivot, torso pitch/twist, bob, dash tilt, the tabard (rigid plate, `max(hip)*.85`), the back point (`animateCloth` + damped pitch). **Rigid, baked into the torso batch:** the whole poncho incl. front point and side hems, the cowl, the strap, the satchel, the relic, head and neck. Idle is nearly static (`playerRunPose(_,0)` is all zeros by test; only a .012 bob). The brief asks for a small delayed hem response and allows bag sway. | `dungeon-knight.ts`, `dungeon-run-pose.ts`, `dungeon-game.tsx` ~1020-1027, ~1914, ~2125-2137, `dungeon-motion.ts` `animateCloth` |
| 4 | Poncho shape | (a) Side hems ride **up** (`HEM` -.1 at columns 2/6): side hem at world ~1.12, so the whole upper arm shows and the garment reads as a bib/lampshade; the sheet hangs it to the elbows. (b) One steep cone (~40° from horizontal, r .44→.22 over .29) with eight even facets, against the sheet's flatter ~20-25° shoulder yoke then a drape. (c) The back point is a separate flat plane (`buildCape`) that reads as a fin/wing; lift had to be cut to .15-.21 run / `DASH_CAPE` .22 to stop it winging. (d) The cowl is a stiff octagonal ring with its top a hair under the chin. (e) The front V never moves. | `PONCHO`, `HEM`, `COWL`, `buildCape` in `dungeon-knight.ts` |
| 5 | Head reads small | Head (chin to hair top) is already ~24% of height, more than the sheet's ~16-18%. It reads small because of the body: legs (sole to hip pivot, .06→.54) are ~26% of height against the sheet's ~40-44%; the poncho is wide (hem r .46 + trim .47) and tall; the cowl swallows the chin; dark hair (0x5a3f30) on a dark floor. | `KNIGHT_SPEC` in `dungeon-knight.ts` |
| 6 | Baseline | `output/shots/baseline/`: 62 PNGs (6 scenes, `strike-seq-00..31`, `dash-seq-00..23`) from 2026-09-19 showing the old knight, old HUD, old rooms, plus `STABILITY.txt` (tracked; the PNGs are git-ignored by `output/**/*.png`). `STABILITY.txt` is a two-run SwiftShader pixel diff, one line per frame, sorted by changed share: `<name>.png changed=<n>/700000 (<p>%) worst=<w> mean=<m> box=[x0,y0,x1,y1]`. The scene list differs from today's `shots.spec.ts` (all of it `@capture`, including a `models` block: `models-armoury-*`, `models-knight-strip-*`, `models-cast`, `models-drop-*`). `scripts/shots/compare.ts` treats `output/shots/baseline` as SwiftShader by path (`glOf`), so no `meta.json` is needed there. | `output/shots/baseline/`, `game/tests/browser/shots.spec.ts`, `game/tests/README.md` "Before and after" |
| 7 | Main menu | `game/public/keep-backdrop.jpg` (tracked, from plan 015) shows the old plate knight. `npm run backdrop` (`scripts/backdrop.ts`: port 3200 or `GAME_TEST_PORT`, seed 0x1, presses ENTER, reads the canvas) rewrites it. The only user-facing "knight" text is one sentence in the Controls menu, `dungeon-game.tsx` ~3099: "A cursor over the keep aims every swing, so the knight can retreat and cut behind him." Every other "knight" is a comment or an identifier. | `scripts/backdrop.ts`, `dungeon-game.tsx` |

Contracts other code relies on (keep them, or change the listed consumers in the same stage):

- `userData.arm`, `legs` (each hip with `userData.knee`, `userData.boot` = the bare `boot` sole node footsteps read), `cape`,
  `tabard`, `body`, `torso`, `sword`, `armoury`, `armed`.
- `tests/browser/enemy-mask.ts` finds the knight by `userData.cape && userData.torso`; `figure-mask.ts` by `userData.armed &&
  userData.sword`; `dungeon-bench.tsx` swaps arms under `userData.sword`. (Neither mask helper is imported by a spec today; keep
  the keys anyway.)
- `dungeon-game.tsx` `posePlayer` resets `sword.position.set(.44,.3,-.02-pose.armReach)` every frame; `SWORD_PIVOT_SPEC.at`
  must match it.
- The snapshot's `player.cloak` (`{anchor, pitch}`) and `player.locomotion` (`speed, phase, sprint, pitch, height, arm, tabard,
  knees`). `sprint.spec.ts` compares the whole `locomotion` object before and after a pause, holds idle `pitch` and `tabard`
  under .01 and running `tabard` over .1. No spec reads `cloak`.
- The bake: `bakeStatic(torso, { keep: [...] })` merges every plain mesh not under a kept subtree, one batch per material and
  shadow flag; a new kept subtree needs its own `bakeStatic` call with its own `cacheKey`, and `dungeon-figures.test.ts`'s
  cached-rebuild fingerprint covers it automatically.

## Decisions

| ID | Item | Decision |
| --- | --- | --- |
| D1 | Budget | **Settled: double the caps and re-measure.** Figure caps: meshes ≤ 64, triangles ≤ 9,975 (2 × 4,987). Floors re-set from the new measurement. The room is spent on motion (kept poncho, satchel, head, elbow) and shape (more lathe columns and rings, a separate cowl), **not** on parts added to fill it: the cap is a ceiling, not a target. Expected landing: 33-40 meshes, 2,500-4,500 triangles. Re-measure the scene ceilings the figure moves and write reason, renderer and date beside them. |
| D2 | Head | **Settled: toward the sheet by changing the body.** Keep the head's geometry (≤ 10% uniform scale allowed only as a last lever, Stage A step 6). Longer legs, a smaller and flatter poncho, a lower and looser cowl so chin and neck show, hair/skin contrast. Overall height stays inside the existing 1.8243 ± .08 band (the brief asks to preserve it), so `dungeon-art.ts` `headroom` (head at ~+1.2 screen-up), `contactShadow(.62,.74)`, the bench camera and the footstep sole need no change. If the band cannot hold, see Risks. |
| D3 | Baseline | **Settled: regenerate locally on SwiftShader and overwrite `output/shots/baseline/`** (the operator approved overwriting `output/` for this). `STABILITY.txt` regenerated from a two-capture diff in its existing format. The new baseline includes the `models` capture frames. |
| D4 | Menu | **Settled: regenerate `keep-backdrop.jpg` with the new figure and fix the one "knight" sentence.** Identifiers (`makeKnight`, `knight` cache keys, `userData`) are not renamed. |
| D5 | The back point | The separate `buildCape` plane is deleted. The back point becomes the back column of the **same** poncho lathe (a long drop like the front's), so it is one garment. `userData.cape` keeps its key and now points at the kept poncho **mesh**. |
| D6 | Cloth motion | One damped follower (the *hem state*) drives a radial/positional sway of every vertex of the kept cloak group, weighted 0 at and above the shoulder break and 1 at the hem. It replaces both `animateCloth` on the cape and the cape's whole-mesh pitch. The rule is pure (arrays and numbers, no Three.js) so node runs it. |
| D7 | Frame budgets | Re-measure `flooded-hall` and `wave-chamber` on SwiftShader, before and after, and raise their ceilings to the measured figures. Delete the 12 orphaned `BUDGET` entries with one comment line naming `7d093d1`: they bound nothing, and re-stating numbers for scenes that are never drawn would be invented data. (The operator asked for "all 11 scenes"; there are two live ones. Record this in progress.md.) |

## Targets

All world heights assume the knight standing at rest at `player.position.y` .03 (the game's idle base). Measure them with
the Stage 0 script, not by eye.

| Quantity | Today (from source; confirm in Stage 0) | Target |
| --- | --- | --- |
| Overall height (`drawCost` in `dungeon-figures.test.ts`) | 1.822 | 1.80-1.90 (inside 1.8243 ± .08) |
| Leg share: (hip pivot y − sole y) / height | ~.26 (hip .54, sole .06) | ≥ .36, stretch .40 (hip pivot ~.72-.80) |
| Head: chin to hair top, and head width | unchanged geometry | unchanged (±10% only via step A6) |
| Head width / poncho hem width (x, incl. trim) | ~.33 / .94 ≈ .35 | ≥ .42 |
| Poncho max half-width (x, incl. trim) | .47 | ≤ .40 |
| Shoulder yoke slope, neck ring to shoulder break, side silhouette | ~40° | 20-25° |
| Lathe columns | 8 | 12 or 16 (16 preferred: the slit and the points need the resolution) |
| Front point, lowest vertex (column at 180°) | world ~.76 | world .74-.82, below the sash |
| Back point, lowest vertex (column at 0°) | separate plane | world .74-.84, same lathe |
| Diagonal hems (45°, 135°, 225°, 315°) | world ~1.0 | world .92-1.00 (around the elbow) |
| Arm columns (90°, 270°) | world ~1.12 (riding up) | a slit: the hem there may rise to the shoulder break; exact width set by the hand test (B-test 3) |
| Cowl top vs chin (head-local chin = face centre y − .2) | ~.01 under | ≥ .05 under the chin, neck visible from facing 0 |
| Sword pivot world height at rest | ~1.06 (.76 + .3) | 1.02-1.10 (keep the weapons' screen read) |
| Meshes / triangles | 31 / 1876 | 33-40 / 2,500-4,500 expected; ceiling 64 / 9,975 |
| Hem sway | — | hem displacement ≤ .12 at a dash, ≤ .07 at a sprint, < .003 within 1.0 s of stopping |

## Stages

Order is strict. Budgets are re-measured in Stage C, after shape and motion settle, because they depend on the final counts.
Run heavy work serially: one browser run, one bench run, one dev server at a time.

### Stage 0 — Branch, raise the figure caps, measure today

1. `git fetch origin`, compare `origin/main` with `4269398`; if main moved, read what changed in the files this plan touches
   before starting. `git switch -c art/relic-seeker-pass-2 origin/main`. `output/keep-fire/` is untracked and not yours; leave it.
2. `dungeon-figures.test.ts`: raise the caps to `meshes <= 64` and `triangles <= 9975` (write: "Owner decision 2026-10-12:
   the player's budget doubled, 2 × 4,987"). Keep today's floors (29 meshes, 1800 triangles) provisionally; Stage C sets the
   real ones. Fix the two stale comments: `models.spec.ts` was deleted in `73ba0ad`; this test is now the only place the
   knight's draw cost is held, and `dungeonTest.actorStats()` still reports the same numbers off the live knight.
   Plant: set `meshes <= 30` and watch it fail with "the knight is drawn as 31 meshes"; restore.
3. Write a scratch node script `game/outputs/relic-metrics.ts` (git-ignored; run with
   `node --experimental-strip-types outputs/relic-metrics.ts` from `game/`) that builds `makeKnight()`, calls
   `updateWorldMatrix(true,true)`, offsets by y .03, and prints every row of the Targets table off the built tree: height,
   hip pivot and sole world y and the leg share, head width and chin/top, poncho half-width, the lowest world y of each lathe
   column (read the poncho geometry's position attribute, group vertices by `atan2(x, z)`), the yoke slope, the cowl top vs
   chin gap, the sword pivot world y, meshes and triangles (copy `drawCost` from the test). Record the output in progress.md
   as the "before". It is the measuring stick for Stages A and B; keep it until Stage F, then delete it or leave it in
   `outputs/` (ignored).
4. Measure the two live scene budgets **before** any figure change, on SwiftShader (no `GAME_TEST_GL`):
   `npm run test:browser -- frame-budget.spec.ts --repeat-each=2` from `game/`, and keep the `BUDGET flooded-hall ...` and
   `BUDGET wave-chamber ...` lines (calls, triangles, geometries, textures). If either already fails on main, stop and report:
   the ceiling is stale for a reason that is not this plan.
5. Capture the "before" bench: `GAME_TEST_GL=d3d11 npm run figures -- --figures knight --weapon all`, copy
   `outputs/figures/latest.png` to `outputs/figures/relic-pass2-before.png`.

Gates: `npm run typecheck`, `npm test`.

### Stage A — Proportions and the poncho as one garment (D2, D5)

All in `game/app/dungeon-knight.ts` unless named. Keep the file's voice: every number gets a one-line reason.

0. **Keep what the tests and Stage B must reach out of the torso bake (rigid for now).** `bakeStatic(torso, …)` removes
   every merged part from the tree, so after it there is no `poncho`, `cowl` or `face` node to measure. In this stage:
   - a `cloak` group under `torso` holding `poncho`, `poncho-trim`, `strap` and (step 5) `cowl`, **not baked** (Stage B deforms
     each mesh). `userData.cape` = the `poncho` mesh, `userData.cloak` = the group.
   - `head` kept and baked on its own (`cacheKey: 'knight:head'`, skin and hair: 2 meshes), `userData.head`. Before its bake,
     add a bare `chin` node at the face's lowest point (face centre y − face radius y), the way the boot's `sole` node is made,
     and set `userData.chin`, so tests read the chin off the built tree instead of restating the spec.
   - `torso`'s bake keeps `[cloak, head, tabard, swordPivot, arm]` (Stage B adds `satchel`). Say in the commit that the batch
     order moved and why (the file's ordering note).
1. **Legs.** Lengthen the thigh and shin so the hip pivot rises to ~.72-.80 with the sole still at ~.06: `hip-l/-r` `at.y`,
   `leg-*` box height and offset, `knee-*` offset, `shin`/`wrap`/`boot` offsets. Keep the boot's shape and the `boot-shape-*`
   name (the sole node copies its transform). Keep the leg boxes narrower than the tunic skirt.
2. **Torso.** Raise `torso.at.y` by the hip's rise minus the torso shortening, and shorten the tunic (`body` cylinder height and
   offset, `tunic-skirt`) so the head's world height moves by ≤ +.04 and the total stays inside the band. The sash stays the
   waist, the skirt still covers the hip joints at a stride (check facing 2 and 6 mid-sprint).
3. **Shoulder, arm and sword pivot.** Put the free arm's pivot (`ARM_SPEC.at`) at world ~1.26-1.32 (shoulder under the yoke).
   Export one constant from `dungeon-knight.ts`, `export const SWORD_PIVOT = { x, y, z } as const`, use it in
   `SWORD_PIVOT_SPEC.at` **and** in `dungeon-game.tsx` `posePlayer` (`sword.position.set(SWORD_PIVOT.x, SWORD_PIVOT.y,
   SWORD_PIVOT.z - pose.armReach)`), and pick its torso-local y so the pivot's world y stays 1.02-1.10. That removes the
   "keep the two in step" comment's reason to exist; replace it. x may move out to ≤ .5 if the hand test needs it.
4. **Poncho profile.** Rebuild `PONCHO`/`HEM` for 16 columns (`ponchoLathe(profile, drops, segments = 16)`;
   `hemDrop`/`ponchoSurface`'s `% 8` and `Math.PI / 4` become `% columns` and `2π / columns`, one constant `COLUMNS`):
   - a neck ring at the cowl's foot, a flat yoke out to a shoulder break at r ~.36-.38 falling at 20-25°, then a drape that
     hangs nearly vertical (≤ 15° outward) to a hem at r ≤ .38 (≤ .40 with the trim);
   - per-column drops (`HEM`, now 16 entries) giving the Targets table's points: a long front point (180°), a long back point
     (0°) as long as or a little shorter than the front, diagonals at the elbow, and a slit at the arm columns (90°, 270°, and
     their neighbours as far as the hand test needs) whose hem may rise to the shoulder break so the sleeve, glove and fist
     come out of the side opening;
   - bake `PONCHO_DEPTH` into the geometry (`geometry.scale(1, 1, PONCHO_DEPTH)`) and drop the node `scale`, so the cloth
     deform in Stage B works in one frame for poncho, trim and strap alike; `ponchoSurface` applies the same factor to z.
   - `poncho-trim` follows the new hem through the same drops (as today).
   Facets stay flat-shaded (sheet look) but no longer even: give alternate columns a small radial jitter (±.01) so it reads as
   cloth, not an octagon. No `Math.random` (the fingerprint test needs determinism): a fixed table.
5. **Cowl.** Split the cowl out of `PONCHO` into its own lathe `cowl` (ochre, 12-16 columns): looser (r ~.26-.30 at the top,
   wider than the neck by ≥ .1), lower (its top ≥ .05 under the chin), falling lower at the front than the back (keep `COWL`'s
   idea, re-tuned), resting on the yoke. The strap still ends on the yoke, not the cowl.
6. **Back fin out.** Delete `buildCape` and its splice; the back point is the lathe's 0° column (step 4). In
   `dungeon-game.tsx` remove both the cape's `animateCloth` call (~1914) and the cape pitch damp (~2136): the poncho is rigid
   until Stage B (`animateCloth` must never run on the lathe: it displaces z by a hanging-plane rule and would fold the front
   point into the body). Keep `animateCloth` itself; the banners and `dungeon-skeleton.ts` use it. `DASH_CAPE` and
   `playerRunPose().cape` stay exported and unused for one stage; Stage B re-purposes them.
7. **Head readability.** Hair to a warmer, lighter brown with a small emissive (start 0x6e4a33 / emissive 0x140b06), skin a
   touch lighter (start 0xd29a74); judge both on the bench and in a gameplay frame on the darkest floor theme. Only if the
   head still reads small after steps 1-6 in game frames, scale the `head` group uniformly up to 1.1 and re-check the height
   band; record which you did.
8. **Satchel and strap** follow the new hem and hip: `STRAP_FROM`/`STRAP_TO`/`STRAP_BAG` and the satchel `at`, so the strap
   still runs left shoulder → right hip across the front and the bag sits on the right hip, visible from the game camera.

Tests (node, `tests/dungeon-figures.test.ts` unless named; each measures the built `makeKnight()` tree):

- **A-test 1, proportions:** leg share ≥ .36; height inside 1.8243 ± .08 (existing assertion); poncho half-width ≤ .40;
  head-width/hem-width ≥ the floor set from the Stage 0 measurement (target .42; define head width as the head group's world
  bounding-box x, ears included, in the Stage 0 script, and use the same definition here). Precondition: the `poncho` mesh is
  found by name under `userData.cloak` and has ≥ 16 × profile-length vertices.
  Plant: restore today's hip `at.y` .54 → the leg-share assertion fails with its own message.
- **A-test 2, hem heights:** read the poncho's position attribute after `updateWorldMatrix`, group by column angle, assert the
  front point's lowest world y is in .74-.82 and the back point's in .74-.84, both below the sash's world y, and the four diagonals in .92-1.00.
  Plant: restore the old `HEM` → fails naming the column.
- **A-test 3, the cowl clears the chin:** the `cowl` mesh's highest world vertex in the front half (torso-local z < 0) is ≥ .05
  under `userData.chin`'s world y. Precondition: the cowl and the chin node are found. Plant: raise the cowl top by .06.
- **A-test 4, one garment:** no mesh named or carrying the old cape (no `PlaneGeometry` under the torso), and `userData.cape`
  is the poncho mesh. Plant: restore `buildCape` → fails.
- `tests/dungeon-cloak.test.ts`: its seam (11 vertices), tip (`12*11+5`) and plane-based checks die with the plane. **Rewrite
  it in Stage B** against the new cloth (see B-test 2); until then mark nothing skipped: if Stage A lands as its own commit,
  replace its body with the A-test 4 assertion and a comment "rewritten in Stage B", so the suite stays honest.

Visual verification (every stage A and B iteration):

- Bench: `GAME_TEST_GL=d3d11 npm run figures -- --figures knight --weapon all` and `-- --figures knight --zoom 2.4`; compare
  `outputs/figures/previous.png` / `latest.png` and the Stage 0 "before". Check: head distinct above the cowl in all eight
  facings, chin and neck visible in facings 0, 1, 7; the strap a clear diagonal; bag on the right hip in 0-3 and 5-7; front
  and back points read from the side facings (2, 6); no hand inside cloth with any arm.
- Gameplay frames: see "Gameplay frame recipe" below: idle, sprint, dash, facing the camera.

Gates: typecheck, lint, `npm test`.

### Stage B — Secondary motion (D6)

New pure module `game/app/dungeon-cloth.ts` (no React, DOM or Three.js imports: add it to AGENTS.md's "Keep pure rules pure"
list in Stage F). Pure additions to `dungeon-run-pose.ts`. Wiring in `dungeon-knight.ts` (what is kept out of the bake) and
`dungeon-game.tsx` (per-frame). Drive everything from the simulated `dt` (`frameStep`) and the simulated clock, never wall
time, so a pause freezes it and `advanceTime` stays deterministic.

**B1. The hem state** (`dungeon-cloth.ts`):

```ts
export type Hem = { x: number; z: number; vx: number; vz: number };   // torso-local offset of the hem, metres
export const HEM_REST: Hem;
export function stepHem(hem: Hem, drive: { x: number; z: number }, dt: number): Hem;   // damped spring, substepped
export function hemDrive(input: { accel: { x: number; z: number }; yawRate: number; lift: number }): { x: number; z: number };
export function hemWeight(y: number, top: number, bottom: number): number;              // 0 at/above top, smoothstep to 1 at bottom
export function swayCloth(rest: Float32Array, out: Float32Array, hem: Hem, top: number, bottom: number): void;
```

- Spring: natural frequency ~7 rad/s, damping ratio ~.45 (a visible, slightly overshooting lag), substep to ≤ 1/120 s so it is
  frame-rate independent; clamp the output offset to `HEM_MAX` .12.
- Drive, in torso-local axes: trailing opposite to the body's acceleration (start gain .02 per m/s²), sideways against the
  torso's yaw rate (start .03 per rad/s), and backwards by `lift` (the run pose's `cape` value re-purposed as the hem lift, and
  `DASH_CAPE` while dashing; both re-tuned in `dungeon-run-pose.ts` as metres of trail rather than radians of pitch: start
  `cape` .02-.05 across the sprint blend, `DASH_CAPE` .09).
- `swayCloth`: `out = rest + w(y) * (hem.x, -k*(hem.x²+hem.z²), hem.z)` with `w = hemWeight(rest y)`; the small negative y keeps
  the cloth from stretching when it swings out. Then push any vertex that ended closer to the torso axis than
  `min(restRadius, BODY_CLEAR)` back out radially (BODY_CLEAR: tunic radius at that height + .02; pass the tunic profile in,
  do not import the knight). One rule, applied to poncho, trim and strap: their vertices at the same rest y move the same, so
  the strap stays on the cloth.

**B2. The kept subtrees** (`dungeon-knight.ts`):

- The `cloak` group and the `head` were kept out of the bake in Stage A step 0. Now: the cowl is weight 0 throughout (merge it
  with the poncho into one geometry if the bench shows no seam: one fewer call). Give each cloak geometry a bounding sphere
  enlarged by `HEM_MAX` once, never recomputed per frame. `userData.cloak` gains `{ meshes, top, bottom }` for the game. The
  strap's last four points (the drop from the hem onto the bag) get weight 0, so the strap end stays where the satchel pivot is.
- `satchel` kept, pivoting at the strap's lower end (`STRAP_BAG`), baked on its own (`cacheKey: 'knight:satchel'`): leather and
  brass, 2 meshes. `userData.satchel`.
- The free arm gets an elbow: `ARM_SPEC` splits into `arm` (sleeve) and a child `elbow` (forearm, fist), each baked: still 3
  meshes. `arm.userData.elbow`.
- `torso`'s bake keeps `[cloak, head, satchel, tabard, swordPivot, arm]`. Say in the commit why the batch order moved again.

Expected count: torso 4 (pale, red, leather, relic) + cloak 3-4 + head 2 + satchel 2 + tabard 2 + pivot 2 + Tideblade 4 + arm 3
+ hips 2 + knees 6 + pool 1 = **31-32**, about the same as today, because the torso's batches are split across groups rather than
added. Triangles rise with the 16-column lathe, the cowl and any finer head balls: expected 2,500-4,500. If the count comes out
above 40, stop and find what un-merged.

**B3. Pure poses** (`dungeon-run-pose.ts`):

- `playerRunPose` gains `elbow`: `-(.25 + .35*sprint) * weight` plus a small swing in phase with `arm`, 0 at rest; the arm's
  counter-swing grows from `.5` to `.5 + .2*sprint`. Keep every existing field and all existing tests' meanings.
- `headLook(torsoYaw: number, pitch: number)`: returns `{ yaw, pitch }` that counter-rotate the head so it keeps facing the aim:
  `yaw = clamp(-torsoYaw * .8, ±.6)`, `pitch = clamp(-pitch * .6, ±.2)`; 0 at rest.
- `idleBreath(t: number, still: number)`: `{ lift, nod }`, a 3.5-4.5 s cycle, `lift` ≤ .006 (added to the hem state's y via
  `swayCloth`'s shoulder band and the head's y), `nod` ≤ .03 rad; scaled by `still` (0 moving, 1 after ~0.5 s standing). It must
  **not** touch torso pitch or the tabard (`sprint.spec.ts` holds both under .01 at idle).
- `satchelSwing`: reuse `stepHem` in 1-D form or add `stepPendulum(angle, velocity, drive, dt)` in `dungeon-cloth.ts`: driven by
  the body's acceleration and the hip's swing (`max(hip)`), bounded to ±.35 rad about x and ±.2 about z, damping ratio ~.3.

**B4. Wiring** (`dungeon-game.tsx`; keep the file's density, edit in place):

- Where Stage A removed the cape's `animateCloth` call (~1914) and pitch damp (~2136), add: compute the body's torso-local
  acceleration from `velocity` this update vs last, the torso yaw rate from `player.userData.torso.rotation.y`, `lift` from
  `pc.dashTime > 0 ? DASH_CAPE : locomotion.cape`; `hem = stepHem(hem, hemDrive(...), dt)`; `swayCloth` each cloak mesh's
  cached rest positions into its position attribute, `needsUpdate`, `computeVertexNormals()`. `hem` lives beside `locomotion`
  and resets with it where `locomotion=playerRunPose(0,0)` is reset (~1388).
- In `posePlayer`, after the torso's rotation is set, set the head's rotation from `headLook(torso.rotation.y, torso.rotation.x)`
  plus `idleBreath`'s nod; set the elbow's rotation from `locomotion.elbow` (attack: damp to -.2).
- Satchel rotation from its pendulum each update.
- **Check before wiring the breath:** whether the clock `t` the frame uses advances while the game is paused. `sprint.spec.ts`
  compares the whole `locomotion` object across 500 ms of pause, so if `t` runs during a pause and `idleBreath(t)` feeds
  `locomotion.head`, that test fails. If it does, accumulate a separate breath clock from `dt` (0 while paused) and use that.
- `still`: damped toward 1 when `gaitSpeed < .05` and no swing or dash is live, toward 0 otherwise, with `dt`
  (`THREE.MathUtils.damp`, rate ~4); reset with `locomotion`.
- Keep `animateCloth` exported: the banners (`dungeon-atmosphere.ts`) and `dungeon-skeleton.ts` still use it.
- Snapshot (~2857): replace `cloak:{anchor,pitch}` with `cloak:{ hem: [hem.x, hem.z], tip: <the back point's lowest vertex,
  torso-local, read back from the poncho mesh's position attribute after the deform> }`, and add to `locomotion`: `elbow` (read
  off the elbow node), `head` (the head node's rotation.y), `satchel` (the satchel node's rotation.x). These are read off the
  nodes the scene draws, not recomputed from the rules. Adding them to `locomotion` makes `sprint.spec.ts`'s pause comparison
  cover them for free.

Tests:

- **B-test 1, the spring** (`tests/dungeon-cloth.test.ts`, new): (a) from rest, a step drive of .06: hem < 50% of it at .05 s,
  ≥ 90% by .6 s, overshoot ≤ 25%; (b) drive returns to 0: |hem| < .003 within 1.0 s; (c) stepping 1 s at dt 1/30 and at 1/144
  agree within .005; (d) a drive of 1.0 is clamped to `HEM_MAX`. Plants: `stepHem` returns the drive directly (a fails on the
  lag); damping 0 (b fails); no substep (c fails at 1/30).
- **B-test 2, the cloth on the real geometry** (`tests/dungeon-cloak.test.ts`, rewritten; say so at the top, with what it
  replaced): build `makeKnight()`, take the cloak meshes and `userData.cloak`, and for hem offsets on a grid over the clamp
  (|x|,|z| ≤ `HEM_MAX`): the neck ring and every vertex with weight 0 are bit-identical to rest; every vertex stays outside the
  tunic by ≥ .015; every vertex stays above y .1 world; the back point's tip stays below the sash's world y with the dash
  lift (the old "never out like a wing" rule, kept). Precondition: at least one vertex moved by ≥ .05 at the grid's corner, or
  "stays outside" checked nothing. Plants: `hemWeight` returns 1 everywhere (the neck ring check fails); drop the radial push
  (the tunic clearance fails at a sideways corner).
- **B-test 3, hands outside the cloth** (`tests/dungeon-figures.test.ts`): for the rest pose and for the free arm at the run
  pose's extreme `arm` and `elbow` values at top speed (64 phases) and the attack value (-.35), the glove centre (sword pivot +
  `glove.at`) and the fist centre lie outside the poncho surface by ≥ .03 (radius of the poncho at the hand's angle and
  height, read from the built geometry, vs the hand's distance from the torso axis). Plants: close the arm slit (copy a
  diagonal's drop into column 90°/270°) → fails naming the hand.
- **B-test 4, poses** (`tests/dungeon-run-pose.test.ts`): `elbow` ≤ -.4 at every phase at top speed and exactly 0 at rest (extend
  the rest-array assertion); `headLook` holds the head's world yaw (`torsoYaw + yaw`) within ±.25 of the aim for every arm's
  strike and special, sampled from the real poses (`playerAttackPose`/`playerSpecialPose` in `dungeon-attack-pose.ts`, every
  `WeaponId`), with the precondition that some sample's `bodyYaw` exceeds .3 (else the check is vacuous); `idleBreath` has
  zero mean over a cycle, |lift| ≤ .006, and is 0 when `still` is 0. Rewrite the old "poncho's back point lifts" test for the
  new meaning of `cape`/`DASH_CAPE` (metres of trail; the wing ceiling moved to B-test 2). Plants: `elbow: 0`; `headLook` returns
  0; `idleBreath` ignores `still`.
- **B-test 5, satchel**: bounded to its clamps for any drive, settles under .01 rad within 1.5 s, its pivot (the strap end) is
  the same point in the torso frame for every angle (the brief's "anchor stable"). Plant: pivot at the bag's centre → the
  anchor check fails.
- **B-test 6, wiring** (browser, `tests/browser/sprint.spec.ts`, extend the existing story; no new page). Assert on what the
  scene drew, not the spring state: `cloak.tip` is read back from the poncho mesh's position attribute after the deform. Read
  `cloak.tip` at idle before the run (the rest tip); while running (precondition: `sprint > .8`, already asserted) the tip is
  displaced from rest by more than the measured running displacement × .5, and `|locomotion.elbow|` > .3; 700 ms after release
  the tip is within .01 of rest and `locomotion.elbow` ≈ 0. Write the measured values, renderer and date beside the bounds.
  Plant: remove the `swayCloth` write in `dungeon-game.tsx` (keep `stepHem` running): the running-tip assertion fails with its
  own message; restore. That is the wiring this test exists to catch: a spring that moves while the cloth does not.
- `dungeon-figures.test.ts`'s cached-rebuild fingerprint must still pass (new cacheKeys).

Visual verification: the bench (as Stage A), then gameplay frames: the hem trails a beat behind a start, a stop and a turn; the
dash lift does not wing; the head looks along the aim through a strike; the bag swings and settles; idle breathes without
crawling. Record the frames' paths in progress.md.

Gates: typecheck, lint, `npm test`, then the browser gate (below).

### Stage C — Budgets (D1, D7)

1. `npm test` and the Stage 0 script: record meshes and triangles. Set the floors in `dungeon-figures.test.ts` from them, in the
   file's style: mesh floor = measured − 2 ("catches a bake that loses more than two batches"); triangle floor = measured −
   (the poncho's own triangles) + 1 ("catches a poncho that is not drawn"). Ceilings stay 64 / 9,975. Write the measured
   breakdown (per batch) and the date beside them. Plants: hide the poncho (the triangle floor fails); hide three parts that are each
   the only member of their material batch (the relic, the satchel's buckle, the poncho trim: -3 meshes) and the mesh floor fails
   with its own message.
2. Re-measure on **SwiftShader**: `npm run test:browser -- frame-budget.spec.ts --repeat-each=2` (no `GAME_TEST_GL`). If
   either scene fails its ceiling, that is expected: read the `BUDGET` lines. Set each ceiling to the highest measured value
   (calls exact; triangles to the highest reading, as the file's convention), and write beside each: "Plan 027, measured
   2026-10-xx on SwiftShader, two repeats: before <calls>/<tris> (Stage 0), after <calls>/<tris>; the delta is the Relic Seeker's
   kept cloak, head, satchel and elbow (+n meshes, +n shadow calls) and the 16-column poncho." Check the floors (`* 0.6`, `* 0.2`)
   still hold. Run once more on d3d11 (`GAME_TEST_GL=d3d11`) and record whether it is under the SwiftShader ceilings; if d3d11
   reads higher, the ceiling is the higher of the two (the file's Stage F precedent).
3. Delete the 12 orphaned `BUDGET` entries (D7), keeping one comment: "Twelve scene ceilings lost their scenes in 7d093d1 and
   were removed by plan 027; their history is in git and progress.md."
4. Plant for the scene budgets: lower `flooded-hall.calls` by 5 and watch it fail with "draws more often than the budget
   allows"; restore.

Gates: typecheck, lint, `npm test`, the browser gate.

### Stage D — Regenerate the baseline (D3)

Only after A-C are committed on the branch (the capture must be of a committed tree so both captures see the same code).

1. Stop any dev server on 3000/3001. From `game/`:
   `npm run shots:compare -- --base HEAD --gl swiftshader`
   This captures all of `shots.spec.ts` (including the `models` block) twice from the same commit on SwiftShader, serially,
   and writes `outputs/shots-compare/<timestamp>/{before,after,diff,summary.json}`. Expect ~5 minutes or more on SwiftShader.
2. Check `after/` holds every scene `shots.spec.ts` names and `after/meta.json` says `"gl": "swiftshader"` and `"dirty": false`.
   Look at the knight in `after/strike-contact.png`, `after/models-knight-strip-*.png` and `after/models-cast.png`: the new
   figure, not the old one.
3. Replace the baseline: delete every `*.png` in `output/shots/baseline/` (the old scene list differs: `bridge-over-water`,
   `dark-corridor`, `wide-branching-junction` and others are gone from the spec), then copy `after/*.png` there. Copy no
   `meta.json`/`costs.json` (`compare.ts` knows the baseline is SwiftShader by path; and only PNGs are ignored by git there).
4. Regenerate `output/shots/baseline/STABILITY.txt` from `summary.json`'s `rows`: one line per row with both sides,
   `${name}.png changed=${stats.changed}/${stats.total} (${(100*changed/total).toFixed(2)}%) worst=${stats.worst} mean=${stats.mean} box=[${stats.box}]`,
   sorted by changed share, descending: the same format as today. Use a throwaway `node -e` or a scratch script under
   `game/outputs/`; commit only the text file.
5. Verify: `npm run shots:compare -- --before ../output/shots/baseline --after outputs/shots-compare/<timestamp>/after`
   re-sheets in seconds and reports zero changed pixels for every scene.
6. Record in progress.md: the capture command, sha, renderer, seconds, PNG count, and the five least stable frames from
   `STABILITY.txt`. The PNGs are not committed (ignored); `STABILITY.txt` is.

Gate: `git status` shows only `output/shots/baseline/STABILITY.txt` changed under `output/`.

### Stage E — The main menu (D4)

1. Copy: in `dungeon-game.tsx` ~3099 replace "so the knight can retreat and cut behind him" with "so you can retreat and cut
   behind you" (the sentence already says "you" further on). `grep -rn -i knight app --include=*.tsx` must then show no
   user-facing string (comments and identifiers stay). No test asserts on the sentence (checked: `grep -rn "retreat and cut"
   tests` is empty).
2. Backdrop: stop other dev servers; from `game/` run `GAME_TEST_GL=d3d11 npm run backdrop` (port 3200; d3d11 because it is
   the game "at its best", as the script says; SwiftShader also works). If vinext says another dev server is running, see the
   stale-lock note below. Open `public/keep-backdrop.jpg` and check the new figure is in frame and readable at the menu's crop
   (the menu covers the left half: `globals.css` `.keep-backdrop`, `object-fit: cover`). Since plan 020 ENTER lands in the Tide
   Altar's hall, not floor 1: if the frame shows no figure, or a poor one, adjust the script (not the game) to step a few
   hundred ms and/or turn the knight toward the camera before the read, and say so in the commit.
3. Check the menu in the browser at 1280x720 and at a phone viewport (a scratch Playwright screenshot of `/` before ENTER, as in the frame recipe below).
4. Commit the JPEG (tracked). Size within ±50% of the old one (~JPEG 0.8 quality).

Gates: typecheck, lint, `npm run build` (the backdrop ships in `public/`).

### Stage F — Gates and records

1. All gates from `game/`: `npm run typecheck`, `npm run lint`, `npm test`, then the PR-gate browser run on the real GPU:
   `GAME_TEST_GL=d3d11 npm run test:browser -- --grep-invert "@capture|@nightly"`, and `npm run build`. The frame-budget
   numbers were set on SwiftShader in Stage C; if d3d11 fails one, apply Stage C step 2's rule, do not loosen blindly.
2. `git diff --check` clean; `git status` shows no generated output (`dist/`, `.vinext/`, `test-results/`,
   `playwright-report/`, `tsconfig.tsbuildinfo`, `game/outputs/`).
3. AGENTS.md: add `dungeon-cloth.ts` to the "Keep pure rules pure" list.
4. `game/progress.md`: append (do not rewrite) a "2026-10-xx — the Relic Seeker, pass 2 (plan 027)" entry: the before/after
   Targets table from the Stage 0 script; what is kept and why; meshes/triangles per batch; the scene budget before/after on
   SwiftShader (and d3d11); every planted bug and the message it failed with; the bench and gameplay frame paths; the
   baseline regeneration record; D7's finding (two live budget scenes, not eleven); the backdrop.
5. `plans/README.md`: add the row for plan 027 with status and evidence pointer.
6. **Publishing: do not push, open a PR, merge, deploy or trigger a workflow.** Work stays on the local branch
   `art/relic-seeker-pass-2`. Committing on it is allowed; one commit per stage is optional. Each commit message names the
   bugs planted for its tests and ends with the attribution lines the session gives you.

## Gameplay frame recipe (scratch, not a test)

For idle, sprint, dash and facing the camera, on the real game:

1. Stop other servers. From `game/`: `npm run dev -- --hostname 127.0.0.1 --port 3000` in the background. If it says another
   vinext dev server is running, read `game/.vinext/dev/lock.json` (PID and port); if that PID is dead or the port is not
   listening, delete the lock and start again.
2. A scratch Playwright script `game/outputs/relic-frames.ts` (ignored), run with
   `node --experimental-strip-types outputs/relic-frames.ts`: launch Chromium with
   `--use-gl=angle --use-angle=d3d11 --enable-gpu` (as `scripts/backdrop.ts` does), viewport 1280x720, go to
   `http://127.0.0.1:3000/?quality=full&boot=eager`, click `.intro-screen .primary-action`, wait for `.intro-screen` hidden,
   then `window.advanceTime(0)` to take the clock.
3. Idle: `advanceTime(1500, true)`, screenshot. Facing the camera: hold `ArrowDown` (keyboard down), `advanceTime(300)`,
   release, `advanceTime(800, true)`, screenshot. Sprint: hold `ArrowRight`, `advanceTime(400, true)`, screenshot, `advanceTime(80,
   true)`, screenshot. Dash: while still holding, press `ShiftLeft`, `advanceTime(60, true)`, screenshot. Stop: release,
   `advanceTime(150, true)` and `advanceTime(700, true)`, screenshot each (hem lag and settle). For a dungeon floor rather than the
   hall, use `window.dungeonTest.buildFloor(1)` then `dungeonTest.teleport(x, z)` to a spot from `render_game_to_text()`'s floor
   (see `game/tests/README.md` for the hooks).
4. Crop around the knight (`render_game_to_text()` has `player.x/z`; the knight is at the frame's centre) and save under
   `game/outputs/relic-pass2/`. Stop the dev server afterwards.

## Risks

- **The hand slit vs the sheet's drape.** The sword hand sits at shoulder height in the ready pose, so a drape to the elbow can
  only coexist with visible hands through a side opening. B-test 3 decides its width; if the slit reads as a hole, move the
  sword pivot out (x ≤ .5) before widening it further. Do not move the pivot's world height outside 1.02-1.10 without the
  operator: every arm's screen read is tuned against it.
- **Height band.** Leg share .40 inside a fixed height means a much shorter torso; if .36 is reached and the torso already looks
  squashed, stop at .36 and record it. If the height must leave 1.8243 ± .08, update `BEFORE.height` with the measured value and
  re-check `dungeon-art.ts` `headroom` (head at +1.2 screen-up, `RISE` .7623), `contactShadow(.62, .74)`, the bench camera in
  `dungeon-bench.tsx`, and the sole node's offset in the footstep code (`soleAt.set(0,-.08,0)` in `dungeon-game.tsx`); hit
  rules are radius-based and do not read the mesh.
- **Per-frame cloth cost.** Three to four small meshes rewritten and re-normalled each frame (a 16-column lathe is a few hundred
  vertices); bounded. Do it only for the player.
- **Scene budget.** Kept meshes that cast shadows cost two calls each; if the count lands above ~34, `flooded-hall` and
  `wave-chamber` rise by ~2 calls per extra mesh. That is the owner's doubled budget being spent; record it, don't hide it.
- **Batch order.** New kept subtrees change which material lands at `baked:N`; nothing addresses batches by index today
  (checked 2026-10-12: `baked:` appears only in `dungeon-bake.ts`, its test and the fingerprint test), but say it in the commit.
- **SwiftShader time.** Stage C and D runs take minutes each; run them alone (one browser run at a time).
- **The backdrop scene** may not frame the figure well since the hall became the entry; fix it in the script, not the game.

## Out of scope

Weapon models, combat rules, HUD, enemies, the hall's layout, renaming code identifiers, re-tuning swing poses, any pixel
assertion test on the figure's look (judged by eye on the bench, in game frames and on the `shots:compare` sheet).
