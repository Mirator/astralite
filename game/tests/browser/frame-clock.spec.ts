import { expect, type GameWindow, test, WARM_UP } from './helpers.ts';

// This hands the page an older first animation timestamp, which only exists once per load. A fresh load
// pays the cold shader warm-up (see WARM_UP in helpers.ts), so the scenario gets room for it.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

test('an older first animation timestamp cannot create a startup hit pause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    const hooks = window as typeof window & { render_game_to_text?: () => string; staleFrameDelivered?: boolean };
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(now => {
      if (hooks.render_game_to_text && !hooks.staleFrameDelivered) {
        hooks.staleFrameDelivered = true;
        callback(now - 1000);
      } else callback(now);
    });
  });
  // `boot=eager` (plan 015 Stage A, dev-only): this scenario is about the animate loop's own first-frame
  // handling, not about the on-demand boot, so it wants a floor built and warm without spending itself on
  // a press first - the same reason `Game.open` passes it on every `goto`.
  await page.goto('/?boot=eager');
  // The stale frame is delivered on the first animation frame after the hooks go up, which is after a
  // module load and a first floor - the same wait `Game.open` gives the boot's budget.
  await page.waitForFunction(() => (window as typeof window & { staleFrameDelivered?: boolean }).staleFrameDelivered, undefined, { timeout: WARM_UP });
  const state = await page.evaluate(() => {
    const hooks = window as typeof window & { advanceTime: (ms: number, draw: boolean) => void; render_game_to_text: () => string };
    hooks.advanceTime(0, false);
    return JSON.parse(hooks.render_game_to_text());
  });
  expect(state.mode).toBe('ready');
  expect(state.settings.hitStop).toBe(0);
  expect(state.settings.shake).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Plan 015 Stage B, in real time rather than under a driver's clock: this is the one page in the suite
 * that never calls `advanceTime` at all, because the claim under test - a frozen frame is not redrawn -
 * is a claim about the real frame loop deciding not to draw, and `advanceTime` both stops that loop on
 * its first call and draws on request regardless of pause. `render.frames` is the post chain's own count
 * of frames it has actually drawn (`dungeon-post.ts`), so "unchanged across half a second" is the render
 * budget a paused menu screen used to spend on redrawing an identical picture, now spent on nothing.
 */
test('a paused frame is not redrawn in real time, and resumes drawing once unpaused', async ({ page }) => {
  await page.goto('/');
  const enter = page.locator('.intro-screen .primary-action');
  await enter.waitFor({ state: 'visible', timeout: WARM_UP });
  await enter.click();
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });

  const pause = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'pause' })));
  const frames = () => page.evaluate(() => JSON.parse((window as GameWindow).render_game_to_text!()).render.frames as number);

  // Real frames first, so the count this test holds steady is not just the first one drawn. Waited on
  // rather than timed: on a software rasteriser one real frame can take longer than any fixed pause.
  const start = await frames();
  await expect.poll(frames, { message: 'the entered keep never drew a real frame', timeout: WARM_UP }).toBeGreaterThan(start);
  await pause();
  // The pause itself may still draw one more frame (see `dirty` in dungeon-game.tsx), and on software GL
  // that frame can land late. The baseline is taken once two reads a quarter-second apart agree.
  let paused = await frames();
  await expect
    .poll(async () => { const now = await frames(); const settled = now === paused; paused = now; return settled; }, { message: 'the paused frame count never settled', intervals: [250], timeout: 20_000 })
    .toBe(true);
  await page.waitForTimeout(500);
  expect(await frames(), 'a paused frame was redrawn with nothing to show for it').toBe(paused);

  await pause();
  await expect.poll(frames, { message: 'resuming did not start drawing again', timeout: 20_000 }).toBeGreaterThan(paused);
});

/**
 * Plan 015 Stage C fix round, also in real time: a sliced restart swaps `gameStatus` and `floor` in its
 * first slices, while `enemyData`, `atmosphere` and `surfaceIndex` still belong to the old, disposed
 * floor until later phases. `animate` skips `update` and the draw while `building`, and attack, dash
 * and swap are no-ops then, so nothing touches that half-built state. Manual-time tests cannot catch a
 * miss here, because `advanceTime` stops the real loop this bug lived in.
 *
 * `render.frames` may rise by exactly the two warm-up frames `stagedBuild` draws itself (the sliced
 * first frame and the one on screen when the veil lifts). It is sampled on every animation frame while
 * `building` is true, so the last sample is the count at the end of the build - the game draws freely
 * once it is over, and those frames are not this test's business. Attack and dash are pressed on every
 * one of those frames; a press the guard let through would sit in the player's state, since no sim tick
 * runs to spend it, and fire on the first frame after the veil.
 */
test('a sliced restart draws only its two warm-up frames and takes no input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  const enter = page.locator('.intro-screen .primary-action');
  await enter.waitFor({ state: 'visible', timeout: WARM_UP });
  await enter.click();
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });

  type Sample = { frames: number; attackTime: number; attackBuffer: number; dashTime: number; dashCooldown: number };
  const result = await page.evaluate(() => {
    type State = { building: boolean; render: { frames: number }; player: Omit<Sample, 'frames'> };
    const read = () => JSON.parse((window as GameWindow).render_game_to_text!()) as State;
    const act = (detail: string) => window.dispatchEvent(new CustomEvent('dungeon-action', { detail }));
    const before = read().render.frames;
    // Same task as the read above: the restart claims `building` synchronously, so no frame of the
    // game's own can land between the two.
    act('restart');
    return new Promise<{ before: number; samples: number; last: Sample }>((resolve) => {
      let samples = 0, last: Sample | null = null;
      const check = () => {
        const state = read();
        if (!state.building) { resolve({ before, samples, last: last! }); return; }
        const { attackTime, attackBuffer, dashTime, dashCooldown } = state.player;
        last = { frames: state.render.frames, attackTime, attackBuffer, dashTime, dashCooldown };
        samples++;
        act('attack'); act('dash');
        requestAnimationFrame(check);
      };
      check();
    });
  });
  expect(result.samples, 'the build ended before a single frame was sampled').toBeGreaterThan(1);
  expect(
    result.last.frames,
    'frames other than the two warm-up draws were drawn during the build - the loop touched the half-built floor',
  ).toBe(result.before + 2);
  expect(
    { attackTime: result.last.attackTime, attackBuffer: result.last.attackBuffer, dashTime: result.last.dashTime, dashCooldown: result.last.dashCooldown },
    'a press made during the build was taken',
  ).toEqual({ attackTime: 0, attackBuffer: 0, dashTime: 0, dashCooldown: 0 });
  expect(errors, 'the sliced restart left a page error behind').toEqual([]);
});
