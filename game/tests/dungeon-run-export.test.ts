import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunExport, parseRunExport, RUN_EXPORT_FORMAT, RUN_EXPORT_VERSION, serialiseRunExport } from '../app/dungeon-run-export.ts';
import { RUN_LOG_CAP, type RunEnd } from '../app/dungeon-save.ts';

const NOW = new Date('2026-09-29T10:15:30.000Z');
const FIELDS = ['at', 'boons', 'cause', 'floor', 'kills', 'rank', 'seconds', 'seed', 'won', 'xp'];
// A varied log: deaths to different causes on different floors, a win, empty and full boon lists.
const log = (): RunEnd[] => [
  { at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee },
  { at: 1_700_000_500_000, floor: 1, won: false, cause: 'guard', seconds: 31, rank: 1, xp: 20, kills: 2, boons: [], seed: 7 },
  { at: 1_700_001_000_000, floor: 3, won: true, cause: null, seconds: 402, rank: 6, xp: 1290, kills: 44, boons: ['edge', 'ward', 'swift'], seed: 0xffffffff },
];

test('a realistic log survives the export and the parse-back unchanged', () => {
  const runs = log();
  assert.equal(runs.length, 3);
  const text = serialiseRunExport(runs, NOW);
  assert.deepEqual(parseRunExport(text)?.runs, runs);
  const full = Array.from({ length: RUN_LOG_CAP }, (_, i) => ({ ...log()[0], at: 1_700_000_000_000 + i }));
  assert.equal(parseRunExport(serialiseRunExport(full, NOW))?.runs.length, RUN_LOG_CAP);
});

test('the envelope names the format, the version and the export time, and carries nothing else', () => {
  const doc = JSON.parse(serialiseRunExport(log(), NOW)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(doc).sort(), ['exported', 'format', 'runs', 'version']);
  assert.equal(doc.format, 'astralite-runs');
  assert.equal(doc.version, 1);
  assert.equal(doc.exported, '2026-09-29T10:15:30.000Z');
  assert.equal(RUN_EXPORT_FORMAT, 'astralite-runs');
  assert.equal(RUN_EXPORT_VERSION, 1);
});

test('a record carries the RunEnd fields and no others, even if the in-memory record grew one', () => {
  const grown = [{ ...log()[0], userAgent: 'x', binds: { up: 'KeyW' } } as unknown as RunEnd];
  const written = buildRunExport(grown, NOW).runs;
  assert.equal(written.length, 1);
  assert.deepEqual(Object.keys(written[0]).sort(), FIELDS);
  for (const record of (JSON.parse(serialiseRunExport(log(), NOW)) as { runs: object[] }).runs) assert.deepEqual(Object.keys(record).sort(), FIELDS);
});

test('the parse-back rejects a damaged paste rather than repairing it', () => {
  const doc = () => JSON.parse(serialiseRunExport(log(), NOW)) as { runs: Record<string, unknown>[]; [k: string]: unknown };
  assert.notEqual(parseRunExport(JSON.stringify(doc())), null, 'the undamaged export must parse, or every rejection below is vacuous');
  const cases: [string, (d: ReturnType<typeof doc>) => void][] = [
    ['a corrupt record', (d) => { d.runs[1].floor = 'two'; }],
    ['a record with a death and no cause', (d) => { d.runs[0].cause = null; }],
    ['a record with an extra field', (d) => { d.runs[0].device = 'phone'; }],
    ['a record with a fractional value the save would round', (d) => { d.runs[0].xp = 4.5; }],
    ['a wrong format', (d) => { d.format = 'other'; }],
    ['a wrong version', (d) => { d.version = 2; }],
    ['a bad time', (d) => { d.exported = 'yesterday'; }],
    ['an extra envelope key', (d) => { d.settings = {}; }],
    ['a runs field that is not a list', (d) => { d.runs = {} as never; }],
  ];
  for (const [name, damage] of cases) { const d = doc(); damage(d); assert.equal(parseRunExport(JSON.stringify(d)), null, name); }
  assert.equal(parseRunExport('not json'), null);
  assert.equal(parseRunExport('[]'), null);
});

test('an empty log exports as an empty, valid list', () => {
  const doc = parseRunExport(serialiseRunExport([], NOW));
  assert.notEqual(doc, null);
  assert.deepEqual(doc?.runs, []);
  assert.equal(doc?.exported, NOW.toISOString());
});
