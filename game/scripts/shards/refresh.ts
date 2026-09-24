// Rewrites durations.json from the logs of a green PR-gate run, so the shard split keeps up with the
// suite. Download the browser jobs' logs (for example `gh run view <run> --log > run.log`) and pass them:
//   node --experimental-strip-types scripts/shards/refresh.ts run.log [more.log ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDurations, type Durations } from './lib.ts';

const logs = process.argv.slice(2);
if (!logs.length) {
  console.error('usage: refresh.ts <ci-log> [<ci-log> ...]');
  process.exit(2);
}
const measured: Durations = parseDurations(logs.map((file) => readFileSync(file, 'utf8')).join('\n'));
if (!Object.keys(measured).length) {
  console.error('no Playwright list-reporter test lines found in those logs');
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(measured).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(new URL('./durations.json', import.meta.url), JSON.stringify(sorted, null, 2) + '\n');
console.log(`wrote ${Object.keys(sorted).length} specs, ${Object.values(sorted).reduce((a, b) => a + b, 0).toFixed(0)} s in total`);
