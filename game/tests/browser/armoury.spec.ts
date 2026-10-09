import { readFileSync } from 'node:fs';
import { freshMeta, type Meta } from '../../app/dungeon-meta.ts';
import { expect, test, TILE } from './helpers.ts';

// Plan 019 Stage C: the arm is chosen on a rack and no chamber pays an arm. Plan 020 moved the armoury from floor one's Tide Gate to the Tide Altar's hall,
// and the choice is settled by the way down instead of the first door out of the gate. Which slot an arm stands on and that no slot, motif or prop collides
// are rules over the generator, proved in tests/dungeon-floor.test.ts; what this holds is that the running game lays exactly the owned arms on the hall's
// slots, swaps at whichever rack the knight is standing in, writes the choice at the way down, carries it into the run and its record, and shows the other
// arms again when a death brings him back. The fixtures only stage a save (`setMeta`), a teleport to the way down and a blow; the walking, the swap and the
// card are real input. (hall.spec.ts holds the altar, the shop and what the way down leaves behind on floor one.)

const OWNED: Meta = { ...freshMeta(), arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' };

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
