// Hold the balance harness to the bands in bands.json, and fail when a batch leaves them.
//
//   npm run balance:check
//
// Nine policies, the same seeds main.ts walks. `special` (plan 016) is the default knight firing the
// Tideblade's lunge whenever it is worth it, and `special-<arm>` the same knight holding one of the four
// Stage C arms and firing its special; `default` and `weak` never touch a special.
// `meta-max` and `weak-meta-max` (plan 019) are the default and the weak knight with every upgrade bought
// (`"meta": "max"`), so the shop can be seen to make the game easier, and by how much. The bands are loose on
// purpose: they catch a change that moved the keep a long way by accident, not a retune, and they are bot numbers rather than a claim about
// how a human plays. A deliberate balance change is expected to fail this and to update bands.json - the
// `measured` block as well as the bands - in the same pull request, so the new numbers are reviewed with
// the change that caused them.
import { readFileSync } from 'node:fs';
import { buildPolicy, compareBands, describeViolation, summarise, type Band, type PolicySpec, type Violation } from './bands.ts';
import { simulateRun } from './sim.ts';

type Expected = {
  runs: number;
  firstSeed: number;
  policies: Record<string, { policy: PolicySpec; measured: Record<string, number>; bands: Record<string, Band> }>;
};

const expected = JSON.parse(readFileSync(new URL('./bands.json', import.meta.url), 'utf8')) as Expected;
// Plan 025 Stage F: `--props=off` lays no furniture on any policy's floors (the new door rewards are dealt either way), the "before" of the props measurement.
const propsOff = process.argv.includes('--props=off');
const started = performance.now();
const violations: Violation[] = [];
const summaries: Record<string, Record<string, number>> = {};

console.log(`\n  ${expected.runs} runs a policy from seed ${expected.firstSeed}${propsOff ? ', furniture off' : ''}\n`);
console.log('  policy    metric                 measured   band');
for (const [name, entry] of Object.entries(expected.policies)) {
  const policy = { ...buildPolicy(entry.policy), ...(propsOff ? { props: false } : {}) };
  const reports = Array.from({ length: expected.runs }, (_, i) => simulateRun(expected.firstSeed + i * 7919, policy));
  const summary = summarise(reports);
  summaries[name] = summary;
  const found = compareBands(name, summary, entry.bands);
  violations.push(...found);
  for (const [metric, band] of Object.entries(entry.bands)) {
    const value = summary[metric], bad = found.some(v => v.metric === metric);
    console.log(`  ${name.padEnd(8)}  ${metric.padEnd(21)}  ${(value === undefined ? '—' : value.toFixed(1)).padStart(8)}   [${band.min}, ${band.max}]${bad ? '   OUT' : ''}`);
  }
  // Plan 025 Stage E: what `summarise` measures without a band (the stair-hall vitality, the share of deaths before the stair hall), printed so a run is read once rather than re-run for them. Never compared.
  for (const [metric, value] of Object.entries(summary)) if (!(metric in entry.bands)) console.log(`  ${name.padEnd(8)}  ${metric.padEnd(21)}  ${value.toFixed(1).padStart(8)}   (no band)`);
  // Plan 025 Stage F: what the furniture and the new doors did, per run, never compared: the median fight (every chamber fought, every floor), the props' own tally, and the arm's deal and offer.
  const floors = reports.flatMap(r => r.floors), fights = floors.flatMap(f => f.fights).sort((a, b) => a - b), per = (n: number) => (n / reports.length).toFixed(2);
  const tally = floors.reduce((sum, f) => { for (const [k, v] of Object.entries(f.props)) sum[k] = (sum[k] ?? 0) + v; return sum; }, {} as Record<string, number>);
  const taken = (reward: string) => per(floors.reduce((n, f) => n + f.doorRewards.filter(doors => doors.includes(reward)).length, 0));
  console.log(`  ${name.padEnd(8)}  medianFight ${fights.length ? fights[fights.length >> 1].toFixed(2) : '-'} s; props a run: ${Object.entries(tally).map(([k, v]) => `${k} ${per(v)}`).join(', ')}; found pearls ${per(reports.reduce((n, r) => n + r.found, 0))}; offered a run: boon ${taken('boon')}, pearls ${taken('pearls')}; arm dealt ${reports.filter(r => r.armDealt).length}/${reports.length}, offered ${reports.filter(r => r.armOffered).length}/${reports.length}`);
}
console.log(`\n  ${((performance.now() - started) / 1000).toFixed(1)}s`);
// `npm run balance:check -- --summary`: every policy's whole summary on one JSON line, unrounded, so bands.json's `measured` block is re-taken from the run that was checked.
if (process.argv.includes('--summary')) console.log(`\n  summary ${JSON.stringify(summaries)}`);

if (violations.length) {
  console.error(`\n  balance left its bands (${violations.length}):`);
  for (const v of violations) console.error(`    ${describeViolation(v)}`);
  console.error('\n  If this change was meant to move the balance, update scripts/balance/bands.json in the same PR.\n');
  process.exit(1);
}
console.log('  every metric inside its band\n');
