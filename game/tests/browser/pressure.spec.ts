import { canStand, expect, test, type Game } from './helpers.ts';
import type { Page } from '@playwright/test';

// Plan 024 Stage B (D3). The rule is held in node (tests/dungeon-pressure.test.ts: the gap, the INVULN floor, the full tell, the plants). This is the wiring: the running game asks `pressed` where it decides a body's intent, feeds `held`
// back, and shows a held body nothing. Two guards ready together beside a knight who stands still; both tells' end times are read off the snapshot, frame by frame, and the second ends 0.4 to 0.6 s after the first - inside the dash's own
// cooldown, which is the whole point: one dash no longer answers the room. (A scene that dashes at the first tell was tried: the dash leaves the held guard's reach, so it never swings and there is no second tell to time.)
const FRAME = 1000 / 60, DT = 1 / 60;

const arena = async (game: Game, page: Page, roster: string[]) => {
  await page.evaluate((kinds) => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(kinds, 1), roster);
  await game.enter();
};

test('two guards ready together end their tells 0.4 to 0.6 s apart, inside the dash cooldown, and the held one shows nothing', async ({ game, page }) => {
  await arena(game, page, ['guard', 'guard']);
  const opening = await game.state();
  expect(opening.enemies.map((e) => e.kind), 'the arena should hold two guards').toEqual(['guard', 'guard']);
  const tell = opening.enemies[0].tell;
  // Ready together: both in reach of the knight with their cooldowns run out, on the two open spots nearest a pace and a bit from him (the fixture only places them; what they do next is the game's).
  const floor = await game.floor(), knight = { x: opening.player.x, z: opening.player.z };
  const spots = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].map(([dx, dz]) => ({ x: knight.x + dx, z: knight.z + dz })).filter((at) => canStand(floor.cells, at.x, at.z));
  expect(spots.length, 'the knight stands somewhere with no room for two guards beside him').toBeGreaterThanOrEqual(2);
  await game.configureCombat({ enemies: [0, 1].map((index) => ({ index, x: spots[index].x, z: spots[index].z, cooldown: 0, windup: 0 })) });

  const began: (number | null)[] = [null, null], ended: (number | null)[] = [null, null], lasted: number[] = [];
  const was = [0, 0], healthAtStart = opening.health;
  let heldSeen = 0, heldShowedTell = false, dashSpan = 0;
  for (let frame = 1; frame <= 900 && ended.some((at) => at === null); frame++) {
    await game.step(FRAME);
    const state = await game.state();
    dashSpan = state.boons.dashSpan;
    state.enemies.forEach((e, i) => {
      if (e.held > 0) { heldSeen = Math.max(heldSeen, e.held); if (e.windup > 0) heldShowedTell = true; }
      if (was[i] <= 0 && e.windup > 0 && began[i] === null) began[i] = frame;
      if (was[i] > 0 && e.windup <= 0 && ended[i] === null) { ended[i] = frame; lasted.push((frame - began[i]!) * DT); }
      was[i] = e.windup;
    });
  }
  expect(ended.every((at) => at !== null), `both guards should have run a tell (began ${began.join(', ')}, ended ${ended.join(', ')})`).toBe(true);
  expect(heldSeen, 'neither guard was ever held: the snapshot never reported a pressure delay').toBeGreaterThan(0);
  expect(heldShowedTell, 'a held body showed a tell (windup) while it was held').toBe(false);
  const gap = Math.abs(ended[0]! - ended[1]!) * DT;
  // One 60 Hz frame of slack either side: the snapshot is read once a frame.
  expect(gap, `the second tell ended ${gap.toFixed(3)} s after the first (ended on frames ${ended.join(', ')}); the window is 0.4 to 0.6 s`).toBeGreaterThanOrEqual(0.4 - DT);
  expect(gap, `the second tell ended ${gap.toFixed(3)} s after the first (ended on frames ${ended.join(', ')}); the window is 0.4 to 0.6 s`).toBeLessThanOrEqual(0.6 + DT);
  expect(gap, `the second tell ended ${gap.toFixed(3)} s after the first: more than the dash cooldown (${dashSpan} s), so one dash would answer both`).toBeLessThan(dashSpan);
  // Nothing was shortened: each tell ran at least its kind's (a frame of rounding aside).
  expect(lasted.length).toBe(2);
  for (const seconds of lasted) expect(seconds, `a tell ran ${seconds.toFixed(3)} s, shorter than the guard's ${tell} s`).toBeGreaterThanOrEqual(tell - DT);
  // Both blows landed on the knight who stood still: the second is more than INVULN behind the first, so the damage window of the first does not swallow it.
  await game.step(100);
  const after = await game.state();
  expect(healthAtStart - after.health, 'the second blow did not land on a knight who stood still, so the gap did not clear his invulnerability').toBe(2 * opening.enemies[0].damage);
});
