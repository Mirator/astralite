# Testing the Drowned Keep

Two layers: a node suite over the pure modules, and hooks the running game exposes so a browser
console (or an automated driver) can steer a run without playing it by hand.

## Node suite

```bash
npm test
```

Runs `tests/*.test.ts` through node's type stripping — no build step, no DOM. It covers the four
pure modules:

- **The floor generator** (`dungeon-floor.ts`): the room graph is a tree, every room is reachable, the
  stair sits at the end of the trunk, dead ends are stubs, corridors never bypass the trunk, guards
  spawn on walkable floor, the gate is safe, quiet halls never come in pairs, deeper floors are meaner,
  and generation stays fast enough to rebuild a floor mid-run.
- **The run simulation** (`dungeon-sim.ts`): the rank ladder, every boon, the damage and
  invulnerability rules, kill rewards, the boon draft and the stair dwell.
- **The spatial rules** (`dungeon-enemy.ts`): the activation cutoff, pursuit steps off the flood map,
  when a windup starts and whether the committed swing connects, the stalker pounce and its swept
  contact test, and the crowd-separation pass. Collision itself (`canStand`, `moveOnFloor`) is covered
  alongside the generator in `dungeon-floor.test.ts`: sliding, diagonal gaps, tunnelling and body
  radius.
- **Persistence** (`dungeon-save.ts`), described under Persistence below.

Anything involving three.js, the DOM or input is **not** covered here — use the browser hooks.

### Where an enemy decision lives

`dungeon-enemy.ts` decides *what* a body does; `dungeon-game.tsx` does it. `decideEnemy` takes a plain
snapshot of one enemy (kind, position, room, cooldown, hitFlash, windup, lunge, tell, speed, aim), the
knight's position, the floor's walkable cells plus the flood distances, and a frame delta, and returns an
`EnemyIntent` — `act` (`inert` / `lunge` / `windup` / `ready`), the new position and timers, the yaw to
face, whether the blow connects and which cue to sound. It mutates nothing. The renderer keeps the
`THREE.Group`, limb and weapon poses, audio, particles, emissive flashes, health bars and telegraphs —
all of which consume the intent rather than deciding it. `separateCrowd` is the same deal for the
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
`--grep-invert "@capture|@nightly"` unless a capture run was asked for, and the nightly isolated run
(`isolated.yml`) runs everything.

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

The game installs these on `window` once floor 1 has been built, which happens behind the menu a couple of
frames after the page mounts (every hook reads the floor, so none is up before it exists). Wait for
`render_game_to_text` to be a function before using any of them. They are meant for the console and for
automated drivers; nothing in the game itself calls them.

| Hook | What it does |
| --- | --- |
| `render_game_to_text()` | JSON snapshot: mode, `building` (a floor build pending behind the loading veil), health, rank, boons, objective, floor, enemies, `buildMs`, `render` counters, `settings`, `camera` |
| `advanceTime(ms, draw = true)` | Steps the simulation deterministically. **The normal rAF loop stops after the first call** — reload to get it back |
| `dungeonTest.teleport(x, z)` | Moves the knight in world units (`tileX * TILE`) |
| `dungeonTest.descend()` | Takes the stair without fighting, capped at the last floor |
| `dungeonTest.buildFloor(level)` | Rebuilds the floor at any level, including past the last one |
| `dungeonTest.grantXp(amount)` | Awards XP, so the boon draft can be reached in one line |
| `dungeonTest.runLog()` | The stored history of finished runs, oldest first — re-read and re-validated on every call |

`dungeonTest.runLog()` is how a balance question stops being a memory: `copy(JSON.stringify(window.dungeonTest.runLog()))`
gives every finished run since the log was capped, each one `{ at, floor, won, cause, seconds, rank, xp, kills, boons, seed }`,
so deaths can be counted per floor and per `cause` (`guard` / `stalker` / `warden` / `hazard`, null on a win)
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
Other useful details: `attack`, `dash`, `pause`, `move:up|down|left|right`, `stop:…`, `stick:<x>,<y>`,
`stick:off`, `boon:<id>`, `restart`, `restart:<seed>`.

`stick:<x>,<y>` is the touch thumbstick's analog path: a screen-space direction (`x` right, `y` down) on the
same basis the four `move:` directions build, so `stick:0.707,-0.707` is up-and-right and `stick:0,0` is a
planted thumb holding still. `stick:off` releases it, as does any value that does not parse. A live stick
outranks `move:`, and only for as long as it is live — releasing it hands steering straight back to whatever
`move:` keys are still held, and neither path ever clears the other's state.

`start` is ENTER THE KEEP: pressed before floor 1 exists it is held behind the loading bar and answered
the frame the keep is drawn. `start:<seed>` is the menu's LAST KEEP, entering the floor 1 a previous
visit left.

`restart` resets the whole run in place — health, rank, boons, XP, kills, input — and rebuilds floor 1
from a fresh seed; no page reload, so the `AudioContext`, the GPU context and the `window` hooks all
survive it. `restart:<seed>` does the same but replays that exact floor 1 (`render_game_to_text().floor.seed`
reports the current one), which makes a deterministic run reproducible from the console:

```js
const seed = JSON.parse(window.render_game_to_text()).floor.seed;
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: `restart:${seed}` }));
```

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

Four `localStorage` keys, `drowned-keep:best`, `drowned-keep:seed`, `drowned-keep:runs` and
`drowned-keep:settings`, hold the deepest run (XP breaks a tie on the same floor), the current run's
floor-1 seed, the last 100 finished runs, and what the player asked the game to be. Nothing leaves the
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

Bindings map nine actions (`up`/`down`/`left`/`right`/`attack`/`dash`/`pause`/`mute`/`fullscreen`) to
`KeyboardEvent.code` lists. Binding a code takes it from whatever held it; if that would leave the other
action with no key at all the two trade instead. `Escape` belongs to pause and can never be bound to
anything else, and the game answers `Escape` with a pause whether or not it is bound — so no rebind can
shut a player out of the menu that would undo it. The `preventDefault` list follows the bindings: a
browser key (space, arrows, page keys) is swallowed only while something is bound to it.

`Touch<action>` slots in the held-key set belong to the touch controls alone and are never part of a
binding, so `move:`/`stop:`/`hold-attack` steer identically whatever the keyboard has been set to.

### Recipes

Walk a floor and read the state back:

```js
const S = () => JSON.parse(window.render_game_to_text());
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' }));
const stair = S().floor.rooms[S().floor.goal];
window.dungeonTest.teleport(stair.x * 1.48, stair.z * 1.48);
window.advanceTime(200, false);
S().objective; // { floor, halls, goalDepth, atStair, stairClear, stairOpen, stairDwell, … }
S().stair;     // { x, z, radius, dwell } — the open stair takes the knight after `dwell` seconds standing on it
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
and the run's `run.log`), `diff/`, `summary.json` and the sheet. The diff is `scripts/shots/diff.ts`, the
same one `zz-pixel-diff.spec.ts` reports.

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
