import { expect, test } from './helpers.ts';

/**
 * The HUD is vitality and rank only: the strike/dash icon row and its keycaps read as an overlay on the
 * painted scene and were taken out. The knight and the guards carry no outline pass either, and the
 * camera sits a fifth further out than the tight Plan 014 framing.
 */
test('the HUD carries no ability icons, figures carry no outline, and the camera sits a fifth wider', async ({ game, page }) => {
  await game.enter();
  await game.step(100);

  const hud = page.getByRole('region', { name: 'Player status' });
  await expect(hud.getByRole('progressbar', { name: 'Vitality' })).toBeVisible();
  await expect(hud.locator('kbd')).toHaveCount(0);
  await expect(page.locator('.ability-row, .ability-icon')).toHaveCount(0);

  const state = await game.state();
  expect(state.render.passes).not.toContain('OutlinePass');
  expect(state.render.passes).toContain('RenderPass');
  // 1000 px wide is the desktop breakpoint: 4.3 before, 5.16 now.
  expect(state.aim.span).toBeCloseTo(5.16, 5);
});
