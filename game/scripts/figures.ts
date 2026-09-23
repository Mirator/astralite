// The figure bench, from the command line (plan 012 Stage C). Opens /bench, waits for it to draw, and
// screenshots the canvas - the whole point being that an agent can run this after touching a spec in
// dungeon-knight.ts or dungeon-skeleton.ts and see the result in seconds, not a shots:compare run.
//
//   npm run figures                                     every figure, every facing, Tideblade
//   npm run figures -- --figures knight --weapon all     the knight alone, once per arm
//   npm run figures -- --zoom 1.3 --bg grey
//
// Any flag is passed straight through to /bench's own query string (see dungeon-bench.tsx for what it
// reads): figures, weapon, zoom, bg. GAME_TEST_PORT picks the dev server port (default 3200, this plan's
// port); GAME_TEST_GL=d3d11 renders on the machine's GPU instead of SwiftShader, the same flag the browser
// suite honours, read the same way playwright.config.ts does.
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('../', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.GAME_TEST_PORT ?? 3200);
const BASE_URL = `http://${HOST}:${PORT}`;
const OUT_DIR = resolve(GAME, 'outputs', 'figures');

const bench = new URLSearchParams();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = argv[i + 1];
  const value = next !== undefined && !next.startsWith('--') ? argv[++i]! : '1';
  bench.set(key, value);
}

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
  const t0 = performance.now();
  const reused = await portBusy(PORT);
  let server: ChildProcess | null = null;
  if (reused) {
    console.log(`  figures: reusing the dev server already on ${BASE_URL}`);
  } else {
    console.log(`  figures: starting a dev server on ${BASE_URL}`);
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
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
    const url = `${BASE_URL}/bench${bench.size ? `?${bench.toString()}` : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __bench?: string }).__bench === 'ready', { timeout: 20_000 });
    const canvas = page.locator('canvas');

    mkdirSync(OUT_DIR, { recursive: true });
    const latest = join(OUT_DIR, 'latest.png');
    const previous = join(OUT_DIR, 'previous.png');
    if (existsSync(latest)) renameSync(latest, previous);
    await canvas.screenshot({ path: latest });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stamped = join(OUT_DIR, `${timestamp}.png`);
    await canvas.screenshot({ path: stamped });

    const seconds = (performance.now() - t0) / 1000;
    console.log(`  figures: wrote`);
    console.log(`    ${latest}`);
    if (existsSync(previous)) console.log(`    ${previous}`);
    console.log(`    ${stamped}`);
    console.log(`  figures: ${seconds.toFixed(1)}s (${reused ? 'warm' : 'cold, dev server included'})`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
