import { buyUpgrade, freshMeta, WHET_STRIKE, type Meta } from '../../app/dungeon-meta.ts';
import type { RunEnd } from '../../app/dungeon-save.ts';
import { DEFAULT_SEEDS, expect, type GameWindow, openSlots, test } from './helpers.ts';

// Plan 020 Stage B: ENTER THE KEEP opens a slot picker, and the slot chosen on it is the one every read and write of progress speaks for.
// The rules (what a slot's key is, what the summary counts, what migration copies, what erase removes) are held in node, in
// tests/dungeon-save.test.ts. These scenarios hold the wiring: that the running game migrates at mount, that the picker shows what the
// slots hold, that a run is dealt from the slot chosen, that Erase asks twice, and that the picker is reachable by keyboard and fits a phone.
// Each reads what the game did: the card's text, the snapshot's `slot` and `run.start`, and the save through `dungeonTest.meta(slot)`.

const ORIGIN = `http://127.0.0.1:${process.env.GAME_TEST_PORT ?? 3000}`;
const NOTHING = freshMeta();
const card = (page: import('@playwright/test').Page, slot: number) => page.locator(`.slot-choose[data-slot="${slot}"]`);
const stats = (page: import('@playwright/test').Page, slot: number) => page.locator(`.slot-choose[data-slot="${slot}"] span`);
const back = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Back/ });

// A save as the build before slots wrote it: the four per-player cells without a slot in their names.
const LEGACY_META = { pearls: 137, upgrades: { lungs: 1 }, arms: ['tideblade', 'maul'], arm: 'maul' };
const LEGACY_BEST = { floor: 2, xp: 415, kills: 12, won: false };
const LEGACY_RUNS: RunEnd[] = [
  { at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge'], seed: 0xc0ffee, arm: 'tideblade', upgrades: {}, pearls: 20, bosses: 0 },
  { at: 1_700_000_500_000, floor: 1, won: false, cause: 'guard', seconds: 31, rank: 1, xp: 20, kills: 2, boons: [], seed: 7, arm: 'tideblade', upgrades: {}, pearls: 1, bosses: 0 },
];

test.describe('a save from before slots', () => {
  // A stored blob is read at mount, so this scenario gets its own page (helpers.ts `needsOwnPage`).
  test.use({
    storageState: {
      cookies: [],
      origins: [{
        origin: ORIGIN,
        localStorage: [
          { name: 'drowned-keep:meta', value: JSON.stringify(LEGACY_META) },
          { name: 'drowned-keep:best', value: JSON.stringify(LEGACY_BEST) },
          { name: 'drowned-keep:runs', value: JSON.stringify(LEGACY_RUNS) },
        ],
      }],
    },
  });

  test('arrives in slot 1, shows on its card, and the run chosen there is dealt from it', async ({ game, page }) => {
    await openSlots(page);
    // The picker shows what the game migrated, not what the fixture wrote: the legacy cells are not slot cells.
    await expect(stats(page, 1), 'slot 1\'s card does not show the legacy save\'s pearls, floor, runs and arms').toHaveText('137 pearls · deepest floor 2 · 2 runs logged · 2 arms');
    await expect(stats(page, 2), 'the legacy save was copied into a slot other than the first').toHaveText('Empty');
    await expect(stats(page, 3)).toHaveText('Empty');
    // Copied, not moved (D2): the pre-slot cells are still there, so a rollback finds its save.
    const legacy = await page.evaluate(() => ({ meta: localStorage.getItem('drowned-keep:meta'), runs: localStorage.getItem('drowned-keep:runs') }));
    expect(legacy.meta, 'the legacy meta cell was removed').toBe(JSON.stringify(LEGACY_META));
    expect(JSON.parse(legacy.runs!), 'the legacy run log was rewritten').toEqual(LEGACY_RUNS);

    await back(page).click();
    await game.enter(1);
    const state = await game.state();
    expect(state.slot, 'the run is not in slot 1').toBe(1);
    expect(state.mode).toBe('playing');
    expect(state.run.start, 'the run was not dealt from the migrated save (Deep Lungs rank 1, the maul in hand)').toEqual({ arm: 'maul', maxHp: 110, strike: 0, draftSize: 3, defiance: 0 });
    expect(state.weapon.id, 'the knight is not holding the migrated save\'s arm').toBe('maul');
    expect(await page.evaluate(() => localStorage.getItem('drowned-keep:slot')), 'the slot chosen was not remembered as the one last played').toBe('1');
  });
});

test('slots are separate: a purchase in slot 2 leaves slot 1\'s card alone, and each slot deals its own run', async ({ game, page }) => {
  const slot1: Meta = { ...NOTHING, pearls: 55, upgrades: { lungs: 1 } };
  const slot2: Meta = { ...NOTHING, pearls: 400, arms: ['tideblade', 'maul'], arm: 'maul', upgrades: { tide: 1 } };
  await game.setMeta(slot1, 1);
  await game.setMeta(slot2, 2);
  expect(await game.meta(1), 'precondition: slot 1 holds its own save').toEqual(slot1);
  expect(await game.meta(2), 'precondition: slot 2 holds its own save').toEqual(slot2);
  await openSlots(page);
  await expect(stats(page, 1)).toHaveText('55 pearls · no floor reached · 0 runs logged · 1 arm');
  await expect(stats(page, 2)).toHaveText('400 pearls · no floor reached · 0 runs logged · 2 arms');
  const before = await card(page, 1).innerText();

  // Buy Whetted Start in slot 2 (by the pure rule, written into slot 2 without choosing it). Slot 1's card, read afresh, is the same.
  const bought = buyUpgrade(slot2, 'whet')!;
  expect(bought, 'precondition: the purchase can be made').not.toBeNull();
  await game.setMeta(bought, 2);
  await back(page).click();
  await openSlots(page);
  await expect(stats(page, 2), 'precondition: the picker re-read slot 2 after the purchase').toHaveText(`${bought.pearls} pearls · no floor reached · 0 runs logged · 2 arms`);
  expect(await card(page, 1).innerText(), 'a purchase in slot 2 changed slot 1\'s card').toBe(before);
  expect(await game.meta(1), 'a purchase in slot 2 changed slot 1\'s save').toEqual(slot1);

  // A run in slot 1 is dealt from slot 1 (the keep on the page was built while slot 1 was the active one, so this much a stale slot would also get right).
  expect((await game.state()).slot, 'precondition: the page began in slot 1').toBe(1);
  await back(page).click();
  await game.enter(1);
  let state = await game.state();
  expect(state.slot, 'choosing slot 1 did not make it the active slot').toBe(1);
  expect(state.run.start, 'slot 1\'s run was not dealt from slot 1 (Deep Lungs, no Second Tide, the Tideblade)').toEqual({ arm: 'tideblade', maxHp: 110, strike: 0, draftSize: 3, defiance: 0 });
  expect(state.weapon.id).toBe('tideblade');
  expect(await game.meta(2), 'a run in slot 1 touched slot 2\'s save').toEqual(bought);

  // Back to the title with the storage kept (the pooled reset clears it, so the hook is called directly), which comes back on the slot last played.
  // Then slot 2: dealt from slot 2, although the keep on the page was built for slot 1. The scenario ends in slot 2, so the pooled reset
  // that follows it has to bring the slot back to a boot's, and the leak guard holds it to that.
  await page.evaluate(() => (window as GameWindow).dungeonTest!.reset());
  await game.built();
  await game.step(0);
  expect((await game.state()).slot, 'the title did not come back on the slot last played').toBe(1);
  await game.enter(2);
  state = await game.state();
  expect(state.slot, 'choosing slot 2 did not make it the active slot, as the snapshot reads it').toBe(2);
  expect(state.run.start, 'slot 2\'s run was not dealt from slot 2 (the maul, Second Tide, Whetted Start)').toEqual({ arm: 'maul', maxHp: 100, strike: WHET_STRIKE, draftSize: 3, defiance: 1 });
  expect(state.weapon.id).toBe('maul');
  expect(await page.evaluate(() => localStorage.getItem('drowned-keep:slot')), 'the slot chosen was not remembered as the one last played').toBe('2');
  expect(await page.evaluate((seed) => localStorage.getItem('drowned-keep:2:seed') === String(seed), state.floor.seed), 'the keep was not recorded under slot 2').toBe(true);
  expect(await game.meta(1), 'a run in slot 2 touched slot 1\'s save').toEqual(slot1);
});

test('Erase asks twice, arming another card disarms it, and the picker comes back closed and disarmed after a reset', async ({ game, page }) => {
  await game.setMeta({ ...NOTHING, pearls: 11 }, 1);
  await game.setMeta({ ...NOTHING, pearls: 77 }, 2);
  await openSlots(page);
  const erase = (slot: number) => page.locator(`.slot-erase[data-erase="${slot}"]`);
  const armed = page.locator('.slot-card.armed');
  await expect(stats(page, 2)).toHaveText('77 pearls · no floor reached · 0 runs logged · 1 arm');
  await expect(erase(2)).toHaveText('Erase');
  await expect(armed, 'precondition: nothing is armed on opening').toHaveCount(0);

  // One press arms it, and says so; the slot still holds everything.
  await erase(2).click();
  await expect(erase(2), 'the first press did not arm Erase').toHaveText('Press again to erase');
  await expect(page.locator('.slot-card[data-slot="2"]')).toHaveClass(/armed/);
  await expect(page.locator('.slot-note')).toHaveText('Slot 2 will be erased for good. Press Erase again to confirm.');
  expect((await game.meta(2)).pearls, 'the first press erased the slot').toBe(77);
  await expect(stats(page, 2), 'the first press changed the card').toHaveText('77 pearls · no floor reached · 0 runs logged · 1 arm');

  // A different action in between (Erase on another card) disarms it - one card is armed at a time: the next press on slot 2 arms again rather than erasing.
  await erase(1).click();
  await expect(armed, 'one card is armed at a time').toHaveCount(1);
  await expect(page.locator('.slot-card[data-slot="1"]')).toHaveClass(/armed/);
  await expect(erase(2), 'pressing another card\'s Erase did not disarm slot 2').toHaveText('Erase');
  await erase(2).click();
  await expect(erase(2), 'the press after a different action erased the slot instead of arming it').toHaveText('Press again to erase');
  expect((await game.meta(2)).pearls, 'the second press on slot 2, with a different action between, erased it').toBe(77);
  expect((await game.meta(1)).pearls).toBe(11);

  // The confirming press empties slot 2 and nothing else.
  await erase(2).click();
  await expect(stats(page, 2), 'the confirming press did not empty the card').toHaveText('Empty');
  await expect(erase(2), 'an empty slot still offers Erase').toHaveCount(0);
  await expect(page.locator('.slot-note')).toHaveText('Slot 2 erased.');
  expect(await game.meta(2), 'the confirming press left slot 2\'s save').toEqual(NOTHING);
  expect((await game.meta(1)).pearls, 'erasing slot 2 touched slot 1').toBe(11);
  await expect(stats(page, 1)).toHaveText('11 pearls · no floor reached · 0 runs logged · 1 arm');
  await expect(card(page, 2), 'focus was lost with the Erase button that held it').toBeFocused();

  // Leaving the picker disarms: Back and ENTER again, and the armed card is not armed.
  await erase(1).click();
  await expect(armed, 'precondition: Erase is armed before leaving').toHaveCount(1);
  await back(page).click();
  await openSlots(page);
  await expect(armed, 'leaving the picker and coming back did not disarm Erase').toHaveCount(0);
  await expect(page.locator('.slot-note'), 'the picker\'s note outlived leaving it').toHaveText('');

  // The pooled reset leaves the picker as a boot does: closed, on the title's list, in slot 1. Open and armed first, so there is something to leave behind.
  await erase(1).click();
  await expect(armed).toHaveCount(1);
  await game.reset(DEFAULT_SEEDS);
  await expect(page.locator('.slot-picker'), 'the reset left the picker open').toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main menu' }), 'the reset did not bring back the title\'s list').toBeVisible();
  expect((await game.state()).slot, 'the reset did not put the slot back to what a boot reads').toBe(1);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('360 x 740: every card and its Erase are reachable by Tab, the picker fits without scrolling sideways, and Enter on a card enters it', async ({ game, page }) => {
    await game.setMeta({ ...NOTHING, pearls: 11, upgrades: { lungs: 3 } }, 1);
    await game.setMeta({ ...NOTHING, pearls: 8888, arms: ['tideblade', 'spear', 'maul', 'fangs', 'cleaver', 'crossbow', 'flask'] }, 2);
    expect((await game.meta(3)), 'precondition: slot 3 holds nothing').toEqual(NOTHING);
    const widths = () => page.evaluate(() => ({ viewport: window.innerWidth, page: document.documentElement.scrollWidth, card: (document.querySelector('.intro-card') as HTMLElement).scrollWidth, cardBox: (document.querySelector('.intro-card') as HTMLElement).clientWidth }));

    // By keyboard: focus the button, press Enter, and the way back takes the focus (as every page of the card does).
    await page.getByRole('button', { name: /^ENTER THE KEEP/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.slot-picker')).toBeVisible();
    await expect(back(page)).toBeFocused();
    await expect(stats(page, 3), 'precondition: slot 3 is empty, so it has no Erase to reach').toHaveText('Empty');
    const focused = () => page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element?.dataset.erase ? `erase:${element.dataset.erase}` : element?.dataset.slot ? `choose:${element.dataset.slot}` : element?.textContent ?? 'nothing';
    });
    const reached: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      reached.push(await focused());
    }
    expect(reached, 'Tab did not walk every card and its Erase, in order').toEqual(['choose:1', 'erase:1', 'choose:2', 'erase:2', 'choose:3']);

    // Fits: nothing runs off the 360-wide screen, with the longest text (slot 2) and with an Erase armed (its label is longer).
    const fits = async (when: string) => {
      const shown = await widths();
      expect(shown.viewport, 'precondition: the phone viewport is the one asked for').toBe(360);
      expect(shown.page, `${when}: the picker scrolls the page sideways`).toBeLessThanOrEqual(shown.viewport);
      expect(shown.card, `${when}: something in the card overflows it sideways`).toBeLessThanOrEqual(shown.cardBox);
      const buttons = page.locator('.slot-picker button');
      expect(await buttons.count(), 'precondition: three cards and two Erase buttons').toBe(5);
      for (let i = 0; i < 5; i++) {
        const box = (await buttons.nth(i).boundingBox())!;
        const label = (await buttons.nth(i).innerText()).split('\n')[0];
        expect(box.x, `${when}: ${label} starts left of the screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${when}: ${label} runs off the right of the screen`).toBeLessThanOrEqual(360);
        expect(box.y + box.height, `${when}: ${label} runs off the bottom of the screen`).toBeLessThanOrEqual(740);
      }
    };
    await fits('at rest');
    await page.locator('.slot-erase[data-erase="2"]').click();
    await expect(page.locator('.slot-erase[data-erase="2"]')).toHaveText('Press again to erase');
    await fits('with Erase armed');

    // Enter on a focused card enters that slot.
    await card(page, 2).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.intro-screen')).toBeHidden({ timeout: 90_000 });
    await game.settle();
    const state = await game.state();
    expect(state.mode).toBe('playing');
    expect(state.slot, 'Enter on slot 2\'s card entered another slot').toBe(2);
    expect((await game.meta(2)).pearls, 'entering slot 2 after arming its Erase erased it').toBe(8888);
  });
});
