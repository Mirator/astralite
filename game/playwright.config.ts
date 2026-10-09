import { defineConfig, devices } from '@playwright/test';

// Loopback only: the dev server must never be reachable from the network, and
// CI must start its own rather than adopting whatever already holds the port.
const HOST = '127.0.0.1';
// Overridable so several checkouts can verify at once on one machine: the suite
// starts its own server and will not adopt a stranger's, so two runs on one port
// fight over it. Loopback is not negotiable and is not read from the environment.
const PORT = Number(process.env.GAME_TEST_PORT ?? 3000);
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  // One worker by default, because on a developer machine a second WebGL
  // context only takes cores off the first. It is not a correctness constraint:
  // nothing in this suite measures wall-clock time — the clock is stepped by
  // hand, and `frame-budget.spec.ts` holds the renderer's own counters for
  // exactly the reason that a software rasteriser's durations cannot be
  // trusted — so a runner with cores going spare can drive more than one at a
  // time. CI sets `GAME_TEST_WORKERS`; a local run stays at one unless asked.
  workers: Number(process.env.GAME_TEST_WORKERS ?? 1),
  // Mostly not for concurrency — at one worker there is none. This is what
  // makes `--shard` split test by test instead of file by file, which is the
  // difference between even shards and a 14/3 split.
  fullyParallel: true,
  // A retry would hide the flake this suite exists to catch.
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Was 120 s. Plan 026 (D4) took the point-light pool from 8 to 24, which three.js compiles into every lit shader, and a cold page
  // boot under SwiftShader compiles about half as long again (measured 2026-10-08 locally, chain.spec's first scenario on a fresh
  // page: 24.6 s at 8 lights, 37.0 s at 24; later scenarios on the booted page unchanged). On CI's 2-worker shards the pooled page
  // a worker boots after `elites.spec.ts`'s isolated dev-link pages took ~46 s at 8 lights and went past 120 s at 24, failing the next
  // scenario in fixture setup twice in a row (PR #98, `footsteps.spec.ts`). The operator accepted the lights' cost; no scenario's
  // own body got slower, so this is headroom for the boot, not for a hang.
  timeout: 180_000,
  // Was 15s. A scenario that needs its own browser context (any isolated/mobile/touch
  // spec - see `needsOwnPage` in tests/browser/helpers.ts) pays a full fresh page boot:
  // module load, a WebGL context, a first floor, all under CI's 2-worker, CPU-bound
  // SwiftShader rasteriser. As the suite has grown, that cold boot has started missing
  // a 15s budget under ordinary CPU contention from a sibling worker's own heavy
  // scenario - reproduced 4/4 times in a row on an unrelated, unmodified isolated-mobile
  // scenario (`polish.spec.ts`'s phone test) purely from the shard's total load growing,
  // with no change to that scenario itself. 25s gives real slack without hiding a true
  // hang (the per-test ceiling below is still 120s).
  expect: { timeout: 25_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    actionTimeout: 25_000,
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1000, height: 700 },
        // Headless runners have no GPU; ANGLE over SwiftShader keeps WebGL
        // real instead of falling back to a null renderer. Test browser only.
        //
        // A developer machine does have a GPU, and rasterising this scene in
        // software is what makes the suite take twenty minutes. `GAME_TEST_GL`
        // switches the backend for a local run: `d3d11` is roughly an order of
        // magnitude faster. It is deliberately not the default, because the
        // captured images are the backend's output and the reference set was
        // taken on SwiftShader — CI must stay on it so two runs are comparable.
        launchOptions: {
          args:
            process.env.GAME_TEST_GL === 'd3d11'
              ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu']
              : ['--use-gl=angle', '--use-angle=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    // No watcher and no hot reload: the run tests the tree as it was when it started (vite.config.ts).
    env: { GAME_TEST_SERVER: '1' },
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
