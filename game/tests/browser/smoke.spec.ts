import { expect, test, WARM_UP } from './helpers.ts';

// The claim is that the real page boots: a pooled page would be answering for a boot that some
// earlier scenario paid for, which is not the same assertion. A fresh load pays the cold shader
// warm-up (see WARM_UP in helpers.ts), so the scenario gets room for it on top of the usual ceiling.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

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
