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
  // Plan 019 (D14): the arena keeps its own rack, laid on the spot the generator reserves on this floor (the campaign
  // lays none there), so an arm can still be tried against a roster.
  const reserved = (await game.floor()).weaponDrop;
  expect(state.racks.map((rack) => [rack.kind, rack.x, rack.z]), 'the arena lost its rack').toEqual([[reserved.kind, expect.closeTo(reserved.x, 3), expect.closeTo(reserved.z, 3)]]);
  expect(state.racks[0].inScene, 'the arena\'s rack is not attached to the floor').toBe(true);
  // Met, not merely placed: something winds up against the knight within a few seconds of arriving.
  let engaged = false;
  for (let t = 0; t < 4000 && !engaged; t += 100) {
    await game.step(100);
    engaged = (await game.state()).enemies.some((e) => e.windup > 0);
  }
  expect(engaged, 'nothing in the arena ever committed to an attack').toBe(true);
});

// The published game takes `?arena=` too, so an arena run must not pass for a descent: a floor-three arena
// would otherwise read as the deepest run ever made, and its seed would become LAST KEEP.
test('an arena names itself on the menu, and dying in one records nothing', async ({ game, page }) => {
  const stored = () => page.evaluate(() => ({ best: localStorage.getItem('drowned-keep:1:best'), runs: localStorage.getItem('drowned-keep:1:runs'), seed: localStorage.getItem('drowned-keep:1:seed') }));
  const before = await stored();
  await page.evaluate(() => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(['guard', 'guard'], 1));
  await expect(page.locator('.intro-card .end-kicker')).toHaveText('ARENA · 2 FOES · FLOOR 1');
  await game.enter();
  await game.configureCombat({ health: 1 });
  let state = await game.state();
  for (let t = 0; t < 6000 && state.mode !== 'lost'; t += 100) { await game.step(100); state = await game.state(); }
  expect(state.mode, 'the knight never fell, so nothing was there to record').toBe('lost');
  expect(state.arena).toEqual({ roster: ['guard', 'guard'], level: 1 });
  expect(await stored(), 'an arena run was written into the run log, the best run or LAST KEEP').toEqual(before);
});
