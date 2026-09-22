// The one pixel diff this repository has: how many pixels two captures disagree on, by how much, and where.
//
// Shared by `tests/browser/zz-pixel-diff.spec.ts` and the contact sheet (`compare.ts`). Both run it inside
// Chromium, because that is where a PNG decodes for free, and they get it there as source text
// (`diffPixels.toString()`). That is why it is one self-contained function declaration: nothing in its body
// may reach outside it - no imports, no module constants, no helpers - or it will throw once it is in the
// page. `tests/shots-compare.test.ts` rebuilds it from its own source to hold it to that.

export type DiffStats = {
  width: number;
  height: number;
  total: number;
  /** Pixels whose worst channel moved by at least one value step. */
  changed: number;
  /** The largest single-channel difference anywhere, 0-255. */
  worst: number;
  /** Mean worst-channel difference over the changed pixels only, to two places. */
  mean: number;
  /** Inclusive [minX, minY, maxX, maxY] of every changed pixel, or null when nothing changed. */
  box: [number, number, number, number] | null;
};

/**
 * Compares two RGBA buffers of the same size. Alpha is ignored: a capture is an opaque frame.
 *
 * With a `gain` and an `out` buffer it also writes the difference image - each channel's absolute difference
 * multiplied by `gain` and clamped, on opaque black - so a one-step change at x6 is visible without a
 * one-step change in the stills having to be.
 */
export function diffPixels(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  gain?: number,
  out?: { [index: number]: number } | null,
): DiffStats {
  const height = Math.floor(a.length / 4 / width);
  const paint = !!out && !!gain;
  let changed = 0, worst = 0, sum = 0;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let i = 0; i < a.length; i += 4) {
    const r = Math.abs(a[i] - b[i]), g = Math.abs(a[i + 1] - b[i + 1]), bl = Math.abs(a[i + 2] - b[i + 2]);
    if (paint) {
      out![i] = Math.min(255, r * gain!);
      out![i + 1] = Math.min(255, g * gain!);
      out![i + 2] = Math.min(255, bl * gain!);
      out![i + 3] = 255;
    }
    const d = Math.max(r, g, bl);
    if (!d) continue;
    changed++;
    sum += d;
    if (d > worst) worst = d;
    const p = i / 4, x = p % width, y = (p / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    width,
    height,
    total: width * height,
    changed,
    worst,
    mean: changed ? +(sum / changed).toFixed(2) : 0,
    box: maxX < 0 ? null : [minX, minY, maxX, maxY],
  };
}
