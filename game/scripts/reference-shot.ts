// Reference-art screenshot harness (plan 014, lever 1).
//
// Boots its own dev server on GAME_TEST_PORT (default 3100), drives the real game through
// Playwright/Chromium exactly the way tests/browser/helpers.ts does, and writes a PNG into the
// directory given as the sole CLI argument:
//
//   node --experimental-strip-types scripts/reference-shot.ts <outDir>
//
// - torch-room.png     a torchlit chamber with braziers and a pack of guards
//
// It used to write combat-bridge.png and corridor.png too; plan 017 took the bridges and corridors out.
//
// The floor is pinned to seed 0x1 (the same seed tests/browser/shots.spec.ts uses for its warden-chamber
// scene) via the identical crypto.getRandomValues stub the browser suite uses, so
// every round of this harness films the same geometry, the same spawns and the same everything else -
// only the renderer's own output can differ from round to round. `dungeon-floor.ts`'s `generateFloor`
// is pure and deterministic given that seed, so the exact same geometry is recomputed here, offline, in
// node, to find room centres without needing a live page for it.
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
import { generateFloor, TILE } from '../app/dungeon-floor.ts';

const GAME = fileURLToPath(new URL('../', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.GAME_TEST_PORT ?? 3100);
const BASE_URL = `http://${HOST}:${PORT}`;
const SEED = 0x1;

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

    console.log(`  reference-shot: wrote torch-room.png to ${outDir}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
