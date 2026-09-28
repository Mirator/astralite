import assert from 'node:assert/strict';
import test from 'node:test';
import { creep, programsShare, SHADER_POST, SHADER_SCENE, VEIL_STAGES, VEIL_WEIGHTS, veilProgress } from '../app/dungeon-veil.ts';

test('a stalled measurement creeps forward, slower and slower, and never reaches the end of its step', () => {
  assert.equal(creep(0.4, 0.8, 0), 0.4);
  let last = 0.4;
  for (const ms of [100, 500, 1500, 5000, 60_000]) {
    const at = creep(0.4, 0.8, ms);
    assert.ok(at > last && at < 0.8, `${ms} ms`);
    last = at;
  }
  assert.ok(creep(0.4, 0.8, 1e9) <= 0.4 + 0.4 * 0.6 + 1e-12);
  // Nothing left to creep into, or a negative stall, is the measurement itself.
  assert.equal(creep(0.8, 0.8, 5000), 0.8);
  assert.equal(creep(0.9, 0.8, 5000), 0.9);
  assert.equal(creep(0.4, 0.8, -50), 0.4);
});

test('the stage weights cover the whole bar, one per stage', () => {
  assert.equal(VEIL_WEIGHTS.length, VEIL_STAGES.length);
  assert.ok(Math.abs(VEIL_WEIGHTS.reduce((sum, w) => sum + w, 0) - 1) < 1e-9);
});

test('the bar starts empty, ends full, and never runs backwards across a stage boundary', () => {
  assert.equal(veilProgress(0), 0);
  assert.equal(veilProgress(VEIL_STAGES.length), 1);
  let last = -1;
  for (let stage = 0; stage < VEIL_STAGES.length; stage++) {
    for (const fraction of [0, 0.25, 0.5, 1]) {
      const at = veilProgress(stage, fraction);
      assert.ok(at >= last - 1e-12, `stage ${stage} at ${fraction}`);
      last = at;
    }
    // The end of one stage is the start of the next.
    assert.ok(Math.abs(veilProgress(stage, 1) - veilProgress(stage + 1, 0)) < 1e-12);
  }
});

test('the shader stage is most of the bar, as it is most of a cold load', () => {
  assert.ok(veilProgress(4) - veilProgress(3) > 0.7);
});

test('junk in is a clamped bar, never NaN', () => {
  for (const value of [veilProgress(NaN), veilProgress(-1), veilProgress(2, NaN), veilProgress(2, 7), veilProgress(99)]) {
    assert.ok(value >= 0 && value <= 1);
  }
});

test('linked programs fill their slice of the shader stage and no more', () => {
  assert.equal(programsShare(0, 79, 0, SHADER_SCENE), 0);
  assert.equal(programsShare(79, 79, 0, SHADER_SCENE), SHADER_SCENE);
  assert.ok(Math.abs(programsShare(40, 80, SHADER_SCENE, SHADER_POST) - (SHADER_SCENE + SHADER_POST) / 2) < 1e-12);
  // An empty list has linked nothing yet; more ready than listed is still only the whole slice.
  assert.equal(programsShare(0, 0, SHADER_SCENE, SHADER_POST), SHADER_SCENE);
  assert.equal(programsShare(90, 80, 0, SHADER_SCENE), SHADER_SCENE);
});
