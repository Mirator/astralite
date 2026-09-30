import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { serialiseRunExport } from '../app/dungeon-run-export.ts';
import type { RunCause, RunEnd } from '../app/dungeon-save.ts';
import { formatReport, median, readRuns, summariseReport } from '../scripts/runs/report.ts';

const NOW = new Date('2026-09-30T08:00:00.000Z');
const run = (over: Partial<RunEnd> & { floor: number; seed: number }): RunEnd => ({ at: 1_700_000_000_000 + over.seed, won: false, cause: 'guard', seconds: 60, rank: 2, xp: 100, kills: 5, boons: [], ...over });
const lost = (floor: number, seed: number, cause: RunCause, seconds: number, boons: string[] = []) => run({ floor, seed, cause, seconds, boons });
// Six deaths (seconds 30, 60, 90, 100, 200, 250: an even count, so the median is the mean of 90 and 100 and an
// off-by-one lands on 90 or 100), two escapes (400 and 520, median 460), a bare win, one boon id the build does not know.
const LOG: RunEnd[] = [
  lost(2, 11, 'bonecaller', 100, ['edge', 'ward']),
  lost(2, 12, 'bonecaller', 60, ['edge']),
  lost(3, 13, 'pyre', 200, ['edge', 'vigor', 'ward']),
  lost(1, 14, 'guard', 30),
  lost(2, 15, 'hazard', 90, ['step']),
  lost(3, 16, 'bonecaller', 250, ['edge']),
  run({ floor: 3, seed: 17, won: true, cause: null, seconds: 400, boons: ['edge', 'vigor'] }),
  run({ floor: 3, seed: 18, won: true, cause: null, seconds: 520, boons: ['edge', 'swift'] }),
];

test('runs, escapes and the escape rate count wins as escapes and never as deaths', () => {
  const report = summariseReport(LOG);
  assert.equal(LOG.length, 8);
  assert.deepEqual([report.runs, report.escapes, report.deaths], [8, 2, 6]);
  assert.equal(report.escapeRate, 0.25);
  assert.equal(summariseReport([]).escapeRate, 0);
});

test('deaths by floor list every floor reached and leave the wins out', () => {
  assert.deepEqual(summariseReport(LOG).deathsByFloor, [{ floor: 1, deaths: 1 }, { floor: 2, deaths: 3 }, { floor: 3, deaths: 2 }]);
});

test('deaths by cause are sorted, embers is the hazard, and the three new kinds are always listed', () => {
  const rows = summariseReport(LOG).deathsByCause;
  assert.deepEqual(rows.map(row => [row.cause, row.deaths]), [['bonecaller', 3], ['embers', 1], ['guard', 1], ['pyre', 1], ['shieldbearer', 0]]);
  assert.deepEqual(rows[0].floors, { 2: 2, 3: 1 });
  assert.ok(!rows.some(row => row.cause === 'hazard'), 'the stored word "hazard" leaked into the table');
  const shown = formatReport(summariseReport(LOG));
  assert.match(shown, /embers +1/);
  assert.doesNotMatch(shown, /hazard/);
  // A log with no new kind still says so, rather than leaving the row out.
  assert.deepEqual(summariseReport([lost(1, 1, 'guard', 10)]).deathsByCause.filter(row => row.deaths === 0).map(row => row.cause), ['bonecaller', 'pyre', 'shieldbearer']);
});

test('run seconds: median and range, won and lost apart', () => {
  const report = summariseReport(LOG);
  assert.deepEqual(report.lost, { count: 6, median: 95, min: 30, max: 250 });
  assert.deepEqual(report.won, { count: 2, median: 460, min: 400, max: 520 });
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(summariseReport([lost(1, 1, 'guard', 10)]).won, null);
});

test('boons are counted by display name, empty lists add nothing, unknown ids are kept', () => {
  const boons = summariseReport(LOG).boons;
  const named = Object.fromEntries(boons.map(boon => [boon.name, boon.taken]));
  assert.deepEqual(named, { 'Whetted Edge': 6, 'Salt Ward': 2, 'Tidal Vigor': 2, 'Quick Step': 1, 'swift (unknown)': 1, 'Long Guard': 0, 'Grave Draught': 0 });
  assert.equal(boons[0].name, 'Whetted Edge');
  assert.equal(boons[0].id, 'edge');
});

test('the seeds of lost runs come back as restart commands, wins do not', () => {
  const report = summariseReport(LOG);
  assert.deepEqual(report.lostSeeds.map(row => row.seed), [11, 12, 13, 14, 15, 16]);
  assert.deepEqual(report.lostSeeds[4], { seed: 15, floor: 2, cause: 'embers' });
  const shown = formatReport(report);
  assert.match(shown, /restart:13 +floor 3, pyre/);
  assert.doesNotMatch(shown, /restart:17|restart:18/);
});

test('a pasted export and a bare array both read; damage and strangers are rejected', () => {
  assert.deepEqual(readRuns(serialiseRunExport(LOG, NOW)), LOG);
  assert.deepEqual(readRuns(JSON.stringify(LOG)), LOG);
  assert.equal(readRuns('not json'), null);
  assert.equal(readRuns('{"format":"something-else"}'), null);
  const doc = JSON.parse(serialiseRunExport(LOG, NOW)) as { runs: { floor: number }[] };
  doc.runs[3].floor = 0;
  assert.equal(readRuns(JSON.stringify(doc)), null, 'a damaged record must reject the whole paste');
});

test('the command prints the report for a good file and exits non-zero, naming the file, for a rejected one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-report-'));
  const good = join(dir, 'good.json'), bad = join(dir, 'bad.json');
  writeFileSync(good, serialiseRunExport(LOG, NOW));
  writeFileSync(bad, '{"format":"astralite-runs","version":2}');
  const cli = (file: string) => spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../scripts/runs/report.ts', import.meta.url)), file], { encoding: 'utf8' });
  const ok = cli(good);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /escape rate 25%/);
  const refused = cli(bad);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /bad\.json is not an astralite run log/);
  assert.equal(refused.stdout, '');
});
