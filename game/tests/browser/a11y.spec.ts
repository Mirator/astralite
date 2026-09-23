import { expect, test } from './helpers.ts';

/**
 * Every full-screen card is a dialog: it names itself, takes focus the moment it opens, and keeps the
 * controls behind it out of reach. Focus lands on the card rather than a button so the strike key,
 * Space, cannot press RESUME or DESCEND by accident.
 */
test('cards are dialogs that take focus, and the background stays out of reach while one is open', async ({
  game,
  page,
}) => {
  // The intro is a dialog before anything has been clicked.
  const intro = page.getByRole('dialog', { name: /Below/ });
  await expect(intro).toBeVisible();
  await expect(intro).toBeFocused();

  await game.enter();
  await game.step(120);

  // Pausing opens a named dialog, focuses it, and disables the hamburger behind it.
  await page.keyboard.press('Escape');
  await game.step(16);
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  await expect(pause).toBeFocused();
  await expect(page.getByRole('button', { name: 'Pause game' })).toBeDisabled();

  // Space on the focused card is not a click: the strike key cannot resume the game by accident.
  await page.keyboard.press('Space');
  await game.step(16);
  expect((await game.state()).mode).toBe('paused');

  // Tab reaches the card's own first control.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');

  // A boon draft is a dialog too, and takes focus the moment it opens.
  await game.grantXp(300);
  await game.step(16);
  const draft = page.getByRole('dialog', { name: 'The tide gives back.' });
  await expect(draft).toBeVisible();
  await expect(draft).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.boon-option').first()).toBeFocused();
  await game.takeBoon();
  await game.step(16);

  // The vitality meter reads back as a value, like the dash and rank meters beside it.
  const vitality = page.getByRole('progressbar', { name: 'Vitality' });
  await expect(vitality).toHaveAttribute('aria-valuenow', String((await game.state()).health));
  await expect(vitality).toHaveAttribute('aria-valuemax', String((await game.state()).maxHealth));
});

/**
 * The menu is a list, and Controls and Settings are pages of the same card rather than folds beneath it.
 * A page takes focus on its way back, the way back returns focus to the item that opened it, and a card
 * that closes on a page reopens on the list.
 */
test('the menu opens its pages in place and always comes back to the list', async ({ game, page }) => {
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByRole('button')).toHaveText([/^ENTER THE KEEP/, /^Controls & journey/, /^Settings/]);

  await menu.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('#set-volume')).toBeVisible();
  const back = page.getByRole('button', { name: 'Back' });
  await expect(back).toBeFocused();
  await back.click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Controls & journey' }).click();
  await expect(page.getByRole('heading', { name: 'Controls & journey' })).toBeVisible();
  await expect(page.locator('.intro-controls').first()).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();

  await game.enter();
  await game.step(120);
  // Paused on the Settings page, resumed from it by Escape: the next pause opens on the list.
  await page.keyboard.press('Escape');
  await game.step(16);
  const pauseMenu = page.getByRole('navigation', { name: 'Pause menu' });
  await expect(pauseMenu.getByRole('button')).toHaveText([/^RESUME/, 'Floor map', /^Controls & journey/, /^Settings/]);
  await pauseMenu.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  await page.keyboard.press('Escape');
  await game.step(16);
  await expect(pauseMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await game.step(16);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the touch controls are inert while a card is open and live again once it closes', async ({
    game,
    page,
  }) => {
    await game.enter();
    await game.step(120);
    const actions = page.locator('.touch-actions');
    await expect(actions).not.toHaveAttribute('inert');
    await page.keyboard.press('Escape');
    await game.step(16);
    await expect(actions).toHaveAttribute('inert');
    await expect(page.locator('.touch-stick')).toHaveAttribute('inert');
    await page.keyboard.press('Escape');
    await game.step(16);
    await expect(actions).not.toHaveAttribute('inert');
  });
});
