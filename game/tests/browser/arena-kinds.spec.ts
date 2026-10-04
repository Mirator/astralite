import { expect, hold, laneSpot, press, release, strikeStance, test, TILE, type Game } from './helpers.ts';
import type { Page } from '@playwright/test';

// The arena-only kinds (app/dungeon-bestiary.ts). Each rule is held in node - the shield in
// dungeon-hits.test.ts, the fire in dungeon-projectile.test.ts, raising and reassembling in dungeon-enemy.test.ts,
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
  await press(page, 'attack');
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

// Plan 022 D11: the Keep Crossbow's Heavy Bolt goes through a shield, an ordinary bolt does not. The rule is held in node (dungeon-bastion.test.ts, from the front, against the Bastion and the shieldbearer); this fires both with the real keys at a
// Bastion in the arena (its shield is the shieldbearer's, and holds in its first phase), whose shield is up (not winding, not recovering from its own swing), and reads what the running game did to it.
test('the Keep Crossbow\'s ordinary bolt is turned aside by the Bastion\'s shield, and the Heavy Bolt goes through it', async ({ game, page }) => {
  await arena(game, page, ['bastion']);
  await game.equip('crossbow');
  await game.step(120);
  const floor = await game.floor(), opening = await game.state();
  const spot = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  const stance = strikeStance(floor, spot, { distance: 3 });
  const perBolt = (opening.weapon as typeof opening.weapon & { special: { swing: { damage: number } } }).special.swing.damage;
  // Facing it, with the shield up: a short cooldown (a flinch's, under a recovery's) and no tell.
  const raise = async () => {
    await game.teleport(stance.x, stance.z);
    await page.keyboard.down(stance.key); await game.step(1); await page.keyboard.up(stance.key);
    await game.configureCombat({ enemies: [{ index: 0, x: spot.x, z: spot.z, cooldown: 0.3, windup: 0 }] });
  };
  await raise();
  const before = (await game.state()).enemies[0];
  await press(page, 'attack');
  await game.step(500);
  const turned = (await game.state()).enemies[0];
  expect(turned.blocked, 'the ordinary bolt never reached the shield, so nothing was tested').toBe(before.blocked + 1);
  expect(turned.hp, 'an ordinary bolt wounded a raised shield').toBe(before.hp);

  // Draw the whole quiver (it is refilling: wait for a bolt), let it go on the raised shield, and it goes through.
  await game.step(2500);
  await raise();
  await hold(page, 'special');
  await game.step(800);
  await raise();
  const bolts = (await game.state()).weapon.quiver!;
  expect(bolts, 'precondition: a drawn Heavy Bolt is worth at least two bolts').toBeGreaterThan(1);
  await release(page, 'special');
  await game.step(500);
  const struck = (await game.state()).enemies[0];
  expect(struck.blocked, 'the Heavy Bolt was turned aside by the shield').toBe(turned.blocked);
  expect(struck.hp, 'the Heavy Bolt did not wound the shield from the front').toBe(before.hp - bolts * perBolt);
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

test('a bonecaller raises two at a call, a rattler cut down while it stands goes back into the ground unpaid, and all of them crumble with it', async ({ game, page }) => {
  await arena(game, page, ['bonecaller']);
  const floor = await game.floor();
  const opening = await game.state();
  const caller = opening.enemies.find((e) => e.kind === 'bonecaller')!;
  const buried = () => game.state().then((s) => s.enemies.filter((e) => e.buried));
  expect((await buried()).length, 'the caller arrived with no reserve').toBe(4);
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
  for (let t = 0; t < 5000 && state.enemies.filter((e) => e.buried).length === 4; t += 50) { await game.step(50); state = await game.state(); }
  // One call, two bodies, on the same frame; the two still under have not been moved: nothing shoves a
  // body nobody can see.
  expect(state.enemies.filter((e) => e.buried).map((e) => [e.x, e.z]), 'a call raised other than two, or a buried body was pushed about').toEqual(graves.slice(2));
  const raised = state.enemies.filter((e) => e.kind === 'rattler' && !e.buried);
  expect(raised, 'the caller raised other than two').toHaveLength(2);
  expect(raised.every((e) => e.visible && e.awake), 'a raised body stayed hidden or asleep').toBe(true);
  const standing = state.enemies.find((e) => e.kind === 'bonecaller')!;
  for (const body of raised) expect(Math.hypot(body.x - standing.x, body.z - standing.z), 'a raised body did not stand beside its caller').toBeLessThan(2.5);
  expect(Math.hypot(raised[0].x - raised[1].x, raised[0].z - raised[1].z), 'the pair came up on top of each other').toBeGreaterThan(1);

  // Cut one down with a real strike while the caller stands: it goes back under the caller, whole and
  // hidden, and the kill pays nothing. (Were its partner caught by the same swing it would go back under
  // too, which changes none of what follows.)
  const target = state.enemies.indexOf(raised[0]);
  const cut = strikeStance(floor, { x: raised[0].x, z: raised[0].z });
  await game.teleport(cut.x, cut.z);
  await game.step(16);
  await game.configureCombat({ enemies: [{ index: target, hp: 1, cooldown: 3 }, { index: 0, windup: 0, cooldown: 5 }] });
  const paid = (await game.state()).experience.total;
  await strike(page, cut.key);
  for (let t = 0; t < 400 && !state.enemies[target].buried; t += 16) { await game.step(16); state = await game.state(); }
  const back = state.enemies[target];
  expect(state.enemies, 'a raised rattler died instead of going back into the ground').toHaveLength(5);
  expect(back.buried && !back.visible && !back.awake, 'the struck rattler never went back under').toBe(true);
  expect(back.hp, 'it went back under wounded').toBe(opening.enemies[target].hp);
  let home = state.enemies.find((e) => e.kind === 'bonecaller')!;
  // Under the caller as it stood when the blow landed; it may have taken a step since, the same frame.
  expect(Math.hypot(back.x - home.x, back.z - home.z), 'it went back under somewhere other than its caller').toBeLessThan(0.2);
  expect(state.experience.total, 'a rattler that went back into the ground paid out').toBe(paid);
  // And the next call raises it again: it is first in the reserve.
  await game.configureCombat({ enemies: [{ index: 0, windup: 0, cooldown: 0 }] });
  for (let t = 0; t < 4000 && state.enemies[target].buried; t += 50) { await game.step(50); state = await game.state(); }
  expect(state.enemies[target].buried, 'the caller never raised the rattler that went back under').toBe(false);
  home = state.enemies.find((e) => e.kind === 'bonecaller')!;

  // Put the caller down: everything it called goes with it, the rattler still standing as well as the
  // three under, and only the caller pays.
  const stance = strikeStance(floor, { x: home.x, z: home.z });
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({ enemies: [{ index: 0, hp: 1, cooldown: 3 }] });
  await strike(page, stance.key);
  for (let t = 0; t < 400 && state.enemies.some((e) => e.kind === 'bonecaller'); t += 16) { await game.step(16); state = await game.state(); }
  expect(state.enemies.some((e) => e.kind === 'bonecaller'), 'the strike never killed the caller').toBe(false);
  expect(state.enemies, 'something the caller raised outlived it').toEqual([]);
  expect(state.experience.total, 'the crumbled rattlers paid out, or the caller did not').toBe(paid + state.experience.perEnemy);
});
