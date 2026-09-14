import { defineConfig, devices } from '@playwright/test';

// Loopback only: the dev server must never be reachable from the network, and
// CI must start its own rather than adopting whatever already holds the port.
const HOST = '127.0.0.1';
const PORT = 3000;
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
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
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
