import { ARM_ORDER, ARM_PRICES, freshMeta, pearlsFor, UPGRADES, WHET_STRIKE, type UpgradeId } from '../../app/dungeon-meta.ts';
import { DEFAULT_SEEDS, expect, press, stageBlow, test } from './helpers.ts';

// Plan 019 Stage B: the running game is wired to the pure rules in dungeon-meta.ts (proved in tests/). These
// scenarios read what the game did: the save through `dungeonTest.meta()`, the run through `run.start` in the
// snapshot, the screen through its real buttons. Fixtures only stage a save (`setMeta`) and a blow.
//
// Plan 020: pearls are spent at the Tide Altar in the hall (D6), so the scenarios about spending open on the hall (D11, `test.use({ hall: true })`):
// a death comes back through RETURN TO THE ALTAR, the shop is opened at the altar with the swap key, and the way down deals the next run. The
// Altar's own Tab order, notes, refusals and 360 x 740 layout are held here again, now of the shop overlay (Stage B had to drop them with the title's panel).

const NOTHING = freshMeta();
const DEFAULT_START = { arm: 'tideblade', maxHp: 100, strike: 0, draftSize: 3, defiance: 0 };
// What the first rank of an upgrade costs, read off the table so a price change restages nothing here.
const firstRank = (id: UpgradeId) => UPGRADES.find(upgrade => upgrade.id === id)!.price(0);

test.describe('through the hall', () => {
  test.use({ hall: true });

  test('death pays, the pearls survive it, RETURN TO THE ALTAR leads to a shop that shows them and the next descent is a fresh run on what was bought', async ({
    game,
    page,
  }) => {
    // 200 held going in, so the bank has to add to a balance it read from the save, not replace it. Plan 023 Stage D: a death on floor 2 with no chamber cleared pays only the floor behind it (5), so the held balance has to cover Deep Lungs and Whetted Start (170) by itself
    // and still leave Keen Eye (70) out of reach after them (200 + 5 - 170 = 35).
    const HELD = 200;
    await game.setMeta({ ...NOTHING, pearls: HELD });
    await game.enter();
    expect((await game.state()).hall, 'precondition: the page starts in the hall').toBe(true);
    await game.takeWayDown();
    expect((await game.state()).run.start, 'precondition: a run dealt before anything is bought').toEqual({ ...DEFAULT_START });

    // Floor 2, so a death has a floor behind it to pay for; the knight is then killed by a real blow.
    await game.buildFloor(2);
    expect((await game.state()).floor.level, 'precondition: the run is on floor 2').toBe(2);
    const { kind } = await stageBlow(game, 1);
    expect((await game.state()).health, 'precondition: the blow is lethal').toBe(1);
    await game.step(300);
    expect((await game.state()).mode, 'the staged blow never landed').toBe('lost');

    const logged = (await page.evaluate(
      () => (window as unknown as { dungeonTest: { runLog: () => { floor: number; won: boolean; kills: number; chambers: number; cause: string | null; pearls: number }[] } }).dungeonTest.runLog(),
    )).at(-1)!;
    expect(logged.cause, 'the run did not end by the body that was staged').toBe(kind);
    const earned = pearlsFor(logged);
    expect(earned, 'precondition: the run earned something, or a bank that adds nothing would pass').toBeGreaterThan(0);
    expect(logged.pearls, 'the run record does not carry what the run earned').toBe(earned);
    expect((await game.meta()).pearls, 'the earnings were not banked into the save').toBe(HELD + earned);
    await expect(page.locator('.result-card .run-pearls')).toHaveText(`+${earned} pearls · ${HELD + earned} held`);

    // RETURN TO THE ALTAR: the hall, and the finished run is not on screen. The balance is in the shop the altar opens with the swap key.
    await page.getByRole('button', { name: 'RETURN TO THE ALTAR' }).click();
    await game.built();
    await game.step(16);
    await expect(page.locator('.result-card')).toHaveCount(0);
    const hall = await game.state();
    expect([hall.hall, hall.mode], 'the card did not lead back to the hall').toEqual([true, 'playing']);
    const altar = hall.hallProps!.altar!;
    await game.teleport(altar.x, altar.z);
    await game.step(64);
    await press(page, 'swap');
    await game.step(16);
    await expect(page.getByRole('heading', { name: /Spend what/ })).toBeVisible();
    await expect(page.locator('.altar-purse'), 'the shop does not show the pearls the run banked').toHaveText(`${HELD + earned} pearls held`);
    await expect(page.locator('.altar-panel'), 'the shop still says arms are chosen at the Tide Gate').toContainText('chosen on the racks of this hall');

    // The Altar, by keyboard: every row is reachable with Tab, in order, whether or not it can be bought.
    const order = [...ARM_ORDER.filter((id) => id !== 'tideblade'), ...UPGRADES.map((upgrade) => upgrade.id)];
    await page.getByRole('button', { name: /Back to the hall/ }).focus();
    const reached: (string | undefined)[] = [];
    for (let i = 0; i < order.length; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.item));
    }
    expect(reached, 'Tab did not walk every arm and upgrade row, one by one').toEqual(order);
    // Keyboard purchase: Deep Lungs, focused and bought with Enter.
    await page.locator('[data-item="lungs"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.altar-note')).toHaveText('Deep Lungs bought.');
    expect((await game.meta()).upgrades, 'the keyboard purchase did not reach the save').toEqual({ lungs: 1 });
    // Pointer purchase: Whetted Start.
    await page.locator('[data-item="whet"]').click();
    await expect(page.locator('.altar-note')).toHaveText('Whetted Start bought.');
    const spent = await game.meta();
    expect(spent.upgrades).toEqual({ lungs: 1, whet: 1 });
    expect(spent.pearls, 'the purchases were not charged at the Altar\'s prices').toBe(HELD + earned - firstRank('lungs') - firstRank('whet'));
    expect(spent.pearls, 'precondition: Keen Eye must be out of reach, or the refusal below cannot happen').toBeLessThan(firstRank('eye'));
    // A purchase that cannot be made says why and charges nothing. The row is aria-disabled, which Playwright
    // counts as not enabled, so the click is forced: a player's click on it lands all the same.
    await page.locator('[data-item="eye"]').click({ force: true });
    await expect(page.locator('.altar-note')).toContainText(`costs ${firstRank('eye')} pearls`);
    expect(await game.meta(), 'a refused purchase changed the save').toEqual(spent);

    // Back to the hall, and down: a fresh run, on floor 1, dealt from what was just bought.
    await page.getByRole('button', { name: /Back to the hall/ }).click();
    await expect(page.locator('.altar-view')).toHaveCount(0);
    await game.takeWayDown();
    const fresh = await game.state();
    expect(fresh.mode, 'the ended run was resumed instead of a new one begun').toBe('playing');
    expect(fresh.floor.level).toBe(1);
    expect(fresh.experience.total).toBe(0);
    expect(fresh.run.start, 'the new run was not dealt from what the Altar sold').toEqual({ ...DEFAULT_START, maxHp: 110, strike: WHET_STRIKE });
    expect(fresh.maxHealth, 'the run does not hold the vitality it was dealt').toBe(110);
    expect(fresh.health, 'the new run did not begin at full vitality').toBe(110);
    await expect(page.getByRole('progressbar', { name: 'Vitality' })).toHaveAttribute('aria-valuemax', '110');
    expect(fresh.weapon.strikeDamage, 'Whetted Start did not reach the blade').toBe(fresh.weapon.damage + WHET_STRIKE);
  });

  test('an unlock is recorded and not equipped: the arm bought appears on its rack and the next run still starts with the arm that was chosen before', async ({
    game,
    page,
  }) => {
    // The arm held going in is the spear, not the Tideblade, so "unchanged" cannot be the default by accident.
    await game.setMeta({ ...NOTHING, pearls: 400, arms: ['tideblade', 'spear'], arm: 'spear', upgrades: { lungs: 1 } });
    await game.enter();
    const opening = await game.state();
    expect([opening.hall, opening.weapon.id], 'precondition: the page starts in the hall holding the spear').toEqual([true, 'spear']);
    expect(opening.racks.filter((rack) => !rack.locked).map((rack) => rack.kind), 'precondition: the maul is not owned yet, so it stands on no open rack').toEqual(['tideblade']);
    expect(opening.racks.find((rack) => rack.kind === 'maul')?.locked, 'precondition: the maul stands locked (plan 025)').toBe(true);
    expect((await game.meta()).arms, 'precondition: the maul is not owned yet').not.toContain('maul');
    await game.openAltar();
    await expect(page.locator('[data-item="maul"]')).toContainText(`${ARM_PRICES.maul} pearls`);
    await page.locator('[data-item="maul"]').click();
    await expect(page.locator('[data-item="maul"]')).toContainText('Unlocked');
    const bought = await game.meta();
    expect(bought.arms, 'the unlock was not recorded').toContain('maul');
    expect(bought.arms, 'buying one arm took another').toEqual(expect.arrayContaining(['tideblade', 'spear']));
    expect(bought.pearls).toBe(400 - ARM_PRICES.maul);
    expect(bought.arm, 'buying an arm equipped it').toBe('spear');

    // Put the shop away: the maul is on its rack now, and the spear is still in hand.
    await page.getByRole('button', { name: /Back to the hall/ }).click();
    await game.step(16);
    const after = await game.state();
    expect(after.racks.filter((rack) => !rack.locked).map((rack) => rack.kind), 'the arm bought did not open its rack when the shop closed').toEqual(['tideblade', 'maul']);
    expect(after.weapon.id, 'buying an arm put it in the knight\'s hand').toBe('spear');

    await game.takeWayDown();
    const start = (await game.state()).run.start;
    expect(start.arm, 'the run did not start with the arm the save holds').toBe('spear');
    expect((await game.state()).weapon.id, 'the knight is not holding it').toBe('spear');
    // The run is dealt from the save at the way down (D11): Deep Lungs, staged before it.
    expect(start.maxHp, 'the descent ignored the save').toBe(110);
  });

});

test('Second Tide: the blow that would kill leaves the knight at 40% vitality, shows the notice, and the next one ends the run', async ({
  game,
  page,
}) => {
  await game.setMeta({ ...NOTHING, upgrades: { tide: 1, lungs: 1 } });
  await game.enter();
  const opening = await game.state();
  expect(opening.run.start.defiance, 'precondition: the run was dealt a revive').toBe(1);
  expect(opening.maxHealth).toBe(110);
  await expect(page.locator('.chamber-notice')).toHaveCount(0);

  const { kind, stance } = await stageBlow(game, 1);
  expect((await game.state()).health, 'precondition: the blow would be lethal').toBe(1);
  await game.step(300);
  const saved = await game.state();
  expect(saved.mode, 'the blow ended the run: the revive was not applied before the end was decided').toBe('playing');
  expect(saved.health, 'the knight does not stand at 40% of his vitality').toBe(44);
  await expect(page.locator('.chamber-notice')).toHaveText('The tide gives you back');

  // The revive is spent: the same kind of blow, once the window after the first is over, ends the run.
  await game.step(600);
  await game.teleport(stance.player.x, stance.player.z);
  await game.configureCombat({
    health: 1,
    enemies: [{
      index: (await game.state()).enemies.findIndex((enemy) => enemy.kind === kind),
      x: stance.behind.x,
      z: stance.behind.z,
      windup: 0.0675,
      cooldown: 0,
      aim: { x: stance.player.x - stance.behind.x, z: stance.player.z - stance.behind.z },
    }],
  });
  expect((await game.state()).health, 'precondition: the second blow would be lethal').toBe(1);
  await game.step(300);
  expect((await game.state()).mode, 'a second lethal blow did not end the run').toBe('lost');
  const logged = (await page.evaluate(
    () => (window as unknown as { dungeonTest: { runLog: () => { cause: string | null }[] } }).dungeonTest.runLog(),
  )).at(-1)!;
  expect(logged.cause, 'the run was not blamed on the body that landed the final blow').toBe(kind);
});

test('nothing bought survives a reset: a rich save deals a rich run, and the reset page is a freshly booted one', async ({ game }) => {
  await game.setMeta({
    pearls: 500,
    upgrades: { lungs: 3, whet: 1, eye: 1, tide: 1 },
    arms: ['tideblade', 'maul'],
    arm: 'maul',
  });
  await game.enter();
  expect((await game.state()).run.start, 'precondition: the run was dealt everything that was bought').toEqual({
    arm: 'maul', maxHp: 130, strike: WHET_STRIKE, draftSize: 4, defiance: 1,
  });

  // What the pool does after every scenario, done here as well so the failure names this test: storage is
  // cleared and the page restarted, and the new run must be dealt from the empty save, not from a copy.
  await game.reset(DEFAULT_SEEDS);
  expect(await game.meta(), 'the reset left the save behind').toEqual(NOTHING);
  expect((await game.state()).run.start, 'a reset run was dealt from a save that no longer exists').toEqual(DEFAULT_START);
  expect((await game.state()).weapon.id).toBe('tideblade');
});

