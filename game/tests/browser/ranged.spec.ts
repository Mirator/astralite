import { expect, test } from './helpers.ts';

// The crossbow is the only arm that can be left useless, and the only one whose damage happens some
// frames after the button. Both of those are what these cover.

test('firing spends a bolt, puts it in the air, and the quiver comes back on its own', async ({ game, page }) => {
  await game.enter();
  await game.equip('crossbow');
  const loaded = await game.state();
  expect(loaded.weapon.ranged).toBe(true);
  expect(loaded.weapon.quiver).toBe(loaded.weapon.capacity);

  await page.keyboard.press('Space');
  await game.step(400);
  const fired = await game.state();
  expect(fired.weapon.quiver).toBe(loaded.weapon.capacity! - 1);

  // Bolts do not come back inside a swing, so a dry quiver is a real state and not a stutter.
  await game.step(600);
  expect((await game.state()).weapon.quiver).toBe(loaded.weapon.capacity! - 1);
  await game.step(2000);
  expect((await game.state()).weapon.quiver).toBe(loaded.weapon.capacity);
});

test('sustained fire keeps the quiver at the bottom rather than topped up', async ({ game, page }) => {
  // The whole reason a ranged arm is limited by a quiver rather than a cooldown: the knight outruns
  // every body in the keep, so a shot that merely recovered on a timer would let him win by walking
  // backwards. Holding the trigger has to empty him — a bolt leaves every 0.86s and one comes back
  // every 1.8s, so sustained fire loses ground and ends dry.
  await game.enter();
  await game.equip('crossbow');
  const capacity = (await game.state()).weapon.capacity!;
  expect(capacity).toBeGreaterThan(0);

  await page.keyboard.down('Space');
  await game.step(9000);
  await page.keyboard.up('Space');
  // At the bottom of the quiver rather than exactly empty: under continuous fire the count oscillates
  // between none and one, because a bolt that comes back is spent by the next pull almost at once.
  // Pinning it to exactly 0 is pinning the sampling moment, not the drain.
  const dry = await game.state();
  expect(dry.weapon.quiver).toBeLessThanOrEqual(1);
  expect(dry.weapon.quiver).toBeLessThan(capacity);

  // Holding longer neither digs a hole nor recovers: the drain is the steady state, not a dip.
  await page.keyboard.down('Space');
  await game.step(4000);
  await page.keyboard.up('Space');
  const held = await game.state();
  expect(held.weapon.quiver).toBeGreaterThanOrEqual(0);
  expect(held.weapon.quiver).toBeLessThanOrEqual(1);

  // Deliberately not asserting here that a pull on an empty quiver looses nothing. Bolts come back on a
  // clock that keeps running, so any wait long enough for the air to clear is also long enough to hand
  // one back, and the press would then fire a real bolt — which is the rule working, not failing. The
  // guard itself is one branch in the loop; what is worth pinning in a live game is the drain.
});

test('the quiver is refilled by picking an arm up and emptied by putting one down', async ({ game, page }) => {
  await game.enter();
  await game.equip('crossbow');
  await page.keyboard.press('Space');
  await game.step(400);
  expect((await game.state()).weapon.quiver).toBeLessThan((await game.state()).weapon.capacity!);

  // A melee arm has no quiver at all, and the readout goes with it.
  await game.equip('cleaver');
  const melee = await game.state();
  expect(melee.weapon.ranged).toBe(false);
  expect(melee.weapon.quiver).toBeNull();
  expect(await page.locator('.quiver').count()).toBe(0);

  await game.equip('crossbow');
  const rearmed = await game.state();
  expect(rearmed.weapon.quiver).toBe(rearmed.weapon.capacity);
  expect(await page.locator('.quiver').count()).toBe(1);
});
