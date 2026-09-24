// Prints the spec files one CI shard should run, balanced by measured duration (see lib.ts).
//   node --experimental-strip-types scripts/shards/plan.ts <shards> <index>
// The deploy workflow passes the output straight to `npm run test:browser`, in place of `--shard`.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planShards, type Durations } from './lib.ts';

const GAME = fileURLToPath(new URL('../../', import.meta.url));
const [total, index] = process.argv.slice(2).map(Number);
if (!Number.isInteger(total) || !Number.isInteger(index) || index < 1 || index > total) {
  console.error('usage: plan.ts <shards> <index>, with 1 <= index <= shards');
  process.exit(2);
}
const durations = JSON.parse(readFileSync(new URL('./durations.json', import.meta.url), 'utf8')) as Durations;
const files = readdirSync(`${GAME}tests/browser`).filter((file) => file.endsWith('.spec.ts'));
console.log(planShards(files, durations, total)[index - 1].map((file) => `tests/browser/${file}`).join(' '));
