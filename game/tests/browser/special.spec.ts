import type { Page } from '@playwright/test';
import { ARROW_KEYS, canStand, expect, fakePad, type Floor, type Game, hasClearPath, hold, press, release, SCREEN_DIRECTIONS, type ScreenDirection, strikeStance, test, TILE, type Point, type Snapshot } from './helpers.ts';

// Plan 016 Stages B and C: a special for every arm. Real input only - K, the right button, pad X and the touch
// SPECIAL button; the hooks put an arm in hand and stage a body, and read the state back.

type Special = { id: string; ready: boolean; cooldown: number; charging: boolean; charge: number; held: number; live: boolean; buffered: number; harpoon: { phase: 'out' | 'back'; x: number; z: number } | null; bare: boolean; vault: { target: number | null; distance: number; landed: boolean } | null };
type Effects = Snapshot['effects'] & { flares: number; lane: { length: number; opacity: number } | null };
const effectsOf = (state: Snapshot) => state.effects as Effects;
const specialOf = (state: Snapshot) => (state.player as Snapshot['player'] & { special: Special | null }).special;
const weaponSpecial = (state: Snapshot) => (state.weapon as Snapshot['weapon'] & { special: { cooldown: number; swing: { damage?: number } } | null }).special;

/** An awake body of this kind, by spawn index (nothing has died yet on a fresh floor). */
const pick = (state: Snapshot, kind: string) => {
  const index = state.enemies.findIndex((enemy) => enemy.kind === kind && enemy.awake);
  expect(index, `no awake ${kind} on this floor`).toBeGreaterThanOrEqual(0);
  return index;
};

/** Stand `distance` from a spot in the start chamber, facing it, with a body of `kind` staged on it. */
const stage = async (game: Game, page: Page, kind: string, options: { distance?: number; hp?: number; spot?: Point } = {}) => {
  const floor = await game.floor(), spot = options.spot ?? { x: 0, z: 0 };
  const stance = strikeStance(floor, spot, { distance: options.distance ?? 2 });
  const state = await game.state(), index = pick(state, kind);
  await game.teleport(stance.x, stance.z);
  await page.keyboard.down(stance.key); await game.step(1); await page.keyboard.up(stance.key);
  await game.configureCombat({ enemies: [{ index, x: spot.x, z: spot.z, cooldown: 10, windup: 0, ...(options.hp ? { hp: options.hp } : {}) }] });
  return { floor, spot, stance, index, hp: options.hp ?? (await game.state()).enemies[index].hp };
};

const sweep = (page: Page) => page.locator('.special-sweep').evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--ready') || (el as HTMLElement).style.getPropertyValue('--ready')));

test('the Undertow Lunge on K cuts a warden once, carries the knight down its line, and the cooldown blocks a second', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const { index, hp, stance } = await stage(game, page, 'warden');
  const before = await game.state();
  expect(specialOf(before)).toMatchObject({ id: 'undertow', ready: true, cooldown: 0, charging: false, live: false });
  const damage = weaponSpecial(before)!.swing.damage!;

  await press(page, 'special');
  await game.step(16);
  expect(specialOf(await game.state())!.live, 'the lunge started').toBe(true);
  // 0.55s of special plus the hit-stop the landed blow buys.
  await game.step(800);
  const after = await game.state();
  expect(after.enemies[index].hp, 'one blow, however long the body stayed on the line').toBe(hp - damage);
  const carried = Math.hypot(after.player.x - stance.x, after.player.z - stance.z);
  expect(carried, 'the lunge carried the knight').toBeGreaterThan(2.4);
  const cooling = specialOf(after)!;
  expect(cooling.ready).toBe(false);
  // Contact came 0.12s in and the whole special is 0.55s; the clock started at contact, not on the press.
  expect(cooling.cooldown).toBeGreaterThan(4 - 0.82);
  expect(cooling.cooldown).toBeLessThan(4 - 0.6);
  // The HUD sweep and the snapshot read the same clock.
  expect(await sweep(page)).toBeCloseTo(1 - cooling.cooldown / 4, 1);

  await press(page, 'special');
  await game.step(16);
  expect(specialOf(await game.state())!.live, 'the cooldown refuses a second lunge').toBe(false);
  expect((await game.state()).enemies[index].hp).toBe(hp - damage);

  await game.step(Math.ceil(cooling.cooldown * 1000) + 50);
  expect(specialOf(await game.state())!.ready).toBe(true);
  expect(await sweep(page)).toBe(1);
});

const CURSOR: Record<ScreenDirection, { x: number; y: number }> = { right: { x: 0.85, y: 0.5 }, left: { x: 0.15, y: 0.5 }, down: { x: 0.5, y: 0.85 }, up: { x: 0.5, y: 0.15 } };

test('the right mouse button lunges at the cursor', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const { index, hp, stance } = await stage(game, page, 'warden');
  // The body sits on the stance's own screen direction; the cursor goes out that way from the knight.
  const box = (await page.locator('canvas').boundingBox())!;
  const at = CURSOR[stance.direction];
  await page.mouse.move(box.x + box.width * at.x, box.y + box.height * at.y);
  await game.step(32);
  await page.mouse.down({ button: 'right' });
  await game.step(16);
  await page.mouse.up({ button: 'right' });
  await game.step(600);
  const after = await game.state();
  expect(after.enemies[index].hp).toBeLessThan(hp);
  expect(specialOf(after)!.ready).toBe(false);
  expect(after.aim.device).toBe('pointer');
  const toward = SCREEN_DIRECTIONS[stance.direction];
  expect((after.player.x - stance.x) * toward.x + (after.player.z - stance.z) * toward.z, 'down the cursor’s line').toBeGreaterThan(2.4);
});

test('a dodge drops the lunge in its wind-up for free, and waits out its contact', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await stage(game, page, 'warden', { distance: 2.6 });
  // Pressed together: the lunge is still winding when the dodge lands, so nothing is spent.
  await press(page, 'special');
  await game.step(40);
  expect(specialOf(await game.state())!.live).toBe(true);
  await press(page, 'dash');
  await game.step(16);
  const dodged = await game.state();
  expect(dodged.player.dashTime).toBeGreaterThan(0);
  expect(specialOf(dodged)).toMatchObject({ live: false, ready: true, cooldown: 0 });
  await game.step(1600);

  // Into contact, and the dodge waits for it to end rather than cutting the blow short.
  await press(page, 'special');
  await game.step(180);
  const live = await game.state();
  expect(specialOf(live)!.live).toBe(true);
  await press(page, 'dash');
  await game.step(16);
  const waiting = await game.state();
  expect(waiting.player.dashTime, 'not during contact').toBe(0);
  expect(waiting.player.dashBuffer).toBeGreaterThan(0);
  expect(specialOf(waiting)!.ready, 'the lunge went live, so it is spent').toBe(false);
  await game.step(160);
  expect((await game.state()).player.dashTime, 'and the dodge goes once contact ends').toBeGreaterThan(0);
  await game.step(4500);
});

test('the Harpoon flies the aim, drags the first guard in, comes home, and the knight is bare-handed meanwhile', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('spear');
  const { index, hp, spot, stance } = await stage(game, page, 'guard', { distance: 5 });
  const damage = weaponSpecial(await game.state())!.swing.damage!;
  const from = await game.state();
  const gap = () => Math.hypot(from.player.x - spot.x, from.player.z - spot.z);
  expect(gap()).toBeGreaterThan(4.5);
  await press(page, 'special');
  await game.step(150);
  const out = await game.state();
  expect(specialOf(out)!.harpoon?.phase, 'the spear is on its way').toBe('out');
  expect(specialOf(out)!.bare).toBe(true);
  expect(out.weapon.inFlight).toBe(1);
  let hit = out;
  for (let i = 0; i < 20 && hit.enemies[index].hp === hp; i++) { await game.step(16); hit = await game.state(); }
  expect(hit.enemies[index].hp, 'twice the spear, once').toBe(hp - damage);
  const pulled = Math.hypot(hit.enemies[index].x - stance.x, hit.enemies[index].z - stance.z);
  expect(pulled, 'hauled in well past what it could have walked').toBeLessThan(gap() - 1.8);
  // While it is out the strike is bare-handed: half the spear.
  expect(specialOf(hit)!.bare).toBe(true);
  for (let i = 0; i < 60 && specialOf(await game.state())!.harpoon; i++) await game.step(16);
  const home = await game.state();
  expect(specialOf(home)!.harpoon, 'it came home').toBeNull();
  expect(specialOf(home)!.bare).toBe(false);
  expect(home.weapon.inFlight).toBe(0);
  expect(home.enemies[index].hp, 'the way back hits nothing').toBe(hp - damage);

  // And left in the air at the end of the scenario, it is `dungeonTest.reset` that has to put it away:
  // the pooled page is held against a fresh boot when this test ends.
  await game.step(5200);
  await press(page, 'special');
  await game.step(200);
  expect(specialOf(await game.state())!.harpoon).not.toBeNull();
});

test('swapping arms with the spear in flight lays the spear on the rack and leaves nothing flying', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const opening = await game.state();
  expect(opening.drop, 'this floor has a rack').not.toBeNull();
  const rack = opening.drop!;
  await game.equip('spear');
  await game.teleport(rack.x, rack.z);
  await game.step(32);
  expect((await game.state()).drop!.over).toBe(true);
  await press(page, 'special');
  await game.step(160);
  expect(specialOf(await game.state())!.harpoon).not.toBeNull();
  await press(page, 'swap');
  await game.step(16);
  const swapped = await game.state();
  expect(swapped.weapon.id).toBe(rack.kind);
  expect(swapped.drop!.kind, 'the spear is on the rack, not lost').toBe('spear');
  expect(swapped.weapon.inFlight, 'and not in the air').toBe(0);
  const special = specialOf(swapped);
  if (special) expect(special).toMatchObject({ ready: true, cooldown: 0, harpoon: null, bare: false });
  await game.step(1000);
  expect((await game.state()).weapon.inFlight).toBe(0);
  // Taking it back hands over a ready spear: a swap is neither a way round the cooldown nor a punishment.
  await press(page, 'swap');
  await game.step(16);
  expect(specialOf(await game.state())).toMatchObject({ id: 'harpoon', ready: true, cooldown: 0 });
  await game.equip('tideblade');
});

test('the Tolling Slam on pad X: held to charge, released to ring every body once; let go early it costs nothing', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('maul');
  const { index, hp } = await stage(game, page, 'warden', { distance: 1.6 });
  const pad = await fakePad(page);
  try {
    // Early: 0.3s held is short of the half-second minimum, so it cancels and spends nothing.
    await pad.set(2, true);
    await game.step(300);
    const early = specialOf(await game.state())!;
    expect(early.charging).toBe(true);
    expect(early.charge).toBe(0);
    await pad.set(2, false);
    await game.step(32);
    const cancelled = await game.state();
    expect(specialOf(cancelled)).toMatchObject({ charging: false, live: false, ready: true, cooldown: 0 });
    expect(cancelled.player.attackTime).toBe(0);
    expect(cancelled.enemies[index].hp).toBe(hp);

    // Just past the minimum: the smallest ring, one blow of about one and a half maul-blows.
    await pad.set(2, true);
    await game.step(560);
    expect(specialOf(await game.state())!.charge).toBeGreaterThan(0);
    await pad.set(2, false);
    await game.step(300);
    const slammed = await game.state();
    const dealt = hp - slammed.enemies[index].hp;
    expect(dealt, 'one ring, one blow').toBeGreaterThanOrEqual(Math.round(9 * 1.5));
    expect(dealt).toBeLessThanOrEqual(Math.round(9 * 1.7));
    expect(specialOf(slammed)!.ready).toBe(false);
    expect(specialOf(slammed)!.cooldown).toBeGreaterThan(5.5);
    await game.step(600);
    expect((await game.state()).enemies[index].hp, 'and only one').toBe(slammed.enemies[index].hp);

    // Held to full, the charge climbs to 1 and stays there, and the knight all but roots.
    await game.step(5500);
    await pad.set(2, true);
    await game.step(1300);
    const full = await game.state();
    expect(specialOf(full)!.charge).toBe(1);
    expect(Math.hypot(full.player.velocity.x, full.player.velocity.z)).toBeLessThan(1);
    await pad.set(2, false);
    await game.step(300);
    expect(specialOf(await game.state())!.ready).toBe(false);
  } finally {
    await pad.remove();
    await game.step(16);
    await game.equip('tideblade');
  }
});

// Let go of a charge held `ms` on K and step to the slam's first live frame; returns the charge it reached.
const slamOnK = async (game: Game, page: Page, ms = 560) => {
  await hold(page, 'special');
  await game.step(ms);
  const charge = specialOf(await game.state())!.charge;
  await release(page, 'special');
  for (let i = 0; i < 30; i++) {
    await game.step(16);
    if ((await game.state()).effects.shock.active) break;
  }
  return charge;
};

test('the Tolling Slam lands with a shockwave out to its own radius, and it is gone after its life, a pause and a reset', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('maul');
  const { index, spot } = await stage(game, page, 'warden', { distance: 1.6 });
  // Put back whole and held off before every slam: four slams on a six-second cooldown is longer than a
  // warden waits, and one minimum slam leaves a whole warden standing.
  const park = () => game.configureCombat({ enemies: [{ index, x: spot.x, z: spot.z, cooldown: 60, windup: 0, hp: 16 }] });
  await park();
  expect((await game.state()).effects.shock).toEqual({ active: false, radius: 0, edge: 0 });
  // Winding the maul is the charge ring's job; the shockwave is the slam's alone.
  await hold(page, 'special');
  await game.step(300);
  expect((await game.state()).effects.shock.active, 'no shockwave while charging').toBe(false);
  await release(page, 'special');
  await game.step(32);

  const charge = await slamOnK(game, page);
  const state = await game.state(), special = weaponSpecial(state) as unknown as { radius: [number, number] };
  const reach = special.radius[0] + (special.radius[1] - special.radius[0]) * charge + (state.boons as { reach: number }).reach;
  const landed = state.effects.shock;
  expect(landed.active, 'the slam threw a shockwave on contact').toBe(true);
  expect(landed.radius, 'out to the reach the blow was tested at').toBeCloseTo(reach, 5);
  expect(landed.edge, 'it starts at the knight, not at the rim').toBeLessThan(reach * 0.9);
  // It travels outward and stops at the radius, inside about a third of a second.
  let edge = landed.edge;
  for (let i = 0; i < 4; i++) {
    await game.step(32);
    const now = (await game.state()).effects.shock;
    expect(now.edge, 'the band travels outward').toBeGreaterThan(edge);
    expect(now.edge).toBeLessThanOrEqual(reach + 1e-6);
    edge = now.edge;
  }
  await game.step(250);
  expect((await game.state()).effects.shock, 'gone after its life').toEqual({ active: false, radius: 0, edge: 0 });

  // Reduced motion: the band appears at the radius and fades where it is.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await expect.poll(async () => ((await game.state()) as unknown as { settings: { reduceMotion: boolean } }).settings.reduceMotion).toBe(true);
    await game.step(6200);
    await park();
    await slamOnK(game, page);
    const still = (await game.state()).effects.shock;
    expect(still.active).toBe(true);
    expect(still.edge, 'reduced motion: already at the radius').toBeCloseTo(still.radius, 5);
    await game.step(64);
    expect((await game.state()).effects.shock.edge, 'and it does not move').toBeCloseTo(still.radius, 5);
    await game.step(300);
    expect((await game.state()).effects.shock.active).toBe(false);
  } finally {
    await page.emulateMedia({ reducedMotion: null });
  }
  await expect.poll(async () => ((await game.state()) as unknown as { settings: { reduceMotion: boolean } }).settings.reduceMotion).toBe(false);

  // A pause takes it away rather than freezing it on screen.
  await game.step(6200);
  await park();
  await slamOnK(game, page);
  expect((await game.state()).effects.shock.active).toBe(true);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).effects.shock, 'cleared by the pause').toEqual({ active: false, radius: 0, edge: 0 });
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).effects.shock.active, 'and not back on resume').toBe(false);

  // And a reset, mid-shockwave, puts it back to the booted state.
  await game.step(6200);
  await park();
  await slamOnK(game, page);
  expect((await game.state()).effects.shock.active).toBe(true);
  await game.reset(game.seeds);
  expect((await game.state()).effects.shock, 'cleared by the reset').toEqual({ active: false, radius: 0, edge: 0 });
});

test('a charge the pause or a boon draft interrupts is let go at no cost, never stuck', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('maul');
  await page.keyboard.down('KeyK');
  await game.step(700);
  expect(specialOf(await game.state())!.charging).toBe(true);
  await page.keyboard.press('Escape');
  await game.step(16);
  await page.keyboard.up('KeyK');
  await page.keyboard.press('Escape');
  await game.step(200);
  const resumed = await game.state();
  expect(resumed.mode).toBe('playing');
  expect(specialOf(resumed)).toMatchObject({ charging: false, live: false, ready: true, cooldown: 0 });
  expect(resumed.player.attackTime).toBe(0);

  await page.keyboard.down('KeyK');
  await game.step(700);
  expect(specialOf(await game.state())!.charging).toBe(true);
  await game.grantXp(300);
  await game.step(16);
  await page.keyboard.up('KeyK');
  await game.takeBoon();
  await game.step(200);
  const drafted = await game.state();
  expect(drafted.boonOffer).toBe(false);
  expect(specialOf(drafted)).toMatchObject({ charging: false, live: false, ready: true });
  // And the verb still works afterwards.
  await press(page, 'attack');
  await game.step(16);
  expect((await game.state()).player.attackTime).toBeGreaterThan(0);
  await game.step(600);
  await game.equip('tideblade');
});

const standAt = (floor: Floor, around: Point, radius: number, count: number) => {
  const spots: Point[] = [];
  for (let i = 0; i < 24 && spots.length < count; i++) {
    const angle = (i / 24) * Math.PI * 2, spot = { x: around.x + Math.cos(angle) * radius, z: around.z + Math.sin(angle) * radius };
    if (canStand(floor.cells, spot.x, spot.z) && hasClearPath(floor.cells, around, spot) && spots.every((s) => Math.hypot(s.x - spot.x, s.z - spot.z) > 1)) spots.push(spot);
  }
  return spots;
};

test('a slam that fells the last warden opens its boon, then the stair, then the results', async ({ game, page }) => {
  test.slow();
  await game.enter();
  await game.equip('maul');
  const opening = await game.state();
  const goal = opening.floor.rooms[opening.floor.goal];
  const centre = { x: goal.x * TILE, z: goal.z * TILE };
  await game.teleport(centre.x, centre.z);
  await game.step(60);
  const floor = await game.floor(), primed = await game.state();
  const wardens = primed.enemies.map((enemy, index) => ({ enemy, index })).filter(({ enemy }) => enemy.room === primed.floor.goal);
  expect(wardens.length).toBeGreaterThan(0);
  const ring = standAt(floor, centre, 1.4, wardens.length);
  expect(ring.length).toBe(wardens.length);
  await game.configureCombat({ enemies: wardens.map(({ index }, i) => ({ index, x: ring[i].x, z: ring[i].z, hp: 1, cooldown: 10, windup: 0 })) });
  // The kill that empties the stair room is the one that tips the rank.
  const gap = primed.experience.rankCost - primed.experience.intoRank;
  await game.grantXp(gap - wardens.length * 25);
  expect((await game.state()).boonOffer).toBe(false);

  await page.keyboard.down('KeyK');
  await game.step(600);
  await page.keyboard.up('KeyK');
  await game.step(120);
  const killed = await game.state();
  expect(killed.enemies.filter((enemy) => enemy.room === killed.floor.goal)).toHaveLength(0);
  expect(killed.boonOffer, 'the draft opens first').toBe(true);
  expect(killed.mode).toBe('playing');
  await expect(page.locator('.success-screen')).toBeHidden();
  await game.takeBoon();
  await game.step(800);
  const opened = await game.state();
  expect(opened.objective.stairOpen).toBe(true);
  expect(specialOf(opened)!.live, 'the slam finished under the draft rather than hanging').toBe(false);
  // The stair waits on the swap binding (PR #63), and on the pad that is Y now that X is the special: the
  // pad's own swap button takes it down, and X, pressed first on the stair, does not.
  await game.teleport(opened.stair.x, opened.stair.z);
  await game.step(200);
  expect((await game.state()).objective.onStair).toBe(true);
  const pad = await fakePad(page);
  await pad.set(2, true); await game.step(32); await pad.set(2, false); await game.step(32);
  expect((await game.state()).mode, 'X is the special, not the stair').toBe('playing');
  await pad.set(3, true); await game.step(32); await pad.set(3, false); await game.step(32);
  await pad.remove(); await game.step(16);
  expect((await game.state()).mode, 'Y took the stair').toBe('complete');
  await expect(page.locator('.success-screen')).toBeVisible();
  await page.locator('.success-screen button').click();
  await game.built();
  await game.step(16);
  const descended = await game.state();
  expect(descended.mode).toBe('playing');
  expect(descended.floor.level).toBe(2);
  expect(specialOf(descended)).toMatchObject({ charging: false, live: false });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the touch SPECIAL button holds a charge, taps a Whirl, and is live for every arm', async ({ game, page }) => {
    await game.enter();
    await game.step(120);
    const button = page.locator('.touch-actions .special');
    // Stage C: no arm is left without one, so the dimmed state is never reached in play.
    for (const arm of ['tideblade', 'fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask']) {
      await game.equip(arm);
      await expect(button, arm).toBeEnabled();
    }
    await game.equip('cleaver');
    const tap = await game.centreOf('.touch-actions .special');
    await game.touch('touchStart', [{ ...tap, id: 6 }]);
    await game.step(16);
    await game.touch('touchEnd', []);
    await game.step(300);
    expect(specialOf(await game.state())!, 'a tap is a Whirl').toMatchObject({ id: 'whirl', ready: false });
    await game.step(900);
    await game.equip('maul');
    await expect(button).toBeEnabled();
    const at = await game.centreOf('.touch-actions .special');
    await game.touch('touchStart', [{ ...at, id: 7 }]);
    await game.step(700);
    expect(specialOf(await game.state())!.charging).toBe(true);
    await game.touch('touchEnd', []);
    await game.step(300);
    const slammed = specialOf(await game.state())!;
    expect(slammed.charging).toBe(false);
    expect(slammed.ready, 'past the minimum, the lift slammed').toBe(false);
    await game.equip('tideblade');
  });
});

// --- Stage C: the other four arms -------------------------------------------------------------------------

/** `by` units past `to`, on the line from `from` through it. */
const beyond = (from: Point, to: Point, by: number) => {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  return { x: to.x + (to.x - from.x) / d * by, z: to.z + (to.z - from.z) / d * by };
};
/** A second awake body of `kind` that is not the one already staged. */
const another = (state: Snapshot, not: number, kind = 'guard') => {
  const index = state.enemies.findIndex((enemy, i) => i !== not && enemy.awake && enemy.kind === kind);
  expect(index, 'no second body on this floor').toBeGreaterThanOrEqual(0);
  return index;
};
/** Throw a flask at whatever the knight faces and wait for it to break into fire. */
const poolsOf = (state: Snapshot) => (state.weapon as Snapshot['weapon'] & { pools: Point[] }).pools;
const OPPOSITE: Record<ScreenDirection, ScreenDirection> = { left: 'right', right: 'left', up: 'down', down: 'up' };
const face = async (game: Game, page: Page, name: ScreenDirection) => { await page.keyboard.down(ARROW_KEYS[name]); await game.step(1); await page.keyboard.up(ARROW_KEYS[name]); };
const throwFire = async (game: Game, page: Page) => {
  const before = (await game.state()).weapon.fires;
  await press(page, 'attack');
  for (let i = 0; i < 80 && (await game.state()).weapon.fires <= before; i++) await game.step(16);
  expect((await game.state()).weapon.fires, 'the flask broke into fire').toBeGreaterThan(before);
};

test('the Vault on K goes over a guard, stabs it in the back once, lands on the floor past it, and cools 3s', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('fangs');
  const { index, hp, spot, stance, floor } = await stage(game, page, 'guard', { distance: 2 });
  const before = await game.state();
  expect(specialOf(before)).toMatchObject({ id: 'vault', ready: true, cooldown: 0, vault: null });
  const damage = weaponSpecial(before)!.swing.damage!;
  expect(damage, 'twice the knives').toBe(6);

  await press(page, 'special');
  await game.step(160);
  const air = await game.state();
  expect(specialOf(air)!.vault, 'over the body it was aimed at').toMatchObject({ target: index, landed: false });
  expect(air.player.locomotion.height, 'in the air').toBeGreaterThan(0.4);
  expect(air.enemies[index].hp, 'nothing is cut in the air').toBe(hp);
  let landing = air;
  for (let i = 0; i < 20 && !specialOf(landing)!.vault?.landed; i++) { await game.step(16); landing = await game.state(); }
  expect(landing.effects.shock, 'the landing marks the backstab reach').toMatchObject({ active: true });
  expect(landing.effects.shock.radius).toBeCloseTo(1.4, 5);
  await game.step(400);
  const down = await game.state();
  expect(down.enemies[index].hp, 'one backstab').toBe(hp - damage);
  expect(specialOf(down)!.vault?.landed).toBe(true);
  const line = { x: spot.x - stance.x, z: spot.z - stance.z }, length = Math.hypot(line.x, line.z);
  expect(((down.player.x - spot.x) * line.x + (down.player.z - spot.z) * line.z) / length, 'landed behind it').toBeGreaterThan(0.5);
  expect(canStand(floor.cells, down.player.x, down.player.z), 'and on the floor').toBe(true);
  expect(down.player.locomotion.height).toBeLessThan(0.2);
  const cooling = specialOf(down)!;
  expect(cooling.ready).toBe(false);
  // Takeoff is 0.08s in and the whole special 0.5s, plus the stab's hit-stop.
  expect(cooling.cooldown).toBeGreaterThan(3 - 0.65);
  expect(cooling.cooldown).toBeLessThan(3 - 0.4);
  expect(await sweep(page)).toBeCloseTo(1 - cooling.cooldown / 3, 1);

  await press(page, 'special');
  await game.step(300);
  const refused = await game.state();
  expect(specialOf(refused)!.live, 'the cooldown refuses a second vault').toBe(false);
  expect(refused.enemies[index].hp).toBe(hp - damage);
  await game.step(Math.ceil(cooling.cooldown * 1000));
  expect(specialOf(await game.state())!.ready).toBe(true);
  await game.equip('tideblade');
});

test('a Vault with no body is a hop along the aim, and at a wall it stops on the floor, never in the stone', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('fangs');
  const floor = await game.floor(), spot = { x: 0, z: 0 };
  // How far the floor runs from the start chamber's heart in each screen direction.
  const runs = (Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]).map((name) => {
    const dir = SCREEN_DIRECTIONS[name];
    let reach = 0;
    while (reach < 14 && canStand(floor.cells, spot.x + dir.x * (reach + 0.1), spot.z + dir.z * (reach + 0.1))) reach += 0.1;
    return { name, dir, reach };
  });
  const hopFrom = async (from: Point, name: ScreenDirection) => {
    await game.teleport(from.x, from.z);
    await page.keyboard.down(ARROW_KEYS[name]); await game.step(1); await page.keyboard.up(ARROW_KEYS[name]);
    await game.teleport(from.x, from.z);
    await press(page, 'special');
    await game.step(620);
    return game.state();
  };
  const open = runs.find((run) => run.reach > 4);
  expect(open, `no open direction: ${JSON.stringify(runs)}`).toBeDefined();
  const bare = await hopFrom(spot, open!.name);
  expect(specialOf(bare)!.vault?.target, 'nothing to go over').toBeNull();
  const hopped = (bare.player.x - spot.x) * open!.dir.x + (bare.player.z - spot.z) * open!.dir.z;
  expect(hopped, 'a short hop down the aim').toBeGreaterThan(2.1);
  expect(hopped).toBeLessThan(2.7);
  await game.step(3100);

  const wall = runs.find((run) => run.reach > 1.2 && run.reach < 14);
  expect(wall, `no wall in reach: ${JSON.stringify(runs)}`).toBeDefined();
  const from = { x: spot.x + wall!.dir.x * (wall!.reach - 0.8), z: spot.z + wall!.dir.z * (wall!.reach - 0.8) };
  const stopped = await hopFrom(from, wall!.name);
  expect(canStand(floor.cells, stopped.player.x, stopped.player.z), 'on the floor').toBe(true);
  const travelled = (stopped.player.x - from.x) * wall!.dir.x + (stopped.player.z - from.z) * wall!.dir.z;
  expect(travelled, 'up to the stone and no further').toBeLessThan(0.85);
  expect(specialOf(stopped)!.vault!.distance).toBeLessThan(0.85);
  await game.equip('tideblade');
});

test('the Whirl on the right button takes a body in front and one behind, once each, rings its reach, and cools 5s', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('cleaver');
  const { index, hp, spot, stance, floor } = await stage(game, page, 'guard', { distance: 1.6 });
  const behind = beyond(spot, stance, 1.5);
  expect(canStand(floor.cells, behind.x, behind.z) && hasClearPath(floor.cells, stance, behind), 'room behind the knight').toBe(true);
  const other = another(await game.state(), index);
  await game.configureCombat({ enemies: [{ index, x: spot.x, z: spot.z, cooldown: 10, windup: 0 }, { index: other, x: behind.x, z: behind.z, cooldown: 10, windup: 0, hp }] });
  const before = await game.state();
  expect(specialOf(before)).toMatchObject({ id: 'whirl', ready: true });
  const damage = weaponSpecial(before)!.swing.damage!;
  const gap = (state: Snapshot, i: number) => Math.hypot(state.enemies[i].x - state.player.x, state.enemies[i].z - state.player.z);

  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await game.step(32);
  await page.mouse.down({ button: 'right' });
  await game.step(16);
  await page.mouse.up({ button: 'right' });
  let ring = await game.state();
  for (let i = 0; i < 30 && !ring.effects.shock.active; i++) { await game.step(16); ring = await game.state(); }
  expect(ring.effects.shock.active, 'the ring lands with the blade').toBe(true);
  expect(ring.effects.shock.radius).toBeCloseTo(2.2, 5);
  expect(ring.effects.shock.edge, 'already at the reach, not leaving the knight').toBeGreaterThan(2.1);
  // Measured on the contact frame: the bodies are free to walk back in afterwards, and do.
  expect(gap(ring, index), 'shoved off').toBeGreaterThan(gap(before, index) + 0.5);
  expect(gap(ring, other), 'shoved off').toBeGreaterThan(gap(before, other) + 0.5);
  await game.step(1100);
  const after = await game.state();
  expect(after.enemies[index].hp, 'the one in front, once').toBe(hp - damage);
  expect(after.enemies[other].hp, 'the one behind, once').toBe(hp - damage);
  expect(after.effects.shock.active, 'and the ring is gone').toBe(false);
  const cooling = specialOf(after)!;
  expect(cooling.ready).toBe(false);
  expect(cooling.cooldown).toBeGreaterThan(5 - 1.3);
  expect(cooling.cooldown).toBeLessThan(5 - 0.9);

  await page.mouse.down({ button: 'right' });
  await game.step(16);
  await page.mouse.up({ button: 'right' });
  await game.step(400);
  const refused = await game.state();
  expect(specialOf(refused)!.live, 'the cooldown refuses a second whirl').toBe(false);
  expect(refused.enemies[index].hp).toBe(hp - damage);
  await game.equip('tideblade');
});

test('the Heavy Bolt on pad X: let go early it costs nothing; drawn, it spends the whole quiver as one bolt that goes through three bodies once each; dry, it cannot draw', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('crossbow');
  const { index, hp, spot, stance, floor } = await stage(game, page, 'warden', { distance: 2.5 });
  // A warden, a guard and a warden on one line. A plain bolt pierces one body and stops on the second, so only
  // a bolt that passes through everything reaches the far warden.
  const middle = beyond(stance, spot, 1.5), far = beyond(stance, spot, 3);
  for (const at of [middle, far]) expect(canStand(floor.cells, at.x, at.z) && hasClearPath(floor.cells, stance, at), `room on the line at ${JSON.stringify(at)}`).toBe(true);
  const opening = await game.state();
  const guard = another(opening, index, 'guard'), other = another(opening, index, 'warden');
  const line = () => game.configureCombat({ enemies: [{ index, x: spot.x, z: spot.z, cooldown: 60, windup: 0 }, { index: guard, x: middle.x, z: middle.z, cooldown: 60, windup: 0 }, { index: other, x: far.x, z: far.z, cooldown: 60, windup: 0, hp }] });
  await line();
  const before = await game.state();
  expect(specialOf(before)).toMatchObject({ id: 'heavybolt', ready: true, cooldown: 0 });
  expect(before.weapon.quiver).toBe(4);
  const perBolt = weaponSpecial(before)!.swing.damage!;
  const pad = await fakePad(page);
  try {
    // Early: drawing shows its line; let go before it is drawn and nothing is spent.
    await pad.set(2, true);
    await game.step(300);
    const drawing = await game.state();
    expect(specialOf(drawing)).toMatchObject({ charging: true, charge: 0 });
    expect(effectsOf(drawing).lane, 'the line it would take').not.toBeNull();
    await pad.set(2, false);
    await game.step(32);
    const cancelled = await game.state();
    expect(specialOf(cancelled)).toMatchObject({ charging: false, live: false, ready: true });
    expect(cancelled.weapon.quiver, 'not a bolt spent').toBe(4);
    expect(cancelled.weapon.inFlight).toBe(0);
    expect(effectsOf(cancelled).lane).toBeNull();

    // Drawn, away from the line: all four bolts leave as one.
    await face(game, page, OPPOSITE[stance.direction]);
    await pad.set(2, true);
    await game.step(800);
    expect(specialOf(await game.state())!.charge, 'drawn').toBe(1);
    await pad.set(2, false);
    await game.step(48);
    const loosed = await game.state();
    expect(loosed.weapon.quiver, 'the whole quiver').toBe(0);
    expect(loosed.weapon.inFlight, 'in one bolt').toBe(1);
    expect(effectsOf(loosed).lane!.opacity, 'the line it went down, bright').toBeGreaterThan(0.4);
    // The bright line fades on its own 0.28s clock, whether the bolt is still flying or stone stopped it.
    await game.step(320);
    for (let i = 0; i < 60 && (await game.state()).weapon.inFlight > 0; i++) await game.step(16);
    const gone = await game.state();
    expect(effectsOf(gone).lane).toBeNull();
    expect(specialOf(gone)).toMatchObject({ ready: false, cooldown: 0 });

    // Dry: it will not draw.
    await pad.set(2, true);
    await game.step(300);
    expect(specialOf(await game.state())!.charging, 'a dry crossbow cannot draw').toBe(false);
    await pad.set(2, false);
    // The first bolt back makes it ready again, and the next is 1.8s off, well past a 0.7s draw.
    for (let i = 0; i < 150 && ((await game.state()).weapon.quiver ?? 0) < 1; i++) await game.step(16);
    const back = await game.state();
    expect(back.weapon.quiver).toBe(1);
    expect(specialOf(back)!.ready).toBe(true);
    expect(await sweep(page)).toBe(1);

    // Through the line. A warden walks while it is drawn, so the three are put back the moment before it goes.
    await face(game, page, stance.direction);
    await game.teleport(stance.x, stance.z);
    await pad.set(2, true);
    await game.step(800);
    await line();
    const aimed = await game.state();
    await pad.set(2, false);
    let hit = aimed;
    for (let i = 0; i < 40 && hit.remaining === aimed.remaining; i++) { await game.step(16); hit = await game.state(); }
    await game.step(600);
    const after = await game.state();
    // The guard dies to one bolt's worth, and the snapshot lists the living, so the indices past it close up.
    expect(after.remaining, 'the guard in the middle fell').toBe(aimed.remaining - 1);
    const at = (i: number) => i > guard ? i - 1 : i;
    expect(after.enemies[at(index)].hp, 'the near warden: a bolt for the bolt it spent, once').toBe(hp - perBolt);
    expect(after.enemies[at(other)].kind).toBe('warden');
    expect(after.enemies[at(other)].hp, 'and on through the guard into the far warden, once').toBe(hp - perBolt);
    expect(after.weapon.inFlight).toBe(0);
  } finally {
    await pad.remove();
    await game.step(16);
    await game.equip('tideblade');
  }
});

test('the Flashpoint does nothing without fire; with it, a burning warden is caught once, the pools end, and it cools 4s', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  await game.equip('flask');
  const { index, hp, spot, stance, floor } = await stage(game, page, 'warden', { distance: 3 });
  // Nothing to detonate: no swing, no cooldown.
  await press(page, 'special');
  await game.step(200);
  const idle = await game.state();
  expect(specialOf(idle)).toMatchObject({ id: 'flashpoint', live: false, ready: true, cooldown: 0 });
  expect(idle.player.attackTime).toBe(0);

  // Fire laid away from the warden, then the warden stood in it between two bites: whatever it loses on
  // the detonation frame is the Flashpoint's alone.
  await face(game, page, OPPOSITE[stance.direction]);
  await throwFire(game, page);
  // A new pool bites on its first frame; let that bite land on empty ground.
  await game.step(32);
  const pool = poolsOf(await game.state())[0], knight = (await game.state()).player;
  // The pool may have broken against stone; stand the warden on the nearest floor inside it, towards the knight.
  const toward = { x: knight.x - pool.x, z: knight.z - pool.z }, span = Math.hypot(toward.x, toward.z);
  let inside = 0;
  while (inside < 1.6 && !canStand(floor.cells, pool.x + toward.x / span * inside, pool.z + toward.z / span * inside)) inside += 0.1;
  await game.configureCombat({ enemies: [{ index, x: pool.x + toward.x / span * inside, z: pool.z + toward.z / span * inside, cooldown: 10, windup: 0 }] });
  await press(page, 'special');
  let last = await game.state(), now = last;
  for (let i = 0; i < 40 && now.weapon.fires > 0; i++) { last = now; await game.step(16); now = await game.state(); }
  expect(now.weapon.fires, 'the pools are spent').toBe(0);
  expect(last.enemies[index].hp, 'no bite before it went up').toBe(hp);
  const damage = weaponSpecial(idle)!.swing.damage!;
  expect(hp - now.enemies[index].hp, 'one detonation, a bite and a half').toBe(damage);
  expect(effectsOf(now).flares, 'and they flare as they go').toBeGreaterThan(0);
  await game.step(400);
  const after = await game.state();
  expect(effectsOf(after).flares).toBe(0);
  expect(after.enemies[index].hp, 'no fire left to bite').toBe(hp - damage);
  const cooling = specialOf(after)!;
  expect(cooling.ready).toBe(false);
  expect(cooling.cooldown).toBeGreaterThan(4 - 0.8);
  expect(cooling.cooldown).toBeLessThan(4 - 0.3);
  expect(await sweep(page)).toBeCloseTo(1 - cooling.cooldown / 4, 1);

  // Fire again, inside the cooldown: the special is refused and the pool burns on.
  await game.configureCombat({ enemies: [{ index, x: spot.x, z: spot.z, cooldown: 10, windup: 0 }] });
  await throwFire(game, page);
  await press(page, 'special');
  await game.step(200);
  const refused = await game.state();
  expect(specialOf(refused)!.live).toBe(false);
  expect(refused.weapon.fires, 'the cooldown refuses a second flashpoint').toBeGreaterThan(0);
  await game.step(3000);
  await game.equip('tideblade');
});

test('a dodge in the wind-up drops each Stage C special at no cost', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const dodged = async (label: string) => {
    await press(page, 'dash');
    await game.step(16);
    const state = await game.state();
    expect(state.player.dashTime, `${label}: the dodge went`).toBeGreaterThan(0);
    return state;
  };

  await game.equip('fangs');
  const fangs = await stage(game, page, 'guard', { distance: 2 });
  await press(page, 'special');
  await game.step(32);
  const vaulted = await dodged('vault');
  expect(specialOf(vaulted)).toMatchObject({ live: false, ready: true, cooldown: 0, vault: null });
  await game.step(900);
  expect((await game.state()).enemies[fangs.index].hp, 'the vault never went').toBe(fangs.hp);

  await game.equip('cleaver');
  await press(page, 'special');
  await game.step(80);
  const whirled = await dodged('whirl');
  expect(specialOf(whirled)).toMatchObject({ live: false, ready: true, cooldown: 0 });
  expect(whirled.effects.shock.active).toBe(false);
  await game.step(900);

  await game.equip('crossbow');
  await hold(page, 'special');
  await game.step(300);
  expect(specialOf(await game.state())!.charging).toBe(true);
  const drew = await dodged('draw');
  await release(page, 'special');
  await game.step(32);
  const undrawn = await game.state();
  expect(specialOf(undrawn)).toMatchObject({ charging: false, live: false, ready: true });
  expect(undrawn.weapon.quiver, 'not a bolt spent').toBe(4);
  expect(drew.weapon.inFlight).toBe(0);
  await game.step(900);

  await game.equip('flask');
  await throwFire(game, page);
  await game.step(900);
  await press(page, 'special');
  await game.step(40);
  const detonated = await dodged('flashpoint');
  expect(specialOf(detonated)).toMatchObject({ live: false, ready: true, cooldown: 0 });
  expect(detonated.weapon.fires, 'the fire is still on the ground').toBeGreaterThan(0);
  await game.step(3000);
  await game.equip('tideblade');
});

test('the Whirl ring, the drawn line and the flares are put away by a pause, a swap and a reset', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  // A pause takes the Whirl's ring away rather than freezing it on screen.
  await game.equip('cleaver');
  await press(page, 'special');
  for (let i = 0; i < 30 && !(await game.state()).effects.shock.active; i++) await game.step(16);
  expect((await game.state()).effects.shock.active).toBe(true);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).effects.shock.active, 'the pause cleared the ring').toBe(false);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).effects.shock.active, 'and it is not back on resume').toBe(false);
  await game.step(900);

  // A pause lets go of a draw, and the line goes with it.
  await game.equip('crossbow');
  await hold(page, 'special');
  await game.step(800);
  expect(effectsOf(await game.state()).lane).not.toBeNull();
  await page.keyboard.press('Escape');
  await game.step(16);
  await release(page, 'special');
  const paused = await game.state();
  expect(effectsOf(paused).lane, 'the pause put the line away').toBeNull();
  await page.keyboard.press('Escape');
  await game.step(200);
  const resumed = await game.state();
  expect(specialOf(resumed)).toMatchObject({ charging: false, live: false, ready: true });
  expect(resumed.weapon.quiver).toBe(4);
  expect(effectsOf(resumed).lane).toBeNull();

  // A swap mid-draw leaves nothing drawn and no line behind.
  await hold(page, 'special');
  await game.step(400);
  await game.equip('cleaver');
  await release(page, 'special');
  await game.step(16);
  const swapped = await game.state();
  expect(specialOf(swapped)).toMatchObject({ id: 'whirl', charging: false, live: false, ready: true });
  expect(effectsOf(swapped).lane).toBeNull();

  // A swap mid-flare puts the flares away, and a pause does too.
  await game.equip('flask');
  await stage(game, page, 'guard', { distance: 4 });
  await throwFire(game, page);
  await press(page, 'special');
  for (let i = 0; i < 20 && !effectsOf(await game.state()).flares; i++) await game.step(16);
  expect(effectsOf(await game.state()).flares).toBeGreaterThan(0);
  await game.equip('tideblade');
  expect(effectsOf(await game.state()).flares, 'the swap put the flares away').toBe(0);
  await game.equip('flask');
  await throwFire(game, page);
  await press(page, 'special');
  for (let i = 0; i < 20 && !effectsOf(await game.state()).flares; i++) await game.step(16);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect(effectsOf(await game.state()).flares, 'the pause put the flares away').toBe(0);
  await page.keyboard.press('Escape');
  await game.step(16);

  // And a reset with a Heavy Bolt in the air and its line on the floor puts everything back.
  await game.equip('crossbow');
  await hold(page, 'special');
  await game.step(800);
  await release(page, 'special');
  await game.step(32);
  const flying = await game.state();
  expect(flying.weapon.inFlight + (effectsOf(flying).lane ? 1 : 0)).toBeGreaterThan(0);
  await game.reset(game.seeds);
  const reset = await game.state();
  expect(reset.weapon.inFlight).toBe(0);
  expect(effectsOf(reset).lane).toBeNull();
  expect(effectsOf(reset).flares).toBe(0);
});
