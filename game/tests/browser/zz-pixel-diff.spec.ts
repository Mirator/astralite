import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

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
      async ([a, b]) => {
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
        let changed = 0;
        let worst = 0;
        let minX = 1e9;
        let minY = 1e9;
        let maxX = -1;
        let maxY = -1;
        let sum = 0;
        for (let i = 0; i < one.data.length; i += 4) {
          const d = Math.max(
            Math.abs(one.data[i] - two.data[i]),
            Math.abs(one.data[i + 1] - two.data[i + 1]),
            Math.abs(one.data[i + 2] - two.data[i + 2]),
          );
          if (!d) continue;
          changed++;
          sum += d;
          if (d > worst) worst = d;
          const p = i / 4;
          const x = p % one.width;
          const y = (p / one.width) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return {
          total: one.width * one.height,
          changed,
          worst,
          mean: changed ? +(sum / changed).toFixed(2) : 0,
          box: maxX < 0 ? null : [minX, minY, maxX, maxY],
        };
      },
      [load(A!), load(B!)],
    );
    console.log(
      `DIFF ${name} changed=${report.changed}/${report.total} (${((report.changed / report.total) * 100).toFixed(2)}%) worst=${report.worst} mean=${report.mean} box=${JSON.stringify(report.box)}`,
    );
  }
  expect(true).toBe(true);
});
