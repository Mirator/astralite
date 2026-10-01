import { expect, test } from './helpers.ts';

// The boot itself is proven by every worker: the pool's page is opened through the same `Game.open`, which
// fails loudly if WebGL, the pinned floor or the hooks do not come up, and a GAME_TEST_ISOLATE run
// gives this scenario a fresh page of its own. What is left here is that a ready page shows a real floor and
// enters it, which the pooled page answers as well as a fresh one, without paying another cold boot.

test('the real page boots WebGL, pins its floor, and enters the keep', async ({
  game,
}) => {
  const ready = await game.state();
  expect(ready.mode).toBe('ready');
  // A null renderer would draw nothing; a real context reports live geometry.
  expect(ready.render.geometries).toBeGreaterThan(0);
  expect(ready.floor.level).toBe(1);
  expect(ready.floor.rooms.length).toBeGreaterThan(1);

  await game.enter();
  await game.step(100);
  const playing = await game.state();
  expect(playing.mode).toBe('playing');
  expect(playing.health).toBe(playing.maxHealth);
});
