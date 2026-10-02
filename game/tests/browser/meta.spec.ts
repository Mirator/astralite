import { ARM_PRICES, buyArm, buyUpgrade, freshMeta, pearlsFor, UPGRADES, WHET_STRIKE, type UpgradeId } from '../../app/dungeon-meta.ts';
import { DEFAULT_SEEDS, expect, openSlots, stageBlow, test } from './helpers.ts';

// Plan 019 Stage B: the running game is wired to the pure rules in dungeon-meta.ts (proved in tests/). These
// scenarios read what the game did: the save through `dungeonTest.meta()`, the run through `run.start` in the
// snapshot, the screen through its real buttons. Fixtures only stage a save (`setMeta`) and a blow.
//
// Plan 020 Stage B took the Tide Altar's panel off the title, so a purchase has no screen to be made on until Stage C puts the shop in the
// hall. These scenarios therefore stage what a purchase leaves behind, through the pure rules in dungeon-meta.ts (`buyUpgrade`, `buyArm`)
// and `setMeta`, and keep their assertions about the run being dealt from the save and about what the title shows of it. The purchase UI
// (Tab order, notes, refusals, the phone layout of the rows) loses its browser scenario here and gets it back in the hall's.

const NOTHING = freshMeta();
const DEFAULT_START = { arm: 'tideblade', maxHp: 100, strike: 0, draftSize: 3, defiance: 0 };
// What the first rank of an upgrade costs, read off the table so a price change restages nothing here.
const firstRank = (id: UpgradeId) => UPGRADES.find(upgrade => upgrade.id === id)!.price(0);

test('death pays, the pearls survive it, TO THE GATE leads to a title that shows them and the next descent is a fresh run on what was bought', async ({
  game,
  page,
}) => {
  // 160 held going in, so the bank has to add to a balance it read from the save, not replace it.
  await game.setMeta({ ...NOTHING, pearls: 160 });
  await game.enter();
  expect((await game.state()).run.start, 'precondition: a run dealt before anything is bought').toEqual({ ...DEFAULT_START });

  // Floor 2, so a death has a floor behind it to pay for; the knight is then killed by a real blow.
  await game.buildFloor(2);
  expect((await game.state()).floor.level, 'precondition: the run is on floor 2').toBe(2);
  const { kind } = await stageBlow(game, 1);
  expect((await game.state()).health, 'precondition: the blow is lethal').toBe(1);
  await game.step(300);
  expect((await game.state()).mode, 'the staged blow never landed').toBe('lost');

  const logged = (await page.evaluate(
    () => (window as unknown as { dungeonTest: { runLog: () => { floor: number; won: boolean; kills: number; cause: string | null; pearls: number }[] } }).dungeonTest.runLog(),
  )).at(-1)!;
  expect(logged.cause, 'the run did not end by the body that was staged').toBe(kind);
  const earned = pearlsFor(logged);
  expect(earned, 'precondition: the run earned something, or a bank that adds nothing would pass').toBeGreaterThan(0);
  expect(logged.pearls, 'the run record does not carry what the run earned').toBe(earned);
  expect((await game.meta()).pearls, 'the earnings were not banked into the save').toBe(160 + earned);
  await expect(page.locator('.result-card .run-pearls')).toHaveText(`+${earned} pearls · ${160 + earned} held`);

  // TO THE GATE: the title menu, and the finished run is not on screen. The balance is on the slot's card, in the picker ENTER THE KEEP opens
  // (it was a line of the title beside the Altar button before plan 020).
  await page.getByRole('button', { name: 'TO THE GATE' }).click();
  await expect(page.locator('.result-card')).toHaveCount(0);
  expect((await game.state()).mode, 'the title menu is not showing: the run is still live behind it').toBe('ready');
  await openSlots(page);
  await expect(page.locator('.slot-choose[data-slot="1"]'), 'the title does not show the pearls the run banked').toContainText(`${160 + earned} pearls`);
  await page.getByRole('button', { name: /Back/ }).click();

  // What the Altar will sell, bought here by the pure rules and written to the save the way a purchase writes it: Deep Lungs, then Whetted Start.
  const banked = await game.meta();
  const lungs = buyUpgrade(banked, 'lungs')!;
  const spent = buyUpgrade(lungs, 'whet')!;
  expect(spent.upgrades, 'precondition: both purchases were made').toEqual({ lungs: 1, whet: 1 });
  expect(spent.pearls, 'the purchases were not charged at the Altar\'s prices').toBe(160 + earned - firstRank('lungs') - firstRank('whet'));
  expect(spent.pearls, 'precondition: Keen Eye must be out of reach, or the refusal below cannot happen').toBeLessThan(firstRank('eye'));
  expect(buyUpgrade(spent, 'eye'), 'a purchase that cannot be made was made').toBeNull();
  await game.setMeta(spent);
  expect(await game.meta(), 'the purchases did not reach the save').toEqual(spent);

  // ENTER THE KEEP: a fresh run, on floor 1, dealt from what was just bought.
  await game.enter();
  await game.built();
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

test('an unlock is recorded and not equipped: the next run still starts with the arm that was chosen before', async ({
  game,
  page,
}) => {
  // The arm held going in is the spear, not the Tideblade, so "unchanged" cannot be the default by accident.
  await game.setMeta({ ...NOTHING, pearls: 400, arms: ['tideblade', 'spear'], arm: 'spear', upgrades: { lungs: 1 } });
  expect((await game.meta()).arms, 'precondition: the maul is not owned yet').not.toContain('maul');
  // The unlock, by the pure rule and written to the save (the Altar's button is the hall's from Stage C).
  const bought = buyArm(await game.meta(), 'maul')!;
  expect(bought, 'precondition: the maul can be bought with 400 pearls').not.toBeNull();
  await game.setMeta(bought);
  const kept = await game.meta();
  expect(kept.arms, 'the unlock was not recorded').toContain('maul');
  expect(kept.arms, 'buying one arm took another').toEqual(expect.arrayContaining(['tideblade', 'spear']));
  expect(kept.pearls).toBe(400 - ARM_PRICES.maul);
  expect(kept.arm, 'buying an arm equipped it').toBe('spear');

  // The title reads the same save: the slot's card shows the unlock and what it cost.
  await openSlots(page);
  await expect(page.locator('.slot-choose[data-slot="1"]')).toContainText(`${400 - ARM_PRICES.maul} pearls`);
  await expect(page.locator('.slot-choose[data-slot="1"]')).toContainText('3 arms');
  await page.getByRole('button', { name: /Back/ }).click();

  await game.enter();
  const start = (await game.state()).run.start;
  expect(start.arm, 'the run did not start with the arm the save holds').toBe('spear');
  expect((await game.state()).weapon.id, 'the knight is not holding it').toBe('spear');
  // The first ENTER of a page deals the run from the save too (D11): Deep Lungs, staged before it.
  expect(start.maxHp, 'the first descent ignored the save').toBe(110);
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

test.describe('Keen Eye on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  // The Altar's rows had their own 360 x 740 layout check here; they have no screen until the hall (plan 020 Stage C), which brings it back.
  // The slot picker's own fit is held in slots.spec.ts.
  test('360 x 740: no horizontal scroll on the title, and four boon cards fit', async ({ game, page }) => {
    await game.setMeta({ ...NOTHING, pearls: 999, upgrades: { eye: 1 } });
    const widths = () => page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect((await widths()).viewport, 'precondition: the phone viewport is the one asked for').toBe(360);
    expect((await widths()).page, 'the title menu already scrolls sideways').toBeLessThanOrEqual(360);

    // Keen Eye: the draft shows four cards and all four fit the screen.
    await game.enter();
    expect((await game.state()).run.start.draftSize, 'precondition: the run was dealt Keen Eye').toBe(4);
    await game.grantXp(200);
    const cards = page.locator('.boon-option');
    await expect(cards, 'Keen Eye did not put a fourth card in the offer').toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const box = (await cards.nth(i).boundingBox())!;
      expect(box.x, `boon card ${i} starts left of the screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `boon card ${i} runs off the right of the screen`).toBeLessThanOrEqual(360);
      expect(box.y + box.height, `boon card ${i} runs off the bottom of the screen`).toBeLessThanOrEqual(740);
    }
    expect(new Set(await cards.locator('strong').allInnerTexts()).size, 'the four cards are not distinct').toBe(4);
  });
});
