import { BESTIARY } from '../../app/dungeon-bestiary.ts';
import { XP_CACHE } from '../../app/dungeon-sim.ts';
import { expect, openSpot, press, roomCentre, strikeStance, test, type Game } from './helpers.ts';
import type { Page } from '@playwright/test';

// Plan 018: the bonecaller is dealt into the descent, with its reserve buried under it by the generator
// (`buryReserves`). Every rule is held in node - dealing and the buried block in dungeon-floor.test.ts, raising and
// reassembling in dungeon-enemy.test.ts, the sim in balance-sim.test.ts. This checks only that a GENERATED floor reaches
// the running game correctly, which the arena specs cannot: an arena has one chamber, so the caller's index in the
// floor's spawn list and its index within its chamber are the same number there and different here. The pyre and the
// shieldbearer need nothing new: dealing them adds no game code, and arena-kinds.spec.ts drives their wiring.
//
// Floor three of this seed deals one caller, in a layer-1 chamber: one door from the Tide Gate, so the story is a
// single crossing and not a walk through several fights. The seed is the second the page is handed (the first builds
// floor one).
const KEEP = 15841;
test.use({ seeds: [0x1, KEEP] });

const strike = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await press(page, 'attack');
  await page.keyboard.up(key);
};

/**
 * Bring a body to open floor mid-chamber (a pack can stand hard against a wall where no swing can reach it), stand
 * beside it, hold it at one blow of life, and cut it down with a real strike. A body walks at the knight while the swing
 * winds up, so a swing that finds nothing is tried again from where it now stands; `done` says the blow landed.
 */
const cutDown = async (game: Game, page: Page, floor: Awaited<ReturnType<Game['floor']>>, index: number, done: (state: Awaited<ReturnType<Game['state']>>) => boolean) => {
  let state = await game.state();
  for (let attempt = 0; attempt < 4 && !done(state); attempt++) {
    const at = openSpot(floor, roomCentre(floor, state.chamber.id), { radius: 3 });
    await game.configureCombat({ enemies: [{ index, x: at.x, z: at.z, cooldown: 3, windup: 0 }] });
    const stance = strikeStance(floor, at);
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    await game.configureCombat({ enemies: [{ index, hp: 1, cooldown: 3, windup: 0 }] });
    await strike(page, stance.key);
    await game.step(250);
    state = await game.state();
  }
  return state;
};

test('a generated floor buries a caller\'s reserve under it, puts a cut-down rattler back unpaid, and crumbles it all with the caller', async ({ game, page }) => {
  await game.enter();
  await game.buildFloor(3);
  await game.step(0);
  const floor = await game.floor();
  expect(floor.seed, 'the page was not handed the seed this scenario is staged on: pick another seed').toBe(KEEP);
  expect(floor.level).toBe(3);
  const callerAt = floor.spawns.findIndex((spawn) => spawn.kind === 'bonecaller');
  expect(callerAt, `seed ${KEEP} no longer deals a bonecaller on floor three: pick another seed`).toBeGreaterThanOrEqual(0);
  const caller = floor.spawns[callerAt];
  const chamber = floor.rooms[caller.room];
  expect(chamber.layer, 'the caller is not one door from the gate: pick another seed').toBe(1);
  expect(chamber.reward, 'the chamber of the caller pays no purse, so the sum below changes: pick another seed').toBe('cache');
  const pack = floor.spawns.map((spawn, index) => ({ spawn, index })).filter(({ spawn, index }) => spawn.room === caller.room && !spawn.buried && index !== callerAt);
  const perTell = BESTIARY.bonecaller.summons!.count;
  // The precondition the last step needs: the caller's place in the floor's list is not its place in its chamber.
  expect(callerAt, 'the caller heads the floor, so a chamber-local index would read the same as the floor-wide one').not.toBe(floor.spawns.filter((spawn) => spawn.room === caller.room && !spawn.buried).indexOf(caller));

  // Through the gate's door to the caller's chamber, on the swap key.
  const gate = await game.state();
  const door = gate.chamber.doors.find((way) => way.to === caller.room)!;
  expect(door, 'the gate has no door to the caller\'s chamber').toBeDefined();
  await game.teleport(door.x, door.z);
  await game.step(50);
  await page.keyboard.press('KeyE');
  await game.step(32);
  await game.step(400, true);
  let state = await game.state();
  expect(state.chamber.id, 'the door did not lead to the caller\'s chamber').toBe(caller.room);
  // Nothing else in the chamber swings while the story is told.
  await game.configureCombat({ enemies: pack.map(({ index }) => ({ index, cooldown: 60 })) });

  // 1. The reserve reached the game: read off the running scene, not the generator.
  // The snapshot lists every living body on the floor, so "in this chamber" is read off `room`.
  const here = () => state.enemies.filter((enemy) => enemy.room === caller.room);
  const buried = () => state.enemies.filter((enemy) => enemy.buried);
  expect(buried().length, 'the caller arrived with no reserve').toBe(perTell);
  expect(buried().every((enemy) => enemy.kind === 'rattler' && enemy.summoner === callerAt), `a buried body does not answer to spawn ${callerAt}, the caller's place in the floor`).toBe(true);
  expect(buried().every((enemy) => !enemy.visible && !enemy.awake), 'a buried body was on show or awake').toBe(true);
  expect(state.chamber.sealed).toBe(true);

  // 2. Wait for the first call, then cut one of the two it raised down with the caller standing: it goes back under, unpaid.
  for (let t = 0; t < 8000 && state.enemies.filter((enemy) => enemy.kind === 'rattler' && !enemy.buried).length < 2; t += 50) { await game.step(50); state = await game.state(); }
  const raised = state.enemies.map((enemy, index) => ({ enemy, index })).filter(({ enemy }) => enemy.kind === 'rattler' && !enemy.buried);
  expect(raised, 'the caller never raised its first two').toHaveLength(2);
  const paid = state.experience.total;
  const target = raised[0].index;
  const before = state.enemies.length;
  state = await cutDown(game, page, floor, target, (now) => now.enemies.length !== before || now.enemies[target].buried);
  expect(state.enemies.length, 'a raised rattler died instead of going back into the ground').toBe(before);
  expect(state.enemies[target].buried, 'the struck rattler never went back under').toBe(true);
  expect(state.experience.total, 'a rattler that went back into the ground paid out').toBe(paid);
  expect(state.chamber.sealed).toBe(true);

  // 3. Everything else falls to real strikes; the caller last. Then every body it called is gone in the same update and
  // the chamber opens.
  for (const { index } of pack) {
    const standing = state.enemies.length;
    state = await cutDown(game, page, floor, index, (now) => now.enemies.length < standing);
  }
  expect(here().filter((enemy) => enemy.kind !== 'rattler' && enemy.kind !== 'bonecaller'), 'the pack is not cut down, so the caller alone holds the chamber').toEqual([]);
  expect(state.chamber.sealed, 'the chamber opened with the caller standing').toBe(true);
  const owed = state.experience.total;
  state = await cutDown(game, page, floor, callerAt, (now) => !now.enemies.some((enemy) => enemy.room === caller.room && enemy.kind === 'bonecaller'));
  expect(here().some((enemy) => enemy.kind === 'bonecaller'), 'the strike never killed the caller').toBe(false);
  expect(here(), 'something the caller called outlived it').toEqual([]);
  expect(state.experience.total, 'the crumbled rattlers paid out, or the caller and the purse did not').toBe(owed + state.experience.perEnemy + XP_CACHE);
  expect(state.chamber.sealed, 'the caller fell and the chamber never opened').toBe(false);
});
