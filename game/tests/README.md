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
- **The run simulation** (`dungeon-sim.ts`): the shape of a fresh run, the rank ladder, every boon, the
  damage and invulnerability rules, kill rewards and the room-clear payouts.
- **The spatial rules** (`dungeon-enemy.ts`): the activation cutoff, pursuit steps off the flood map,
  when a windup starts and whether the committed swing connects, the stalker pounce and its swept
  contact test, and the crowd-separation pass. Collision itself (`canStand`, `moveOnFloor`) is covered
  alongside the generator in `dungeon-floor.test.ts`: walls, sliding, diagonal gaps, tunnelling and
  body radius.
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

## Browser hooks

The game installs these on `window` while it is mounted. They are meant for the console and for
automated drivers; nothing in the game itself calls them.

| Hook | What it does |
| --- | --- |
| `render_game_to_text()` | JSON snapshot: mode, health, rank, boons, objective, floor, enemies, `buildMs`, `render` counters |
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

`restart` resets the whole run in place — health, rank, boons, XP, kills, input — and rebuilds floor 1
from a fresh seed; no page reload, so the `AudioContext`, the GPU context and the `window` hooks all
survive it. `restart:<seed>` does the same but replays that exact floor 1 (`render_game_to_text().floor.seed`
reports the current one), which makes a deterministic run reproducible from the console:

```js
const seed = JSON.parse(window.render_game_to_text()).floor.seed;
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: `restart:${seed}` }));
```

### Persistence

Three `localStorage` keys, `drowned-keep:best`, `drowned-keep:seed` and `drowned-keep:runs`, hold the
deepest run (XP breaks a tie on the same floor), the current run's floor-1 seed, and the last 100
finished runs. Nothing leaves the browser. Every read and write is wrapped, and a missing, blocked or
corrupt value reads as absent — the game plays identically with storage disabled, and a single malformed
entry is dropped without costing the rest of the history.
`tests/dungeon-save.test.ts` covers the comparison, the parsing, the cap and the throwing-storage paths.

### Recipes

Walk a floor and read the state back:

```js
const S = () => JSON.parse(window.render_game_to_text());
window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' }));
const stair = S().floor.rooms[S().floor.goal];
window.dungeonTest.teleport(stair.x * 1.48, stair.z * 1.48);
window.advanceTime(200, false);
S().objective; // { floor, halls, goalDepth, atStair, stairClear, … }
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

## Numbers from the last pass

Measured on a dev build, 1346×1282 canvas, ~2700–4800 floor tiles.

- Simulation: 0.1–0.6 ms per frame. Simulation plus draw submission: 1.2–2.2 ms. Steady state is
  vsync-bound, not CPU-bound.
- Floor build: 20–42 ms after warm-up (was 100–125 ms), first build ~75 ms.
- Live geometries: 46–54 regardless of floor depth, because skeleton and prop shapes are shared.
