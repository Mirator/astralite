// What each boss does to a knight, one boss at a time, and what the bosses together do to a run (plan 021, Stage F and D9).
//
//   npm run balance:bosses                  both reports
//   npm run balance:bosses -- --duels       the per-boss duel report only (seconds)
//   npm run balance:bosses -- --runs        D9's whole-run table only (about three minutes: 30 runs of three policies)
//   npm run balance:bosses -- --seeds 60    a tighter duel sample (30 a boss a floor by default, D9's)
//   npm run balance:bosses -- --duels --at-stair   the duels again, each knight starting on the vitality its policy walks into that floor's stair hall with (plan 022)
//   npm run balance:bosses -- --json        machine-readable
//
// The duel report is `simulateArena`: a fresh knight (no boons, no earlier floors, a full bar) against the boss and its reserve alone,
// on each floor the boss can be dealt to: the four pool bosses on floors one and two, the Bone King on floor three. Per boss, floor and
// policy it prints the share of duels the knight lost, the median seconds from the boss noticing him to its fall, the vitality the boss
// took off him in a median duel (and, for the Bone King, what his reserve did: the rattlers he called), and the vitality he had left when it fell (before any top-up, which an arena pays none of anyway).
// D9's pool-fairness check is read off it: on a floor, no pool boss may kill the weak knight more than twice as often as another. Plan 022 D12 holds the default knight to it too.
// Plan 022: a fresh knight is too blunt (the keep no longer hands him to the stair hall full: plan 021 found the full-vitality duel too blunt to compare bosses), so `--at-stair` plays every duel a second time with each policy
// starting on the median vitality it entered that floor's stair hall with in the whole runs `balance:check` plays (`stairShares`), and prints both.
// At 30 duels one death is 3.3 points and cannot be told from luck, so the comparison floors the fewest deaths at one.
//
// The run report is D13's targets (plan 022; D9's, plan 021, before it) measured on the same 30 runs `balance:check` plays (bands.json's `runs` and `firstSeed`, and its own
// definitions of the default, weak and weak-meta-max knights): escape rate, how many of the deaths came before the stair hall and how many a boss dealt, the vitality he walked into floor one's stair hall with, how long a run and a
// watch fight last, how long the default knight's boss fights last, and which boss accounts for how much of the dying (plan 021's 70% stop rule). Bot numbers, not human ones.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BESTIARY, BOSS_POOL, FINAL_BOSS, type EnemyKind } from '../../app/dungeon-bestiary.ts';
import { buildPolicy, type PolicySpec } from './bands.ts';
import { simulateArena, simulateRun, type FloorReport, type Policy, type RunReport } from './sim.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: number) => {
  const at = args.indexOf(`--${name}`);
  const parsed = at < 0 ? NaN : Number(args[at + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const fixed = (n: number, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '-';
const pct = (part: number, whole: number) => whole ? part / whole * 100 : NaN;

type Expected = { runs: number; firstSeed: number; policies: Record<string, { policy: PolicySpec }> };
const expected = JSON.parse(readFileSync(new URL('./bands.json', import.meta.url), 'utf8')) as Expected;
const policyOf = (name: string): Policy => buildPolicy(expected.policies[name].policy);

// ---------------------------------------------------------------------------------------------------- duels

/** `start` is the share of his maximum vitality the knight began the duel with: 1 for a fresh one, a policy's median vitality entering the stair hall for `--at-stair` (plan 022). */
export type Duel = { kind: EnemyKind; floor: number; policy: string; start: number; duels: number; deaths: number; deathRate: number; seconds: number; damage: number; reserve: number; hpLeft: number; phaseChanges: number; stuck: number };

/** The floors each boss can be dealt to, in the order the report prints them. */
export const BOSS_FLOORS: readonly (readonly [EnemyKind, number])[] = [...BOSS_POOL.flatMap(kind => [[kind, 1], [kind, 2]] as const), [FINAL_BOSS, 3]];

export function duel(kind: EnemyKind, floor: number, policyName: string, seeds: number, firstSeed = expected.firstSeed, start = 1): Duel {
  const policy = policyOf(policyName);
  const reports: FloorReport[] = Array.from({ length: seeds }, (_, i) => simulateArena(firstSeed + i * 7919, floor, [kind], policy, start));
  const fought = reports.filter(r => r.outcome !== 'stuck');
  const felled = reports.filter(r => r.bossHpLeft !== null);
  return {
    kind, floor, policy: policyName, start, duels: reports.length,
    deaths: reports.filter(r => r.outcome === 'died').length, deathRate: pct(reports.filter(r => r.outcome === 'died').length, reports.length),
    seconds: median(felled.map(r => r.bossSeconds)),
    damage: median(fought.map(r => r.bossDamage)),
    reserve: median(fought.map(r => r.damage.rattler)),
    hpLeft: median(felled.map(r => r.bossHpLeft as number)),
    phaseChanges: median(reports.map(r => r.phaseChanges)),
    stuck: reports.filter(r => r.outcome === 'stuck').length,
  };
}

/**
 * D9's pool fairness, plan 022 D12's for either bot: per floor, the pool boss that kills a policy most against the one that kills it least, over that policy's duels at that start. Ok when the most is at most twice the least,
 * the least floored at one death. `policy` is the weak knight unless asked (D9's), `start` the full bar unless asked.
 */
export function fairness(duels: readonly Duel[], floor: number, policy = 'weak', start = 1) {
  const own = duels.filter(d => d.policy === policy && d.floor === floor && d.start === start && BOSS_POOL.includes(d.kind));
  if (!own.length) return null;
  const most = own.reduce((a, b) => b.deaths > a.deaths ? b : a), least = own.reduce((a, b) => b.deaths < a.deaths ? b : a);
  return { floor, policy, start, most: most.kind, mostDeaths: most.deaths, least: least.kind, leastDeaths: least.deaths, ok: most.deaths <= 2 * Math.max(1, least.deaths) };
}

/**
 * Plan 022: the median share of his maximum vitality each policy walks into each floor's stair hall with, over `runs` whole runs (the ones `balance:check` plays): what a duel is started on under `--at-stair`.
 * A floor no run reached the stair hall on reads full.
 */
export function stairShares(policyName: string, runs: number): number[] {
  const policy = policyOf(policyName);
  const floors = Array.from({ length: runs }, (_, i) => simulateRun(expected.firstSeed + i * 7919, policy)).flatMap(r => r.floors);
  return [1, 2, 3].map(level => { const seen = floors.filter(f => f.level === level && typeof f.hpAtStair === 'number').map(f => f.hpAtStair as number); return seen.length ? median(seen) / 100 : 1; });
}

function duelReport(seeds: number, atStair: boolean, runs: number) {
  const policies = ['default', 'weak'];
  const shares = Object.fromEntries(policies.map(name => [name, atStair ? stairShares(name, runs) : [1, 1, 1]])) as Record<string, number[]>;
  const duels = BOSS_FLOORS.flatMap(([kind, floor]) => policies.flatMap(policy => [...new Set([1, shares[policy][floor - 1]])].map(start => duel(kind, floor, policy, seeds, expected.firstSeed, start))));
  const starts = [...new Set(duels.map(d => `${d.policy}:${d.floor}:${d.start}`))].map(key => { const [policy, floor, start] = key.split(':'); return { policy, floor: Number(floor), start: Number(start) }; });
  return { duels, shares, fairness: starts.filter(s => s.floor <= 2).map(s => fairness(duels, s.floor, s.policy, s.start)) };
}

function printDuels(report: ReturnType<typeof duelReport>, seeds: number) {
  console.log(`\n  per-boss duels: ${seeds} seeds a boss, a floor and a policy, a knight in the arena${Object.values(report.shares).some(s => s.some(x => x !== 1)) ? ` (start is the share of his bar he begins on; --at-stair: ${Object.entries(report.shares).map(([p, s]) => `${p} ${s.map(x => `${(x * 100).toFixed(0)}%`).join('/')}`).join(', ')})` : ''}\n`);
  console.log('  boss      floor   policy    start   died    boss seconds   boss damage   reserve damage   HP left when it fell   phase changes');
  for (const d of report.duels) console.log(`  ${d.kind.padEnd(8)}  ${String(d.floor).padStart(5)}   ${d.policy.padEnd(7)}  ${`${fixed(d.start * 100, 0)}%`.padStart(5)}   ${`${fixed(d.deathRate, 0)}%`.padStart(5)}   ${fixed(d.seconds).padStart(12)}   ${fixed(d.damage, 0).padStart(11)}   ${fixed(d.reserve, 0).padStart(14)}   ${`${fixed(d.hpLeft, 0)}%`.padStart(20)}   ${fixed(d.phaseChanges, 0).padStart(13)}${d.stuck ? `   (${d.stuck} stuck)` : ''}`);
  console.log('');
  for (const f of report.fairness) if (f) console.log(`  pool fairness, floor ${f.floor}, ${f.policy} knight starting on ${fixed(f.start * 100, 0)}%: died to ${f.most} ${f.mostDeaths} times and to ${f.least} ${f.leastDeaths} (${f.ok ? 'met' : 'NOT met'}: at most twice as often, the fewest floored at one)`);
  console.log('');
}

// ----------------------------------------------------------------------------------------------- whole runs

const bossKinds = new Set<EnemyKind>(BOSS_POOL.concat(FINAL_BOSS));
export type RunSummary = {
  policy: string; runs: number; escapeRate: number; deaths: number; bossDeaths: number; reserveDeaths: number; bossShare: number; fightSeconds: number;
  /** Plan 022 (D13): the share of the deaths that came before the stair hall, the median vitality (percent) he walked into floor one's stair hall with, the median run and the median watch fight, in seconds. */
  beforeBoss: number; stairHp: number; runSeconds: number; watchSeconds: number;
  byBoss: Record<string, { floors: number; deaths: number; seconds: number; damage: number; hpLeft: number }>; killedBy: Record<string, number>;
};

export function runSummary(policyName: string, runs: number): RunSummary {
  const policy = policyOf(policyName);
  const reports: RunReport[] = Array.from({ length: runs }, (_, i) => simulateRun(expected.firstSeed + i * 7919, policy));
  const dead = reports.filter(r => r.outcome === 'died');
  const killedBy: Record<string, number> = {};
  for (const r of dead) killedBy[r.cause ?? '?'] = (killedBy[r.cause ?? '?'] ?? 0) + 1;
  const floors = reports.flatMap(r => r.floors).filter(f => f.bossKind !== null);
  const byBoss: RunSummary['byBoss'] = {};
  for (const kind of bossKinds) {
    const own = floors.filter(f => f.bossKind === kind);
    if (!own.length) continue;
    const felled = own.filter(f => f.bossHpLeft !== null);
    byBoss[kind] = { floors: own.length, deaths: own.filter(f => f.bossDeaths > 0).length, seconds: median(felled.map(f => f.bossSeconds)), damage: median(own.map(f => f.bossDamage)), hpLeft: median(felled.map(f => f.bossHpLeft as number)) };
  }
  const bossDeaths = dead.filter(r => r.cause !== null && r.cause !== 'hazard' && BESTIARY[r.cause].boss).length;
  // A rattler the Bone King called, on his floor, is his: counted apart so the table can say how much of the dying is his reserve's.
  const reserveDeaths = dead.filter(r => r.cause === 'rattler' && r.floor === 3).length;
  const lost = reports.flatMap(r => r.floors).filter(f => f.outcome === 'died');
  const watch = reports.flatMap(r => r.floors).flatMap(f => f.fights.filter((_, i) => f.fightEncounters[i] === 'watch'));
  return {
    policy: policyName, runs, escapeRate: pct(reports.filter(r => r.outcome === 'escaped').length, runs), deaths: dead.length, bossDeaths, reserveDeaths, bossShare: pct(bossDeaths, dead.length),
    fightSeconds: median(floors.filter(f => f.bossHpLeft !== null).map(f => f.bossSeconds)), byBoss, killedBy,
    beforeBoss: pct(lost.filter(f => f.deathsBeforeBoss === 1).length, lost.length), stairHp: median(reports.flatMap(r => r.floors).filter(f => f.level === 1 && typeof f.hpAtStair === 'number').map(f => f.hpAtStair as number)),
    runSeconds: median(reports.map(r => r.seconds)), watchSeconds: median(watch),
  };
}

/**
 * Plan 022's whole-run targets, D13's (D9's, plan 021, before it). Each is [label, lo, hi] over the number the policy's summary yields; `read` is given every policy's summary, so a target can be a margin over another policy's. Held at 30 runs, the
 * same ones `balance:check` plays. Fairness (D12) is the duel report's and is not here.
 */
export const TARGETS: { policy: string; label: string; read: (s: RunSummary, all: readonly RunSummary[]) => number; lo: number; hi: number }[] = [
  { policy: 'default', label: 'escape %', read: s => s.escapeRate, lo: 55, hi: 80 },
  { policy: 'default', label: 'deaths before the stair hall, %', read: s => s.beforeBoss, lo: 100 / 3, hi: 100 },
  { policy: 'default', label: 'vitality entering floor 1 stair hall, %', read: s => s.stairHp, lo: 40, hi: 80 },
  { policy: 'default', label: 'median run seconds', read: s => s.runSeconds, lo: 300, hi: 600 },
  { policy: 'default', label: 'median watch fight seconds', read: s => s.watchSeconds, lo: 12, hi: 40 },
  { policy: 'default', label: 'boss fight seconds (median)', read: s => s.fightSeconds, lo: 25, hi: 60 },
  { policy: 'weak', label: 'escape %', read: s => s.escapeRate, lo: 10, hi: 35 },
  { policy: 'weak-meta-max', label: 'escape %', read: s => s.escapeRate, lo: 30, hi: 60 },
  { policy: 'weak-meta-max', label: 'escape points over weak', read: (s, all) => s.escapeRate - all.find(x => x.policy === 'weak')!.escapeRate, lo: 15, hi: 100 },
];

/** Each target held against the summary of its policy: the number measured, and whether it is inside the band, inclusive. */
export const judge = (summaries: readonly RunSummary[]) => TARGETS.map(t => { const s = summaries.find(x => x.policy === t.policy)!, measured = t.read(s, summaries); return { policy: t.policy, label: t.label, measured, lo: t.lo, hi: t.hi, met: measured >= t.lo && measured <= t.hi }; });

function runReport(runs: number) {
  const summaries = ['default', 'weak', 'weak-meta-max'].map(name => runSummary(name, runs));
  const targets = judge(summaries);
  // The 70% stop rule: one boss may not account for more than 70% of everything that died to a boss, over the three policies.
  const total: Record<string, number> = {};
  for (const s of summaries) for (const [kind, v] of Object.entries(s.byBoss)) total[kind] = (total[kind] ?? 0) + v.deaths;
  const all = Object.values(total).reduce((a, b) => a + b, 0), top = Object.entries(total).sort((a, b) => b[1] - a[1])[0];
  return { summaries, targets, wall: top && all ? { kind: top[0], share: top[1] / all * 100, deaths: top[1], of: all } : null };
}

function printRuns(report: ReturnType<typeof runReport>, runs: number) {
  console.log(`\n  whole runs: ${runs} from seed ${expected.firstSeed}, the same runs balance:check plays\n`);
  for (const s of report.summaries) {
    console.log(`  ${s.policy}: escaped ${fixed(s.escapeRate)}% · run ${fixed(s.runSeconds, 0)} s, watch fight ${fixed(s.watchSeconds)} s, floor 1 stair hall at ${fixed(s.stairHp, 0)}% · ${s.deaths} deaths, ${fixed(s.beforeBoss, 0)}% before the stair hall, ${s.bossDeaths} to a boss (${fixed(s.bossShare, 0)}%), ${s.reserveDeaths} to the Bone King's reserve · killed by ${Object.entries(s.killedBy).map(([c, n]) => `${c} ${n}`).join(', ') || 'nothing'}`);
    console.log('    boss       floors met   deaths here   median fight s   median damage   HP left when it fell');
    for (const [kind, v] of Object.entries(s.byBoss)) console.log(`    ${kind.padEnd(9)}  ${String(v.floors).padStart(10)}   ${String(v.deaths).padStart(11)}   ${fixed(v.seconds).padStart(14)}   ${fixed(v.damage, 0).padStart(13)}   ${`${fixed(v.hpLeft, 0)}%`.padStart(20)}`);
  }
  console.log('\n  D13 targets (plan 022)');
  for (const t of report.targets) console.log(`    ${t.policy.padEnd(14)} ${t.label.padEnd(30)} ${fixed(t.measured).padStart(6)}   [${t.lo}, ${t.hi}]   ${t.met ? 'met' : 'NOT met'}`);
  if (report.wall) console.log(`\n  stop rule (D9 may not need one boss for more than 70% of the boss deaths): ${report.wall.kind} accounts for ${report.wall.deaths} of ${report.wall.of} (${fixed(report.wall.share, 0)}%)${report.wall.share > 70 && report.wall.of >= 4 ? '   TRIPPED' : ''}`);
  console.log('');
}

// ------------------------------------------------------------------------------------------------------ main

// Run only when this is the file node was started on, so a test can import `duel` and `fairness` without playing a thing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const seeds = Math.max(1, Math.round(value('seeds', 30)));
  const runs = Math.max(1, Math.round(value('runs', expected.runs)));
  const wantDuels = !flag('runs'), wantRuns = !flag('duels');
  const started = performance.now();
  const duels = wantDuels ? duelReport(seeds, flag('at-stair'), runs) : null, whole = wantRuns ? runReport(runs) : null;
  if (flag('json')) console.log(JSON.stringify({ duels, runs: whole }, null, 2));
  else {
    if (duels) printDuels(duels, seeds);
    if (whole) printRuns(whole, runs);
    console.log(`  ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
  }
}
