// Reference-art screenshot harness (plan 014, lever 1).
//
// Boots its own dev server on GAME_TEST_PORT (default 3100), drives the real game through
// Playwright/Chromium exactly the way tests/browser/helpers.ts does, and writes three PNGs into the
// directory given as the sole CLI argument:
//
//   node --experimental-strip-types scripts/reference-shot.ts <outDir>
//
// - combat-bridge.png  the knight mid-swing on a plank bridge over open water, 3+ enemies close by
// - torch-room.png     a torchlit chamber with braziers and a pack of guards
// - corridor.png       a bare corridor run
//
// The floor is pinned to seed 0x1 (the same seed tests/browser/shots.spec.ts uses for its bridge and
// warden-chamber scenes) via the identical crypto.getRandomValues stub the browser suite uses, so
// every round of this harness films the same geometry, the same spawns and the same everything else -
// only the renderer's own output can differ from round to round. `dungeon-floor.ts`'s `generateFloor`
// is pure and deterministic given that seed, so the exact same geometry is recomputed here, offline, in
// node, to find bridge tiles, room centres and corridor runs without needing a live page for it.
//
// GAME_TEST_GL defaults to d3d11 here (unlike the committed browser suite, which defaults to
// SwiftShader for baseline comparability): this harness only ever compares its own output against
// itself and against the hand-drawn reference, never against a captured baseline, so the fast local
// renderer is the right default. Set GAME_TEST_GL=swiftshader to match the committed suite instead.
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canStand, generateFloor, TILE } from '../app/dungeon-floor.ts';

const GAME = fileURLToPath(new URL('../', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.GAME_TEST_PORT ?? 3100);
const BASE_URL = `http://${HOST}:${PORT}`;
const SEED = 0x1;
const SETTLE = 700;

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node --experimental-strip-types scripts/reference-shot.ts <outDir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const portBusy = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: HOST, port });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => {
      const server = createServer();
      server.once('error', () => done(true));
      server.listen(port, HOST, () => server.close(() => done(false)));
    });
  });

const waitForServer = async (url: string, ms: number) => {
  for (const until = Date.now() + ms; Date.now() < until;) {
    try { const res = await fetch(url); if (res.status < 500) return true; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

/** Lowest-ranked match wins, so the same floor always yields the same spot (mirrors shots.spec.ts). */
const firstBy = <T,>(items: T[], rank: (item: T) => number) =>
  items.map((item) => ({ item, key: rank(item) })).sort((a, b) => a.key - b.key)[0]?.item;

type GameWindow = Window & {
  render_game_to_text?: () => string;
  advanceTime?: (ms: number, draw?: boolean) => void;
  dungeonTest?: {
    teleport: (x: number, z: number) => void;
    configureCombatFixture?: (fixture: {
      enemies?: { index: number; x?: number; z?: number; hp?: number; windup?: number; cooldown?: number }[];
    }) => void;
  };
};

async function main() {
  const busy = await portBusy(PORT);
  if (busy) throw new Error(`port ${PORT} is already in use - stop whatever is on it before running this harness`);

  console.log(`  reference-shot: starting a dev server on ${BASE_URL}`);
  const server: ChildProcess = spawn(
    process.execPath,
    [join(GAME, 'node_modules', 'vinext', 'dist', 'cli.js'), 'dev', '--hostname', HOST, '--port', String(PORT)],
    { cwd: GAME, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  server.stdout?.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  server.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  const up = await waitForServer(BASE_URL, 60_000);
  if (!up) { server.kill(); console.error(log); throw new Error(`dev server on ${BASE_URL} did not come up within 60s`); }

  const args = process.env.GAME_TEST_GL === 'swiftshader'
    ? ['--use-gl=angle', '--use-angle=swiftshader']
    : ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu'];
  const browser = await chromium.launch({ args });
  try {
    const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
    // The same pinned-seed stub tests/browser/helpers.ts installs: the one crypto draw
    // `generateFloor`'s caller makes for floor 1 returns SEED, and nothing else about
    // `crypto.getRandomValues` is touched.
    await page.addInitScript((seed: number) => {
      const source = crypto;
      const original = source.getRandomValues.bind(source);
      const pinnedDraw = (array: Parameters<Crypto['getRandomValues']>[0]) => {
        if (array instanceof Uint32Array && array.length === 1) { array[0] = seed >>> 0; return array; }
        return original(array);
      };
      Object.defineProperty(source, 'getRandomValues', { configurable: true, writable: true, value: pinnedDraw });
    }, SEED);
    page.on('pageerror', (error) => console.error('  reference-shot: page error:', String(error)));

    await page.goto(BASE_URL);
    await page.waitForFunction(() => typeof (window as GameWindow).render_game_to_text === 'function', { timeout: 30_000 });
    console.log('  reference-shot: hooks are up, waiting for the loading veil to clear...');
    await page.locator('.loading-veil').waitFor({ state: 'detached', timeout: 120_000 });
    console.log('  reference-shot: veil cleared');

    const enterButton = page.locator('.intro-screen .primary-action');
    await enterButton.waitFor({ state: 'visible' });
    await enterButton.click();
    await page.locator('.intro-screen').waitFor({ state: 'hidden' });

    const evalState = () => page.evaluate(() => JSON.parse((window as GameWindow).render_game_to_text!()));
    const teleport = (x: number, z: number) => page.evaluate(({ x, z }) => (window as GameWindow).dungeonTest!.teleport(x, z), { x, z });
    const step = (ms: number, draw = false) => page.evaluate(({ ms, draw }) => (window as GameWindow).advanceTime!(ms, draw), { ms, draw });
    const act = (detail: string) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail })), detail);
    type CombatFixture = { enemies?: { index: number; x?: number; z?: number; hp?: number; windup?: number; cooldown?: number }[] };
    const configureCombat = (fixture: CombatFixture) =>
      page.evaluate((fixture) => (window as GameWindow).dungeonTest!.configureCombatFixture!(fixture), fixture);
    const canvas = page.locator('.game-canvas canvas');
    // Plan 014 round B: turn the knight to a three-quarter front view (facing screen down-right, toward
    // the camera) with real keyboard input - one frame of the diagonal held, which sets his facing and
    // moves him a few centimetres, then released and given time for the body to finish turning. Without
    // this he spent every shot with his back to the lens and the visor was never seen.
    const faceCamera = async () => {
      await page.keyboard.down('ArrowDown'); await page.keyboard.down('ArrowRight');
      await step(1000 / 60);
      await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
      await step(400);
      return ((await evalState()) as { player: { x: number; z: number; facing: { x: number; z: number } } }).player;
    };

    await step(0);
    const firstState = (await evalState()) as { floor: { seed: number } };
    if (firstState.floor.seed !== (SEED >>> 0)) {
      throw new Error(`the pinned seed did not take - floor seed is ${firstState.floor.seed}, expected ${SEED >>> 0}`);
    }

    // The pure floor, recomputed offline from the same seed, for exact tile/spawn coordinates -
    // see the header comment for why this is safe.
    const floor = generateFloor(SEED, 1);

    // ---- combat-bridge.png: knight mid-swing on a plank bridge, water on both sides, 3+ enemies ----
    {
      const woodSet = new Set(floor.tiles.filter((t) => t.wood).map((t) => `${t.x},${t.z}`));
      const isWood = (x: number, z: number) => woodSet.has(`${x},${z}`);
      // Walk a straight run of wood tiles as far as it goes in one direction.
      const runLength = (x: number, z: number, dx: number, dz: number) => {
        let n = 0, cx = x + dx, cz = z + dz;
        while (isWood(cx, cz)) { n++; cx += dx; cz += dz; }
        return n;
      };
      const planks = floor.tiles.filter((tile) => tile.wood && canStand(floor.cells, tile.x * TILE, tile.z * TILE));
      // A clean single-width span, well inside a long run rather than at an end or a dock junction:
      // wood extends both ways along one axis (the run), water sits on both sides of the other axis
      // (the width) - which is what puts open water in frame left and right of the knight, the way
      // the reference's own bridge shot is composed - and the two run-lengths are close to equal, so
      // the spot sits near the run's own middle rather than near either bank.
      const candidates = planks.map((tile) => {
        const alongX = runLength(tile.x, tile.z, 1, 0), backX = runLength(tile.x, tile.z, -1, 0);
        const alongZ = runLength(tile.x, tile.z, 0, 1), backZ = runLength(tile.x, tile.z, 0, -1);
        const runX = alongX + backX + 1, runZ = alongZ + backZ + 1;
        const throughX = runX >= runZ;
        const along = throughX ? alongX : alongZ, back = throughX ? backX : backZ;
        const runLen = throughX ? runX : runZ;
        const clean = throughX ? !isWood(tile.x, tile.z + 1) && !isWood(tile.x, tile.z - 1) : !isWood(tile.x + 1, tile.z) && !isWood(tile.x - 1, tile.z);
        return { tile, runLen, centring: Math.abs(along - back), clean };
      }).filter((c) => c.clean && c.runLen >= 6);
      const middle = firstBy(candidates.length ? candidates : candidates, (c) => -c.runLen * 1e3 + c.centring)?.tile
        ?? firstBy(planks, (tile) => -planks.filter((other) => Math.abs(other.x - tile.x) <= 3 && Math.abs(other.z - tile.z) <= 3).length * 1e6 + tile.x * 1e3 + tile.z);
      if (!middle) throw new Error('seed 0x1 no longer lays a plank bridge');
      const spot = { x: middle.x * TILE, z: middle.z * TILE };
      await teleport(spot.x, spot.z);
      await step(0);
      const knight = await faceCamera();
      // Plan 014 round B: the one enemy he strikes stands where he now faces, so the swing that lands
      // is also the one that shows his front. Nearest standable tile centre to a point 1.5 ahead.
      const ahead = { x: knight.x + knight.facing.x * 1.5, z: knight.z + knight.facing.z * 1.5 };
      const victim = firstBy(floor.tiles.filter((tile) => canStand(floor.cells, tile.x * TILE, tile.z * TILE) && Math.hypot(tile.x * TILE - knight.x, tile.z * TILE - knight.z) > 1),
        (tile) => Math.hypot(tile.x * TILE - ahead.x, tile.z * TILE - ahead.z));
      // Three standable tiles spread near, mid and far rather than clustered on top of the knight -
      // the reference's own fight has bodies at staggered depth, not a huddle.
      const nearby = floor.tiles
        .filter((tile) => canStand(floor.cells, tile.x * TILE, tile.z * TILE))
        .map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE, d: Math.hypot(tile.x * TILE - spot.x, tile.z * TILE - spot.z) }))
        .filter((p) => p.d > 1.4 && p.d < 9)
        .sort((a, b) => a.d - b.d);
      const picks = [0, Math.floor(nearby.length * 0.45), Math.floor(nearby.length * 0.85)]
        .map((i) => nearby[Math.min(i, nearby.length - 1)]).filter((p): p is NonNullable<typeof p> => !!p);
      const enemyCount = (await evalState() as { enemies: unknown[] }).enemies.length;
      const moved = Math.min(3, enemyCount, picks.length);
      if (moved < 3) console.warn(`  reference-shot: only ${moved} enemies available to stage around the bridge`);
      if (victim) picks[0] = { x: victim.x * TILE, z: victim.z * TILE, d: 0 };
      await configureCombat({
        enemies: Array.from({ length: moved }, (_, i) => ({ index: i, x: picks[i].x, z: picks[i].z, cooldown: 8, windup: 0 })),
      });
      // Real distance-based noticing, same as shots.spec.ts's flooded-hall scene: close enough,
      // long enough, and the watch wakes and closes on its own.
      await step(900);
      await act('attack');
      // Plan 014 round 8 (lever 3): 110ms was well inside the swing but well short of the trail's own
      // .14s lifetime - the ribbon had only been accumulating for 110ms of a 140ms window, so it was
      // never at the full length it is capable of. 165ms sits inside the same 65-175ms landing window
      // the original comment measured, but late enough that close to the whole lifetime's worth of
      // blade motion is in the buffer, and it lands just after the hit registers, so a blood burst
      // (see dungeon-game.tsx's swing-hit branch) is caught in flight too.
      await step(200);
      await step(0, true);
      await canvas.screenshot({ path: join(outDir, 'combat-bridge.png') });
      const after = await evalState() as { enemies: { awake: boolean }[]; player: { attackTime: number } };
      console.log(`  reference-shot: combat-bridge - victim=${victim ? `${victim.x},${victim.z}` : 'none'} facing=${knight.facing.x.toFixed(2)},${knight.facing.z.toFixed(2)}`);
      console.log(`  reference-shot: combat-bridge - awake=${after.enemies.filter((e) => e.awake).length}/${after.enemies.length} attackTime=${after.player.attackTime.toFixed(3)}`);
    }

    // ---- torch-room.png: a torchlit chamber with braziers and a pack of guards ----
    {
      const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
      const hall = floor.rooms
        .filter((room) => room.encounter !== 'ambush')
        .map((room) => ({ room, spawns: floor.spawns.filter((s) => s.room === room.id).length, braziers: braziers.filter((b) => b.room === room.id).length }))
        .filter((r) => r.spawns >= 3 && r.braziers >= 2)
        .sort((a, b) => b.spawns - a.spawns)[0];
      if (!hall) throw new Error('seed 0x1 no longer holds a torchlit chamber with a guard pack');
      await teleport(hall.room.x * TILE, hall.room.z * TILE);
      await faceCamera();
      await step(500);
      await step(0, true);
      await canvas.screenshot({ path: join(outDir, 'torch-room.png') });
      const after = await evalState() as { enemies: { room: number; awake: boolean }[] };
      const inRoom = after.enemies.filter((e) => e.room === hall.room.id);
      console.log(`  reference-shot: torch-room - ${hall.room.name} awake=${inRoom.filter((e) => e.awake).length}/${inRoom.length}`);
    }

    // ---- corridor.png: a corridor run with a torch or two actually in view, not the darkest one ----
    {
      const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
      const corridor = floor.tiles
        .filter((tile) => tile.room < 0 && canStand(floor.cells, tile.x * TILE, tile.z * TILE))
        .map((tile) => ({ tile, near: Math.min(...braziers.map((b) => Math.hypot(b.x - tile.x, b.z - tile.z) * TILE)) }));
      // Plan 014 round 3 (lever C7): this used to pick the tile *furthest* from any brazier on
      // purpose, to prove the corridor read as a corridor with nothing lighting it - which is exactly
      // what a critic then read as a mostly-black frame. A corridor close enough to a brazier that its
      // pool of light actually reaches into frame, without standing inside the room the brazier
      // belongs to, is the shot that is still recognisably a passage and is not mostly void.
      const lit = firstBy(corridor, ({ tile, near }) => Math.abs(near - 5) + tile.x * 1e-3 + tile.z * 1e-3);
      if (!lit) throw new Error('seed 0x1 has no corridor tile left');
      await teleport(lit.tile.x * TILE, lit.tile.z * TILE);
      await faceCamera();
      await step(SETTLE - 400);
      await step(0, true);
      await canvas.screenshot({ path: join(outDir, 'corridor.png') });
      console.log(`  reference-shot: corridor - ${lit.near.toFixed(1)} units from the nearest brazier`);
    }

    console.log(`  reference-shot: wrote combat-bridge.png, torch-room.png, corridor.png to ${outDir}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
