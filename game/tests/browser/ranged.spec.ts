import { expect, strikeStance, test, TILE } from './helpers.ts';

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

test('a thrown flask leaves fire on the ground, and the fire goes out', async ({ game, page }) => {
  // The one arm that goes on working after the knight has stopped paying attention to it.
  await game.enter();
  await game.equip('flask');
  const loaded = await game.state();
  expect(loaded.weapon.ranged).toBe(true);
  expect(loaded.weapon.fires).toBe(0);

  await page.keyboard.press('Space');
  await game.step(1400);
  const burning = await game.state();
  expect(burning.weapon.fires).toBeGreaterThan(0);
  expect(burning.weapon.quiver).toBe(loaded.weapon.capacity! - 1);
  // The flask itself is gone; what is left is what it left.
  expect(burning.weapon.inFlight).toBe(0);

  await game.step(3500);
  expect((await game.state()).weapon.fires).toBe(0);
});

test('fire already on the floor outlives the arm that threw it', async ({ game, page }) => {
  // Deliberately not cleaned up on a swap. Burning silt does not care what the knight is holding, and
  // a bolt already in the air is treated the same way — both belong to the floor once they have left
  // his hand. What a swap does change is the quiver, which goes with the arm.
  await game.enter();
  await game.equip('flask');
  await page.keyboard.press('Space');
  await game.step(1400);
  expect((await game.state()).weapon.fires).toBeGreaterThan(0);

  await game.equip('tideblade');
  const swapped = await game.state();
  expect(swapped.weapon.fires).toBeGreaterThan(0);
  expect(swapped.weapon.quiver).toBeNull();

  // And it still goes out on its own clock rather than burning forever.
  await game.step(3500);
  expect((await game.state()).weapon.fires).toBe(0);
});

test('a new floor starts with nothing of the last one still burning', async ({ game, page }) => {
  await game.enter();
  await game.equip('flask');
  await page.keyboard.press('Space');
  await game.step(1400);
  expect((await game.state()).weapon.fires).toBeGreaterThan(0);

  await game.buildFloor(2);
  await game.step(200);
  const fresh = await game.state();
  expect(fresh.weapon.fires).toBe(0);
  expect(fresh.weapon.inFlight).toBe(0);
});

test('a dead end cleared with bolts is plundered, counted and marked like one cleared with steel', async ({ game, page }) => {
  // Kills by bolt and by fire used to settle a cleared room on a path of their own, which paid the reward
  // but never counted the dead end as plundered or marked it on the map. One path serves all three now.
  await game.enter();
  await game.step(120);
  const floor = await game.floor();
  const branch = floor.rooms.find((room) => room.role === 'branch' && floor.spawns.some((spawn) => spawn.room === room.id));
  expect(branch, 'this floor has a dead end with bodies in it').toBeDefined();
  const bodies = floor.spawns.map((spawn, index) => ({ spawn, index })).filter(({ spawn }) => spawn.room === branch!.id);
  // One bolt apiece, and no blow back while the knight lines each one up.
  await game.configureCombat({ enemies: bodies.map(({ index }) => ({ index, hp: 1, cooldown: 30 })) });
  await game.equip('crossbow');
  await game.teleport(branch!.x * TILE, branch!.z * TILE);
  await game.step(200);
  for (let shot = 0; shot < 16; shot++) {
    const state = await game.state();
    const left = state.enemies.filter((enemy) => enemy.room === branch!.id);
    if (!left.length) break;
    const others = state.enemies.filter((enemy) => enemy !== left[0]).map((enemy) => ({ x: enemy.x, z: enemy.z }));
    let stance;
    try { stance = strikeStance(floor, left[0], { distance: 2.5, avoid: others, clearance: 0.8 }); } catch { stance = strikeStance(floor, left[0], { distance: 2 }); }
    await game.teleport(stance.x, stance.z);
    await page.keyboard.down(stance.key);
    await page.keyboard.down('Space');
    await page.keyboard.up(stance.key);
    await page.keyboard.up('Space');
    await game.step(900);
  }
  const after = await game.state();
  expect(after.enemies.filter((enemy) => enemy.room === branch!.id), 'every body in the dead end fell to a bolt').toEqual([]);
  expect(after.floor.cleared).toContain(branch!.id);
  expect(after.objective.deadEndsPlundered, 'the dead end counts as plundered').toBe(1);
  await expect(page.locator(`#map-room-${branch!.id}`), 'and is marked on the map as one').toHaveAttribute('fill', '#c2b273');
});
