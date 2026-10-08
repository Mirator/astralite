import { freshMeta } from '../../app/dungeon-meta.ts';
import { expect, press, type Snapshot, test } from './helpers.ts';

// A rack is the only way an arm other than the one he started with ever reaches the knight's hand, so what this
// covers is the swap itself: that the rack only ever offers, that the swap key is what takes it, that what
// was held is left behind rather than destroyed, that the swing runs on the new arm, and that a restart
// hands back the sword. One story on one page; it used to be four tests paying four resets.
// Plan 019 Stage C: the floor-one rack this was written against is gone. The only racks in the campaign are the armoury's, an owned
// arm each, so the story is staged by owning the maul and walking into its slot. Plan 020 moved the armoury from floor one's Tide Gate
// to the Tide Altar's hall: the page is rebuilt as the hall by hook after ENTER (`buildHall`), because the swap itself is what is
// under test and the walk there is hall.spec.ts's (which also covers the armoury as a whole: which arms stand, the choice, the lock at the way down).

test('standing on a rack offers the arm and takes nothing; the swap key is what takes it', async ({ game, page }) => {
  await game.setMeta({ ...freshMeta(), arms: ['tideblade', 'maul'], arm: 'tideblade' });
  await game.enter();
  await game.buildHall();
  const opening = await game.state();
  // Plan 025 (D8): the hall stands every arm on a rack, the ones not owned locked, so the open racks are the owned ones. The slot is followed by where it stands, since a swap leaves the sword on the maul's.
  expect(opening.racks.filter((r) => !r.locked), 'the hall lays one open rack out for the one arm owned besides the sword in hand').toHaveLength(1);
  expect(opening.weapon.id).toBe('tideblade');
  const rack = opening.racks.find((r) => !r.locked)!, offered = rack.kind;
  expect(offered).toBe('maul');
  const slot = (state: Snapshot) => state.racks.find((r) => r.x === rack.x && r.z === rack.z)!;

  // Standing just outside the ring offers nothing, however long the knight waits there, and the key
  // pressed out there is inert rather than a swap at a distance.
  // Plan 026: the chapel's racks stand two tiles apart down its west arm, so the spot is a tile across on both axes, in the gap between three of them.
  await game.teleport(rack.x + 1.48, rack.z + 1.48);
  await game.step(900);
  const waiting = await game.state();
  expect(Math.hypot(waiting.player.x - rack.x, waiting.player.z - rack.z), 'precondition: the knight stands just outside the ring, not far off').toBeLessThan(rack.radius + 1);
  expect(waiting.racks.filter((r) => r.over), 'precondition: the spot outside this ring is inside another rack\'s').toEqual([]);
  expect(slot(waiting).over).toBe(false);
  expect(slot(waiting).offered).toBeNull();
  await page.keyboard.press('KeyE');
  await game.step(32);
  expect((await game.state()).weapon.id).toBe('tideblade');

  // Inside the ring the arm is named — and still not taken, however long he stands there.
  await game.teleport(rack.x, rack.z);
  await game.step(2000);
  const standing = await game.state();
  expect(slot(standing).over).toBe(true);
  expect(slot(standing).offered).toBe(offered);
  expect(standing.weapon.id, 'standing on the rack took the arm by itself').toBe('tideblade');
  await expect(page.locator('.swap-prompt')).toContainText('switch to', { ignoreCase: true });

  // Only now, and only on the key.
  await page.keyboard.press('KeyE');
  await game.step(32);
  const armed = await game.state();
  expect(armed.weapon.id).toBe(offered);
  // What he set down is still there: a swap he regrets is a walk back, not a dead run.
  expect(armed.racks.filter((r) => !r.locked)).toHaveLength(1);
  expect(slot(armed).kind).toBe('tideblade');
  // And the prompt turns around with it, naming the sword he just put down.
  expect(slot(armed).offered).toBe('tideblade');

  // The swing runs on the new arm, read off a real swing rather than the weapon table.
  expect(armed.weapon.duration, 'the fixture needs an arm that swings at a different speed').not.toBe(opening.weapon.duration);
  await press(page, 'attack');
  await game.step(16);
  const swinging = await game.state();
  expect(swinging.player.chain.duration, 'the swing ran on the old arm').toBe(armed.weapon.duration);
  expect(swinging.player.attackTime).toBeCloseTo(armed.weapon.duration - 0.016, 3);
  expect(swinging.player.chain.damage).toBe(armed.weapon.damage + armed.boons.strike);
  await game.step(1200);

  // The prompt is gone the moment he walks off the rack.
  await game.teleport(rack.x + 1.48, rack.z + 1.48);
  await game.step(64);
  expect((await game.state()).racks.filter((r) => r.over), 'precondition: walked off this rack onto another').toEqual([]);
  await expect(page.locator('.swap-prompt')).toHaveCount(0);
  expect(slot(await game.state()).offered).toBeNull();

  // And a new descent starts on the arm the save holds, whatever he left the last one holding (nothing was locked: he never
  // took the way down). Floor one's gate has no racks; the hall, laid out again, holds the maul as it did.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'restart' })));
  await game.built();
  await game.step(600);
  const fresh = await game.state();
  expect(fresh.weapon.id).toBe('tideblade');
  expect(fresh.racks, 'floor one\'s gate laid a rack').toEqual([]);
  await game.buildHall();
  const again = await game.state();
  expect(again.racks.filter((r) => !r.locked).map((r) => r.kind)).toEqual(['maul']);
  expect(slot(again).offered).toBeNull();
});
