import { expect, test } from './helpers.ts';

// The pickup is the only way an arm other than the Tideblade ever reaches the knight's hand, so what
// these cover is the swap itself: that standing takes it, that a dash across it does not, that what was
// held is left behind rather than destroyed, and that the numbers the swing runs on actually change.

test('an arm is taken by standing over it, and the one in hand is left on the rack', async ({ game }) => {
  await game.enter();
  const opening = await game.state();
  expect(opening.drop, 'every floor lays one arm out').not.toBeNull();
  expect(opening.weapon.id).toBe('tideblade');
  const offered = opening.drop!.kind;
  expect(offered).not.toBe('tideblade');

  // Standing just outside the ring must do nothing at all, however long the knight waits there.
  await game.teleport(opening.drop!.x + opening.drop!.radius + 0.6, opening.drop!.z);
  await game.step(900);
  const waiting = await game.state();
  expect(waiting.weapon.id).toBe('tideblade');
  expect(waiting.drop!.dwell).toBe(0);

  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(1200);
  const armed = await game.state();
  expect(armed.weapon.id).toBe(offered);
  // What he set down is still there: a pickup he regrets is a walk back, not a dead run.
  expect(armed.drop!.kind).toBe('tideblade');
});

test('standing on the rack takes one arm, not an endless exchange', async ({ game }) => {
  // The knight is still on the rack he just emptied, so without a latch the dwell refills and he swaps
  // straight back. Measured at a swap every half-second, for as long as he stood there.
  await game.enter();
  const opening = await game.state();
  const offered = opening.drop!.kind;
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(600);
  expect((await game.state()).weapon.id).toBe(offered);

  // Four more seconds of standing perfectly still must change nothing at all.
  for (let i = 0; i < 4; i++) {
    await game.step(1000);
    const held = await game.state();
    expect(held.weapon.id, `swapped again after ${i + 1}s of standing`).toBe(offered);
    expect(held.drop!.kind).toBe('tideblade');
  }

  // Stepping off and back on re-arms it: taking the sword back is a walk, never an accident.
  await game.teleport(opening.drop!.x + opening.drop!.radius + 1.2, opening.drop!.z);
  await game.step(300);
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(700);
  expect((await game.state()).weapon.id).toBe('tideblade');
});

test('the swing runs on the new arm rather than the old numbers', async ({ game }) => {
  await game.enter();
  const before = await game.state();
  await game.teleport(before.drop!.x, before.drop!.z);
  await game.step(1200);
  const after = await game.state();

  expect(after.weapon.id).not.toBe(before.weapon.id);
  // At least one of the three numbers a fight is decided by has to have moved with the weapon.
  const moved = after.weapon.reach !== before.weapon.reach
    || after.weapon.duration !== before.weapon.duration
    || after.weapon.damage !== before.weapon.damage;
  expect(moved, 'picking an arm up changed nothing about the swing').toBe(true);
  expect(after.weapon.strikeDamage).toBe(after.weapon.damage + after.boons.strike);
});

test('a new descent starts on the sword the knight walks in with', async ({ game, page }) => {
  await game.enter();
  const opening = await game.state();
  await game.teleport(opening.drop!.x, opening.drop!.z);
  await game.step(1200);
  expect((await game.state()).weapon.id).not.toBe('tideblade');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'restart' })));
  await game.step(600);
  const fresh = await game.state();
  expect(fresh.weapon.id).toBe('tideblade');
  expect(fresh.drop).not.toBeNull();
});
