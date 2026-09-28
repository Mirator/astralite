import type { Page } from '@playwright/test';
import { expect, fakePad, keyFor, press, test, type Snapshot } from './helpers.ts';

// Plan 016 Stage A: the control layout that has room for a special. Mouse buttons are bind codes in the
// same table as keys, the floor map has a key and a pad button, and the pad's two dodge buttons each hold
// their own slot. Real input throughout; the hooks only equip an arm and read the state back.

type Binds = Record<string, string[]>;
const bindsOf = (state: Snapshot) => (state as Snapshot & { settings: { binds: Binds } }).settings.binds;

const canvasCentre = async (page: Page) => {
  const box = await page.locator('canvas').boundingBox();
  expect(box, 'the game canvas has no box to point at').not.toBeNull();
  return { x: box!.x + box!.width * 0.5, y: box!.y + box!.height * 0.5 };
};

test('the right mouse button is the special, never a dodge, and every arm fills the special slot', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  // Plan 016 Stage C: every arm has a special, so the empty socket is never shown in play.
  const hud = page.getByRole('region', { name: 'Player status' });
  for (const arm of ['tideblade', 'fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask']) {
    await game.equip(arm);
    await expect(page.locator('.ability-empty'), arm).toHaveCount(0);
  }
  await game.equip('cleaver');
  await expect(hud.getByRole('progressbar', { name: 'Whirl readiness' })).toBeVisible();

  const at = await canvasCentre(page);
  await page.mouse.move(at.x, at.y);
  await game.step(32);
  await page.mouse.down({ button: 'right' });
  await game.step(16);
  await page.mouse.up({ button: 'right' });
  await game.step(16);
  const after = await game.state();
  expect(after.player.attackTime, 'the Whirl, not a strike').toBeGreaterThan(0);
  expect((after.player as Snapshot['player'] & { special: { live: boolean } }).special.live).toBe(true);
  expect(after.player.dashTime, 'and no dodge: the right button stopped dodging').toBe(0);
  expect(after.mode).toBe('playing');
  await game.step(1000);
  await game.equip('tideblade');
});

test('Tab opens and closes the floor map while playing, and moves focus everywhere else', async ({ game, page }) => {
  // On the menu, before a run, Tab is focus navigation and nothing else.
  await press(page, 'map');
  await expect(page.locator('.map-screen')).toHaveCount(0);

  await game.enter();
  await game.step(120);
  await press(page, 'map');
  await game.step(16);
  await expect(page.locator('.map-screen')).toBeVisible();
  expect((await game.state()).mode, 'the map holds the world like a pause').toBe('paused');
  await press(page, 'map');
  await game.step(16);
  await expect(page.locator('.map-screen')).toHaveCount(0);
  expect((await game.state()).mode).toBe('playing');

  // On the pause card Tab walks the card's controls instead of opening the map.
  await page.keyboard.press('Escape');
  await game.step(16);
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeFocused();
  await press(page, 'map');
  await expect(page.getByRole('button', { name: /RESUME/ })).toBeFocused();
  await expect(page.locator('.map-screen')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  expect(keyFor('map')).toBe('Tab');
});

test('a pad opens and closes the map on View, dodges on B and RB, and answers X with the special', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const pad = await fakePad(page);
  const setButton = pad.set;
  try {
    await setButton(8, true);
    await game.step(16);
    await expect(page.locator('.map-screen')).toBeVisible();
    await setButton(8, false);
    await game.step(16);
    // Still open: a press toggles, a release does nothing.
    await expect(page.locator('.map-screen')).toBeVisible();
    await setButton(8, true);
    await game.step(16);
    await expect(page.locator('.map-screen')).toHaveCount(0);
    expect((await game.state()).mode).toBe('playing');
    await setButton(8, false);
    await game.step(16);

    // RB is a second dodge, so the thumb can stay on A.
    await setButton(5, true);
    await game.step(16);
    expect((await game.state()).player.dashTime, 'RB dodged').toBeGreaterThan(0);
    await setButton(5, false);
    await game.step(1600);
    await setButton(1, true);
    await game.step(16);
    expect((await game.state()).player.dashTime, 'B dodged').toBeGreaterThan(0);
    await setButton(1, false);
    await game.step(1600);

    // X is the special now, and no longer takes an arm off a rack.
    await game.equip('cleaver');
    const rack = (await game.state()).drop;
    await setButton(2, true);
    await game.step(16);
    const whirled = await game.state();
    expect((whirled.player as Snapshot['player'] & { special: { live: boolean } }).special.live, 'X is the Whirl').toBe(true);
    expect(whirled.weapon.id, 'and did not swap anything').toBe('cleaver');
    expect(whirled.drop?.kind).toBe(rack?.kind);
    await setButton(2, false);
    await game.step(1000);
  } finally {
    await pad.remove();
    // One poll with no pad drops whatever it was holding.
    await game.step(16);
    await game.equip('tideblade');
  }
});

test('a mouse button binds from the capture strip, and the left button still clicks the card', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  // The keycaps name the device used last: the key for a keyboard player, the button once the cursor aims.
  const strikeCap = page.locator('.ability kbd.keycap').first();
  await expect(strikeCap).toContainText('J');
  const at = await canvasCentre(page);
  await page.mouse.move(at.x, at.y);
  await game.step(32);
  await expect(strikeCap).toContainText('LMB');
  await press(page, 'attack');
  await game.step(16);
  await expect(strikeCap).toContainText('J');
  await game.step(600);

  await page.keyboard.press('Escape');
  await game.step(16);
  await page.getByRole('navigation', { name: 'Pause menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary', { hasText: 'Key bindings' }).click();
  await page.getByRole('button', { name: /^Dodge:/ }).click();
  const strip = page.locator('.mouse-capture');
  await expect(strip).toBeVisible();
  // The middle button, pressed on the strip, becomes a dodge.
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await expect(strip).toHaveCount(0);
  expect(bindsOf(await game.state()).dash).toContain('Mouse1');
  // The keys it already had are the keyboard's and stay.
  expect(bindsOf(await game.state()).dash).toContain('Space');
  await expect(page.getByRole('button', { name: /^Dodge:/ })).toContainText('MMB');

  // Armed again, a left click anywhere else on the card is still a click, not a binding.
  await page.getByRole('button', { name: /^Special:/ }).click();
  await expect(strip).toBeVisible();
  await page.getByRole('button', { name: 'Reset keys' }).click();
  await expect(strip).toHaveCount(0);
  expect(bindsOf(await game.state()).special, 'Reset keys ran; the left button was not bound').toEqual(['Mouse2', 'KeyK']);
  expect(bindsOf(await game.state()).dash).not.toContain('Mouse1');

  // Bind it once more and use it in the fight: the button dodges.
  await page.getByRole('button', { name: /^Dodge:/ }).click();
  const again = (await strip.boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  await page.mouse.move(at.x, at.y);
  await game.step(16);
  await page.mouse.down({ button: 'middle' });
  await game.step(16);
  await page.mouse.up({ button: 'middle' });
  expect((await game.state()).player.dashTime, 'the middle button dodged').toBeGreaterThan(0);
  await game.step(600);

  // Leave the card as the shipped game had it: the pooled page is held against a fresh boot.
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.getByRole('navigation', { name: 'Pause menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary', { hasText: 'Key bindings' }).click();
  await page.getByRole('button', { name: 'Reset keys' }).click();
  await page.keyboard.press('Escape');
  await game.step(16);
});
