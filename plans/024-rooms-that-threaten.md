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
