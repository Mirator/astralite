// Static keep backdrop for the pre-start menu (plan 015 Stage A.3, decision 1(a)): once nothing is built
// before ENTER, the translucent right half of `.intro-screen` has no live keep to show through it any
// more. This writes a single JPEG frame of a fixed seed's floor 1 to game/public/, which the menu shows
// as a low-priority <img> instead. Regenerate whenever the art changes:
//
//   npm run backdrop
//
// Reuses a dev server already on GAME_TEST_PORT (default 3200, this plan's port) or starts one, the same
// way scripts/figures.ts does. GAME_TEST_GL=d3d11 applies the same as everywhere else in this project.
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('../', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.GAME_TEST_PORT ?? 3200);
const BASE_URL = `http://${HOST}:${PORT}`;
const OUT = join(GAME, 'public', 'keep-backdrop.jpg');
// Arbitrary but fixed: DEFAULT_SEEDS[0] in tests/browser/helpers.ts, so the backdrop shows the same
// floor 1 the rest of the suite already treats as "the" reference seed.
const SEED = 0x1;
const QUALITY = 0.8;

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

async function main() {
  const reused = await portBusy(PORT);
  let server: ChildProcess | null = null;
  if (reused) {
    console.log(`  backdrop: reusing the dev server already on ${BASE_URL}`);
  } else {
    console.log(`  backdrop: starting a dev server on ${BASE_URL}`);
    server = spawn(process.execPath, [join(GAME, 'node_modules', 'vinext', 'dist', 'cli.js'), 'dev', '--hostname', HOST, '--port', String(PORT)], {
      cwd: GAME,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    server.stdout?.on('data', (chunk: Buffer) => { log += chunk.toString(); });
    server.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString(); });
    const up = await waitForServer(BASE_URL, 60_000);
    if (!up) {
      server.kill();
      console.error(log);
      throw new Error(`dev server on ${BASE_URL} did not come up within 60s`);
    }
  }

  const args = process.env.GAME_TEST_GL === 'd3d11' ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader'];
  const browser = await chromium.launch({ args });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    // The single word buildFloor draws, pinned so the backdrop always shows the same floor 1.
    await page.addInitScript((seed: number) => {
      const original = crypto.getRandomValues.bind(crypto);
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: (array: Parameters<Crypto['getRandomValues']>[0]) => {
          if (array instanceof Uint32Array && array.length === 1) {
            array[0] = seed >>> 0;
            return array;
          }
          return original(array);
        },
      });
    }, SEED);

    // Reference frames stay at full quality (the baseline reduced/full switch is for a software
    // rasteriser, and this backdrop is meant to look like the game at its best regardless of what drew
    // it). Nothing is built until this presses ENTER (plan 015 Stage A), the same as a real visitor.
    await page.goto(`${BASE_URL}/?quality=full`);
    const enter = page.locator('.intro-screen .primary-action');
    await enter.waitFor({ state: 'visible', timeout: 30_000 });
    await enter.click();
    await page.locator('.intro-screen').waitFor({ state: 'hidden', timeout: 120_000 });

    const dataUrl = await page.evaluate((quality: number) => {
      const w = window as unknown as { advanceTime?: (ms: number, draw?: boolean) => void };
      if (!w.advanceTime) throw new Error('advanceTime is gone');
      // One deterministic draw, and the canvas is read back in the same task: the renderer has no
      // preserveDrawingBuffer, so a toDataURL call after this task would find an empty buffer. Reading
      // the canvas directly (not a full-page screenshot) is what keeps the HUD and the menu itself out
      // of the picture - they are DOM/CSS, not pixels three.js put in this element.
      w.advanceTime(0, true);
      const canvas = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      return canvas.toDataURL('image/jpeg', quality);
    }, QUALITY);

    const bytes = Buffer.from(dataUrl.split(',')[1]!, 'base64');
    mkdirSync(join(GAME, 'public'), { recursive: true });
    writeFileSync(OUT, bytes);
    console.log(`  backdrop: wrote ${OUT} (${(bytes.length / 1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
