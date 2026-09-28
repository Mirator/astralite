// Hold the balance harness to the bands in bands.json, and fail when a batch leaves them.
//
//   npm run balance:check
//
// Seven policies, the same seeds main.ts walks. `special` (plan 016) is the default knight firing the
// Tideblade's lunge whenever it is worth it, and `special-<arm>` the same knight holding one of the four
// Stage C arms and firing its special; `default` and `weak` never touch a special. The bands are loose on purpose: they catch a change that
// moved the keep a long way by accident, not a retune, and they are bot numbers rather than a claim about
// how a human plays. A deliberate balance change is expected to fail this and to update bands.json - the
// `measured` block as well as the bands - in the same pull request, so the new numbers are reviewed with
// the change that caused them.
import { readFileSync } from 'node:fs';
import { compareBands, describeViolation, summarise, type Band, type Violation } from './bands.ts';
import { DEFAULT_POLICY, simulateRun, type Policy } from './sim.ts';
import { weaponById } from '../../app/dungeon-weapon.ts';

type Expected = {
  runs: number;
  firstSeed: number;
  policies: Record<string, { policy: { dodge?: number; reaction?: number; special?: boolean; weapon?: string }; measured: Record<string, number>; bands: Record<string, Band> }>;
};

const expected = JSON.parse(readFileSync(new URL('./bands.json', import.meta.url), 'utf8')) as Expected;
const started = performance.now();
const violations: Violation[] = [];

console.log(`\n  ${expected.runs} runs a policy from seed ${expected.firstSeed}\n`);
console.log('  policy    metric                 measured   band');
for (const [name, entry] of Object.entries(expected.policies)) {
  const { weapon, ...rest } = entry.policy;
  const policy: Policy = { ...DEFAULT_POLICY, ...rest, ...(weapon ? { weapon: weaponById(weapon) } : {}) };
  const reports = Array.from({ length: expected.runs }, (_, i) => simulateRun(expected.firstSeed + i * 7919, policy));
  const summary = summarise(reports);
  const found = compareBands(name, summary, entry.bands);
  violations.push(...found);
  for (const [metric, band] of Object.entries(entry.bands)) {
    const value = summary[metric], bad = found.some(v => v.metric === metric);
    console.log(`  ${name.padEnd(8)}  ${metric.padEnd(21)}  ${(value === undefined ? '—' : value.toFixed(1)).padStart(8)}   [${band.min}, ${band.max}]${bad ? '   OUT' : ''}`);
  }
}
console.log(`\n  ${((performance.now() - started) / 1000).toFixed(1)}s`);

if (violations.length) {
  console.error(`\n  balance left its bands (${violations.length}):`);
  for (const v of violations) console.error(`    ${describeViolation(v)}`);
  console.error('\n  If this change was meant to move the balance, update scripts/balance/bands.json in the same PR.\n');
  process.exit(1);
}
console.log('  every metric inside its band\n');
