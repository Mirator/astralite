import { expect, laneSpot, strikeStance, test, TILE, type Game } from './helpers.ts';
import type { Page } from '@playwright/test';

// The arena-only kinds (app/dungeon-bestiary.ts). Each rule is held in node - the shield in
// dungeon-hits.test.ts, the fire in dungeon-projectile.test.ts, raising and blinking in dungeon-enemy.test.ts,
// the buried reserve in dungeon-arena.test.ts. These check the running game is wired to them, with a real
// strike where the rule is about a strike. The reaper and the rattler resolve through the same `intent.hit`
// path every swing does, which gameplay.spec.ts already drives, so they have nothing of their own here.

const arena = async (game: Game, page: Page, roster: string[]) => {
  await page.evaluate((kinds) => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(kinds, 1), roster);
  await game.enter();
};

/** One tap of the strike key, facing along `key` first so the swing goes where the body is. */
const strike = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await page.keyboard.press('Space');
  await page.keyboard.up(key);
};

test('a shieldbearer turns a frontal strike aside while its shield is up, and takes one while it recovers', async ({ game, page }) => {
  await arena(game, page, ['shieldbearer']);
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind)).toEqual(['shieldbearer']);
  const anchor = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  const stance = strikeStance(floor, anchor);
  await game.teleport(stance.x, stance.z);
  await game.step(16); // it turns to face him
  // Shield up: not winding, and no more on its clock than a plain flinch leaves.
  await game.configureCombat({ enemies: [{ index: 0, windup: 0, cooldown: 0.3 }] });
  const before = (await game.state()).enemies[0];
  await strike(page, stance.key);
  await game.step(200);
  const turned = (await game.state()).enemies[0];
  expect(turned.blocked, 'the strike never reached the shield, so nothing was tested').toBe(before.blocked + 1);
  expect(turned.hp, 'a frontal strike wounded a raised shield').toBe(before.hp);

  // The opening: recovering from its own swing, the shield is down and the same strike lands.
  await game.step(500);
  await game.configureCombat({ enemies: [{ index: 0, windup: 0, cooldown: 1.2 }] });
  const open = await game.state();
  await strike(page, stance.key);
  await game.step(200);
  const struck = (await game.state()).enemies[0];
  expect(struck.blocked, 'a strike during its recovery was turned aside').toBe(open.enemies[0].blocked);
  expect(struck.hp).toBe(open.enemies[0].hp - open.weapon.strikeDamage);
});

test('a pyre leaves fire where it falls, and the fire burns the knight standing in it', async ({ game, page }) => {
  await arena(game, page, ['pyre']);
  const floor = await game.floor();
  const opening = await game.state();
  const anchor = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  const stance = strikeStance(floor, anchor);
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({ enemies: [{ index: 0, hp: 1, cooldown: 2 }] });
  const before = (await game.state()).health;
  await strike(page, stance.key);
  let state = await game.state();
  for (let t = 0; t < 400 && !state.hostilePools.length; t += 16) { await game.step(16); state = await game.state(); }
  expect(state.enemies, 'the pyre never fell').toEqual([]);
  expect(state.hostilePools, 'the pyre fell and left no fire').toHaveLength(1);
  const fire = state.hostilePools[0];
  expect(Math.hypot(fire.x - anchor.x * 1, fire.z - anchor.z * 1)).toBeLessThan(1.2);
  expect(Math.hypot(state.player.x - fire.x, state.player.z - fire.z), 'precondition: the knight stands in the fire').toBeLessThan(fire.radius);
  for (let t = 0; t < 1000 && state.health === before; t += 50) { await game.step(50); state = await game.state(); }
  expect(state.health, 'standing in the fire cost the knight nothing').toBe(before - Math.round(fire.damage * state.boons.guardAgainst));
});

test('a bonecaller raises its buried reserve one at a time, and what it had not raised crumbles when it falls', async ({ game, page }) => {
  await arena(game, page, ['bonecaller']);
  const floor = await game.floor();
  const opening = await game.state();
  const caller = opening.enemies.find((e) => e.kind === 'bonecaller')!;
  const buried = () => game.state().then((s) => s.enemies.filter((e) => e.buried));
  expect((await buried()).length, 'the caller arrived with no reserve').toBe(3);
  expect((await buried()).every((e) => !e.visible && !e.awake), 'a buried body was on show or awake').toBe(true);
  const graves = (await buried()).map((e) => [e.x, e.z]);
  // Out of the gate and back in: the arrival springs any ambush in the room, and must not raise the dead.
  const outside = floor.tiles.find((t) => t.room !== floor.start && t.room >= 0)!;
  await game.teleport(outside.x * TILE, outside.z * TILE);
  await game.step(50);
  const anchor = { x: caller.x, z: caller.z };
  const far = laneSpot(floor, anchor, 6, { clearance: 0 });
  await game.teleport(far.x, far.z);
  await game.step(50);
  expect((await buried()).every((e) => !e.visible && !e.awake), 'walking back into the gate raised the buried').toBe(true);
  let state = await game.state();
  for (let t = 0; t < 5000 && state.enemies.filter((e) => e.buried).length === 3; t += 100) { await game.step(100); state = await game.state(); }
  // Still underground, the rest have not been moved: nothing shoves a body nobody can see.
  expect(state.enemies.filter((e) => e.buried).map((e) => [e.x, e.z]), 'a buried body was pushed about').toEqual(graves.slice(1));
  const raised = state.enemies.filter((e) => e.kind === 'rattler' && !e.buried);
  expect(raised, 'the caller never raised anything').toHaveLength(1);
  expect(raised[0].visible && raised[0].awake, 'a raised body stayed hidden or asleep').toBe(true);
  const standing = state.enemies.find((e) => e.kind === 'bonecaller')!;
  expect(Math.hypot(raised[0].x - standing.x, raised[0].z - standing.z), 'the raised body did not stand beside its caller').toBeLessThan(2.5);

  // Put the caller down: the two still buried go with it, the one already up does not.
  const stance = strikeStance(floor, { x: standing.x, z: standing.z });
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({ enemies: [{ index: 0, hp: 1, cooldown: 3 }] });
  await strike(page, stance.key);
  for (let t = 0; t < 400 && state.enemies.some((e) => e.kind === 'bonecaller'); t += 16) { await game.step(16); state = await game.state(); }
  expect(state.enemies.some((e) => e.kind === 'bonecaller'), 'the strike never killed the caller').toBe(false);
  expect(state.enemies.filter((e) => e.buried), 'the reserve outlived its caller').toEqual([]);
  expect(state.enemies.filter((e) => e.kind === 'rattler'), 'a raised rattler crumbled too').toHaveLength(1);
});

test('a wraith cannot be struck while under, comes up on its mark, and misses a knight who left it', async ({ game, page }) => {
  await arena(game, page, ['wraith']);
  const floor = await game.floor();
  const opening = await game.state();
  const anchor = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  const far = laneSpot(floor, anchor, 5, { clearance: 0 });
  await game.teleport(far.x, far.z);
  let state = await game.state();
  for (let t = 0; t < 3000 && !state.enemies[0].mark; t += 50) { await game.step(50); state = await game.state(); }
  const mark = state.enemies[0].mark;
  expect(mark, 'the wraith never set a mark').not.toBeNull();
  expect(Math.hypot(mark!.x - state.player.x, mark!.z - state.player.z), 'the mark is not beside the knight').toBeLessThan(1.6);

  // Under: a strike at it passes through. Walking up to it also takes the knight off the mark.
  const under = state.enemies[0];
  const stance = strikeStance(floor, { x: under.x, z: under.z });
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  const ready = await game.state(), health = ready.health;
  expect(ready.enemies[0].windup, 'precondition: enough of the tell is left for a strike to land in it').toBeGreaterThan(0.3);
  await strike(page, stance.key);
  await game.step(120);
  state = await game.state();
  expect(state.enemies[0].hp, 'a strike wounded a wraith under the floor').toBe(under.hp);
  expect(state.enemies[0].windup, 'the strike knocked the wraith out of its tell').toBeGreaterThan(0);
  for (let t = 0; t < 1500 && state.enemies[0].windup > 0; t += 16) { await game.step(16); state = await game.state(); }
  expect([state.enemies[0].x, state.enemies[0].z], 'the wraith did not come up on its mark').toEqual([mark!.x, mark!.z]);
  expect(Math.hypot(state.player.x - mark!.x, state.player.z - mark!.z), 'precondition: the knight left the mark').toBeGreaterThan(1.5);
  expect(state.health, 'the blow found a knight who was no longer on the mark').toBe(health);
});
