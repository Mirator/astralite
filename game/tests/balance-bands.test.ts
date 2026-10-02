import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPolicy, compareBands, describeViolation, summarise, type Band } from '../scripts/balance/bands.ts';
import { runStart } from '../app/dungeon-meta.ts';
import type { FloorReport, RunReport } from '../scripts/balance/sim.ts';

// The gate is only as honest as its comparison: a band that silently passes a metric nobody measured is
// a gate that reads green while floor three goes unreached. None of this runs the sim - check.ts does
// that in CI - so these are hand-built summaries and reports.

const bands: Record<string, Band> = { escapeRate: { min: 80, max: 100 }, 'floor2.medianHpLeft': { min: 60, max: 90 } };

test('a value below or above its band is named with its metric, value and band', () => {
  const low = compareBands('weak', { escapeRate: 79.9, 'floor2.medianHpLeft': 75 }, bands);
  assert.deepEqual(low, [{ policy: 'weak', metric: 'escapeRate', measured: 79.9, band: bands.escapeRate, reason: 'below' }]);
  const high = compareBands('weak', { escapeRate: 90, 'floor2.medianHpLeft': 95 }, bands);
  assert.deepEqual(high.map(v => [v.metric, v.reason]), [['floor2.medianHpLeft', 'above']]);
  assert.match(describeViolation(high[0]), /weak: floor2\.medianHpLeft measured 95\.0, above band \[60, 90\]/);
});

test('a metric the summary lacks is a violation, not a pass', () => {
  const missing = compareBands('default', { escapeRate: 100 }, bands);
  assert.deepEqual(missing.map(v => [v.metric, v.reason, v.measured]), [['floor2.medianHpLeft', 'missing', null]]);
  assert.deepEqual(compareBands('default', { escapeRate: Number.NaN, 'floor2.medianHpLeft': 75 }, bands).map(v => v.reason), ['missing']);
});

test('a floor nobody reached leaves its metrics out of the summary', () => {
  const floor = (level: number, outcome: FloorReport['outcome'], hpAfter: number) => ({ level, outcome, hpAfter, maxHpAfter: 100 }) as FloorReport;
  const run = (outcome: RunReport['outcome'], seconds: number, floors: FloorReport[]) => ({ outcome, seconds, floors }) as RunReport;
  const summary = summarise([run('died', 100, [floor(1, 'cleared', 80), floor(2, 'died', 0)]), run('died', 60, [floor(1, 'died', 0)])]);
  assert.equal(summary.escapeRate, 0);
  assert.equal(summary.medianRunSeconds, 80);
  assert.equal(summary['floor1.deathRate'], 50);
  assert.equal(summary['floor1.medianHpLeft'], 80);
  assert.equal(summary['floor2.deathRate'], 100);
  assert.ok(!('floor2.medianHpLeft' in summary), 'no floor two was cleared, so there is no HP to report');
  assert.ok(!('floor3.deathRate' in summary), 'no run reached floor three');
});

test('a policy that says meta "max" starts every run on everything bought, and one that does not starts on nothing', () => {
  const plain = buildPolicy({ dodge: 0, reaction: 0.6 });
  assert.equal(plain.meta, undefined, 'a policy that never named a meta was dealt one');
  const maxed = buildPolicy({ dodge: 0, reaction: 0.6, meta: 'max' });
  assert.ok(maxed.meta, 'the meta flag never reached the policy');
  assert.deepEqual(runStart(maxed.meta), { maxHp: 130, strike: 8, draftSize: 4, defiance: 1, arm: 'tideblade' });
  // The flag adds a meta and nothing else: the knight is as weak as the plain one, and holds the arm the policy names.
  assert.deepEqual({ ...maxed, meta: undefined }, { ...plain, meta: undefined });
  assert.equal(buildPolicy({ special: true, weapon: 'maul', meta: 'max' }).weapon.id, 'maul');
  assert.throws(() => buildPolicy({ meta: 'most' as 'max' }), /unknown meta "most"/);
});
