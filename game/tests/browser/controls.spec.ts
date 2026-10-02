import type { Page } from '@playwright/test';
import { freshMeta } from '../../app/dungeon-meta.ts';
import { expect, fakePad, type Game, keyFor, press, test, type Snapshot } from './helpers.ts';

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
  const focus = () => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName}.${el.className}` : null; });
  const held = await focus();
  await press(page, 'map');
  await game.step(16);
  await expect(page.locator('.map-screen')).toHaveCount(0);
  expect(await focus(), 'the Tab that closed the map moved no focus').toBe(held);
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
  // Plan 019 Stage C: the X check below needs a rack under the knight, and the floor-one rack it used is gone; the Tide Gate's
  // armoury stands there once an arm besides the Tideblade is owned.
  await game.setMeta({ ...freshMeta(), arms: ['tideblade', 'maul'], arm: 'tideblade' });
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
    const rack = (await game.state()).racks[0];
    expect(rack?.kind, 'the Tide Gate shows the one arm owned besides the one at the gate').toBe('maul');
    // The knight stands in the rack's ring, where the swap key would take the maul; the precondition that makes "X took nothing" mean something.
    await game.teleport(rack.x, rack.z);
    await game.step(32);
    expect((await game.state()).racks[0].over, 'the knight is in the rack\'s ring').toBe(true);
    await setButton(2, true);
    await game.step(16);
    const whirled = await game.state();
    expect((whirled.player as Snapshot['player'] & { special: { live: boolean } }).special.live, 'X is the Whirl').toBe(true);
    expect(whirled.weapon.id, 'and did not swap anything').toBe('cleaver');
    expect(whirled.racks.map((r) => r.kind), 'and the maul is still on its rack').toEqual(['maul']);
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

/** Open the key bindings on the pause card, arm `label`'s rebind, and bind the middle button from the strip. */
const bindMiddle = async (game: Game, page: Page, label: RegExp) => {
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.getByRole('navigation', { name: 'Pause menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary', { hasText: 'Key bindings' }).click();
  await page.getByRole('button', { name: label }).click();
  const box = (await page.locator('.mouse-capture').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await expect(page.locator('.mouse-capture')).toHaveCount(0);
};
const resetKeys = async (game: Game, page: Page) => {
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.getByRole('navigation', { name: 'Pause menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary', { hasText: 'Key bindings' }).click();
  await page.getByRole('button', { name: 'Reset keys' }).click();
  await page.keyboard.press('Escape');
  await game.step(16);
};

test('a map and a pause bound to a mouse button close from that button while paused', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await bindMiddle(game, page, /^Floor map:/);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  expect(bindsOf(await game.state()).map).toContain('Mouse1');
  const at = await canvasCentre(page);
  await page.mouse.move(at.x, at.y);
  await game.step(16);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await game.step(16);
  await expect(page.locator('.map-screen')).toBeVisible();
  // The map covers the canvas now: the press lands on it, and still closes it.
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await game.step(16);
  await expect(page.locator('.map-screen')).toHaveCount(0);
  expect((await game.state()).mode).toBe('playing');
  await resetKeys(game, page);

  await bindMiddle(game, page, /^Pause:/);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  await page.mouse.move(at.x, at.y);
  await game.step(16);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await game.step(16);
  expect((await game.state()).mode, 'the button paused').toBe('paused');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await game.step(16);
  expect((await game.state()).mode, 'and the same button resumed, over the card').toBe('playing');
  await resetKeys(game, page);
  expect(bindsOf(await game.state()).pause).toEqual(['Escape']);
});

test('the side mouse buttons do not bind: the capture strip ignores them', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.getByRole('navigation', { name: 'Pause menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary', { hasText: 'Key bindings' }).click();
  await page.getByRole('button', { name: /^Dodge:/ }).click();
  const strip = page.locator('.mouse-capture');
  await expect(strip).toBeVisible();
  // Playwright's mouse has no side buttons, so this one press is dispatched: it is what Chrome sends for M4 and M5.
  for (const button of [3, 4]) {
    await strip.evaluate((el, which) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: which, buttons: 1 << which })), button);
    await expect(strip, `M${button + 1} left the strip armed`).toBeVisible();
  }
  expect(bindsOf(await game.state()).dash).toEqual(['Space', 'ShiftLeft', 'ShiftRight', 'KeyL']);
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
});

test('a button still held when the cursor comes back is not a fresh press, and a click after the window was away is not swallowed', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const at = await canvasCentre(page);
  const hud = (await page.getByRole('region', { name: 'Player status' }).boundingBox())!;
  await page.mouse.move(at.x, at.y);
  await game.step(32);
  await page.mouse.down();
  await game.step(16);
  expect((await game.state()).player.attackTime, 'the left button strikes').toBeGreaterThan(0);
  // Off the canvas, onto the HUD, with the button down: the held strike lets go.
  await page.mouse.move(hud.x + hud.width / 2, hud.y + hud.height / 2);
  await game.step(1000);
  expect((await game.state()).player.attackTime, 'no strike while the cursor is away').toBe(0);
  // Back with the button still down: that is not a press.
  await page.mouse.move(at.x, at.y);
  await game.step(16);
  expect((await game.state()).player.attackTime, 'coming back is not a click').toBe(0);
  await page.mouse.up();
  await game.step(16);
  await page.mouse.down();
  await game.step(16);
  expect((await game.state()).player.attackTime, 'a real press still strikes').toBeGreaterThan(0);
  await page.mouse.up();
  await game.step(1000);

  // A press whose release the page never hears (the window lost focus in between) must not eat the next click.
  // The press is dispatched: a real one cannot be held while the window goes.
  await page.locator('canvas').evaluate((el, spot) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: spot.x, clientY: spot.y })), at);
  await game.step(1000);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await game.step(16);
  expect((await game.state()).mode, 'losing the window pauses').toBe('paused');
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');
  await page.mouse.down();
  await game.step(16);
  expect((await game.state()).player.attackTime, 'the first click back strikes').toBeGreaterThan(0);
  await page.mouse.up();
  await game.step(1000);
});
