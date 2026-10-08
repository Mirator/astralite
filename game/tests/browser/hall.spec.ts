import type { Page } from '@playwright/test';
import { altarHall, gateRacks, generateFloor, HALL_SEED, hallShrines, TILE } from '../../app/dungeon-floor.ts';
import { ARM_PRICES, BUY_HOLD, freshMeta, UPGRADES, type BoughtArm, type Meta } from '../../app/dungeon-meta.ts';
import { DEFAULT_BOSS, DEFAULT_SEEDS, enterKeep, expect, type GameWindow, keyToward, pinnedDraws, pinSeeds, press, test, veilSeen, walkUntil, watchVeil, WARM_UP, type Snapshot } from './helpers.ts';

// Plan 020 Stage C: the Tide Altar's hall. Every scenario here opts out of `?hall=skip` (D11), so the page boots the way a player's does: into the hall, past
// no menu but the slot picker. The hall is the only coverage of that default flow in the suite (the rest skips it), so these stay on the PR gate.
//
// What they hold is that the running game is wired to the pure rules (`altarHall`, `gateRacks`, `lockArm`): that the scene really has the altar, the racks and the
// way down on it (`hallProps`, read off the groups they were attached to), that the shop holds the world, that the arm is chosen by walking into a rack's ring
// and settled by the way down, and that nothing of the hall is left in the run. The walking, the swap key and the shop's buttons are real input; the fixtures
// only stage a save (`setMeta`) and teleport to a door.
//
// Plan 025 Stage C (D8): the hall is the shop. Every arm stands on its rack, a locked one as a silhouette with its price on a plaque; the four upgrades are
// shrines with a notch per rank; a locked arm is tried by taking it and bought by holding the swap key; the old dialog is a page of the pause card. The rules
// (hold length, prices, rank caps, "a tried arm is not owned") are node tests in tests/dungeon-meta.test.ts; what is held here is the wiring, by real keys.
test.use({ hall: true });

const OWNED: Meta = { ...freshMeta(), pearls: 300, arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' };
const read = (page: Page) => page.evaluate(() => JSON.parse((window as GameWindow).render_game_to_text!()) as Snapshot);
const lungs = UPGRADES.find((upgrade) => upgrade.id === 'lungs')!;
// Plan 025: the hall's draw calls with OWNED's save. Measured 2026-10-07 on d3d11: 212 calls (114,368 triangles, 79 shadow calls) before Stage C, with two racks;
// 255 (118,196 triangles, 91 shadow calls) with six racks (four locked, with plaques) and four shrines. The floor is the old hall, so a shop that drew nothing fails;
// the ceiling is the figure measured, 253 under the 508 the frame budget holds the worst chamber to.
// Merged with Stage B (2026-10-08): 256 on both d3d11 (local) and SwiftShader (CI run 37735911805). The one call is Stage B's sconce floor pools,
// the +1 it measured on every scene (frame-budget.spec.ts); Stage C's 255 was taken before the two met.
const CALLS_FLOOR = 212, CALLS_CEILING = 256;

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
  expect(state.mode, 'the hall opened on a card').toBe('playing');
  // The hall drew nothing from the random stream, which is what keeps every pinned seed where it was: the first floor of the keep takes the first word.
  expect(await pinnedDraws(page), 'building the hall drew a floor seed').toBe(0);

  // What the scene placed, read off the groups it was attached to.
  const props = state.hallProps!;
  expect(props, 'a hall reports no props').not.toBeNull();
  // He arrives at the room's way in, not on the altar.
  expect(Math.hypot(state.player.x - props.altar!.x, state.player.z - props.altar!.z), 'the knight arrives on the altar').toBeGreaterThan(props.altar!.radius * 2);
  expect(props.altar, 'the altar is not on the scene').toMatchObject({ x: 0, z: 0, inScene: true, over: false });
  const hall = altarHall(), slots = gateRacks(hall);
  // Plan 025 (D8): every arm but the one in hand stands on its rack; the ones not owned are locked, each with its price on a plaque, and the owned ones have none.
  const others = ['fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask'];
  expect(props.racks, 'the hall does not show every arm besides the one in hand').toEqual(others);
  expect(state.racks.map((rack) => rack.kind)).toEqual(others);
  expect(state.racks.map((rack) => [rack.kind, rack.locked, rack.plaque]), 'a rack is locked that is owned, or a plaque does not carry its arm\'s price').toEqual(
    others.map((kind) => [kind, !OWNED.arms.includes(kind as BoughtArm), OWNED.arms.includes(kind as BoughtArm) ? null : ARM_PRICES[kind as BoughtArm]]),
  );
  // The four shrines, read off the scene: on their spots, no notch lit, and the first rank's price on each plaque.
  expect(props.shrines.map((shrine) => [shrine.id, shrine.x, shrine.z, shrine.inScene, shrine.lit, shrine.ranks, shrine.plaque]), 'the shrines are not on the scene as the save has them').toEqual(
    hallShrines(altarHall()).map((spot, i) => [UPGRADES[i].id, expect.closeTo(spot.x, 3), expect.closeTo(spot.z, 3), true, 0, UPGRADES[i].ranks, UPGRADES[i].price(0)]),
  );
  // The counter is on screen in the hall, holding the save's balance, and nothing pulses: no run banked before this hall.
  await expect(page.locator('.hall-purse')).toHaveAttribute('data-pearls', String(OWNED.pearls));
  await expect(page.locator('.hall-purse.pulse')).toHaveCount(0);
  // Plan 025: the shop's meshes are drawn, and stay at the measured cost (CALLS_FLOOR and CALLS_CEILING above).
  test.info().annotations.push({ type: 'hall render', description: JSON.stringify({ calls: state.render.calls, triangles: state.render.triangles, shadow: state.render.shadow }) });
  expect(state.render.calls, 'the hall drew no more calls than before the shop, so the shop is not drawn').toBeGreaterThan(CALLS_FLOOR);
  expect(state.render.calls, 'the hall costs more draw calls than measured').toBeLessThanOrEqual(CALLS_CEILING);
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
  expect((await game.state()).mode, 'precondition: the list opens on the press, not on arrival').toBe('playing');

  // Time that is running: a swing in the air. If the shop holds the world, the swing stays exactly where it was.
  await press(page, 'attack');
  await game.step(16);
  const swinging = await game.state();
  expect(swinging.player.attackTime, 'precondition: a swing is under way, so there is a clock to hold').toBeGreaterThan(0);
  await press(page, 'swap');
  await game.step(16);
  const open = await game.state();
  // Plan 025 (D8): the list is a page of the pause card, which is what holds the world.
  expect(open.mode, 'the swap key at the altar did not pause the hall on its list').toBe('paused');
  expect(open.boonOffer, 'the shop is reported as a boon draft').toBe(false);
  await expect(page.getByRole('heading', { name: /Spend what/ })).toBeVisible();
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
  expect(held.mode).toBe('paused');

  // Buy a rank. Deep Lungs; the note says so and the save has it.
  await page.locator('[data-item="lungs"]').click();
  await expect(page.locator('.altar-note')).toHaveText('Deep Lungs bought.');
  const bought = await game.meta();
  expect(bought.upgrades, 'the purchase did not reach the save').toEqual({ lungs: 1 });
  expect(bought.pearls, 'the purchase was not charged at the Altar\'s price').toBe(300 - lungs.price(0));
  await expect(page.locator('.hall-purse'), 'the counter did not follow the list\'s purchase').toHaveAttribute('data-pearls', String(300 - lungs.price(0)));

  // Escape puts it away and the world goes on: the swing runs down, and a key moves the knight.
  await page.keyboard.press('Escape');
  await game.step(16);
  const closed = await game.state();
  expect(closed.mode, 'Escape did not put the list away and let the world go on').toBe('playing');
  await expect(page.locator('.altar-view')).toHaveCount(0);
  // What the list bought is on the shrine when the hall comes back: one notch lit, the second rank's price on its plaque.
  expect(closed.hallProps!.shrines.find((shrine) => shrine.id === 'lungs'), 'the list\'s purchase is not on the Deep Lungs shrine').toMatchObject({ lit: 1, plaque: lungs.price(1) });
  await game.step(600);
  expect((await game.state()).player.attackTime, 'the world did not resume when the shop closed').toBe(0);
  await page.keyboard.down(key);
  await game.step(400);
  await page.keyboard.up(key);
  const walked = await game.state();
  expect(Math.hypot(walked.player.x - closed.player.x, walked.player.z - closed.player.z), 'the knight cannot move once the shop is closed').toBeGreaterThan(1);

  // ---- 2. The arm is chosen here. Walk into the maul's ring and swap. ----
  expect(walked.racks.filter((rack) => !rack.locked).map((rack) => rack.kind), 'the hall shows no racks for the arms owned').toEqual(['spear', 'maul']);
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
  expect(armed.racks.filter((rack) => !rack.locked).map((rack) => [rack.kind, rack.x, rack.z]), 'the sword he set down is not on the maul\'s slot, or the spear\'s rack moved').toEqual(
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

// Plan 025 Stage C: the shop in the hall, by real keys. 95 pearls and the maul owned: Deep Lungs (30) and then its second rank (50) are both within reach, so a
// hold that bought twice could; the Twin Fangs (50) are within reach after the first rank and the Salt Spear (60) is not, so a hold there is refused. Second Tide
// is held already, so its shrine has to come up lit from the save the pooled page was entered with, not from the one it was built with.
const SHOP: Meta = { ...freshMeta(), pearls: 95, arms: ['tideblade', 'maul'], arm: 'tideblade', upgrades: { tide: 1 } };

test('the hall is the shop: a shrine bought by holding the swap key, once; a locked arm tried by taking it and bought by holding; and a tried arm left behind at the way down', async ({ game, page }) => {
  await game.setMeta(SHOP);
  await game.enter();
  const arrival = await game.state();
  expect(arrival.hall, 'the page did not boot into the hall').toBe(true);
  // Precondition: the plaques say what the purse covers: the Twin Fangs' (50) burns, the flask's (100 of 95) is dimmed.
  expect(arrival.racks.find((rack) => rack.kind === 'flask'), 'the flask\'s plaque burns as affordable at 95 pearls').toMatchObject({ locked: true, plaque: 100, plaqueReady: false });
  expect(arrival.racks.find((rack) => rack.kind === 'fangs'), 'the Twin Fangs\' plaque is dimmed at 95 pearls').toMatchObject({ locked: true, plaque: 50, plaqueReady: true });
  const lungs = UPGRADES.find((upgrade) => upgrade.id === 'lungs')!, shrine = arrival.hallProps!.shrines.find((each) => each.id === 'lungs')!;
  expect(arrival.hallProps!.shrines.find((each) => each.id === 'tide'), 'the Second Tide shrine does not show the rank the save holds').toMatchObject({ lit: 1, ranks: 1, plaque: null });
  expect(shrine, 'the Deep Lungs shrine does not show the save').toMatchObject({ lit: 0, ranks: 3, plaque: lungs.price(0) });

  // ---- 1. Deep Lungs: walk into the shrine's ring by keyboard; the card names it; a short press buys nothing, a hold buys exactly one rank. ----
  await game.teleport(shrine.x + 2.2, shrine.z);
  await game.step(32);
  expect(await walkUntil(game, page, shrine, (state) => state.hallProps!.shrines.find((each) => each.id === 'lungs')!.over), 'the walk never reached the Deep Lungs shrine').toBe(true);
  await expect(page.locator('.swap-prompt'), 'the shrine does not offer itself to be held').toContainText('Hold');
  await expect(page.locator('.swap-prompt')).toContainText('buy Deep Lungs');
  await expect(page.locator('.rack-card'), 'no card stands at the shrine').toContainText('Deep Lungs');
  const key = 'KeyE';
  await page.keyboard.down(key);
  await game.step(300);
  // Half a hold: nothing bought yet, and the ring is filling, which is what makes "nothing bought" more than a press that was never seen.
  expect((await game.meta()).upgrades, 'the press bought before the hold had run').toEqual(SHOP.upgrades);
  const halfway = await game.state();
  expect(halfway.hallProps!.buying.target, 'precondition: the hold is on the shrine').toBe('upgrade:lungs');
  expect(halfway.hallProps!.buying.fill, 'precondition: the ring is filling, so the press was seen').toBeGreaterThan(0.3);
  await page.keyboard.up(key);
  await game.step(32);
  expect((await game.meta()).upgrades, 'a short press bought').toEqual(SHOP.upgrades);
  expect((await game.state()).hallProps!.buying.fill, 'letting go left the ring filled').toBe(0);
  // Now held through: one rank at BUY_HOLD, and held three times as long, still one.
  await page.keyboard.down(key);
  await game.step(Math.round(BUY_HOLD * 1000) - 150);
  expect((await game.meta()).upgrades, 'the hold bought before BUY_HOLD').toEqual(SHOP.upgrades);
  await game.step(300);
  const once = await game.meta();
  expect([once.upgrades, once.pearls], 'the hold did not buy one rank of Deep Lungs at its price').toEqual([{ ...SHOP.upgrades, lungs: 1 }, SHOP.pearls - lungs.price(0)]);
  const flying = await game.state();
  expect(flying.hallProps!.pearls, 'no pearls flew from the altar to the shrine').toBeGreaterThan(0);
  expect(once.pearls, 'precondition: the second rank is affordable, or "exactly once" could not fail').toBeGreaterThanOrEqual(lungs.price(1));
  await game.step(Math.round(BUY_HOLD * 3000));
  await page.keyboard.up(key);
  await game.step(32);
  expect((await game.meta()).upgrades, 'one hold bought more than one rank').toEqual({ ...SHOP.upgrades, lungs: 1 });
  const lit = await game.state();
  expect(lit.hallProps!.shrines.find((each) => each.id === 'lungs'), 'the shrine does not show the rank bought').toMatchObject({ lit: 1, plaque: lungs.price(1) });
  expect(lit.hallProps!.pearls, 'the pearls never landed').toBe(0);
  await expect(page.locator('.hall-purse'), 'the counter did not tick down to the new balance').toHaveAttribute('data-pearls', String(once.pearls));

  // ---- 2. The maul, owned: taken off its rack. Then the Twin Fangs, locked: one hold of the swap key takes them to try on the press and buys them at BUY_HOLD. ----
  const racks = lit.racks, maul = racks.find((rack) => rack.kind === 'maul')!, fangs = racks.find((rack) => rack.kind === 'fangs')!;
  await game.teleport(maul.x, maul.z + 1.6);
  await game.step(32);
  expect(await walkUntil(game, page, maul, (state) => state.racks.find((rack) => rack.kind === 'maul')!.over), 'the walk never reached the maul').toBe(true);
  await page.keyboard.press(key);
  await game.step(32);
  expect((await game.state()).weapon.id, 'precondition: the maul, owned, is in hand').toBe('maul');
  await game.teleport(fangs.x, fangs.z + 1.6);
  await game.step(32);
  expect(await walkUntil(game, page, fangs, (state) => state.racks.find((rack) => rack.kind === 'fangs')!.over), 'the walk never reached the Twin Fangs').toBe(true);
  await expect(page.locator('.swap-prompt'), 'a locked rack does not offer its arm to try').toContainText('try the Twin Fangs');
  await expect(page.locator('.rack-card'), 'the card at a locked rack does not show the arm\'s numbers').toContainText('Damage');
  await expect(page.locator('.rack-card')).toContainText('Twin Fangs');
  await page.keyboard.down(key);
  await game.step(200);
  expect((await game.meta()).arms, 'the press itself bought the arm, or trying it did').toEqual(['tideblade', 'maul']);
  const trying = await game.state();
  expect(trying.weapon.id, 'the swap key at a locked rack did not hand over the arm to try').toBe('fangs');
  expect(trying.hallProps!.tried, 'the arm in hand is not reported as tried').toBe('fangs');
  expect(trying.hallProps!.buying, 'precondition: the hold is on the arm tried, and the ring filling').toMatchObject({ target: 'arm:fangs', fill: expect.any(Number) });
  expect(trying.hallProps!.buying.fill, 'precondition: the ring is filling').toBeGreaterThan(0.1);
  await game.step(Math.round(BUY_HOLD * 1000));
  await page.keyboard.up(key);
  await game.step(32);
  const fanged = await game.meta();
  expect(fanged.arms, 'holding the swap key on the arm tried did not buy it').toEqual(['tideblade', 'fangs', 'maul']);
  expect(fanged.pearls).toBe(once.pearls - ARM_PRICES.fangs);
  expect(fanged.arm, 'buying an arm equipped it in the save').toBe('tideblade');
  const bought = await game.state();
  expect([bought.weapon.id, bought.hallProps!.tried], 'the arm bought is not in hand as an owned one').toEqual(['fangs', null]);

  // ---- 3. The Salt Spear, too dear: taken to try and swung, but a hold buys nothing; walked down with, it stays, and the run takes the Twin Fangs. ----
  const spear = bought.racks.find((rack) => rack.kind === 'spear')!;
  expect(spear.plaqueReady, 'precondition: the spear is out of reach now').toBe(false);
  await game.teleport(spear.x, spear.z + 1.6);
  await game.step(32);
  expect(await walkUntil(game, page, spear, (state) => state.racks.find((rack) => rack.kind === 'spear')!.over), 'the walk never reached the Salt Spear').toBe(true);
  await page.keyboard.press(key);
  await game.step(32);
  expect((await game.state()).weapon.id, 'precondition: the spear was taken to try').toBe('spear');
  await press(page, 'attack');
  await game.step(16);
  expect((await game.state()).player.attackTime, 'the arm tried cannot be swung in the hall').toBeGreaterThan(0);
  await game.step(900);
  // Off the rack, so the press is not a swap back: a hold with the spear in hand.
  await game.teleport(spear.x, spear.z + 2.6);
  await game.step(32);
  await expect(page.locator('.swap-prompt'), 'the arm tried does not offer itself to be bought').toContainText('buy the Salt Spear');
  await expect(page.locator('.swap-prompt')).toContainText('short');
  await page.keyboard.down(key);
  await game.step(Math.round(BUY_HOLD * 2000));
  const refused = await game.state();
  await page.keyboard.up(key);
  await game.step(32);
  expect(refused.hallProps!.buying.fill, 'the ring filled for an arm the purse cannot cover').toBe(0);
  expect((await game.meta()).arms, 'a hold bought an arm the purse cannot cover').toEqual(['tideblade', 'fangs', 'maul']);
  const down = refused.hallProps!.wayDown!;
  expect(await walkUntil(game, page, down, (state) => state.hallProps!.wayDown!.over, 240), 'the walk never reached the way down').toBe(true);
  await expect(page.locator('.swap-prompt'), 'the way down does not say the tried arm stays').toContainText('Twin Fangs');
  await press(page, 'swap');
  await game.built();
  await game.step(16);
  const run = await game.state();
  expect(run.hall, 'the way down led back to the hall').toBe(false);
  expect(run.weapon.id, 'the run did not start with the owned arm he last held (the Twin Fangs), with the spear only tried').toBe('fangs');
  const settled = await game.meta();
  expect(settled.arm, 'the way down did not write the owned arm').toBe('fangs');
  expect(settled.arms, 'walking down with the spear made it owned').toEqual(['tideblade', 'fangs', 'maul']);
  // Nothing of the shop is left in the run: no counter, no shrine, no rack.
  await expect(page.locator('.hall-purse'), 'the pearl counter stayed on screen in the run').toHaveCount(0);
  expect(run.hallProps).toBeNull();
  expect(run.racks).toEqual([]);
});
