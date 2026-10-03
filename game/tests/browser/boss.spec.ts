import { ARROW_KEYS, expect, laneSpot, press, SCREEN_DIRECTIONS, settleBoss, strikeStance, test, TILE, canStand, hasClearPath, GameError, type Floor, type Game, type ScreenDirection } from './helpers.ts';
import type { Page } from '@playwright/test';

// Plan 021 Stage B: the Drowned Captain, in the running game. The rules are held in node - the row and its rotation in dungeon-captain.test.ts, the
// phase change, the push and the unhittable second in dungeon-enemy.test.ts and dungeon-hits.test.ts, the deal in dungeon-floor.test.ts, the pay in
// dungeon-sim.test.ts and dungeon-meta.test.ts. These check the running game is wired to them: that the boss bar and the cue the real tell draws are on
// screen, that a real strike carries the boss through its phase and the change takes the knight out of its reach, that it bars the stair on a
// generated floor, and that the bar fits a phone. Every page boots with `?boss=captain` (helpers.ts `DEFAULT_BOSS`), so none of this searches for a boss.

const arena = async (game: Game, page: Page) => {
  await page.evaluate(() => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(['captain'], 1));
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
