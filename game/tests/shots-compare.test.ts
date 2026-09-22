import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diffPixels } from '../scripts/shots/diff.ts';
import {
  changedText,
  costChange,
  defaultBase,
  escapeHtml,
  pairCaptures,
  parseArgs,
  parseCosts,
  renderSheet,
  sequenceOf,
  type Row,
  type Sheet,
} from '../scripts/shots/lib.ts';

// The contact sheet judges nothing, so what it owes the suite is that its numbers are the numbers: the diff
// counts what changed and only that, a COST line reads back as it was logged, and a scene is paired with
// itself rather than with its neighbour. The capture runs themselves are the browser suite's business.

/** An RGBA buffer of `w * h` pixels of one colour. */
const flat = (w: number, h: number, [r, g, b, a = 255]: number[]) =>
  Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => [r, g, b, a][i % 4]);

test('arguments default to a d3d11 comparison against the fork point, ports a step apart', () => {
  const o = parseArgs([]);
  assert.equal(o.gl, 'd3d11');
  assert.equal(o.gain, 6);
  assert.equal(o.base, undefined);
  assert.equal(o.before, undefined);
  assert.deepEqual([o.port, o.basePort], [3000, 3001]);
  assert.deepEqual([parseArgs([], { GAME_TEST_PORT: '4100' }).port, parseArgs([], { GAME_TEST_PORT: '4100' }).basePort], [4100, 4101]);
});

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

test('captures pair by name, stills first, each strip in frame order, gaps kept', () => {
  assert.deepEqual(sequenceOf('strike-seq-07'), { group: 'strike-seq', frame: 7 });
  assert.deepEqual(sequenceOf('strike-contact'), { group: null, frame: null });
  const pairs = pairCaptures(
    ['strike-seq-10.png', 'strike-seq-02.png', 'dark-corridor.png', 'bridge-over-water.png', 'dash-seq-00.png'],
    ['bridge-over-water.png', 'strike-seq-02.png', 'strike-seq-10.png', 'strike-seq-31.png', 'dash-seq-00.png', 'new-scene.png'],
  );
  assert.deepEqual(pairs.map((p) => p.name), [
    'bridge-over-water', 'dark-corridor', 'new-scene', 'dash-seq-00', 'strike-seq-02', 'strike-seq-10', 'strike-seq-31',
  ]);
  const by = Object.fromEntries(pairs.map((p) => [p.name, [p.before, p.after]]));
  assert.deepEqual(by['dark-corridor'], [true, false]);
  assert.deepEqual(by['new-scene'], [false, true]);
  assert.deepEqual(by['strike-seq-31'], [false, true]);
  assert.deepEqual(by['bridge-over-water'], [true, true]);
});

test('identical frames diff to nothing', () => {
  const a = flat(4, 3, [10, 20, 30]);
  assert.deepEqual(diffPixels(a, a.slice(), 4), { width: 4, height: 3, total: 12, changed: 0, worst: 0, mean: 0, box: null });
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

test('the sheet escapes what it prints and shows a missing side as missing', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  const stats = { width: 10, height: 10, total: 100, changed: 25, worst: 40, mean: 3.5, box: [0, 0, 4, 4] as [number, number, number, number] };
  const row = (name: string, patch: Partial<Row>): Row => ({
    name, ...sequenceOf(name), before: true, after: true,
    beforeSrc: `before/${name}.png`, afterSrc: `after/${name}.png`, diffSrc: `diff/${name}.png`, stats, ...patch,
  });
  const sheet: Sheet = {
    created: '2026-09-22T00:00:00.000Z',
    command: 'npm run shots:compare -- --base HEAD',
    gain: 6,
    before: { label: 'previous', source: 'HEAD', sha: 'abcdef1234567890', gl: 'd3d11', seconds: 150, costs: { 'bridge-over-water': { calls: 400, triangles: 1000 } } },
    after: { label: 'current', source: 'working tree', dirty: true, gl: 'd3d11', seconds: 151, costs: { 'bridge-over-water': { calls: 402, triangles: 1000 } } },
    rows: [
      row('bridge-over-water', {}),
      row('<script>', { after: false, afterSrc: null, diffSrc: null, stats: null, note: 'only in the previous version' }),
      row('strike-seq-00', {}),
      row('strike-seq-01', { stats: { ...stats, changed: 0, worst: 0, mean: 0, box: null } }),
    ],
    reference: { crop: 'reference-crop.png', full: 'reference.png', region: [0, 0, 960, 515] },
    warnings: ['a & b'],
  };
  const html = renderSheet(sheet);
  assert.ok(!html.includes('<script>'), 'a capture name reached the page unescaped');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('no capture'), 'the missing side is not shown as missing');
  assert.ok(html.includes('25.00%'));
  assert.ok(html.includes('400 → 402 (+2)'));
  assert.ok(html.includes('strike-seq - 2 frames, 1/2 changed, most 25.00%'));
  assert.ok(html.includes('src="reference-crop.png"') && html.includes('href="reference.png"'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(!/https?:\/\//.test(html), 'the sheet must not fetch anything');
});
