# Plan 018: Bonecaller, pyre and shieldbearer join the descent

> Executor: read this entire file before editing. It is self-contained and does
> not need the conversation that produced it. Implement only this plan.
>
> Planned against `main` at `362db84`, 2026-09-29, after plan 017 (chambers and
> doors) merged. Source was read; nothing was measured while writing it. Every
> share, count and threshold below that is not quoted from `game/progress.md`
> or `game/scripts/balance/bands.json` is a hypothesis, and Stage 0 exists to
> replace it with a measurement.

## Why

Nine enemy kinds exist, but the floor generator deals only four of them: guard,
stalker, archer and warden. `shieldbearer`, `reaper`, `pyre`, `bonecaller` and
`rattler` have `firstFloor: Infinity` and no share in `PACK_MIX`
(`game/app/dungeon-bestiary.ts`, `game/app/dungeon-floor.ts:31`). You can only
meet them through `?arena=`. The 2026-09-26 log entry said they would stay
there "until a playtest says which have earned a place". The 2026-09-27
playtest cut the wraith, sharpened the bonecaller, and left the shieldbearer
"untouched until there is a heavy attack to answer it with".

Plan 016 then gave every arm a special, and four of those stagger (Undertow,
Harpoon, Tolling Slam, Heavy Bolt), so that blocker is gone. Three kinds each
ask for a response the current four do not:

- **Bonecaller**: kill it first. Rattlers it raises reassemble while it stands.
- **Pyre**: do not kill it next to you. It leaves fire that bites.
- **Shieldbearer**: get behind it, stagger it, or strike in the opening while
  it winds up or recovers.

The balance sim also has no room left to tell whether the game is too easy. In
`bands.json` the default bot escapes 100% of runs at 100% median HP on every
floor, and a bot that never dodges still escapes 86.7%. Adding kinds that punish
a naive approach is the cheapest way to give floors 2 and 3 a reason to exist
beyond "more of the same, plus a third warden".

### What the game does today

- **Dealing.** `roster()` (`dungeon-floor.ts:213`) picks a pack per chamber from
  `PACK_MIX` by layer progress plus `menace = (level − 1) × 0.3`. `drawKind`
  (`:40`) makes one roll per body and skips any kind whose `firstFloor` has not
  come yet, so its share falls to the guard. The number of random draws never
  depends on the mix, which is why adding a kind moves no room, prop or weapon
  drop.
- **The bonecaller's reserve exists only in the arena.** `arenaFloor`
  (`dungeon-arena.ts:74`) appends four buried rattlers per caller after every
  standing body, with `summoner` set to the caller's spawn index.
  `generateFloor` never emits a `buried` spawn. A dealt bonecaller today would
  raise nothing.
- **The game already handles all three once they are in the spawn list.**
  - `fell`, `rebury` and `raise` (`dungeon-game.tsx:373–408`) apply `fallOf`
    and `raiseSpot`.
  - `settleRoom` (`:412`) keeps a chamber sealed while any body in it, buried
    included, is not dead. Crumbling marks the reserve dead, which is the plan
    017 D6 rule.
  - Pyre fire is `deathPool` → `hostilePools`, drawn from a fixed set of six ring
    meshes (`:684`) and cleared by `clearShots` (`:738`).
  - Shields are `landBlow(..., facingOf(enemy))` (`:1847`, `:2002`), and `burn`
    ignores them.
- **The balance sim models none of the three mechanics.**
  `scripts/balance/sim.ts`:
  - calls `landBlow` without a `facing` (`:609`, `:685`), so a shield never
    blocks there;
  - ignores `intent.raise` and never calls `fallOf`;
  - never calls `deathPool`.

  Deal the kinds without fixing that and `balance:check` will score a
  shieldbearer as a 12-HP guard, a bonecaller as an 8-HP body that backs away,
  and a pyre as a weak guard. It would measure the wrong game.

### Every arm's answer to the shield

This is the precondition for dealing the shieldbearer: no weapon should hit a
wall it has no way round.

| Arm | Answer |
| --- | --- |
| Tideblade | Undertow Lunge staggers |
| Twin Fangs | Vault lands behind it and backstabs |
| Spear | Harpoon staggers |
| Maul | Its base swing staggers, and so does Tolling Slam |
| Crossbow | Heavy Bolt staggers |
| Tideflask | Fire uses `burn`, which the shield does not stop |
| Cleaver | **Weakest.** Whirl does not stagger. It has only the flank and the opening |

Every arm also has the shared opening: the shield is down while the body winds
up and while it recovers.

## Decisions

Decisions marked **(operator)** use the recommendation unless the operator
overturns them before Stage B starts.

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| D1 | Which kinds | Dealt: bonecaller, pyre, shieldbearer. The rattler keeps `firstFloor: Infinity`: it enters only as a bonecaller's reserve and is never dealt alone. The reaper stays arena-only. | A 1.0 s all-round sweep mostly tests dash timing, which the stalker already tests. |
| D2 | First floor **(operator)** | Shieldbearer 2, pyre 2, bonecaller 3. | Floor 1 teaches the four base kinds. Floor 3 today adds only a third warden. The alternative is bonecaller on 2, if the Stage D playtest finds floor 2 flat. |
| D3 | Where the shares go | Each new kind is **appended after the existing entries** of `PACK_MIX.middle` and `PACK_MIX.late`. `opening`, `ambush` and `hoard` stay unchanged. | `drawKind` walks the mix in order, so appended kinds leave stalker and archer odds exactly as they are and take only from the guard's leftover share. Ambush is the stalker's identity. A hoard is already the densest pack. |
| D4 | Starting shares (hypothesis) | `middle`: shieldbearer .10, pyre .10 (guard .40 → .20). `late`: shieldbearer .07, pyre .07, bonecaller .08 (guard .30 → .08). | Stage 0's census replaces these with values set against the D5 targets. |
| D5 | Targets for the census **(operator)** | Share of fight chambers holding at least one new kind: floor 2 **25–40%**, floor 3 **40–60%**. Bonecaller chambers on floor 3: **15–30%**. | "A kind you meet on most floors," not "a kind in every room". Judged again in Stage D. |
| D6 | One caller per chamber | A second bonecaller rolled into the same chamber is dealt as a guard, with no extra random draw. | Two callers means eight rattlers and two priorities, which reads as noise. |
| D7 | Where the reserve comes from | A new pure helper, `buryReserves(spawns)` in `dungeon-floor.ts`, used by both `generateFloor` and `arenaFloor`. It appends each caller's reserve after **every** standing spawn on the floor, on the caller's tile, with `summoner` = the caller's spawn index. It makes no random draw. `guardCount` still counts only standing bodies. | One rule in one place. Appending keeps every standing index stable, and making no draw keeps the rest of the random stream unmoved. |
| D8 | Pyre fire after a clear | It keeps burning after the chamber opens, and `clearShots` removes it at the transition (`dungeon-game.tsx:1217`, in the crossing, beside `footsteps.clear()`). Stale rings therefore never carry into the next chamber or eat into the six-ring cap. | Killing the pyre in the wrong spot is supposed to cost you. The door only lets you leave. |
| D9 | No stat changes | The three kinds keep the stats tuned in the 2026-09-27 arena playtest. If Stage D's bands blow out, **lower the shares, not the stats**. | This changes structure first, so the sim can attribute any drift to it. |
| D10 | Sim before dealing | Stage A brings the sim to parity while nothing deals the kinds. `balance:check` must print the same measured numbers it did at Stage 0. | That is the proof that the parity work alone moved nothing. |

## Design

### Pure: `game/app/dungeon-floor.ts`

- Add `firstFloor` values for D2 in `dungeon-bestiary.ts`. The rattler and the
  reaper stay at `Infinity`.
- Append the D4 shares to `PACK_MIX.middle` and `PACK_MIX.late`.
- Add `oneCaller(pack)`, which applies D6: a bonecaller after the first in a pack
  becomes `'guard'`. Apply it inside `roster()` to the result of `pick`. It takes
  no random input.
- Add `buryReserves(spawns)`, which applies D7. Call it once after the spawn
  loop (`:227–237`) and before `dropKind` is drawn. It does not draw, so the drop
  is unaffected either way; placing it first keeps the drop-spot filter
  (`spawns.every(...)`) honest about bodies standing in the arm's chamber.
- `arenaFloor` drops its own burial loop and calls `buryReserves`. Its spawn
  list must come out identical, which a node test proves.

### Sim: `game/scripts/balance/sim.ts`

Each item mirrors a line of `dungeon-game.tsx`. Carry the line reference in a
comment, as the file already does, because that seam is where the harness goes
stale.

- **Facing.** Each body keeps `face`, a yaw taken from `intent.face` when that
  is non-null, as `dungeon-enemy-view.ts:180` does. Mid-trail poses keep the old
  yaw, but the shield is down during a windup anyway. Pass
  `{ x: -sin(face), z: -cos(face) }` to `landBlow` for strikes and bolts
  (`:609`, `:685`). Count `blocked`.
- **Summons.**
  - When `intent.raise` is set, raise the next `perTell` of the caller's buried
    reserve with `raiseSpot` (mirrors `:398–408`).
  - Every body death goes through `fallOf`. One that reassembles is reburied
    whole and unpaid (mirrors `:373–393`). Crumbled bodies are dead and pay
    nothing.
  - **Buried bodies are asleep, and nothing but a summon wakes them.** Two
    lines here get this wrong today, and the arena's first version had the same
    hole (`progress.md`, 2026-09-26: "walking back into the gate raising the
    buried"):
    - Body init (`sim.ts:272`) sets `awake: !spawn.ambush`. A buried spawn has
      `ambush: false`, so the whole reserve would start awake. It must become
      `awake: !spawn.ambush && !spawn.buried`, with `buried` tracked on the
      body.
    - The entry wake (`sim.ts:377`) springs every `!awake && !dead` body in the
      chamber. It must also skip `buried`, as the game's does
      (`dungeon-game.tsx:1612`).
  - Buried bodies stay in the chamber-clear check (mirrors `settleRoom`). They
    are left out of the "walk at whatever is left alive" target (`sim.ts:509`),
    because they cannot be struck.
- **Fire.** When a body with a `deathPool` dies, push the pool into a
  `hostilePools` list. Step it with `poolStep`, and when it bites a knight it
  catches (`poolCatches`), apply `hurt(run, pool.damage, { warded: true })`,
  attributing the damage to that kind (mirrors `:1946–1951`). Clear the list at
  a door, as `clearShots` does.
- **Two policy behaviours.** Both are inert unless the new kinds are present,
  which is what D10 checks.
  - While inside a hostile pool, the bot's move is away from the pool's centre.
    Its dodge and strike logic is unchanged.
  - A standing bonecaller within `range + 2` is preferred as the target over the
    nearest body. Without this, a bot that always swings at the nearest rattler
    can loop until `FLOOR_TIMEOUT`, and the report says `stuck` instead of
    measuring the fight.
- **Report fields** per floor: `blocked`, `raised`, `reassembled`, and
  `poolDamage` by kind. They let Stage D see what the kinds actually did.
- **`simulateArena(seed, level, roster, policy)`** runs `simulateFloor` on an
  `arenaFloor`. Stage A's tests need it because nothing deals the kinds yet.
  `simulateFloor` gains an optional prebuilt-floor parameter so this adds no
  second code path.
  - The arena's roster stands in the Tide Gate, which never seals, and its
    stair is open from the start. So an arena run ends when the roster is dead
    or the knight is. It must not walk out through a door or down the stair
    with bodies still standing, or the tests below would measure a bot that
    left.

### Census: `game/scripts/balance/census.ts` (new), `npm run census`

For the seed sweep `balance:check` uses (30 seeds from `firstSeed`), for each of
floors 1–3, it prints:

- fight chambers
- chambers holding at least one of each new kind
- bodies per kind
- the largest count of pyres in one chamber
- callers per chamber

The census is pure: it reads only `generateFloor`. It is how D4's shares are set
against D5's targets, and it is recorded rather than guessed.

It also prints, separately, how often a new kind is dealt into layers 1–2. The
"first two fights are straight" rule (`dungeon-floor.ts:164`) forces the
`watch` encounter there, but the pack still comes from the progress mix. On
floor 3, `menace` puts those chambers in `late`, so a run can meet a bonecaller
in its first fight of the floor. That is not necessarily wrong, but the operator
should see the number when judging D5.

### What stays

- Every mechanic of the three kinds: `blocks`, `fallOf`, `raiseSpot`,
  `deathPool`, their figures and palettes.
- Floor 1, byte for byte (D2).
- Chamber structure, doors, rewards, boons and XP. XP barely moves: the new
  kinds replace guards one for one, and rattlers never pay.

## Stages

Each stage ends with every gate green:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run balance:check`
- the PR gate's browser run: `npm run test:browser -- --grep-invert "@capture|@nightly"`,
  prefixed with `GAME_TEST_GL=d3d11` on Windows

Record the gates and each stage's numbers in `game/progress.md`.

### Stage 0 — Baseline (no committed code change except the fixture)

1. **Balance.** Run `npm run balance:check` and record every policy's measured
   values. Stage A is held to these exact numbers.
2. **Spawn fixture.**
   - Write `game/tests/fixtures/spawns-017.json`: for the sweep seeds × floors
     1–3, record each floor's `spawns` in full (kind, x, z, room, ambush), plus
     one hash of its `props` and `weaponDrop`, straight from today's
     `generateFloor`. Hashing keeps the file small (full props for 90 floors
     would be close to a megabyte). A moved prop still changes the hash, so the
     test can still fail.
   - Commit it. Stage B's random-stream test compares against it.
   - The fixture holds what the generator produced on 2026-09-29 at `362db84`.
     It is a record, not a recomputation.
3. **Census with today's mixes.** Every new-kind column must be zero. That
   proves the census reads what it claims to. Also record fight-chamber counts
   and guards per floor, since those are the budget the shares take from.
4. **Figure cost.** Run `dungeonTest.actorStats()` in an arena for each of
   shieldbearer, pyre, bonecaller and rattler (`?arena=<kind>:1&level=3`).
   Record draw calls and triangles per figure, including the shadow pass.
5. **Worst new chamber.** Stage
   `?arena=bonecaller:1,shieldbearer:1,pyre:1,guard:1&level=3`. Let one raise
   land so a caller, two rattlers and three others stand, then record
   `render.calls`, `render.triangles` and `render.shadow.calls`. Compare them
   with the current per-chamber frame budget (`frame-budget.spec.ts`, set from
   measurement in plan 017: flooded hall 395 calls, widest chamber 272).
6. **Fixture exposure.** Grep `tests/browser` for scenarios on floors 2–3
   (`buildFloor(2`, `buildFloor(3`, `descend`) that pin a seed and depend on a
   kind or a spawn index. List them. Stage B will change which kinds those seeds
   deal.

**Stop rule.** If step 5 exceeds the flooded-hall budget by more than 10%, stop.
Report the per-figure numbers and propose a bake or palette pass for the three
figures first. Do not raise a ceiling to make room (AGENTS.md, "Bound both
sides").

### Stage A — Sim parity (nothing dealt)

Implement the sim items above. Nothing in `dungeon-floor.ts` changes.

Node tests go in `tests/balance-sim.test.ts` and run on `simulateArena`. Each
one names the bug to plant: plant it, watch it fail with its own message, then
restore.

| Test | Plant |
| --- | --- |
| A shieldbearer blocks at least one blow from the Tideblade's plain strike (`blocked > 0`), and the fight still ends in a kill | Pass no `facing` to `landBlow` |
| The same fight with the maul records `blocked === 0` (a stagger arm breaks the guard) | Ignore `stagger` in the sim's blow |
| A bonecaller raises (`raised > 0`), and at least one raised rattler reassembles before the caller falls | Ignore `intent.raise` |
| When the caller falls, no rattler is left standing or buried, and kills count the caller alone | Skip `fallOf`'s crumble |
| A pyre's death leaves fire that damages a bot standing in it (`poolDamage.pyre > 0`, with the bot's avoidance off) | Never push the pool |
| With avoidance on, `poolDamage.pyre` is lower than with it off over the same seeds | Make the avoidance move toward the centre |
| A bonecaller fight never ends `stuck` over the sweep | Remove the caller preference |
| No rattler moves, strikes or takes a blow before the caller's first summon tell runs out | Init the body as `awake: !spawn.ambush` |

Also assert the precondition in each test: the arena actually staged the kind,
and for the block test the body was facing the knight when struck.

**Gate specific to this stage:** `balance:check` prints exactly the Stage 0
measured values for every policy (D10). If any number moves, a parity change
leaked into the existing floors. Find it before continuing.

### Stage B — Dealing (pure)

Implement `firstFloor`, the shares, `oneCaller` and `buryReserves`.

Run `npm run census` and adjust D4's shares until every D5 target is met. Record
the final shares and the census table.

Node tests, in `tests/dungeon-floor.test.ts` unless noted:

| Test | Plant |
| --- | --- |
| Against `spawns-017.json`: floor 1 spawns, props and weapon drop are identical; on floors 2–3 props, the weapon drop, and every standing spawn's x, z, room and ambush flag are identical, and only guards changed kind | Add one `random()` call inside `buryReserves` |
| Each promoted kind is dealt from its `firstFloor` on, somewhere in the sweep, and never before it | Set pyre's `firstFloor` to 1 |
| No chamber holds two bonecallers | Remove `oneCaller` |
| Every dealt bonecaller has exactly `summons.count` buried rattlers with its spawn index as `summoner`, on its tile, in its room, all listed after the last standing spawn | Append the reserve right after each caller instead of at the end |
| `guardCount` equals the number of standing spawns | Count buried bodies |
| `arenaFloor`'s spawn list is unchanged by moving the burial into `buryReserves` (compare against a literal for one seed and roster) | Bury `count − 1` |
| The census stays inside the D5 targets (bands recorded from this stage's measurement, with the date beside them) | Halve every new share |
| Stalker and archer odds in `middle` and `late` are unchanged (extend the existing `drawKind` odds test at `:299`) | Insert a new kind ahead of the stalker |
| No pyre count per chamber in the census exceeds the fire-ring count | Set the exported count to 2 |
| (`tests/balance-sim.test.ts`) On a generated floor-3 seed, entering a chamber that holds a bonecaller raises nothing before the first summon tell. The entry wake springs every sleeping body in the chamber, so it catches the buried reserve in any chamber, not only an ambush | Drop the `buried` filter from the sim's entry wake |

The fire-ring count test needs the constant in a pure module. Move the `6` from
`dungeon-game.tsx:684` to an export in `dungeon-projectile.ts`, and have the
game read it from there.

An ambush chamber can never hold a caller, because it deals only from the
unchanged `PACK_MIX.ambush` (`dungeon-floor.ts:218`). Say so in the test's
comment so nobody later "fixes" it to look for one. If the pinned seed stops
dealing a caller, the test fails with "pick another seed". It must not pass
empty.

In `tests/dungeon-enemy.test.ts`, change `'the arena-only kinds are never dealt
by the floor generator'` so it covers only the reaper and the rattler. Keep its
rattler one-blow assertion.

Assert the sweep's preconditions too: it contains floor-2 and floor-3 chambers,
and at least one bonecaller.

### Stage C — Wiring in the running game (browser)

The rules are proven in node. These scenarios check only that a **generated**
floor reaches the game correctly, as the arena specs already do for a staged one.
Put them in one story in `tests/browser/chambers.spec.ts` (or a new
`dealt-kinds.spec.ts`).

**Choosing the seed.** Pick a floor-3 seed whose bonecaller sits in a
**layer-1 chamber**, one door from the Tide Gate. On floor 3, `menace = .6`
puts almost every chamber in the `late` mix, so such seeds exist. Assert that
placement as the scenario's precondition. Crossing several chambers to reach a
caller is the expensive, flaky path the pooled suite was rebuilt to avoid. If
the pinned seed stops staging the chamber, the scenario fails with "pick another
seed"; never `test.skip`.

Each step's plant must break that step's own assertion and no other. Before
accepting a plant, ask what single change makes exactly this assertion fail.

1. **Reserve wired.** On entering the chamber, `render_game_to_text().enemies`
   lists `summons.count` bodies with `buried: true`, and the caller's spawn
   index as `summoner`. This is read from the game, not from the generator.
   - Plant: `generateFloor` skips `buryReserves`.
2. **A raised body goes back under, unpaid.** After the first summon, cut down
   one raised rattler while the caller stands. It shows `buried: true` again,
   and `kills` did not increment.
   - Plant: `fell` skips its `fall.reassembles` branch.
   - Not a seal test: while the caller stands, the caller alone keeps
     `settleRoom` from clearing, so "the chamber stays sealed" would pass with
     any reserve bug.
3. **The floor-wide index is right.** Kill the caller. Every body it called,
   standing or buried, is dead in the same update, and the chamber opens
   (`chamber.sealed === false`).
   - Plant: `buryReserves` writes `summoner` as the caller's index **within its
     chamber** instead of across the floor's spawn list. `fallOf` then crumbles
     nothing, the reserve stays buried and alive, and the chamber never opens.
     This is the wiring a single-room arena cannot catch, because there the two
     indices are the same.

Use real input for the fight and the hooks only for staging and reading back. A
pyre and a shieldbearer need no new browser test: `arena-kinds.spec.ts` already
drives their wiring, and dealing them adds no game code.

Fix every Stage 0 step 6 scenario whose pinned seed changed. Re-pick the seed or
restage it. Do not widen `DRIFTS`.

**Frame budget.** Add Stage 0 step 5's staging to `frame-budget.spec.ts`, with
both sides bounded from this stage's measurement. Write the renderer
(SwiftShader) and the date beside the numbers.

### Stage D — Balance and a human playtest

1. Run `npm run balance` for every policy. Record per floor: death rate, median
   HP left, `blocked`, `raised`, `reassembled`, `poolDamage`, and cause of death
   by kind.
2. Update `bands.json` (`measured` and `bands`) in the same change, with a note
   saying why they moved, as plan 017 did.
3. **Stop rules.**
   - If the default policy's `escapeRate` falls below 85%, or the weak policy's
     floor-3 death rate rises above 35%, lower the D4 shares (D9), re-run the
     census, and re-check D5. Do not touch the kinds' stats.
   - If a single kind accounts for more than half of all deaths, report it to
     the operator before tuning. That is a design finding, not a band to widen.
4. **Operator playtest** on a real GPU (`GAME_TEST_GL` does not apply; play the
   dev server), five runs or more. For each kind, answer:
   - Did it read as itself on first sight?
   - Did it force the response it was built for?
   - Did any arm have no answer to the shield (watch the cleaver)?

   Record the run log (`RunEnd`: cause, seconds, boons, seed) for those runs in
   `progress.md`. D2 and D5 are re-decided here if the answers say so.

### Stage E — Documents

- `game/tests/README.md`: the "Five kinds exist only here" paragraph becomes
  two: reaper and rattler only.
- `GAME_OVERVIEW.md`: add the three kinds to the enemy list. While you are
  there, the file still describes corridors, bridges and branching side
  chambers, which plan 017 removed. Correct those lines only if the operator
  agrees; otherwise note it as a follow-up.
- `dungeon-bestiary.ts`: update the header's "adding a kind" steps to mention
  `buryReserves` for a summoner.
- `plans/README.md`: add this plan's row, and plan 017's if it is still missing.
- `game/progress.md`: append the entry. Name the planted bug for each new test
  and the message it failed with.

## Risks

- **The sim's facing is a proxy.** The game takes yaw from the pose
  (`dungeon-enemy-view.ts:180`). The sim takes it from `intent.face`. They agree
  except mid-trail, when the shield is down anyway. If Stage D's `blocked`
  counts look implausible next to the playtest, this seam is the first suspect.
- **Endless reassembly.** A human who never finds the caller can stand in a
  bonecaller chamber indefinitely. That is the design, but it is also the
  likeliest "this is unfair" report. The playtest decides it. The fix would be a
  cap on reassemblies, not a stat change.
- **The cleaver and the shield.** It has no stagger special, so a cleaver run
  meets shieldbearers with only the flank and the opening. That may be fine (the
  cleaver's point is crowds), but name it in the playtest.
- **Fire mesh cap.** `hostilePoolMeshes` holds six rings. A seventh pool is
  silently not drawn and **does not bite** (`fell` pushes only when a ring is
  free). The census's largest-pyres-per-chamber column must stay at or below
  six, and with `middle`/`late` packs of at most three bodies it cannot exceed
  three. If a later change grows packs, this would break without a failing
  test, which is why Stage B adds one against the count exported from
  `dungeon-projectile.ts`.
- **Test churn.** Floors 2–3 deal different kinds on the same seeds, so
  seed-pinned browser fixtures there may stop staging. Stage 0 step 6 sizes this
  up front. Budget for it; no skips, no conditional expects.
- **XP per minute.** Rattlers never pay, so a bonecaller chamber pays one kill
  for a longer fight. Rank-ups on floor 3 may come later. Stage D's report shows
  whether that matters.

## Out of scope

- The reaper, and any new kind.
- Stat or tell changes to any kind (D9).
- Boons, door rewards, elite chambers, a boss.
- New figures or art for the three kinds.
- Mixing the new kinds into `opening`, `ambush` or `hoard` (a follow-up after
  the playtest, if D5 is met too narrowly).

## Evidence

Fill in per stage: gates, the numbers each stage says to record, the census
tables, the final shares, and the planted bug for each new test with the message
it failed with.
