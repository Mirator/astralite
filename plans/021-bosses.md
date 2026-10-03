# Plan 021: A boss at the bottom of every floor

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `86c7e8d`, 2026-10-03 (revised the same day for the
> operator's five-boss pool), after plan 020 merged
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
| D4 | The bosses (operator, 2026-10-03) | **Five bosses.** Floors 1 and 2 each deal one boss from a **pool of four**. Floor 3 always deals the fifth. The pool: **The Drowned Captain**, a huge warden: phase 1 is swing, swing, sweep; below 50% it adds a pounce lunge across the room. **The Pyre Mother**, ranged: phase 1 is volley, volley, scatter (D6); below 50% she adds a close sweep and scatters twice. **The Tide Hound**, a stalker grown huge: phase 1 is pounce, swing, pounce; below 50% its pounces chain two at a time and its tell shortens. **The Bastion**, a shieldbearer: phase 1 holds a frontal shield (`shield` arc) while not winding up, with swing, swing, sweep; below 50% the shield breaks and a charging pounce joins. The floor-3 boss is **The Bone King**: phase 1 is summon, swing, volley; below 60% he adds a sweep and a pounce; below 25% he summons on every second move. | The operator's call. Each pool boss tests a different answer: the Captain melee timing, the Mother space and range, the Hound lane dodging, the Bastion stagger and flanking. The fixed King is the run's final exam and draws on every one of them. The shield belongs to the Bastion alone, so the King and the Bastion do not overlap. Names are placeholders. |
| D13 | Which pool boss a floor gets | **Dealt per run from the run's first-floor seed by a pure `dealBosses(runSeed)`**, which uses its own hash and never draws from the generator's stream. **Floors 1 and 2 never get the same boss in one run.** All four pool bosses are equally likely on each floor. A pool boss on floor 2 is the same boss with `enemyStats`' usual floor scaling (one more hit of HP, +15% damage). `generateFloor` takes the boss kind as an option. Its default is the Captain, so every existing caller and fixture keeps a valid floor. | Variety between runs, which is the point of a pool, without making the floor generator's output depend on anything but its seed. Not repeating within a run is what a player expects of a pool. |
| D14 | Choosing a boss on purpose | A dev-only `?boss=<kind>` (like `?arm=`) overrides the deal for floors 1 and 2, for playtesting and for tests that need a particular boss on a pinned seed. `build:check` fails if it reaches the production bundle, as it does for `?hall=skip`. | Playtesting four pool bosses by luck is slow, and tests must not search seeds for a boss. |
| D5 | Who stands in the goal chamber | **The boss alone**, plus the Bone King's buried summon reserve on floor 3. No wardens. The roster keeps every placement draw it makes today (two or three bodies' tries), places the boss on the first body's spot, and does not emit the others. So `dropKind` and every other room's spawns, props and drop stay exactly as in `spawns-017.json`. | A boss fight is a duel. Adds come only from its own moves, so they are part of the pattern. Keeping the draws keeps every fixture outside the goal room valid, the same technique plans 019 and 020 used. |
| D6 | The one new mechanic | **`scatter`: a volley that marks one to three ground rings at the knight's last positions.** After the tell each ring becomes a fire pool, reusing `deathPool`, `poolStep` and `poolCatches` and drawn by the fire-ring meshes. The pool count is capped so the boss never needs more than `HOSTILE_POOL_RINGS` (6) live rings, counting pools from the knight's own flask. | Fire on the ground is the floor-2 pyre's identity. Making it a boss move gives the Pyre Mother a way to control space without a new hazard system. The cap is a stated rule with a test, because overflow today fails silently. |
| D7 | HP and thresholds (hypothesis) | Captain 60 HP, Mother 50, Hound 45, Bastion 70, King 80, in the same quarter-hit grain as other enemies. Floor scaling stays as `enemyStats` applies it. The thresholds are the D4 percentages. Stage F tunes **HP and damage only**, never the move lists, against D9. | The move lists are the design. HP and damage are the dials. |
| D8 | The boss bar (operator, agreed) | **A bar at the top of the screen, shown only while a boss is awake and alive.** It shows the boss's name and HP, with tick marks at the phase thresholds. It replaces the floating bar over that body, and it goes the moment the boss falls or the knight dies. | Hades shows one. It is not a persistent overlay (AGENTS.md): it exists only during the fight. The ticks tell the player a change is coming. |
| D9 | Targets: what bosses must do to runs (operator, agreed) | Measured by `balance:check` at 30 runs: **default bot**: escape 75–90%, and at least half its deaths to a boss. **Weak bot**: escape 30–55%. **weak-meta-max**: escape 55–80%. Boss fights last 25–60 s for the default bot. **Pool fairness:** in a per-boss duel report (the sim's arena, 30 seeds per boss per floor), no pool boss kills the weak bot more than twice as often as another on the same floor. HP left after a boss fight must be measured before the goal chamber's top-up (`bands.ts:50` measures after it; add a `bossHpLeft` field). | Bosses should end runs, mostly the weaker bots' runs, and the shop's upgrades should still visibly help. These are bot numbers. Stage G (playtest) is the real judge, and if bots and the human disagree, the human wins. |
| D10 | Rewards | Felling a boss pays **100 XP** and counts in a new `RunEnd.bosses` field. `pearlsFor` adds **10 pearls per boss felled**. A run that dies to a boss still pays for the bosses behind it. | Hades pays for a boss. Ten is about 20% of a typical run's earnings, so a boss kill feels worth it without moving plan 019's 900-pearl price arithmetic much. Stage F re-checks D6 of plan 019. |
| D11 | Figures | Built from the existing skeleton parts at a larger `look.scale` (Captain 1.7, Mother 1.5, Hound 1.6, Bastion 1.7, King 1.8), each with its own crown or prop silhouette and palette, through `skeletonSpec`, `PALETTE`, `CUTAWAY_ELLIPSE` and `CAUSE_LABELS`. No new art pipeline. | Boss figures need to read as bosses, not to introduce a new art style. The bench (`npm run figures`) shows them beside the others. |
| D12 | Sim before dealing | Stage A adds moves and phases to `decideEnemy` and the sim's bookkeeping while nothing deals a boss. `balance:check` must print exactly its current values. | The same proof plan 018 used (its D10): structure first, then measure. |

## Design

### Pure rules

- **`dungeon-bestiary.ts`.**
  - `Archetype` gains `moves?: Move[][]`, one list per phase, and
    `phases?: number[]`, the HP fractions where each later phase begins.
  - A `Move` is `{ attack, tell, damage, strikeRange, attackRange, cue, cueScale, bolt?, scatter?, summon? }`.
  - The five boss rows. Their `firstFloor` is `Infinity` (never dealt by
    `PACK_MIX`). A new `boss: 'pool' | 'final'` field marks them, and
    `BOSS_POOL` lists the four pool kinds in a fixed order.
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
  - `generateFloor(seed, level, { boss })`: `roster()` for the goal room keeps
    its placement draws and emits only the given boss (D5). Level 3 always
    gets the King, and floors 1 and 2 default to the Captain.
  - `dealBosses(runSeed)` returns two distinct pool kinds for floors 1 and 2
    (D13). It is a pure hash of the seed and never touches the generator's
    random stream.
  - `buryReserves` gives the Bone King its rattler reserve. The reserve must
    cover phase 3's summons, so Stage A sizes it from the move list, not from
    `summons.count`.
- **`dungeon-sim.ts` and `dungeon-meta.ts`.** The 100 XP boss kill,
  `RunEnd.bosses`, and `pearlsFor` + 10 per boss (D10). Older records parse
  with `bosses: 0`.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- Deal the run's bosses with `dealBosses(firstSeed)` (or the dev `?boss=`,
  D14) when floor 1 is built, and pass each floor its boss. Record both in
  the run record, as `RunEnd.bossKinds`, so a playtest report names which
  bosses a run met.
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
`bossHpLeft` (HP when the boss falls, before any top-up), per floor, each
naming the boss.

The sim deals bosses with the same `dealBosses`. A new `npm run balance:bosses`
reports per-boss duels: `simulateArena` for each boss on each floor it can
appear on, 30 seeds, default and weak policies, recording death rate, fight
seconds and HP left. That is D9's pool-fairness check.

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
   reserve standing must fit under 508 calls, or be reported before Stage B.
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

### Stage B — The Drowned Captain, the deal and the bar

Implement:
- the Captain's row, figure, palette, cutaway and cause label;
- `generateFloor`'s `boss` option, `dealBosses` (D13) and the dev `?boss=`
  with its `build:check` guard (D14);
- the boss bar (D8), the notice and the snapshot field;
- the boss-kill reward (D10).

Until Stages C and D land, the pool holds only the Captain, so `dealBosses` deals
it on both floors; the no-repeat rule is tested once the pool has two. Floor 3
deals the Captain as a stand-in until Stage E.

Node tests:
- Floor 1's goal room holds exactly its boss. Every other room's spawns, props
  and the weapon drop are identical to `spawns-017.json`.
  - Plant: drop the kept draws.
- `dealBosses` is deterministic per seed and never touches the generator's
  stream: generate a floor, call `dealBosses`, then generate again and compare
  the second floor with a fresh one.
  - Plant: draw from the generator's `random`.
- `pearlsFor` pays 10 per boss, and an old record parses with `bosses: 0` and
  no `bossKinds`.
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
3. **It gates the stair on a generated floor.** On a pinned floor-1 seed with
   `?boss=captain`, teleport into the goal room. The stair is sealed while the
   Captain stands and opens when it falls. The floor card counts it.
   - Plant: `stairClear` ignores bosses.
4. **The bar fits a phone.** At 360 × 740 it does not overlap the vitality
   row.
   - Plant: a fixed 420 px bar.

Add the Captain's chamber to `frame-budget.spec.ts`, bounded on both sides
from this stage's measurement. Restage the Stage 0 step 4 scenarios, using
`?boss=` where a test needs a known boss.

### Stage C — The Pyre Mother and `scatter`

Implement the Mother, `scatter` in the game (cues, and pools from the shared
rings), and add her to `BOSS_POOL`.

Tests:
- In the arena, a scatter marks rings at the knight's last positions, and the
  rings become pools that bite a knight standing in them and not one outside.
  - Plant: pools at the boss's feet.
- With the knight's own flask pools on the ground, the Mother never asks for
  more rings than are free, and every ring she marks is drawn.
  - Plant: ignore live pools, so a seventh pool silently fails.
- Her densest volley pattern never needs more than the twelve-arrow pool:
  count the bolts drawn.
  - Plant: a pattern of thirteen.
- `dealBosses` never deals the same boss to floors 1 and 2, over 1,000 seeds,
  and deals both pool bosses on each floor. Assert both counts are non-zero,
  as the precondition.
  - Plant: deal floor 2 independently.

### Stage D — The Tide Hound and the Bastion

Implement both and add them to `BOSS_POOL`.

Tests:
- **Hound:** in phase 2 a pounce chains a second pounce without a fresh tell,
  and a single dash clears both lanes only when timed between them. Assert
  the chained pounce fired, as the precondition.
  - Plant: no chain.
- **Bastion:** the shield turns frontal steel in phase 1 and not in phase 2
  (the phase is the precondition). A stagger arm or a flank gets through in
  phase 1.
  - Plant: keep the shield in phase 2.
- With four pool bosses, every pool boss appears on each floor in a sweep of
  seeds, and the deal's distribution is roughly even (each between 15% and
  35% per floor over 1,000 seeds).
  - Plant: weight one boss double.

### Stage E — The Bone King (floor 3)

Implement the King, its summon reserve sized for phase 3, and three phases.
Floor 3 always deals it.

Tests:
- The reserve covers every summon its move list can call, and the generated
  floor buries exactly that many.
  - Plant: bury `summons.count`.
- Phase 3 summons on every second move (move count is the precondition).
  - Plant: summon every third move.
- Felling the King crumbles everything it called, and the stair opens. That
  is the win on floor 3, through the real card.
  - Plant: leave the reserve standing.

Stage 0 step 3's ceiling applies to every boss chamber: the King's chamber
with its reserve standing must stay under 508 calls.

### Stage F — Tuning against D9

1. Run `balance:check` for every policy and `balance:bosses` for every boss,
   and record per floor:
   `bossDamage`, `bossDeaths`, `bossSeconds`, `bossHpLeft`, escape rate and
   cause of death.
2. Tune **HP and damage only** (D7) until D9 holds. Record each tuning step's
   numbers, then update `bands.json` (`measured` and `bands`) with a note.
3. **Stop rules.**
   - If D9 cannot be met without one boss accounting for more than 70% of
     all deaths, report it. A single wall is not a curve.
   - If D9's pool-fairness check fails after tuning HP and damage, report
     which boss and why. Some move lists may simply be harder.
   - If meeting D9 needs a move list change, report it: that is a design
     decision, not tuning.
4. Re-check plan 019's price arithmetic with D10's boss pearls, and say
   whether D6 (twenty runs to buy everything) still holds.

### Stage G — Documents

- `GAME_OVERVIEW.md`: the bosses, the end of each floor, the boss bar.
- `README.md`: one line.
- `game/tests/README.md`: the boss snapshot field, arena kinds, and
  `boss.spec.ts`.
- `dungeon-bestiary.ts` header: how to add a boss (moves, phases, reserve
  sizing, the pool, `?boss=`).
- `plans/README.md` row, and the `game/progress.md` entries.

### Stage H — Operator playtest

On a real GPU, ten runs or more, so each pool boss appears at least twice
(use `?boss=` for any that don't). Per boss:
- Did each move read before it landed?
- Did the phase change read?
- Did the bar help or clutter?
- Did it feel fair when it killed you?

Record the run log, including `bossKinds`. D4, D7 and D9 are re-decided here.

## Risks

- **Bot numbers are not player numbers.** A bot dodges every tell it
  recognises and none it doesn't. A boss tuned against bots can be trivial or
  unfair for a person. D9 is only a starting point; Stage H decides.
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
- **A random pool adds variance.** Two runs on different seeds meet
  different bosses, so a run's outcome depends partly on the deal. The pool
  fairness check (D9) bounds it, and `bossKinds` in the run log lets a
  playtest report say which bosses killed whom.
- **Floor-1 bosses that teach floor-2 ideas.** The Mother brings fire and the
  Bastion a shield to floor 1, before pyres and shieldbearers appear there.
  The playtest judges whether that reads as unfair. The fix would be keeping
  them on floor 2, which narrows floor 1's pool.
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

Filled in 2026-10-03 (`claude/beautiful-gauss-5o0cw4`, Stages 0 and A); the full record, with every number and each planted bug and the message it
failed with, is the 2026-10-03 entry in `game/progress.md`.

- **Stage 0.**
  - Baseline: `balance:check` in band on all 72 metrics (default escape 100, weak 83.3, weak-meta-max 100, default 149.0 s a run).
  - Goal-room fit (90 sweep rooms, 45 pinned, 1,500 further): smallest 45 free tiles (a 4 x 3 crypt, e.g. seed 3 floor 3), largest 222 (a court); refuge 6.10 in the
    worst room, 11.56 in a court. D4 states no reaches, so the stop rule is answered against stand-ins: a 45-tile crypt holds a sweep up to 5.6, lanes (stone clips
    them) and three 1.7 rings (28% of the room). **Not tripped**; 5.6 and 28% are the envelope the real reaches are chosen inside.
  - Frame cost: a warden alone at 1.8 in the worst of six goal rooms is 317 calls / 245,574 triangles / 85 shadow calls against 508 (191 to spare); 38 calls a warden,
    29 a rattler. A reserve of **six standing at once fits under 508 in that room (491), seven does not (520)**. **Not tripped**, and the figure Stage E is held to.
  - Exposure: the five listed items need restaging in Stage B (progression, the special slam and the node stair test on count and 100 XP, the capture baseline, the hall message). The
    "any warden" finders all still find one on their seeds (seed 0x1's first warden is room 14), with two exceptions: seed 0x60 floor 1 has both its wardens in the goal room (only the
    light budget uses it, and needs none), and the Heavy Bolt scenario needs a second warden that on seed 0x1 floor 1 is a goal-room one.
- **Stage A.** Gates: typecheck, lint, `npm test` 402/402 (ten new); `balance:check` prints Stage 0's 72 values exactly (diffed row by row, twice, the second on the final tree). Planted bugs and
  their messages, one per test: ordinary intents routed through the selector (`guard: its intents over the scripted fight are not what they were before plan 021`); advance on every windup
  start (`a move began and the rotation had already moved on`); always take the next move (`in range of the first move it did not begin the first move`); damage during the change
  (`a blow took 3 off a boss in the middle of a phase change`); jump to the lowest phase (`the first change entered phase 2: it skipped phase 1`); push one tile (`a knight 0 from the boss on
  side 0 was left 1.48 from it, inside its 3.1 reach`); ignore the knight's pools (`the knight's own pools were not counted against the rings`); the sim never applies the phase change
  (`no boss ever changed phase: the sim never applies intent.phaseChange`, and, with only the stored state removed, `a boss with one threshold changed phase 28638 times`). Two bonus tests, their
  plants too (a move's damage unscaled; scatter rings never lit). Deferred and said so: the sim's marked-ring dodge (its plant survived), and `bossHpLeft` before a top-up (the arena pays none).

- **Stage B** (2026-10-03, `claude/beautiful-gauss-5o0cw4`; the full record, with each planted bug and its message, is the "Stage B" entry in `game/progress.md`).
  - Gates: typecheck, lint, `npm test` 415/415; `balance:check` in band on the final tree (two runs; the first red on the weak knight's floor 1 and 2 vitality minimums, 78 to 60 and 70 to 60, `measured` re-taken, no Stage F tuning); `build` and `build:check` clean. Browser specs run locally: `boss` (4), `progression`, `hall`, the special slam and Heavy Bolt, the capture scene, `run-export`, `slots`, `meta`, `death`, `arena-kinds`, `dealt-kinds`, the Captain's frame scene. CI on #87 is the full gate.
  - Built: the Captain (swing, swing, sweep; below half swing, pounce, sweep; scale 1.7; its own hat-and-anchor figure and palette), `generateFloor`'s `boss` option (the goal room keeps every placement draw and emits the boss alone; all 90 recorded floors compared), `dealBosses`, dev `?boss=` with the `build:check` guard, the game threading `move`, `phase` and `change` and applying the phase change (unhittable, ring, `bossPush`, notice), the boss bar and goal notice and the snapshot `boss`, and the reward (100 XP, `RunEnd.bosses`, `bossKinds`, 10 pearls a boss, old records parse with `bosses: 0` and no list). The harness boots every page with `?boss=captain`.
  - Frame: the Captain standing in the tightest goal chamber is **320 calls / 246,034 triangles** (Stage 0's stand-in read 317 / 245,574), against the 508 ceiling; the ceiling is set at the measurement and the scene is bounded on both sides.
  - Balance: weak escape 83.3 to 90.0, special-crossbow 93.3 to 90.0, the weak knight's median vitality left 86.4 / 82.0 / 73.6 to 70.0 / 69.6 / 74.4, the default knight 100 throughout (it took no boss damage in the median fight). Bot boss fights last a median 6.1 s (default) and 5.3 s (weak) against D9's 25 to 60 s: the Captain lowers HP and kills almost no bot yet, which is Stage F's to tune (HP and damage), reported and not retuned. `bossHpLeft` is read before the top-up in the sim (median 100 for the default bot, 56 for the weak).
  - Exposure list restaged: progression (two scenarios), the Maul slam, the Heavy Bolt line (in the arena), the hall comparison, the capture scene (frame to regenerate), the 017 floor fixture test and the stair test. The "any warden" finders still resolve outside the goal room.
  - Planted bugs (each with its message in progress.md): the kept draws dropped, the boss option drawing from the stream, a stateful deal, floor two dealt independently, pearls per kill, an old record growing a list, a boss paying 25, the leak marker removed and the production guard lifted, the pounce lost, a 6 sweep, the sweep first, both bars shown, no push, the change clock not stored, `stairClear` ignoring bosses, a fixed 420 px bar, sixty extra joints.

- **Stages C and D** (2026-10-03, `claude/beautiful-gauss-5o0cw4`; the full record, with each planted bug and its message, is the "Stages C and D" entry in `game/progress.md`).
  - Gates: typecheck, lint, `npm test` 436/436; `balance:check` in band on the final tree (517 s; no band moved, `measured` re-taken); browser specs run locally: `boss` (9), the four boss chambers in `frame-budget`, `bench`, `arena-kinds`, `hall`, `progression`, `dealt-kinds`. CI on #87 is the full gate.
  - Built: the Pyre Mother (volley, volley, scatter; below half a five-bolt fan, a close sweep and two scatters), `scatter` applied in the game (cue, rings marked on the free shared fire-ring meshes where the knight has been, pools where they were marked), the fan and its arrow budget
    (`volleyDemand` against `ARROW_POOL`), the sim's marked-ring dodge; the Tide Hound (pounce, swing, pounce; below half the tells shorten and the pounces chain, `Move.chain`); the Bastion (swing, swing, sweep behind a frontal shield; below half the shield breaks, `shield.until`, and a charge joins).
    The pool is all four; the deal is tested over 1,000 seeds (never a repeat on floors one and two, every boss on each floor, each 15% to 35% of a floor).
  - Frame: the pool bosses in the tightest goal chamber floors one and two lay (seed 33 floor two, a 45-tile crypt): Mother **291 calls / 210,062 triangles**, Hound **253 / 210,696**, Bastion **273 / 212,962**, against the 508 ceiling (217, 255 and 235 to spare); the Captain's (floor three's crypt) stays 320 / 246,034.
  - Fit: Mother's sweep 2.6, Hound's swing 2.6, Bastion's sweep 3.2 (Stage 0 allows 5.6); lanes hold their leap and are 2.2 wide (a 45-tile crypt is three tiles across); the Mother's rings are at most three of radius 1.6, 24% of the smallest chamber (Stage 0: 28%).
  - Balance: weak escape 90.0 (unchanged), default 100, special-crossbow 90.0 to 80.0 (three of its six non-escapes are the Bastion, whose shield turns its bolts aside), meta-max 100 to 96.7 (one sim-artifact stuck run, a pursuit tie), weak-meta-max floor 1 and 2 vitality left 79.7 / 75.5 to 83.1 / 84.5.
    Bot duels run 5 to 12 s against D9's 25 to 60 s and kill nobody (the weak knight keeps 78 / 74 of its vitality against the Mother, 52 / 44 against the Captain, 46 / 37 against the Hound and 40 / 31 against the Bastion, floor one / floor two): Stage F's to tune.
  - Planted bugs (each with its message in progress.md): phase two without the Mother's sweep, a fan of thirteen (node and browser), four rings, never stepping out of a marked ring, floor two dealt independently, one boss weighted double, pools at the boss's feet, scatter ignoring live pools, no chain, a chain that keeps its recovery,
    a chained move skipped to, the shield kept in phase two (node, sim, browser, and the rule alone), a stagger arm turned aside, the Bastion's charge removed, extra joints on three figures.

- **Stages E, F and G** (2026-10-03, `claude/beautiful-gauss-5o0cw4`; the full record, with every tuning step, each planted bug and its message, is the "Stage E, Stage F and Stage G" entry in `game/progress.md`).
  - Gates: typecheck, lint, `npm test` green; `balance:check` in band on the shipped tree (623.5 s); browser specs run locally: `boss` (11), `frame-budget` (the King, `--repeat-each=4`; the Captain), `progression`, `dealt-kinds`, `arena-kinds`, `bench`, `models`, `polish`, the special slam. CI on #87 is the full gate (it found three floor-three specs that assumed the Captain, and a 16-triangle variance in the King's frame; both fixed).
  - Built: the Bone King (summon, swing, volley; below 60% a sweep and a pounce; below 25% a summon every second move; scale 1.8), `reserveSize` (the most one phase's round can raise: four, from 2, 2 and 4), floor three always dealing him, his figure, his fall crumbling standing and buried rattlers and opening the stair (the win, through the real cards), the per-move `perTell` in the game.
  - Frame: the King with his four rattlers standing, in the 45-tile crypt of seed 0x86 floor three: **427 calls, 267,984 triangles, 81 under the 508 ceiling**, identical over four runs (the scene waits for the held rattlers to stop walking; a fixed 400 ms read 16 triangles apart on CI). Stage 0: six standing fit (491), seven do not (520). The Captain moved to seed 33 floor two: 273 / 212,078.
  - Tuning (HP and damage only): Captain 290 vitality and damage x0.5, Mother 215 and x0.8, Hound 260 and x0.5, Bastion 240 and x0.55, King 500 and x0.6. **D9: default escape 80.0 (75 to 90), all its deaths bosses', fights a median 30 s (25 to 60), weak 33.3 (30 to 55): met. weak-meta-max 100 (55 to 80): not met, and not reachable with the weak band** (the pairs (weak, weak-meta-max) run from (60, 100)
    to (3.3, 63.3): the bot with Second Tide needs two lethal events). **Pool fairness met only because every fresh-knight duel is lost 100% by the weak knight** (a cliff, not a curve). The Pyre Mother is 50% of the boss deaths and all of the default knight's. The special-crossbow knight is shut out (3.3% escape). No stop rule tripped; no move list or timing changed.
  - D6 (plan 019's prices, unchanged): with 10 pearls a boss a human run earns about 51.5 against 43, so 900 pearls is about 17.5 runs against 21: "about twenty" holds with a 15% slip; the bots' boss pearls are 20 to 21% of their pay (D10's guess).
  - Planted bugs (each with its message in progress.md): bury `summons.count`, size the reserve from phase one, a summon every third move, the reserve left standing (node, sim and browser), `raise` ignoring the move's `perTell`, sixty extra crown spikes; and for `balance:bosses`: the fewest deaths not floored, the default rows counted, the policy ignored, the King not fought, a widened weak band.
