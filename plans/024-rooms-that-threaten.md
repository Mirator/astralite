# Plan 024: Rooms that threaten

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `a6fb211`, 2026-10-04, after plan 023 merged
> (PR #89). Source was read, and 20 read-only `simulateRun` batches were run while
> writing it. Line numbers drift; search for the names. Decisions marked
> **(operator)** wait for the operator's answer before Stage A starts.

## Why

The operator: "the rooms feel easy and boring, every room feels same." Plan 022
answered "boring" with waves and elites. Plan 023 tried to answer "easy" by
turning number dials, and hit its stop rule: no dial moved the default bot. It
enters every stair hall at 100% vitality and has never died before one. This
plan is about why.

What the source and the batches show (2026-10-04, default policy, 20 runs):

- **The bot's dodge is effectively perfect, and that is a sim artefact.**
  - The dodge test in `scripts/balance/sim.ts` (`nerve() < policy.dodge`, in the
    threat block) is re-rolled **every frame** while a tell is readable.
  - A guard's readable window is 0.5 − 0.22 = 0.28 s, about 17 frames, so
    `dodge: 0.8` misses a tell with probability about 0.2^17. That is never.
  - The policy reads as "dodges 80% of attacks", but the bot dodges all of
    them. Every balance number in plans 021–023 was measured against this player.
- **Ordinary enemies barely land.** The default bot takes about 0.9, 2.9 and 2.4
  vitality per fight chamber from ordinary enemies on floors 1, 2 and 3.
  - Gauntlet embers dealt more damage than every ordinary enemy combined: 460,
    390 and 420 against 138, 456 and 428.
  - The bot has no rule for avoiding embers at all.
- **Healing swamps what little lands.** Grave Draught (`DRAUGHT` 5 per kill per
  stack) returns about 14, 19 and 21 vitality per chamber on floors 1–3. The bot
  took it in 19 of 20 runs, because its boon pick is always `offer[0]`.
- **Enemies never coordinate.** `decideEnemy` is per body, with no shared
  state. In theory four guards make 2.3 tells a second. In practice fights last
  2–9 s, and the bot's one dash per 0.8 s is enough, because it always dodges and
  steps back out of reach.
- **Wave and ambush bodies start in sync.** They all get `cooldown ≥ 0.9` on the
  same frame and then drift apart. Their threats cluster for a moment and then
  spread out.

So three things make rooms easy:
1. The measuring stick, a bot that cannot be hit.
2. Healing that out-earns damage.
3. Enemies whose threats arrive one at a time, from melee range, with nothing on
   the ground.

A human who "finds rooms easy" has the same experience for the last two
reasons. This plan fixes the stick first, then changes the design.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | Make the bot a fair stand-in for a player | **Fix the sim before tuning anything.**<br>- `dodge` becomes one roll **per tell**, made when the tell first becomes readable.<br>- The bot's boon pick becomes a seeded draw from the offer, not `offer[0]`.<br>- The bot gets the ember-avoid rule it lacks: it treats a flaring grate like a pool. | Every target since plan 021 was set against a player who never gets hit. A per-tell roll is what "dodge 0.8" was always meant to say. Fixing it will move every band, and that is the point. |
| D2 | Policies after D1 (operator) | **Re-cast the bots to bracket a human:**<br>- `default`: dodge 0.8 per tell, reaction 0.22.<br>- `skilled`: a new policy, dodge 0.95, reaction 0.18, the "good player".<br>- `weak`: unchanged, never dodges.<br>The default bot is the target player; `skilled` must still be able to lose. | The operator plays well, so one dodging bot cannot speak for both a new player and a practised one. |
| D3 | Threats that overlap (operator) | **A pressure rule in `dungeon-enemy.ts`.** When two or more bodies in a chamber are ready to swing, the second one's tell is timed to land 0.4–0.6 s after the first's, inside the knight's 0.8 s dash cooldown, instead of whenever. This is one shared, pure `pressure(bodies, clock)` that both the game and the sim call. It never shortens a tell, and it never lets three threats land within 0.35 s (the knight's `INVULN`). | This is how Hades rooms bite: you dodge the first, and the second is already coming. One dash per threat stops working, and positioning starts to matter. Every blow is still telegraphed for its full tell. |
| D4 | Ranged pressure in the mix (operator) | Every wave after the first, from floor 1, includes at least one ranged body: an archer, or a pyre from floor 2. The roll comes from the wave stream (`dungeon-waves.ts`), so `generateFloor` stays byte-identical. Floor 1's archers keep their current stats. | Melee alone lets the knight win by stepping back. One body that punishes stepping back forces a choice. |
| D5 | Something on the floor (operator) | **"Tide marks" in late waves.** In a chamber's last wave, from floor 2, scatter-style rings mark the knight's recent trail every ~4 s and light as shallow water pools. They do 4 damage a tick and slow the knight by 30%. They reuse `scatterRings`/`scatterPool` and the shared hostile ring meshes, so they add no draw calls, and they respect `HOSTILE_POOL_RINGS` (6). | Embers already prove that floor threats are what make the bot bleed; they out-damage all enemies combined. Rings on existing meshes are free under the 508-call budget. Grates would cost 27 calls a room. Slow, not burn, keeps it distinct from fire. |
| D6 | Healing (operator) | **Grave Draught 5 → 2 per kill.** Mend door 30, shrine 35 and descent 25% stay. | At 5 per kill and 3–4 kills a room, Draught heals more per chamber than ordinary enemies deal, with no choice involved. 2 keeps it worth taking without erasing every room. |
| D7 | Targets | Measured after D1, at 30 runs.<br>**Default bot:**<br>- Escape 50–75%.<br>- At least a quarter of deaths before the stair hall.<br>- Median vitality entering floor 1's stair hall 50–85%.<br>- Ordinary-enemy damage per fight chamber ≥ 6 on floor 1.<br>**Skilled bot:** escape 75–95%.<br>**Weak bot:** escape 0–20%.<br>**weak-meta-max:** escape at least 15 points above weak.<br>**Crossbow special:** escape at least half the default's.<br>**Pearls:** plan 023 D2's bands, re-measured. | Rooms must cost a dodging player something every time, and a good player must still win most runs. The per-chamber damage figure is the direct measure of "rooms threaten", and needs a new report field. |
| D8 | What stays | Tells, boss move lists, room layout and count, prices, the wave telegraph and the elite modifiers. | The design changes here are pressure, mix and floor. The readability contract is not touched. |

### Operator decisions after Stage A (2026-10-05)

- **D3 (pressure), D4 (ranged in later waves), D6 (Grave Draught 5 → 2): approved.**
- **D5 (tide marks): skipped.** Stage A showed embers were the bot's main damage only because it walked through them (32% → 3.5% of its losses once it avoids them), so the case for a floor hazard is weaker than the Why claimed. Stage D is not done.
- **The Pyre Mother** is the one pool boss that kills the honest default bot (10% / 20% of duels on floors 1 / 2, the others 0%). Stage E brings D12 fairness back within HP/damage and flips the pinned test in `tests/balance-bosses.test.ts` back to asserting `ok`.
- Targets stay D7, measured against the honest bot.

## Design

### Pure rules

- **`dungeon-enemy.ts`:** `pressure(...)` (D3). It returns a per-body delay before
  a ready body may begin its tell. It is deterministic, takes no random input, and
  never shortens a tell.
- **`dungeon-waves.ts`:** the ranged-body rule (D4), and the tide-mark cadence
  for last waves (D5), both on the wave stream.
- **`dungeon-projectile.ts`:** a `tideMark` pool type with `slow`. `poolCatches`
  reports the slow. `dungeon-player.ts` applies it to movement only, never to the
  dash.
- **`dungeon-sim.ts`:** `DRAUGHT = 2`.

### Sim (`scripts/balance/sim.ts`)

- The per-tell dodge roll (D1): roll when a body's tell becomes readable, store
  the result on the body, and clear it when the tell ends.
- The seeded boon pick (D1).
- The ember-avoid rule (D1).
- The `skilled` policy (D2).
- The `pressure` and tide-mark calls.
- A new report field, `ordinaryDamagePerChamber`, per floor.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- Call `pressure` where enemy intents are decided.
- Draw tide marks on the hostile ring meshes, with a water tint distinct from
  fire.
- Snapshot: `tideMarks`, and a per-enemy `held`, the pressure delay.

## Stages

Each stage ends with:
- `npm run typecheck`, `npm run lint` and `npm test` green.
- `npm run balance:check` green.
- The touched browser specs run locally with `GAME_TEST_WORKERS=2`.
- CI on a draft PR as the gate.

Each new test plants its bug and records the failure message in
`game/progress.md`.

### Stage 0: Baseline

Record the plan 023 state per policy. Add `ordinaryDamagePerChamber` and record
it.

### Stage A: The honest bot (D1, D2)

1. Make the per-tell dodge, the seeded boon pick, ember avoidance and `skilled`.
2. Re-measure every policy and re-band `bands.json`, editing it as text. The
   game does not change in this stage, so every browser spec must be untouched.

Tests:
- A tell is dodged or not once, for its whole length.
  - Plant: a per-frame roll. Show the measured miss rate over 1,000 tells,
    bounded on both sides around 0.2.

**Stop and report after Stage A** with the new table. The operator decides
D3–D6 against honest numbers. Every number in this plan's Why may move.

### Stage B: Pressure (D3)

Tests:
- Two ready guards: the second tell ends 0.4–0.6 s after the first.
  - Plant: no pressure.
- Three ready bodies never land within 0.35 s.
- No tell is shorter than its kind's.
- Browser: real input against two guards, reading both tells' end times off the
  snapshot.

### Stage C: Ranged in waves (D4)

Tests:
- Every later wave from floor 1 deals a ranged body, over 1,000 seeds.
  - Plant: drop the rule.
- `generateFloor` stays byte-identical: the SHA test from plan 022 must stay
  green.

### Stage D: Tide marks (D5)

Tests:
- Marks fall on the trail and slow the knight's walk, never the dash.
  - Plant: slow the dash.
- The ring cap holds with pyre fire and flask pools alive.
- Frame budget: the wave chamber with marks lit stays at its measured calls.

### Stage E: Healing and tuning (D6, D7)

1. Set `DRAUGHT` to 2.
2. Tune only the D3 timing window, the D5 cadence and damage, and boss
   HP/damage. Record every step in `progress.md`.
3. **Stop rules:**
   - Report if D7 needs a tell change.
   - Report if the skilled bot drops under 75% before the default bot reaches
     its band. That would mean the pressure punishes good play, not sloppy play.
   - Never widen a band to pass.

### Stage F: Documents and playtest

1. Documents: `GAME_OVERVIEW.md`, the `plans/README.md` row, `progress.md`,
   and the plan's Evidence.
2. The operator plays five runs on a GPU and answers:
   - Do rooms cost vitality?
   - Is a double threat readable?
   - Do tide marks read as water and not as fire?
   - Does the Draught still feel worth taking?

## Risks

- **D1 moves every number at once.** That is why the plan stops after Stage A.
  Without it, every later decision is tuned against a player who cannot be hit.
- **Pressure can feel cheap.** The guards are the full tell, the 0.4 s
  minimum gap and `INVULN`, and the playtest judges it.
- **More floor effects mean more visual noise.** Tide marks are last-wave only,
  from floor 2, with a distinct tint.

## Out of scope

- New room types, new enemy kinds and traps with their own meshes.
- Knight hit-stun or knockback from ordinary enemies.
- The sim bot's door choice.
- Turning waves on across the browser suite.

## Evidence

(Filled in by each stage.)

### Stage 0: the baseline (2026-10-04, main `a6fb211` + this plan)

Full tables in `game/progress.md`, "Plan 024 Stage 0". 30 runs a policy from seed 1, the same runs `balance:check` plays; the new report field changed nothing the bots play (every number `bands.json` already held is unchanged).

| policy | escape % | deaths f1 / f2 / f3 (count) | deaths before the stair hall | median vitality entering the stair hall f1 / f2 / f3 | ordinaryDamagePerChamber f1 / f2 / f3 | median pearls |
| --- | --- | --- | --- | --- | --- | --- |
| default | 90 | 1 / 1 / 1 | 0 of 3 | 100 / 100 / 100 | 0.59 / 1.43 / 1.87 | 107 |
| weak | 16.7 | 5 / 7 / 13 | 9 of 25 (36%) | 89.2 / 90.5 / 92 | 7.82 / 16.54 / 26.2 | 52.5 |
| special | 96.7 | 0 / 0 / 1 | 0 of 1 | 100 / 100 / 100 | 0.32 / 1.8 / 1.81 | 107 |
| special-fangs | 96.7 | 0 / 0 / 1 | 1 of 1 | 100 / 100 / 100 | 0.69 / 1.58 / 3.07 | 107 |
| special-cleaver | 93.3 | 2 / 0 / 0 | 0 of 2 | 100 / 100 / 100 | 0.74 / 1.84 / 2.57 | 107 |
| special-crossbow | 50 | 0 / 3 / 12 | 12 of 15 (80%) | 100 / 100 / 92.4 | 0.34 / 11.55 / 22.53 | 87.5 |
| special-flask | 53.3 | 0 / 0 / 14 | 0 of 14 | 100 / 100 / 100 | 1.39 / 3.69 / 5.86 | 103.5 |
| meta-max | 100 | 0 / 0 / 0 | 0 of 0 | 100 / 100 / 100 | 0.61 / 1.27 / 1.68 | 107 |
| weak-meta-max | 83.3 | 0 / 0 / 5 | 2 of 5 | 92.3 / 98.7 / 96.8 | 6.39 / 15.37 / 23.34 | 107 |

The default knight's damage over a whole run: 14% ordinary enemies, 37.7% bosses, 32.3% embers, 16% pools. The plan's Why quoted 0.9 / 2.9 / 2.4 a chamber for the default knight; the field says 0.59 / 1.43 / 1.87.

### Stage A: the honest bot (2026-10-04, D1 and D2; sim only)

Full tables and the planted bugs are in `game/progress.md`, "Plan 024 Stage A". Per-tell dodge (miss rate over ~1,000 tells: 0% at dodge 1, 19.3% at 0.8, 50.0% at 0.5), a seeded card draw, ember avoidance and the `skilled` policy (dodge 0.95, reaction 0.18); all `bands.json` measured blocks re-taken, `balance:check` green on them. Before → after, 30 runs a policy:

| policy | escape % | deaths f1 / f2 / f3 (% of arrivals; count) | deaths before the stair hall (count, share) | median vitality entering the stair hall f1 / f2 / f3 | ordinaryDamagePerChamber f1 / f2 / f3 | median pearls |
| --- | --- | --- | --- | --- | --- | --- |
| default | 90 → 86.7 | 3.3 / 3.4 / 3.6 (1/1/1) → 0 / 3.3 / 10.3 (0/1/3) | 0 of 3 (0%) → 1 of 4 (25%) | 100 / 100 / 100 → 100 / 100 / 100 | 0.59 / 1.43 / 1.87 → 1.71 / 5.22 / 7.19 | 107 → 107 |
| skilled | (new) 93.3 | (new) 0 / 0 / 6.7 (0/0/2) | (new) 0 of 2 (0%) | (new) 100 / 100 / 100 | (new) 0.63 / 2.39 / 3.65 | (new) 107 |
| weak | 16.7 → 23.3 | 16.7 / 28 / 72.2 (5/7/13) → 16.7 / 16 / 66.7 (5/4/14) | 9 of 25 (36%) → 8 of 23 (35%) | 89.2 / 90.5 / 92 → 94 / 94.4 / 100 | 7.82 / 16.54 / 26.2 → 8.26 / 17.36 / 24.04 | 52.5 → 64.5 |
| special | 96.7 → 100 | 0 / 0 / 3.3 (0/0/1) → 0 / 0 / 0 (0/0/0) | 0 of 1 (0%) → 0 of 0 (0%) | 100 / 100 / 100 → 100 / 100 / 100 | 0.32 / 1.8 / 1.81 → 1.43 / 3.62 / 5.11 | 107 → 107 |
| special-fangs | 96.7 → 96.7 | 0 / 0 / 3.3 (0/0/1) → 0 / 0 / 3.3 (0/0/1) | 1 of 1 (100%) → 1 of 1 (100%) | 100 / 100 / 100 → 100 / 100 / 99.2 | 0.69 / 1.58 / 3.07 → 1.53 / 3.97 / 6.43 | 107 → 107 |
| special-cleaver | 93.3 → 86.7 | 6.7 / 0 / 0 (2/0/0) → 3.3 / 0 / 10.3 (1/0/3) | 0 of 2 (0%) → 0 of 4 (0%) | 100 / 100 / 100 → 100 / 100 / 100 | 0.74 / 1.84 / 2.57 → 1.9 / 5.22 / 6.99 | 107 → 107 |
| special-crossbow | 50 → 50 | 0 / 10 / 44.4 (0/3/12) → 0 / 10 / 44.4 (0/3/12) | 12 of 15 (80%) → 11 of 15 (73%) | 100 / 100 / 92.4 → 100 / 100 / 92.4 | 0.34 / 11.55 / 22.53 → 0.56 / 13.28 / 21.57 | 87.5 → 88 |
| special-flask | 53.3 → 63.3 | 0 / 0 / 46.7 (0/0/14) → 0 / 0 / 36.7 (0/0/11) | 0 of 14 (0%) → 0 of 11 (0%) | 100 / 100 / 100 → 100 / 100 / 100 | 1.39 / 3.69 / 5.86 → 1.25 / 4.76 / 6.59 | 103.5 → 104 |
| meta-max | 100 → 100 | 0 / 0 / 0 (0/0/0) → 0 / 0 / 0 (0/0/0) | 0 of 0 (0%) → 0 of 0 (0%) | 100 / 100 / 100 → 100 / 100 / 98.6 | 0.61 / 1.27 / 1.68 → 1.46 / 4.39 / 6.03 | 107 → 107 |
| weak-meta-max | 83.3 → 60 | 0 / 0 / 16.7 (0/0/5) → 0 / 0 / 40 (0/0/12) | 2 of 5 (40%) → 1 of 12 (8%) | 92.3 / 98.7 / 96.8 → 96.2 / 94.7 / 92.3 | 6.39 / 15.37 / 23.34 → 6.57 / 15.24 / 24.1 | 107 → 106.5 |

Damage share by cause (ordinary enemies / bosses / hazards (embers) / pools):

| policy | ordinary enemies % | bosses % | hazards (embers) % | pools (fire) % | vitality lost a run |
| --- | --- | --- | --- | --- | --- |
| default | 14 → 41.6 | 37.7 → 41.4 | 32.3 → 3.5 | 16 → 13.5 | 216 → 273 |
| skilled | (new) 28.3 | (new) 40.9 | (new) 7.7 | (new) 23.1 | (new) 198 |
| weak | 60 → 65.3 | 27.4 → 29.6 | 7.8 → 0 | 4.8 → 5.2 | 440 → 457 |
| special | 16.6 → 37.7 | 32 → 37.6 | 31.7 → 7.2 | 19.7 → 17.5 | 197 → 230 |
| special-fangs | 24.7 → 49.6 | 13.5 → 17.5 | 36.5 → 6.3 | 25.3 → 26.6 | 187 → 210 |
| special-cleaver | 20 → 43.8 | 31.5 → 39.4 | 34.5 → 7.9 | 14 → 8.9 | 197 → 259 |
| special-crossbow | 75.9 → 75.6 | 10.7 → 12.8 | 2.9 → 0.9 | 10.5 → 10.7 | 317 → 334 |
| special-flask | 33.8 → 43.1 | 39.2 → 43.2 | 13 → 3.4 | 14.1 → 10.3 | 264 → 238 |
| meta-max | 14.3 → 41.2 | 33.4 → 41.4 | 36 → 5.3 | 16.3 → 12.1 | 203 → 240 |
| weak-meta-max | 59.6 → 64.5 | 28.3 → 30.6 | 7.8 → 0.1 | 4.4 → 4.8 | 603 → 586 |

Pool-boss duels at stair-hall vitality (30 duels each): default Mother 3% → 10% (floor 1) and 7% → 20% (floor 2), Captain, Hound and Bastion 0% before and after; skilled Mother 3% and 13%, the others 0%; weak 0% everywhere; the King kills default 83% → 100% and skilled 97% from a full bar. D12 pool fairness is **not met** for the default knight (floor 1: Mother 3, Captain 0; floor 2: Mother 6, Captain 0) or the skilled one on floor 2 (Mother 4, Captain 0).

D7 against the Stage A numbers (default / skilled / weak): escape 86.7 (asks 50-75) / 93.3 (75-95, met) / 23.3 (0-20); one of four default deaths before the stair hall (25%, asks at least a quarter: met on the edge); median vitality entering floor 1's stair hall 100 (asks 50-85); ordinary damage a chamber on floor 1 1.71 (asks at least 6). The plan's Why said 0.9 / 2.9 / 2.4 a chamber on floors 1-3 for the default knight; the Stage 0 field says 0.59 / 1.43 / 1.87 and Stage A 1.71 / 5.22 / 7.19. The default knight's embers fell from 32.3% to 3.5% of what it loses, and ordinary enemies rose from 14% to 41.6%.
