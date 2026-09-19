import assert from 'node:assert/strict';
import test from 'node:test';
import { BOONS } from '../app/dungeon-sim.ts';
import { DEFAULT_POLICY, FLOORS, simulateRun, type Policy } from '../scripts/balance/sim.ts';

// The harness is a measuring instrument, so what it owes the suite is not a balance assertion — those
// are for a human reading a batch — but proof that it is measuring the same game twice. A sim that
// drifts between runs, or that quietly stops reaching the stair, would report a tuning change that
// never happened.

const policy = (patch: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...patch });

// One batch, shared. Every run here is three full floors at 60Hz, so drawing a fresh batch per
// assertion costs the suite more than the coverage is worth.
const batch = Array.from({ length: 8 }, (_, i) => simulateRun(1 + i * 7919, policy()));

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

test('the knight reaches the stair rather than wandering until the timeout', () => {
  // Stuck runs are the harness failing, not the keep being hard: a navigator that walks into a wall
  // reports a death rate of zero for every weapon equally, which is worse than reporting nothing.
  // One in two hundred seeds strands the navigator in the measured baseline, so a single stuck run in
  // a batch of eight is the known rate rather than a regression; a batch that mostly fails to arrive is
  // the navigator being broken.
  const stuck = batch.filter(r => r.outcome === 'stuck').length;
  assert.ok(stuck <= 1, `expected at most one stuck run, got ${stuck} of ${batch.length}`);
});

test('a full descent reports one entry per floor and ends on the third', () => {
  const escape = batch.find(r => r.outcome === 'escaped');
  assert.ok(escape, 'the default policy should escape at least once in the batch');
  assert.equal(escape.floors.length, FLOORS);
  assert.equal(escape.floor, FLOORS);
  assert.ok(escape.floors.every(f => f.outcome === 'cleared'));
});

test('the boon draft is independent of how often the knight dodges', () => {
  // Both streams come off the seed, but through different generators. Sharing one would make the
  // dodge rate silently deal different cards, which is exactly the confound that made an early skill
  // sweep read backwards.
  const bold = simulateRun(0x7c0de, policy({ dodge: 1 }));
  const timid = simulateRun(0x7c0de, policy({ dodge: 0 }));
  assert.deepEqual(bold.boons, timid.boons);
});

test('the run carries the real rules: kills pay XP and rank the knight up', () => {
  const report = batch[0];
  assert.ok(report.kills > 0, 'a descent that kills nothing is not exercising combat');
  assert.ok(report.totalXp >= report.kills * 25, 'every felled body is worth at least XP_PER_ENEMY');
  assert.ok(report.rank > 1, 'a full floor should buy at least one rank');
  // A card only repeats once every boon has been taken at least once - draftBoons deals fresh ids first
  // and only reaches into the held pile when nothing untaken is left (dungeon-sim.ts:69-71). Faster
  // clears since the room shrink mean a run can now rank up past all six boons inside three floors, so
  // asserting the whole run's boons are unique (as this used to) is asserting a rank ceiling this seed no
  // longer respects; what the draft rule actually promises is checked directly instead.
  const seen = new Set<string>();
  for (const id of report.boons) {
    if (seen.has(id)) assert.equal(seen.size, BOONS.length, `boon ${id} repeated before every boon was taken once`);
    seen.add(id);
  }
});

test('damage is attributed to what dealt it', () => {
  const reports = Array.from({ length: 3 }, (_, i) => simulateRun(1 + i * 7919, policy({ dodge: 0 })));
  const dealt = reports.flatMap(r => r.floors).reduce((sum, f) => sum + f.damage.guard + f.damage.stalker + f.damage.warden + f.damage.hazard, 0);
  assert.ok(dealt > 0, 'a knight that never dodges must be taking hits');
});
