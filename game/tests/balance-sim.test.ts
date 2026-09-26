import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_POLICY, simulateRun, type Policy } from '../scripts/balance/sim.ts';

// The harness is a measuring instrument, so what it owes the suite is not a balance assertion — those
// are for a human reading a batch — but proof that it is measuring the same game twice. A sim that
// drifts between runs, or that quietly stops reaching the stair, would report a tuning change that
// never happened.

const policy = (patch: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...patch });

test('the same seed and policy replay exactly', () => {
  const a = simulateRun(0x51ed, policy());
  const b = simulateRun(0x51ed, policy());
  assert.deepEqual(a, b, 'a seeded run must be reproducible or a batch cannot be compared to a batch');
});

test('different seeds lay different keeps', () => {
  const a = simulateRun(0x1, policy());
  const b = simulateRun(0x2, policy());
  assert.notDeepEqual(a.floors.map(f => f.spawns), b.floors.map(f => f.spawns));
});

test('the boon draft is independent of how often the knight dodges', () => {
  // Both streams come off the seed, but through different generators. Sharing one would make the
  // dodge rate silently deal different cards, which is exactly the confound that made an early skill
  // sweep read backwards.
  const bold = simulateRun(0x7c0de, policy({ dodge: 1 }));
  const timid = simulateRun(0x7c0de, policy({ dodge: 0 }));
  assert.deepEqual(bold.boons, timid.boons);
});

test('the harness flies archers\' bolts and bills what lands to the archer, from floor two on', () => {
  // A knight that never dodges, so a bolt that is loosed and flies true has nothing between it and him.
  const runs = [1, 2, 3, 4].map(seed => simulateRun(seed * 7919, policy({ dodge: 0 })));
  const deeper = runs.flatMap(run => run.floors.filter(floor => floor.level > 1));
  assert.ok(deeper.length >= runs.length, `the runs barely left floor one (${deeper.length} deeper floors), so this measured nothing`);
  const onFloorOne = runs.reduce((sum, run) => sum + run.floors[0].damage.archer, 0);
  const deeperArcher = deeper.reduce((sum, floor) => sum + floor.damage.archer, 0);
  assert.equal(onFloorOne, 0, 'something billed archer damage on a floor with no archers');
  assert.ok(deeperArcher > 0, 'archers on floors two and three never landed a bolt in the harness');
});
