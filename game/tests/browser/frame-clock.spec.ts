import { chooseSlot, expect, type GameWindow, openSlots, test, WARM_UP } from './helpers.ts';

// Both scenarios here watch the real frame loop, which a pooled page gives up for good on its first
// `advanceTime`. A fresh load pays the cold shader warm-up (see WARM_UP in helpers.ts), so each gets room for it.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

// The stale-first-timestamp check that used to open this file delivered its old timestamp before the game
// was warm, so it never reached `update` and passed with the clamp deleted. The clamp is `frameDelta` in
// dungeon-player.ts now, held by tests/dungeon-player.test.ts.

/**
 * Plan 020: the product's first press builds the hall, not floor one (the other scenarios here come in the same way and then restart out of it, which is the
 * way down's own path). The hall is raised by the same staged build, so the same two warm-up frames are all it may draw while it is building. The sampler runs in
 * the page from before the press, because the hooks go up with the floor and the build is a handful of frames; it is armed first and the press is a real click.
 */
test('the cold press into the hall draws only its two warm-up frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  await page.locator('.intro-screen .primary-action').waitFor({ state: 'visible', timeout: WARM_UP });
  await openSlots(page);
  await page.evaluate(() => {
    const watched = window as unknown as { buildSamples?: { first: number | null; last: number | null; samples: number; hall: boolean | null; done: boolean } };
    const out: NonNullable<typeof watched.buildSamples> = watched.buildSamples = { first: null, last: null, samples: 0, hall: null, done: false };
    const tick = () => {
      const hook = (window as GameWindow).render_game_to_text;
      if (hook) {
        const state = JSON.parse(hook()) as { building: boolean; hall: boolean; render: { frames: number } };
        if (state.building) { out.first ??= state.render.frames; out.last = state.render.frames; out.samples++; out.hall = state.hall; }
        else if (out.first !== null) { out.done = true; return; }
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  await chooseSlot(page);
  await page.waitForFunction(() => (window as unknown as { buildSamples: { done: boolean } }).buildSamples.done, undefined, { timeout: WARM_UP });
  const seen = await page.evaluate(() => (window as unknown as { buildSamples: { first: number; last: number; samples: number; hall: boolean } }).buildSamples);
  expect(seen.samples, 'the build ended before a single frame was sampled').toBeGreaterThan(1);
  expect(seen.last - seen.first, 'frames other than the two warm-up draws were drawn while the hall was being raised').toBeLessThanOrEqual(2);
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
  const state = await page.evaluate(() => JSON.parse((window as GameWindow).render_game_to_text!()) as { hall: boolean; mode: string; render: { frames: number } });
  expect([state.hall, state.mode], 'the press did not raise the hall').toEqual([true, 'playing']);
  expect(errors, 'the cold press left a page error behind').toEqual([]);
});
