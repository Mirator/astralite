import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { gateRacks } from '../../app/dungeon-floor.ts';
import { freshMeta, type Meta } from '../../app/dungeon-meta.ts';
import { canStand, expect, type Floor, type Game, hasClearPath, keyToward, press, SCREEN_DIRECTIONS, stageBlow, test, TILE, type Point, type ScreenDirection } from './helpers.ts';

// Plan 019 Stage C: the arm is chosen in the Tide Gate and locked at the first door out of it, and no chamber pays
// an arm. Which slot an arm stands on and that no slot, motif or prop collides are rules over the generator, proved in
// tests/dungeon-floor.test.ts; what this holds is that the running game lays exactly the owned arms on them, swaps at
// whichever rack the knight is standing in, writes the choice at the door, and lays no rack anywhere else. The fixtures
// only stage a save (`setMeta`) and a blow; the walking, the swap and the doors are real keys.

const OWNED: Meta = { ...freshMeta(), arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' };

/** A spot a few units off a rack, on a clear line along one of the four arrow directions, so one held key walks the ring's edge in. */
const approach = (floor: Floor, rack: Point) => {
  for (const name of Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]) {
    const way = SCREEN_DIRECTIONS[name], from = { x: rack.x - way.x * 3.4, z: rack.z - way.z * 3.4 };
    if (canStand(floor.cells, from.x, from.z) && hasClearPath(floor.cells, from, rack)) return { from, key: keyToward(way).key };
  }
  throw new Error(`no clear approach to the rack at (${rack.x.toFixed(2)}, ${rack.z.toFixed(2)})`);
};

/** Holds the arrow key until the knight is inside the named arm's ring, in at most two seconds of game time. */
const walkIn = async (game: Game, page: Page, floor: Floor, arm: string) => {
  const rack = (await game.state()).racks.find((r) => r.kind === arm)!;
  const { from, key } = approach(floor, rack);
  await game.teleport(from.x, from.z);
  await game.step(64);
  expect((await game.state()).racks.find((r) => r.kind === arm)!.over, `the knight starts outside the ${arm}'s ring`).toBe(false);
  await page.keyboard.down(key);
  for (let i = 0; i < 64 && !(await game.state()).racks.find((r) => r.kind === arm)!.over; i++) await game.step(32);
  await page.keyboard.up(key);
  await game.step(16);
};

const lastRun = (page: Page) => page.evaluate(() => (window as unknown as { dungeonTest: { runLog: () => { arm: string; cause: string | null }[] } }).dungeonTest.runLog().at(-1)!);

test('the gate shows what is owned, the choice is made on a rack, and the first door out settles it', async ({ game, page }) => {
  // Owning the Tideblade, the spear and the maul and holding the Tideblade: two racks, the spear's and the maul's.
  await game.setMeta(OWNED);
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  expect(opening.weapon.id).toBe('tideblade');
  expect(opening.floor.level).toBe(1);

  // 1. Only what is owned is on a rack: read off the scene, each on its own slot of the armoury.
  expect(opening.racks.map((rack) => rack.kind), 'the gate does not show exactly the arms owned besides the one in hand').toEqual(['spear', 'maul']);
  expect(opening.racks.every((rack) => rack.inScene), 'a rack is not attached to the floor').toBe(true);
  const slots = gateRacks(floor);
  for (const rack of opening.racks) {
    const slot = slots.find((s) => s.arm === rack.kind)!;
    expect([rack.x, rack.z], `the ${rack.kind} does not stand on its slot`).toEqual([expect.closeTo(slot.x, 3), expect.closeTo(slot.z, 3)]);
  }
  expect(opening.run.armLocked, 'the arm is settled before any door was taken').toBe(false);

  // 2. The choice is made by walking in and pressing the swap key: the maul is in hand, the Tideblade on the maul's rack.
  const maul = opening.racks.find((rack) => rack.kind === 'maul')!;
  await walkIn(game, page, floor, 'maul');
  const standing = await game.state();
  expect(standing.racks.find((rack) => rack.kind === 'maul')!.over, 'the walk never reached the maul\'s ring').toBe(true);
  expect(standing.racks.find((rack) => rack.kind === 'spear')!.over, 'the spear\'s ring answers for the maul\'s').toBe(false);
  expect(standing.weapon.id, 'standing in the ring took the arm by itself').toBe('tideblade');
  await press(page, 'swap');
  await game.step(32);
  const armed = await game.state();
  expect(armed.weapon.id, 'the swap key did not take the arm of the rack he stood in').toBe('maul');
  expect(armed.racks.map((rack) => [rack.kind, rack.x, rack.z]), 'the sword he set down is not on the maul\'s slot, or the spear\'s rack moved').toEqual(
    [['spear', expect.closeTo(opening.racks[0].x, 3), expect.closeTo(opening.racks[0].z, 3)], ['tideblade', expect.closeTo(maul.x, 3), expect.closeTo(maul.z, 3)]],
  );
  // Still his to undo: nothing is written until a door is taken.
  expect((await game.meta()).arm, 'the choice was written before any door').toBe('tideblade');
  expect(armed.run.armLocked).toBe(false);

  // 3. The first door out of the gate locks it. The gate is never sealed, so the door takes the key at once.
  const door = armed.chamber.doors[0];
  await game.teleport(door.x, door.z);
  await game.step(200);
  expect((await game.state()).chamber.doors[0].over, 'the knight is not at the door').toBe(true);
  await press(page, 'swap');
  await game.step(32);
  const leaving = await game.state();
  expect(leaving.chamber.crossing, 'the swap key did not start a crossing').toBe('out');
  expect(leaving.chamber.id, 'the precondition is that the knight is still in the gate when the choice is written').toBe(0);
  expect(leaving.racks, 'the racks stand on after the door was taken').toEqual([]);
  expect(leaving.run.armLocked).toBe(true);
  expect((await game.meta()).arm, 'the arm was not written at the door').toBe('maul');
  await game.step(400, true);
  const arrived = await game.state();
  expect(arrived.chamber.id, 'the door led somewhere other than the chamber it named').toBe(door.to);
  expect(arrived.racks).toEqual([]);

  // Back on a slot where a rack stood (the gate is reached by a hook; no door leads back), the key does nothing.
  const spear = slots.find((slot) => slot.arm === 'spear')!;
  await game.teleport(spear.x, spear.z);
  await game.step(64);
  expect((await game.state()).chamber.id, 'the knight is not back in the gate').toBe(0);
  await press(page, 'swap');
  await game.step(64);
  const after = await game.state();
  expect(after.weapon.id, 'the swap key changed the arm after the lock').toBe('maul');
  await expect(page.locator('.swap-prompt')).toHaveCount(0);

  // The run record carries the arm that was locked, not the one the run was dealt: lose the run on floor one.
  expect(opening.run.start.arm, 'precondition: the run was dealt the Tideblade, so a record of the maul is the lock\'s').toBe('tideblade');
  const { kind } = await stageBlow(game, 1);
  await game.step(300);
  expect((await game.state()).mode, 'the staged blow never landed').toBe('lost');
  const record = await lastRun(page);
  expect(record.cause, 'the run did not end by the body that was staged').toBe(kind);
  expect(record.arm, 'the run record does not carry the locked arm').toBe('maul');

  // The next descent starts holding the maul, with the gate showing the Tideblade and the spear.
  await page.getByRole('button', { name: 'TO THE GATE' }).click();
  await game.enter();
  const next = await game.state();
  expect(next.run.start.arm, 'the next run did not start with the arm settled at the door').toBe('maul');
  expect(next.weapon.id).toBe('maul');
  expect(next.racks.map((rack) => rack.kind), 'the gate does not show the other two arms').toEqual(['tideblade', 'spear']);
  expect(next.run.armLocked, 'a new run began locked').toBe(false);
});

test.describe('the keep below the gate', () => {
  // Level 2 of this seed was one of the 60 floors the rewards fixture recorded before plan 019, and its arm chamber is
  // not the gate. The second word is the one `buildFloor(2)` draws.
  test.use({ seeds: [0x1, 7921] });
  const recorded = (JSON.parse(readFileSync(new URL('../fixtures/rewards-019.json', import.meta.url), 'utf8')).floors as { level: number; seed: number; rewards: (string | null)[]; armRoom: number }[]).find((rec) => rec.level === 2 && rec.seed === 7921)!;

  test('no chamber pays an arm: the one that used to shows its mend or purse and lays no rack', async ({ game }) => {
    // Owning an arm besides the Tideblade, so a rack placed anywhere would be a rack that is owned.
    await game.setMeta(OWNED);
    await game.enter();
    await game.buildFloor(2);
    await game.step(0);
    const floor = await game.floor();
    expect(floor.level).toBe(2);
    expect(floor.seed, 'the second pinned seed did not build floor 2').toBe(7921);
    // The precondition: this chamber was the floor's arm chamber before this plan (the recording), and the kept draw still picks it.
    expect(recorded.rewards[recorded.armRoom], 'the recording lost this floor\'s arm chamber').toBe('arm');
    expect(recorded.armRoom).toBeGreaterThan(0);
    expect(floor.weaponDrop.room, 'the arm chamber\'s pick moved: its draw was removed').toBe(recorded.armRoom);
    const chamber = floor.rooms[recorded.armRoom];
    expect(['mend', 'cache'], 'the former arm chamber pays neither a mend nor a purse').toContain(chamber.reward);

    // The sign on the door into it, read off the scene from the chamber before.
    const door = floor.doors.find((d) => d.to === chamber.id)!;
    await game.teleport(door.x * TILE, door.z * TILE);
    await game.step(200);
    const at = await game.state();
    expect(at.chamber.id, 'the knight is not in the chamber before').toBe(door.from);
    const sign = at.chamber.doors.find((view) => view.id === door.id)!.sign;
    expect(sign, 'the door still shows an arm').toBe(chamber.reward);

    // And entering it lays nothing.
    await game.teleport(chamber.entry.x * TILE, chamber.entry.z * TILE);
    await game.step(120);
    const inside = await game.state();
    expect(inside.chamber.id, 'the knight is not in the former arm chamber').toBe(chamber.id);
    expect(inside.racks, 'a rack was laid on floor 2').toEqual([]);
  });
});
