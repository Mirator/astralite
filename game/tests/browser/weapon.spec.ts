import { expect, test } from './helpers.ts';

// The pickup is the only way an arm other than the Tideblade ever reaches the knight's hand, so what
// these cover is the swap itself: that the rack only ever offers, that the swap key is what takes it,
// that what was held is left behind rather than destroyed, and that the numbers the swing runs on
// actually change.

test('standing on a rack offers the arm and takes nothing; the swap key is what takes it', async ({ game, page }) => {
  await game.enter();
  const opening = await game.state();
  expect(opening.drop, 'every floor lays one arm out').not.toBeNull();
  expect(opening.weapon.id).toBe('tideblade');
  const offered = opening.drop!.kind;
  expect(offered).not.toBe('tideblade');

  // Standing just outside the ring offers nothing, however long the knight waits there, and the key
  // pressed out there is inert rather than a swap at a distance.
  await game.teleport(opening.drop!.x + opening.drop!.radius + 0.6, opening.drop!.z);
  await game.step(900);
  const waiting = await game.state();
  expect(waiting.drop!.over).toBe(false);
  expect(waiting.drop!.offered).toBeNull();
  await page.keyboard.press('KeyE');
  await game.step(32);
  expect((await game.state()).weapon.id).toBe('tideblade');

  // Inside the ring the arm is named — and still not taken, however long he stands there.
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(2000);
  const standing = await game.state();
  expect(standing.drop!.over).toBe(true);
  expect(standing.drop!.offered).toBe(offered);
  expect(standing.weapon.id, 'standing on the rack took the arm by itself').toBe('tideblade');
  await expect(page.locator('.swap-prompt')).toContainText('switch to', { ignoreCase: true });

  // Only now, and only on the key.
  await page.keyboard.press('KeyE');
  await game.step(32);
  const armed = await game.state();
  expect(armed.weapon.id).toBe(offered);
  // What he set down is still there: a swap he regrets is a walk back, not a dead run.
  expect(armed.drop!.kind).toBe('tideblade');
  // And the prompt turns around with it, naming the sword he just put down.
  expect(armed.drop!.offered).toBe('tideblade');
});

test('the prompt is gone the moment the knight walks off the rack', async ({ game, page }) => {
  await game.enter();
  const opening = await game.state();
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(64);
  await expect(page.locator('.swap-prompt')).toBeVisible();

  await game.teleport(opening.drop!.x + opening.drop!.radius + 1.2, opening.drop!.z);
  await game.step(64);
  await expect(page.locator('.swap-prompt')).toHaveCount(0);
  expect((await game.state()).drop!.offered).toBeNull();
});

test('a dash across a rack cannot change the arm in hand', async ({ game, page }) => {
  // The old rule was a dwell, and the thing it existed to prevent was a swap in the middle of a fight.
  // The key replaces it: crossing the ring at speed, dashing or not, never reaches the weapon.
  await game.enter();
  const opening = await game.state();
  await game.teleport(opening.drop!.x - 2.2, opening.drop!.z);
  await page.keyboard.down('KeyD');
  await page.keyboard.press('ShiftLeft');
  await game.step(700);
  await page.keyboard.up('KeyD');
  await game.step(200);
  expect((await game.state()).weapon.id).toBe('tideblade');
});

test('the swing runs on the new arm rather than the old numbers', async ({ game, page }) => {
  await game.enter();
  const before = await game.state();
  await game.teleport(before.drop!.x, before.drop!.z);
  await game.step(64);
  await page.keyboard.press('KeyE');
  await game.step(32);
  const after = await game.state();

  expect(after.weapon.id).not.toBe(before.weapon.id);
  // At least one of the three numbers a fight is decided by has to have moved with the weapon.
  const moved = after.weapon.reach !== before.weapon.reach
    || after.weapon.duration !== before.weapon.duration
    || after.weapon.damage !== before.weapon.damage;
  expect(moved, 'taking an arm changed nothing about the swing').toBe(true);
  expect(after.weapon.strikeDamage).toBe(after.weapon.damage + after.boons.strike);
});

test('a new descent starts on the sword the knight walks in with', async ({ game, page }) => {
  await game.enter();
  const opening = await game.state();
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(64);
  await page.keyboard.press('KeyE');
  await game.step(32);
  expect((await game.state()).weapon.id).not.toBe('tideblade');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'restart' })));
  await game.step(600);
  const fresh = await game.state();
  expect(fresh.weapon.id).toBe('tideblade');
  expect(fresh.drop).not.toBeNull();
  expect(fresh.drop!.offered).toBeNull();
});
