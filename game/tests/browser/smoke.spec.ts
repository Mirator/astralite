import { expect, test } from './helpers.ts';

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
