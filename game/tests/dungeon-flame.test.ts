import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlameGeometry, FLAME_BASE_Y, flamePose, type FlameTheme } from '../app/dungeon-flame.ts';

const THEMES: FlameTheme[] = ['keep', 'ruins', 'flooded'];

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
