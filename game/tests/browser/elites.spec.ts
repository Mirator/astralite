import { expect, press, strikeStance, test, type Game } from './helpers.ts';
import type { Page } from '@playwright/test';
import { ELITES, ELITE_MODIFIERS } from '../../app/dungeon-bestiary.ts';

// Plan 022 Stage C. The rules are held in node: the modifiers' numbers, who is dealt one, the pay and the fire in tests/dungeon-elites.test.ts, the look of one at rest and in a tell in
// dungeon-enemy-view.test.ts, the sim's elites in balance-sim.test.ts. These check the running game is wired to them: that an elite is built with its numbers and wears its colour in the scene, that a hasted body
// really tells sooner, that a real strike on a volatile one leaves fire that bites and pays double, and that `?elite=` reaches the game. Elites are staged through the arena (`dungeonTest.buildArena`, whose third
// argument is `?elite=`), so no scenario searches a floor for a volatile warden; the elites a floor deals are compared with the sim's in waves.spec.ts.

type Modifier = typeof ELITE_MODIFIERS[number];
type Hooks = { dungeonTest: { buildArena: (roster: string[], level: number, elite?: Modifier) => void } };
const arena = async (page: Page, roster: string[], level: number, elite?: Modifier) => {
  await page.evaluate(([kinds, depth, modifier]) => (window as unknown as Hooks).dungeonTest.buildArena(kinds as string[], depth as number, (modifier ?? undefined) as Modifier | undefined), [roster, level, elite ?? null] as const);
};
/** Every body held still, on guard, so what it wears is its idle look and nothing is mid-blow. */
const hold = async (game: Game, count: number) => {
  await game.configureCombat({ enemies: Array.from({ length: count }, (_, index) => ({ index, windup: 0, cooldown: 999 })) });
  await game.step(100);
};
const strike = async (page: Page, key: string) => { await page.keyboard.down(key); await press(page, 'attack'); await page.keyboard.up(key); };

test('an arena of elites is built with each modifier\'s numbers and wears its colour in the scene, in the glow, the eyes and the bar\'s pip', async ({ game, page }) => {
  const roster = ['guard', 'stalker', 'warden', 'archer', 'shieldbearer'];
  await arena(page, roster, 2);
  await game.enter();
  await hold(game, roster.length);
  const plain = await game.state();
  expect(plain.enemies.map((e) => e.kind), 'precondition: the arena stood the roster').toEqual(roster);
  expect(plain.enemies.every((e) => e.elite === null && e.wears.emissive === 0 && e.wears.frame === null && e.maxHp > 0), 'a plain body wears an elite\'s colour').toBe(true);
  expect(plain.arena?.elite, 'a plain arena names an elite').toBeUndefined();
  const eyes = new Set<number>([plain.enemies[0].wears.eye]);
  for (const modifier of ELITE_MODIFIERS) {
    await arena(page, roster, 2, modifier);
    await game.step(50);
    await hold(game, roster.length);
    const state = await game.state();
    expect(state.arena?.elite, 'the arena does not say what it was built with').toBe(modifier);
    expect(state.enemies.map((e) => e.kind), `precondition: the ${modifier} arena stood the roster`).toEqual(roster);
    state.enemies.forEach((e, i) => {
      const was = plain.enemies[i], name = `the ${modifier} ${e.kind}`;
      expect(e.elite, `${name} is not an elite`).toBe(modifier);
      expect(e.maxHp, `${name}: vitality`).toBe(modifier === 'armoured' ? was.maxHp * 2 : was.maxHp);
      expect(e.damage, `${name}: damage`).toBe(modifier === 'wrathful' ? Math.round(was.damage * 1.4) : was.damage);
      expect(e.tell, `${name}: tell`).toBeCloseTo(modifier === 'hasted' ? was.tell * 0.8 : was.tell, 9);
      expect(e.speed, `${name}: speed`).toBeCloseTo(modifier === 'hasted' ? was.speed * 1.35 : was.speed, 9);
      // What the scene wears: the idle glow, the eyes, and the bar's frame, read off the materials the body was drawn with.
      expect(e.wears.emissive, `${name} does not glow its colour at rest`).toBe(ELITES[modifier].glow);
      expect(e.wears.intensity, `${name}'s glow is out`).toBeGreaterThan(0);
      expect(e.wears.frame, `${name}'s bar has no pip in its colour`).toBe(ELITES[modifier].glow);
      expect(e.wears.eye, `${name}'s eyes are a plain ${e.kind}'s`).not.toBe(was.wears.eye);
    });
    eyes.add(state.enemies[0].wears.eye);
  }
  expect(eyes.size, 'two modifiers share an eye colour on the guard, or a modifier left it as it was').toBe(1 + ELITE_MODIFIERS.length);
});

test('a hasted guard begins its blow in 0.8 of a plain guard\'s tell, as the running game plays it', async ({ game, page }) => {
  await arena(page, ['guard'], 1);
  await game.enter();
  const firstTell = async (elite?: Modifier) => {
    await arena(page, ['guard'], 1, elite);
    await game.step(50);
    // Let it come: the first frame its tell is running is the one that says how long the tell is.
    let was = 0, state = await game.state();
    for (let t = 0; t < 8000; t += 16) {
      await game.step(16);
      state = await game.state();
      const guard = state.enemies[0];
      if (guard.windup > 0 && was === 0) return { windup: guard.windup, tell: guard.tell };
      was = guard.windup;
    }
    throw new Error(`the ${elite ?? 'plain'} guard never began a blow in eight seconds`);
  };
  const plain = await firstTell(), hasted = await firstTell('hasted');
  expect(plain.tell, 'precondition: the plain guard tells for half a second').toBeCloseTo(0.5, 9);
  expect(plain.windup, 'precondition: the plain tell was read on its first frame').toBeGreaterThan(plain.tell - 0.03);
  expect(hasted.windup, 'the hasted guard\'s first frame of tell is not 0.8 of the plain one\'s').toBeLessThanOrEqual(plain.tell * 0.8 + 1e-6);
  expect(hasted.windup).toBeGreaterThan(plain.tell * 0.8 - 0.03);
});

test('a volatile guard felled by a real strike leaves fire that bites, and an elite pays double experience', async ({ game, page }) => {
  await arena(page, ['guard'], 1);
  await game.enter();
  const kill = async (elite?: Modifier) => {
    await arena(page, ['guard'], 1, elite);
    // The swing that felled the one before is still on the clock when the arena is rebuilt: let it end, or the next press lands in it.
    await game.step(700);
    const floor = await game.floor(), opening = await game.state();
    expect(opening.enemies.map((e) => e.elite), 'precondition: the arena stood the one guard').toEqual([elite ?? null]);
    const stance = strikeStance(floor, { x: opening.enemies[0].x, z: opening.enemies[0].z });
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    // One blow from death, held on guard so it does not strike first.
    await game.configureCombat({ enemies: [{ index: 0, hp: 1, cooldown: 2 }] });
    const before = await game.state();
    await strike(page, stance.key);
    let state = await game.state();
    for (let t = 0; t < 600 && state.enemies.length; t += 16) { await game.step(16); state = await game.state(); }
    expect(state.enemies.map((e) => [e.kind, e.hp, e.elite, e.x, e.z, e.windup, e.cooldown]), `the ${elite ?? 'plain'} guard never fell (knight at ${state.player.x}, ${state.player.z}, stance ${stance.x}, ${stance.z})`).toEqual([]);
    return { before, after: state, anchor: { x: opening.enemies[0].x, z: opening.enemies[0].z } };
  };
  const plain = await kill();
  expect(plain.after.hostilePools, 'a plain guard left fire').toEqual([]);
  expect(plain.after.experience.total - plain.before.experience.total, 'a plain guard did not pay what a body pays').toBe(plain.before.experience.perEnemy);
  const volatile = await kill('volatile');
  expect(volatile.after.experience.total - volatile.before.experience.total, 'an elite did not pay double experience').toBe(2 * volatile.before.experience.perEnemy);
  const { after, before } = volatile;
  expect(after.hostilePools, 'the volatile guard fell and left no fire').toHaveLength(1);
  const fire = after.hostilePools[0];
  expect(fire.radius).toBe(ELITES.volatile.pool!.radius);
  expect(Math.hypot(after.player.x - fire.x, after.player.z - fire.z), 'precondition: the knight stands in the fire').toBeLessThan(fire.radius);
  let state = after;
  for (let t = 0; t < 1200 && state.health === before.health; t += 50) { await game.step(50); state = await game.state(); }
  expect(state.health, 'standing in the volatile guard\'s fire cost the knight nothing').toBe(before.health - Math.round(fire.damage * state.boons.guardAgainst));
});

