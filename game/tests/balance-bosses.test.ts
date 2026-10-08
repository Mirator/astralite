// Plan 021 Stage F: the per-boss duel report and D9's targets, as `npm run balance:bosses` computes them. The report is a measuring instrument, so what it owes the suite is proof that it measures what it
// says: the fairness rule is D9's (no pool boss kills the weak knight more than twice as often as another), the duel reads the policy it is told, and a target is judged against its own band.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOSS_POOL, FINAL_BOSS } from '../app/dungeon-bestiary.ts';
import { BOSS_FLOORS, duel, fairness, judge, runSummary, stairShares, TARGETS, type Duel, type RunSummary } from '../scripts/balance/bosses.ts';

const row = (kind: Duel['kind'], floor: number, policy: string, deaths: number, start = 1): Duel => ({ kind, floor, policy, start, duels: 30, deaths, deathRate: deaths / 30 * 100, seconds: 10, damage: 0, reserve: 0, hpLeft: 50, phaseChanges: 1, stuck: 0, wall: 1 });

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

test('pool fairness holds either bot to it (plan 022 D12), each at the start it was played from, and reads no other policy or start', () => {
  const floor = (policy: string, deaths: number[], start = 1) => BOSS_POOL.map((kind, i) => row(kind, 1, policy, deaths[i], start));
  const rows = [...floor('default', [6, 0, 1, 1]), ...floor('weak', [1, 1, 1, 1]), ...floor('default', [1, 1, 1, 1], 0.6), ...floor('weak', [9, 0, 0, 0], 0.6)];
  const unfair = fairness(rows, 1, 'default');
  assert.equal(unfair?.ok, false, 'the Pyre Mother-shaped spike (six deaths to one boss, none to the least) is the case D12 exists for: the default knight\'s deaths were not read');
  assert.deepEqual([unfair?.policy, unfair?.start, unfair?.mostDeaths, unfair?.leastDeaths], ['default', 1, 6, 0]);
  assert.equal(fairness(rows, 1, 'weak')?.ok, true, 'the default knight\'s deaths were read as the weak knight\'s');
  assert.equal(fairness(rows, 1, 'default', 0.6)?.ok, true, 'a duel from another start was counted in this one');
  assert.equal(fairness(rows, 1, 'weak', 0.6)?.ok, false, 'a start was not read');
  assert.equal(fairness(rows, 1, 'weak', 0.5), null, 'a start nobody played is not a fairness result');
});

test('every pool boss is fought on floors one and two and the Bone King on floor three', () => {
  assert.deepEqual(BOSS_FLOORS.filter(([, floor]) => floor === 3).map(([kind]) => kind), [FINAL_BOSS]);
  for (const kind of BOSS_POOL) for (const floor of [1, 2]) assert.ok(BOSS_FLOORS.some(([k, f]) => k === kind && f === floor), `${kind} is not fought on floor ${floor}`);
  assert.equal(BOSS_FLOORS.length, BOSS_POOL.length * 2 + 1);
});

test('a duel is played with the policy it is named for: the weak knight, who never dodges, takes more of the fight and dies more often than the default one', () => {
  // Starting on half his bar (plan 023 Stage D: the Captain no longer beats a weak knight from a full one, which is the point of its damage cut), the Captain is a duel the two knights tell apart.
  const careful = duel('captain', 1, 'default', 6, 1, 0.5), careless = duel('captain', 1, 'weak', 6, 1, 0.5);
  assert.equal(careful.duels, 6);
  assert.ok(careful.seconds > 0 && Number.isFinite(careful.seconds), 'the default knight never felled the Captain, so there is nothing to read');
  assert.ok(careful.hpLeft > 0 && careful.hpLeft <= 100, `HP left ${careful.hpLeft} is not a share of a bar`);
  assert.ok(careful.deathRate < 100, 'precondition: the default knight does not lose every duel, so the weak one losing more means something');
  assert.ok(careless.deathRate > careful.deathRate, `the weak knight lost ${careless.deathRate}% of the Captain's duels and the default one ${careful.deathRate}%: the duel is not reading the policy it was given`);
  assert.ok(careless.damage > careful.damage, 'the weak knight was not hurt more by the boss');
});

test('a duel can start on a share of the bar, and the knight who starts hurt dies more often (plan 022 --at-stair)', () => {
  const full = duel('captain', 1, 'default', 8), hurt = duel('captain', 1, 'default', 8, 1, 0.2);
  assert.deepEqual([full.start, hurt.start], [1, 0.2], 'the duel does not say what it started on');
  assert.ok(full.deathRate < 100, 'precondition: the default knight does not lose every duel from a full bar');
  assert.ok(hurt.deathRate > full.deathRate, `starting on 20% of his bar the default knight lost ${hurt.deathRate}% of the Captain's duels against ${full.deathRate}% from a full one: the start is not reaching the sim`);
});

test('the shares a duel starts on are what a policy walks into each stair hall with, one for each floor, and a share is never over a whole bar', () => {
  const shares = stairShares('weak', 6);
  assert.equal(shares.length, 3);
  assert.ok(shares.every(share => share > 0 && share <= 1), `${shares.join(", ")} is not a share of a bar`);
});

const summary = (policy: string, patch: Partial<RunSummary>): RunSummary => ({ policy, runs: 30, escapeRate: 50, deaths: 0, bossDeaths: 0, reserveDeaths: 0, bossShare: 60, fightSeconds: 40, beforeBoss: 50, stairHp: 60, runSeconds: 400, watchSeconds: 20, pearls: 100, byBoss: {}, killedBy: {}, ...patch });

test('each D7 target is judged against its own policy and its own band, inclusive at both ends (plan 023)', () => {
  const names = ['default', 'weak', 'weak-meta-max', 'special-crossbow'];
  const judged = (patch: Record<string, Partial<RunSummary>>) => judge(names.map(name => summary(name, patch[name] ?? {})));
  const met = (patch: Record<string, Partial<RunSummary>>, policy: string, label: string) => judged(patch).find(t => t.policy === policy && t.label === label)!.met;
  assert.equal(TARGETS.length, 10, 'precondition: D7 names ten whole-run targets for the bots');
  for (const [policy, label, key, lo, hi] of [
    ['default', 'escape %', 'escapeRate', 60, 85], ['default', 'deaths before the stair hall, %', 'beforeBoss', 25, 100], ['default', 'vitality entering floor 1 stair hall, %', 'stairHp', 50, 90],
    ['default', 'boss fight seconds (median)', 'fightSeconds', 25, 60], ['default', 'median pearls a run', 'pearls', 80, 130],
    ['weak', 'escape %', 'escapeRate', 5, 30], ['weak', 'vitality entering floor 1 stair hall, %', 'stairHp', 30, 70], ['weak', 'median pearls a run', 'pearls', 30, 55],
  ] as const) {
    assert.equal(met({ [policy]: { [key]: lo } }, policy, label), true, `${policy} ${label}: the lower edge is inside`);
    assert.equal(met({ [policy]: { [key]: hi } }, policy, label), true, `${policy} ${label}: the upper edge is inside`);
    assert.equal(met({ [policy]: { [key]: lo - 0.1 } }, policy, label), false, `${policy} ${label}: under the band`);
    if (hi < 100) assert.equal(met({ [policy]: { [key]: hi + 0.1 } }, policy, label), false, `${policy} ${label}: over the band`);
  }
  // One policy's number is never read against another's: the weak knight's 20% is in its own band and not the default's.
  assert.equal(met({ default: { escapeRate: 20 }, weak: { escapeRate: 20 } }, 'default', 'escape %'), false);
  // The margin is weak-meta-max over weak, in points: 15 is enough, 14 is not.
  assert.equal(met({ weak: { escapeRate: 20 }, 'weak-meta-max': { escapeRate: 35 } }, 'weak-meta-max', 'escape points over weak'), true);
  assert.equal(met({ weak: { escapeRate: 20 }, 'weak-meta-max': { escapeRate: 34 } }, 'weak-meta-max', 'escape points over weak'), false);
  // D3: the crossbow special escapes at least half as often as the default knight: 45 of a default 90 is enough, 44 is not.
  const crossbow = 'escape points over half the default knight\'s';
  assert.equal(met({ default: { escapeRate: 90 }, 'special-crossbow': { escapeRate: 45 } }, 'special-crossbow', crossbow), true);
  assert.equal(met({ default: { escapeRate: 90 }, 'special-crossbow': { escapeRate: 44 } }, 'special-crossbow', crossbow), false);
});

test('a run summary counts the bosses a policy met and what killed it', () => {
  const s = runSummary('weak', 3);
  assert.equal(s.runs, 3);
  assert.ok(Object.keys(s.byBoss).length > 0 && Object.values(s.byBoss).reduce((n, b) => n + b.floors, 0) >= 3, 'three runs met fewer than three bosses');
  assert.equal(s.deaths, Object.values(s.killedBy).reduce((a, b) => a + b, 0), 'what killed the knight does not add up to how many died');
  assert.ok(s.bossDeaths <= s.deaths);
});

// Plan 022 D12, on the shipped numbers: the default knight, from a full bar, is killed by no pool boss more than twice as often as another, on either floor, and plan 024 holds the skilled knight (dodge 0.95) to it too. It failed from plan 024 Stage A (the
// default knight rolls its dodge once a tell, 80%, instead of dodging every tell) until Stage E: the Pyre Mother, whose fan and rings are the one pool boss that out-paces a dash, killed the default knight 3 times in 30 on floor one and 6 on floor two and the skilled one
// 1 and 4, against none for the Captain, the Hound and the Bastion (measured 2026-10-04, 30 duels each, `balance:bosses -- --duels`). Stage E cut her damage (volleys 10 and 8 to 8 and 6, the sweep 13 to 10, a ring's fire 6 to 4 a tick) and this test is the original assertion again.
// It cannot be passed by taking the Mother's teeth: she must still be the hardest-hitting of the four (her median damage to a knight is asserted above every other pool boss's on the same floor), so the fairness is of how often she kills, not of whether she hurts.
test('no pool boss kills the default knight or the skilled knight more than twice as often as another, from a full bar, on either floor, and the Pyre Mother still hurts most (plan 022 D12, restored by plan 024 Stage E)', () => {
  for (const policy of ['default', 'skilled']) {
    const duels = BOSS_FLOORS.filter(([kind, floor]) => floor <= 2 && BOSS_POOL.includes(kind)).map(([kind, floor]) => duel(kind, floor, policy, 30));
    assert.equal(duels.length, 8, `${policy}: precondition: four pool bosses on two floors`);
    assert.ok(duels.every(d => d.duels === 30 && d.damage > 0), `${policy}: precondition: every duel was fought and the boss hurt him`);
    for (const floor of [1, 2]) {
      const result = fairness(duels, floor, policy)!;
      assert.ok(result.ok, `${policy}, floor ${floor}: died to ${result.most} ${result.mostDeaths} times and to ${result.least} ${result.leastDeaths}: more than twice as often (the fewest floored at one)`);
      const own = duels.filter(d => d.floor === floor), mother = own.find(d => d.kind === 'mother')!;
      assert.ok(own.filter(d => d.kind !== 'mother').every(d => mother.damage > d.damage), `${policy}, floor ${floor}: the Pyre Mother took ${mother.damage} off him, and another pool boss took more (${own.map(d => `${d.kind} ${d.damage}`).join(', ')}): fairness by taking her teeth is not the fix`);
    }
  }
});

// Plan 023 D7: pool fairness holds for the weak knight too, from the vitality it walks into the stair hall with (a median 89% and 86% of its bar on floors one and two, 30 runs, Stage D). Before plan 023 Stage D the Captain, the Hound and the Bastion killed it in every
// duel from a full bar and the Pyre Mother in none; their damage was cut by about 45% (x0.65 and then x0.85 to 0.88 after the Hound still killed it from the 86% it walks into floor two with, rounded to whole numbers) so that none of the four kills it more than twice as often as another.
test('no pool boss kills the weak knight more than twice as often as another, from the lowest bar it walks into a pool stair hall with (plan 023 D7, the shipped numbers)', () => {
  const START = 0.86;
  const duels = BOSS_FLOORS.filter(([kind, floor]) => floor <= 2 && BOSS_POOL.includes(kind)).map(([kind, floor]) => duel(kind, floor, 'weak', 30, 1, START));
  assert.equal(duels.length, 8, 'precondition: four pool bosses on two floors');
  assert.ok(duels.every(d => d.duels === 30 && d.damage > 0 && d.start === START), 'precondition: every duel was fought from 86% and the boss hurt him');
  for (const floor of [1, 2]) {
    const result = fairness(duels, floor, 'weak', START)!;
    assert.ok(result.ok, `floor ${floor}: the weak knight died to ${result.most} ${result.mostDeaths} times and to ${result.least} ${result.leastDeaths}: more than twice as often (the fewest floored at one)`);
  }
});
