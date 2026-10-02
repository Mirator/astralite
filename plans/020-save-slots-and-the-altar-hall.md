# Plan 020: Three save slots, and the Tide Altar as a room

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `6e4adc7`, 2026-10-02, after plan 019 merged
> (PR #85). Source was read; nothing was measured while writing it. Line
> numbers are `game/app/dungeon-game.tsx` unless another file is named, and
> they drift; search for the names. Decisions marked **(operator)** use the
> recommendation unless the operator overturns them before Stage A starts.

## Why

Plan 019 made death pay, but the loop around it is still a menu:

```
title → ENTER → floor 1 → death card → TO THE GATE → title menu → Tide Altar panel → ENTER
```

Hades' loop runs through a place: you die, you wake in the House, you walk to
what you want to spend on, you pick your weapon off its rack, and you walk out.
The walk is the point. It is where a death turns into the next attempt. This
plan builds that place, and adds the save slots that let several people (or
one person, several times) keep separate progress.

What the operator asked for, 2026-10-02:

1. The game offers up to three save slots.
2. A new game starts in the Tide Altar as a room, not a menu.
3. Death shows a death screen with a way to the Tide Altar.
4. A run starts from the Tide Altar.

### What exists today

- **Storage.** `dungeon-save.ts:88-89` holds five keys:
  - per player: `drowned-keep:best`, `drowned-keep:seed`, `drowned-keep:runs`
    and `drowned-keep:meta`;
  - per device: `drowned-keep:settings`.

  Every read and write goes through `read` and `write` (`:237-238`), which
  swallow failures. Six test files hard-code key names:
  `arena.spec.ts:47`, `run-export.spec.ts:16`, `gameplay.spec.ts:535-537`,
  `loading.spec.ts:355`, `dungeon-save.test.ts` (several), and
  `tests/README.md:245`.
- **Title and boot.** Nothing builds until ENTER (plan 015).
  - ENTER sends `start`. On the first press, `boot` builds floor 1 behind
    the veil and then calls `enter()`, which reuses that floor.
  - `toGate()` returns to the title with the dead floor still in the scene.
  - The title menu and the pause menu are one card (`menuOpen`, `menuView`).
- **The armoury (plan 019).**
  - Floor 1's start room (the Tide Gate) holds a rack per owned arm.
    `layGateRacks` lays them, and only on `level === 1`.
  - `takeDoor` out of the Tide Gate calls `lockArm`, which writes
    `meta.arm`.
  - `gateRacks(floor)` (`dungeon-floor.ts:335`) is pure and reads
    `rooms[0]`.
  - The decor layout reserves the slots on floor 1
    (`dungeon-decor-layout.ts:58`).
- **A floor is `generateFloor`'s return** (`dungeon-floor.ts:311`). The
  pipeline needs:
  - `rooms[0]` as the start;
  - a valid `goal`: the stair is built unconditionally at `rooms[goal]`, and
    with `goal = 0` it opens on the first frame and offers "To floor 2";
  - a `weaponDrop`, which the decor layout reads;
  - `brazier` props for any light at all
    (`dungeon-atmosphere.ts:228-264`).

  Doors, spawns and edges may be empty. `arenaFloor` (`dungeon-arena.ts:62`)
  is the precedent: it calls `generateFloor` and replaces fields. The
  game's `arena` flag is the precedent for a mode: one seam, `chart()`
  (`:926`), with branches in `restart`, `boot`, `writeSeed`, `endRun`,
  racks and the result card.
- **Prompts.** One priority chain picks the prompt (`:1752`):
  `showOffer(overRack ? … : stair ? … : door ? …)`. `requestSwap` (`:1305`)
  acts on it. Both refuse unless `hasStarted && gameStatus === 'playing'`.
- **Test harness.**
  - `Game.enter()` (`helpers.ts:1032`) clicks ENTER and expects floor 1. It
    has 138 calls across 34 spec files, plus about ten direct ENTER clicks.
  - `Game.reset` clears storage and calls `dungeonTest.reset`, which rebuilds
    floor 1 behind the title.
  - `prove` holds the whole snapshot against the booted one.
- **Loading.** A cold first press takes about 3.8-4.2 s to the keep and a warm
  one about 0.95 s. A rebuild compiles nothing new, because programs are
  pinned across rebuilds. `frame-clock.spec.ts:67-109` counts the frames a
  sliced restart draws.
- **The balance sim** never touches storage or the title flow. This plan does
  not change it.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | What a slot holds | **Per slot: meta, best, the last-keep seed and the run log. Per device: settings and key bindings, plus a new `drowned-keep:slot`, the slot last played.** Keys become `drowned-keep:<n>:meta` and so on, for n in 1..3. | Progress is a player's; volume and bindings are the machine's. The run log is per slot so a playtester's log describes one progression, not three mixed (plan 019 D12 again). |
| D2 | Existing saves **(operator)** | **The first boot of this build copies the five legacy per-player keys into slot 1, only if slot 1 is empty, and leaves the legacy keys in place.** It is a pure function from the old cells to the new ones, plus one write. | Nobody loses plan 019 progress. Leaving the old keys costs nothing and makes a rollback safe. |
| D3 | The title screen | **ENTER THE KEEP opens the slot picker:** three cards, each showing pearls, deepest floor, runs logged and arms owned, or "Empty". Choosing a card enters that slot. Each card has **Erase**, which needs a second confirming press. Settings, Controls & journey and Copy run log stay on the title. **The title's Tide Altar panel is removed**: the shop lives in the room. | Three is the operator's number. Erasing is the only destructive act, so it costs two presses. Copy run log exports the slot last played and names it. |
| D4 | The hall | **A new pure `altarHall()` in `dungeon-floor.ts`: room 0 of `generateFloor(HALL_SEED, 1)`, its tiles and props, and exactly one of its doors.** `HALL_SEED` is a fixed constant, so the hall is the same room every time and draws nothing from `crypto.getRandomValues`, which keeps pinned test seeds aligned. `goal` is 0, but the stair is not built in the hall. The hall is lit by the room's own braziers. | Reusing the generator gives a lit, walkable, decor-dressed room for free, and the Tide Gate is a crypt that Stage 0 of plan 019 found always seats seven rack slots. A fixed seed means one layout to test and one to judge by eye. |
| D5 | The hall's mode | **A closure flag `hall`, modelled on `arena`.** It is set by `chart()`. While it is set, `hasStarted` is true and `gameStatus` is `'playing'`, so movement, the prompt and the swap key all work. There are no enemies, no XP and no HUD vitality or rank bar (minimal HUD: the knight is not at risk). `writeSeed`, `endRun`, the best run and the map are off. The snapshot gains `hall: boolean` and `slot: 1 \| 2 \| 3 \| null`. | The arena already proves this shape. A separate mode keeps every floor rule (rooms, doors, `settleRoom`) untouched. |
| D6 | What stands in the hall | **Three things.** (1) **The altar**: the sanctuary shrine's mesh at the room's heart, so no new figure. Standing at it, the swap key opens the shop: plan 019's `AltarPanel`, as an overlay that holds the world the way a boon draft does (`run.choosing`). (2) **The armoury**: plan 019's racks, laid by `gateRacks(hall)` for every owned arm except the one in hand. (3) **The way down**: the hall's one kept door, signed "The way down". | Hades' House is a place you walk through to what you want. Each of the three is one existing mechanism moved, not a new one. |
| D7 | Where the arm is chosen | **In the hall, not on floor 1.** The racks leave the Tide Gate. Floor 1's Tide Gate goes back to an empty starting chamber, and the decor reservation moves from `floor.level === 1` to the hall. `lockArm` moves from "the first door out of the Tide Gate" to "the way down out of the hall". Its rule is unchanged: the arm in hand is written to `meta.arm`, and racks cannot be used again until the next visit to the hall. | The operator's plan 019 D9 ("chosen in the starting room, no changing in game") still holds, and the starting room is now the hall. The generator's floor 1 does not change, so the balance sim, `spawns-017.json` and `rewards-019.json` stay valid. |
| D8 | Starting a run | **Taking the way down** (swap key at the door) locks the arm, then runs a veiled build of floor 1 with a fresh run on a new seed, through the same `restart` path NEW DESCENT uses today. | One path into a run, so the meta, the arm and the seed are dealt in one place. |
| D9 | The death card **(operator)** | **"The dark takes you."** It shows its existing contents (cause, time, boons, pearls earned) and two buttons: **RETURN TO THE ALTAR** (primary, focused), which runs a veiled build of the hall; and **SAME KEEP** (lost runs only), which still restarts the same seed directly, for playtesting. NEW DESCENT and TO THE GATE are removed. A won run ("You climb into the dawn") offers only RETURN TO THE ALTAR. | Hades has no instant retry; every attempt leaves from the House. SAME KEEP stays because a reproducible seed is how a playtest report becomes a fix (`restart:<seed>`). Removing it as well is one line if the operator prefers the pure loop. |
| D10 | Leaving the hall | **The pause menu, opened in the hall, gains LEAVE TO TITLE**, which returns to the slot picker. Mid-run, the pause menu does not offer it. | Switching slots needs a way out, but a run must not be abandoned without the death card. Abandoning a run is out of scope. |
| D11 | Tests: entering a run | **A dev-only `?hall=skip` URL parameter, set by the harness by default (as it sets `?boot=eager`), keeps today's flow for tests:** ENTER chooses slot 1 and enters floor 1 directly. Specs about slots, the hall, the death card or loading opt out with `test.use({ hall: true })`. | 138 `game.enter()` calls stay valid and the suite pays no second build per scenario. The product path is still covered, by the specs that opt out. |
| D12 | No balance change | The generator, the sim, `bands.json` and `dungeon-meta.ts` are untouched. | This plan is flow and place, not tuning. |

## Design

### Pure: `game/app/dungeon-save.ts`

- `slotKey(slot, name)`, giving `drowned-keep:<slot>:<name>`. The existing
  `readMeta`, `readBest`, `readSeed`, `readRuns` and their writers take a
  `slot` argument.
- `readSlot`/`writeSlot` read and write the device key.
- `slotSummary(slot)` returns `{ empty, pearls, best, runs, arms }` from the
  four cells. It feeds the picker.
- `eraseSlot(slot)` removes the four cells.
- `migrateLegacy(cells)` is pure. It takes the legacy cells and slot 1's cells
  and returns the writes to make: none if slot 1 already has anything. The
  game calls it once at mount and applies its writes.

### Pure: `game/app/dungeon-floor.ts`

- `HALL_SEED`, a fixed constant. Pick one whose room 0 seats seven
  `gateRacks` slots with the altar at the heart. Stage 0 measures this.
- `altarHall()` returns a `Floor`:
  - `generateFloor(HALL_SEED, 1)` reduced to room 0;
  - its tiles and cells, its props, and one door (the first, in a fixed
    order), with every other door's alcove tile removed from `cells`;
  - no spawns; `goal: 0`; `guardCount: 0`.

  It makes no random draw beyond the fixed-seed generator call. `gateRacks`
  works on it unchanged.

### Game (`dungeon-game.tsx`, edit in place; do not reformat)

- `hall` flag and `chart()` branch (D5). Raising the hall skips the stair and
  the door signs except the way down. `layGateRacks` keys off `hall` instead
  of `level === 1`.
- Prompts: `'altar'` and the way down join the `showOffer` chain, ahead of
  racks only when the knight stands in their radius. `requestSwap` opens the
  shop at the altar and calls `lockArm` and then `restart` at the way down.
- The shop overlay reuses `AltarPanel`; its "Arms are chosen at the Tide
  Gate" line becomes "Arms are chosen on the racks of this hall". Escape or
  Back closes it, and the world resumes.
- Title: the slot picker (D3), migration at mount (D2), and the active slot
  set before any read. Every `readMeta()`, `readBest()`, `readSeed()` and
  `readRuns()` call passes the active slot.
- Death and win cards (D9). Pause-menu LEAVE TO TITLE in the hall (D10).
- `boot`: the first press builds the hall (or floor 1 under `?hall=skip`).
- `dungeonTest.reset` rebuilds whichever the URL's mode starts in, and leaves
  `hall`, the slot and the overlay exactly as a boot does. `prove` will catch
  any field that differs.
- Snapshot: `hall`, `slot`, `altarOpen`, and `hallProps`: what the scene
  actually placed (altar, racks, the way down), read from the scene.

### Floor 1

The Tide Gate has no racks. `decorReservations` no longer reserves gate slots
on floor 1; it reserves them on the hall. Floor 1 is otherwise byte for byte
the same, and the generator is untouched.

## Stages

Each stage ends with every gate green:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run balance:check` (it must not move; D12)
- the PR-gate browser run: `npm run test:browser -- --grep-invert "@capture|@nightly"`

Record each stage in `game/progress.md`. For every new test, record the
planted bug and the message it failed with (AGENTS.md, "Writing tests that can
fail").

### Stage 0 — Baseline (no game change)

1. **Pick `HALL_SEED`.** Search seeds for a room 0 that:
   - seats seven `gateRacks` slots, under plan 019's operator ruling that
     racks may stand against the walls;
   - leaves a 1.9-tile clear heart for the altar;
   - has at least two braziers.

   Record the seed, the room size and the slot spacing.
2. **Hall frame cost.** Stage the hall by hand (a throwaway hook, not
   committed). Record `render.calls`, `render.triangles` and
   `render.shadow.calls` with six racks standing, next to plan 019's
   seven-rack Tide Gate (298 calls). **Stop rule:** more than 10% over that is
   reported to the operator before Stage C.
3. **Boot cost.** Record cold and warm press-to-control times to floor 1 today,
   and to the hand-staged hall. Then record hall → way down → floor 1.
   **Stop rule:** if the hall adds more than 1 s to a warm press-to-floor-1,
   report it before Stage C.
4. **Exposure list.**
   - Every spec that clicks ENTER directly, asserts on the title button list
     (`a11y.spec.ts:65`, `:94`), uses TO THE GATE or NEW DESCENT, or reads a
     legacy key.
   - Every node test on gate racks on floor 1 (`dungeon-floor.test.ts:285-289`,
     `459-542`; `dungeon-decor-layout.test.ts:100-122`;
     `dungeon-paving-layout.test.ts:105-107`).
   - `armoury.spec.ts` as a whole.

   Say how Stage E restages each.

### Stage A — Pure rules

Implement `slotKey`, the slot-taking readers and writers, `slotSummary`,
`eraseSlot`, `migrateLegacy`, `HALL_SEED` and `altarHall()`.

Node tests (`dungeon-save.test.ts`, `dungeon-floor.test.ts`):

| Test | Plant |
| --- | --- |
| Each slot reads only its own cells; writing slot 2 leaves 1 and 3 untouched | `slotKey` ignores the slot |
| `migrateLegacy` copies the legacy cells into an empty slot 1 and writes nothing when slot 1 has anything; it never deletes a legacy key | Migrate even when slot 1 holds a meta |
| `slotSummary` reads pearls, best floor, runs and arms; an empty slot says empty | Count runs from the meta instead of the log |
| `eraseSlot` removes the four cells of one slot and nothing else, settings included | Erase by prefix `drowned-keep:` |
| `altarHall()` is one room, no spawns, one door, `goal` 0; its cells include no other door's alcove | Keep every door |
| `altarHall()` is identical across calls and makes no draw (call it between two `generateFloor` calls and compare the second floor with a fresh one) | Use `Math.random` for the kept door |
| `gateRacks(altarHall())` seats seven slots, clear of the heart by the altar's radius | Pick a `HALL_SEED` whose room fits six |

**Gate specific to this stage:** `balance:check` prints exactly its current
values.

### Stage B — Slots on the title

Implement the slot picker, Erase with its confirmation, migration at mount, the
active slot on every read and write, and Copy run log naming its slot. Remove
the title's Tide Altar panel. The game still enters floor 1 directly (the hall
is Stage C), so `?hall=skip` is not needed yet.

Browser scenarios (`tests/browser/slots.spec.ts`; each plant breaks its own
assertion):

1. **A legacy save arrives in slot 1.** A stored legacy blob (a context with
   `storageState`, which gets its own page) shows in slot 1's card with its
   pearls and runs. Choosing slot 1 deals a run from that meta.
   - Plant: migrate into slot 2.
2. **Slots are separate.** Buy something in slot 2 (staged with `setMeta` on
   slot 2). Slot 1's card is unchanged, and a run in slot 1 is dealt from
   slot 1.
   - Plant: `enter` reads the meta without the slot.
3. **Erase asks twice.** One press arms Erase and the card says so; a second
   press empties the slot. A different action in between disarms it.
   - Plant: erase on the first press.
4. **Keyboard and phone.** Every card and its Erase are reachable by Tab, and
   the picker fits 360 × 740 without horizontal scroll.

### Stage C — The hall

Implement D4 to D8: the `hall` flag, `altarHall()` raised through `chart()`,
the altar, the shop overlay, the racks moved from floor 1 to the hall, the way
down, and `lockArm` at the way down. Add `?hall=skip` and make the harness set
it by default (D11), and change `boot` to build the hall otherwise.

Browser scenarios (`tests/browser/hall.spec.ts`, opted out of `hall=skip`, one
story where the setup is shared):

1. **ENTER lands in the hall.** Choosing a slot shows the veil, then
   `hall === true`, `mode === 'playing'`, no enemies, and the altar, the racks
   and the way down in `hallProps`, read from the scene.
   - Plant: `boot` builds floor 1.
2. **The altar is a place.** Walk to the altar by keyboard and press the swap
   key. The shop opens and the world holds: advance time and assert the
   knight does not move. Buy a rank, close the shop, and the world resumes.
   - Precondition: the prompt named the altar before the press.
   - Plant: the shop opens without holding the world.
3. **The arm is chosen here.** With the maul owned, walk into its ring and
   swap.
   - Plant: `layGateRacks` keys off `level === 1` again, so the hall has no
     racks.
4. **The way down starts a run.** Take the door with the swap key. The veil
   shows, then floor 1 at level 1: `hall === false`, the maul in hand,
   `meta.arm === 'maul'`, `armLocked`, and no racks on floor 1's Tide Gate.
   - Plant: `lockArm` is not called at the way down.
5. **Nothing of the hall leaks into the run.** No stair is built in the hall,
   and floor 1's stair, doors and enemies are as `generateFloor` deals them.
   - Plant: build the stair in the hall. Its prompt then names the stair
     before the altar.

Update the node tests on floor 1 gate racks to the new rule (racks on the hall,
none on floor 1). Say in each what replaced it; delete nothing without naming
what catches the same regression.

**Frame budget:** add the hall with six racks to `frame-budget.spec.ts`,
bounded on both sides from this stage's measurement, with renderer and date.

### Stage D — Death and return

Implement D9 and D10.

Browser scenarios (`hall.spec.ts` or `death.spec.ts`, opted out of
`hall=skip`):

1. **Death returns to the hall.** Die on floor 1 to a real blow. The death
   card shows the cause and pearls earned, with RETURN TO THE ALTAR focused.
   Press it: the veil, then the hall, with the pearls banked and visible in
   the shop.
   - Plant: the button calls the old `toGate`.
2. **SAME KEEP retries the seed directly.** It goes straight to floor 1 on
   the same seed, without the hall.
   - Plant: route it through the hall.
3. **A win returns to the hall** with only RETURN TO THE ALTAR. Stage it with
   hooks; the win itself is covered by `progression.spec.ts`.
   - Plant: the win card keeps NEW DESCENT.
4. **LEAVE TO TITLE** is in the hall's pause menu and not in a run's.
   - Plant: offer it mid-run.

### Stage E — Restage the suite

Restage every scenario on the Stage 0 step 4 list:
- the `a11y.spec.ts` button lists;
- `armoury.spec.ts`, rewritten against the hall;
- `meta.spec.ts`, where TO THE GATE becomes the death card's return;
- `loading.spec.ts` and `frame-clock.spec.ts` on the hall path (a cold press
  now builds the hall; count the frames that path draws);
- the specs that read legacy keys.

No skips, no widened `DRIFTS`. Run the PR gate, the restaged
`@capture`/`@nightly` scenarios once, and `hall.spec.ts` under
`GAME_TEST_ISOLATE=1`.

### Stage F — Documents

- `GAME_OVERVIEW.md`: the core loop, save slots and the hall. Remove the Tide
  Altar menu panel and the arm choice in floor 1's Tide Gate.
- `README.md`: the Play section; also fix the intro's corridors and bridges,
  stale since plan 017.
- `game/tests/README.md`: `?hall=skip`, `test.use({ hall: true })`, the new
  snapshot fields, and the slot keys.
- `plans/README.md`: this plan's row.
- `game/progress.md`: the entry.

### Stage G — Operator playtest

On a real GPU with a fresh browser profile and a legacy save in another
profile, answer:

- Does the hall read as a place, and is the altar obviously the thing to walk
  to?
- Is "The way down" obvious?
- Does the walk from death to the next run feel like a loop or like an
  obstacle?
- Did the legacy save arrive in slot 1?

## Risks

- **Test churn.** This is the largest cost. D11 contains it, but every spec on
  the Stage 0 list still moves. Budget for it.
- **Two veils per attempt.** Death → hall → floor 1 is two veiled builds where
  today there is one. Stage 0 step 3 measures this. A warm rebuild is about
  0.1-0.2 s plus the veil's minimum, so this should be acceptable, but the
  playtest decides.
- **`?hall=skip` hides the product path from most of the suite.** The hall,
  slots, loading and death specs are the only coverage of the default flow.
  They must stay in the PR gate, not `@nightly`.
- **Pinned seeds.** A hall that drew from `crypto.getRandomValues` would shift
  every pinned seed by one. D4's fixed seed prevents it; Stage A's no-draw test
  holds it.
- **The pause/title card is shared** (`menuOpen`), and `menuView` resets
  during render when `menuOpen` flips (`:2478`). That is why the shop is an
  overlay of its own and not a pause-menu view.
- **Storage is still one browser's.** Slots do not survive clearing site data.
  Export/import stays a follow-up.

## Out of scope

- NPCs, dialogue, or anything in the hall beyond the altar, the racks and the
  way down.
- Abandoning a run mid-descent.
- Cloud save, export/import of a slot.
- The difficulty pass (still owed from plan 019).
- New art beyond reusing the shrine mesh and a door.

## Evidence

Fill in per stage: gates, Stage 0's seed, frame and boot numbers, the exposure
list and how each item was restaged, and the planted bug for each new test
with the message it failed with.
