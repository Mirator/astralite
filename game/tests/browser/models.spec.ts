import type { Page, TestInfo } from '@playwright/test';
import { deltaE, measureMasks, probeScene, readFlash } from './enemy-mask.ts';
import { canStand, expect, Game, openSpot, roomCentre, SCREEN_DIRECTIONS, speedOf, test } from './helpers.ts';

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

/**
 * Plan 011: the three enemy kinds, on the `models-cast` staging (shots.spec.ts) - the knight at the left
 * of a row in seed 0x86 floor 2's gate, facing the lens, and one guard, stalker and warden to his right,
 * held inside their notice beat. Its own page, because the masks reach the scene through three's
 * devtools hook, which has to be installed before the game boots (see `enemy-mask.ts`).
 */
test.describe('enemies', () => {
  test.use({ isolate: true });
  const KINDS = ['guard', 'stalker', 'warden'] as const;
  /** Before plan 011 (on 5137836): mean-Lab separation of the masks, actorStats heights, snapshot joints. */
  const B0 = {
    separation: { 'knight-guard': 10.46, 'knight-stalker': 16.75, 'knight-warden': 15.97, 'guard-stalker': 6.44, 'guard-warden': 15.77, 'stalker-warden': 18.37 },
    height: { guard: 1.6744, stalker: 1.61, warden: 2.339 },
    poses: {
      guard: { shieldArm: -0.16, shieldTilt: -Math.PI / 2, pitch: 0, height: 0, weapon: 0.1, weaponYaw: 0 },
      stalker: { shieldArm: 0, shieldTilt: -Math.PI / 2, pitch: -0.38, height: -0.18, weapon: 0.1, weaponYaw: 0 },
      warden: { shieldArm: 0, shieldTilt: -Math.PI / 2, pitch: 0, height: 0, weapon: 0.45, weaponYaw: 0 },
    },
  };
  /**
   * Visible meshes per kind, eyes and contact pool included (29 / 25 / 42 before). The plan asked for
   * 14 / 14 / 16; every joint now draws one mesh per material it carries, and going lower would mean
   * sharing a material across bodies, which would flash every enemy at once.
   */
  const MESHES = { guard: 18, stalker: 11, warden: 19 };

  const stageCast = async (page: Page, info: TestInfo) => {
    await probeScene(page);
    const game = await Game.open(page, info, [0x86, 0x86]);
    await game.enter();
    await game.buildFloor(2);
    await game.step(0);
    const floor = await game.floor();
    expect(floor.level).toBe(2);
    const right = SCREEN_DIRECTIONS.right, up = SCREEN_DIRECTIONS.up, centre = roomCentre(floor, 0);
    const mark = openSpot(floor, { x: centre.x - right.x * 3, z: centre.z - right.z * 3 }, { radius: 1.5 });
    // As shots.spec.ts's `settle`: face the lens, then stand still on the mark.
    await game.teleport(mark.x, mark.z);
    await page.keyboard.down('ArrowDown');
    await game.step(32);
    await page.keyboard.up('ArrowDown');
    await game.step(200);
    await game.teleport(mark.x, mark.z);
    await game.step(500);
    expect(speedOf(await game.state())).toBeLessThan(0.01);
    const staged = KINDS.map((kind, i) => {
      const index = floor.spawns.findIndex((spawn) => spawn.kind === kind && !spawn.ambush);
      expect(index).toBeGreaterThanOrEqual(0);
      const x = mark.x + right.x * 2 * (i + 1) + up.x * 0.9, z = mark.z + right.z * 2 * (i + 1) + up.z * 0.9;
      expect(canStand(floor.cells, x, z)).toBe(true);
      // No `windup` field: any windup skips the notice beat and the body walks at once.
      return { kind, index, x, z, cooldown: 999 };
    });
    await game.configureCombat({ enemies: staged.map(({ index, x, z, cooldown }) => ({ index, x, z, cooldown })) });
    await game.step(100);
    return { game, staged };
  };

  test('the cast: masks, separation, cost and joints per kind', async ({ page }, info) => {
    const { game, staged } = await stageCast(page, info);
    const state = await game.state();
    const { noise, masks } = await measureMasks(page, [{ name: 'knight', knight: true }, ...staged.map(({ kind, x, z }) => ({ name: kind, x, z }))]);
    const byName = Object.fromEntries(masks.map((mask) => [mask.name, mask]));
    const pairs: Record<string, number> = {};
    for (const [i, p] of masks.entries()) for (const q of masks.slice(i + 1)) pairs[`${p.name}-${q.name}`] = +deltaE(p.lab, q.lab).toFixed(2);
    console.log(`MASKS noise=${noise} ${JSON.stringify(masks.map((m) => ({ ...m, lab: m.lab.map((v) => +v.toFixed(2)) })))}`);
    console.log(`SEPARATION ${JSON.stringify(pairs)}`);
    const stats = await game.actorStats();
    const perKind = Object.fromEntries(KINDS.map((kind) => [kind, stats.enemies.find((enemy) => enemy.kind === kind)!]));
    console.log(`ENEMY-STATS ${JSON.stringify(perKind)}`);
    const poses = Object.fromEntries(staged.map(({ kind, index }) => [kind, (state.enemies[index] as unknown as { pose: Record<string, number | null> }).pose]));
    console.log(`ENEMY-POSES ${JSON.stringify(poses)}`);
    expect(noise, 'the frame moved with nothing hidden, so no mask can be trusted').toBeLessThan(50);
    for (const mask of masks) expect(mask.pixels, `${mask.name} left no mask`).toBeGreaterThan(200);
    // Regression guards, not targets: shape carries this plan, not colour. The floor is the before value
    // (the lower of d3d11 and SwiftShader) less one. The knight's pairs are re-measured when plan 010 lands.
    for (const [pair, before] of Object.entries(B0.separation)) expect(pairs[pair], `${pair} lost separation`).toBeGreaterThanOrEqual(before - 1);
    for (const kind of KINDS) {
      expect(byName[kind].pixels).toBeGreaterThan(0);
      expect(perKind[kind].meshes, `the ${kind} draws more meshes than plan 011 left it`).toBeLessThanOrEqual(MESHES[kind]);
      expect(Math.abs(perKind[kind].height - B0.height[kind]), `the ${kind} changed height`).toBeLessThanOrEqual(0.1);
      for (const [joint, value] of Object.entries(B0.poses[kind])) expect(poses[kind][joint], `the ${kind}'s ${joint} moved`).toBeCloseTo(value, 6);
    }
    await game.finish();
  });

  test('a windup still flashes the whole body of every kind', async ({ page }, info) => {
    const { game, staged } = await stageCast(page, info);
    for (const { kind, index } of staged) {
      await game.configureCombat({ enemies: [{ index, windup: 0.3 }] });
      await game.step(16);
      const enemy = (await game.state()).enemies[index];
      expect(enemy.windup, `the ${kind} is not winding up`).toBeGreaterThan(0);
      const flash = await readFlash(page, enemy);
      // THREAT, on the rig's own batch, on the skull and on the shield arm alike.
      expect(flash, `the ${kind}'s flash missed part of the body`).toEqual({ rig: 0xff4529, skull: 0xff4529, arm: 0xff4529 });
    }
    await game.finish();
  });
});
