// Plan 021 Stage F: the per-boss duel report and D9's targets, as `npm run balance:bosses` computes them. The report is a measuring instrument, so what it owes the suite is proof that it measures what it
// says: the fairness rule is D9's (no pool boss kills the weak knight more than twice as often as another), the duel reads the policy it is told, and a target is judged against its own band.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOSS_POOL, FINAL_BOSS } from '../app/dungeon-bestiary.ts';
import { BOSS_FLOORS, duel, fairness, judge, runSummary, TARGETS, type Duel, type RunSummary } from '../scripts/balance/bosses.ts';

const row = (kind: Duel['kind'], floor: number, policy: string, deaths: number): Duel => ({ kind, floor, policy, duels: 30, deaths, deathRate: deaths / 30 * 100, seconds: 10, damage: 0, reserve: 0, hpLeft: 50, phaseChanges: 1, stuck: 0 });

test('pool fairness is D9\'s: the weak knight\'s deaths to the worst boss are at most twice those to the best, and the fewest is floored at one death', () => {
  const floor1 = (deaths: number[]) => BOSS_POOL.map((kind, i) => row(kind, 1, 'weak', deaths[i]));
  assert.equal(fairness(floor1([4, 2, 3, 2]), 1)?.ok, true, 'four deaths against two is exactly twice, which is allowed');
  assert.equal(fairness(floor1([5, 2, 3, 2]), 1)?.ok, false, 'five deaths against two is more than twice');
  assert.equal(fairness(floor1([2, 0, 1, 1]), 1)?.ok, true, 'two deaths against none is one lucky pair at thirty duels, not a boss twice as deadly: the fewest is floored at one');
  assert.equal(fairness(floor1([3, 0, 1, 1]), 1)?.ok, false, 'three deaths against none is more than twice one');
  const found = fairness(floor1([5, 2, 3, 1]), 1)!;
  assert.deepEqual([found.most, found.mostDeaths, found.least, found.leastDeaths], [BOSS_POOL[0], 5, BOSS_POOL[3], 1], 'the report does not name the deadliest and the gentlest');
});

test('pool fairness reads the weak knight on the floor it is asked about, and nothing else', () => {
  const rows = [...BOSS_POOL.map((kind, i) => row(kind, 1, 'weak', [1, 1, 1, 1][i])), ...BOSS_POOL.map((kind, i) => row(kind, 1, 'default', [9, 0, 0, 0][i])), ...BOSS_POOL.map((kind, i) => row(kind, 2, 'weak', [9, 0, 0, 0][i])), row(FINAL_BOSS, 1, 'weak', 9)];
  assert.equal(fairness(rows, 1)?.ok, true, 'the default knight\'s deaths, another floor\'s, or the last floor\'s boss were counted');
  assert.equal(fairness(rows, 2)?.ok, false, 'precondition: floor two, where one boss kills the weak knight nine times to none, is unfair');
  assert.equal(fairness(rows, 3), null, 'the last floor has one boss, so there is nothing to be fair between');
});

test('every pool boss is fought on floors one and two and the Bone King on floor three', () => {
  assert.deepEqual(BOSS_FLOORS.filter(([, floor]) => floor === 3).map(([kind]) => kind), [FINAL_BOSS]);
  for (const kind of BOSS_POOL) for (const floor of [1, 2]) assert.ok(BOSS_FLOORS.some(([k, f]) => k === kind && f === floor), `${kind} is not fought on floor ${floor}`);
  assert.equal(BOSS_FLOORS.length, BOSS_POOL.length * 2 + 1);
});

test('a duel is played with the policy it is named for: the weak knight, who never dodges, takes more of the fight and dies more often than the default one', () => {
  const careful = duel('captain', 1, 'default', 6), careless = duel('captain', 1, 'weak', 6);
  assert.equal(careful.duels, 6);
  assert.ok(careful.seconds > 0 && Number.isFinite(careful.seconds), 'the default knight never felled the Captain, so there is nothing to read');
  assert.ok(careful.hpLeft > 0 && careful.hpLeft <= 100, `HP left ${careful.hpLeft} is not a share of a bar`);
  assert.ok(careful.deathRate < 100, 'precondition: the default knight does not lose every duel, so the weak one losing more means something');
  assert.ok(careless.deathRate > careful.deathRate, `the weak knight lost ${careless.deathRate}% of the Captain's duels and the default one ${careful.deathRate}%: the duel is not reading the policy it was given`);
  assert.ok(careless.damage > careful.damage, 'the weak knight was not hurt more by the boss');
});

const summary = (policy: string, patch: Partial<RunSummary>): RunSummary => ({ policy, runs: 30, escapeRate: 50, deaths: 0, bossDeaths: 0, reserveDeaths: 0, bossShare: 60, fightSeconds: 40, byBoss: {}, killedBy: {}, ...patch });

test('each D9 target is judged against its own policy and its own band, inclusive at both ends', () => {
  const judged = (patch: Record<string, Partial<RunSummary>>) => judge(['default', 'weak', 'weak-meta-max'].map(name => summary(name, patch[name] ?? {})));
  const met = (patch: Record<string, Partial<RunSummary>>, policy: string, label: string) => judged(patch).find(t => t.policy === policy && t.label === label)!.met;
  assert.equal(TARGETS.length, 5, 'precondition: D9 names five whole-run targets');
  assert.equal(met({ default: { escapeRate: 75 } }, 'default', 'escape %'), true);
  assert.equal(met({ default: { escapeRate: 90 } }, 'default', 'escape %'), true);
  assert.equal(met({ default: { escapeRate: 74.9 } }, 'default', 'escape %'), false, 'a default knight escaping 74.9% is under D9\'s 75');
  assert.equal(met({ default: { escapeRate: 91 } }, 'default', 'escape %'), false, 'a default knight escaping 91% is over D9\'s 90');
  assert.equal(met({ weak: { escapeRate: 55 } }, 'weak', 'escape %'), true);
  assert.equal(met({ weak: { escapeRate: 56 } }, 'weak', 'escape %'), false);
  assert.equal(met({ 'weak-meta-max': { escapeRate: 55 } }, 'weak-meta-max', 'escape %'), true);
  assert.equal(met({ 'weak-meta-max': { escapeRate: 81 } }, 'weak-meta-max', 'escape %'), false);
  // The weak knight's 50% is in its own band and not the default's: one policy's number is never read against another's.
  assert.equal(met({ default: { escapeRate: 50 }, weak: { escapeRate: 50 } }, 'default', 'escape %'), false);
  assert.equal(met({ default: { fightSeconds: 24 } }, 'default', 'boss fight seconds (median)'), false);
  assert.equal(met({ default: { fightSeconds: 60 } }, 'default', 'boss fight seconds (median)'), true);
  assert.equal(met({ default: { bossShare: 49 } }, 'default', 'deaths to a boss, %'), false);
});

test('a run summary counts the bosses a policy met and what killed it', () => {
  const s = runSummary('weak', 3);
  assert.equal(s.runs, 3);
  assert.ok(Object.keys(s.byBoss).length > 0 && Object.values(s.byBoss).reduce((n, b) => n + b.floors, 0) >= 3, 'three runs met fewer than three bosses');
  assert.equal(s.deaths, Object.values(s.killedBy).reduce((a, b) => a + b, 0), 'what killed the knight does not add up to how many died');
  assert.ok(s.bossDeaths <= s.deaths);
});
