# Plan 022: Waves, elites and attrition

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `3e11334`, 2026-10-03, after plan 021 merged
> (PR #87). Source was read; nothing was measured while writing it. Line numbers
> drift; search for the names. Decisions marked **(operator)** use the
> recommendation unless the operator overturns them before Stage A starts.

## Why

The operator played plan 021: "The boss is hard, but could be okayish. But the
rooms feel easy and boring, every room feels same." The source explains it:

- **Packs are tiny.** In `generateFloor`'s `roster`
  (`dungeon-floor.ts`), an opening fight is 1–2 bodies, a middle fight 2–3,
  a late fight 2–3 plus a warden, an ambush 3–4, the gauntlet 2 stalkers. A
  guard has 8 vitality.
- **Every fight is one beat.** The whole pack stands in the room when the
  knight walks in. You see it, you kill it, you pick a door.
- **Damage never accumulates.** Every clear heals `TOP_UP` 12 (`dungeon-sim.ts`),
  a mend door 30, a shrine 35 and each descent 25% of max. Grave Draught adds 6
  per kill.
- **A guard is a guard.** Floor 3 adds one blade hit of HP and +15% damage
  (`enemyStats`). Nothing about a body says "this one is different".
- **Runs are short.** The default bot's median run is 208 s for three floors
  (`bands.json`). Each chamber is over in seconds.

Hades makes each chamber a small encounter: enemies arrive in waves, each
announced on the floor before it appears. Elite enemies with visible modifiers
change how a familiar enemy is fought. Health is only restored where the player
chose to restore it. This plan brings those three things to the keep, plus the
re-tuning they force on the bosses. It adds **no new room types** (operator,
2026-10-03): survival rooms, champion rooms, cursed doors and traps are out of
scope.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | Which chambers fight in waves | **Watch fights and purse (hoard) fights.** Ambush chambers stay one sprung wave: the ambush is their identity. Gauntlets stay one wave of stalkers under the embers. The first two fights past the gate (`layer <= 2`) stay one wave, as the tutorial beat. The stair hall is the boss's. | Waves are the biggest single change to how a chamber plays. Keeping the ambush and gauntlet as they are keeps the existing identities distinct from the new standard fight. |
| D2 | How many waves, and what is in them | Wave 1 is **exactly today's pack** (same kinds, same tiles). Then:<br>- **Middle fights:** a second wave of 2–3, drawn from the `late` mix.<br>- **Late fights:** a second wave of 2–3 from `late`, and a third of 1–2 plus a warden.<br>- **Hoards:** a second wave of 2–3 from `hoard`.<br>- **Floors 2 and 3:** add one body to the last wave.<br>No wave is larger than 5 bodies and no chamber larger than 10. | Later waves escalate in their mix, so a chamber builds towards something instead of repeating. The caps keep the frame budget (see Risks) and keep the fight readable. |
| D3 | When the next wave comes | **When every body of the current wave is dead**, after a 0.5 s pause. Its spawn marks (D4) then show for 0.9 s before the bodies stand. A wave is never triggered by time alone. | This is predictable and learnable, and it gives the knight a breath. A timer would punish slow arms (the crossbow) and the bot's dawdling equally badly. |
| D4 | The wave telegraph | **A ring on the floor at each spot where a body will stand, for 0.9 s,** drawn with the same shared hostile-ring meshes as the summon cue, then the rise burst `raise()` already plays. A spot within 2.5 of the knight when the marks appear moves to the nearest free tile beyond 2.5 (the `raiseSpot` rule). There is a sound cue and no text notice. | The player must see where the next threat comes from, and must never be spawned on. The rings and the burst are art the game already draws. Minimal HUD (AGENTS.md): no "Wave 2/3" banner. |
| D5 | How waves are dealt, without moving every seed | Waves and elites are dealt by a **pure `dealWaves(floor, seed, level)` in a new `dungeon-waves.ts`** from its own hash stream, the way `dealBosses` does. `generateFloor` is not touched, so its output stays byte-identical. Wave bodies are **appended after every existing spawn, buried reserves included**, with a new optional `Spawn.wave` (2 or 3; absent means wave 1). Each wave body's tile is drawn from its room's free tiles, away from wave 1's tiles. | About 47 tests pin seeds to today's spawns (`dungeon-floor.test.ts`, `frame-budget.spec.ts`, `dealt-kinds.spec.ts` and others). One extra `random()` in `generateFloor` would reshuffle all of them. Appending keeps every existing spawn index, and with it every `summoner` link. |
| D6 | Hidden until called | A later-wave body starts `awake: false, visible: false`, like an ambush body. There is a new rule, `waveDue(room)`, in `dungeon-waves.ts` that both the game and the sim call. The ambush spring (`dungeon-game.tsx`, the `sprung` filter, and `sim.ts`'s copy) and the bot's targeting filter must skip `wave > 1` bodies. `settleRoom` already keeps a room sealed while any body in it is alive, dormant or not, so clearing needs no change. | One rule, two callers, and the same structure `nearbyDozers` uses. The world closure and the sim duplicate logic by hand today, and a wave rule copied twice will drift. |
| D7 | Elites (operator) | **Four modifiers, dealt per body:**<br>- **Hasted:** speed ×1.35, tell ×0.8.<br>- **Armoured:** vitality ×2.<br>- **Wrathful:** damage ×1.4.<br>- **Volatile:** on death leaves a fire pool, using the pyre's `deathPool` (radius 1.7, 3.5 s).<br>Never on bosses, rattlers or bonecallers. Floor 1 deals none; floor 2 makes 15% of eligible bodies elite (at most 1 per wave); floor 3 makes 25% (at most 2 per wave). They are dealt from D5's stream. | Each modifier changes the answer to a known enemy: a hasted stalker's pounce comes sooner, an armoured warden wants the stagger arm, a volatile guard must not die at your feet. All four reuse rules that already exist (`speed`, `tell`, `hp`, `damage`, `deathPool`), so the sim gets them for nearly free. Splitting and shielding variants need new mechanics and are left for later. |
| D8 | How an elite looks | **The body glows in its modifier's colour, and its eyes take the same colour.**<br>- Hasted: cyan.<br>- Armoured: steel.<br>- Wrathful: red-orange.<br>- Volatile: ember.<br>The glow is applied in `poseEnemy`'s idle emissive branch, because that branch overwrites the emissive every frame; wind-up and struck flashes keep winning over it. Its floating health bar gets a small pip in the same colour. There is no text label. | It must be readable at a glance in a crowd, at no extra draw calls. A per-body material tint is free, because materials are already per body (`enemy.skins`). An aura mesh would cost a call per elite. |
| D9 | What an elite pays | **Double XP and 2 pearls instead of 1.** | It is a bigger threat, so it is worth more. The pearl effect on plan 019's price arithmetic is small and is re-checked in Stage F. |
| D10 | Healing (operator) | **`TOP_UP` goes from 12 to 0:** a cleared chamber no longer heals. Mend doors (30), shrines (35) and the 25% heal between floors stay. The balance sim gains the shrine's +35, which it does not model today (a parity gap). Grave Draught is tuned in Stage F if it dominates once there are more kills. | Damage carried between chambers is what makes a choice of door matter: the mend door becomes a real choice instead of a small bonus. It is also the change that most directly answers "easy". |
| D11 | Crossbow against bosses (operator) | **The Keep Crossbow's heavy bolt (its special) passes through shields**, the shieldbearers' and the Bastion's. Then measure. If the crossbow special policy still escapes less than half as often as the default bot, Stage F reports it and proposes the next step. | After plan 021's tuning the crossbow special escapes 3.3% of runs: a buyable arm is shut out. A piercing heavy bolt is consistent with its own description, and it is the smallest change that gives the arm an answer to the Bastion. |
| D12 | Bosses after this plan | **Boss HP and damage are re-tuned in Stage F**, because the knight now arrives at the stair hall hurt. Fairness now applies to the **default** bot as well as the weak one: no pool boss kills either bot more than twice as often as another on the same floor. That targets the Pyre Mother's spike: she alone kills the default bot today. | Plan 021 tuned the bosses against a knight who arrived nearly full. Leaving their 215–500 vitality in place under attrition would turn the stair hall into a wall. |
| D13 | Targets (operator) | Measured by `balance:check` at 30 runs.<br>**Default bot:**<br>- Escape 55–80%.<br>- At least a third of its deaths before the stair hall.<br>- Median vitality on reaching floor 1's stair hall 40–80%.<br>- Median run 300–600 s.<br>**Weak bot:** escape 10–35%.<br>**weak-meta-max:**<br>- Escape 30–60%.<br>- At least 15 points above weak.<br>**Ordinary chambers:** the default bot's median watch-fight lasts 12–40 s.<br>**Fairness:** as D12. | Ordinary chambers must now end some runs, and the boss still ends more. A run lasting 5–10 minutes is still short of Hades, but it is double today's. The shop must visibly help: plan 021 could not separate weak from weak-meta-max because healing erased every upgrade's carried value. Attrition should make Deep Lungs and Second Tide count. These are bot numbers. The Stage G playtest decides. |
| D14 | Dev access | A dev-only `?elite=<modifier>` makes every eligible body in an `?arena=` roster that elite. A dev-only `?waves=off` deals wave 1 only, for comparing. `build:check` fails if either reaches the production bundle. | Elites must be playable on demand. Seed-hunting for a volatile warden is how tests go wrong. |

## Design

### Pure rules

- **`dungeon-waves.ts` (new, pure, no React/DOM/three):**
  - `WAVE_PAUSE = 0.5`, `WAVE_MARK = 0.9`, the per-source wave table (D2), the
    caps.
  - `dealWaves(floor, seed, level): Spawn[]` returns the floor's spawns with the
    later waves appended. It uses its own hash stream, never `generateFloor`'s.
  - `dealElites(spawns, seed, level)` returns `Spawn.elite?: Modifier`, drawn
    from the same stream after the waves.
  - `waveDue(bodies, room, clock)` returns the wave that should be marked or
    raised now, or nothing.
  - `waveSpots(...)` applies the 2.5 clearance (D4).
- **`dungeon-bestiary.ts`:** `ELITES`, a record of each modifier's multipliers,
  colour and eligibility.
- **`dungeon-enemy.ts`:** `eliteStats(kind, level, modifier)` builds on
  `enemyStats`, so every caller that scales a body applies an elite the same
  way.
- **`dungeon-sim.ts`:** `TOP_UP = 0`. Shrine healing is moved here as
  `SHRINE = 35`, so the game and the sim read one number. `pearlsFor` counts an
  elite as 2.
- **`dungeon-hits.ts`:** the heavy-bolt shield pass-through (D11), next to
  `blocks`.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- Build the floor's spawns through `dealWaves` and `dealElites`, then make the
  enemy views as today.
- The ambush `sprung` filter skips `wave > 1`.
- Each tick, a sealed room asks `waveDue`. When it answers, the game shows the
  marks on the shared hostile rings, and when they expire it raises the bodies
  with the `raise()` burst. The rule lives in the pure module; the closure only
  draws.
- In `poseEnemy`'s idle branch the elite emissive and the eye colour are
  applied. The health bar gets its colour pip.
- Snapshot:
  - Each enemy gains `wave` and `elite`.
  - `chamber` gains `wave: { at, of, marked }`.
  - Each enemy gains `maxHp`, so a test can read an armoured body's vitality
    without recomputing it.

### Sim (`scripts/balance/sim.ts`)

- Use `dealWaves` and `dealElites` as the game does.
- The ambush wake and the bot's target filter skip later waves.
- Call `waveDue` in the room loop.
- Apply shrine healing.
- New report fields:
  - `waveFights`: seconds per fight.
  - `deathsBeforeBoss`.
  - `hpAtStair`: vitality on entering each stair hall.
  - `eliteKills` by modifier.
- `bosses.ts` (the duel report) can start a duel at `hpAtStair` as well as at
  full vitality. Plan 021 found the full-vitality duel too blunt to compare
  bosses.

### What stays

- The room layout, doors, encounter bag and the four encounter identities.
- Every existing spawn, and its index.
- Ambush and gauntlet fights.
- The boss move lists and tells. Only HP and damage move, in Stage F.

## Stages

Each stage ends with:
- `npm run typecheck`, `npm run lint` and `npm test` green.
- `npm run balance:check` green, from Stage A on.
- The browser specs it adds or touches run locally with
  `GAME_TEST_WORKERS=2`.
- The full PR-gate browser run done by CI on a draft PR. The agent does not run
  the full suite locally.

Every new test names the bug it can catch. The stage plants that bug, runs only
that test, and records the failure message in `game/progress.md` (AGENTS.md,
"Writing tests that can fail").

### Stage 0: Baseline (no game change)

1. Record from `balance:check` and the plan 021 numbers:
   - Escape, deaths by floor and by cause, and median run seconds per policy.
   - The default bot's median fight length per encounter.
   - Vitality on entering each stair hall.
2. Measure whether a hidden body (`visible = false`) costs draw calls. Use the
   frame-budget harness with an ambush room before and after it springs.
   - If hidden bodies cost calls, D2's caps must count every wave, not the
     largest. Report this before Stage B.
3. Add the shrine's +35 to the sim as a separate commit, re-measure, and update
   `bands.json`'s `measured` with a note. Edit it as text: a JSON serializer
   rewrite produced a 411-line diff before.

### Stage A: Waves as structure, nothing dealt

1. Build `dungeon-waves.ts`, `Spawn.wave`, `waveDue`, the sprung and target
   filters, and the snapshot fields.
2. Run with a wave table that deals nothing beyond wave 1. `balance:check` must
   print exactly Stage 0's values.

Tests:
- `dealWaves` leaves every existing spawn byte-identical and only appends.
  - Plant: insert a wave body before the buried reserve.
- A later wave does not wake on entry.
  - Plant: drop the `wave > 1` skip from the sprung filter.
- `waveDue` raises wave 2 only after the last wave-1 body dies, after the pause
  and the marks.
  - Plant: trigger on the first death.

### Stage B: Waves dealt, in the game

1. Deal D2's table.
2. Draw the telegraph (D4).
3. Raise the bodies.
4. Add a frame-budget scene for the largest single wave on floor 3 (see Risks).

Tests:
- A middle fight, played with real input, raises its marked wave where the
  marks were and keeps the doors barred until the last wave falls. Assert the
  precondition: the marks were drawn.
  - Plant: doors open after wave 1.
- No mark lands within 2.5 of the knight.
  - Plant: drop the clearance.
- The sim and the game agree on a floor's waves. Read it off the running scene,
  not off `dealWaves`.

### Stage C: Elites

1. Build the modifiers (D7), the dealing, the look (D8) and the rewards (D9).
2. Add `?elite=` (D14).
3. Add the bench figures with each tint.

Tests:
- Armoured doubles vitality as the snapshot reports it.
  - Plant: ×1.
- Hasted's tell is shorter as `decideEnemy` runs it.
  - Plant: ignore the tell multiplier.
- A volatile death leaves a pool that hurts.
  - Plant: no pool.
- No boss, rattler or bonecaller is ever dealt an elite, over 1,000 seeds.
  - Plant: drop the eligibility check.
- The rates are held per floor over 1,000 seeds, within a stated tolerance.
- The elite glow survives the idle pose and loses to the wind-up flash.
  - Plant: tint written before the idle branch.

### Stage D: Attrition and the crossbow

1. Set `TOP_UP` to 0 (D10).
2. Make the heavy bolt pass through shields (D11).

Tests:
- A cleared chamber does not heal, and a mend door does.
  - Plant: `TOP_UP` 12.
- The heavy bolt hurts the Bastion from the front.
  - Plant: blocked.
- An ordinary bolt is still turned aside.

### Stage E: Tuning against D13

1. Run `balance:check` and `balance:bosses` (with `hpAtStair` starts) for every
   policy.
2. Tune in this order, recording each step in `progress.md`:
   1. Wave sizes and the elite rates.
   2. Grave Draught.
   3. Boss HP and damage.

   Move lists, tells and the room layout are **not** dials.
3. Update `bands.json` (`measured` and `bands`) with a note.
4. Re-check plan 019's price arithmetic with elite pearls.
5. **Stop rules:**
   - If D13 needs the room count or a move-list change, report it.
   - If the median run passes 600 s before the escape targets are met, report
     it. The answer may be fewer chambers per floor, which is a design decision.
   - If the weak and weak-meta-max targets still cannot both hold (plan 021's
     wall), report the eight-setting table as plan 021 did, and do not widen a
     band to pass.

### Stage F: Documents

- `GAME_OVERVIEW.md`: waves, elites, healing, and the crossbow's heavy bolt.
- `README.md`: one line.
- `game/tests/README.md`: the snapshot fields, `?elite=` and `?waves=off`.
- `dungeon-waves.ts` header: how to change the wave table.
- The `plans/README.md` row and the `game/progress.md` entries.

### Stage G: Operator playtest

On a real GPU, play five runs or more. Answer:
- Do chambers feel different from one another?
- Does a wave's arrival read before it lands?
- Can each elite be told apart at a glance in a crowd?
- Does carried damage make the mend door a real choice?
- Is a run too long?

D2, D7, D10 and D13 are re-decided here.

## Risks

- **Grind instead of tension.** More bodies with no healing can feel like
  attrition for its own sake. The run-length target (D13) and the playtest are
  the guards. If it grinds, reduce the waves, do not restore the top-up.
- **Bot numbers are not player numbers.** Plan 021 showed the bots tune towards
  long, safe fights. Waves reward a player who reads marks, and the bot reads
  them perfectly or not at all.
- **Draw calls.** A floor-3 purse is already 486 of 508 calls with 7 bodies.
  D2's cap of 5 per wave holds only if hidden bodies are free (Stage 0, step 2)
  and dead bodies leave the scene.
- **Sim drift.** Waves are new logic in two places. D6's one pure rule is the
  mitigation, and Stage B's agreement test is the check.
- **Seed pins.** D5 keeps every existing spawn. A test that counts "bodies in
  this room" will still change, because the room now holds more. Fix such tests
  to count wave 1, not to re-seed.

## Out of scope

- New room types: survival, champion, cursed doors, traps (operator,
  2026-10-03).
- New enemy kinds, and splitting or shielding elites.
- Changing the number of chambers per floor.
- Boss move lists.
- Boons with synergies, and room-reward previews.

## Evidence

(Filled in by each stage. The full record, with every table, is the 2026-10-03 entry "Plan 022 Stages 0, A and B" in `game/progress.md`.)

### Stage 0 (2026-10-03)

- Baseline at 30 runs (`bands.json` `measured`, reproduced exactly): default escape 80.0%, deaths 13.3 / 7.7 / 0.0 by floor (all six the Pyre Mother's), median run 208.5 s, median watch fight 3.4 s (ambush 3.9, gauntlet 2.6); weak escape 33.3%, run 136.6 s, watch fight 2.5 s. **Median vitality entering every stair hall is 100% for every policy on every floor.**
- Hidden bodies: **a dormant body costs no draw calls** (1, 5 and 9 dormant bodies: 201 calls, 209,882 triangles, 56 shadow calls each; awake ones about 35 calls a body), so D2's caps count the largest single wave. **A dead body does stay in the scene and costs a standing body's calls**: the ten-body chamber read 586 calls with its dead in frame, 78 over 508, so the floor now takes back the dead of the waves before as the next wave is rung (Stage B).
- Shrine +35 added to the sim as its own commit (`510cc01`); `measured` re-taken as text. Weak escape 33.3 -> 36.7, weak run 136.6 -> 163.1 s; default unchanged at 80.0%.

### Stage A (2026-10-03)

`dungeon-waves.ts`, `Spawn.wave`, `waveDue`, `springing`/`calledIn` in the game and the sim, the snapshot fields. With the table empty the nine policies' reports are identical run by run to Stage 0's; `balance:check` printed Stage 0's values. Tests and their plants are in `game/progress.md`.

### Stage B (2026-10-03)

D2's table is dealt (middle: a second wave of 2-3 from `late`; late: a second of 2-3 and a third of 1-2 with a warden; purse: a second of 2-3 from `hoard`; +1 on the last wave on floors 2 and 3; caps 5 and 10), the rings drawn for 0.9 s before the bodies stand, the doors barred to the last wave. `generateFloor` is byte-identical over 900 floors. Wave-chamber frame: 440 calls / 255,942 triangles on SwiftShader (586 before the dead sink). Balance (nothing tuned): default escape 80.0 -> 80.0, run 209 -> 238 s, watch fight 3.4 -> 5.7 s; six run-length bands moved, one removed. D13 is far from met (vitality at the stair hall 100%, watch fight 5.7 s, run 238 s): Stages D and E. Interpretations (the harness boots with `?waves=off`; five ring meshes of their own; `late` for the third wave) are listed in `game/progress.md`.

### Carry-over from Stage B (2026-10-03)

A body is never raised on the knight (the rings are run through `waveSpots` again at the raise, in the game and the sim; browser test and plant in `game/progress.md`), `deathsBeforeBoss` and `floorN.medianHpAtStair` are report fields, and CI's red wave-chamber frame was made deterministic (the scene waits for its bodies and corpses to stand still: 439 calls / 255,774 triangles over four identical repeats).

### Stage C (2026-10-03)

Four modifiers (`ELITES`, `eliteStats`, `dealElites` from a stream of its own; floor two 15% at most one a wave, floor three 25% at most two; measured 12.74% and 24.17% dealt over 1,000 seeds), glow in `poseEnemy`'s idle branch (strength 0.05: 0.16 washed the figure flat), eyes, and a flag on the health bar's frame (one mesh), double experience and 2 pearls, `?elite=` and the bench's `?tint=`. **No extra draw call per elite, measured:** four plain bodies 352 calls / 236,158 triangles, four of any modifier 352 / 236,166. `generateFloor` is byte-identical. Interpretations: `?waves=off` also leaves elites out; elites have a second stream; a pyre is never volatile. Balance (30 runs): nothing moves (default escape 80.0, run 240 s).

### Stage D (2026-10-04)

`TOP_UP` is 0 (a clear heals nothing; a mend door still pays 30). **D11 was already true as built:** the Heavy Bolt's special swing carries `stagger: true`, which `blocks` lets past any shield, so the bolt already wounded the Bastion from the front; tests now hold it (node and browser, with planted regressions). The crossbow special's escape is 0% in the final state and is not D11's to fix. Default escape 80.0 -> 76.7, weak 36.7 -> 20.0, weak-meta-max 100 -> 76.7 (30 runs).

### Stage E (2026-10-04)

**Stop rule 3 tripped; D13 is not met.** Shipped: Grave Draught 5 (was 6), the Pyre Mother 150 vitality (was 215), the Bone King 650 with damage 19/12/16/17 (was 500, 13/8/11/12); wave sizes and elite rates unchanged (they move nothing the bots feel). Default 83.3 escape (55-80), 0 of 5 deaths before the stair hall, 100% vitality entering floor one's stair hall, run 244 s, watch fight 6.2 s; weak 10.0 (met); weak-meta-max 63.3 (30-60; 53 points over weak, met). D12 holds for the default knight (the Mother 1 and 2 deaths of 30, the others 0) and no longer for the weak one. The watch fight and the run length cannot be met without changing D1 (54% of watch chambers are the tutorial beat; with it off and the waves enlarged both are met, at escape 90). The eight-setting table, the duel table and the price check (the bots earn about 200 pearls a run, not 45; elites are 6% of it) are in `game/progress.md`.

### Stage F (2026-10-04)

`GAME_OVERVIEW.md`, `README.md` (one line), `game/tests/README.md` (the snapshot fields, `?elite=`, `?waves=off` and why the harness boots with it, and the open follow-up), the `dungeon-waves.ts` header (how to change the wave table and the elite rates), `plans/README.md` and `game/progress.md`. Stage G (the operator's playtest) is not done.
