import { expect, test } from '@playwright/test';
import { WEAPONS } from '../../app/dungeon-weapon.ts';
import { ENEMY_KINDS } from '../../app/dungeon-bestiary.ts';
import { CAPTURING } from './helpers.ts';

// The figure bench (plan 012 Stage C) is not the pooled game page - it is a different route entirely, with
// its own renderer and no floor, no input and no reset to hold a snapshot against - so this spec never
// touches the `game` fixture in tests/browser/helpers.ts (it borrows only the CAPTURING flag) and runs on
// a plain Playwright page instead of opting a pooled one out.
//
// It must add under 5s to the suite: one page load, one wait for `__bench`, one canvas read-back. It
// writes no PNG unless GAME_TEST_CAPTURE=1 - `npm run figures` is what the PNG is for, and this spec's job
// is a fast, no-artifact regression: does every cell it drew actually have a figure in it. CI sets the
// variable to '0' when not capturing, which a bare truthiness check would read as "capture".

/** True once every cell in the grid has enough pixels that differ from that cell's own corner (its empty
 *  background) by more than a small per-channel threshold - proof that a figure actually drew into it,
 *  not just that the canvas is not blank somewhere. */
async function everyCellHasAFigure(page: import('@playwright/test').Page, rows: number, cols: number) {
  return page.evaluate(({ rows, cols }) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { ok: false, reason: 'no canvas found', cells: [] as number[] };
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const cellW = Math.floor(canvas.width / cols), cellH = Math.floor(canvas.height / rows);
    const counts: number[] = [], turned: number[] = [];
    const THRESHOLD = 18, MIN_PIXELS = 300;
    let previous: Uint8ClampedArray | null = null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * cellW, y0 = r * cellH;
        const { data } = ctx.getImageData(x0, y0, cellW, cellH);
        // The background sample: this cell's own top-left corner, a few pixels in so antialiasing on the
        // canvas edge cannot bias it.
        const cornerX = 3, cornerY = 3;
        const ci = (cornerY * cellW + cornerX) * 4;
        const br = data[ci]!, bg = data[ci + 1]!, bb = data[ci + 2]!;
        let changed = 0;
        for (let i = 0; i < data.length; i += 4) {
          const dr = Math.abs(data[i]! - br), dg = Math.abs(data[i + 1]! - bg), db = Math.abs(data[i + 2]! - bb);
          if (Math.max(dr, dg, db) > THRESHOLD) changed++;
        }
        counts.push(changed);
        // Against the facing drawn just left of it: a figure present in every cell but never turned (one
        // pose repeated eight times) fills every cell and fails only this.
        if (c > 0 && previous) {
          let differ = 0;
          for (let i = 0; i < data.length; i += 4) if (Math.max(Math.abs(data[i]! - previous[i]!), Math.abs(data[i + 1]! - previous[i + 1]!), Math.abs(data[i + 2]! - previous[i + 2]!)) > THRESHOLD) differ++;
          turned.push(differ);
        }
        previous = data;
      }
      previous = null;
    }
    return { ok: counts.every((n) => n >= MIN_PIXELS) && turned.every((n) => n >= MIN_PIXELS / 3), reason: '', cells: counts, turned, min: MIN_PIXELS };
  }, { rows, cols });
}

test('the bench renders every figure at every facing', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/bench');
  await page.waitForFunction(() => (window as unknown as { __bench?: string }).__bench === 'ready', { timeout: 15_000 });

  const rows = 1 + ENEMY_KINDS.length, cols = 8; // the default grid: the knight and every enemy kind x 8 facings
  const result = await everyCellHasAFigure(page, rows, cols);
  expect(result.ok, `cell pixel counts (min ${result.min}): ${JSON.stringify(result.cells)}; pixels differing from the facing before: ${JSON.stringify(result.turned)}`).toBe(true);

  if (CAPTURING) {
    await page.locator('canvas').screenshot({ path: `test-results/bench-capture.png` });
  }
});

test('the bench honours figures= and weapon=all in the URL', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/bench?figures=knight&weapon=all');
  await page.waitForFunction(() => (window as unknown as { __bench?: string }).__bench === 'ready', { timeout: 15_000 });

  // Every arm in dungeon-weapon.ts's WEAPONS, one row each, still eight facings.
  const result = await everyCellHasAFigure(page, Object.keys(WEAPONS).length, 8);
  expect(result.ok, `cell pixel counts (min ${result.min}): ${JSON.stringify(result.cells)}; pixels differing from the facing before: ${JSON.stringify(result.turned)}`).toBe(true);
});

// Plan 022 Stage C (D8): `?tint=` dresses every figure that can carry the modifier as the game dresses an idle elite, so the four tints can be judged on one sheet. The mean colour of what a figure drew
// into its first cell (every pixel that is not that cell's own background) moves toward the modifier's colour: cyan takes red out of it and puts blue in, and a modifier with no effect on the sheet fails.
const meanTone = async (page: import('@playwright/test').Page, query: string) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto(`/bench?figures=guard&${query}`);
  await page.waitForFunction(() => (window as unknown as { __bench?: string }).__bench === 'ready', { timeout: 15_000 });
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!, off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
    const cell = Math.floor(canvas.width / 8), { data } = ctx.getImageData(0, 0, cell, canvas.height);
    const ci = (3 * cell + 3) * 4, br = data[ci]!, bg = data[ci + 1]!, bb = data[ci + 2]!;
    let n = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(Math.abs(data[i]! - br), Math.abs(data[i + 1]! - bg), Math.abs(data[i + 2]! - bb)) > 18) { n++; r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; }
    return { n, r: r / n, g: g / n, b: b / n };
  });
};

test('the bench dresses a figure as an elite with ?tint=, and a name that is not a modifier leaves it as it was', async ({ page }) => {
  const plain = await meanTone(page, 'x=1'), hasted = await meanTone(page, 'tint=hasted'), wrathful = await meanTone(page, 'tint=wrathful'), unknown = await meanTone(page, 'tint=fast');
  console.log('BENCH tone', JSON.stringify({ plain, hasted, wrathful, unknown }));
  expect(plain.n, 'precondition: the plain guard drew into its cell').toBeGreaterThan(300);
  // Measured 2026-10-03 on SwiftShader: blue minus red 11.8 plain and 43.9 hasted (+32.1); red minus blue -11.8 plain and 16.7 wrathful (+28.5). The floor is half the gain, the ceiling a figure that has been washed flat in the colour (the first glow tried, 0.16, was).
  expect(hasted.b - hasted.r - (plain.b - plain.r), 'a hasted figure is no bluer against red than a plain one').toBeGreaterThan(15);
  expect(hasted.b - hasted.r - (plain.b - plain.r), 'a hasted figure is washed flat in its colour').toBeLessThan(55);
  expect(wrathful.r - wrathful.b - (plain.r - plain.b), 'a wrathful figure is no redder against blue than a plain one').toBeGreaterThan(15);
  expect(wrathful.r - wrathful.b - (plain.r - plain.b), 'a wrathful figure is washed flat in its colour').toBeLessThan(55);
  expect(unknown.r - plain.r + (unknown.g - plain.g) + (unknown.b - plain.b), 'a name that is not a modifier changed the figure').toBe(0);
});
