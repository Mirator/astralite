# Testing the Drowned Keep

Two layers: a node suite over the pure modules, and hooks the running game exposes so a browser
console (or an automated driver) can steer a run without playing it by hand.

Before adding or changing a test, read "Writing tests that can fail" in `AGENTS.md`: every test has to be
shown failing on the bug it names, and the rules there are what a September 2026 audit of this suite needed.

## Node suite

```bash
npm test
```

Runs `tests/*.test.ts` through node's type stripping — no build step, no DOM. It covers the pure
modules:

- **The floor generator** (`dungeon-floor.ts`): the room graph is a tree, every room is reachable, the
  stair sits at the end of the trunk, dead ends are stubs, corridors never bypass the trunk, guards
  spawn on walkable floor, the gate is safe, quiet halls never come in pairs, deeper floors are meaner,
  and generation stays fast enough to rebuild a floor mid-run.
- **The run simulation** (`dungeon-sim.ts`): the rank ladder, every boon, the damage and
  invulnerability rules, kill rewards and the boon draft.
- **The spatial rules** (`dungeon-enemy.ts`): the activation cutoff, pursuit steps off the flood map,
  when a windup starts and whether the committed swing connects, the stalker pounce and its swept
  contact test, and the crowd-separation pass. Collision itself (`canStand`, `moveOnFloor`) is covered
  alongside the generator in `dungeon-floor.test.ts`: sliding, diagonal gaps, tunnelling and body
  radius.
- **Persistence** (`dungeon-save.ts`), described under Persistence below.
- **Meta progression** (`dungeon-meta.ts`, plan 019): what a run pays in pearls, buying upgrades and arms, what a run starts with,
  and the stored blob's parsing. `tests/dungeon-meta.test.ts` also holds the sim's and the game's floor count together.
- **Specials** (`tests/dungeon-special.test.ts`, plan 016): each special's timing, travel, reach and damage, the
  gate that keeps one off a live strike, the cooldown that starts at contact, and the balance batch's `special`
  policy.
- **The knight's clocks** (`dungeon-player.ts`): when a strike buffers and when it fires, how a string
  links, stays open and closes, a dash buffered behind a live blade and what a dash cancels, which way
  the knight turns and travels, hit-stop, and what a reset, a halt, a new arm and a dropped buffer each
  clear.
- **Input decoding** (`dungeon-input.ts`): key legends, which device slot holds an action, the screen
  basis a push becomes a heading on, what a keydown asks for against the bindings, every
  `dungeon-action` detail, the cursor's NDC and the pad's deadzone.
- **The combat fixture** (`dungeon-fixture.ts`): what the dev-only `configureCombatFixture` accepts and
  the message each refusal names.
- **Landed blows** (`dungeon-hits.ts`): what steel, a bolt and fire each do to the body they land on -
  damage, the flash, which windups a blow breaks and which it cannot, the cooldown it leaves, how far it
  shoves a guard and a warden, and whether it killed. What a kill pays stays with the game's `fell` and
  `settleRoom`.

Anything involving three.js, the DOM or the event listeners themselves is **not** covered here — use
the browser hooks. The world closure in `dungeon-game.tsx` still owns the listeners and decides *when*
each of these rules is asked; the modules above decide what the answer is.

### Where an enemy decision lives

`dungeon-enemy.ts` decides *what* a body does; `dungeon-game.tsx` does it, and `dungeon-enemy-view.ts`
draws it. `decideEnemy` takes a plain
snapshot of one enemy (kind, position, room, cooldown, hitFlash, windup, lunge, tell, speed, aim), the
knight's position, the floor's walkable cells plus the flood distances, and a frame delta, and returns an
`EnemyIntent` — `act` (`inert` / `lunge` / `windup` / `ready`), the new position and timers, the yaw to
face, whether the blow connects and which cue to sound. It mutates nothing. The renderer keeps the
`THREE.Group`, limb and weapon poses, audio, particles, emissive flashes, health bars and telegraphs —
all of which consume the intent rather than deciding it. `spawnEnemy`, `markEnemy` and `poseEnemy` in
`dungeon-enemy-view.ts` build a body and put its marks and its decision on screen; the loop in the game
file keeps the gameplay between them (noticing, the contagion wake-up, the blow landing). `separateCrowd` is the same deal for the
crowd pass: bodies in, fresh points out.

### Invulnerability

One window, `INVULN` in `dungeon-sim.ts`, for every damage source. `hurtFlash` in the game file still
drives the screen filter and the camera shake and still runs longer after an ember burn (0.65s) than
after a sword (0.35s), but it no longer gates damage — it used to, which meant a 10-damage hazard tick
bought more immunity than a 20-damage warden swing. The hazard's once-per-flare throttle now belongs to
the flare: each ring carries its own `burned` flag, cleared the moment it stops firing. Dash cover
(`dashTime > 0`) is separate and unchanged.

## What the pull-request gate runs

Two tags take scenarios off the PR gate without deleting them. `.github/workflows/deploy-pages.yml` passes
`--grep-invert "@capture|@nightly"` unless a capture run was asked for, and a capture run (the `captures`
input on Verify and Deploy) runs everything. Nothing runs them on a schedule: the nightly isolated workflow
was removed on 2026-10-01, so `@nightly` now means "run by hand before merging a change that could move it"
(locally, or with a capture run).

- **`@capture`**: the scenario only stages a frame for review. `game.capture()` writes nothing unless
  `GAME_TEST_CAPTURE=1`, so on a PR it would boot, stage and assert only that the seed still produces the
  scene. All of `shots.spec.ts` and the per-theme and phone captures in `macro-paving`, `floor-motifs` and
  `theme-flames` carry it.
- **`@nightly`**: a real check that is too expensive for every PR or pins art tuning a look change is
  expected to move: the theme-colour and two of three telegraph-legibility cases in `art-direction`, the
  eight-facing and cast checks in `models`, and the keep and ruins footstep pixel checks (flooded, whose
  room is far from the origin, stays on the gate).

The gate's three CI shards are split by measured duration, not by `--shard`'s equal test counts:
`scripts/shards/plan.ts <shards> <index>` prints one shard's specs from `scripts/shards/durations.json`.
When the suite changes shape, refresh the durations from a green run's browser-job logs with
`node --experimental-strip-types scripts/shards/refresh.ts <log> [...]`. A spec missing from the file
weighs the median until then, and `tests/shards.test.ts` guards that every spec lands on exactly one shard.

Frames the harness compares (`framePixels`, `cutawayFrames`, `pauseFreezeCheck`) cross from the page as one
base64 string. Shipping them as an `Array.from` of the RGBA bytes cost about 15 s a frame on CI and made
the occlusion scenario the longest test in the suite by far.

Some gate scenarios are the only coverage left for behaviour whose unit tests were removed as duplicates
(the footstep hit-stop, subdivision and reduced-motion checks, the motif rebuild, the flame redraw, the
enemy silhouettes, the arm-swap leak): trim those only together with a unit test that takes their place.

## Browser hooks

The game installs these on `window` once its first floor has been built, which happens behind the menu a couple of
frames after the page mounts (every hook reads the floor, so none is up before it exists). That first floor is the
Tide Altar's hall unless the URL says `?hall=skip` (see [The hall](#the-hall)). Wait for
`render_game_to_text` to be a function before using any of them. They are meant for the console and for
automated drivers; nothing in the game itself calls them.

| Hook | What it does |
| --- | --- |
| `render_game_to_text()` | JSON snapshot: mode, `building` (a floor build pending behind the loading veil), health, rank, boons, objective, floor, enemies, `buildMs`, `render` counters, `settings`, `camera` |
| `advanceTime(ms, draw = true)` | Steps the simulation deterministically. **The normal rAF loop stops after the first call** — reload to get it back |
| `dungeonTest.teleport(x, z)` | Moves the knight in world units (`tileX * TILE`) |
| `dungeonTest.descend()` | Takes the stair without fighting, capped at the last floor |
| `dungeonTest.buildFloor(level)` | Rebuilds the floor at any level, including past the last one. Always an ordinary floor, whatever the last build was (plan 020) |
| `dungeonTest.buildHall()` | Plan 020: rebuilds as the Tide Altar's hall, synchronously. The run in hand carries over, so a scenario that needs the armoury (it only stands there) can rebuild the page as the hall after `game.enter()` (`Game.buildHall`) |
| `dungeonTest.buildArena(roster, level = 1)` | Development only: rebuilds as an arena, `roster` awake in the gate (see [The arena](#the-arena)) |
| `dungeonTest.grantXp(amount)` | Awards XP, so the boon draft can be reached in one line |
| `dungeonTest.runLog()` | The stored history of finished runs, oldest first — re-read and re-validated on every call |
| `dungeonTest.meta(slot?)` | Plan 019: the stored pearl save (`{ pearls, upgrades, arms, arm }`), re-read and re-validated on every call. Plan 020: of the active slot, or of `slot` |
| `dungeonTest.setMeta(meta, slot?)` | Plan 019: writes a pearl save through the real storage path. Fixture setup only; see [The pearl save](#the-pearl-save). Plan 020: into the active slot, or into `slot` without choosing it |

`dungeonTest.runLog()` is how a balance question stops being a memory: `copy(JSON.stringify(window.dungeonTest.runLog()))`
gives every finished run since the log was capped, each one `{ at, floor, won, cause, seconds, rank, xp, kills, boons, seed, arm, upgrades, pearls }`,
so deaths can be counted per floor and per `cause` (any enemy kind in `ENEMY_KINDS`, or `hazard`; null on a win)
and any run worth seeing again replayed with `restart:<seed>`.

`render_game_to_text().settings` reports the stored settings plus what they currently amount to:
`reduceMotion` (the effective answer, OS preference included), `filter` (what the canvas is wearing this
frame), `shake`, `hitStop` and `sound` (`volume`, `muted`, the mixer `target` and the live `gain`).
`render_game_to_text().camera` gives the camera's position beside its shake-free rest position
(`restX`/`restZ`), so "reduced motion stopped the camera moving" is a number rather than an impression.

`render_game_to_text().player` reports `invulnerable` (seconds of the damage window left) alongside
`hurtFlash` (the visual), and each entry in `features` reports `burned` — whether that ring has already
burned the knight during its current flare.

Start a run from the console with `window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' }))`.
Other useful details: `attack`, `dash`, `special` (a tap), `hold-special`/`release-special` (the touch button's
hold, which a charged special needs), `map`, `pause`, `move:up|down|left|right`, `stop:…`, `stick:<x>,<y>`,
`stick:off`, `boon:<id>`, `restart`, `restart:<seed>`, and (plan 020) `slot:<n>` and `erase:<n>` for n in 1..3, `altar` (the result card's
RETURN TO THE ALTAR: a finished run goes back to the hall), `shop-close` (the hall's shop put away) and `title` (the hall's LEAVE TO TITLE). `restart:<seed>` is the only way left to
retry a seed from a finished run: neither card offers it.

`render_game_to_text().player.special` is the held arm's special (plan 016), or null for an arm without one:
`{ id, ready, cooldown, charging, charge, held, live, buffered, harpoon, bare, vault }` - `cooldown` is the sim's own
`run.specialCooldown`, `charge` is 0..1 past the charge minimum, `harpoon` is the thrown spear (`out` or `back`)
and `bare` says the strike is bare-handed meanwhile. `vault` is the Vault in progress (`target` as an index into
`enemies`, or null for a plain hop; its path `distance`; `landed`). `ready` for the Heavy Bolt is the quiver,
not a cooldown; for the Flashpoint it is the cooldown alone, and a press with `weapon.fires` at 0 is refused.
`weapon.special` carries the arm's numbers and `weapon.pools` where the fires are. `effects.shock` is the Slam's
shockwave, the Whirl's ring or the Vault's landing mark; `effects.lane` the Heavy Bolt's line on the floor
(`{ length, opacity }` or null) and `effects.flares` the detonated pools still flaring.

`stick:<x>,<y>` is the touch thumbstick's analog path: a screen-space direction (`x` right, `y` down) on the
same basis the four `move:` directions build, so `stick:0.707,-0.707` is up-and-right and `stick:0,0` is a
planted thumb holding still. `stick:off` releases it, as does any value that does not parse. A live stick
outranks `move:`, and only for as long as it is live — releasing it hands steering straight back to whatever
`move:` keys are still held, and neither path ever clears the other's state.

`start` is the press that enters the keep (plan 020: ENTER THE KEEP on the title only opens the slot picker; a slot's card sends `slot:<n>` and then `start`, and `Game.enter(slot = 1)` in
`tests/browser/helpers.ts` does both with real clicks, so the 138 callers did not change). `slot:<n>` makes slot n the one every read and write of progress speaks for and remembers it as the
slot last played; `erase:<n>` empties one. Neither is answered while a run is live or a build is pending. `render_game_to_text().slot` is the active slot, read off the game's closure. Pressed before
floor 1 exists, `start` is held behind the loading bar and answered the frame the keep is drawn. `start:<seed>` (no menu item sends it since plan 020 removed LAST KEEP) enters the floor 1 a previous
visit left.

`restart` resets the whole run in place — health, rank, boons, XP, kills, input — and rebuilds floor 1
from a fresh seed; no page reload, so the `AudioContext`, the GPU context and the `window` hooks all
survive it. `restart:<seed>` does the same but replays that exact floor 1 (`render_game_to_text().floor.seed`
reports the current one), which makes a deterministic run reproducible from the console:

```js
const seed = JSON.parse(window.render_game_to_text()).floor.seed;
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: `restart:${seed}` }));
```

### The pearl save

Plan 019's save is one more `localStorage` key per slot, `drowned-keep:<slot>:meta` (see Persistence), which the game reads at **every run
start** (`restart`, and the first `enter`), never once at mount. That is what lets a test stage it and what keeps one scenario's
purchases out of the next.

- `dungeonTest.meta()` reads the stored blob. `dungeonTest.setMeta(meta)` writes one; it goes through `writeMeta`, so the same
  validation a stored blob gets applies, and it **takes effect at the next run start**, as a real purchase does. Call it, then
  `game.enter()` (or `restart`), not the other way round. Build a `Meta` from `freshMeta()` in `app/dungeon-meta.ts`:
  `setMeta({ ...freshMeta(), arms: ['tideblade', 'maul'], arm: 'tideblade' })` puts the maul on a rack in the Tide Altar's hall.
- **The pooled reset clears it.** `Game.reset` empties `localStorage` before it rebuilds, so every scenario starts from
  `freshMeta()` (no pearls, only the Tideblade). The reset-and-prove step at the end of a scenario holds the whole snapshot
  against a boot, and `run.start` is in that snapshot, so a scenario that bought something and leaked it fails by name.
- `render_game_to_text().run.start` is `{ arm, maxHp, strike, draftSize, defiance }`: what the live run was dealt, read off the run
  and the arm in hand when it began, not recomputed from the meta. It stays what the run began with while boons move `maxHp` and
  `strike`, and `defiance` is the revive dealt, not the revive left.
- `render_game_to_text().run.armLocked` is true once the way down out of the hall has been taken (plan 019 D9, moved by plan 020 D7): the racks are
  gone and the swap key can no longer equip an arm. It is true on every floor but the hall (and the dev arena, which keeps its one rack); each build sets it.
- `render_game_to_text().racks` is the list of racks on the floor, read off the scene (it replaces the single `drop` the snapshot
  once had): `{ x, z, kind, radius, over, inScene, offered }`. The Tide Altar's hall (plan 020; floor one's Tide Gate holds none) holds one for every owned arm but the one
  in hand, up to six; the dev arena has its own; no other floor has any. `over` is the knight standing in that ring,
  `offered` the arm the swap prompt is naming. `dungeonTest.actorStats()` reports the racks' meshes as `racks` for the teardown
  checks.

The result card's one button, RETURN TO THE ALTAR, and the shop it leads to are driven with real clicks and keys (`tests/browser/meta.spec.ts`, `death.spec.ts`); the Tide Altar's panel
left the title for the hall's shop overlay in plan 020. `tests/browser/armoury.spec.ts` walks into a rack's ring and uses the swap key. The rules live in node:
`tests/dungeon-meta.test.ts`. The slot picker is driven with real clicks and keys in `tests/browser/slots.spec.ts`; the rules behind it (keys, summary, migration, erase) are in
`tests/dungeon-save.test.ts`.

### The hall

Plan 020: the Tide Altar is a room (`altarHall()` in `app/dungeon-floor.ts`: room 0 of `generateFloor(HALL_SEED, 1)`, one door, nobody in it), and the product's own flow runs through it:

```
title -> slot picker -> the hall -> the way down -> floor 1 ... -> the card -> RETURN TO THE ALTAR -> the hall
```

In the hall the swap key opens the altar's shop at the altar (an overlay that holds the world, like a boon draft), swaps the arm on a rack the knight stands in, and takes the way down (`lockArm`, then a veiled
`restart` into floor 1 on a fresh seed). The hall has no enemies, no stair, no XP and no record, and its HUD shows neither vitality nor rank.

- **`?hall=skip`** (development only, ignored by a production build) keeps the flow that existed before the hall: the boot builds floor 1 and ENTER enters it. **The harness passes it on every `goto` it makes**
  (as it passes `boot=eager`), so the 138 callers of `game.enter()` and the pooled page are unaffected, and a reset returns a page to the mode it booted in. Floor one has no racks under it.
- **`test.use({ hall: true })`** opts a scenario out: the page boots the way a player's does, into the hall, and (like an isolated or a phone scenario) gets a page of its own. The hall, slot, loading and death
  scenarios are the only coverage of that default flow, so they are on the PR gate and not `@nightly`. `Game.takeWayDown()` stands the knight at the way down (a teleport) and takes it with the real swap key;
  `Game.openAltar()` does the same for the shop; `walkUntil` walks with real arrow keys.
- **`dungeonTest.buildHall()`** (`Game.buildHall()`) is the cheap way into the hall for a pooled scenario that is about something else but needs an armoury (the swap itself, a special that must be put away, the actor
  stats of a rack): `game.enter()` as usual, then `await game.buildHall()`. The run in hand carries over, and the reset puts the page back on floor 1, which the leak guard holds.
- `render_game_to_text().hall` is read off the floor that was built; `altarOpen` is the shop; `hallProps` is what the scene actually placed, read off the groups it was attached to - `{ altar: { x, z, radius, over, inScene },
  racks: [kind], wayDown: { x, z, radius, open, over, inScene, sign: 'down' }, stair }` or null off the hall (`stair` must be false: the hall builds none). `boonOffer` is not true while the shop is open.
- The hall draws nothing from `crypto.getRandomValues`, so a pinned seed queue is where it was after a hall build (`pinnedDraws` in `helpers.ts` reads the cursor).

### The arena

`?arena=guard:2,archer:1&level=2` (counts optional, `level` 1-3, default 1) works in every build, the published
one included, and the menu's kicker then reads `ARENA · 3 FOES · FLOOR 2`. In development the menu's
**Arena · dev** page and `window.dungeonTest.buildArena(['warden', 'archer'], 2)` do the same. Either way it charts every floor as an
arena: the floor that seed would have laid, with every spawn cleared and the roster awake on a ring in the
gate, clear of where the knight arrives and of the rack (`app/dungeon-arena.ts`). The stair is open from the
start, since no warden bars it, and taking it brings the same roster a floor deeper; a restart keeps it.
The menu page's **Ordinary keep**, or `dungeonTest.reset`, leaves it. `render_game_to_text().arena` reports
`{ roster, level }` or null, which is also how the pooled suite notices a scenario that forgot to leave it.
A link that names an unknown kind or a bad count is ignored whole rather than half-obeyed. An arena run is never
recorded: no run log entry, no best run, and its seed does not become the slot's stored seed.

Two kinds exist only here - `reaper` and `rattler` - with `firstFloor: Infinity` and no share in `PACK_MIX`,
so the floor generator never deals them standing. The other three arena kinds were promoted into the descent by
plan 018 (`shieldbearer` and `pyre` from floor 2, `bonecaller` from floor 3, shares in `PACK_MIX.middle` and
`.late`), and `npm run census` prints what the generator deals; `tests/browser/arena-kinds.spec.ts` drives all of
them, and `tests/browser/dealt-kinds.spec.ts` checks a generated floor reaches the game (a rattler is dealt only
as a bonecaller's reserve). A bonecaller arrives, in the arena and on a generated floor alike (`buryReserves`),
with four rattlers buried under it and raises two per call: `render_game_to_text().enemies` lists them with `buried: true` (and
`summoner`, the spawn index that raises them) while underground. One cut down while its caller stands goes
back under, whole and unpaid; when the caller falls, every one it called crumbles, standing or buried. Each
enemy also reports `blocked` (blows a shieldbearer turned aside); `hostilePools` lists the fire a pyre left.

It is the quickest way to look at a new kind in the game rather than on the bench. Only the link ships:
`npm run build:check` fails if the menu page's event name or its menu label reaches the production bundle.

### Bosses

Plan 021: every stair hall holds a boss and nobody else, dealt per run from floor one's seed (`dealBosses` in `app/dungeon-floor.ts`; floor three is `FINAL_BOSS`). The pool (`BOSS_POOL`) holds four: the Drowned Captain (`captain`), the Pyre Mother (`mother`), the Tide Hound (`hound`) and the Bastion (`bastion`), their moves and phases in `app/dungeon-bestiary.ts`; floors one and two never get the same one in a run. Floor three always gets the Bone King (`king`, `FINAL_BOSS`), who has his rattlers buried at his feet (`reserveSize`, sized from his move list: four) and whose fall crumbles all of them. `?arena=<kind>:1` stages any of them alone, the King and his reserve included.

- **`?boss=<kind>`** (development only, ignored by a production build, which `npm run build:check` holds) puts that pool boss on floors one and two. **The harness passes `boss=captain` on every `goto`** it makes, as it passes `boot=eager` and `hall=skip`, so the bosses a scenario meets do not depend on the deal and do not move when the pool grows. `test.use({ boss: null })` boots without the link, on a page of its own.
- `render_game_to_text().boss` is the live boss body or null: `{ kind, hp, maxHp, phase, move, unhittable, change, awake, windup, attack, cue: { visible, shape, scale }, bar, surge, shield }`. `phase` is its place in its `phases`, `move` its slot in that phase's rotation, `unhittable` and `change` the phase change in progress (nothing hurts it, and the knight is pushed out of its reach), `attack` the move whose tell last began; `cue.shape` is read off the telegraph mesh's geometry (`arc`, `ring` or `lane`), `bar` is whether its own floating health bar shows (it never does: the boss bar replaces it), `surge` the ring a phase change plays at its feet and `shield` whether the shield on its arm is drawn (null for a boss with none; the Bastion's breaks in its second phase). `experience.perBoss` is what felling one pays.
- The **boss bar** is DOM: `.boss-bar` (`role="progressbar"`, named for the boss, one `u` tick at each phase threshold), present only while a boss has noticed the knight and still stands. On a phone it takes the title's row for the fight.
- `settleBoss(game)` in `helpers.ts` waits out a boss's phase changes. A boss a fixture leaves at `hp: 1` is under every threshold it has, so it changes phase (unhittable for a second, the knight pushed out of reach) before a blow can land; a scenario that stages one waits that out, and puts the knight back, before it swings.
- The snapshot also carries what a scatter and a fan draw, read off the meshes: `scatterMarks` (the rings a boss's scatter has marked and not yet lit: `{ x, z, radius, drawn, threat }`), `hostilePools[].drawn`, `hostileRings` (how many of the six hostile fire rings are showing, lit and marked) and `arrowsDrawn` (the arrows of the twelve showing; `hostileBolts` is the bolts in the air).
- `tests/browser/boss.spec.ts`: the Captain's fight is wired (moves, cues, bar), its phase is wired (a real strike, the window, the push), the stair on a generated floor, and the bar on a phone; and one story for each pool boss that came after: the Mother's fan and its arrows, a scatter's marks, pools and bite, and the knight's own fire counted against the free rings; the Hound's chained pounce in the running game; the Bastion's shield turning a real strike aside until the phase breaks it; and the Bone King's two (his summon drawn as a ring, a call standing up the move's own rattlers, the bar's two ticks and a summon on every second move below 25%; his fall crumbling standing and buried rattlers, opening the stair and winning the run through the real cards, on floor three). The rules are in `tests/dungeon-captain.test.ts`, `dungeon-mother.test.ts`, `dungeon-hound.test.ts`, `dungeon-bastion.test.ts`, `dungeon-king.test.ts`, `dungeon-enemy.test.ts`, `dungeon-floor.test.ts`, `dungeon-sim.test.ts` and `dungeon-meta.test.ts`.
- `frame-budget.spec.ts` holds each pool boss's stair hall to a number measured in a 45-tile goal chamber (`POOL_SCENES`; seed 33 floor two, `test.use({ boss })`). The Bone King's has its own scene (seed 0x86 floor three, the same kind of crypt): the King calls his whole reserve himself, one blow from death in his last phase and held on his spot at a distance where summoning is all he does, and the frame is drawn with every rattler standing (427 calls, 81 under the 508 ceiling; the frame is drawn once the held rattlers have stopped walking, so it is the same frame on every run).
- `npm run balance:bosses` (`scripts/balance/bosses.ts`, rules in `tests/balance-bosses.test.ts`) is the per-boss duel report (`simulateArena`, 30 seeds per boss per floor for the default and weak knights: deaths, seconds, damage, vitality left, and D9's pool fairness) and D9's whole-run table (the default, weak and weak-meta-max knights against D9's targets and the 70% stop rule). `--duels` and `--runs` run one half, `--seeds` widens the duels.

### Staging a fight

`window.dungeonTest.configureCombatFixture({ health, enemies: [{ index, x, z, hp, windup, cooldown, aim }] })`
moves actors the floor already spawned so a test can stage a tick real play never quite reaches — a
skeleton one blow from death while another's windup expires in the same update. `index` is the spawn
index, which matches the snapshot's `enemies` array only while nothing has died. Every field is validated:
positions must be standable, `hp` stays within `1..maxHp`, `windup` within `0..tell`, `aim` non-zero. The
run must have started and be paused or under manual time. It never replaces a rule and never takes code,
and the branch that installs it is dropped from a production build, so `tests/browser/combat.spec.ts`
asserts it is present rather than skipping when it is not.

### Persistence

Plan 020 keeps three save slots. Per slot, four `localStorage` keys, `drowned-keep:<slot>:best`, `drowned-keep:<slot>:seed`, `drowned-keep:<slot>:runs` and `drowned-keep:<slot>:meta` (slot 1, 2 or 3),
hold the deepest run (XP breaks a tie on the same floor), the current run's floor-1 seed, the last 100 finished runs and (plan 019) the pearls, upgrades and unlocked arms. Per device, `drowned-keep:settings` holds what the
player asked the game to be, and `drowned-keep:slot` the slot last played. The first mount of a build with slots copies the four pre-slot keys (`drowned-keep:best` and so on, which are left in place) into slot 1 if slot 1 is empty. The meta blob is re-validated field by field like the settings (`parseMeta`), and a run abandoned by reloading banks nothing. Nothing leaves the
browser. Every read and write is wrapped, and a missing, blocked or corrupt value reads as absent — the
game plays identically with storage disabled, and a single malformed entry is dropped without costing
the rest of the history. `tests/dungeon-save.test.ts` covers the comparison, the parsing, the cap, the
throwing-storage paths, and the settings schema below.

### Settings

Volume (a multiplier on the fixed 0.45 master gain, so `1` is the game as it shipped), mute, reduced
motion, touch layout and the key bindings. Unlike a run record the blob is never all-or-nothing: each
field is validated on its own and falls back to its own default, so a partial or hand-edited cell costs
that field and nothing else.

Reduced motion is three-state: `null` follows `prefers-reduced-motion` and is the default, `true` and
`false` override it either way, and a change to the media query while the page is open is followed.
Reduced means **no camera shake at all** and a **still** hurt tint (`sepia(.3) saturate(1.5) hue-rotate(-22deg)` for the
same duration, with the brightness ramp dropped); hit-stop is deliberately untouched, because 35ms of
stillness is not motion and shortening it would hand every landed blow back to the enemies sooner.

Bindings map twelve actions (`up`/`down`/`left`/`right`/`attack`/`special`/`dash`/`swap`/`map`/`pause`/`mute`/
`fullscreen`) to lists of `KeyboardEvent.code`s and mouse codes (`Mouse0` left, `Mouse1` middle, `Mouse2` right;
plan 016). A new code replaces the action's codes on the same device only, so moving Strike from J to X leaves it on
the left button. Binding a code takes it from whatever held it; if that would leave the other
action with no key at all the two trade instead. `Escape` belongs to pause and can never be bound to
anything else, and the game answers `Escape` with a pause whether or not it is bound — so no rebind can
shut a player out of the menu that would undo it. The `preventDefault` list follows the bindings: a
browser key (space, arrows, page keys) is swallowed only while something is bound to it.

`Touch<action>` slots in the held-key set belong to the touch controls alone and are never part of a
binding, so `move:`/`stop:`/`hold-attack`/`hold-special` steer identically whatever the keyboard has been set to.
A pad holds one `Pad<button index>` slot per button, so B and RB (both dodge) never release each other.

### Recipes

Walk a floor and read the state back:

```js
const S = () => JSON.parse(window.render_game_to_text());
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' }));
const stair = S().floor.rooms[S().floor.goal];
window.dungeonTest.teleport(stair.x * 1.48, stair.z * 1.48);
window.advanceTime(200, false);
S().objective; // { floor, halls, goalDepth, atStair, stairClear, stairOpen, onStair, … }
S().stair;     // { x, z, radius } — the open stair takes the knight when he stands within `radius` and presses the swap key
```

Open the boon draft (it freezes the world until a card is clicked, so yield to React first):

```js
window.dungeonTest.grantXp(200);
await new Promise(r => setTimeout(r, 30));
document.querySelector('.boon-option').click();
```

CPU cost per frame, independent of vsync — simulation only, then simulation plus draw:

```js
const bench = (draw, n = 80) => {
  for (let i = 0; i < 8; i++) window.advanceTime(16.67, draw);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) window.advanceTime(16.67, draw);
  return (performance.now() - t0) / n;
};
bench(false); bench(true);
```

Cost of building a floor, phase by phase — the only place this game stutters:

```js
window.dungeonTest.descend();
JSON.parse(window.render_game_to_text()).buildMs;
// { dispose, generate, tiles, walls, atmosphere, enemies, total }
```

Leak check across floors — geometry and texture counts must not climb:

```js
for (let i = 0; i < 6; i++) {
  window.dungeonTest.buildFloor(i + 2);
  console.log(JSON.parse(window.render_game_to_text()).render);
}
```

Real frame times need the browser tab to be **visible** — `requestAnimationFrame` is paused in a
hidden tab, and a sampler will simply never finish:

```js
const d = []; let last = performance.now();
await new Promise(done => {
  const step = (now) => { d.push(now - last); last = now; d.length < 120 ? requestAnimationFrame(step) : done(); };
  requestAnimationFrame(step);
});
d.sort((a, b) => a - b); d[Math.floor(d.length / 2)]; // median, capped by the display refresh
```

## Playing it by hand

Nothing automated can say whether a control feels right on a real mouse or pad. From `game/`, start
the dev server (stop any browser run first, it wants the same port):

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Then open one of these in Chrome and press ENTER. `?arm=` is dev-only and ignored by a production
build; every descent, including one begun by `restart` and `restart:<seed>`, starts holding that arm. A missing or unknown
id means the Tideblade.

| Arm | Special | URL |
| --- | --- | --- |
| Tideblade | Undertow Lunge | <http://127.0.0.1:3000/?arm=tideblade> |
| Salt Spear | Harpoon | <http://127.0.0.1:3000/?arm=spear> |
| Bell Maul | Tolling Slam (hold, release) | <http://127.0.0.1:3000/?arm=maul> |
| Twin Fangs | Vault | <http://127.0.0.1:3000/?arm=fangs> |
| Warden's Cleaver | Whirl | <http://127.0.0.1:3000/?arm=cleaver> |
| Keep Crossbow | Heavy Bolt (hold to draw, release) | <http://127.0.0.1:3000/?arm=crossbow> |
| Tideflask | Flashpoint (needs a pool burning) | <http://127.0.0.1:3000/?arm=flask> |

The console hooks cover the rest: `dungeonTest.equip('maul')` swaps mid-run, `dungeonTest.descend()`
skips a floor, `dungeonTest.grantXp(500)` opens a boon draft. A settings blob from before plan 016
keeps Space on strike; reset the binds on the settings card, or run
`localStorage.removeItem('drowned-keep:settings')` and reload.

What to check for plan 016:

- **Mouse and keyboard:** LMB strikes (held keeps striking), RMB is the special, Space and Shift
  dodge. A dodge with the cursor parked to one side keeps the next strike aimed at the cursor. `Tab`
  opens and closes the map; in the menus it still moves focus.
- **Keyboard only:** `J` strike, `K` special, `L` dodge; aim snaps onto the body in front.
- **Pad:** A strike, X special, B or RB dodge (hold A and tap RB), Y (the swap binding) uses the rack the knight stands in, a door, or the open stair,
  View opens the map, Start pauses.
- **The stair:** once its wardens fall, standing on it only shows the prompt; the swap binding (`E`,
  pad Y, or a tap on the prompt) takes it down. Standing there does nothing on its own.
- **Each special:** it reads as a distinct move, its HUD icon sweeps back after the cooldown, and a
  dodge in its wind-up cancels it at no cost. The Slam's ring shows the reach while charging and the
  shock ring on impact. The Vault goes over the body in the aim and lands behind it inside a mint ring;
  the Whirl leaves a pale ring at its reach; the Heavy Bolt draws a faint line along the aim, fires only
  at a full draw, empties the quiver and cannot draw dry; the Flashpoint does nothing until a pool is
  burning, then turns every pool white and ends it.
- **Touch (optional):** the phone viewport in Chrome's device toolbar shows STRIKE, DASH and SPECIAL.

## Before and after, on one sheet

```bash
npm run shots:compare                      # fork point with main vs the working tree
npm run shots:compare -- --base HEAD       # HEAD vs the working tree: near zero, or a scene is unstable
npm run shots:compare -- --before ../output/shots/baseline --gl swiftshader
npm run shots:compare -- --help
```

For an art change: every scene in `tests/browser/shots.spec.ts` captured on the previous version and on the
working tree, and a contact sheet at `outputs/shots-compare/<timestamp>/index.html` with a row per scene -
previous | current | difference x6, with the change's bounding box outlined in magenta so a few pixels can
be found - its changed-pixel count, worst and mean step and bounding box, and draw calls and triangles before
and after from the `COST` lines. The concept sheet's main scene
(`docs/reference/dungeons-beyond-concept.png`, the top-left 960x515) is pinned beside the index, and the two
strips fold away under their own headings. It judges nothing and always exits 0 when both captures ran; a
human looks at it.

- **Previous** defaults to the commit the branch forked from `main` (`git merge-base main HEAD`), which is
  what a pull request is reviewed against. On main's tip that is HEAD itself, so it compares uncommitted work
  with HEAD, or a clean tree with `HEAD~1`. `--base <ref>` picks any commit; use `--base origin/main` if the
  local `main` is stale. It is captured from a temporary `git worktree` in the system temp directory that
  borrows this checkout's `node_modules` through a junction - so no `npm ci`, and a base with a different
  `package-lock.json` gets a warning, since it would run on today's dependencies. The worktree is removed
  when the run ends, including after a failure or ^C, and the junction is always unlinked before anything
  deletes a directory.
- **`--before <dir>`** uses a directory of PNGs instead, and `--after <dir>` does the same for the current
  side: two earlier `before/` or `after/` folders re-sheet in seconds with no capture at all, keeping what
  they were captured from.
- **One renderer on both sides.** `--gl d3d11` (the default) takes about 45s a side for `shots.spec.ts`
  alone, 1.5 minutes for the whole comparison; `--gl swiftshader` is the renderer `output/shots/baseline/`
  came off, and took 135s for one side on the same machine. Each side records its renderer in
  `meta.json`; the tool refuses a directory captured on the other one unless told `--allow-mixed-gl`, and
  warns when it cannot tell. It refuses a base too old to honour `GAME_TEST_GL` rather than silently
  capturing it on SwiftShader.
- **Serial.** The base capture runs, finishes and releases its port before the working tree's starts; each
  is one Playwright worker. The working tree uses `GAME_TEST_PORT` (default 3000) and the base the next port
  up (`--port`, `--base-port`); both are checked before anything starts, because the suite will not adopt a
  server that is already there.
- `--grep <pattern>` narrows the run to matching `shots.spec.ts` test titles, e.g. `--grep "flooded|warden"`.

The output directory is under the root `outputs/` ignore rule rather than under `test-results/`, which the
next `npm run test:browser` empties. It holds `before/` and `after/` (the PNGs, `costs.json`, `meta.json`
and the run's `run.log`), `diff/`, `summary.json` and the sheet. The diff is `scripts/shots/diff.ts`. To diff
two capture folders you already have, pass both: `npm run shots:compare -- --before <dir> --after <dir>`.

What `--base HEAD` looks like on d3d11 (2026-09-22, `e2f49b5`), which is the floor under any real change:
the flooded hall and the warden chamber are identical; the strike contact frame, the shrine and every strip
frame move by at most 85 pixels (the strike strip's sparks, the dash's dust); the bridge (2,495 px, worst 6)
and the junction (2,895 px, worst 1) move faintly along the top walls; the dark corridor (21,041 px, worst 17)
moves along the top walls and in the HUD bars; and the gauntlet (38,310 px, 5.5%, worst 203) changes wherever
its embers are, because they draw real entropy. Read a change in those scenes against that, and a d3d11 sheet
only against another d3d11 sheet.

## Figures

The knight (`dungeon-knight.ts`) and the three skeleton kinds (`dungeon-skeleton.ts`) are part lists (plan
012): every plate, joint and strap is a named entry in a spec tree built by `dungeon-figure-spec.ts`'s
`buildSpec`, not a `new THREE.Mesh(...)` a few statements away from the code that positions it. Finding
"the knee" or "the visor" is a text search for its name in the spec, not a read of the whole builder.

`app/bench/page.tsx` (dev-only - `npm run build` drops it; a production request 404s) renders every figure
from eight facings on one sheet with `npm run figures`, which is fast enough to run after every edit:

```bash
npm run figures                                      # every figure, every facing, Tideblade
npm run figures -- --figures knight --weapon all      # the knight alone, once per arm
npm run figures -- --zoom 1.3 --bg grey
```

It writes `outputs/figures/latest.png` (after moving the previous one to `previous.png`) and a timestamped
copy, reusing a dev server already on `GAME_TEST_PORT` (default 3200) or starting one. `GAME_TEST_GL=d3d11`
applies the same as everywhere else in this file.

The iteration loop:

1. Find the part by name in `dungeon-knight.ts` or `dungeon-skeleton.ts` and edit it.
2. `npm run figures`, then compare `previous.png` with `latest.png` (they sit beside each other in
   `outputs/figures/`).
3. `npm test` - `tests/dungeon-figures.test.ts` holds a cached rebuild of every figure to a fresh one,
   so a bake that corrupts shared geometry fails here. There is no frozen fixture to regenerate.
4. Judge the change the way it will actually be judged, in the game: `npm run shots:compare -- --grep
   models`.

`tests/browser/bench.spec.ts` is the regression guard behind `npm run figures` itself: it opens `/bench`
directly (not the pooled game page - there is no floor or reset to hold a snapshot against on that route)
and asserts every cell in the grid has enough changed pixels against its own background to be a figure, not
a blank cell. It writes no PNG unless `GAME_TEST_CAPTURE=1`.

The bench's ground, lights and camera approximate the game's own closely enough to judge a change by, but
it is not the renderer the game ships with - no fog, no torchlight, no room mood, no paving texture. It is
an approximation for fast iteration; `shots:compare` stays the judge of what actually ships.

## The palette, measured

`tests/browser/art-direction.spec.ts` holds `docs/art-direction.md` to its own rules, off the rendered
canvas in CIE Lab rather than off the constants in `ROOM_MOOD`. What a mark is worth on screen is what
survives the key light, the fog, the weathering shader and ACES, and none of those are visible from a
palette table — a version of this that compared constants passed through a round in which four fifths
of the bright pixels in two of three chambers were rendering under a quarter saturation.

Two measurements, both taken by copying the framebuffer in the same task as the draw. The renderer is
built without `preserveDrawingBuffer`, so a `drawImage` straight after a synchronous
`advanceTime(0, true)` is inside the window where the buffer still exists and a screenshot decoded
afterwards is not.

- **What a chamber is lit by.** The top half per cent of the frame by chroma, averaged. Its hue has to
  be within forty degrees of the family's fire at chroma 26 or better, which is the document's second
  rule stated as a number: what is burning is the most saturated thing in the frame.
- **What the tell is worth.** Each chamber is drawn twice, once with the body at rest and once at the
  top of its tell, and the frames are differenced. The pixels the mark covers are exactly the pixels
  that changed, so nothing has to know where a ground decal landed on screen. The mark has to be a
  mean ΔE of 25 from the stone under it, and its own core — the pixels it changed most, as against its
  antialiased hem — within eighteen degrees of `THREAT` at chroma 45, in every family. That second
  assertion is the regression guard for drawing the arc additively, which lets the paving underneath
  set the mark's hue and rendered the same constant as dusty pink over violet slate and muddy orange
  over teal.

`dungeonTest.teleport` snaps the mood rather than sliding it, so a driver that jumps into a chamber to
photograph it is not catching the lights still on their way there, and `render_game_to_text` carries a
`mood` block: the room graph cannot say which family is lighting a frame, because on the approach the
answer is genuinely neither room's.

## Numbers from the last pass

Measured on a dev build, 1346×1282 canvas, ~2700–4800 floor tiles.

- Simulation: 0.1–0.6 ms per frame. Simulation plus draw submission: 1.2–2.2 ms. Steady state is
  vsync-bound, not CPU-bound.
- Floor build: 20–42 ms after warm-up (was 100–125 ms), first build ~75 ms.
- Live geometries: 46–54 regardless of floor depth, because skeleton and prop shapes are shared.
