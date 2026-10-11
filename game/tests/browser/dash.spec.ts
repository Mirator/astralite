import { DASH_SPEED, DASH_TIME, WALK_SPEED } from '../../app/dungeon-combat.ts';
import { STRIKE_RANGE } from '../../app/dungeon-enemy.ts';
import {
  ARROW_KEYS, canStand, expect, type Floor, type Point, SCREEN_DIRECTIONS,
  type ScreenDirection, speedOf, test, TILE,
} from './helpers.ts';

// The dash used to be an invulnerability blink: 0.18s at 12, immune throughout, netting 1.12 units
// over a walk against a warden's 2.55 reach. It turned blows aside without ever leaving them, so every
// fight was fought standing on the same tile. These are the tests for the two halves of the fix —
// distance that actually moves the knight, and a tail that can be punished for spending it early.
//
// The immune head and exposed tail are asserted exactly in `tests/dungeon-combat.test.ts`. What these
// prove is that the running game is wired to the same numbers.

/**
 * The longest straight run of floor anywhere on this level, as a place to stand and a way to face.
 * The rooms are deliberately small, so a lane long enough to hold a whole dash is usually a corridor
 * and is never guaranteed to be in the room the knight starts in.
 */
function longestLane(floor: Floor, atLeast: number) {
  let best: { spot: Point; name: ScreenDirection; run: number } | null = null;
  for (const tile of floor.tiles) {
    const spot = { x: tile.x * TILE, z: tile.z * TILE };
    if (!canStand(floor.cells, spot.x, spot.z)) continue;
    for (const name of Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]) {
      const heading = SCREEN_DIRECTIONS[name];
      let run = 0;
      while (run < atLeast + TILE
        && canStand(floor.cells, spot.x + heading.x * (run + TILE / 2), spot.z + heading.z * (run + TILE / 2))) {
        run += TILE / 2;
      }
      if (!best || run > best.run) best = { spot, name, run };
      if (best.run >= atLeast) return best;
    }
  }
  return best;
}

test('one dash carries the knight past a warden’s reach', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const window = Math.round(DASH_TIME * 1000) + 16;
  const walkUp = 200;
  // Enough clear floor for the walk-up, the dash and a margin, or the wall is what gets measured.
  const needed = WALK_SPEED * (walkUp / 1000) + DASH_SPEED * DASH_TIME + 1.5;
  const floor = await game.floor();
  const lane = longestLane(floor, needed);
  expect(lane, 'the floor has no lane at all').not.toBeNull();
  expect(lane!.run, `the longest lane on this floor is ${lane!.run.toFixed(1)} units`)
    .toBeGreaterThanOrEqual(needed);
  const heading = SCREEN_DIRECTIONS[lane!.name];
  const key = ARROW_KEYS[lane!.name];

  // Walk the same lane twice, once with a dash in the middle and once without. The difference is what
  // the dash is actually worth, and comparing two real runs rather than a run against arithmetic means
  // collision, friction and frame boundaries cancel out instead of having to be modelled.
  const travel = async (dash: boolean) => {
    await game.teleport(lane!.spot.x, lane!.spot.z);
    await game.step(400);
    await page.keyboard.down(key);
    await game.step(walkUp);
    const from = await game.state();
    expect(speedOf(from), 'at full travelling speed before the measurement').toBeCloseTo(WALK_SPEED, 0);
    if (dash) await page.keyboard.press('ShiftLeft');
    await game.step(window);
    const to = await game.state();
    await page.keyboard.up(key);
    await game.step(1000);
    expect(to.player.dashTime, 'the window covers the whole dash and no more').toBe(0);
    // Along the heading, so a slide down a wall cannot be counted as progress.
    return (to.player.x - from.player.x) * heading.x + (to.player.z - from.player.z) * heading.z;
  };

  const walked = await travel(false);
  const dashed = await travel(true);
  expect(dashed - walked, 'a dash buys more ground than a warden can reach across')
    .toBeGreaterThan(STRIKE_RANGE.warden * 0.9);
});
