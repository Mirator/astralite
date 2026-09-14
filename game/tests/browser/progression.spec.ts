import {
  expect,
  Game,
  strikeStance,
  test,
  TILE,
  type Floor,
  type Point,
  type Snapshot,
} from './helpers.ts';
import type { Page } from '@playwright/test';

/** Rank costs, mirrored from dungeon-game.tsx. */
const rankCost = (rank: number) => 200 + (rank - 1) * 150;

const stairEnemies = (state: Snapshot) =>
  state.enemies.filter((enemy) => enemy.room === state.floor.goal);

/** One real swing: arrow key to aim, Space to strike, then let it resolve. */
const strikeOnce = async (
  game: Game,
  page: Page,
  floor: Floor,
  target: Point,
) => {
  let stance: ReturnType<typeof strikeStance> | null = null;
  for (const distance of [1.05, 1.3, 0.85]) {
    try {
      stance = strikeStance(floor, target, { distance });
      break;
    } catch {
      stance = null;
    }
  }
  if (!stance) {
    throw new Error(
      `no legal stance against the warden at (${target.x.toFixed(2)}, ${target.z.toFixed(2)})`,
    );
  }
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await page.keyboard.down(stance.key);
  await page.keyboard.down('Space');
  await page.keyboard.up(stance.key);
  await page.keyboard.up('Space');
  await game.step(240);
};

/**
 * Clears the stair wardens with real strikes. The test hooks never take the
 * stair for the knight; only the kill can. With `autoBoon: false` the fight
 * stops the moment a draft opens, so a caller can inspect that boundary.
 */
const fightStair = async (
  game: Game,
  page: Page,
  options: { autoBoon?: boolean } = {},
) => {
  const autoBoon = options.autoBoon ?? true;
  const floor = await game.floor();
  // Real strikes clear the stair, but the trade itself is not under test here: the floor ending, freezing
  // and waiting for the click is. Wardens grow with the floor, so a knight standing in reach of three of
  // them on floor three died before the results screen. The fixture leaves each warden one blow from death;
  // spawn indices match the snapshot because nothing on a fresh floor has died yet.
  const opening = await game.state();
  await game.configureCombat({
    enemies: stairEnemies(opening).map((enemy) => ({
      index: opening.enemies.indexOf(enemy),
      hp: 1,
    })),
  });
  for (let swing = 0; swing < 90; swing++) {
    const state = await game.state();
    if (state.mode === 'lost') {
      throw new Error(`the knight died clearing the stair\n${await game.report()}`);
    }
    if (state.boonOffer) {
      if (!autoBoon) return state;
      await game.takeBoon();
      await game.step(16);
      continue;
    }
    if (state.mode !== 'playing') return state;
    const targets = stairEnemies(state);
    if (!targets.length) return state;
    const target = [...targets].sort((a, b) => a.hp - b.hp)[0];
    await strikeOnce(game, page, floor, { x: target.x, z: target.z });
  }
  throw new Error(`could not clear the stair\n${await game.report()}`);
};

/** Everything a frozen screen must hold still, minus draw-only counters. */
const world = (state: Snapshot) =>
  JSON.stringify({
    mode: state.mode,
    health: state.health,
    player: state.player,
    enemies: state.enemies,
    objective: state.objective,
    experience: state.experience,
  });

test('killing the last warden ends a floor, freezes it, and waits for a real Continue click', async ({
  game,
  page,
}) => {
  test.slow();
  await game.enter();

  for (let level = 1; level <= 3; level++) {
    expect((await game.state()).floor.level).toBe(level);
    const stair = (await game.state()).floor.rooms[
      (await game.state()).floor.goal
    ];
    await game.teleport(stair.x * TILE, stair.z * TILE);
    await game.step(60);

    const before = await game.state();
    const wardens = stairEnemies(before).length;
    expect(wardens).toBeGreaterThan(0);
    const xpBefore = before.experience.total;

    const cleared = await fightStair(game, page);
    expect(cleared.mode).toBe('complete');
    expect(cleared.objective.stairClear).toBe(true);
    await expect(page.locator('.success-screen')).toBeVisible();
    if (level < 3) {
      await expect(page.locator('.recovery-note')).toBeVisible();
    }

    // The results screen reports this floor's own tally.
    const results = await page
      .locator('.floor-results strong')
      .allInnerTexts();
    expect(Number(results[0])).toBe(wardens);
    expect(Number(results[1])).toBe(cleared.experience.total - xpBefore);
    expect(cleared.experience.total - xpBefore).toBe(wardens * 25);

    // Frozen: input and time both do nothing until the button is pressed.
    const frozen = world(cleared);
    await page.keyboard.down('Space');
    await game.step(5000);
    await page.keyboard.up('Space');
    expect(world(await game.state())).toBe(frozen);
    expect((await game.state()).mode).toBe('complete');
    await game.capture(`floor-${level}-complete`);

    await page.locator('.success-screen button').click();
    await game.step(16);
    const next = await game.state();

    if (level < 3) {
      expect(next.mode).toBe('playing');
      expect(next.floor.level).toBe(level + 1);
      // A descent tops the knight up by a quarter, capped at maximum vitality.
      expect(next.health).toBe(
        Math.min(
          cleared.maxHealth,
          cleared.health + Math.round(cleared.maxHealth * 0.25),
        ),
      );
    } else {
      // The last floor needs the same explicit press before the run is won.
      expect(next.mode).toBe('won');
      await expect(page.locator('.end-screen')).toBeVisible();
      await expect(
        page.getByText('THE KEEP IS BEHIND YOU'),
      ).toBeVisible();
      await game.capture('victory');
    }
  }
});

test('a rank-up on the last warden opens its boon before the floor results, and queued ranks resolve one at a time', async ({
  game,
  page,
}) => {
  test.slow();
  await game.enter();

  // Two ranks at once: the drafts must queue, not stack into one screen.
  await game.grantXp(rankCost(1) + rankCost(2));
  await expect(page.locator('.boon-option').first()).toBeVisible();
  const queued = await game.state();
  expect(queued.rank).toBe(3);
  expect(queued.boonOffer).toBe(true);
  expect(await page.locator('.boon-option').count()).toBe(3);

  const first = await game.takeBoon();
  await expect(page.locator('.boon-option').first()).toBeVisible();
  expect((await game.state()).boonOffer).toBe(true);
  expect(await page.locator('.boon-option').count()).toBe(3);

  expect(first).toBeTruthy();
  const second = await game.takeBoon();
  expect(second).toBeTruthy();
  await expect(page.locator('.boon-screen')).toBeHidden();
  const resolved = await game.state();
  expect(resolved.boonOffer).toBe(false);
  expect(resolved.mode).toBe('playing');
  expect(resolved.rank).toBe(3);

  // Line the next rank up so the stair pack pays for it exactly: the rank can
  // only tip over on the kill that empties the room, cleave or no cleave.
  const stair = resolved.floor.rooms[resolved.floor.goal];
  await game.teleport(stair.x * TILE, stair.z * TILE);
  await game.step(60);
  const primed = await game.state();
  const wardens = stairEnemies(primed).length;
  expect(wardens).toBeGreaterThan(0);
  const gap = primed.experience.rankCost - primed.experience.intoRank;
  expect(gap).toBeGreaterThan(wardens * 25);
  await game.grantXp(gap - wardens * 25);
  const ready = await game.state();
  expect(ready.boonOffer).toBe(false);
  expect(ready.experience.rankCost - ready.experience.intoRank).toBe(
    wardens * 25,
  );
  const rankBefore = ready.rank;

  const killed = await fightStair(game, page, { autoBoon: false });
  // The draft opens first; the floor is not allowed to end underneath it.
  expect(killed.mode).toBe('playing');
  expect(killed.boonOffer).toBe(true);
  expect(killed.rank).toBe(rankBefore + 1);
  expect(killed.objective.stairClear).toBe(true);
  await expect(page.locator('.boon-screen')).toBeVisible();
  await expect(page.locator('.success-screen')).toBeHidden();
  await game.capture('rank-up-before-results');

  await game.takeBoon();
  await game.step(60);
  const complete = await game.state();
  expect(complete.boonOffer).toBe(false);
  expect(complete.mode).toBe('complete');
  await expect(page.locator('.success-screen')).toBeVisible();

  await page.locator('.success-screen button').click();
  await game.step(16);
  const descended = await game.state();
  expect(descended.mode).toBe('playing');
  expect(descended.floor.level).toBe(2);
});
