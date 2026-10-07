import assert from 'node:assert/strict';
import test from 'node:test';
import { createGovernor, governorStage, HITCH_CAP_MS, MAX_PIXEL_RATIO, observeFrame, qualityLadder, SLOW_MS, startPixelRatio, WINDOW_MS, type QualityStage } from '../app/dungeon-quality.ts';

const FULL: QualityStage = { ao: true, bloom: true, pixelRatio: MAX_PIXEL_RATIO };

/** Feeds `frames` intervals of `ms` and returns, for every step taken, the drawn time (ms) at which it came. */
const feed = (governor: ReturnType<typeof createGovernor>, ms: number, frames: number, clock = { t: 0 }) => {
  const steps: { at: number; stage: QualityStage }[] = [];
  for (let i = 0; i < frames; i++) { clock.t += ms; const stage = observeFrame(governor, ms); if (stage) steps.push({ at: clock.t, stage }); }
  return steps;
};

test('the ladder drops GTAO, then the pixel ratio, then bloom, and leaves out a rung that changes nothing', () => {
  assert.deepEqual(qualityLadder(FULL), [
    FULL,
    { ao: false, bloom: true, pixelRatio: MAX_PIXEL_RATIO },
    { ao: false, bloom: true, pixelRatio: 1 },
    { ao: false, bloom: false, pixelRatio: 1 },
  ]);
  // A screen of density 1 has no pixel ratio to give back, so that rung is not on its ladder.
  assert.deepEqual(qualityLadder({ ao: true, bloom: true, pixelRatio: 1 }), [
    { ao: true, bloom: true, pixelRatio: 1 }, { ao: false, bloom: true, pixelRatio: 1 }, { ao: false, bloom: false, pixelRatio: 1 },
  ]);
  // A software rasteriser starts reduced at density 1: there is nowhere to go, so the governor never steps.
  const reduced = { ao: false, bloom: false, pixelRatio: 1 };
  assert.deepEqual(qualityLadder(reduced), [reduced]);
  assert.deepEqual(feed(createGovernor(reduced), 500, 200), [], 'a governor with one rung stepped');
});

test('the starting pixel ratio is the screen\'s, capped at MAX_PIXEL_RATIO, and 1 for a nonsense density', () => {
  assert.deepEqual([3, 2, 1.5, 1, 0, -1, NaN, Infinity].map(startPixelRatio), [MAX_PIXEL_RATIO, MAX_PIXEL_RATIO, 1.5, 1, 1, 1, 1, 1]);
});

test('frames at 60 or 50 a second never step the picture down, however long they run', () => {
  for (const ms of [1000 / 120, 1000 / 60, 20]) {
    assert.ok(ms <= SLOW_MS, 'precondition: these frames are under the slow line');
    const governor = createGovernor(FULL);
    assert.deepEqual(feed(governor, ms, 60_000 / ms), [], `frames of ${ms.toFixed(1)} ms stepped down`);
    assert.deepEqual(governorStage(governor), FULL);
  }
});

test('frames at 30 a second step down one rung per two slow windows, skip the window after each step, and stop at the bottom', () => {
  const governor = createGovernor(FULL);
  const steps = feed(governor, 1000 / 30, 30 * 120);
  assert.deepEqual(steps.map(s => s.stage), qualityLadder(FULL).slice(1), 'it did not walk the ladder rung by rung to the bottom');
  // Two slow windows to the first step; a settling window and two more slow ones to each step after it.
  const [first, second] = steps.map(s => s.at);
  assert.ok(first >= 2 * WINDOW_MS && first < 3 * WINDOW_MS, `the first step came after ${first.toFixed(0)} ms, not after two windows`);
  assert.ok(second - first >= 3 * WINDOW_MS && second - first < 4 * WINDOW_MS, `the second step came ${(second - first).toFixed(0)} ms after the first, not three windows`);
  assert.deepEqual(governorStage(governor), { ao: false, bloom: false, pixelRatio: 1 });
});

test('one slow window, or one hitch however long, is not a step: it takes two slow windows in a row', () => {
  // Slow, then fast, then slow: the count starts again, so no step.
  const governor = createGovernor(FULL), clock = { t: 0 };
  const steps = [...feed(governor, 40, WINDOW_MS / 40, clock), ...feed(governor, 10, WINDOW_MS / 10, clock), ...feed(governor, 40, WINDOW_MS / 40, clock)];
  assert.deepEqual(steps, [], 'two slow windows that were not in a row stepped down');
  // Two two-second freezes back to back, landing just as a window opens (two shaders compiled on first use, say).
  // Each counts for only HITCH_CAP_MS, so the window fills with the fast frames that follow and the median is theirs.
  assert.ok(2 * HITCH_CAP_MS < WINDOW_MS, 'precondition: two hitches cannot fill a window between them');
  const hitched = createGovernor(FULL), tenMs = WINDOW_MS / 10;
  assert.deepEqual(feed(hitched, 10, tenMs), []);
  assert.deepEqual(hitched.samples, [], 'precondition: the fast frames closed their window, so the freezes open the next one');
  assert.deepEqual([...feed(hitched, 2000, 2), ...feed(hitched, 10, 3 * tenMs)], [], 'two freezes at a window\'s start stepped down');
  // But the same frames slow throughout do step, so the two cases above were not passing for some other reason.
  assert.equal(feed(createGovernor(FULL), 40, 3 * WINDOW_MS / 40).length, 1, 'precondition: steady 40 ms frames step down once in three windows');
});

test('an interval that is not a positive finite number is ignored', () => {
  const governor = createGovernor(FULL);
  for (const bad of [0, -16, NaN, Infinity, -Infinity]) assert.equal(observeFrame(governor, bad), null);
  assert.deepEqual([governor.samples.length, governor.spent], [0, 0], 'a bad interval was counted');
});
