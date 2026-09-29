import { expect, test, TILE } from './helpers.ts';

// Plan 017: a floor is a chain of sealed chambers joined by doors. The rules - which doors a chamber has,
// what each shows, that the knight arrives clear of every body - are node tests over the generator
// (tests/dungeon-floor.test.ts). What this checks is the running game's wiring on real keys: that a
// sealed chamber's door refuses the swap key, that an open one takes it and only it, and that the knight
// crosses behind the fade into the chamber the door named, with nothing compiled on the way. One story,
// one page: the gate's doors are open from the start and a fight chamber is sealed on arrival.

test('an open door takes the swap key and only it; a sealed one refuses it', async ({ game, page }) => {
  await game.enter();
  const floor = await game.floor();
  const gate = await game.state();
  expect(gate.chamber.id, 'the run starts in the Tide Gate').toBe(0);
  expect(gate.chamber.sealed, 'the gate holds nobody, so nothing seals it').toBe(false);
  expect(gate.chamber.doors.length, 'the gate offers a choice of ways on').toBeGreaterThanOrEqual(2);
  expect(gate.chamber.doors.every((door) => door.open)).toBe(true);
  const door = gate.chamber.doors[0], to = floor.rooms[door.to];

  // Standing in the ring offers the door and takes nothing, however long the knight waits there.
  await game.teleport(door.x, door.z);
  await game.step(1500);
  const standing = await game.state();
  expect(standing.chamber.doors[0].over, 'the knight is not standing at the door').toBe(true);
  expect(standing.chamber.id, 'standing at the door took it by itself').toBe(0);
  await expect(page.locator('.swap-prompt')).toContainText('take this door', { ignoreCase: true });
  await expect(page.locator('.swap-prompt')).toContainText(to.name);

  // The key: the fade goes down, the knight is set down at the far chamber's near wall, and it comes up.
  const programs = standing.render.programs;
  await page.keyboard.press('KeyE');
  await game.step(32);
  const leaving = await game.state();
  expect(leaving.chamber.crossing, 'the swap key did not start a crossing').toBe('out');
  expect(leaving.chamber.id, 'the knight left before the fade was down').toBe(0);
  await game.step(400, true);
  const arrived = await game.state();
  expect(arrived.chamber.crossing, 'the fade never lifted').toBeNull();
  expect(arrived.chamber.id, 'the door led somewhere other than the chamber it named').toBe(door.to);
  expect(arrived.player.x).toBeCloseTo(to.entry.x * TILE, 0);
  expect(arrived.player.z).toBeCloseTo(to.entry.z * TILE, 0);
  expect(arrived.render.programs, 'crossing a door compiled a shader').toBe(programs);

  // The first chamber past the gate is always a fight, so it sealed behind him.
  expect(floor.spawns.some((spawn) => spawn.room === door.to), 'the fixture needs a fight past the gate').toBe(true);
  expect(arrived.chamber.sealed, 'the chamber did not seal on arrival').toBe(true);
  expect(arrived.chamber.doors.every((way) => !way.open), 'a sealed chamber showed an open door').toBe(true);

  // Its door, pressed while the bodies stand, is barred: no prompt, no crossing, no move.
  const barred = arrived.chamber.doors[0];
  // Nothing swings at him while he stands there: this is about the door, not the fight.
  await game.configureCombat({ enemies: floor.spawns.map((spawn, index) => ({ spawn, index })).filter(({ spawn }) => spawn.room === door.to).map(({ index }) => ({ index, cooldown: 30 })) });
  await game.teleport(barred.x, barred.z);
  await game.step(200);
  const held = await game.state();
  expect(held.chamber.doors[0].over, 'the knight is not standing at the barred door').toBe(true);
  await expect(page.locator('.swap-prompt')).toHaveCount(0);
  await page.keyboard.press('KeyE');
  await game.step(400);
  const still = await game.state();
  expect(still.chamber.crossing, 'a barred door started a crossing').toBeNull();
  expect(still.chamber.id, 'a barred door let the knight through').toBe(door.to);
});
