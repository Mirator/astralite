import { expect, test } from '@playwright/test';
import { WEAPONS } from '../../app/dungeon-weapon.ts';
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

  const rows = 4, cols = 8; // the default grid: knight, guard, stalker, warden x 8 facings
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
