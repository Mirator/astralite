// Read a pasted "Copy run log" export and say what it shows.
//
//   npm run runs:report <file>
//
// The file is what the title menu's Copy run log button writes (`astralite-runs` version 1), read back through
// the same strict `parseRunExport`; a bare JSON array of run records is accepted too, through the save's
// tolerant `parseRuns`. A file that is neither exits 1 and says why. Plain text, no dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARM_ORDER } from '../../app/dungeon-meta.ts';
import { parseRunExport } from '../../app/dungeon-run-export.ts';
import { parseRuns, type RunEnd } from '../../app/dungeon-save.ts';
import { BOONS } from '../../app/dungeon-sim.ts';

// The kinds plan 018 put on floors two and three; they get a row in the cause table even at zero, so a
// playtest that never met one reads differently from a playtest that met it and survived.
const WATCHED = ['shieldbearer', 'pyre', 'bonecaller'];

// The ember hazard is stored as `hazard`; the player knows it as embers.
export const causeName = (cause: string) => cause === 'hazard' ? 'embers' : cause;

export const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Plan 019: runs on different arms and different upgrades are different games, so the report breaks escapes and
// deaths down by each. `ranks` is the total of every upgrade rank held when the run began.
export type Split = { runs: number; escapes: number; deaths: number };

export type Span = { count: number; median: number; min: number; max: number };
export type RunReport = {
  runs: number; escapes: number; deaths: number; escapeRate: number;
  deathsByFloor: { floor: number; deaths: number }[];
  deathsByCause: { cause: string; deaths: number; floors: Record<number, number> }[];
  won: Span | null; lost: Span | null;
  boons: { id: string; name: string; taken: number }[];
  byArm: ({ arm: string } & Split)[];
  byUpgrades: ({ ranks: number } & Split)[];
  lostSeeds: { seed: number; floor: number; cause: string }[];
};

const span = (seconds: number[]): Span | null => seconds.length ? { count: seconds.length, median: median(seconds)!, min: Math.min(...seconds), max: Math.max(...seconds) } : null;

const split = (runs: readonly RunEnd[]): Split => ({ runs: runs.length, escapes: runs.filter(run => run.won).length, deaths: runs.filter(run => !run.won).length });
const totalRanks = (run: RunEnd) => Object.values(run.upgrades).reduce((sum, rank) => sum + (rank ?? 0), 0);

export const summariseReport = (runs: readonly RunEnd[]): RunReport => {
  const lost = runs.filter(run => !run.won), won = runs.filter(run => run.won);
  const deepest = Math.max(0, ...runs.map(run => run.floor));
  const deathsByFloor = Array.from({ length: deepest }, (_, i) => ({ floor: i + 1, deaths: lost.filter(run => run.floor === i + 1).length }));
  const causes = new Map<string, Record<number, number>>(WATCHED.map(kind => [kind, {}]));
  for (const run of lost) {
    const floors = causes.get(run.cause!) ?? {};
    floors[run.floor] = (floors[run.floor] ?? 0) + 1;
    causes.set(run.cause!, floors);
  }
  const deathsByCause = [...causes].map(([cause, floors]) => ({ cause: causeName(cause), deaths: Object.values(floors).reduce((a, b) => a + b, 0), floors }))
    .sort((a, b) => b.deaths - a.deaths || a.cause.localeCompare(b.cause));
  const taken = new Map<string, number>(BOONS.map(boon => [boon.id, 0]));
  for (const run of runs) for (const id of run.boons) taken.set(id, (taken.get(id) ?? 0) + 1);
  const boons = [...taken].map(([id, count]) => ({ id, name: BOONS.find(boon => boon.id === id)?.name ?? `${id} (unknown)`, taken: count }))
    .sort((a, b) => b.taken - a.taken || BOONS.findIndex(boon => boon.id === a.id) - BOONS.findIndex(boon => boon.id === b.id));
  // Only what the log holds: an arm nobody carried gets no row, where the new kinds above always do, because
  // there are seven arms and a playtest is expected to leave most of them alone. Fixed arm order, then rank order.
  const byArm = ARM_ORDER.filter(arm => runs.some(run => run.arm === arm)).map(arm => ({ arm: arm as string, ...split(runs.filter(run => run.arm === arm)) }));
  const byUpgrades = [...new Set(runs.map(totalRanks))].sort((a, b) => a - b).map(ranks => ({ ranks, ...split(runs.filter(run => totalRanks(run) === ranks)) }));
  return {
    runs: runs.length, escapes: won.length, deaths: lost.length, escapeRate: runs.length ? won.length / runs.length : 0,
    deathsByFloor, deathsByCause, won: span(won.map(run => run.seconds)), lost: span(lost.map(run => run.seconds)), boons, byArm, byUpgrades,
    lostSeeds: lost.map(run => ({ seed: run.seed, floor: run.floor, cause: causeName(run.cause!) })),
  };
};

const num = (value: number) => String(Math.round(value * 10) / 10);
const spanText = (label: string, s: Span | null) => `  ${label.padEnd(5)} ${s ? `median ${num(s.median)}s, range ${s.min}-${s.max}s (${s.count} runs)` : 'none'}`;

export const formatReport = (report: RunReport): string => {
  const out: string[] = [];
  out.push(`Runs ${report.runs}   escapes ${report.escapes}   deaths ${report.deaths}   escape rate ${Math.round(report.escapeRate * 100)}%`);
  out.push('', 'Deaths by floor');
  for (const row of report.deathsByFloor) out.push(`  floor ${row.floor}  ${String(row.deaths).padStart(3)}`);
  out.push('', 'Deaths by cause   (* = kinds added on floors 2-3, always listed)');
  for (const row of report.deathsByCause) {
    const where = Object.entries(row.floors).map(([floor, n]) => `f${floor} x${n}`).join(' ');
    const mark = WATCHED.includes(row.cause) ? '*' : ' ';
    out.push(`  ${mark} ${row.cause.padEnd(13)}${String(row.deaths).padStart(3)}  ${where}`);
  }
  out.push('', 'By arm carried');
  for (const row of report.byArm) out.push(`  ${row.arm.padEnd(13)}${String(row.runs).padStart(3)} runs  escapes ${String(row.escapes).padStart(3)}  deaths ${String(row.deaths).padStart(3)}`);
  out.push('', 'By upgrade ranks held at the start (total across all upgrades)');
  for (const row of report.byUpgrades) out.push(`  ${String(row.ranks).padStart(2)} ranks   ${String(row.runs).padStart(3)} runs  escapes ${String(row.escapes).padStart(3)}  deaths ${String(row.deaths).padStart(3)}`);
  out.push('', 'Run time', spanText('won', report.won), spanText('lost', report.lost));
  out.push('', 'Boons taken');
  for (const boon of report.boons) out.push(`  ${boon.name.padEnd(20)}${String(boon.taken).padStart(3)}`);
  out.push('', 'Lost runs, to replay with restart:<seed>');
  if (!report.lostSeeds.length) out.push('  none');
  for (const run of report.lostSeeds) out.push(`  restart:${run.seed}   floor ${run.floor}, ${run.cause}`);
  return out.join('\n');
};

// The export envelope first, then a bare array. Null names nothing useful, so the caller prints the message.
export const readRuns = (raw: string): RunEnd[] | null => {
  const doc = parseRunExport(raw);
  if (doc) return doc.runs;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  return Array.isArray(data) ? parseRuns(raw) : null;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: npm run runs:report <file>'); process.exit(2); }
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch (error) { console.error(`cannot read ${file}: ${(error as Error).message}`); process.exit(1); }
  const runs = readRuns(raw);
  if (!runs) { console.error(`${file} is not an astralite run log: expected the Copy run log JSON (format "astralite-runs", version 1, every record valid) or a bare array of run records`); process.exit(1); }
  console.log(formatReport(summariseReport(runs)));
}
