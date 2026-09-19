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
  // One worker: every scenario drives the same simulation through manual time,
  // and a second WebGL context on the same machine only adds noise. CI buys its
  // parallelism with more runners instead, one shard each.
  workers: 1,
  // Not for local concurrency — with a single worker there is none. This is what
  // makes `--shard` split test by test instead of file by file, which is the
  // difference between two even shards and a 14/3 split.
  fullyParallel: true,
  // A retry would hide the flake this suite exists to catch.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    actionTimeout: 15_000,
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
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
