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
