import assert from 'node:assert/strict';
import test from 'node:test';
import { VEIL_STAGES, veilProgress } from '../app/dungeon-veil.ts';

test('the bar fills to the step the counter names, so 3 / 5 is 60%', () => {
  const total = VEIL_STAGES.length;
  for (let finished = 0; finished < total; finished++) {
    const shown = veilProgress(finished);
    assert.equal(shown.step, finished + 1);
    assert.equal(shown.total, total);
    assert.equal(shown.label, VEIL_STAGES[finished]);
    assert.equal(shown.fill, shown.step / shown.total);
  }
  assert.equal(veilProgress(2).fill, 0.6);
});

test('it never runs past the last step or before the first', () => {
  assert.deepEqual(veilProgress(VEIL_STAGES.length), veilProgress(VEIL_STAGES.length - 1));
  assert.equal(veilProgress(VEIL_STAGES.length).fill, 1);
  assert.deepEqual(veilProgress(-1), veilProgress(0));
});
