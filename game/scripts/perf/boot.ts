// Stage 0 probe (plan 015): a Playwright *script*, not a test - nothing in CI runs this, because timings
// on SwiftShader say nothing about a player's own GPU. It measures, on the machine's real renderer, what
// a visit costs before ENTER is pressed and what pressing it costs: long tasks and shader compiles while
// idle (target 1), the long tasks and wall time from the press to the keep on screen (targets 2 and 3),
// what `render_game_to_text` reports once it exists, and the steady-state per-frame cost under a
// driver's clock.
//
//   npm run perf:boot -- --url http://127.0.0.1:3000            warm
//   npm run perf:boot -- --url http://127.0.0.1:3000 --cold     forces a shader-cache miss
//
// Point --url at a production build when one can be served locally (`npm run build`, then `npm start`,
// or a static server over dist/client - see AGENTS.md); the dev server works for a same-side comparison
// when it can't. GAME_TEST_GL is not read here: the probe always drives the machine's real GPU, the same
// launch arguments playwright.config.ts uses for GAME_TEST_GL=d3d11 - a software rasteriser's durations
// are exactly what this probe is not for (see the header of frame-budget.spec.ts).
//
// A single Chromium launch does two passes, not one. Chrome keeps one GPU process for the whole browser
// (every tab and every navigation in it shares that process's shader cache), so the first pass - an
// ordinary boot and press, on the real, untagged shader sources - exists only to prime that cache and its
// own numbers are thrown away: a fresh launch has nothing cached yet and would otherwise measure "cold"
// whether --cold was passed or not. The page then navigates again (a second document, same process) for
// the pass that is actually reported. Warm reloads on the same untagged sources the first pass already
// primed. Cold reloads with `?perfcold=1`, which the init script below reads to decide whether to tag
// every `shaderSource` with a nonce - so this pass, alone, misses the cache the first pass just filled,
// the same way a returning player's cache misses the one shader a deploy just touched.
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const url = flag('url');
const cold = argv.includes('--cold');
if (!url) {
  console.error('usage: npm run perf:boot -- --url <url> [--cold]');
  process.exit(2);
}

const GL_ARGS = ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu'];
// Every run raises the same floor 1, so the programs/buildMs/triangle counts a run reports are
// comparable across cold and warm and across a before/after pair - a real random seed would make a
// bigger or smaller floor a confound. This script never loads tests/browser/helpers.ts, so the same
// getRandomValues interception it uses is repeated here rather than shared.
const PINNED_SEED = 0x51ea7;
const IDLE_MS = 3000;
const FRAMES = 60;
const COLD_PARAM = 'perfcold';

type LongTask = { start: number; duration: number };
type Pass = {
  hookExistsAfterIdle: boolean;
  longTasksBeforePress: number;
  longestTaskBeforePress: number;
  taskDurationsBeforePress: number[];
  compilesBeforePress: number;
  veilSeen: boolean;
  longTasksPressToKeep: number;
  longestTaskPressToKeep: number | null;
  pressToKeepMs: number;
  buildMs: Record<string, number> | null;
  programs: number | null;
  warmUp: Record<string, number> | null;
  frameMs: number[];
};

async function main() {
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

    // Registered once; it re-runs on every navigation this page makes; reading `location.search` fresh
    // each time is what lets the two passes below ask for different behaviour without re-registering
    // (and thereby stacking) a second copy of these patches on the reload.
    await page.addInitScript((seed: number) => {
      const w = window as unknown as {
        __probe: { longTasks: { start: number; duration: number }[]; compiles: number };
      };
      w.__probe = { longTasks: [], compiles: 0 };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            w.__probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        /* this engine has no longtask support */
      }

      // The single word buildFloor draws, pinned so every pass raises the identical floor 1.
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

      const proto = (window as unknown as { WebGL2RenderingContext?: { prototype: Record<string, unknown> } })
        .WebGL2RenderingContext?.prototype;
      if (proto) {
        const compileShader = proto.compileShader as (this: WebGL2RenderingContext, shader: WebGLShader) => void;
        proto.compileShader = function (this: WebGL2RenderingContext, shader: WebGLShader) {
          w.__probe.compiles++;
          return compileShader.call(this, shader);
        };
        if (new URLSearchParams(location.search).get('perfcold') === '1') {
          let nonce = 0;
          const shaderSource = proto.shaderSource as (
            this: WebGL2RenderingContext,
            shader: WebGLShader,
            source: string,
          ) => void;
          proto.shaderSource = function (this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
            const tag = `// perf-boot-cold-${nonce++}\n`;
            const tagged = source.startsWith('#version')
              ? source.replace(/^(#version[^\n]*\n)/, `$1${tag}`)
              : tag + source;
            return shaderSource.call(this, shader, tagged);
          };
        }
      }
    }, PINNED_SEED);

    const runPass = async (navUrl: string): Promise<Pass> => {
      await page.goto(navUrl, { waitUntil: 'load' });
      await page.waitForTimeout(IDLE_MS);

      const beforePress = await page.evaluate(() => {
        const w = window as unknown as {
          __probe: { longTasks: { start: number; duration: number }[]; compiles: number };
          render_game_to_text?: unknown;
        };
        return {
          longTasks: w.__probe.longTasks.length,
          longestTask: w.__probe.longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
          durations: w.__probe.longTasks.map((task) => +task.duration.toFixed(1)),
          compiles: w.__probe.compiles,
          hookExists: typeof w.render_game_to_text === 'function',
        };
      });

      const enter = page.locator('.intro-screen .primary-action');
      await enter.waitFor({ state: 'visible', timeout: 30_000 });
      // Observed rather than waited-for-then-timed-out: a build that finished silently before the press
      // (today's bug, pre-Stage-A) never inserts a veil at all, and a `waitFor({state:'attached'})` with
      // any timeout short of forever would just sit out its own timeout on that path and add exactly that
      // much to the wall time this is trying to measure. A MutationObserver installed in the same task as
      // the click sees the veil the instant it lands, if it ever does, and costs nothing when it does not.
      const preClickTasks = await page.evaluate(() => {
        const w = window as unknown as { __probe: { longTasks: unknown[]; veilSeen: boolean } };
        w.__probe.veilSeen = false;
        new MutationObserver(() => {
          if (document.querySelector('.loading-veil')) w.__probe.veilSeen = true;
        }).observe(document.body, { childList: true, subtree: true });
        return w.__probe.longTasks.length;
      });
      const pressStart = Date.now();
      await enter.click();
      await page.locator('.intro-screen').waitFor({ state: 'hidden', timeout: 120_000 });
      const pressToKeepMs = Date.now() - pressStart;
      const veilSeen = await page.evaluate(
        () => (window as unknown as { __probe: { veilSeen: boolean } }).__probe.veilSeen,
      );

      const afterPress = await page.evaluate((from: number) => {
        const w = window as unknown as {
          __probe: { longTasks: LongTask[] };
          render_game_to_text?: () => string;
        };
        const slice = w.__probe.longTasks.slice(from);
        const longest = slice.reduce((max, task) => Math.max(max, task.duration), 0);
        const snapshot = w.render_game_to_text
          ? (JSON.parse(w.render_game_to_text()) as {
              buildMs?: Record<string, number>;
              render?: { programs?: number; warmUp?: Record<string, number> };
            })
          : null;
        return {
          taskCount: slice.length,
          longestTask: slice.length ? longest : null,
          buildMs: snapshot?.buildMs ?? null,
          programs: snapshot?.render?.programs ?? null,
          warmUp: snapshot?.render?.warmUp ?? null,
        };
      }, preClickTasks);

      const frameMs = await page.evaluate((n: number) => {
        const w = window as unknown as { advanceTime?: (ms: number, draw?: boolean) => void };
        const canvas = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
        const pixel = new Uint8Array(4);
        const times: number[] = [];
        for (let i = 0; i < n; i++) {
          const start = performance.now();
          w.advanceTime!(16.7, true);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          times.push(performance.now() - start);
        }
        return times;
      }, FRAMES);

      return {
        hookExistsAfterIdle: beforePress.hookExists,
        longTasksBeforePress: beforePress.longTasks,
        longestTaskBeforePress: beforePress.longestTask,
        taskDurationsBeforePress: beforePress.durations,
        compilesBeforePress: beforePress.compiles,
        veilSeen,
        longTasksPressToKeep: afterPress.taskCount,
        longestTaskPressToKeep: afterPress.longestTask,
        pressToKeepMs,
        buildMs: afterPress.buildMs,
        programs: afterPress.programs,
        warmUp: afterPress.warmUp,
        frameMs,
      };
    };

    console.log(`\n  perf:boot priming pass -> ${url} (untagged sources, to fill the process's GPU cache)`);
    await runPass(url!);

    const measuredUrl = cold ? `${url}${url!.includes('?') ? '&' : '?'}${COLD_PARAM}=1` : url!;
    const result = await runPass(measuredUrl);

    const sorted = [...result.frameMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    console.log(`\n  perf:boot -> ${url} (${cold ? 'cold' : 'warm'})`);
    console.log(`  hooks present after ${IDLE_MS}ms idle: ${result.hookExistsAfterIdle}`);
    console.log(`  ---------------------------------------------------------------`);
    console.log(`  long tasks before the press          ${result.longTasksBeforePress}`);
    console.log(`  longest task before the press (ms)   ${result.longestTaskBeforePress.toFixed(1)}`);
    console.log(`  task durations before the press (ms) ${result.taskDurationsBeforePress.join(', ')}`);
    console.log(`  compileShader calls before the press ${result.compilesBeforePress}`);
    console.log(`  veil seen                            ${result.veilSeen}`);
    console.log(`  long tasks, press to keep            ${result.longTasksPressToKeep}`);
    console.log(`  longest task, press to keep (ms)     ${result.longestTaskPressToKeep?.toFixed(1) ?? 'n/a'}`);
    console.log(`  press to keep, wall time (ms)        ${result.pressToKeepMs}`);
    console.log(`  render.programs                      ${result.programs ?? 'n/a'}`);
    // Programs each warm-up step still linked (plan 015 Stage C): what the precompile submitted, what
    // the sliced first frame added on first use, and the longest of its per-pass slices.
    console.log(`  render.warmUp                        ${result.warmUp ? JSON.stringify(result.warmUp) : 'n/a'}`);
    console.log(
      `  per-frame ms: median=${median.toFixed(2)} min=${sorted[0]!.toFixed(2)} max=${sorted[sorted.length - 1]!.toFixed(2)}`,
    );
    console.log(`  buildMs: ${JSON.stringify(result.buildMs)}`);
    console.log(`  ---------------------------------------------------------------\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
