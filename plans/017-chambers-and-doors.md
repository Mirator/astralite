# Plan 017: Chambers and doors — a floor as a chain of sealed rooms

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `f33bf77`, 2026-09-28. Source was read; nothing was
> measured while writing it. Every performance number below that is not quoted
> from `game/progress.md` or `plans/015` is a hypothesis, and Stage 0 exists to
> replace it with a measurement.

## Why

The operator wants rooms to work the way Hades does: you enter a chamber, it
seals, you clear it, its exits open, each exit shows what the next chamber pays,
you pick one, and the next chamber is all there is. Two reasons were given:

1. **Tempo.** A fight should start on entry and end on the last kill, and the
   time in between rooms should go to zero.
2. **Performance.** When the knight is sealed in one chamber, nothing else needs
   to be drawn.

The operator also said explicitly that existing work is not a reason to keep it
(sunk cost). This plan therefore removes corridors, dead-end branches, bridges
and the plunder count outright rather than preserving them behind a flag.

### What the game does today

- `generateFloor` (`game/app/dungeon-floor.ts:48`) grows a **tree**: a trunk of
  `8–10 + level − 1` rooms from the Tide Gate to the Sunken Stair, plus side
  branches, joined by carved corridors (`planPath`, `connect`, some of them
  wooden bridges). One continuous walkable `cells` set holds all of it.
- Entering a room (`dungeon-game.tsx:1322–1335`) marks it visited and wakes its
  sleepers as an ambush. **Nothing seals it**: the knight can retreat into a
  corridor or run past the whole room. The only thing that has to die is the
  warden pair or trio, because they hold the stair shut (`stairClear`, `:311`).
- A room clears when its last body falls (`settleRoom`, `:381`), which pays
  `clearRoomReward` (`dungeon-sim.ts:139`): a heal of 12 on the trunk, or 60 XP
  plus a heal of 30 on a dead end. Boons come from **rank-ups**, which are paid
  for with XP (`grantXp`, `rankCost`), never from a room.
- One weapon rack per floor (`weaponDrop`): in the Tide Gate on floor 1, down a
  branch deeper.
- Rendering already culls by frustum. The camera is orthographic with a narrow
  view (`:424`, `resize` at `:1868`). Walls, paving and bridges are batched by
  region, 11–17 units wide, so distant wings drop out of both the view and the
  shadow pass (`dungeon-art.ts:555`, `dungeon-atmosphere.ts:518`). There are
  9 point lights and they are loaned to the lamps nearest the knight.
- **So "draw only the chamber" saves less than it sounds.** Most of the floor is
  already not drawn. What sealing removes is whatever sits inside the view but
  outside the room: the corridor mouths, the walls and rooms next door, and the
  part of the shadow frustum that reaches past the room. The larger gain is
  structural: once each frame budget covers one chamber, it stops being sized
  for the worst junction (`frame-budget.spec.ts:84–91`: junction 502 calls,
  1.03M triangles). Stage 0 measures how large that gain actually is.

### What the balance sim already knows about tempo

`scripts/balance/sim.ts` splits idle time into `idleCorridor`, `idleBarren`,
`idleSpent` and `idleLiveNoContact`. It also counts `idleBacktrack` (walking back
out of a dead end), `corridorSeconds` and `spentRecrossings`. Those buckets
measure exactly the dead time this plan removes. Stage 0 records them, and the
tempo claim is accepted or rejected on them.

## Decisions

Decisions marked **(operator)** default to the recommendation. Any of them can be
overturned before Stage A starts, but not partway through a stage.

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | Floor structure | **Layered DAG** of chamber specs, generated as data for the whole floor up front. Layer `d` holds 2–3 chambers. Each door in a layer-`d` chamber leads to a distinct chamber in layer `d+1`. | Bounded size (≈ depth × 2.5 specs), deterministic from the seed, and the sim can walk it. A tree of choices grows exponentially. |
| D2 | Doors per chamber | 2, sometimes 1 or 3. The warden chamber has none (the stair replaces them). | This is the Hades rhythm. One door is a breather rather than a choice, and three is a rare treat. |
| D3 | What a door shows | The **reward** of the chamber behind it, as a sigil on the door in the world, not on the HUD. A rest chamber has its own sigil. | This is Hades' rule. AGENTS.md forbids persistent HUD overlays. |
| D4 | Rewards | `arm` (the floor's rack), `mend` (heal 30, today's dead-end heal), `cache` (60 XP, today's `XP_DEAD_END`). A rest chamber (today's sanctuary) pays `mend` without a fight. | This reuses the numbers the dead ends pay today. Boons stay rank-driven, so the economy changes in only one place (D5). |
| D5 | Where boons come from **(operator)** | **Unchanged: rank-ups paid by XP.** A `cache` door is "your next boon sooner". | Change structure first, economy second, so the balance sim can attribute any drift. Hades-style "boons only from doors, no ranks" becomes a separate follow-up plan after a playtest. |
| D6 | Seal rule | A chamber with any spawn seals when the knight crosses its threshold. It opens when `settleRoom` finds it clear. A bonecaller's buried reserve counts only while the caller stands, which is the existing `fallOf` rule. Rest chambers and the Tide Gate never seal. | This reuses the one clear rule the game already trusts. |
| D7 | Taking a door | Stand in the door's ring and press **swap**, the same as the stair and the rack (`STAIR_RADIUS`, `PICKUP_RADIUS`). | The existing convention: a threshold is a choice you make, never a step you take mid-swing. |
| D8 | Backtracking | None. The entry door is shut behind you for good. | This is Hades' rule, and it is what makes `idleBacktrack` structurally zero. |
| D9 | Residency **(operator)** | **All chambers of a floor are built up front** under the existing veil, as islands far apart in world space. Only the current chamber is visible; a transition is a teleport plus a visibility flip. | It reuses `raiseFloor`, `stagedBuild` and the warm-up untouched, and a transition then builds nothing and compiles nothing. The cost is a longer floor build. Stage B measures it, and a stop rule sends the work to lazy building if it gets too long. |
| D10 | Transition | A fade out of at most 150 ms, then the flip, then a fade in of at most 150 ms. Under reduced motion it is a hard cut. Held movement keys stay held; buffered attacks and dashes are dropped (`dropBuffers`). | Hades hides its load behind a short fade. There is nothing to load here (D9), so the fade is purely presentation. |
| D11 | Door placement | Exits go only on the far and side walls from the camera. The entry sits on the near side, where the cutaway already handles occluding walls (`dungeon-occlusion.ts`). | An exit on the near wall would sit behind the masonry. |
| D12 | Chamber size | Keep today's `sizeFor` ranges. Once sealing exists, re-judge them in Stage E playtest shots. | These were already halved so a room is not a commute (`dungeon-floor.ts:94`). A sealed arena may want a little more room, but only a playtest can say. |

### Removed, not hidden

Corridors (`planPath`, `connect`, `crossesExistingFloor`, `corridorCells`) go.
So do wooden bridges (`wood`, `bridgeTiles`, the deck and the trestles), the
`branch` role, the plunder counter and its HUD line, the room-graph SVG map (it
becomes a list of chambers taken, in the pause menu), the sim's corridor and
backtrack walking, and the `junction` frame-budget scene. Delete each test that
covered only removed behaviour, and add a one-line comment in its place naming
the removal. Whatever survives in another form is listed under Stage E.

## Design

### Pure: `game/app/dungeon-chambers.ts` (new)

This module holds no React, DOM or three.js, following the AGENTS.md
pure-module rule. It owns:

- `generateChambers(seed, level)` returns
  `{ layers: ChamberSpec[][], doors: Door[], start, goal }`.
  - `ChamberSpec` has `id`, `layer`, `shape`, `theme`, `name`, `encounter`
    (`watch | ambush | trial | rest | warden`), `reward`
    (`arm | mend | cache | null`), `halfX`, `halfZ` and an island origin.
    `trial` is today's gauntlet.
  - `Door` has `from`, `to`, the wall it sits on, and its `x`/`z` in world
    tiles.
- The encounter rules carry over from `generateFloor`, and each keeps its
  reason comment:
  - The first two fights are plain `watch`.
  - A `rest` never follows a `rest`.
  - The `warden` sits in the last layer.
  - The encounter bag is shuffled Fisher–Yates.
  - The pack mix follows `PACK_MIX` by layer progress, with `menace` per level.
- The floor's `arm` appears on at least one door of some layer. On floor 1 it
  stays in the Tide Gate, as today.
- `carveChamber(spec)` fills the same `cells`/`tiles`/`roomByCell` structures
  `generateFloor` returns today, with one island per chamber. `raiseFloor`,
  `canStand`, `moveOnFloor`, `hasClearPath`, the enemies and the sim then need
  only a changed input, not new logic.
- `sealed(chamber, enemies)` and `doorOpen(door, state)` are the seal and open
  rules as plain functions.

`generateFloor` is reduced to a wrapper over these, or deleted. Choose
whichever leaves fewer call sites. `dungeon-arena.ts` becomes one chamber with a
chosen roster, which is simpler than it is today.

### World: `dungeon-game.tsx`, `dungeon-floor-scene.ts`

- **Per-chamber groups.** `raiseFloor` parents everything it builds for a
  chamber under that chamber's `THREE.Group`. Islands are far enough apart that
  no spatial batch spans two of them; assert this in a node test on the region
  keys. Hiding a chamber is then one `group.visible = false`, which removes it
  from the view pass and the shadow pass alike.
- **Shadow camera fitted to the chamber.** It is sized to the chamber's bounds
  on entry, not to the knight's surroundings. At the same map size this should
  give sharper shadows. That is a hypothesis; Stage B measures it.
- **Camera.** The camera follows the knight as today, clamped so it never shows
  more than a margin of void past the chamber's walls.
- **Doors in the world.**
  - A sealed door is a grate: a collision cell removed from `cells`, and a mesh.
  - An open door is a lit arch with its reward sigil.
  - The seal and the open are events with sound and a burst, like
    `openStair`.
- **Room entry** (`:1322`) becomes chamber entry. It seals by D6 and wakes the
  spawns with the existing ambush code (every sealed chamber now springs). Once
  the knight is past the threshold, the entry door stays shut.
- **Transition** runs inside the frame loop as a small state machine
  (`idle → fadeOut → flip → fadeIn`). The pure part, the order of steps and
  what is dropped at each, lives in `dungeon-chambers.ts` with a node test.
  Transient per-room effects are cleared at the flip: footsteps, slash trails,
  hostile pools and blood slots.
- **The snapshot** (`render_game_to_text`) gains
  `chamber: { id, layer, sealed, doors: [{ to, reward, open }] }` and
  `drawnChambers`. `drawnChambers` must read `group.visible` off the scene
  (what the scene actually shows), not the planner's idea of it. See
  "Observe, don't recompute" in AGENTS.md.

### What stays

These systems stay as they are, only fed a different floor:

- combat, enemies and the bestiary
- boons, ranks and XP (D5)
- the rack, the stair and the descent veil
- decor layout, motifs, macro paving and flames
- the post chain and the cutaway

## Stages

Each stage ends with every gate green:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:browser -- --grep-invert "@capture\|@nightly"`

Record the gates and the stage's numbers in `game/progress.md`.

### Stage 0 — Baseline (no code change)

1. **Draw calls and triangles.** For `flooded-hall`, `junction` and
   `strike-contact`, record `render.calls`, `render.triangles` and
   `render.shadow.calls`. Separately, split the calls into those made for
   objects in the knight's room and those for everything else in view. Use a
   throwaway `onBeforeRender` counter keyed by the room that owns each batch,
   and do not commit it. The "everything else" count is the **upper bound** of
   the draw-call saving from sealing.
2. **Build time.** Record `buildMs` and `warmUp` for floors 1–3 of seed 1.
3. **Tempo.** Run `npm run balance` and record, per policy:
   - `medianRunSeconds`
   - `idleCorridor`, `corridorSeconds`, `idleBacktrack`, `idleBarren` and
     `spentRecrossings`, summed per floor
   - `longest idle`
4. **Operator, on a real GPU.** Run
   `GAME_TEST_GL=d3d11 npm run perf:boot` and record median frame time in the
   junction and in a mid-fight room. No real-GPU frame time exists anywhere in
   the log yet (`progress.md`, 2026-09-26).

**Stop rule.** If step 1's "everything else" is under 10 % of calls in every
scene, performance is not a reason for this plan. Say so in `progress.md` and
continue on tempo alone. Do not overstate the gain later.

### Stage A — The chamber generator (pure, not wired)

`dungeon-chambers.ts` and `tests/dungeon-chambers.test.ts`. Nothing in the game
imports it yet, so this stage lands on its own.

Node tests. Each one names the bug to plant; plant it, watch it fail with its
own message, then restore.

| Test | Plant |
| --- | --- |
| Same seed and level give the same DAG; different seeds give different ones (over the same seed sweep `tests/dungeon-floor.test.ts` uses, × 3 floors) | Seed the rng from `Date.now()` |
| Every non-warden chamber has 1–3 doors, and every door's `to` is in the next layer | Allow a door to skip a layer |
| No chamber has two doors to the same chamber | Drop the dedupe |
| Every chamber is reachable from the start, and every chamber reaches the warden | Leave one layer-`d+1` chamber with no incoming door |
| A door's shown reward is the reward of the chamber it leads to | Read the reward off `from` |
| The first two fights are `watch`; `rest` never follows `rest` on any path | Remove the swap in the bag |
| The floor's arm is on some door (floor ≥ 2) or in the Tide Gate (floor 1) | Skip the arm placement |
| Islands never share a spatial batch region (the 11- and 17-unit keys) | Halve the island spacing |
| Exits are never on the near wall | Allow all four walls |
| `sealed` stays true while a buried reserve's caller stands | Ignore `buried` |

Also assert the precondition behind the arm test: that the sweep actually
contains floor-1 and floor-≥2 cases.

### Stage B — Islands and transition (doors always open)

Wire the generator into the game with no sealing yet. Every door is open and
takes the swap key. After this stage the game is playable end to end.

- Per-chamber groups, visibility, a shadow camera and camera clamp fitted to
  each chamber, and the transition state machine.
- Corridors, bridges and branches are deleted from the build path.
- Browser tests (real keyboard):

| Test | Asserts | Plant |
| --- | --- | --- |
| Take a door | The knight stands in the ring (precondition), then presses swap. The snapshot's `chamber.id` becomes the door's `to`, the knight is at the entry, and `drawnChambers` is exactly `[to]` | Leave the old chamber visible |
| A transition compiles nothing | `render.programs` is equal across the transition | Give the new chamber's door arch a fresh material |
| Nothing leaks across the flip | Footsteps, trails and pools are empty right after the flip, and were non-empty before it (precondition) | Skip the clear |
| Walking into a door does nothing without swap | No change of `chamber.id` after standing in the ring for 2 s | Take the door on overlap |

- **Measure.** Floor build time (`buildMs.total`) against Stage 0, frame
  budgets for a combat chamber, and `render.shadow.calls`.
- **Stop rule.** If the staged floor build exceeds 2× Stage 0's cold time on
  SwiftShader, or the operator reports the veil feeling longer on a GPU, stop.
  Report it and propose the lazy variant: build layer `d+1`'s chambers in
  `driveSliced` slices while the knight fights in layer `d`, and dispose
  layer `d−1`. Do not build the lazy variant without the operator's go-ahead.

### Stage C — Seals and door rewards

- Implement the D6 seal, the grate as a collision cell, the open event, the
  reward sigils and the rest chamber.
- The door rewards pay through `award`: add a `chamberReward(run, reward)` in
  `dungeon-sim.ts`, pure and node-tested beside `clearRoomReward`, which it
  replaces.
- Browser tests (real keyboard):

| Test | Asserts | Plant |
| --- | --- | --- |
| A sealed chamber holds | After entry, `chamber.sealed` is true (precondition). Holding a direction into the entry door for 2 s leaves the knight inside the chamber's cells | Leave the grate out of `cells` |
| Clearing opens it | Kill the roster with `configureCombatFixture`, with a real swing on the last one. `sealed` goes false and every door is `open` | Open on the first kill |
| Rest chambers never seal | Entering one leaves `sealed` false and pays `mend` once | Seal every chamber |
| The door pays what it showed | Take a `cache` door, clear the chamber: XP rises by `XP_DEAD_END`. Take a `mend` door: health rises by the mend amount, from below max (precondition) | Pay the `from` chamber's reward |

### Stage D — Economy and the sim

- `scripts/balance/sim.ts` walks the door DAG. Its policy gains a door choice
  (reward preference, then the first door). The corridor and backtrack buckets
  must read 0: that is a node assertion, planted by leaving one corridor tile in
  the carve.
- Run `npm run balance`. This is a deliberate structural change, so
  `balance:check` is expected to fail. Update `bands.json` in the same change,
  with the measured values and the reason.
- **Tempo acceptance.** Against Stage 0, idle seconds per floor drop and
  `corridorSeconds` is 0. Report `medianRunSeconds` either way. A shorter run is
  not automatically better; say what it cost.
- Every arm still escaping 100 % of runs is the standing difficulty problem
  (`progress.md`, weapon entry). This plan does not claim to fix it. Report
  whether sealing moved it.

### Stage E — Cleanup, budgets, art

- The pause-menu map becomes the chambers taken, in order, with their rewards.
- Remove the HUD plunder line. Delete the `junction` scene. Set new
  `frame-budget` scenes (`chamber-fight`, `chamber-warden`, `strike-contact`)
  from measurements, bounded on both sides, with the renderer and date beside
  each number.
- Fix every browser spec that stages positions through the old generator:
  15 files reference `generateFloor` or a seed, and `helpers.ts` finds fixture
  positions with it. Fix them against the new generator; do not widen `DRIFTS`.
- Run `npm run shots:compare` for the art review. The baseline in
  `output/shots/baseline/` no longer matches the layout, so a new SwiftShader
  reference set comes from the `captures` input on the Verify and Deploy
  workflow. That needs the operator (AGENTS.md: triggering a workflow is
  opt-in).
- Playtest screenshots of a sealed fight, an open door choice and a transition
  mid-fade. Judge D12's chamber size here.

## Risks

- **The perf gain may be small.** See Stage 0's stop rule. The honest pitch is
  tempo, with a frame budget per chamber as a bonus.
- **A longer floor build.** D9 roughly doubles the number of rooms built,
  though corridors and bridges drop out of the cost. Stage B measures it and
  has a stop rule.
- **Identity.** A layered DAG with reward doors is Hades' structure. What
  distinguishes the keep afterwards is combat, the bestiary and the art. That
  is the operator's call, and it was made (2026-09-28).
- **Test churn.** Most browser specs stage fixtures off floor geometry, so
  Stage E is the largest stage by line count. Budget for it rather than
  shortcutting it: no `test.skip`, no conditional expects (AGENTS.md).
- **Save and replay.** `restart:<seed>` still replays the same DAG. A run's
  path also depends on the door picks, which are not logged. Adding the picks to
  `RunEnd` is optional; decide in Stage D.

## Out of scope

- Boons from doors instead of ranks (D5's follow-up).
- Shops, currencies, or chamber kinds that do not exist today.
- A visible floor map in the style of Cult of the Lamb.
- Lazy chamber building (Stage B's fallback, only on its stop rule).
- New art beyond the door grate, the arch and the sigils.

## Evidence

Fill in per stage: gates, the numbers each stage says to record, and the
planted bug for each new test and the message it failed with.
