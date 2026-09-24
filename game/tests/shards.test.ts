import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDurations, planShards } from '../scripts/shards/lib.ts';

// Each CI shard computes its own share independently, so a spec that no shard claims is silently never
// run on a pull request, and one that two claim runs twice. These pin the split's contract.

const FILES = ['a11y.spec.ts', 'aim.spec.ts', 'chain.spec.ts', 'footsteps.spec.ts', 'gameplay.spec.ts', 'new.spec.ts', 'sprint.spec.ts'];
const DURATIONS = { 'a11y.spec.ts': 80, 'aim.spec.ts': 40, 'chain.spec.ts': 25, 'footsteps.spec.ts': 270, 'gameplay.spec.ts': 60, 'sprint.spec.ts': 3 };

test('every spec lands on exactly one shard, whatever the shard count', () => {
  for (const total of [1, 2, 3, 6, 10]) {
    const plan = planShards(FILES, DURATIONS, total);
    assert.equal(plan.length, total);
    assert.deepEqual(plan.flat().sort(), [...FILES].sort(), `${total} shards dropped or duplicated a spec`);
  }
});

test('the heaviest spec gets a shard to itself before anything else is doubled up', () => {
  const plan = planShards(FILES, DURATIONS, 3);
  const withFootsteps = plan.find((bin) => bin.includes('footsteps.spec.ts'))!;
  assert.deepEqual(withFootsteps, ['footsteps.spec.ts'], 'a 270 s spec shared its shard while two others held 208 s between them');
});

test('the split is the same however the file list arrives', () => {
  const forward = planShards(FILES, DURATIONS, 3);
  assert.deepEqual(planShards([...FILES].reverse(), DURATIONS, 3), forward);
  assert.deepEqual(planShards([...FILES, 'aim.spec.ts'], DURATIONS, 3), forward, 'a repeated file changed the split');
});

test('a spec with no measured duration weighs the median rather than nothing', () => {
  // With a weight of 0 the new spec would pile onto whichever shard happened to be lightest last;
  // weighing the median (60 s here) sends it to a genuinely light shard instead.
  const plan = planShards(['new.spec.ts', 'x.spec.ts', 'y.spec.ts'], { 'x.spec.ts': 60, 'y.spec.ts': 60, 'z.spec.ts': 60 }, 3);
  assert.equal(plan.filter((bin) => bin.length === 1).length, 3, 'the unmeasured spec was treated as free');
});

test('a shard count that is not a positive whole number is refused', () => {
  for (const total of [0, -1, 1.5, Number.NaN]) assert.throws(() => planShards(FILES, DURATIONS, total));
});

test('durations are summed per spec from the lines a CI job log holds, in any unit', () => {
  const log = [
    '2026-09-24T15:05:30.1Z   ✓   1 [chromium] › tests/browser/aim.spec.ts:18:1 › a cursor aims the swing (22.0s)',
    '2026-09-24T15:05:31.1Z   ✓   2 [chromium] › tests/browser/aim.spec.ts:49:1 › striking from the keyboard (3.7s)',
    '2026-09-24T15:05:40.1Z   ✓   3 [chromium] › tests/browser/occlusion.spec.ts:118:3 › local actor cutaway › an occluded actor (4.0m)',
    '2026-09-24T15:05:41.1Z   ✘   4 [chromium] › tests/browser/a11y.spec.ts:102:3 › on a phone › inert controls (27.8s)',
    '  ✓  5 [chromium] › tests\\browser\\sprint.spec.ts:7:1 › stride (850ms)\r',
    '  -   6 [chromium] › tests/browser/occlusion.spec.ts:174:3 › a windup enemy is also cut',
    'BUDGET flooded-hall calls=304/439 triangles=190040/596454',
  ].join('\n');
  assert.deepEqual(parseDurations(log), { 'aim.spec.ts': 25.7, 'occlusion.spec.ts': 240, 'a11y.spec.ts': 27.8, 'sprint.spec.ts': 0.9 });
});
