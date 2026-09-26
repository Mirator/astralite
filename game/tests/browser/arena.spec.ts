import { expect, test } from './helpers.ts';

// The development arena (app/dungeon-arena.ts). What it deals is held in node (tests/dungeon-arena.test.ts):
// the roster, where it stands, that nothing else on the floor changes. This is the wiring: the menu's arena
// page, driven by clicks, becomes a floor the running game charts as that arena, and the bodies on it fight.
test('the arena page puts a chosen roster, awake, in the gate of the chosen floor', async ({ game, page }) => {
  await page.getByRole('button', { name: /Arena · dev/ }).click();
  await expect(page.getByRole('heading', { name: 'Arena' })).toBeVisible();
  // Default pick is one guard; this asks for a warden and two archers on floor two instead.
  await page.getByRole('button', { name: 'One fewer guard' }).click();
  await page.getByRole('button', { name: 'One more warden' }).click();
  await page.getByRole('button', { name: 'One more archer' }).click();
  await page.getByRole('button', { name: 'One more archer' }).click();
  await page.locator('#arena-level').selectOption('2');
  const before = await game.state();
  expect(before.arena, 'the page was already an arena before FIGHT').toBeNull();
  await page.getByRole('button', { name: /^FIGHT · 3/ }).click();
  await game.built();
  await expect(page.locator('.intro-screen')).toBeHidden();

  const state = await game.state();
  expect(state.arena).toEqual({ roster: ['warden', 'archer', 'archer'], level: 2 });
  expect(state.mode).toBe('playing');
  expect(state.floor.level).toBe(2);
  expect(state.enemies.map((e) => e.kind).sort()).toEqual(['archer', 'archer', 'warden']);
  for (const enemy of state.enemies) {
    expect(enemy.room, `a ${enemy.kind} stands outside the gate`).toBe(state.floor.start);
    expect(enemy.awake, `a ${enemy.kind} was hidden`).toBe(true);
  }
  // Met, not merely placed: something winds up against the knight within a few seconds of arriving.
  let engaged = false;
  for (let t = 0; t < 4000 && !engaged; t += 100) {
    await game.step(100);
    engaged = (await game.state()).enemies.some((e) => e.windup > 0);
  }
  expect(engaged, 'nothing in the arena ever committed to an attack').toBe(true);
});
