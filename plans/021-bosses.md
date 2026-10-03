# Plan 021: A boss at the bottom of every floor

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `86c7e8d`, 2026-10-03, after plan 020 merged
> (PR #86). Source was read; nothing was measured while writing it. Line numbers
> drift; search for the names. Decisions marked **(operator)** use the
> recommendation unless the operator overturns them before Stage A starts.

## Why

Each floor ends in "The Sunken Stair", a goal chamber holding two wardens (three
on floor 3). They are tougher guards and nothing more. Hades ends each region
with a boss that tests what the run has built: it has several moves, its moves
change as it is hurt, and it has a health bar you watch. That checkpoint is also
where most Hades runs end.

The game is too easy. In `bands.json` the default bot escapes 100% of runs with
100% median HP left on every floor. The weak bot, which never dodges, escapes
83%, and with every pearl upgrade bought it escapes 100%. A boss at the end of
each floor is a place to make runs end, and it does that **without** making
every ordinary chamber harder.

What bosses do not fix: healing between fights (`TOP_UP` 12 on every clear,
`MEND` 30, +25% between floors) and how easily the ordinary chambers fall. That
is the separate difficulty pass, still owed. This plan sets measurable targets
for the bosses alone (D9) and leaves the rest to that pass.

### What the game has today

- **The goal chamber.**
  - `dungeon-floor.ts:221` marks the last layer's only room
    `encounter: 'warden'`. `packSource` returns `'fixed'` for it.
  - `roster()` deals `['warden','warden']`, or three wardens on floor 3
    (`:265`).
  - Bodies are placed at least 2 tiles from the room centre (the stair), 3.5
    from the entry and 2.2 apart.
  - The goal room is drawn last, and the only random draw after it is
    `dropKind` (`:290`). So changing how many bodies the goal room places moves
    `weaponDrop.kind`, which `tests/fixtures/spawns-017.json` pins.
  - Goal-room shapes are spread roughly evenly. Measured over 1,500 floors:
    - court: 125 to 222 tiles
    - hall: 59 to 140
    - gallery: 63 to 130, long and narrow
    - crypt: 45 to 124
    - cross: 53 to 93
    - round: 49 to 108

    **The smallest is 45 tiles**, roughly a 7 × 7 open area once props are in.
- **The stair.**
  - `stairClear` (`dungeon-game.tsx:385`) is "every body in the goal room is
    dead". It is re-checked every frame (`:1807`).
  - `openStair`, then `descend`, shows the floor card. On floor 3,
    `continueDescent` calls `endRun(null)`, which is the win.
- **Enemies are one archetype each** (`Archetype`, `dungeon-bestiary.ts:40-103`):
  one `stats.tell`, one `attack` (`'swing' | 'pounce' | 'volley' | 'sweep' |
  'summon'`) and one cue shape.
  - `decideEnemy` (`dungeon-enemy.ts:277-357`) is a pure state machine: doze,
    notice, ready, windup, lunge, recover. It has no phases, no HP awareness
    (`EnemyView` has no `hp`), no multiple moves and no pattern.
  - `enemyStats` scales HP (+1 hit per floor) and damage (+15% per floor).
- **Reusable tells and hazards, all with pure rules:**
  - the windup ground cue (arc, lane or ring) closing over the tell, plus a
    commit flash;
  - the pounce lane and `sweptContact`;
  - hostile bolts (`hostileBolt`, `flyHostile`);
  - fire pools (`deathPool`, `poolStep`, `poolCatches`, capped at
    `HOSTILE_POOL_RINGS` 6);
  - summons (`summons`, `buryReserves`, `raiseSpot`, `fallOf`);
  - shields (`blocks`), stagger (`interruptsWindup`) and the warden's
    `steadfast`.
- **Hard limits a boss must respect:**
  - **No runtime enemy spawning.** Every body, summoned ones included, exists
    from floor build (`dungeon-floor-scene.ts:401`), so summons must be
    pre-buried.
  - **Six fire rings.** A seventh pool is silently not created and never
    bites.
  - **Twelve enemy arrows.** A thirteenth volley is silently dropped.
  - **Frame budget.** The worst-chamber ceiling in `frame-budget.spec.ts` is
    508 calls (`caller-chamber`), set exactly at its measurement.
- **The balance sim imports the real rules** (`decideEnemy`, `landBlow`, the
  projectile and pool functions). It mirrors only the bookkeeping: `fell`, the
  dodge policy (`sim.ts:482-492`, which dodges sideways from anything that is
  not a melee swing) and the stair. A boss built on `decideEnemy` is in the
  sim for free; its bookkeeping and dodge rules are not.
- **The dev arena** (`?arena=<kind>:n&level=`) accepts any `ENEMY_KINDS` entry,
  so a boss can be staged alone as soon as it exists. But it fights in the
  Tide Gate (a crypt), and the arena's stair is open from the start, so it
  cannot exercise boss → stair gating.
- **HUD rule** (AGENTS.md): vitality, dash readiness and rank progress, and no
  persistent overlays. There is no boss bar.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | What a boss is | **An `Archetype` with an optional move list and phases.** A move is one of the existing attack kinds (`swing`, `pounce`, `volley`, `sweep`, `summon`) with its own tell, damage, range and cue, plus one new kind, `scatter` (D6). A phase is an HP threshold that switches to another move list. Ordinary enemies keep their single `attack` and behave exactly as today. | Every move reuses a tell and hazard the player already reads, and every rule stays in `decideEnemy`, so the balance sim gets bosses for free. The only new engine pieces are a move selector and an HP-aware phase. |
| D2 | How a boss picks its next move | **A fixed rotation per phase,** advanced each time a move completes. Range gates a move: if the knight is out of a move's range, the boss closes or skips to the next move that fits. It makes no random draw. | Hades bosses are learnable patterns. Determinism keeps the sim reproducible and the tests honest. |
| D3 | Phase change | Crossing a threshold (D7) **cancels the current windup.** For 1.0 s the boss is unhittable and plays a ring cue at its feet that knocks the knight back out of its reach, so the knight cannot burst through a phase. Then it starts the new phase's first move. The arena notice names the phase ("The Captain draws the tide"). | The knight has to see the change, and damage spilling over a threshold would skip phases. The knockback is the first time an enemy pushes the knight; it lives in pure `dungeon-hits`, beside `landBlow`. |
| D4 | The three bosses **(operator)** | Floor 1, **The Drowned Captain**: a big warden. Phase 1 is swing, swing, sweep. Phase 2, below 50%, adds a pounce lunge across the room. Floor 2, **The Pyre Mother**: ranged. Phase 1 is volley, volley, scatter (D6). Phase 2, below 50%, adds a sweep when the knight is close, and the scatter fires twice. Floor 3, **The Bone King**: a summoner with a shield. Phase 1 is summon, swing, swing, with its shield up front (`shield` arc) while not winding up. Phase 2, below 60%, drops the shield and adds a sweep and a pounce. Phase 3, below 25%, summons on every second move. | Each boss tests what its floor introduced: floor 1 dodging melee tells, floor 2 the ranged kinds and pyres, floor 3 the bonecaller and shieldbearer. Names and themes are placeholders for the operator. |
| D5 | Who stands in the goal chamber | **The boss alone**, plus its own buried summon reserve on floor 3. No wardens. The roster keeps every placement draw it makes today (two or three bodies' tries), places the boss on the first body's spot, and does not emit the others. So `dropKind` and every other room's spawns, props and drop stay exactly as in `spawns-017.json`. | A boss fight is a duel. Adds come only from its own moves, so they are part of the pattern. Keeping the draws keeps every fixture outside the goal room valid, the same technique plans 019 and 020 used. |
| D6 | The one new mechanic | **`scatter`: a volley that marks one to three ground rings at the knight's last positions.** After the tell each ring becomes a fire pool, reusing `deathPool`, `poolStep` and `poolCatches` and drawn by the fire-ring meshes. The pool count is capped so the boss never needs more than `HOSTILE_POOL_RINGS` (6) live rings, counting pools from the knight's own flask. | Fire on the ground is the floor-2 pyre's identity. Making it a boss move gives the Pyre Mother a way to control space without a new hazard system. The cap is a stated rule with a test, because overflow today fails silently. |
| D7 | HP and thresholds (hypothesis) | Captain 60 HP, Mother 50, King 80, in the same quarter-hit grain as other enemies. Floor scaling stays as `enemyStats` applies it. The thresholds are the D4 percentages. Stage E tunes **HP and damage only**, never the move lists, against D9. | The move lists are the design. HP and damage are the dials. |
| D8 | The boss bar **(operator)** | **A bar at the top of the screen, shown only while a boss is awake and alive.** It shows the boss's name and HP, with tick marks at the phase thresholds. It replaces the floating bar over that body, and it goes the moment the boss falls or the knight dies. | Hades shows one. It is not a persistent overlay (AGENTS.md): it exists only during the fight. The ticks tell the player a change is coming. |
| D9 | Targets: what bosses must do to runs (operator, recommended values) | Measured by `balance:check` at 30 runs: **default bot**: escape 75–90%, and at least half its deaths to a boss. **Weak bot**: escape 30–55%. **weak-meta-max**: escape 55–80%. Boss fights last 25–60 s for the default bot. HP left after a boss fight must be measured before the goal chamber's top-up (`bands.ts:50` measures after it; add a `bossHpLeft` field). | Bosses should end runs, mostly the weaker bots' runs, and the shop's upgrades should still visibly help. These are bot numbers. Stage G (playtest) is the real judge, and if bots and the human disagree, the human wins. |
| D10 | Rewards | Felling a boss pays **100 XP** and counts in a new `RunEnd.bosses` field. `pearlsFor` adds **10 pearls per boss felled**. A run that dies to a boss still pays for the bosses behind it. | Hades pays for a boss. Ten is about 20% of a typical run's earnings, so a boss kill feels worth it without moving plan 019's 900-pearl price arithmetic much. Stage E re-checks D6 of plan 019. |
| D11 | Figures | Built from the existing skeleton parts at a larger `look.scale` (Captain 1.7, Mother 1.5, King 1.8), each with its own crown or prop silhouette and palette, through `skeletonSpec`, `PALETTE`, `CUTAWAY_ELLIPSE` and `CAUSE_LABELS`. No new art pipeline. | Boss figures need to read as bosses, not to introduce a new art style. The bench (`npm run figures`) shows them beside the others. |
| D12 | Sim before dealing | Stage A adds moves and phases to `decideEnemy` and the sim's bookkeeping while nothing deals a boss. `balance:check` must print exactly its current values. | The same proof plan 018 used (its D10): structure first, then measure. |

## Design

### Pure rules

- **`dungeon-bestiary.ts`.**
  - `Archetype` gains `moves?: Move[][]`, one list per phase, and
    `phases?: number[]`, the HP fractions where each later phase begins.
  - A `Move` is `{ attack, tell, damage, strikeRange, attackRange, cue, cueScale, bolt?, scatter?, summon? }`.
  - The three boss rows. Their `firstFloor` is `Infinity` (never dealt by
    `PACK_MIX`), and a new `boss: 1 | 2 | 3` field names their floor.
  - `ENEMY_KINDS` includes them, so the arena can stage them.
- **`dungeon-enemy.ts`.**
  - `EnemyView` gains `hp`, `maxHp`, `move` (an index) and `phase`.
  - `decideEnemy`, for an archetype with `moves`: picks the current move by
    rotation (D2); uses that move's tell, range, damage and cue; advances the
    rotation when the move completes; and returns `phaseChange` when HP
    crosses the next threshold (D3).
  - Ordinary archetypes take exactly today's path. A test holds that their
    intents are unchanged.
- **`dungeon-hits.ts`.** `bossPush(boss, knight)`: the phase-change knockback,
  as a pure displacement.
- **`dungeon-projectile.ts`.** `scatterRings(knightTrail, count, live)`
  returns at most `HOSTILE_POOL_RINGS - live` ring spots. The pools themselves
  are `deathPool`.
- **`dungeon-floor.ts`.**
  - `roster()` for the goal room keeps its placement draws and emits only the
    floor's boss (D5).
  - `buryReserves` gives the Bone King its rattler reserve. The reserve must
    cover phase 3's summons, so Stage A sizes it from the move list, not from
    `summons.count`.
- **`dungeon-sim.ts` and `dungeon-meta.ts`.** The 100 XP boss kill,
  `RunEnd.bosses`, and `pearlsFor` + 10 per boss (D10). Older records parse
  with `bosses: 0`.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- Apply the new intents:
  - the phase change: cancel, unhittable for 1.0 s, ring cue, `bossPush`,
    notice;
  - scatter rings: cue, then fire pools from the shared ring meshes;
  - move-specific cues.
- **The boss bar (D8).**
  - DOM, over the canvas, shown only while a boss is awake and alive.
  - It shows the name, HP and phase ticks, and the boss's floating bar is
    hidden.
  - It has `role="progressbar"` with an accessible name.
  - It must not overlap the vitality row on a 360 × 740 phone.
- The goal-room notice ("wardens bar the stair") names the boss instead.
- Snapshot: `boss: { kind, hp, maxHp, phase, move, unhittable } | null`, read
  off the live body.

### Sim (`scripts/balance/sim.ts`)

Mirror the game's bookkeeping, with the game's line beside each:
- phase change, unhittable time and push;
- scatter rings becoming pools, with damage attributed to the boss;
- a dodge rule for each new tell: away from a sweep ring, sideways from a
  lane, out of a marked ring;
- the boss bar's numbers as report fields.

Add report fields: `bossDamage`, `bossDeaths`, `bossSeconds` and
`bossHpLeft` (HP when the boss falls, before any top-up), per floor.

### What stays

- Every ordinary enemy, chamber, door and reward outside the goal room, and
  the generator's random stream.
- Plan 020's hall, slots and death card.
- The six fire rings and twelve arrows. Bosses are designed inside those
  caps, not given bigger ones.

## Stages

Each stage ends with:
- `npm run typecheck`, `npm run lint` and `npm test` green;
- `npm run balance:check` green;
- the browser specs it adds or touches run locally with `GAME_TEST_WORKERS=2`;
- the full PR-gate browser run done by CI on a draft PR. This is the
  operator's speed rule from plan 020; the agent does not run the full suite
  locally.

Every new test names the bug it can catch, and the stage plants that bug, runs
only that test, and records the failure message in `game/progress.md`
(AGENTS.md, "Writing tests that can fail").

### Stage 0 — Baseline (no game change)

1. `balance:check`: record every policy's numbers. Stage A is held to them
   exactly (D12).
2. **Goal-room fit.** Over the `balance:check` sweep and the pinned test
   seeds, record each floor's goal room: shape, free tiles, and the largest
   circle of open floor around the centre. Every move's reach (a sweep
   radius, a pounce lane, scatter spacing) must fit the **smallest** goal room
   with the knight able to stand outside it. Record the worst room. **Stop
   rule:** if a 45-tile crypt cannot hold the D4 moves, report it and propose
   either smaller reaches or a minimum goal-room size. The second would move
   the generator's stream, so it is the operator's call.
3. **Frame cost.** Stage a warden scaled to 1.8 alone in a goal room (a
   throwaway hook, reverted) and record calls, triangles and shadow calls next
   to the 508 ceiling. **Stop rule:** a boss chamber with its full summon
   reserve standing must fit under 508 calls, or be reported before Stage D.
4. **Exposure list.** List every spec and node test that depends on
   goal-room wardens:
   - `progression.spec.ts:105-281`
   - `special.spec.ts:564-616`
   - `shots.spec.ts:99-113`
   - `hall.spec.ts:183-188`
   - `dungeon-floor.test.ts:136-166`
   - the "any warden" finders, which on seed 0x1 resolve to the room-14
     warden, not the goal room. Check every one still finds a warden outside
     the goal room on its seed.

   Say how each will be restaged.

### Stage A — Moves and phases, nothing dealt

Implement the `Archetype` and `EnemyView` fields, the move selector, phase
change, `bossPush`, `scatterRings`, the sim's bookkeeping, and the report
fields. Give a **test archetype** two phases built from existing attacks (a
fixture in the test, never dealt).

Node tests (`dungeon-enemy.test.ts`, `balance-sim.test.ts`):

| Test | Plant |
| --- | --- |
| An archetype without `moves` produces exactly today's intents over a recorded sequence (compare with a literal recorded before the change) | Route every archetype through the move selector |
| The rotation advances only when a move completes, and an interrupted move does not advance it | Advance on every windup start |
| An out-of-range move is skipped for the next one that fits, and none is skipped when the knight is in range | Always take the next move |
| Crossing a threshold returns `phaseChange` once, cancels the windup, and the boss takes no damage for 1.0 s (assert the blow would have landed: precondition) | Allow damage during the change |
| A blow that takes HP across two thresholds enters each phase in order, never skipping one | Jump to the lowest phase |
| `bossPush` puts the knight outside the boss's largest reach | Push 1 tile |
| `scatterRings` never returns more spots than the free rings (six minus live pools, the knight's own counted) | Ignore the knight's pools |
| `simulateArena` with the test archetype records `bossDamage` > 0 and a phase change | Never apply `phaseChange` in the sim |

**Gate specific to this stage:** `balance:check` prints exactly Stage 0's
values (D12).

### Stage B — The Drowned Captain (floor 1)

Implement:
- the Captain's row, figure, palette, cutaway and cause label;
- `roster()` dealing it on floor 1 (D5), keeping the draws;
- the boss bar (D8), the notice and the snapshot field;
- the boss-kill reward (D10).

Node tests:
- Floor 1's goal room holds exactly the Captain. Every other room's spawns,
  props and the weapon drop are identical to `spawns-017.json`.
  - Plant: drop the kept draws.
- `pearlsFor` pays 10 per boss, and an old record parses with `bosses: 0`.
  - Plant: pay per kill instead.

Browser scenarios (`tests/browser/boss.spec.ts`; real input for the fight,
hooks only to stage):
1. **The fight is wired.** In the arena (`?arena=captain:1&level=1`), the
   Captain winds up its first move with that move's cue, the boss bar shows
   its name, and the floating bar is hidden.
   - Plant: show both bars.
2. **The phase is wired.** Bring it below 50% with real strikes. The snapshot
   says phase 2, it is unhittable for its window (assert a blow during it
   lands nothing), and the knight is pushed out.
   - Plant: no push.
3. **It gates the stair on a generated floor.** On a pinned floor-1 seed,
   teleport into the goal room. The stair is sealed while the Captain stands
   and opens when it falls. The floor card counts it.
   - Plant: `stairClear` ignores bosses.
4. **The bar fits a phone.** At 360 × 740 it does not overlap the vitality
   row.
   - Plant: a fixed 420 px bar.

Add the Captain's chamber to `frame-budget.spec.ts`, bounded on both sides
from this stage's measurement. Restage the Stage 0 step 4 scenarios for
floor 1.

### Stage C — The Pyre Mother (floor 2)

Implement the Mother and `scatter` in the game (cues, pools from the shared
rings).

Tests:
- In the arena, a scatter marks rings at the knight's last positions, and the
  rings become pools that bite a knight standing in them and not one outside.
  - Plant: pools at the boss's feet.
- With the knight's own flask pools on the ground, the Mother never asks for
  more rings than are free, and every ring it marks is drawn.
  - Plant: ignore live pools, so a seventh pool silently fails.

Restage floor-2 goal-room dependents.

### Stage D — The Bone King (floor 3)

Implement the King, its summon reserve sized for phase 3, its shield in
phase 1, and three phases.

Tests:
- The reserve covers every summon its move list can call, and the generated
  floor buries exactly that many.
  - Plant: bury `summons.count`.
- The shield blocks frontal steel in phase 1 and not in phase 2. Assert the
  phase is the precondition.
  - Plant: keep the shield in phase 2.
- Felling the King crumbles everything it called, and the stair opens. That
  is the win on floor 3, through the real card.
  - Plant: leave the reserve standing.

Stage 0 step 3's ceiling applies: the King's chamber with its reserve
standing must stay under 508 calls.

### Stage E — Tuning against D9

1. Run `balance:check` for every policy and record per floor:
   `bossDamage`, `bossDeaths`, `bossSeconds`, `bossHpLeft`, escape rate and
   cause of death.
2. Tune **HP and damage only** (D7) until D9 holds. Record each tuning step's
   numbers, then update `bands.json` (`measured` and `bands`) with a note.
3. **Stop rules.**
   - If D9 cannot be met without one boss accounting for more than 70% of
     all deaths, report it. A single wall is not a curve.
   - If meeting D9 needs a move list change, report it: that is a design
     decision, not tuning.
4. Re-check plan 019's price arithmetic with D10's boss pearls, and say
   whether D6 (twenty runs to buy everything) still holds.

### Stage F — Documents

- `GAME_OVERVIEW.md`: the bosses, the end of each floor, the boss bar.
- `README.md`: one line.
- `game/tests/README.md`: the boss snapshot field, arena kinds, and
  `boss.spec.ts`.
- `dungeon-bestiary.ts` header: how to add a boss (moves, phases, reserve
  sizing).
- `plans/README.md` row, and the `game/progress.md` entries.

### Stage G — Operator playtest

On a real GPU, five runs or more. Per boss:
- Did each move read before it landed?
- Did the phase change read?
- Did the bar help or clutter?
- Did it feel fair when it killed you?

Record the run log. D7 and D9 are re-decided here.

## Risks

- **Bot numbers are not player numbers.** A bot dodges every tell it
  recognises and none it doesn't. A boss tuned against bots can be trivial or
  unfair for a person. D9 is only a starting point; Stage G decides.
- **Goal rooms vary from 45 to 222 tiles.** A pattern that is fair in a court
  can be a trap in a crypt. Stage 0 step 2 measures the worst case and its
  stop rule decides whether to constrain the generator.
- **The phase knockback is the first time an enemy moves the knight.** Walls
  must stop it, and it must not push the knight out of the room or through a
  door. Test it against a wall.
- **Hidden caps.** Six fire rings and twelve arrows fail silently.
  `scatterRings` is capped by rule and tested, and the Mother's volleys must
  respect the arrow pool. A test fires the Mother's densest pattern and
  counts the bolts drawn.
- **Test churn.** Every spec that depends on goal-room wardens moves. Stage 0
  sizes the list.
- **Difficulty stays partly unaddressed.** If bosses meet D9 but runs still
  feel easy before them, that is the separate difficulty pass, not this
  plan's failure.

## Out of scope

- The general difficulty pass (healing, ordinary chambers, Heat).
- Boss dialogue, cutscenes, music changes and new art pipelines.
- Mini-bosses in ordinary chambers.
- Boons, doors and rewards outside the goal chamber.

## Evidence

Fill in per stage: gates, Stage 0's room-fit and frame numbers, the exposure
list and how each item was restaged, the tuning table, and the planted bug for
each new test with the message it failed with.
