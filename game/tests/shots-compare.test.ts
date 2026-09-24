import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diffPixels } from '../scripts/shots/diff.ts';
import {
  changedText,
  costChange,
  defaultBase,
  parseArgs,
  parseCosts,
} from '../scripts/shots/lib.ts';

// The contact sheet judges nothing, so what it owes the suite is that its numbers are the numbers: the diff
// counts what changed and only that, a COST line reads back as it was logged, and a scene is paired with
// itself rather than with its neighbour. The capture runs themselves are the browser suite's business.

/** An RGBA buffer of `w * h` pixels of one colour. */
const flat = (w: number, h: number, [r, g, b, a = 255]: number[]) =>
  Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => [r, g, b, a][i % 4]);

test('arguments take both spellings and refuse what they cannot honour', () => {
  const o = parseArgs(['--base', 'HEAD~2', '--gl=swiftshader', '--gain', '10', '--grep', 'strike', '--port', '3200', '--base-port=3300']);
  assert.deepEqual([o.base, o.gl, o.gain, o.grep, o.port, o.basePort], ['HEAD~2', 'swiftshader', 10, 'strike', 3200, 3300]);
  assert.equal(parseArgs(['--before', '../output/shots/baseline', '--allow-mixed-gl']).allowMixedGl, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--base', 'main', '--before', 'x']), /both name the previous side/);
  assert.throws(() => parseArgs(['--gl', 'metal']), /d3d11 or swiftshader/);
  assert.throws(() => parseArgs(['--gain', '0']), /positive number/);
  assert.throws(() => parseArgs(['--base']), /needs a value/);
  assert.throws(() => parseArgs(['--base', '--gl', 'd3d11']), /needs a value/);
  assert.throws(() => parseArgs(['--port', '3000', '--base-port', '3000']), /must differ/);
  assert.throws(() => parseArgs(['--bsae', 'main']), /unknown argument/);
  assert.throws(() => parseArgs(['main']), /unknown argument/);
});

test('the default base is the fork point, then HEAD for uncommitted work on main, then HEAD~1', () => {
  assert.equal(defaultBase({ head: 'h', forkPoint: 'f', headParent: 'p', dirty: false }).sha, 'f');
  assert.equal(defaultBase({ head: 'h', forkPoint: 'f', headParent: 'p', dirty: true }).sha, 'f');
  assert.equal(defaultBase({ head: 'h', forkPoint: 'h', headParent: 'p', dirty: true }).sha, 'h');
  assert.equal(defaultBase({ head: 'h', forkPoint: 'h', headParent: 'p', dirty: false }).sha, 'p');
  assert.throws(() => defaultBase({ head: 'h', forkPoint: null, headParent: 'p', dirty: false }), /--base/);
  assert.throws(() => defaultBase({ head: 'h', forkPoint: 'h', headParent: null, dirty: false }), /--base/);
});

test('COST lines read back as they were logged, through whatever the reporter prefixed', () => {
  const costs = parseCosts([
    'Running 10 tests using 1 worker',
    'COST flooded-hall-guards-closing calls=428 triangles=196500 geometries=61 textures=12',
    '  [before] COST strike-contact calls=371 triangles=154500 geometries=58 textures=12\r',
    'the COST of nothing',
    'COST broken calls=',
  ].join('\n'));
  assert.deepEqual(costs, {
    'flooded-hall-guards-closing': { calls: 428, triangles: 196500, geometries: 61, textures: 12 },
    'strike-contact': { calls: 371, triangles: 154500, geometries: 58, textures: 12 },
  });
  assert.equal(costChange({ calls: 412 }, { calls: 418 }, 'calls'), '412 → 418 (+6)');
  assert.equal(costChange({ calls: 412 }, { calls: 400 }, 'calls'), '412 → 400 (-12)');
  assert.equal(costChange({ calls: 412 }, { calls: 412 }, 'calls'), '412 → 412');
  assert.equal(costChange(undefined, { calls: 412 }, 'calls'), '? → 412');
  assert.equal(costChange(undefined, undefined, 'calls'), '');
});

test('the diff counts changed pixels by their worst channel, ignores alpha, and boxes them', () => {
  const a = flat(4, 3, [10, 20, 30]);
  const b = a.slice();
  const at = (x: number, y: number) => (y * 4 + x) * 4;
  // (1, 0): one step on green. (3, 2): red down by 9 and blue up by 4 - worst channel 9.
  b[at(1, 0) + 1] += 1;
  b[at(3, 2)] -= 9;
  b[at(3, 2) + 2] += 4;
  // (0, 1): alpha only, which is not a change to an opaque frame.
  b[at(0, 1) + 3] = 0;
  assert.deepEqual(diffPixels(a, b, 4), { width: 4, height: 3, total: 12, changed: 2, worst: 9, mean: 5, box: [1, 0, 3, 2] });
});

test('the difference image is each channel amplified, clamped, on opaque black', () => {
  const a = flat(2, 1, [100, 100, 100]);
  const b = Uint8ClampedArray.from([101, 97, 100, 255, 0, 250, 100, 0]);
  const out = new Uint8ClampedArray(8);
  const stats = diffPixels(a, b, 2, 6, out);
  assert.deepEqual([...out], [6, 18, 0, 255, 255, 255, 0, 255]);
  assert.equal(stats.changed, 2);
  // Without a gain it paints nothing.
  const untouched = new Uint8ClampedArray(8);
  diffPixels(a, b, 2, 0, untouched);
  assert.deepEqual([...untouched], [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('the diff survives being rebuilt from its own source, which is how it reaches the page', () => {
  // A fresh context, so a reference to anything outside the function's own body fails here as it would there.
  const rebuilt = runInNewContext(`(${diffPixels.toString()})`) as typeof diffPixels;
  const a = flat(3, 3, [1, 2, 3]);
  const b = a.slice();
  b[4 * 4] = 200;
  const out = new Uint8ClampedArray(a.length);
  // Through JSON: the other context's arrays have their own prototype, which is not a difference in the numbers.
  assert.equal(JSON.stringify(rebuilt(a, b, 3, 6, out)), JSON.stringify(diffPixels(a, b, 3)));
  assert.equal(out[4 * 4], 255);
});

test('a handful of changed pixels never rounds to nothing', () => {
  const of = (changed: number) => ({ width: 1000, height: 700, total: 700000, changed, worst: 1, mean: 1, box: null });
  assert.equal(changedText(of(0)), 'identical');
  assert.equal(changedText(of(8)), '8 px (<0.01%)');
  assert.equal(changedText(of(2495)), '2,495 px (0.36%)');
});
