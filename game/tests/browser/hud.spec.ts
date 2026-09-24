import { expect, test } from './helpers.ts';

/**
 * Nothing flat sits over the painted scene but the HUD itself: the blurred foreground silhouettes that
 * used to frame the corners (statue, column, reeds, banner) read as a pasted-on cutout and were taken
 * out, while the strike/dash icons and their keycaps stay. The knight and the guards carry no outline
 * pass, and the camera sits a fifth further out than the tight Plan 014 framing.
 */
test('no foreground silhouettes or figure outlines, the ability row stays, and the camera sits a fifth wider', async ({ game, page }) => {
  await game.enter();
  await game.step(100);

  await expect(page.locator('.foreground-frame')).toHaveCount(0);
  const hud = page.getByRole('region', { name: 'Player status' });
  await expect(hud.getByRole('progressbar', { name: 'Vitality' })).toBeVisible();
  await expect(hud.getByRole('progressbar', { name: 'Dash readiness' })).toBeVisible();
  await expect(hud.locator('kbd.keycap')).toHaveCount(2);

  const state = await game.state();
  expect(state.render.passes).not.toContain('OutlinePass');
  expect(state.render.passes).toContain('RenderPass');
  // 1000 px wide is the desktop breakpoint: 4.3 before, 5.16 now.
  expect(state.aim.span).toBeCloseTo(5.16, 5);
});
