import { ARROW_KEYS, expect, laneSpot, press, SCREEN_DIRECTIONS, settleBoss, strikeStance, test, TILE, canStand, hasClearPath, GameError, type Floor, type Game, type ScreenDirection } from './helpers.ts';
import type { Page } from '@playwright/test';
import { BESTIARY, reserveSize } from '../../app/dungeon-bestiary.ts';

// Plan 021 Stage B: the Drowned Captain, in the running game. The rules are held in node - the row and its rotation in dungeon-captain.test.ts, the
// phase change, the push and the unhittable second in dungeon-enemy.test.ts and dungeon-hits.test.ts, the deal in dungeon-floor.test.ts, the pay in
// dungeon-sim.test.ts and dungeon-meta.test.ts. These check the running game is wired to them: that the boss bar and the cue the real tell draws are on
// screen, that a real strike carries the boss through its phase and the change takes the knight out of its reach, that it bars the stair on a
// generated floor, and that the bar fits a phone. Every page boots with `?boss=captain` (helpers.ts `DEFAULT_BOSS`), so none of this searches for a boss.

const arena = async (game: Game, page: Page, kind = 'captain') => {
  await page.evaluate((roster) => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena([roster], 1), kind);
  await game.enter();
};

/** One tap of the strike key, facing along `key` first so the swing goes where the body is. */
const strike = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await press(page, 'attack');
  await page.keyboard.up(key);
};

/** The boss as the snapshot has it, which every scenario here needs to exist before it asks anything of it. */
const bossOf = async (game: Game) => {
  const boss = (await game.state()).boss;
  expect(boss, 'the floor holds no boss').not.toBeNull();
  return boss!;
};

/** Steps the clock by hand until the boss begins a new tell, and returns that frame's boss. */
const nextTell = async (game: Game, limit = 6000) => {
  let was = (await bossOf(game)).windup;
  for (let waited = 0; waited < limit; waited += 16) {
    await game.step(16);
    const boss = await bossOf(game);
    if (was === 0 && boss.windup > 0) return boss;
    was = boss.windup;
  }
  throw new GameError(`the boss began no tell in ${limit} ms\n${await game.report()}`);
};

/**
 * Steps the clock by hand until the boss is in a tell of this attack, and returns that frame's boss. `between` runs before each step: the scenarios that need the knight kept alive and
 * in range while the boss works through its rotation put him there in it.
 */
const tellOf = async (game: Game, attack: string, between: () => Promise<void> = async () => {}, limit = 20000) => {
  for (let waited = 0; waited < limit; waited += 50) {
    await between();
    await game.step(50);
    const boss = await bossOf(game);
    if (boss.windup > 0 && boss.attack === attack) return boss;
  }
  throw new GameError(`the boss never began a ${attack} tell in ${limit} ms\n${await game.report()}`);
};

/**
 * Somewhere to stage the phase change: a spot for the boss and a stance a pace from it, with the floor open on the line straight on through the knight for `room` more. A stance with a wall
 * behind it is one the push cannot be seen in, so none is used: the boss is moved (a fixture, like a teleport) to the first tile of the chamber that has one, nearest its heart first.
 */
const stageFor = (floor: Floor, chamber: number, room: number) => {
  const heart = { x: floor.rooms[chamber].x * TILE, z: floor.rooms[chamber].z * TILE };
  const tiles = floor.tiles.filter((t) => t.room === chamber).map((t) => ({ x: t.x * TILE, z: t.z * TILE })).sort((a, b) => Math.hypot(a.x - heart.x, a.z - heart.z) - Math.hypot(b.x - heart.x, b.z - heart.z));
  for (const boss of tiles) {
    if (!canStand(floor.cells, boss.x, boss.z)) continue;
    for (const name of Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]) {
      const way = SCREEN_DIRECTIONS[name], spot = { x: boss.x - way.x * 1.05, z: boss.z - way.z * 1.05 }, far = { x: boss.x - way.x * (1.05 + room), z: boss.z - way.z * (1.05 + room) };
      if (canStand(floor.cells, spot.x, spot.z) && hasClearPath(floor.cells, spot, boss) && canStand(floor.cells, far.x, far.z) && hasClearPath(floor.cells, spot, far)) return { boss, ...spot, key: ARROW_KEYS[name] };
    }
  }
  throw new GameError(`no tile of chamber ${chamber} has a stance with ${room} units of floor behind it\npick another seed for this scenario`);
};

test('the fight is wired: the Captain winds up its moves in order with each move\'s own cue, the boss bar names it, and its floating bar stays hidden', async ({ game, page }) => {
  await arena(game, page);
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind)).toEqual(['captain']);
  const captain = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  // Hurt, so an ordinary body would be wearing its floating bar: the bar being hidden then says something.
  await game.configureCombat({ enemies: [{ index: 0, hp: 50 }] });
  const spot = laneSpot(floor, captain, 2.4);
  await game.teleport(spot.x, spot.z);
  const first = await nextTell(game);
  expect(first.hp, 'precondition: the Captain is hurt, so a floating bar would show').toBe(50);
  expect(first.maxHp).toBe(60);
  expect([first.attack, first.cue.visible, first.cue.shape], 'its first move was not a swing drawn as an arc').toEqual(['swing', true, 'arc']);
  expect(first.bar, 'its own floating bar was showing beside the boss bar').toBe(false);
  // The bar at the top of the screen: its name, its vitality as the boss has it, and a tick at the phase threshold.
  const bar = page.locator('.boss-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('role', 'progressbar');
  await expect(bar).toHaveAttribute('aria-label', 'The Drowned Captain');
  await expect(bar).toHaveAttribute('aria-valuenow', '50');
  await expect(bar).toHaveAttribute('aria-valuemax', '60');
  await expect(bar.locator('u')).toHaveCount(1);
  const ticked = await bar.evaluate((node) => (node.querySelector('u') as HTMLElement).style.left);
  expect(ticked, 'the tick is not at the half way phase').toBe('50%');
  // The rest of the rotation, as the real fight plays it: swing, then a sweep drawn as the ring it reaches, each with a cue of its own.
  const tells = [[first.attack, first.cue.shape]];
  for (let n = 0; n < 2; n++) { const boss = await nextTell(game); tells.push([boss.attack, boss.cue.shape]); }
  expect(tells, 'phase one is swing, swing, sweep, each drawn as its own cue').toEqual([['swing', 'arc'], ['swing', 'arc'], ['sweep', 'ring']]);
});

test('the phase is wired: a real strike takes it below half, it is unhittable for its window and rings at its feet, and the knight is pushed out of its reach', async ({ game, page }) => {
  await arena(game, page);
  const floor = await game.floor();
  const stance = stageFor(floor, floor.start, 3.6);
  // One blow above the threshold, and the Captain held quiet (and moved where the push has room to show) so nothing it does is in the way of the strike.
  await game.configureCombat({ enemies: [{ index: 0, x: stance.boss.x, z: stance.boss.z, hp: 31, windup: 0, cooldown: 5 }] });
  await game.teleport(stance.x, stance.z);
  await game.step(16); // it turns to face him
  const before = await bossOf(game);
  expect([before.phase, before.unhittable, before.hp]).toEqual([0, false, 31]);
  const damage = (await game.state()).weapon.strikeDamage;
  expect(31 - damage, 'precondition: one blow of this arm carries it under half of 60').toBeLessThan(30);
  await strike(page, stance.key);
  let boss = await bossOf(game);
  for (let waited = 0; waited < 600 && boss.phase === 0; waited += 16) { await game.step(16); boss = await bossOf(game); }
  expect(boss.hp, 'the blow never landed, so no phase was crossed by it').toBeLessThan(30);
  expect(boss.phase, 'it fell below half and did not change phase').toBe(1);
  await game.step(32); // the ring is drawn from the frame after the one that decides the change
  boss = await bossOf(game);
  expect([boss.unhittable, boss.surge], 'the change showed no ring at its feet, or left it hittable').toEqual([true, true]);
  await expect(page.locator('.chamber-notice')).toContainText('The Captain draws the tide');
  // The push: out past its largest reach (a sweep of 3.6) with the margin it is pushed to, with a wall nowhere near.
  const state = await game.state();
  const gap = Math.hypot(state.player.x - state.enemies[0].x, state.player.z - state.enemies[0].z);
  expect(gap, 'the change left the knight inside the Captain\'s reach').toBeGreaterThanOrEqual(3.6 + 0.6 - 0.05);
  // Nothing hurts it inside the window: the knight steps back in and lands a real blow, and the Captain loses nothing.
  const held = boss.hp;
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  expect((await bossOf(game)).unhittable, 'precondition: the window is still open when the blow is struck').toBe(true);
  await strike(page, stance.key);
  await game.step(200);
  const struck = await bossOf(game);
  expect(struck.unhittable, 'precondition: the window was still open when the blow resolved').toBe(true);
  expect(struck.hp, 'a blow landed on the Captain while it changed phase').toBe(held);
  // And once the window is over the same blow from the same place does land: the blow above was not simply missing.
  const calm = await settleBoss(game);
  expect(calm.phase).toBe(1);
  await game.configureCombat({ enemies: [{ index: 0, windup: 0, cooldown: 5 }] });
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await strike(page, stance.key);
  await game.step(200);
  expect((await bossOf(game)).hp, 'a blow after the window did not land').toBe(held - damage);
});

test('it bars the stair on a generated floor: sealed while the Captain stands, open when it falls, and the floor card counts it', async ({ game, page }) => {
  test.slow();
  await game.enter();
  const opening = await game.state();
  expect(opening.boss?.kind, 'floor one of the pinned seed holds no Captain').toBe('captain');
  const stairBodies = (s: Awaited<ReturnType<Game['state']>>) => s.enemies.filter((e) => e.room === s.floor.goal && !e.buried);
  expect(stairBodies(opening).map((e) => e.kind), 'the stair hall holds more than the boss').toEqual(['captain']);
  const goal = opening.floor.rooms[opening.floor.goal];
  await game.teleport(goal.x * TILE, goal.z * TILE);
  await game.step(60);
  await expect(page.locator('.chamber-notice')).toContainText('The Drowned Captain bars the stair');
  const sealed = await game.state();
  expect([sealed.objective.stairClear, sealed.objective.stairOpen], 'the stair was not sealed behind the Captain').toEqual([false, false]);
  // One blow from death - and so under both its thresholds, which is a phase change to wait out before a blow can land (settleBoss).
  await game.configureCombat({ enemies: [{ index: opening.enemies.indexOf(opening.enemies.find((e) => e.kind === 'captain')!), hp: 1 }] });
  await settleBoss(game);
  await game.step(300);
  const standing = await game.state();
  expect(standing.boss, 'the Captain fell before it was struck').not.toBeNull();
  expect(standing.objective.stairOpen, 'the stair opened with the Captain still standing').toBe(false);
  const xpBefore = standing.experience.total;
  const floor = await game.floor();
  let state = standing;
  for (let swing = 0; swing < 40 && state.boss; swing++) {
    const target = state.boss;
    expect(state.mode, `the knight died on the way to the Captain\n${await game.report()}`).toBe('playing');
    const at = state.enemies.find((e) => e.kind === target.kind)!;
    const stance = strikeStance(floor, { x: at.x, z: at.z });
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    await strike(page, stance.key);
    await game.step(240);
    state = await game.state();
  }
  expect(state.boss, 'a real strike never felled the Captain').toBeNull();
  expect([state.objective.stairClear, state.objective.stairOpen], 'its fall did not open the stair').toEqual([true, true]);
  await expect(page.locator('.boss-bar'), 'the boss bar outlived the boss').toBeHidden();
  expect(state.experience.perBoss, 'what a boss pays (D10)').toBe(100);
  expect(state.experience.total - xpBefore, 'the boss paid something other than its own reward').toBe(state.experience.perBoss);
  // The floor card counts the Captain as the one body of its hall, with the boss's XP.
  await game.teleport(state.stair.x, state.stair.z);
  await game.step(64);
  await page.keyboard.press('KeyE');
  await game.step(32);
  expect((await game.state()).mode).toBe('complete');
  const results = await page.locator('.floor-results strong').allInnerTexts();
  expect(Number(results[0]), 'the card did not count the boss as felled').toBeGreaterThanOrEqual(1);
  expect(Number(results[1]), 'the card did not tally the boss\'s XP').toBe(state.experience.total - opening.experience.total);
});

/**
 * `count` places in the arena's chamber to stand at, 3.5 to 7.5 from `boss` on a clear line, no two within 2.4 of each other: the spots a scenario walks the knight between so his trail holds
 * that many places for a scatter to mark (`SCATTER_SPACING` is 2). Throws if the chamber has too few, so a seed that cannot stage this says so.
 */
const standingSpots = (floor: Floor, boss: { x: number; z: number }, count: number) => {
  const tiles = floor.tiles.filter((t) => t.room === floor.start).map((t) => ({ x: t.x * TILE, z: t.z * TILE }))
    .filter((spot) => { const gap = Math.hypot(spot.x - boss.x, spot.z - boss.z); return gap >= 3.5 && gap <= 7.5 && canStand(floor.cells, spot.x, spot.z) && hasClearPath(floor.cells, spot, boss); })
    .sort((a, b) => Math.hypot(a.x - boss.x, a.z - boss.z) - Math.hypot(b.x - boss.x, b.z - boss.z));
  const picked: { x: number; z: number }[] = [];
  for (const spot of tiles) if (picked.every((other) => Math.hypot(other.x - spot.x, other.z - spot.z) >= 2.4) && picked.length < count) picked.push(spot);
  if (picked.length < count) throw new GameError(`the arena's chamber has ${picked.length} spots 3.5 to 7.5 from the boss that are 2.4 apart, not ${count}\npick another seed for this scenario`);
  return picked;
};

/** Walks the knight between `spots`, a step at a time, a quarter second at each (so each lands in his trail), and keeps him alive: what the scenarios pass as `between`. */
const pacing = (game: Game, spots: { x: number; z: number }[]) => {
  let turn = 0;
  return async () => {
    if (turn % 6 === 0) { const spot = spots[(turn / 6) % spots.length]; await game.teleport(spot.x, spot.z); await game.configureCombat({ health: 100 }); }
    turn++;
  };
};

test('the Pyre Mother is wired: a lane drawn for her fan, the bar names her, the fan is every bolt drawn, and below half it is the five-bolt fan', async ({ game, page }) => {
  await arena(game, page, 'mother');
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind)).toEqual(['mother']);
  const spot = laneSpot(floor, { x: opening.enemies[0].x, z: opening.enemies[0].z }, 6);
  await game.teleport(spot.x, spot.z);
  const first = await nextTell(game);
  expect([first.attack, first.cue.visible, first.cue.shape, first.bar], 'her first move was not a volley drawn as a lane, with no floating bar').toEqual(['volley', true, 'lane', false]);
  const bar = page.locator('.boss-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'The Pyre Mother');
  await expect(bar).toHaveAttribute('aria-valuemax', '50');
  // The fan, as it flies: every bolt of it is an arrow on the screen, the aimed one and then the two either side.
  const fanOf = (phase: number) => BESTIARY.mother.moves![phase][0].bolt!.fan!;
  const bolts = async () => {
    let state = await game.state();
    for (let waited = 0; waited < 2000 && !state.hostileBolts.length; waited += 16) { await game.step(16); state = await game.state(); }
    return state;
  };
  let state = await bolts();
  expect(fanOf(0).count, 'precondition: phase one looses a fan of more than one').toBeGreaterThan(1);
  expect(state.hostileBolts.map((b) => b.kind), 'the fan was not all in the air at once').toEqual(Array(fanOf(0).count).fill('mother'));
  expect(state.arrowsDrawn, 'a bolt of the fan has no arrow drawn').toBe(fanOf(0).count);
  // Below half: one blow short of the threshold is hp 25 and she changes phase on 24. Her densest volley is then the whole fan, and the twelve-arrow pool holds all of it.
  await game.step(2500);
  await game.configureCombat({ health: 100, enemies: [{ index: 0, hp: 24 }] });
  const calm = await settleBoss(game);
  expect(calm.phase, 'she did not change phase under half').toBe(1);
  await expect(page.locator('.chamber-notice')).toContainText('The Pyre Mother kindles');
  await game.configureCombat({ health: 100 });
  await game.teleport(spot.x, spot.z);
  expect((await tellOf(game, 'volley')).phase, 'the volley is not a phase two one').toBe(1);
  state = await bolts();
  expect(fanOf(1).count, 'precondition: phase two looses a wider fan than phase one').toBeGreaterThan(fanOf(0).count);
  expect(state.hostileBolts.length, `her densest volley is ${fanOf(1).count} bolts and ${state.hostileBolts.length} were loosed`).toBe(fanOf(1).count);
  expect(state.arrowsDrawn, 'a bolt of the five-bolt fan has no arrow drawn: the pool ran dry').toBe(fanOf(1).count);
});

test('a scatter marks rings where the knight has been, lights them where they were marked, and the fire bites a knight inside it and not outside', async ({ game, page }) => {
  await arena(game, page, 'mother');
  const floor = await game.floor();
  const opening = await game.state();
  const mother = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  const spots = standingSpots(floor, mother, 3);
  const marking = await tellOf(game, 'scatter', pacing(game, spots));
  expect(marking.cue.shape, 'the scatter was not drawn as the ring at her feet').toBe('ring');
  let state = await game.state();
  const marks = state.scatterMarks;
  expect(marks.length, 'phase one marks two rings').toBe(BESTIARY.mother.moves![0][2].scatter!.rings);
  expect(marks.every((m) => m.drawn && m.threat), 'a marked ring was not drawn in the tell\'s colour').toBe(true);
  for (const mark of marks) expect(spots.some((s) => Math.hypot(s.x - mark.x, s.z - mark.z) < 0.05), `a ring was marked at ${mark.x.toFixed(2)}, ${mark.z.toFixed(2)}, where the knight had not stood`).toBe(true);
  expect(Math.hypot(marks[0].x - marks[1].x, marks[0].z - marks[1].z), 'two rings were marked on one spot').toBeGreaterThanOrEqual(2);
  for (const mark of marks) expect(Math.hypot(mark.x - state.enemies[0].x, mark.z - state.enemies[0].z), 'a ring was marked at the Mother\'s feet').toBeGreaterThan(2);
  expect(state.hostilePools, 'fire was burning before the tell ran out').toHaveLength(0);
  // The tell runs out: each marked ring is a pool of the move's own fire, where it was marked, on the ring that marked it.
  for (let waited = 0; waited < 3000 && state.scatterMarks.length; waited += 16) { await game.step(16); state = await game.state(); }
  expect(state.scatterMarks, 'the rings never lit').toHaveLength(0);
  const fire = BESTIARY.mother.moves![0][2].scatter!.pool;
  expect(state.hostilePools.length, 'a marked ring did not become a pool').toBe(marks.length);
  for (const pool of state.hostilePools) {
    expect([pool.kind, pool.radius, pool.drawn]).toEqual(['mother', fire.radius, true]);
    expect(marks.some((m) => Math.hypot(m.x - pool.x, m.z - pool.z) < 0.05), `a pool burns at ${pool.x.toFixed(2)}, ${pool.z.toFixed(2)}, where no ring was marked`).toBe(true);
  }
  // A knight standing in a pool is bitten once in its interval, and one standing outside all of them is not.
  const pools = state.hostilePools;
  await game.configureCombat({ health: 100 });
  await game.teleport(pools[0].x, pools[0].z);
  await game.step(650);
  const inside = await game.state();
  expect(inside.hostilePools.length, 'precondition: the fire is still burning').toBe(pools.length);
  expect(100 - inside.health, 'a knight standing in the fire was not bitten once').toBe(fire.damage);
  const outside = floor.tiles.filter((t) => t.room === floor.start).map((t) => ({ x: t.x * TILE, z: t.z * TILE }))
    .find((spot) => canStand(floor.cells, spot.x, spot.z) && pools.every((p) => Math.hypot(p.x - spot.x, p.z - spot.z) > fire.radius + 1));
  if (!outside) throw new GameError('no spot of the chamber lies outside every pool\npick another seed for this scenario');
  await game.configureCombat({ health: 100 });
  await game.teleport(outside.x, outside.z);
  await game.step(450);
  const clear = await game.state();
  expect(clear.hostilePools.length, 'precondition: the fire was still burning when the knight stood outside it').toBe(pools.length);
  expect(clear.health, 'a knight outside the fire was burned').toBe(100);
});

test('with the knight\'s own fire on the ground she marks no more rings than are free, and every ring she marks is drawn', async ({ game, page }) => {
  await arena(game, page, 'mother');
  await game.equip('flask');
  const floor = await game.floor();
  const opening = await game.state();
  const spots = standingSpots(floor, { x: opening.enemies[0].x, z: opening.enemies[0].z }, 3);
  // Below half she scatters three rings, twice running: the second is marked while the first three still burn, and the knight's own flask then takes one of the six.
  await game.configureCombat({ enemies: [{ index: 0, hp: 24 }] });
  await settleBoss(game);
  const pace = pacing(game, spots);
  await tellOf(game, 'scatter', pace);
  let state = await game.state();
  for (let waited = 0; waited < 3000 && !state.hostilePools.length; waited += 16) { await game.step(16); state = await game.state(); }
  const wanted = BESTIARY.mother.moves![1][2].scatter!.rings;
  expect(state.hostilePools.length, 'precondition: the first scatter lit its three rings').toBe(wanted);
  await game.configureCombat({ health: 100 });
  await press(page, 'attack');
  // He keeps walking between his spots throughout (the second scatter marks off the last two seconds of his trail, and a knight who stood still would give it one ring to mark).
  for (let waited = 0; waited < 1500 && !(await game.state()).weapon.fires; waited += 50) { await pace(); await game.step(50); }
  state = await game.state();
  expect(state.weapon.fires, 'precondition: the flask broke into fire').toBeGreaterThan(0);
  expect(state.hostilePools.length, 'precondition: her first rings are still burning when she marks the second').toBe(wanted);
  const second = await tellOf(game, 'scatter', pace);
  expect(second.windup, 'precondition: this is the second scatter\'s tell').toBeGreaterThan(0);
  state = await game.state();
  const free = Math.max(0, 6 - state.hostilePools.length - state.weapon.fires);
  expect(free, 'precondition: fewer rings are free than the three she wants').toBeLessThan(wanted);
  expect(state.scatterMarks.length, `she marked ${state.scatterMarks.length} rings with only ${free} free`).toBeLessThanOrEqual(free);
  expect(state.scatterMarks.every((m) => m.drawn), 'a ring she marked is not drawn').toBe(true);
  expect(state.hostileRings, 'the rings showing are not the pools burning and the rings marked').toBe(state.hostilePools.length + state.scatterMarks.length);
});

test('the Tide Hound is wired: a lane drawn for its pounce, the bar names it, and below half its second pounce follows the first with no recovery between', async ({ game, page }) => {
  await arena(game, page, 'hound');
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind)).toEqual(['hound']);
  const spot = laneSpot(floor, { x: opening.enemies[0].x, z: opening.enemies[0].z }, 4);
  await game.teleport(spot.x, spot.z);
  const first = await nextTell(game);
  expect([first.attack, first.cue.visible, first.cue.shape, first.bar], 'its first move was not a pounce drawn as a lane, with no floating bar').toEqual(['pounce', true, 'lane', false]);
  const bar = page.locator('.boss-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'The Tide Hound');
  await expect(bar).toHaveAttribute('aria-valuemax', '45');
  // Below half: the threshold is 22.5, so 22 is under it. The change is wired (the notice, the second phase) and the Hound's tells are the shorter ones.
  await game.step(1500);
  await game.configureCombat({ health: 100, enemies: [{ index: 0, hp: 22 }] });
  const calm = await settleBoss(game);
  expect(calm.phase, 'it did not change phase under half').toBe(1);
  await expect(page.locator('.chamber-notice')).toContainText('The Tide Hound howls');
  // The chain, as the running game plays it: a pounce's tell, its leap, and the next tell begins straight off the leap, in the chained slot. An unchained pounce would recover for the Hound's
  // whole recovery (1.3 s) first. The knight is brought back into its reach and kept alive, so it keeps coming at him.
  const hold = async () => { await game.configureCombat({ health: 100 }); await game.teleport(spot.x, spot.z); };
  await hold();
  let boss = await tellOf(game, 'pounce', hold);
  expect([boss.phase, boss.move], 'the pounce it opened with is not phase two\'s first').toEqual([1, 0]);
  const opened = boss.windup;
  expect(opened, 'phase two\'s pounce tell is not the shortened one').toBeLessThan(BESTIARY.hound.moves![0][0].tell);
  // Step by hand through the tell and the leap, counting the frames with no tell running, until the next tell begins.
  let quiet = 0, chained: typeof boss | null = null;
  for (let waited = 0; waited < 2500 && !chained; waited += 16) {
    await game.step(16);
    boss = await bossOf(game);
    if (boss.windup === 0) quiet++;
    else if (quiet > 0) chained = boss;
  }
  expect(chained, 'no second tell followed the pounce').not.toBeNull();
  expect([chained!.attack, chained!.move], 'the second tell was not the chained pounce').toEqual(['pounce', 1]);
  expect(chained!.windup, 'the chained pounce\'s tell is not the short re-aim').toBeLessThan(opened);
  expect(quiet * 16, `the chained pounce began ${quiet * 16} ms after the first tell ended: the leap (320 ms) is all that should lie between`).toBeLessThan(320 + 160);
  // The knight stood in the lane, so the leap ended on him: it ran between the two tells and cost him what a pounce costs.
  expect(quiet, 'precondition: the first leap ran between the two tells').toBeGreaterThan(0);
  expect((await game.state()).health, 'precondition: the first pounce connected').toBeLessThanOrEqual(100 - BESTIARY.hound.moves![1][0].damage);
});

test('the Bastion is wired: a swing\'s arc, the bar names it, a real strike is turned aside by its shield in phase one and wounds it in phase two, when the shield is gone', async ({ game, page }) => {
  await arena(game, page, 'bastion');
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind)).toEqual(['bastion']);
  const anchor = { x: opening.enemies[0].x, z: opening.enemies[0].z };
  // Its first move, with the cue the real tell draws, and the shield on its arm.
  const spot = laneSpot(floor, anchor, 2.2);
  await game.teleport(spot.x, spot.z);
  const first = await nextTell(game);
  expect([first.attack, first.cue.visible, first.cue.shape, first.bar, first.shield], 'its first move was not a swing drawn as an arc, with a shield on its arm and no floating bar').toEqual(['swing', true, 'arc', false, true]);
  const bar = page.locator('.boss-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'The Bastion');
  await expect(bar).toHaveAttribute('aria-valuemax', '70');
  // Phase one: held between its blows and facing him, a real strike from the front is turned aside and wounds nothing.
  const stance = strikeStance(floor, anchor);
  const hold = async () => {
    await game.configureCombat({ health: 100, enemies: [{ index: 0, windup: 0, cooldown: 0.3 }] });
    await game.teleport(stance.x, stance.z);
    await game.step(16); // it turns to face him
  };
  await hold();
  const before = (await game.state()).enemies[0];
  expect((await bossOf(game)).phase, 'precondition: it is in its first phase').toBe(0);
  await strike(page, stance.key);
  await game.step(200);
  const turned = (await game.state()).enemies[0];
  expect(turned.blocked, 'the strike never reached the shield, so nothing was tested').toBe(before.blocked + 1);
  expect(turned.hp, 'a frontal strike wounded a raised shield').toBe(before.hp);
  // Below half (35 of 70 is the threshold; 34 is under it): the shield breaks, the notice says so, and the mesh is gone from its arm.
  await game.step(600);
  await game.configureCombat({ enemies: [{ index: 0, hp: 34 }] });
  const calm = await settleBoss(game);
  expect([calm.phase, calm.shield], 'in phase two it was still behind a shield').toEqual([1, false]);
  await expect(page.locator('.chamber-notice')).toContainText('The Bastion\'s shield breaks');
  // The same strike from the same place now lands.
  await hold();
  const open = await game.state();
  await strike(page, stance.key);
  await game.step(200);
  const struck = (await game.state()).enemies[0];
  expect(struck.blocked, 'a strike was turned aside in phase two, with the shield broken').toBe(open.enemies[0].blocked);
  expect(struck.hp, 'a strike in phase two did not wound it').toBe(open.enemies[0].hp - open.weapon.strikeDamage);
});

// Plan 021 Stage E: the Bone King, on floor three, where he is always dealt. Floor three of the harness's seed is laid with him standing alone in the stair hall and his reserve buried under him.
const kingFloor = async (game: Game) => {
  await game.enter();
  await game.buildFloor(3);
  await game.step(0);
  const opening = await game.state();
  const at = opening.enemies.findIndex((e) => e.kind === 'king');
  expect(at, 'floor three holds no Bone King').toBeGreaterThanOrEqual(0);
  expect(opening.enemies[at].room, 'the Bone King does not stand in the stair hall').toBe(opening.floor.goal);
  return { opening, at, floor: await game.floor() };
};
const reserveOf = (state: Awaited<ReturnType<Game['state']>>, at: number) => state.enemies.filter((e) => e.kind === 'rattler' && e.summoner === at);
const kingOf = (state: Awaited<ReturnType<Game['state']>>) => state.enemies.find((e) => e.kind === 'king')!;
/** The spawn indices of what the King at `at` called: the fixture addresses a body by it. */
const reserveIds = (state: Awaited<ReturnType<Game['state']>>, at: number) => state.enemies.map((e, index) => ({ e, index })).filter(({ e }) => e.summoner === at).map(({ index }) => index);

test('the Bone King is wired: he opens with a summon drawn as a ring, a call stands up the move\'s own two rattlers from the reserve under him, and the bar names him with a tick for each of his two changes', async ({ game, page }) => {
  test.slow();
  const { opening, at, floor } = await kingFloor(game);
  const reserve = reserveOf(opening, at);
  expect(reserve.length, 'the floor did not bury the reserve his move list sizes').toBe(reserveSize('king'));
  expect(reserve.every((e) => e.buried && !e.visible), 'the reserve is not buried and hidden').toBe(true);
  expect(opening.enemies.filter((e) => e.room === opening.floor.goal && !e.buried).map((e) => e.kind), 'the stair hall holds more than its boss').toEqual(['king']);
  // Held at a place the knight can stand with a clear lane, 6 from him: past a swing, inside a summon.
  const king = kingOf(opening), spot = laneSpot(floor, { x: king.x, z: king.z }, 6.5);
  await game.teleport(spot.x, spot.z);
  await game.step(60);
  await expect(page.locator('.chamber-notice')).toContainText('The Bone King bars the stair');
  const first = await nextTell(game);
  expect([first.attack, first.cue.visible, first.cue.shape, first.bar], 'his first move was not a summon drawn as a ring, with no floating bar').toEqual(['summon', true, 'ring', false]);
  expect(reserveOf(await game.state(), at).filter((e) => !e.buried), 'precondition: nothing stands yet, so what stands afterwards was called by this tell').toHaveLength(0);
  const bar = page.locator('.boss-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'The Bone King');
  await expect(bar).toHaveAttribute('aria-valuemax', String(first.maxHp));
  await expect(bar.locator('u')).toHaveCount(2);
  expect(await bar.locator('u').evaluateAll((ticks) => ticks.map((t) => (t as HTMLElement).style.left)), 'the ticks are not at 60% and 25%').toEqual(['60%', '25%']);
  // The tell runs out: the first move of phase one raises its own perTell of the reserve, standing side by side, and no more.
  const perTell = BESTIARY.king.moves![0][0].summon!.perTell;
  await game.step(Math.round(BESTIARY.king.moves![0][0].tell * 1000) + 200);
  const called = await game.state();
  expect(reserveOf(called, at).filter((e) => !e.buried && e.visible && e.awake), `the call did not stand up ${perTell} rattlers`).toHaveLength(perTell);
  expect(reserveOf(called, at).filter((e) => e.buried), 'the call raised more than it asked for').toHaveLength(reserve.length - perTell);
  // Below 25%: the second change, announced. He summons on every second move from then on, whatever the knight does between: kept inside every reach (a fixture) so no move is skipped.
  await game.configureCombat({ health: called.maxHealth, enemies: [{ index: at, hp: 1 }, ...reserveIds(opening, at).map((index) => ({ index, cooldown: 999, windup: 0 }))] });
  const calm = await settleBoss(game);
  expect(calm.phase, 'at one blow from death he is not in his last phase').toBe(2);
  await expect(page.locator('.chamber-notice')).toContainText('The Bone King calls the dead');
  const keepClose = async () => {
    const now = await game.state(), k = kingOf(now);
    const near = laneSpot(floor, { x: k.x, z: k.z }, 2.2);
    await game.teleport(near.x, near.z);
    await game.configureCombat({ health: now.maxHealth });
  };
  // The first move of the last phase has begun by the time the change is settled (the tell lasts a second): it is the first of the eight.
  let last = await bossOf(game);
  const seen: (string | null)[] = last.windup > 0 ? [last.attack] : [];
  // What each summon tell stood up, as the scene has it the frame it ran out: his last phase calls one at a time (the move's own perTell), not the two of phase one.
  const standing = async () => reserveOf(await game.state(), at).filter((e) => !e.buried).length;
  let was = await standing();
  const standUp: number[] = [];
  for (let waited = 0; waited < 90_000 && seen.length < 8; waited += 50) {
    await keepClose();
    await game.step(50);
    const boss = await bossOf(game);
    if (last.windup === 0 && boss.windup > 0) seen.push(boss.attack);
    if (last.windup > 0 && boss.windup === 0 && last.attack === 'summon') { const now = await standing(); standUp.push(now - was); was = now; }
    last = boss;
  }
  expect(BESTIARY.king.moves![2][0].summon!.perTell, 'precondition: the last phase calls fewer at a time than phase one, so the two are told apart').toBeLessThan(perTell);
  expect(standUp.length, 'fewer than two summon tells ran out').toBeGreaterThanOrEqual(2);
  expect(standUp.slice(0, 2), `a summon of the last phase did not stand up exactly its own ${BESTIARY.king.moves![2][0].summon!.perTell}`).toEqual([1, 1]);
  expect(seen, 'he did not begin eight moves').toHaveLength(8);
  expect(seen.map((attack) => attack === 'summon'), `a summon belongs on every second move: ${seen.join(', ')}`).toEqual([true, false, true, false, true, false, true, false]);
});

test('felling the Bone King crumbles everything he called, standing or buried, opens the stair, and the stair wins the run through the real cards', async ({ game, page }) => {
  test.slow();
  const { opening, at, floor } = await kingFloor(game);
  // The reserve is held quiet (it stands when called and does nothing), the King is one blow from death, and the knight keeps beyond his bolt and inside his summon so that all he does is call.
  await game.configureCombat({ enemies: [...reserveIds(opening, at).map((index) => ({ index, cooldown: 999, windup: 0 })), { index: at, hp: 1 }] });
  const king = kingOf(opening), far = laneSpot(floor, { x: king.x, z: king.z }, 8.2, { clearance: 0 });
  await game.teleport(far.x, far.z);
  await game.step(600);
  await settleBoss(game);
  let state = await game.state();
  for (let waited = 0; waited < 40_000 && reserveOf(state, at).filter((e) => !e.buried).length < 2; waited += 100) {
    const k = kingOf(state);
    await game.configureCombat({ health: state.maxHealth, enemies: [{ index: at, x: k.x, z: k.z }] });
    await game.step(100);
    state = await game.state();
  }
  // The precondition: some of what he called stands, and some is still in the ground - both are what his fall has to take.
  expect(reserveOf(state, at).filter((e) => !e.buried).length, 'the King called nothing, so there is nothing for his fall to crumble').toBeGreaterThanOrEqual(2);
  expect(state.objective.stairOpen, 'the stair opened with the King standing').toBe(false);
  const xpBefore = state.experience.total;
  // Real strikes fell him, as in the Captain's: a stance beside him each time, the strike key, and let it land.
  for (let swing = 0; swing < 60 && state.boss; swing++) {
    expect(state.mode, `the knight died on the way to the King\n${await game.report()}`).toBe('playing');
    const k = kingOf(state), stance = strikeStance(floor, { x: k.x, z: k.z });
    await game.configureCombat({ health: state.maxHealth });
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    await strike(page, stance.key);
    await game.step(240);
    state = await game.state();
  }
  expect(state.boss, 'a real strike never felled the King').toBeNull();
  expect(state.enemies.filter((e) => e.room === state.floor.goal), 'something he called was left standing or buried in the stair hall').toHaveLength(0);
  expect([state.objective.stairClear, state.objective.stairOpen], 'his fall did not open the stair').toEqual([true, true]);
  await expect(page.locator('.boss-bar'), 'the boss bar outlived the boss').toBeHidden();
  expect(state.experience.total - xpBefore, 'the King paid something other than a boss\'s reward, or his crumbled reserve paid').toBe(state.experience.perBoss);
  // The stair is the win: the floor card first (the King the one body of his hall), then the card of the run.
  await game.teleport(state.stair.x, state.stair.z);
  await game.step(64);
  await page.keyboard.press('KeyE');
  await game.step(32);
  expect((await game.state()).mode).toBe('complete');
  expect(Number((await page.locator('.floor-results strong').allInnerTexts())[0]), 'the floor card did not count the King as felled').toBe(1);
  await page.locator('.success-screen button').click();
  await game.built();
  await game.step(16);
  expect((await game.state()).mode, 'the stair of the last floor did not win the run').toBe('won');
  await expect(page.getByText('THE KEEP IS BEHIND YOU')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('the bar fits a 360 by 740 phone: inside the screen, clear of the vitality row and the menu', async ({ game, page }) => {
    await arena(game, page);
    const opening = await game.state();
    const captain = { x: opening.enemies[0].x, z: opening.enemies[0].z };
    const floor = await game.floor();
    const spot = laneSpot(floor, captain, 3.2);
    await game.teleport(spot.x, spot.z);
    await nextTell(game);
    const bar = page.locator('.boss-bar');
    await expect(bar, 'precondition: the bar is up, or there is nothing to fit').toBeVisible();
    const box = async (selector: string) => {
      const found = await page.locator(selector).first().boundingBox();
      expect(found, `${selector} is not on screen`).not.toBeNull();
      return found!;
    };
    const mine = await box('.boss-bar');
    const view = page.viewportSize()!;
    expect(mine.x, 'the bar starts left of the screen').toBeGreaterThanOrEqual(0);
    expect(mine.x + mine.width, `the bar is ${mine.width}px wide and runs off a ${view.width}px screen`).toBeLessThanOrEqual(view.width);
    const crosses = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const selector of ['.health-row', '.health-track', '.game-options button']) {
      const other = await box(selector);
      expect(crosses(mine, other), `the boss bar ${JSON.stringify(mine)} overlaps ${selector} ${JSON.stringify(other)}`).toBe(false);
    }
  });
});
