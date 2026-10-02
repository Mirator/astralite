import { expect, test } from './helpers.ts';
import { parseRunExport } from '../../app/dungeon-run-export.ts';
import type { RunEnd } from '../../app/dungeon-save.ts';

const ORIGIN = `http://127.0.0.1:${process.env.GAME_TEST_PORT ?? 3000}`;
// The run log is stored under the game's real key; three runs, one of them a win, so the count is not a
// constant a wrong implementation could hit by accident.
const STORED: RunEnd[] = [
  { at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee, arm: 'tideblade', upgrades: {}, pearls: 0 },
  { at: 1_700_000_500_000, floor: 1, won: false, cause: 'guard', seconds: 31, rank: 1, xp: 20, kills: 2, boons: [], seed: 7, arm: 'tideblade', upgrades: {}, pearls: 0 },
  { at: 1_700_001_000_000, floor: 3, won: true, cause: null, seconds: 402, rank: 6, xp: 1290, kills: 44, boons: ['edge', 'ward', 'swift'], seed: 12345, arm: 'maul', upgrades: { lungs: 2, tide: 1 }, pearls: 118 },
];

// Plan 020: the log being exported is the slot last played's. The three runs sit in slot 2 and the device remembers slot 2 as last played; slot 1
// holds a single other run, so a Copy that read the wrong slot would export that one and name the wrong slot.
const OTHER: RunEnd[] = [{ ...STORED[1], seed: 99 }];
// A stored blob is read on mount, so this scenario gets its own page (helpers.ts `needsOwnPage`).
test.use({
  storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: [
    { name: 'drowned-keep:2:runs', value: JSON.stringify(STORED) },
    { name: 'drowned-keep:1:runs', value: JSON.stringify(OTHER) },
    { name: 'drowned-keep:slot', value: '2' },
  ] }] },
});

test('Copy run log puts the stored runs on the clipboard, and falls back to a read-only box when the clipboard refuses', async ({ game, page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const button = page.getByRole('button', { name: 'Copy run log' });
  await expect(button).toBeEnabled();
  // Precondition: the game itself read the stored runs, so the count below is not the fixture's word.
  await expect(page.locator('.run-log')).toContainText('Slot 2 · 3 descents logged');
  await expect(page.locator('.run-export-text')).toHaveCount(0);

  // Keyboard: focus the button and press Enter, as the menu's other buttons are used.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.run-export'), 'Copy run log did not name the slot it exported').toHaveText('Copied 3 runs from slot 2');
  const pasted = await page.evaluate(() => navigator.clipboard.readText());
  const doc = parseRunExport(pasted);
  expect(doc, 'the clipboard did not hold an astralite-runs export').not.toBeNull();
  expect(doc!.runs, 'the export was not the slot last played\'s log').toEqual(STORED);
  expect(Object.keys(JSON.parse(pasted) as object).sort()).toEqual(['exported', 'format', 'runs', 'version']);
  await expect(page.locator('.run-export-text')).toHaveCount(0);

  // The clipboard refuses (permission policy, insecure origin, a webview): the JSON is shown to copy by hand.
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  await button.focus();
  await page.keyboard.press('Enter');
  const box = page.getByRole('textbox', { name: 'Run log JSON' });
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('readonly', '');
  await expect(page.locator('.run-export')).toHaveText('Copy the 3 runs from slot 2 below');
  const shown = await box.inputValue();
  expect(parseRunExport(shown)?.runs).toEqual(STORED);
  // Pre-selected: the whole text is already the selection.
  expect(await box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length])).toEqual([0, shown.length, shown.length]);

  // A hand selection survives a re-render. The box is selected once, when it appears; an inline callback ref
  // re-selects everything on every render, and the Sound button below re-renders the menu.
  // Real pointer input. The box starts fully selected and unfocused, and a press straight into that state does
  // not move the caret, so the reader first clicks the note above it; the double-click then picks a word.
  await page.locator('.run-export').click();
  await box.dblclick({ position: { x: 60, y: 30 } });
  const selection = () => box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
  const picked = await selection();
  expect(picked[1] - picked[0], 'precondition: the double-click selected something').toBeGreaterThan(0);
  expect(picked[1] - picked[0], 'precondition: the selection is partial, not the whole log').toBeLessThan(shown.length);
  const sound = page.getByRole('button', { name: /^Sound o(n|ff)$/ });
  const before = await sound.textContent();
  await sound.click();
  expect(await sound.textContent(), 'precondition: the menu re-rendered').not.toBe(before);
  await expect(box).toBeVisible();
  expect(await selection(), 'the re-render re-selected the whole log and threw the hand selection away').toEqual(picked);
  await sound.click();
  void game;
});

test.describe('an empty log', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('says so and cannot be copied', async ({ page, game }) => {
    void game;
    await expect(page.getByRole('button', { name: 'Copy run log' })).toBeDisabled();
    await expect(page.locator('.run-export')).toHaveText('No runs recorded yet');
    await expect(page.locator('.run-log')).toHaveCount(0);
  });
});
