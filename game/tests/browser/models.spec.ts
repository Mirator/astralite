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
