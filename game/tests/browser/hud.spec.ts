import { expect, test } from './helpers.ts';

/**
 * Nothing flat sits over the painted scene but the HUD itself: the blurred foreground silhouettes that
 * used to frame the corners (statue, column, reeds, banner) read as a pasted-on cutout and were taken
 * out, while the strike/dash icons and their keycaps stay. The knight and the guards carry no outline
 * pass, and the camera sits 44% further out than the tight Plan 014 framing (a fifth, twice).
 */
test('no foreground silhouettes or figure outlines, the ability row stays, and the camera sits 44% wider', async ({ game, page }) => {
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
  // 1000 px wide is the desktop breakpoint: 4.3 under Plan 014, 5.16 * 1.2 = 6.19 now.
  expect(state.aim.span).toBeCloseTo(6.19, 5);
});

/**
 * On a software rasteriser the chrome drops the blurs that were each seconds of GPU-process time per
 * repaint there - the end screen's full-screen backdrop blur, the card's 100px shadow, the title's text
 * shadow - on the same switch as the plain veil and the reduced post chain, so the three never disagree
 * about what the machine can draw. A GPU keeps all of them. The end card is read off a stand-in with the
 * real classes rather than by finishing a floor: what is under test is which rules apply, not the floor.
 */
test('a software rasteriser gets the chrome without its blurs, and a GPU keeps them', async ({ game, page }) => {
  const reduced = (await game.state()).render.quality === 'reduced';
  await expect(page.locator('.game-shell')).toHaveClass(reduced ? /\bplain-chrome\b/ : /^(?!.*\bplain-chrome\b)/);
  const styles = await page.evaluate(() => {
    const backdrop = document.createElement('div'), card = document.createElement('div');
    backdrop.className = 'end-screen success-screen'; card.className = 'end-card';
    backdrop.appendChild(card);
    document.querySelector('.game-shell')!.appendChild(backdrop);
    const read = { backdrop: getComputedStyle(backdrop).backdropFilter, shadow: getComputedStyle(card).boxShadow, title: getComputedStyle(document.querySelector('.intro-card h1')!).textShadow };
    backdrop.remove();
    return read;
  });
  if (reduced) expect(styles).toEqual({ backdrop: 'none', shadow: 'none', title: 'none' });
  else for (const [name, value] of Object.entries(styles)) expect(value, `${name} lost its blur on a GPU`).not.toBe('none');
});
