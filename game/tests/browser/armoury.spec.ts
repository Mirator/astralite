import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { altarHall, gateRacks } from '../../app/dungeon-floor.ts';
import { freshMeta, type Meta } from '../../app/dungeon-meta.ts';
import { expect, press, stageBlow, test, TILE, walkUntil } from './helpers.ts';

// Plan 019 Stage C: the arm is chosen on a rack and no chamber pays an arm. Plan 020 moved the armoury from floor one's Tide Gate to the Tide Altar's hall,
// and the choice is settled by the way down instead of the first door out of the gate. Which slot an arm stands on and that no slot, motif or prop collides
// are rules over the generator, proved in tests/dungeon-floor.test.ts; what this holds is that the running game lays exactly the owned arms on the hall's
// slots, swaps at whichever rack the knight is standing in, writes the choice at the way down, carries it into the run and its record, and shows the other
// arms again when a death brings him back. The fixtures only stage a save (`setMeta`), a teleport to the way down and a blow; the walking, the swap and the
// card are real input. (hall.spec.ts holds the altar, the shop and what the way down leaves behind on floor one.)

const OWNED: Meta = { ...freshMeta(), arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' };

const lastRun = (page: Page) => page.evaluate(() => (window as unknown as { dungeonTest: { runLog: () => { arm: string; cause: string | null }[] } }).dungeonTest.runLog().at(-1)!);

test.describe('the armoury in the hall', () => {
  test.use({ hall: true });

  test('the hall shows what is owned, the choice is made on a rack, the way down settles it, and the run and the next hall carry it', async ({ game, page }) => {
    // Owning the Tideblade, the spear and the maul and holding the Tideblade: two racks, the spear's and the maul's.
    await game.setMeta(OWNED);
    await game.enter();
    const hall = altarHall();
    const opening = await game.state();
    expect(opening.weapon.id).toBe('tideblade');
    expect(opening.hall, 'the page did not boot into the hall').toBe(true);

    // 1. What is owned stands on an open rack, read off the scene, each on its own slot of the armoury. Plan 025 (D8): the rest stand there too, locked.
    expect(opening.racks.filter((rack) => !rack.locked).map((rack) => rack.kind), 'the hall does not show exactly the arms owned besides the one in hand').toEqual(['spear', 'maul']);
    expect(opening.racks.filter((rack) => rack.locked).map((rack) => rack.kind), 'the arms not owned are not on locked racks').toEqual(['fangs', 'cleaver', 'crossbow', 'flask']);
    expect(opening.racks.every((rack) => rack.inScene), 'a rack is not attached to the floor').toBe(true);
    const slots = gateRacks(hall);
    for (const rack of opening.racks) {
      const slot = slots.find((s) => s.arm === rack.kind)!;
      expect([rack.x, rack.z], `the ${rack.kind} does not stand on its slot`).toEqual([expect.closeTo(slot.x, 3), expect.closeTo(slot.z, 3)]);
    }
    expect(opening.run.armLocked, 'the arm is settled before the way down was taken').toBe(false);

    // 2. The choice is made by walking in and pressing the swap key: the maul is in hand, the Tideblade on the maul's rack.
    const maul = opening.racks.find((rack) => rack.kind === 'maul')!;
    expect(await walkUntil(game, page, maul, (state) => state.racks.find((rack) => rack.kind === 'maul')!.over), 'the walk never reached the maul\'s ring').toBe(true);
    const standing = await game.state();
    expect(standing.racks.find((rack) => rack.kind === 'spear')!.over, 'the spear\'s ring answers for the maul\'s').toBe(false);
    expect(standing.weapon.id, 'standing in the ring took the arm by itself').toBe('tideblade');
    await press(page, 'swap');
    await game.step(32);
    const armed = await game.state();
    expect(armed.weapon.id, 'the swap key did not take the arm of the rack he stood in').toBe('maul');
    const spear = opening.racks.find((rack) => rack.kind === 'spear')!;
    expect(armed.racks.filter((rack) => !rack.locked).map((rack) => [rack.kind, rack.x, rack.z]), 'the sword he set down is not on the maul\'s slot, or the spear\'s rack moved').toEqual(
      [['spear', expect.closeTo(spear.x, 3), expect.closeTo(spear.z, 3)], ['tideblade', expect.closeTo(maul.x, 3), expect.closeTo(maul.z, 3)]],
    );
    // Still his to undo: nothing is written until the way down is taken.
    expect((await game.meta()).arm, 'the choice was written before the way down').toBe('tideblade');
    expect(armed.run.armLocked).toBe(false);

    // 3. The way down settles it: the arm is written, the racks are gone, and the run is dealt the arm that was chosen.
    await game.takeWayDown();
    const run = await game.state();
    expect([run.hall, run.floor.level, run.mode]).toEqual([false, 1, 'playing']);
    expect(run.racks, 'the racks stand on after the way down was taken').toEqual([]);
    expect(run.run.armLocked).toBe(true);
    expect((await game.meta()).arm, 'the arm was not written at the way down').toBe('maul');
    expect(run.run.start.arm, 'the run was not dealt the arm settled at the way down').toBe('maul');
    expect(run.weapon.id).toBe('maul');
    await expect(page.locator('.swap-prompt')).toHaveCount(0);

    // The run record carries the arm that was chosen: lose the run on floor one.
    const { kind } = await stageBlow(game, 1);
    await game.step(300);
    expect((await game.state()).mode, 'the staged blow never landed').toBe('lost');
    const record = await lastRun(page);
    expect(record.cause, 'the run did not end by the body that was staged').toBe(kind);
    expect(record.arm, 'the run record does not carry the arm that was chosen').toBe('maul');

    // The next attempt starts holding the maul, with the hall showing the Tideblade and the spear, and nothing locked.
    await page.getByRole('button', { name: 'RETURN TO THE ALTAR' }).click();
    await game.built();
    await game.step(16);
    const next = await game.state();
    expect(next.hall, 'the card did not bring him back to the hall').toBe(true);
    expect(next.weapon.id, 'the next attempt did not begin with the arm settled at the way down').toBe('maul');
    expect(next.racks.filter((rack) => !rack.locked).map((rack) => rack.kind), 'the hall does not show the other two arms').toEqual(['tideblade', 'spear']);
    expect(next.run.armLocked, 'a new attempt began locked').toBe(false);
    await game.takeWayDown();
    const again = await game.state();
    expect(again.run.start.arm, 'taking the way down without a swap changed the arm').toBe('maul');
    expect(again.weapon.id).toBe('maul');
  });
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
