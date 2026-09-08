# Testing the Drowned Keep

Two layers: a node suite over the floor generator, and hooks the running game exposes so a browser
console (or an automated driver) can steer a run without playing it by hand.

## Node suite

```bash
npm test
```

Runs `tests/*.test.ts` through node's type stripping — no build step, no DOM. It covers the floor
generator only: the room graph is a tree, every room is reachable, the stair sits at the end of the
trunk, dead ends are stubs, corridors never bypass the trunk, guards spawn on walkable floor, the
gate is safe, quiet halls never come in pairs, deeper floors are meaner, and generation stays fast
enough to rebuild a floor mid-run.

Anything involving three.js, the DOM or input is **not** covered here — use the browser hooks.

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

Start a run from the console with `window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'start' }))`.
Other useful details: `attack`, `dash`, `pause`, `move:up|down|left|right`, `stop:…`, `boon:<id>`.

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
