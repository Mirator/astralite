// Play a batch of seeded runs and print what the keep did to them.
//
//   npm run balance                       200 runs at the default skill
//   npm run balance -- --runs 500         a tighter sample
//   npm run balance -- --dodge 0.5        a clumsier knight
//   npm run balance -- --no-explore       trunk only, no detours
//   npm run balance -- --json             machine-readable, for diffing two branches
//
// The numbers are a yardstick for comparing one build against another, not a claim about how a human
// plays. Compare a batch against a batch from the same policy; a single run tells you nothing.
import { DEFAULT_POLICY, simulateRun, type Cause, type Policy, type RunReport } from './sim.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: number) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const parsed = Number(args[at + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const runs = Math.max(1, Math.round(value('runs', 200)));
const firstSeed = Math.round(value('seed', 1));
const policy: Policy = {
  reaction: value('reaction', DEFAULT_POLICY.reaction),
  dodge: value('dodge', DEFAULT_POLICY.dodge),
  explore: !flag('no-explore'),
};

const reports: RunReport[] = [];
for (let i = 0; i < runs; i++) reports.push(simulateRun(firstSeed + i * 7919, policy));

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const share = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : '—';

const escaped = reports.filter(r => r.outcome === 'escaped');
const died = reports.filter(r => r.outcome === 'died');
const stuck = reports.filter(r => r.outcome === 'stuck');

if (flag('json')) {
  console.log(JSON.stringify({ runs, policy, reports }, null, 2));
} else {
  console.log(`\n  ${runs} runs · reaction ${policy.reaction}s · dodge ${policy.dodge} · ${policy.explore ? 'exploring' : 'trunk only'}\n`);
  console.log(`  escaped ${escaped.length} (${share(escaped.length, runs)})   died ${died.length} (${share(died.length, runs)})   stuck ${stuck.length} (${share(stuck.length, runs)})`);
  console.log(`  median run ${(median(reports.map(r => r.seconds)) / 60).toFixed(1)} min · median rank ${median(reports.map(r => r.rank))} · median kills ${median(reports.map(r => r.kills))}\n`);

  // The headline number: a keep that gets easier as it goes shows up here as a falling death rate.
  console.log('  floor   reached   died   death rate   median clear   median HP left');
  for (let level = 1; level <= 3; level++) {
    const reached = reports.filter(r => r.floors.length >= level);
    const fell = reached.filter(r => r.floors[level - 1].outcome === 'died');
    const cleared = reached.filter(r => r.floors[level - 1].outcome === 'cleared');
    const hp = cleared.map(r => r.floors[level - 1].hpAfter / r.floors[level - 1].maxHpAfter * 100);
    console.log(`  ${level}       ${String(reached.length).padStart(7)}   ${String(fell.length).padStart(4)}   ${share(fell.length, reached.length).padStart(10)}   ${`${median(cleared.map(r => r.floors[level - 1].seconds)).toFixed(0)}s`.padStart(13)}   ${`${median(hp).toFixed(0)}%`.padStart(14)}`);
  }

  const causes: Cause[] = ['guard', 'stalker', 'warden', 'hazard'];
  const dealt = Object.fromEntries(causes.map(c => [c, reports.reduce((sum, r) => sum + r.floors.reduce((s, f) => s + f.damage[c], 0), 0)])) as Record<Cause, number>;
  const total = causes.reduce((sum, c) => sum + dealt[c], 0);
  console.log(`\n  damage dealt to the knight: ${causes.map(c => `${c} ${share(dealt[c], total)}`).join('   ')}`);

  const fatal = causes.map(c => [c, died.filter(r => r.cause === c).length] as const).filter(([, n]) => n);
  if (fatal.length) console.log(`  killed by: ${fatal.map(([c, n]) => `${c} ${n}`).join('   ')}`);
  if (stuck.length) console.log(`\n  ${stuck.length} run(s) hit the floor timeout — seeds ${stuck.slice(0, 5).map(r => `0x${r.seed.toString(16)}`).join(', ')}`);
  console.log('');
}
