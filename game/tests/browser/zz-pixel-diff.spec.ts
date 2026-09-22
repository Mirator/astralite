import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { diffPixels, type DiffStats } from '../../scripts/shots/diff.ts';

/**
 * Diffs two directories of captures and reports, per file, how many pixels
 * differ, by how much, and the bounding box of the change.
 *
 * It is a tool rather than a check — it asserts nothing about the game and
 * self-skips unless it is given two directories — but it is the thing that
 * answers "are these captures stable enough to trust", which is the question
 * every reference shot depends on. It found that our stills agree to the last
 * value step while the strike strip does not, and that the difference is impact
 * sparks drawing real entropy rather than the swing moving.
 *
 * The diff itself lives in `scripts/shots/diff.ts`, shared with the contact sheet
 * `npm run shots:compare` draws, so the two can never disagree about a number.
 *
 *   DIFF_A=path/to/one DIFF_B=path/to/other npx playwright test zz-pixel-diff
 */
const A = process.env.DIFF_A;
const B = process.env.DIFF_B;

// A tool, not a check. Without two directories to compare it has nothing to say,
// and failing the suite because nobody asked it a question is just noise.
test.skip(!A || !B, 'set DIFF_A and DIFF_B to two directories of captures');

test('diff', async ({ page }) => {
  await page.goto('about:blank');
  for (const name of readdirSync(A!).filter((f) => f.endsWith('.png'))) {
    const load = (dir: string) =>
      `data:image/png;base64,${readFileSync(`${dir}/${name}`).toString('base64')}`;
    const report = await page.evaluate(
      async ([a, b, source]) => {
        // The shared diff arrives as source text; see scripts/shots/diff.ts for why.
        const diff = (0, eval)(`(${source})`);
        const grab = async (src: string) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, image.width, image.height);
        };
        const one = await grab(a);
        const two = await grab(b);
        return diff(one.data, two.data, one.width) as DiffStats;
      },
      [load(A!), load(B!), diffPixels.toString()],
    );
    console.log(
      `DIFF ${name} changed=${report.changed}/${report.total} (${((report.changed / report.total) * 100).toFixed(2)}%) worst=${report.worst} mean=${report.mean} box=${JSON.stringify(report.box)}`,
    );
  }
  expect(true).toBe(true);
});
