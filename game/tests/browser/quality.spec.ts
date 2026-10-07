import { enterKeep, expect, type GameWindow, test, WARM_UP } from './helpers.ts';

// Adaptive quality, in real time. The rule (which rung, after how many slow windows, never back up) is held in node by
// tests/dungeon-quality.test.ts; this holds the wiring: that the running game feeds the governor its drawn frames and
// that each rung it lands on reaches the passes and the renderer. Nothing is faked: `?adapt=full` starts the keep at
// full quality with the governor on, and a software rasteriser cannot hold that, so the governor steps down for real.
// It must never call `advanceTime`, which stops the real loop the governor is fed from.
// A dense screen, so the pixel-ratio rung is on the ladder; a small one, so the walk costs seconds rather than minutes. At
// 1280 x 720 and ratio 1.75 one full-quality frame took about 8 s on SwiftShader (sandbox, 2026-10-07), and a rung needs
// sixteen of them; every rung here is still far slower than the governor's 22 ms line.
test.use({ isolate: true, deviceScaleFactor: 2, viewport: { width: 320, height: 240 } });
test.describe.configure({ timeout: 240_000 + WARM_UP });

type Stage = { ao: boolean; bloom: boolean; pixelRatio: number; adaptive: boolean };
// The rung alone: the composer's buffer width is read separately, since it follows the viewport too.
const rung = ({ ao, bloom, pixelRatio, adaptive }: Stage) => ({ ao, bloom, pixelRatio, adaptive });

test('a keep too slow to hold steps down rung by rung, GTAO first, then the pixel ratio, then bloom', async ({ page }) => {
  // `boot=eager` builds the floor behind the title, which is when the hooks go up.
  await page.goto('/?adapt=full&boot=eager');
  await page.waitForFunction(() => {
    const hook = (window as GameWindow).render_game_to_text;
    return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
  }, undefined, { timeout: WARM_UP });
  const full = () => page.evaluate(() => (JSON.parse((window as GameWindow).render_game_to_text!()) as { render: { stage: Stage & { buffer: number } } }).render.stage);
  const stage = async () => rung(await full());
  // Precondition: the keep starts at full quality on a dense screen, with the governor on - or there is nothing to step down from.
  expect(await stage(), 'the keep did not start at full quality, pixel ratio 1.75, adaptive').toEqual({ ao: true, bloom: true, pixelRatio: 1.75, adaptive: true });

  // Every distinct stage the snapshot shows, in order, read once an animation frame from inside the page.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { stagesSeen: string[] }).stagesSeen = seen;
    const read = () => {
      const { ao, bloom, pixelRatio, adaptive } = (JSON.parse((window as GameWindow).render_game_to_text!()) as { render: { stage: { ao: boolean; bloom: boolean; pixelRatio: number; adaptive: boolean } } }).render.stage;
      const now = JSON.stringify({ ao, bloom, pixelRatio, adaptive });
      if (seen[seen.length - 1] !== now) seen.push(now);
      requestAnimationFrame(read);
    };
    read();
  });
  await enterKeep(page);
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
  const bottom = { ao: false, bloom: false, pixelRatio: 1, adaptive: true };
  await expect.poll(stage, { message: 'the governor never reached the bottom rung on a software rasteriser', timeout: 240_000, intervals: [1_000] }).toEqual(bottom);
  const seen = await page.evaluate(() => (window as unknown as { stagesSeen: string[] }).stagesSeen.map(s => JSON.parse(s) as Stage));
  expect(seen, 'the stages were not walked one rung at a time in the ladder\'s order').toEqual([
    { ao: true, bloom: true, pixelRatio: 1.75, adaptive: true },
    { ao: false, bloom: true, pixelRatio: 1.75, adaptive: true },
    { ao: false, bloom: true, pixelRatio: 1, adaptive: true },
    bottom,
  ]);
  // The frame really is drawn at the lower ratio: the canvas's backing store and the post chain's own buffers are the CSS size, not 1.75 times it.
  const canvas = await page.evaluate(() => { const c = document.querySelector('.game-canvas canvas') as HTMLCanvasElement; return { width: c.width, css: c.clientWidth }; });
  expect(canvas.css, 'precondition: the canvas has a width to compare').toBeGreaterThan(0);
  expect(canvas.width, 'the renderer reports pixel ratio 1 but the canvas was not resized to it').toBe(canvas.css);
  expect((await full()).buffer, 'the canvas dropped to ratio 1 but the post chain still renders at 1.75').toBe(canvas.css);
});
