# Plan 023: Pearls, the crossbow, and rooms that hurt

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `f5ee477`, 2026-10-04, after plan 022 merged
> (PR #88). Source was read; nothing was measured while writing it. Line numbers
> drift; search for the names. Decisions marked **(operator)** use the
> recommendation unless the operator overturns them before Stage A starts.

## Why

Plan 022 made the chambers more varied: waves, rings, elites. It did not make
them dangerous, and it broke two other things. Its record (`game/progress.md`,
plan 022 Stage E, and the plan's Evidence) shows:

- **Rooms still do not hurt.** The default bot arrives at every stair hall at
  100% vitality. Its median watch fight lasts 6.2 s and its run 244 s. Every
  one of its deaths is a boss's. The difficulty sits on a knife-edge in the Bone
  King: at 665 vitality the weak bot escapes 10% of runs, at 670 it escapes 0%.
- **Pearls inflated.** `pearlsFor` (`dungeon-meta.ts`) pays one pearl a kill.
  Waves roughly doubled the kills, so the default bot's median run now pays about
  200 pearls. The whole 900-pearl shop (plan 019's D6: "about twenty runs") now
  costs about 4.5 runs. A human who clears a floor kills the same bodies, so this
  is real, not a bot artefact.
- **The crossbow is shut out.** The Keep Crossbow special policy escapes 0%.
  Four bolts of 9 with one back every 1.8 s is about 5 damage a second of
  sustained fire. Against a 290–650 vitality boss that is a minute or more of
  kiting, and the bosses close faster than that.
- **Pool fairness failed for the weak bot.** On floor 1 the Captain kills it in
  every duel and the Pyre Mother in none.

The operator's playtest of plan 021 said "the rooms feel easy and boring". Plan
022 answered "boring". This plan answers "easy", and repairs what 022 broke.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | How pearls are earned (operator) | **Pay per fight chamber cleared, not per kill.** A cleared chamber that held a fight pays `CHAMBER_PEARLS` (start at 2). An elite still pays `ELITE_PEARLS` (1) on top, and bosses, floors and the escape pay as today. `RunEnd.kills` stays as a record. Prices are unchanged. | A chamber is the unit a player chooses. Its count per run is fixed by the floor's layers, not by how many bodies a wave deals, so later wave tuning can never inflate the economy again. Keeping prices means no save is devalued. |
| D2 | Pearl targets | Measured by the sim at 30 runs. **Median pearls per run: weak bot 30–55, default bot 80–130.** That puts the 900-pearl shop at about 18–30 runs of a weak player and 7–11 of a strong one. Stage D tunes `CHAMBER_PEARLS` and, only if needed, the floor pearls (15) to land there. | Plan 019's D6 was "about twenty runs" for a typical player. The weak bot is the nearer proxy for a new human, and the default bot for a practised one. |
| D3 | Crossbow against bosses (operator) | **Bolts deal ×2 damage to bosses** (`BOSS_BOLT`, in `dungeon-hits.ts` where a blow is landed), the Heavy Bolt included. Nothing else about the crossbow changes. Target: the crossbow special escapes at least half as often as the default bot. | The arm works in rooms; it fails only where vitality is in the hundreds. A boss multiplier is the narrowest fix, and it leaves the crossbow's room play, where it is already balanced, alone. A larger quiver would also change room fights. |
| D4 | Waves from the first fights | **`FIRST_WAVE_LAYERS` 2 → 1.** The first fight past the gate stays one wave as the tutorial beat; from the second on, watch fights take waves. | 54% of watch chambers sit in layers 1–2 (plan 022 Stage E), so the median fight cannot move while they stay single-wave. One tutorial fight is enough. |
| D5 | Ordinary enemies press harder (operator) | Three dials, tuned in Stage D within these ranges and **only for ordinary kinds** (never bosses):<br>- **`recovery` ×0.7–1.0**: more swings per minute.<br>- **Floor damage scaling** in `enemyStats` (+15% a floor today): +15% to +30%.<br>- **Elites on floor 1** at 0–10% (today 0).<br>Tells (`tell`) stay as they are: readability is the one thing not traded. | Pressure, not health. More bodies (022) gave the bots more to kill but nothing that hits back harder or sooner. Recovery is how often a body threatens, and damage scaling is how much carried damage the deeper floors cost. All three are rules the sim already plays. |
| D6 | Bosses after rooms bite | **Boss vitality and damage are re-tuned down if needed** in Stage D, after D4 and D5, so the stair hall stays the hardest fight and not the only one. The plan 022 knife-edge (King 650) is re-measured, and **the King's vitality must sit where ±20 vitality moves no policy's escape rate by more than 10 points.** | A difficulty that flips from 10% to 0% on 5 vitality is a tuning that will break on the next change. |
| D7 | Targets (operator) | Measured by `balance:check` and `balance:bosses` at 30 runs.<br>**Default bot:**<br>- Escape 60–85%.<br>- At least a quarter of its deaths before the stair hall (today 0).<br>- Median vitality entering floor 1's stair hall 50–90% (today 100%).<br>**Weak bot:**<br>- Escape 5–30%.<br>- Median vitality entering floor 1's stair hall 30–70% (today 91%).<br>**weak-meta-max:** escape at least 15 points above weak.<br>**Crossbow special:** as D3.<br>**Pearls:** as D2.<br>**Pool fairness, both bots:** no pool boss kills a bot more than twice as often as another on the same floor, with the duel started at that bot's median vitality entering the stair hall. | These are plan 022's targets with the ones that proved unreachable for bots loosened (run length, watch-fight seconds). They also add what 022 showed matters: rooms must cost vitality. The plan 022 absolute weak-meta-max band is replaced by its relative one, which 022 met; the absolute pair ran into plan 021's wall twice. |
| D8 | What stays | Tells, move lists, room layout, the room count, the shop prices, the wave telegraph and elite modifiers. | Each of those is a design decision, not a dial. |

## Design

### Pure rules

- **`dungeon-meta.ts`:** `CHAMBER_PEARLS`, and `pearlsFor` takes a `chambers` count (the fight chambers cleared) in place of `kills`. `RunEnd` gains `chambers`, and an older run record without it pays as before when re-read (nothing re-pays an old run, but the type must accept it).
- **`dungeon-hits.ts`:** `BOSS_BOLT = 2`. A ranged blow on a body whose archetype has `boss` is multiplied by it, the Heavy Bolt included.
- **`dungeon-waves.ts`:** `FIRST_WAVE_LAYERS = 1`, and `ELITE_RATE[1]` as tuned.
- **`dungeon-enemy.ts` / `dungeon-bestiary.ts`:**
  - `RECOVERY_SCALE` for ordinary kinds, applied where `RECOVERY` is read.
  - `FLOOR_DAMAGE`, the per-floor damage step in `enemyStats` (today 0.15). Bosses keep their own `scaledDamage` step unless Stage D records a reason.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- Count fight chambers cleared into the run's `chambers` where a chamber settles with a fight in it.
- The result card's pearl line reads `pearlsFor` as today.

### Sim (`scripts/balance/sim.ts`, `bosses.ts`)

- Count `chambers` the same way, and report `pearls` per run. A `pearls` metric with its band goes into `bands.json` for every policy.
- `balance:bosses --at-stair` already exists (plan 022). Fairness for both bots is read from it.

## Stages

Each stage ends with:
- `npm run typecheck`, `npm run lint` and `npm test` green.
- `npm run balance:check` green.
- The browser specs it adds or touches run locally with `GAME_TEST_WORKERS=2`.
- The full PR-gate browser run done by CI on a draft PR. The agent does not run
  the full suite locally.

Every new test names the bug it can catch. The stage plants that bug, runs only
that test, and records the failure message in `game/progress.md` (AGENTS.md,
"Writing tests that can fail"). Rank-up cards: a scenario that fells several
floor-2/3 bodies can now open a boon card mid-scene (plan 022's CI finding);
stage around it with real input, never by widening a wait.

### Stage 0: Baseline

Record, per policy at 30 runs:
- escape;
- deaths by floor and cause, and deaths before the stair hall;
- median vitality entering each stair hall;
- median pearls per run (computed from today's `pearlsFor`);
- the crossbow special's numbers;
- the duel table at stair-hall vitality for both bots.

Also measure the King knife-edge: escape for every policy at King vitality 610, 630, 650, 670 and 690.

### Stage A: Pearls by chamber

1. Add `CHAMBER_PEARLS` and `chambers`, in the game and the sim.
2. Tune `CHAMBER_PEARLS` (and only if needed the floor pearls) to D2.
3. Update `GAME_OVERVIEW.md`'s progression paragraph in this stage, since it quotes the run count.

Tests:
- A run that clears N fight chambers pays N × `CHAMBER_PEARLS` plus the rest, whatever its kill count.
  - Plant: pay per kill again.
- A chamber with no fight (shrine, gate) pays nothing.
  - Plant: count every chamber.
- The result card shows what `pearlsFor` says, through the real card.

### Stage B: The crossbow against bosses

1. Add `BOSS_BOLT` (D3).

Tests:
- A bolt on a boss deals ×2, and the same bolt on a warden ×1.
  - Plant: no multiplier.
- The Heavy Bolt on a boss is multiplied too.
- The browser arena scenario with real keys reads the boss's vitality drop.

### Stage C: Rooms that press

1. Add `FIRST_WAVE_LAYERS` 1 and the D5 dials as named constants, at their current values. `balance:check` must print exactly Stage A's values.
2. Then set `FIRST_WAVE_LAYERS` to 1 and re-measure.

Tests:
- The second fight past the gate is dealt waves; the first is not.
  - Plant: `FIRST_WAVE_LAYERS` 2.
- `RECOVERY_SCALE` reaches ordinary kinds and never a boss.
  - Plant: apply it to a boss.
- `FLOOR_DAMAGE` scales a floor-3 guard as the snapshot reports it.

### Stage D: Tuning against D7

1. Tune in this order, recording every step in `progress.md`:
   1. `RECOVERY_SCALE`.
   2. `FLOOR_DAMAGE`.
   3. `ELITE_RATE[1]`.
   4. Boss vitality and damage, D6's flatness rule included.
   5. `CHAMBER_PEARLS` again if the run lengths moved D2.
2. Update `bands.json` (`measured` and `bands`, the new `pearls` metric included) with a note. Edit it as text with minimal edits; never pass it through a JSON serializer.
3. **Stop rules:**
   - If D7 needs a tell, a move list, the room count or a new mechanic, report it.
   - If the default bot's deaths before the stair hall stay under a quarter with every D5 dial at its limit, report the table. That would mean the bot's dodging, not the numbers, is the wall, and a human playtest decides.
   - Never widen a band to pass.

### Stage E: Documents

- `GAME_OVERVIEW.md`: pearls by chamber, the crossbow against bosses, and the harder rooms.
- `README.md`: one line if any player-facing claim changed.
- `game/tests/README.md`: any new snapshot field.
- The `plans/README.md` row for 023, and the `game/progress.md` entries.
- The plan's Evidence.

### Stage F: Operator playtest

Five runs or more on a real GPU, at least one with the crossbow:
- Do rooms cost vitality?
- Does a mend door feel needed?
- Is the shop's pace right?
- Can the crossbow beat a boss?

## Risks

- **Bots dodge perfectly.** D5 may move the weak bot a lot and the default bot
  barely. The second stop rule names that outcome instead of chasing it with ever
  bigger numbers.
- **Pressure that reads as unfair.** Shorter recovery means more simultaneous
  swings. Tells stay, so every blow is still readable; the playtest judges
  whether a crowd is fair.
- **Economy.** Paying per chamber changes what a death pays: a death deep in a
  floor pays more than a fast one. That is intended. Plan 019's price arithmetic
  is re-stated in Stage A.

## Out of scope

- New room types, traps, cursed doors.
- The sim bot's door choice (taking mends when hurt).
- Turning waves on across the whole browser suite; the harness still boots with
  `?waves=off` (plan 022, open).
- Boon synergies, room-reward previews.

## Evidence

Stages 0, A, B, C, D and E were implemented on `claude/beautiful-gauss-5o0cw4`; the numbers and every planted bug with its failure message are in `game/progress.md` (the plan 023 entries of 2026-10-04). In short:

- **Stage 0 (baseline).** The simulation reproduced plan 022 Stage E's shipped numbers exactly. At the shipped King (650) the weak knight escaped 10, 10, 10, 0 and 0% at King vitality 610, 630, 650, 670 and 690, and special-flask moved 13.3 points between 630 and 670 (D6's rule did not hold).
- **Stage A (pearls by chamber).** `CHAMBER_PEARLS` and `Run.chambers`; the stair hall is its boss's, not a chamber. D2's two bands could not both be met by `CHAMBER_PEARLS` and the floor pearls on the Stage A bots (the default bot out-earned the weak one 4.5 to 5 times); they could once the boss damage cut let the weak knight live longer.
- **Stage B (crossbow).** `BOSS_BOLT` for the crossbow's bolts only (the flask and the thrown spear are untouched; the arm's own `bolt` flag). x2: 0 -> 10% escape; D3's target was not met at x2.
- **Stage C.** The D5 dials as named constants (no change, proved run by run), `FIRST_WAVE_LAYERS` 1: a small effect (the shipped wave table has no rule for opening packs).
- **Stage D.** Stop rule 2 tripped (progress.md has the table): with every D5 dial at its limit the default bot's deaths before the stair hall stay 0 of 3 and its vitality entering floor one's stair hall 100%; the dials only hurt the weak bot and the crossbow, so `RECOVERY_SCALE` 1 and `FLOOR_DAMAGE` 0.15 ship, with floor-one elites at 5%. `BOSS_BOLT` 4 (range 2 to 4 set while tuning, the lowest that meets D3: crossbow special 50% against the default knight's 90%). The Captain, Hound and Bastion hit about 45% softer (the weak knight lost every one of their duels and none of the Pyre Mother's: pool fairness, D7), the King is 630. Pearls 1 a chamber and 5 a floor: default 107, weak 52.5, the shop in 8.4 and 17 runs. Final D7: met, default boss fight, both pearls rows, weak escape 16.7, weak-meta-max over weak +66.7, crossbow, pool fairness for both bots, King flatness; **not met**, default escape 90 (85 asked), default deaths before the stair hall (0%), default and weak vitality entering floor one's stair hall (100 and 89.2).
- **Stage E.** The documents (this and `GAME_OVERVIEW.md`, `README.md`, `plans/README.md`, `game/progress.md`).
- **Stage F is the operator's:** five runs or more on a real GPU, one with the crossbow: do rooms cost vitality, does a mend door feel needed, is the shop's pace right, can the crossbow beat a boss.
