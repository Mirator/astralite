import type { Page } from '@playwright/test';
import { canStand, expect, type Game, hasClearPath, press, strikeStance, test, type Point, type Snapshot } from './helpers.ts';

// Plan 016 Stages B and C: a special for every arm. Real input only - K, the right button, pad X and the touch
// SPECIAL button; the hooks put an arm in hand and stage a body, and read the state back.

type Special = { id: string; ready: boolean; cooldown: number; charging: boolean; charge: number; held: number; live: boolean; buffered: number; harpoon: { phase: 'out' | 'back'; x: number; z: number } | null; bare: boolean; vault: { target: number | null; distance: number; landed: boolean } | null };
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

