import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlameGeometry, emberOffset, FLAME_BASE_Y, flamePose, type FlameTheme } from '../app/dungeon-flame.ts';

const THEMES: FlameTheme[] = ['keep', 'ruins', 'flooded'];

test('every theme geometry is a small, finite, closed solid', () => {
  for (const theme of THEMES) {
    const geometry = createFlameGeometry(theme);
    const position = geometry.getAttribute('position');
    assert.equal(position.count % 3, 0, `${theme}: not a whole number of triangles`);
    const triangles = position.count / 3;
    assert.ok(triangles <= 8, `${theme}: ${triangles} triangles exceeds the 8-triangle cap`);
    for (let i = 0; i < position.count; i++) {
      assert.ok(
        Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i)),
        `${theme}: non-finite vertex at index ${i}`,
      );
    }
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    assert.ok(box.min.x < box.max.x && box.min.y < box.max.y && box.min.z < box.max.z, `${theme}: degenerate bounds`);
    geometry.dispose();
  }
});

test('the three themes are three different silhouettes, not one shape re-scaled', () => {
  const bounds = (theme: FlameTheme) => {
    const geometry = createFlameGeometry(theme);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = { width: box.max.x - box.min.x, height: box.max.y - box.min.y, depth: box.max.z - box.min.z };
    geometry.dispose();
    return size;
  };
  const keep = bounds('keep'), ruins = bounds('ruins'), flooded = bounds('flooded');
  // keep: one narrow, tall diamond.
  assert.ok(keep.height > keep.width, `keep is not taller than wide: ${JSON.stringify(keep)}`);
  assert.ok(keep.height > keep.depth, `keep is not taller than deep: ${JSON.stringify(keep)}`);
  // flooded: a low, broad bud - the opposite proportions of keep.
  assert.ok(flooded.width > flooded.height, `flooded is not wider than tall: ${JSON.stringify(flooded)}`);
  assert.ok(flooded.depth > flooded.height, `flooded is not deeper than tall: ${JSON.stringify(flooded)}`);
  assert.ok(flooded.width > keep.width, 'flooded should read wider than keep');
  assert.ok(keep.height > flooded.height, 'keep should read taller than flooded');
  assert.ok(ruins.width > keep.width, 'ruins, built from two side-by-side tongues, should read wider than keep');
});

test('ruins is two unequal tongues, not one symmetric flame', () => {
  const geometry = createFlameGeometry('ruins');
  const position = geometry.getAttribute('position');
  let baseY = Infinity;
  for (let i = 0; i < position.count; i++) baseY = Math.min(baseY, position.getY(i));
  // Group by which side of the shared base plane's centre each vertex sits on, and read off the
  // tallest point standing on each side - the two tongues' own apexes.
  let leftPeak = -Infinity, rightPeak = -Infinity, sawLeft = false, sawRight = false;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    if (x < 0) { sawLeft = true; leftPeak = Math.max(leftPeak, y); }
    else { sawRight = true; rightPeak = Math.max(rightPeak, y); }
  }
  assert.ok(sawLeft && sawRight, 'ruins geometry does not straddle both sides of its own centre');
  const heights = [leftPeak - baseY, rightPeak - baseY].sort((a, b) => b - a);
  const [tall, short] = heights;
  assert.ok(tall > 0 && short > 0, 'one tongue has no height at all');
  const ratio = short / tall;
  assert.ok(ratio > 0.45 && ratio < 0.85, `short tongue is ${(ratio * 100).toFixed(0)}% of the tall one, not roughly 65%`);
  geometry.dispose();
});

test('flamePose is pure: same time and phase always gives the same pose', () => {
  for (const theme of THEMES) {
    for (const [time, phase] of [[0, 0], [1.234, 0.7], [10, Math.PI]] as const) {
      assert.deepEqual(flamePose(theme, time, phase), flamePose(theme, time, phase), `${theme} drifted on a repeated call`);
    }
  }
});

test('flamePose does not allocate a typed array evaluating a pose', () => {
  const OriginalFloat32Array = globalThis.Float32Array;
  let allocations = 0;
  const spy = new Proxy(OriginalFloat32Array, {
    construct(target, args) { allocations++; return Reflect.construct(target, args); },
  }) as typeof Float32Array;
  (globalThis as { Float32Array: typeof Float32Array }).Float32Array = spy;
  try {
    for (let i = 0; i < 500; i++) flamePose(THEMES[i % 3], i * 0.033, i * 0.1);
  } finally {
    (globalThis as { Float32Array: typeof Float32Array }).Float32Array = OriginalFloat32Array;
  }
  assert.equal(allocations, 0, 'flamePose allocated a typed array; poses must be pure arithmetic');
});

test('phase desynchronises otherwise-identical sources', () => {
  for (const theme of THEMES) {
    const a = flamePose(theme, 3.1, 0);
    const b = flamePose(theme, 3.1, 2.4);
    assert.notDeepEqual(a, b, `${theme}: two different phases produced an identical pose at the same time`);
  }
});

test('sampled over ten seconds, no body ever sinks its base below the bowl minimum', () => {
  const MIN_Y = 1.03;
  for (const theme of THEMES) {
    const geometry = createFlameGeometry(theme);
    geometry.computeBoundingBox();
    const bottom = geometry.boundingBox!.min.y;
    const phase = theme === 'ruins' ? 1.7 : 0.4;
    for (let ms = 0; ms <= 10_000; ms += 50) {
      const t = ms / 1000;
      const pose = flamePose(theme, t, phase);
      const lowestY = FLAME_BASE_Y[theme] + pose.offset.y + bottom * pose.scale.y;
      assert.ok(
        lowestY >= MIN_Y,
        `${theme} at t=${t.toFixed(2)}s sinks to y=${lowestY.toFixed(4)}, below the ${MIN_Y} bowl minimum`,
      );
    }
    geometry.dispose();
  }
});

test('every theme keeps its own pose family: only the intended channel moves', () => {
  const t = 2.5, phase = 0.6, dt = 0.001;
  const at = (theme: FlameTheme, time: number) => flamePose(theme, time, phase);
  const keepA = at('keep', t), keepB = at('keep', t + dt);
  assert.notEqual(keepA.scale.y, keepB.scale.y, 'keep does not breathe over time');
  assert.equal(keepA.scale.x, 1, 'keep should not scale on x');
  assert.equal(keepA.rotationY, keepB.rotationY, 'keep should not spin continuously');

  const ruinsA = at('ruins', t), ruinsB = at('ruins', t + dt);
  assert.notEqual(ruinsA.scale.y, ruinsB.scale.y, 'ruins does not vary height over time');
  assert.notEqual(ruinsA.offset.x, ruinsB.offset.x, 'ruins tip should sway laterally over time');
  assert.equal(ruinsA.rotationY, ruinsB.rotationY, 'ruins should not spin continuously');

  const floodedA = at('flooded', t), floodedB = at('flooded', t + dt);
  assert.notEqual(floodedA.scale.x, floodedB.scale.x, 'flooded does not widen over time');
  assert.notEqual(floodedA.scale.y, floodedB.scale.y, 'flooded does not breathe in height over time');
  assert.equal(floodedA.offset.y, 0, 'flooded must not shoot vertically');
  assert.equal(floodedB.offset.y, 0, 'flooded must not shoot vertically');
});

test('embers keep six slots and stay bounded, whichever theme owns them', () => {
  for (const theme of THEMES) {
    for (let slot = 0; slot < 6; slot++) {
      for (const t of [0, 1.5, 7.25]) {
        const o = emberOffset(theme, t, 0.3, slot);
        assert.ok(Number.isFinite(o.dx) && Number.isFinite(o.dy) && Number.isFinite(o.dz), `${theme} slot ${slot}: non-finite ember offset`);
        assert.ok(Math.abs(o.dx) < 1 && Math.abs(o.dz) < 1, `${theme} slot ${slot}: ember wandered implausibly far sideways`);
      }
    }
  }
});


// Plan 014 round A: the billboard's flicker used to write `group.position.y = bob` and
// `group.scale.set(...)` straight onto the group its caller had just placed, so every brazier, sconce
// and lantern flame in the keep was drawn at floor level (y ~ 0) instead of where it was hung.
test('a flame billboard keeps the height and scale its caller gave it through every flicker update', async () => {
  const THREE = await import('three');
  const { makeFlameBillboard } = await import('../app/dungeon-flame-fx.ts');
  const flame = makeFlameBillboard(.6, 1.5, 1.3);
  flame.group.position.set(3, 1.06, -2);
  const colour = new THREE.Color(0xff8c3f);
  for (const t of [0, .37, 1.9, 12.4]) {
    flame.update(t, colour);
    assert.deepEqual(flame.group.position.toArray(), [3, 1.06, -2], `flicker at t=${t} moved the caller's group`);
    assert.deepEqual(flame.group.scale.toArray(), [1, 1, 1], `flicker at t=${t} rescaled the caller's group`);
  }
  const box = new THREE.Box3().setFromObject(flame.group);
  assert.ok(box.min.y > .95 && box.max.y > 2.2, `flame spans y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}, expected it to stand above its base`);
  flame.dispose();
});
