import type { Page } from '@playwright/test';
import { altarHall, gateRacks, generateFloor, HALL_SEED, TILE } from '../../app/dungeon-floor.ts';
import { freshMeta, UPGRADES, type Meta } from '../../app/dungeon-meta.ts';
import { DEFAULT_BOSS, DEFAULT_SEEDS, enterKeep, expect, type GameWindow, keyToward, pinnedDraws, pinSeeds, press, test, veilSeen, walkUntil, watchVeil, WARM_UP, type Snapshot } from './helpers.ts';

// Plan 020 Stage C: the Tide Altar's hall. Every scenario here opts out of `?hall=skip` (D11), so the page boots the way a player's does: into the hall, past
// no menu but the slot picker. The hall is the only coverage of that default flow in the suite (the rest skips it), so these stay on the PR gate.
//
// What they hold is that the running game is wired to the pure rules (`altarHall`, `gateRacks`, `lockArm`): that the scene really has the altar, the racks and the
// way down on it (`hallProps`, read off the groups they were attached to), that the shop holds the world, that the arm is chosen by walking into a rack's ring
// and settled by the way down, and that nothing of the hall is left in the run. The walking, the swap key and the shop's buttons are real input; the fixtures
// only stage a save (`setMeta`) and teleport to a door.
test.use({ hall: true });

const OWNED: Meta = { ...freshMeta(), pearls: 300, arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' };
const read = (page: Page) => page.evaluate(() => JSON.parse((window as GameWindow).render_game_to_text!()) as Snapshot);
const lungs = UPGRADES.find((upgrade) => upgrade.id === 'lungs')!;

test('ENTER lands in the hall behind the veil: the altar, the racks it owns and the way down are on the scene, nobody is in it, and it drew no random number', async ({ page }) => {
  test.setTimeout(120_000 + WARM_UP);
  // Slot 1 holds three arms before the page loads, so there are racks to find. The plain URL: no eager boot, no `hall=skip`.
  await pinSeeds(page, DEFAULT_SEEDS);
  await page.addInitScript((save) => localStorage.setItem('drowned-keep:1:meta', save), JSON.stringify(OWNED));
  await page.goto('/');
  await expect(page.locator('.intro-screen .primary-action')).toBeEnabled();
  expect(await page.evaluate(() => typeof (window as GameWindow).render_game_to_text), 'the keep was built before any press').toBe('undefined');
  await watchVeil(page);
  await enterKeep(page);

  // The veil, and what it says it is raising: the hall, not a floor of the keep.
  await expect(page.locator('.loading-veil'), 'choosing a slot raised no veil').toBeVisible();
  await expect(page.locator('.loading-veil')).toContainText('Waking the keep');
  await expect(page.locator('.loading-veil .veil-sub'), 'the veil is raising something other than the hall').toHaveText('The Tide Altar');
  await expect(page.locator('.loading-veil')).toHaveCount(0, { timeout: WARM_UP });
  await expect(page.locator('.intro-screen')).toBeHidden();
  expect(await veilSeen(page)).toContain('Waking the keep');

  const state = await read(page);
  expect(state.hall, 'the press built a floor of the keep, not the hall').toBe(true);
  expect(state.mode).toBe('playing');
  expect(state.floor.seed, 'the hall is not the room that was judged by eye').toBe(HALL_SEED);
  expect(state.floor.level).toBe(1);
  expect(state.enemies, 'someone stands in the hall').toEqual([]);
  expect(state.remaining).toBe(0);
  expect(state.roomName).toBe('The Tide Altar');
  expect(state.altarOpen).toBe(false);
  // The hall drew nothing from the random stream, which is what keeps every pinned seed where it was: the first floor of the keep takes the first word.
  expect(await pinnedDraws(page), 'building the hall drew a floor seed').toBe(0);

  // What the scene placed, read off the groups it was attached to.
  const props = state.hallProps!;
  expect(props, 'a hall reports no props').not.toBeNull();
  // He arrives at the room's way in, not on the altar.
  expect(Math.hypot(state.player.x - props.altar!.x, state.player.z - props.altar!.z), 'the knight arrives on the altar').toBeGreaterThan(props.altar!.radius * 2);
  expect(props.altar, 'the altar is not on the scene').toMatchObject({ x: 0, z: 0, inScene: true, over: false });
  const hall = altarHall(), slots = gateRacks(hall);
  expect(props.racks, 'the hall does not show exactly the arms owned besides the one in hand').toEqual(['spear', 'maul']);
  expect(state.racks.map((rack) => rack.kind)).toEqual(['spear', 'maul']);
  for (const rack of state.racks) {
    const slot = slots.find((s) => s.arm === rack.kind)!;
    expect([rack.x, rack.z], `the ${rack.kind} does not stand on its slot`).toEqual([expect.closeTo(slot.x, 3), expect.closeTo(slot.z, 3)]);
    expect(rack.inScene, `the ${rack.kind} rack is not attached to the floor`).toBe(true);
  }
  const door = hall.doors[0];
  expect(props.wayDown, 'the way down is not on the scene, or is not signed as it').toMatchObject({ x: expect.closeTo(door.x * TILE, 3), z: expect.closeTo(door.z * TILE, 3), inScene: true, sign: 'down', open: true });
  expect(props.stair, 'the hall built a stair').toBe(false);
  // No vitality, no rank bar: the knight is not at risk.
  await expect(page.getByRole('progressbar', { name: 'Vitality' }), 'the hall shows the vitality bar').toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Progress to the next boon' }), 'the hall shows the rank bar').toHaveCount(0);
});

test('the altar is a place, the arm is chosen on a rack, and the way down settles it and starts the run on floor one', async ({ game, page }) => {
  // The Tideblade in hand with the spear and the maul owned: two racks. 300 pearls to spend at the altar.
  await game.setMeta(OWNED);
  await game.enter();
  const arrival = await game.state();
  expect(arrival.hall, 'the page did not boot into the hall').toBe(true);
  expect(arrival.weapon.id).toBe('tideblade');
  expect(arrival.run.armLocked, 'the arm is settled before the way down was taken').toBe(false);
  const altar = arrival.hallProps!.altar!;

  // ---- 1. The altar. Walk to it by keyboard; the prompt names it before anything is pressed. ----
  expect(arrival.objective.stairOpen, 'the hall opened a stair').toBe(false);
  expect(arrival.hallProps!.stair, 'the hall built a stair').toBe(false);
  expect(await walkUntil(game, page, altar, (state) => state.hallProps!.altar!.over), 'the walk never reached the altar\'s ring').toBe(true);
  await expect(page.locator('.swap-prompt'), 'the prompt does not name the altar').toContainText('open the altar');
  await expect(page.locator('.swap-prompt')).toContainText('300 pearls to spend');
  expect((await game.state()).altarOpen, 'precondition: the shop opens on the press, not on arrival').toBe(false);

  // Time that is running: a swing in the air. If the shop holds the world, the swing stays exactly where it was.
  await press(page, 'attack');
  await game.step(16);
  const swinging = await game.state();
  expect(swinging.player.attackTime, 'precondition: a swing is under way, so there is a clock to hold').toBeGreaterThan(0);
  await press(page, 'swap');
  await game.step(16);
  const open = await game.state();
  expect(open.altarOpen, 'the swap key at the altar did not open the shop').toBe(true);
  expect(open.boonOffer, 'the shop is reported as a boon draft').toBe(false);
  await expect(page.getByRole('dialog', { name: /Spend what/ })).toBeVisible();
  await expect(page.locator('.altar-purse')).toContainText('300 pearls');
  await expect(page.locator('.altar-lore')).toContainText('Arms are chosen on the racks of this hall');
  await expect(page.locator('.swap-prompt'), 'the prompt stays over the shop').toHaveCount(0);
  expect(open.player.attackTime, 'precondition: the swing is still under way when the shop opens').toBeGreaterThan(0);
  const key = keyToward({ x: 1, z: 0 }).key;
  await page.keyboard.down(key);
  await game.step(1000);
  await page.keyboard.up(key);
  const held = await game.state();
  expect(held.player.attackTime, 'the world went on under the shop: the swing ran down').toBe(open.player.attackTime);
  expect([held.player.x, held.player.z], 'the knight walked while the shop was open').toEqual([open.player.x, open.player.z]);
  expect(held.altarOpen).toBe(true);

  // Buy a rank. Deep Lungs; the note says so and the save has it.
  await page.locator('[data-item="lungs"]').click();
  await expect(page.locator('.altar-note')).toHaveText('Deep Lungs bought.');
  const bought = await game.meta();
  expect(bought.upgrades, 'the purchase did not reach the save').toEqual({ lungs: 1 });
  expect(bought.pearls, 'the purchase was not charged at the Altar\'s price').toBe(300 - lungs.price(0));

  // Escape puts it away and the world goes on: the swing runs down, and a key moves the knight.
  await page.keyboard.press('Escape');
  await game.step(16);
  const closed = await game.state();
  expect(closed.altarOpen, 'Escape did not close the shop').toBe(false);
  expect(closed.mode, 'Escape paused the world instead of closing the shop').toBe('playing');
  await expect(page.locator('.altar-view')).toHaveCount(0);
  await game.step(600);
  expect((await game.state()).player.attackTime, 'the world did not resume when the shop closed').toBe(0);
  await page.keyboard.down(key);
  await game.step(400);
  await page.keyboard.up(key);
  const walked = await game.state();
  expect(Math.hypot(walked.player.x - closed.player.x, walked.player.z - closed.player.z), 'the knight cannot move once the shop is closed').toBeGreaterThan(1);

  // ---- 2. The arm is chosen here. Walk into the maul's ring and swap. ----
  expect(walked.racks.map((rack) => rack.kind), 'the hall shows no racks for the arms owned').toEqual(['spear', 'maul']);
  const maul = walked.racks.find((rack) => rack.kind === 'maul')!, spear = walked.racks.find((rack) => rack.kind === 'spear')!;
  expect(await walkUntil(game, page, maul, (state) => state.racks.find((rack) => rack.kind === 'maul')!.over), 'the walk never reached the maul\'s ring').toBe(true);
  const standing = await game.state();
  expect(standing.racks.find((rack) => rack.kind === 'spear')!.over, 'the spear\'s ring answers for the maul\'s').toBe(false);
  expect(standing.weapon.id, 'standing in the ring took the arm by itself').toBe('tideblade');
  await expect(page.locator('.swap-prompt')).toContainText('Bell Maul');
  await press(page, 'swap');
  await game.step(32);
  const armed = await game.state();
  expect(armed.weapon.id, 'the swap key did not take the arm of the rack he stood in').toBe('maul');
  expect(armed.racks.map((rack) => [rack.kind, rack.x, rack.z]), 'the sword he set down is not on the maul\'s slot, or the spear\'s rack moved').toEqual(
    [['spear', expect.closeTo(spear.x, 3), expect.closeTo(spear.z, 3)], ['tideblade', expect.closeTo(maul.x, 3), expect.closeTo(maul.z, 3)]],
  );
  // Still his to undo: nothing is written until the way down is taken.
  expect((await game.meta()).arm, 'the choice was written before the way down').toBe('tideblade');
  expect(armed.run.armLocked).toBe(false);

  // ---- 3. The way down starts a run. ----
  const down = armed.hallProps!.wayDown!;
  expect(await walkUntil(game, page, down, (state) => state.hallProps!.wayDown!.over, 240), 'the walk never reached the way down').toBe(true);
  await expect(page.locator('.swap-prompt'), 'the prompt does not name the way down').toContainText('take the way down');
  await expect(page.locator('.swap-prompt')).toContainText('Bell Maul');
  expect(await pinnedDraws(page), 'precondition: nothing has drawn a floor seed yet').toBe(0);
  await watchVeil(page);
  await press(page, 'swap');
  await game.built();
  await game.step(16);
  expect(await veilSeen(page), 'the way down raised no veil').toContain('A new keep rises');

  const run = await game.state();
  expect(run.hall, 'the way down led back to the hall').toBe(false);
  expect(run.mode).toBe('playing');
  expect(run.floor.level).toBe(1);
  expect(run.floor.seed, 'floor one was not dealt the first pinned seed').toBe(DEFAULT_SEEDS[0]);
  expect(await pinnedDraws(page), 'the way down drew other than one floor seed').toBe(1);
  expect(run.weapon.id, 'the run did not start with the arm taken in the hall').toBe('maul');
  expect((await game.meta()).arm, 'the arm was not written at the way down').toBe('maul');
  expect(run.run.start.arm).toBe('maul');
  expect(run.run.start.maxHp, 'what the altar sold was not dealt to the run').toBe(110);
  expect(run.run.armLocked, 'the arm is not settled on floor one').toBe(true);
  expect(run.racks, 'the Tide Gate of floor one still holds racks').toEqual([]);
  expect(run.hallProps).toBeNull();
  await expect(page.getByRole('progressbar', { name: 'Vitality' })).toHaveAttribute('aria-valuemax', '110');

  // ---- 4. Nothing of the hall is in the run: floor one is what the generator deals, stair, doors and bodies. ----
  // Plan 021: the page boots with `?boss=` (the Captain, `DEFAULT_BOSS`), so the floor the generator lays for the comparison is laid with the boss the run holds, whatever the deal makes of this seed.
  const dealt = generateFloor(DEFAULT_SEEDS[0], 1, { boss: DEFAULT_BOSS }), goal = dealt.rooms[dealt.goal];
  expect(run.floor.rooms, 'floor one\'s rooms are not the generator\'s').toEqual(dealt.rooms);
  expect(run.floor.edges).toEqual(dealt.edges);
  expect(run.enemies.length, 'floor one\'s bodies are not the generator\'s').toBe(dealt.spawns.filter((spawn) => !spawn.buried).length);
  expect(run.stair, 'the stair is not at the goal room\'s heart').toMatchObject({ x: expect.closeTo(goal.x * TILE, 3), z: expect.closeTo(goal.z * TILE, 3) });
  expect(run.objective.stairOpen, 'the stair is open before its boss fell').toBe(false);
  const sign = (room: (typeof dealt.rooms)[number]) => room.reward ?? (room.role === 'goal' ? 'stair' : room.encounter === 'sanctuary' ? 'rest' : 'fight');
  const gateDoors = dealt.doors.filter((d) => d.from === 0);
  expect(run.chamber.doors.map((d) => [d.to, d.sign]), 'the gate\'s doors are not the generator\'s').toEqual(gateDoors.map((d) => [d.to, sign(dealt.rooms[d.to])]));
  expect(gateDoors.length, 'precondition: the gate has more than one door, so the hall\'s single door is a difference').toBeGreaterThan(1);
});
