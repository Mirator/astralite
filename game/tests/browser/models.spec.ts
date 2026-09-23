import { expect, test } from './helpers.ts';

// Structural guards for the model round (plans 009-011), read off the live scene through
// `dungeonTest.actorStats()`. What each figure looks like is judged on the contact sheet
// (`npm run shots:compare`, the `models` scenes in shots.spec.ts); what is held here is what a figure
// costs to draw and that swapping arms leaves nothing behind.

const ARMS = ['tideblade', 'fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask'];

test('actorStats reads the knight, every living enemy and the rack off the live scene', async ({ game }) => {
  await game.enter();
  const state = await game.state();
  const stats = await game.actorStats();
  console.log(`ACTORS ${JSON.stringify(stats)}`);
  expect(stats.knight.meshes).toBeGreaterThan(0);
  expect(stats.knight.triangles).toBeGreaterThan(0);
  // The knight is drawn about 1.75 tall; a height far off that means the reading, not the model, broke.
  expect(stats.knight.height).toBeGreaterThan(1.5);
  expect(stats.knight.height).toBeLessThan(2.3);
  expect(stats.enemies.map((enemy) => enemy.kind)).toEqual(state.enemies.map((enemy) => enemy.kind));
  for (const enemy of stats.enemies) expect(enemy.meshes, `a ${enemy.kind} reports no meshes`).toBeGreaterThan(0);
  expect(stats.drop?.kind).toBe(state.drop!.kind);
  // Plan 009: the arm, its plinth and collar, the glow and the ring - baked, a rack is at most eight.
  expect(stats.drop!.meshes, 'the rack is drawn as more than eight meshes').toBeLessThanOrEqual(8);
});

test('swapping through every arm and back to the Tideblade leaks no geometry', async ({ game }) => {
  await game.enter();
  // Drawn after every swap, so each arm's merged geometry is actually uploaded and counted before the
  // next swap releases it.
  await game.step(0, true);
  const before = await game.state();
  for (const id of [...ARMS.slice(1), 'tideblade']) {
    await game.equip(id);
    await game.step(0, true);
    expect((await game.state()).weapon.id).toBe(id);
  }
  const after = await game.state();
  expect(after.render.geometries, 'a swap left merged geometry behind').toBe(before.render.geometries);
});

test('tearing a floor down leaves the knight his own materials', async ({ game }) => {
  // The rack is built from the knight's palette, so a teardown that disposes everything on the floor
  // releases the steel, iron and brass he is still wearing. three.js recompiles a disposed material on
  // its next draw, which hides the fault from the eye and turns every descent into a shader stall.
  await game.enter();
  await game.step(0, true);
  const before = await game.actorStats();
  expect(before.drop, 'the fixture needs a rack on the floor being torn down').not.toBeNull();
  // Once with the rack as the floor laid it, once holding another arm so the rack is the Tideblade.
  await game.buildFloor(2);
  await game.step(0, true);
  await game.equip('maul');
  await game.buildFloor(3);
  await game.step(0, true);
  const after = await game.actorStats();
  expect(after.knight.disposedMaterials - before.knight.disposedMaterials, 'floor teardown disposed a material the knight still wears').toBe(0);
  expect(after.drop, 'the new floor laid no rack').not.toBeNull();
});

test('an arm taken up after the start casts a shadow like the one he started with', async ({ game }) => {
  // The knight's shadow flags are set once, over the figure he is built as; an arm built later has
  // to carry its own or the moon draws him empty-handed.
  await game.enter();
  const start = await game.actorStats();
  expect(start.knight.shadowless, 'the knight as built has a part that casts no shadow').toBe(0);
  for (const id of [...ARMS.slice(1), 'tideblade']) {
    await game.equip(id);
    expect((await game.actorStats()).knight.shadowless, `the ${id} casts no shadow`).toBe(0);
  }
});
