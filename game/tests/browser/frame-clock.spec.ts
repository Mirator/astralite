import { expect, test } from './helpers.ts';

// This hands the page an older first animation timestamp, which only exists once per load.
test.use({ isolate: true });

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
  await page.goto('/');
  await page.waitForFunction(() => (window as typeof window & { staleFrameDelivered?: boolean }).staleFrameDelivered);
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
