# Plan 019: Death pays, and a descent starts with the arm you chose

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `8d13c42`, 2026-10-01, after plans 017 and 018
> merged. Source was read; nothing was measured while writing it. Every price,
> earning rate and upgrade size below is a hypothesis, and Stage 0 and Stage D
> exist to replace them with measurements. Decisions marked **(operator)** use
> the recommendation unless the operator overturns them before Stage A starts.

## Why

The game compares itself to Hades (sealed chambers, doors that show their
reward, boons, a special for each arm). It has that game's run structure but not
the layer that makes the run worth repeating:

- **A lost run leaves nothing behind.** `dungeon-save.ts` stores the best run,
  the last seed, the run log and settings. Nothing a run earns survives it. In
  Hades, death returns you home with Darkness and keys to spend, so even a
  failed run moves you forward.
- **The arm is dealt, not chosen.** Every descent starts with the Tideblade
  (`STARTING_WEAPON`, `dungeon-weapon.ts:461`). A random arm from
  `FOUND_WEAPONS` waits on a rack: in the Tide Gate on floor 1, behind a door
  deeper down (`dungeon-floor.ts:223–233`, `:280`). In Hades you pick the weapon
  before the run, so you decide what you are practising and building around.
  Here a run's arm is mostly luck.

This plan adds one persistent currency, a small set of upgrades bought between
runs, and arms unlocked with the same currency and chosen before a descent.

### What already makes this cheap

- **The balance sim already models a run that commits to one arm.**
  `scripts/balance/sim.ts` takes `policy.weapon` for the whole run and never
  visits a rack (`sim.ts:49`, `:281`). The `special-<arm>` policies in
  `bands.json` are already measurements of "this arm, start to finish".
- **`createRun()` is the single place a run's numbers are born**
  (`dungeon-sim.ts:57`). The game calls it in two places (`dungeon-game.tsx:290`,
  `:1095`) and the sim in three (`sim.ts:245`, `:271`, `:276`). An upgrade that
  is a starting number is one optional argument.
- **`draftBoons` already takes a `size`** (`dungeon-sim.ts:76`), so "one more
  boon card" costs no new rule.
- **`endRun` is already the single, idempotent door out of a run**
  (`dungeon-game.tsx:446`). It re-reads the stored log before appending, which
  is the pattern banking needs.
- **The pooled test reset already clears storage** (`tests/browser/helpers.ts:684`),
  so persistent meta state starts empty in every scenario, provided the closure
  re-reads it (see D11).

### What this plan does not fix, and the reason to say it first

The bots already escape too easily. The default bot escapes 100% of runs with
100% median HP on every floor, and a bot that never dodges still escapes 86.7%
(`bands.json`). **Every upgrade here makes the game easier.** For a bot the
effect can barely be measured, because it is already at the ceiling. Only a
player who dies will feel meta-progression. If human players also escape on
their first few runs, there is nothing to progress towards, and this plan builds
a shop with nothing to buy for.

The operator chose to do this before the difficulty pass. The plan contains it
by keeping every upgrade small (D4), and by making the Stage E playtest record
first-escape attempt counts. The difficulty pass is the next plan whatever
Stage E finds.

## Decisions

Operator answers of 2026-10-01: D1 and D6 agreed; D9 is "the arm is chosen in
the starting room, and in game there is no changing weapons"; D10 "could be",
so the recommendation stands. The rows below are the decided versions.

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | Currency name | **Pearls** (operator, agreed). Shown only in menus and on the result card. | Fits the drowned keep and clashes with no existing name. "Salt" is taken by Salt Ward and the Salt Spear. |
| D2 | When pearls are earned | **Banked at run end, win or lose, by one pure function of the `RunEnd`.** Not in an arena. Not as a door reward in this plan. A run abandoned by reloading banks nothing. | Run end is one idempotent door, so double-banking is impossible by construction. A pearl door would change the generator's random stream and the door economy, which is plan-020 territory (boons and rewards behind doors). |
| D3 | Earning formula (hypothesis) | `pearls = kills + 15 × floorsCompleted + 25 × won`, where `floorsCompleted = won ? FLOORS : floor − 1`. | Kills pay for fighting. Floors pay for progress. A death on floor 1 still pays a handful. Stage 0 measures what bots earn, and Stage D sets prices against D6's target. Rattlers never count as kills, so they never pay. |
| D4 | The upgrades (hypothesis) | Four, each mapped onto a field `Run` already has, except one: **Deep Lungs**: +10 max vitality per rank, 3 ranks. **Whetted Start**: +1 strike per rank, in the quarter-hit grain (`STRIKE_BONUS` is 4), 2 ranks. **Keen Eye**: boon offers show 4 cards instead of 3, 1 rank. **Second Tide**: once per run, a blow that would kill leaves the knight at 40% of max vitality instead, 1 rank. | Small on purpose, because of the difficulty problem above. Second Tide (a once-per-run revive, like Hades' Death Defiance) is the only new mechanic. It is the most Hades-like piece, and it changes how a run *ends* rather than how it plays. No dash, no reach, no healing: healing is already generous (`TOP_UP` 12 on every clear, `MEND` 30). |
| D5 | Arm unlocks | **The Tideblade is always unlocked. The other six are bought with pearls in the Tide Altar, in any order.** Buying unlocks an arm; it does not equip it. | One currency, so no Hades-style key economy. Any order, so the player chooses what to try next. |
| D6 | Price target | Everything (upgrades and arms) bought in **about 20 human runs** (operator, agreed). Stage D converts that into prices using measured earnings, with a human-earnings assumption written beside the numbers. | Long enough that a death always moves something. Short enough that a playtester sees most of it in two weeks. |
| D7 | No arms in the keep | **No rack anywhere but the Tide Gate of floor 1. No chamber pays an arm.** The generator keeps every random draw it makes today (the arm chamber's pick, the drop kind and the drop spot), so spawns, props and every other room's reward stay exactly as in `spawns-017.json`. It stops overwriting the chosen chamber's reward with `'arm'`, so that chamber keeps the mend or purse it was dealt one line earlier. `floor.weaponDrop` stays as a reserved spot (the decor layout and `arenaFloor` read it), but the campaign never places a rack there. | The operator's D9: in game there is no changing weapons. Keeping the draws keeps every floor and every fixture that does not involve a rack where it is. |
| D8 | The armoury in the Tide Gate | **The Tide Gate on floor 1 holds one rack slot per arm: seven slots, a fixed layout from the floor alone (`gateRacks(floor)`, pure, no random draw).** At run start, every unlocked arm except the one in hand stands on its own slot; slots of locked arms stay empty. The knight starts holding the arm he last carried out of the gate (`meta.arm`). Swapping at a gate rack works exactly as a rack does today: the arm in hand goes down on the rack just emptied. | This is where the choice is made (operator D9). The slots depend only on the floor, never on the save, so the decor layout and the frame do not change with what has been bought. Showing the arm before taking it is the Hades courtyard, without a hub. |
| D9 | When the choice is locked | **Taking the first door out of the Tide Gate locks the arm for the run** (operator). The gate racks are disposed during that crossing, `requestSwap` can never equip an arm after it, and `meta.arm` is written with the arm in hand at that moment. | "In game no changing weapons." Writing the choice at the door, not at run end, means a run lost on floor 1 still remembers it. |
| D10 | Where spending happens | One new title-menu view, **The Tide Altar**, with two lists: arms to unlock and upgrades (buy the next rank). It does not choose an arm; it says where to (the Tide Gate). The result card gains a pearls line and a **TO THE GATE** button that returns to the title menu. NEW DESCENT and SAME KEEP stay. (Operator: "could be", recommendation kept.) | Minimal HUD: pearls are never on the playfield. Without a way from the result card to the menu, a player who always presses NEW DESCENT never spends. Returning to the title also brings Last keep and Copy run log back within reach. |
| D11 | When the game reads the meta save | **On every run start** (`restart` and the first `enter`), never only once at mount. | The pooled browser reset clears storage and calls `restart`. A value cached at mount would leak one scenario's purchases into the next, and the reset-vs-boot snapshot comparison would be the only thing to notice. |
| D12 | The run record | `RunEnd` gains `arm` (the arm carried out of the Tide Gate, or the starting arm if the run ended there), `upgrades` (id → rank at run start) and `pearls` (earned). Older records parse with `'tideblade'`, `{}` and `0`. | Runs on different meta levels are not comparable. Without these fields the run log, which the balance questions depend on, silently mixes them. |
| D13 | No sim behaviour change at zero meta, in the pure stage | After Stage A, `createRun()` with no argument reproduces today's run, and `balance:check` prints the Stage 0 measured values exactly. Stage C (no arm chambers) is allowed to move them, because the sim prefers doors by reward (`sim.ts:374`, `arm: 2`); it re-measures and records why. | Structure first, then measure, as plan 018 did. Separating the two stages means each band move has one cause. |
| D14 | Arena and dev arm | The dev arena keeps its own rack (`arenaFloor`, `dropArenaListener`), and `?arm=` still sets the starting arm on dev builds. Neither is the campaign. | They are tools for playtesting one arm or one kind; the campaign rule does not need to reach them. |

## Design

### Pure: `game/app/dungeon-meta.ts` (new)

No React, DOM or Three.js. Add it to AGENTS.md's list of pure modules.

- `type Meta = { pearls: number; upgrades: Partial<Record<UpgradeId, number>>; arms: WeaponId[]; arm: WeaponId }`.
  - `arms` always contains `'tideblade'`.
  - `arm` is always one of `arms`.
- `UPGRADES`: the D4 table as data: id, name, detail, `ranks`, `price(rank)`.
- `ARM_PRICES: Record<Exclude<WeaponId, 'tideblade'>, number>`.
- `freshMeta()`: no pearls, no upgrades, the Tideblade only, holding the Tideblade.
- `pearlsFor(end: Pick<RunEnd, 'floor' | 'won' | 'kills'>)`: D3.
- `bank(meta, end)`: returns a new `Meta` with the earnings added. Never mutates.
- `buyUpgrade(meta, id)` and `buyArm(meta, id)`: return the new `Meta`, or
  `null` when the purchase is illegal (not enough pearls, already at max rank,
  already owned, unknown id).
- `chooseArm(meta, id)`: legal only for an owned arm.
- `runStart(meta)`: what a run starts with, in `Run` terms. Returns
  `{ maxHp, strike, draftSize, defiance, arm }`. `createRun` consumes it.

### `game/app/dungeon-sim.ts`

- `createRun(start?: RunStart)` applies `runStart`'s numbers. With no argument
  it returns exactly what it returns today.
- `Run` gains `defiance` (remaining revives) and `draftSize`.
- `hurt`: when a dealt blow would bring `hp` to 0 and `run.defiance > 0`, set
  `hp = round(0.4 × maxHp)` and decrement `defiance`. Return the damage as
  usual, and set `run.defied = true` for the game to read and clear, so it can
  draw and sound the moment.
  - Every caller ends the run on `run.hp === 0`. A defied blow leaves `hp > 0`,
    so no call site changes. Check that by grep and list the call sites in the
    progress entry.
  - The balance sim calls the same `hurt`, so it gets Second Tide with no sim
    change.
- `offerBoon` in the game passes `run.draftSize` to `draftBoons`.

### `game/app/dungeon-floor.ts`

- **D7.** Remove the `armRoom.reward='arm'` assignment (`:232`) but keep the
  `int(0,pool.length-1)` pick that precedes it, the `dropKind` draw (`:280`) and
  the drop spot, with a comment saying the draws are kept so the stream does
  not move. `Reward` loses `'arm'` only if nothing else needs it; the door sign
  for `'arm'` in `dungeon-floor-scene.ts` goes with it.
- **D8.** `gateRacks(floor): { arm: WeaponId; x: number; z: number }[]`: seven
  slots in the start room, one per `WeaponId`, in a fixed order, in world units.
  It makes no random draw and depends on the floor alone. Each slot is inside
  the room, clear of the room's heart, the entry, every doorway (the same
  `doorway` clearance the drop uses) and every prop. Slots are at least
  `2 × PICKUP_RADIUS` apart, so standing in one ring can never also stand in
  another. If a start room cannot fit seven, see Stage 0 step 5.
- `decorReservations` (`dungeon-decor-layout.ts:53`) reserves every gate slot on
  floor 1 as it reserves the drop today, so no motif or decor lands on a rack.
  This depends on the floor only, never on the save.

### `game/app/dungeon-save.ts`

- `META_KEY = 'drowned-keep:meta'`.
- `parseMeta(raw)`: re-validates everything, in the style of `parseSettings`.
  - Pearls are a whole number, clamped to a sane cap.
  - Each upgrade rank is clamped to `[0, ranks]`.
  - Unknown arm ids are dropped and `'tideblade'` is forced into `arms`.
  - An `arm` that is not owned falls back to `'tideblade'`.
  - Anything unreadable becomes `freshMeta()`.
- `readMeta` and `writeMeta` go through the existing `read` and `write`, which
  swallow failures.
- `RunEnd` and `parseRun` gain the D12 fields, with older records accepted.
  `serialiseRunExport` and `parseRunExport` carry them. Keep
  `RUN_EXPORT_VERSION` at 1: the fields only add, and an old export must still
  parse. A node test feeds a pre-019 export through `parseRunExport`.
  `scripts/runs/report.ts`
  breaks escapes and deaths down by `arm`, and by total upgrade ranks.

### `game/app/dungeon-game.tsx` (edit in place; do not reformat)

- **Run start.** `restart` and `enter` read `readMeta()` (D11). They pass
  `runStart(meta)` to `createRun` and equip `meta.arm`. `devStartingArm` still overrides the arm on dev builds.
- **Run end.** After `appendRun`, and after the existing `if (arena) return`,
  re-read the meta save, `bank` the earnings, write it, and put the earnings in
  `ended` for the result card. Re-read rather than hold, for the same
  second-tab reason the log gives.
- **Second Tide.** When `run.defied` is set, show a short notice ("The tide
  gives you back"), play a sound and a burst, and clear the flag. Do not add a
  persistent HUD mark (AGENTS.md, minimal HUD). The pause menu may say whether
  it is spent.
- **Result card.** Add a "+N pearls · M held" line and the D10 **TO THE GATE**
  button. It returns to the title menu, and the next ENTER THE KEEP must start a
  fresh run through `restart`, never resume the ended one.
- **Title menu.** Show the pearl balance on the line under "Deepest descent" (on
  the menu, not the HUD). Add the **Tide Altar** view next to Controls and
  Settings, with arms and upgrades as buttons that name the price, or the reason
  a purchase is unavailable. It must fit a 360 px-wide phone without horizontal
  scroll, and every control must be reachable by keyboard.
- **Hooks.**
  - `dungeonTest.meta()` reads the stored meta.
  - `dungeonTest.setMeta(meta)` writes it, for fixture setup only. It takes
    effect at the next run start, as a real purchase does.
  - Add `run.start` to the snapshot: `{ arm, maxHp, strike, draftSize, defiance }`,
    read off the live `run` and the held arm, never recomputed from the meta
    table (AGENTS.md, "Observe, don't recompute").

### `game/scripts/balance/`

- `Policy` gains an optional `meta: Meta`, applied through `createRun(runStart(meta))`.
- Each `RunReport` gains `pearls` (from `pearlsFor`), so Stage 0 can measure
  earnings without new game code.
- New `bands.json` policies in Stage D: `meta-max` (default bot, everything
  bought) and `weak-meta-max`. The second is the informative one, because the
  default bot is already at 100%.

### What stays

- Boons, ranks and XP within a run. XP still resets every run, so
  `GAME_OVERVIEW.md`'s "experience belongs to the current descent" stays true;
  pearls are a separate thing.
- The generator's random stream (D7 keeps every draw), every spawn and prop,
  and every enemy.
- How a rack works where one stands: the ring, the prompt, the swap key and "a
  swap you regret is a walk back".

## Stages

Each stage ends with every gate green:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run balance:check`
- the PR gate's browser run: `npm run test:browser -- --grep-invert "@capture|@nightly"`,
  prefixed with `GAME_TEST_GL=d3d11` on Windows

Record the gates and each stage's numbers in `game/progress.md`.

### Stage 0 — Baseline (no game change)

1. `npm run balance:check`: record every policy's measured values. Stage A is
   held to them exactly (D13).
2. **Earnings.** Add `pearls` to the sim report, which is a script change only.
   Record median and range of pearls per run for `default`, `weak` and each
   `special-<arm>`. These are bot numbers, so they are an upper bound: bots
   almost never die. Also record the human-earnings assumption Stage D will use,
   and how it was arrived at. If `game/progress.md` holds real run logs, derive
   it from their `floor`, `kills` and `won` fields. Otherwise say it is a guess.
3. **Fixture exposure.** List every browser scenario that uses a campaign rack
   (the floor 1 Tide Gate rack or a deeper `'arm'` chamber), or assumes the
   knight starts with the Tideblade. Start with `controls`, `models`, `ranged`,
   `shots`, `special` and `weapon` `.spec.ts`. Say for each how Stage C will
   restage it: `dungeonTest.equip` for a scenario that only needs an arm in
   hand, `setMeta` plus the gate racks for one that is about racks. Also list
   node tests that read `weaponDrop` or `'arm'` rewards (`dungeon-floor.test.ts`
   `:117`, `:264–294`, `:337`).
4. **Phone menu.** Screenshot the title menu at 360 × 740 today, to compare
   against once the Altar view is in.
5. **Gate fit.** For the `balance:check` seed sweep plus the seeds pinned in
   `tests/browser`, check whether each floor 1 start room can fit seven slots
   under D8's rules. Use a throwaway script, not committed. Record the worst
   start room. **Stop rule:** if any start room cannot fit seven, report the
   seeds and the shortfall and propose a layout (a ring at a smaller radius, or
   two rows) before Stage C. Do not shrink `PICKUP_RADIUS`.
6. **Gate frame cost.** In the Tide Gate of seed `0x1`, record `render.calls`,
   `render.triangles` and `render.shadow.calls` with today's single rack. Then
   stage seven racks (temporarily, by hand, through `placeDrop` in the
   console) and record the same three numbers. **Stop rule:** more than 10%
   over today's Tide Gate means report it and propose a remedy (for example,
   racks that do not cast shadows) before Stage C.

### Stage A — Pure rules (nothing wired)

Implement `dungeon-meta.ts`, the `createRun`, `hurt` and `draftSize` changes,
and the save, export and report fields. Leave `dungeon-floor.ts` alone; that is
Stage C.

Node tests: `tests/dungeon-meta.test.ts` (new), plus `dungeon-sim`, `dungeon-save`,
`dungeon-run-export` and `runs-report`. Each names the bug to plant: plant it,
watch it fail with its own message, then restore.

| Test | Plant |
| --- | --- |
| `createRun()` with no argument deep-equals today's run (literal, not `createRun(runStart(freshMeta()))`) | Default `draftSize` to 4 |
| `createRun(runStart(m))` raises `maxHp` and starts `hp` full, for each Deep Lungs rank | Raise `maxHp` without filling `hp` |
| A lethal `hurt` with `defiance` 1 leaves `hp` at 40% of max, sets `defied`, and spends `defiance`; a second lethal blow kills (assert the first one actually was lethal: blow ≥ hp before) | Do not decrement `defiance` |
| Invulnerability after a defied blow is the normal `INVULN`, not more | Set `invuln` to 2 s on defiance |
| `draftBoons(run, rng, run.draftSize)` returns 4 distinct cards when Keen Eye is owned and fewer than 4 boons are taken | Ignore `size` |
| `pearlsFor` for: floor-1 death with 0 kills, floor-2 death, a win | Count `floor` instead of floors completed |
| `bank` adds exactly `pearlsFor(end)` and does not mutate its input | Mutate and return the input |
| `buyUpgrade` refuses: too few pearls, max rank, unknown id; succeeds and charges `price(rank)` otherwise | Charge `price(rank + 1)` |
| `buyArm` refuses an owned arm and the Tideblade, and does not change `arm`; `chooseArm` refuses an unowned arm | Let `chooseArm` accept any `WeaponId` |
| `parseMeta` fallbacks: junk JSON, negative pearls, rank over max, unknown arm, unowned `arm`, missing Tideblade | Drop the Tideblade force |
| `parseRun` and `parseRunExport` accept a pre-019 record and fill `arm`, `upgrades` and `pearls` with their defaults | Reject records without `arm` |
| The run report counts escapes and deaths per arm | Group by `boons[0]` |

**Gate specific to this stage:** `balance:check` prints exactly the Stage 0
measured values (D13).

### Stage B — Meta wiring (browser)

Implement the game, menu and hook changes for pearls, upgrades and unlocks. The
knight still starts with `meta.arm` (the Tideblade on a fresh save) and the
existing racks are untouched; the armoury is Stage C. The rules are proven in
node; these scenarios check that the running game is wired to them, using real
input for whatever is under test. Merge stories that share setup (AGENTS.md,
"One story per page"). Put them in `tests/browser/meta.spec.ts`.

Each plant must break its own assertion and no other.

1. **Death pays, and the pearls survive.** Lose a run on floor 1 through real
   combat, or through the hooks with the cause asserted. The result card names
   the earnings, and `dungeonTest.meta().pearls` equals the earnings. TO THE GATE
   reaches the title menu, which shows the balance.
   - Plant: bank into a copy that is never written.
2. **A purchase changes the next run.** With pearls staged through `setMeta`,
   buy Deep Lungs in the Tide Altar by keyboard and then by pointer. ENTER THE
   KEEP. `run.start.maxHp` is 110 and the vitality bar's maximum agrees.
   - Plant: `restart` calls `createRun()` without the meta.
3. **An unlock is recorded and not equipped.** Buy the maul in the Tide Altar.
   `dungeonTest.meta().arms` contains it, `meta.arm` is unchanged, and the next
   run still starts with the previous arm.
   - Plant: `buyArm` also sets `arm`.
4. **Second Tide.** Stage Second Tide and a body that can deal a lethal blow.
   Take the blow. The knight stands at 40% vitality, the notice shows, and the
   second lethal blow ends the run with that kind as the cause.
   - Plant: the game reads `hp === 0` before `hurt` applies the revive.
5. **Contamination.** A scenario that buys something and then ends must leave
   the next pooled scenario at `freshMeta()`. The existing reset-and-prove step
   enforces this once `run.start` is in the snapshot.
   - Plant: read the meta once at mount (D11). The prove step must name
     `run.start`. Run the scenario under `GAME_TEST_ISOLATE=1` once as well, and
     record that both paths agree.
6. **Phone.** The Tide Altar at 360 × 740: no horizontal scroll, and every arm
   and upgrade button is visible after scrolling the card (`a11y.spec.ts`
   conventions). Keen Eye's four boon cards at the same size.

At zero meta every existing scenario must pass unchanged. If one needs a fixture
change, D13 leaked: find the leak; do not re-pin the seed.

### Stage C — The armoury in the Tide Gate, and no arms in the keep

Implement D7, D8 and D9: `gateRacks`, the decor reservation, the generator
change, the game's racks becoming a list, the lock at the first door, and
`meta.arm` written there.

In the game:

- `drop` becomes a list of racks. The rack the knight stands in is the one
  within `PICKUP_RADIUS`; D8's spacing guarantees at most one. The prompt, the
  ring, the swap and the "set down where the new arm lay" rule are otherwise
  unchanged.
- On floor 1, after the build, place a rack for every arm in `meta.arms` except
  the one in hand, each on its own `gateRacks` slot. Never place
  `floor.weaponDrop` on a campaign floor.
- In `takeDoor`, on the first crossing out of the start room of floor 1: write
  `meta.arm` (re-read, `chooseArm`, write), dispose every rack, and remember
  that the arm is locked. `requestSwap` refuses to equip once locked. The run
  record's `arm` is the locked arm.

Node tests (`dungeon-floor.test.ts`, `dungeon-decor-layout.test.ts`):

| Test | Plant |
| --- | --- |
| Against `spawns-017.json`: spawns and props are identical on floors 1–3, and every room's reward is unchanged except the former arm chamber, which now holds the mend or purse it was dealt first. The weapon-drop hash is no longer compared: say in a comment that the campaign no longer places it, so a weaker hash is not hiding anything | Remove the arm chamber's `int()` pick |
| No room on any sweep floor has the reward `'arm'` | Keep the assignment on floor 3 only |
| `gateRacks` gives seven slots, one per arm, all inside the start room, outside every doorway, the heart, the entry and every prop, and pairwise at least `2 × PICKUP_RADIUS` apart, on every sweep floor 1 | Space slots `PICKUP_RADIUS` apart |
| `gateRacks` is the same for the same floor, and makes no draw (call it between two `generateFloor` calls and compare the second floor with a fresh one) | Use `Math.random` for one slot's jitter |
| No floor 1 motif or decor rect overlaps a gate slot | Reserve only the first slot |

Update the existing tests that read `weaponDrop` or `'arm'` rewards to the new
rule rather than deleting them; say in each what replaced it.

Browser scenarios, in `tests/browser/armoury.spec.ts`, one story:

1. **Only what is owned is on a rack.** With `setMeta` owning the Tideblade, the
   maul and the spear and holding the Tideblade, the Tide Gate shows exactly two
   racks, holding the maul and the spear, on their slots (read the scene, not
   `gateRacks`).
   - Plant: place a rack for every arm.
2. **The choice is made by walking and the swap key.** Walk into the maul's ring
   with the keyboard and press the swap key. The maul is in hand and the
   Tideblade is on that rack.
   - Plant: `requestSwap` ignores racks other than the first.
3. **The first door locks it.** Clear nothing (the Tide Gate is never sealed),
   take a door with the swap key. After the crossing: no rack is in the scene,
   `dungeonTest.meta().arm` is `'maul'`, and pressing the swap key on a later
   floor-1 chamber's ring spot does not change the arm. End the run; the next
   run starts holding the maul and the gate shows the Tideblade and the spear.
   - Plant: write `meta.arm` at run end instead of at the door, and lose the
     run before the end is written (the hooks can stage that); then the next
     run starts with the Tideblade.
4. **No arm chambers.** On floor 2 of a pinned seed whose old arm chamber is in
   reach, the door sign shows its mend or purse, not an arm, and entering it
   places no rack.
   - Precondition: the seed's chamber was the arm chamber before this plan
     (assert the `int()` pick lands there, through the kept `weaponDrop.room`).
   - Plant: keep placing `floor.weaponDrop` on deeper floors.

Restage every scenario on the Stage 0 step 3 list as Stage 0 said. No skips, no
widened `DRIFTS`. Add the seven-rack Tide Gate to `frame-budget.spec.ts`, with
both sides bounded from this stage's measurement, and the renderer
(SwiftShader) and date beside the numbers.

**Balance.** The sim prefers doors by reward, and arm chambers are gone, so
`balance:check` may move here. Re-measure, update `bands.json` (`measured`, and
`bands` only if a band no longer holds) with a note naming this plan and the
cause, as plans 017 and 018 did.

### Stage D — Balance and prices

1. Add the `meta-max` and `weak-meta-max` policies to `bands.json`. Record them
   as measured, with bands from the measurement, and a note saying why they
   exist.
2. **Stop rule.** If `weak-meta-max` escapes more than 98% of runs, the upgrades
   remove what little tension the weak bot still has. Report this to the
   operator with the numbers before tuning D4. It is a design finding (do the
   difficulty pass first), not a band to widen.
3. **Set prices.** Using Stage 0's human-earnings assumption, set `UPGRADES`
   prices and `ARM_PRICES` so the full set costs about D6's target number of
   runs. Write the sum, the assumption and the date beside the table in
   `dungeon-meta.ts`. Add a node test that pins the total cost to that
   arithmetic, so a later price change has to update the comment too.

### Stage E — Human playtest (operator)

On a real GPU against the dev server, with a fresh save, play ten runs or more.
Record per run: arm, upgrades held, floor, cause, pearls earned. Answer:

- Did every death feel like it bought something? Name the runs where it did
  not.
- How many attempts did the first escape take? If it was one or two, the
  difficulty pass outranks everything else, and that goes in the progress entry
  in those words.
- Does choosing at the Tide Gate racks read as a choice? Is the lock at the
  first door clear before you take it?
- Is Second Tide readable when it fires?

D3, D4 and D6 are re-decided here if the answers say so. An agent cannot do this
stage; it stays open until the operator plays.

### Stage F — Documents

- `GAME_OVERVIEW.md`: a Progression paragraph on pearls, the Tide Altar and
  choosing an arm at the Tide Gate. Remove "an arm on a rack" from the door
  rewards and the "each floor also holds one arm" sentence. Update the "Current
  form" paragraph.
- `README.md`: the Play section mentions the Altar and the armoury.
- `AGENTS.md`: add `dungeon-meta.ts` to the pure-module list.
- `game/tests/README.md`: the `meta` and `setMeta` hooks, the `run.start`
  snapshot field, and a note that a stored meta blob is cleared by the pooled
  reset.
- `plans/README.md`: this plan's row.
- `game/progress.md`: append the entry. Name the planted bug for each new test
  and the message it failed with.

## Risks

- **It makes an easy game easier.** The section at the top covers this.
  Stage D's stop rule and Stage E's first-escape count are where it shows. Do
  not respond by making the upgrades so small that they do nothing; respond with
  the difficulty plan.
- **A fresh save has nothing to choose.** Until the first arm is bought the Tide
  Gate is empty and every run is a Tideblade run. That is the point of unlocks,
  but it means the arm choice is invisible for the first few runs. If the
  playtest finds that dull, the cheapest fix is making the first unlock cheap.
- **Losing the mid-run arm.** Plan 016 built specials partly around finding an
  arm deeper down; that discovery is gone. The racks are a taste of an arm only
  once it is bought. This is the operator's call (D9), named so the playtest
  checks it.
- **Test churn.** Every scenario on Stage 0 step 3's list moves in Stage C. It is
  sized up front; budget for it.
- **Storage is fragile.** Progress lives in one `localStorage` key. Clearing
  site data, private windows and some browsers' storage eviction all wipe it,
  and nothing warns the player. That is acceptable for a playtest build. Before
  this ships to strangers, a meta export/import beside Copy run log is the cheap
  fix. It is out of scope here; name it as a follow-up.
- **Second Tide and the run log.** A defied blow is not a death, so `cause`
  still names only the final blow. If Stage E wants to know how often Second Tide
  saved a run, add a `defied` count to `RunEnd` then. Do not guess at it now.
- **TO THE GATE is a new path through the run state.** The title menu has so
  far only been shown before the first run or while paused. Returning to it after
  an ended run, then entering, must rebuild a fresh run and never reopen the
  ended one. Stage B scenario 1 continues into scenario 2's ENTER for exactly
  this reason. The `hasStarted` handling in the test hook's reset
  (`dungeon-game.tsx:2173`) is the closest existing model.
- **Bot earnings overstate human earnings.** Bots almost never die, so they earn
  near the maximum every run. Prices set from bot numbers alone would make
  unlocking far slower for people. Stage 0 step 2 must therefore state the
  human assumption separately.

## Out of scope

- Boons or pearls behind doors, weapon-upgrade doors, a shop (the next plan,
  Hades-comparison item 2).
- A difficulty retune, or Heat-style opt-in modifiers.
- Arm aspects, bosses, a hub, NPCs, dialogue.
- Cloud save, and meta export/import.

## Evidence

Fill in per stage: gates, Stage 0 earnings and the human-earnings assumption,
the final prices and their arithmetic, the Stage D policies' measurements, the
playtest table, and the planted bug for each new test with the message it failed
with.
