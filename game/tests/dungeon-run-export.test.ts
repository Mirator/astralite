import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunExport, parseRunExport, RUN_EXPORT_FORMAT, RUN_EXPORT_VERSION, serialiseRunExport } from '../app/dungeon-run-export.ts';
import { RUN_LOG_CAP, type RunEnd } from '../app/dungeon-save.ts';

const NOW = new Date('2026-09-29T10:15:30.000Z');
const FIELDS = ['arm', 'at', 'boons', 'cause', 'floor', 'kills', 'pearls', 'rank', 'seconds', 'seed', 'upgrades', 'won', 'xp'];
// A varied log: deaths to different causes on different floors, a win, empty and full boon lists.
const log = (): RunEnd[] => [
  { at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee, arm: 'tideblade', upgrades: {}, pearls: 31 },
  { at: 1_700_000_500_000, floor: 1, won: false, cause: 'guard', seconds: 31, rank: 1, xp: 20, kills: 2, boons: [], seed: 7, arm: 'spear', upgrades: { lungs: 1 }, pearls: 2 },
  { at: 1_700_001_000_000, floor: 3, won: true, cause: null, seconds: 402, rank: 6, xp: 1290, kills: 44, boons: ['edge', 'ward', 'swift'], seed: 0xffffffff, arm: 'maul', upgrades: { lungs: 3, whet: 2, eye: 1, tide: 1 }, pearls: 119 },
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

// An export copied before plan 019 has no `arm`, `upgrades` or `pearls` on its records. It is still a good
// export, and it reads as Tideblade runs on no upgrades that paid nothing.
const pre019 = () => log().map(({ arm: _arm, upgrades: _upgrades, pearls: _pearls, ...old }) => old);
const envelope = (runs: unknown[]) => JSON.stringify({ format: RUN_EXPORT_FORMAT, version: RUN_EXPORT_VERSION, exported: NOW.toISOString(), runs });

test('an export from before the meta save still parses, and its records read as Tideblade runs on no upgrades', () => {
  const old = pre019();
  assert.ok(old.length === 3 && old.every(record => !('arm' in record) && !('upgrades' in record) && !('pearls' in record)), 'precondition: the fixture lacks the new fields');
  const doc = parseRunExport(envelope(old));
  assert.notEqual(doc, null, 'a pre-019 export was rejected');
  assert.deepEqual(doc?.runs, old.map(record => ({ ...record, arm: 'tideblade', upgrades: {}, pearls: 0 })), 'old records did not read as Tideblade runs on no upgrades');
  // And the version stays 1: the fields only add.
  assert.equal(RUN_EXPORT_VERSION, 1);
});

test('the new fields are held as strictly as the old ones once they are present', () => {
  const doc = () => JSON.parse(serialiseRunExport(log(), NOW)) as { runs: Record<string, unknown>[] };
  const accepted = doc();
  assert.notEqual(parseRunExport(JSON.stringify(accepted)), null, 'the undamaged export must parse, or every rejection below is vacuous');
  const cases: [string, (d: ReturnType<typeof doc>) => void][] = [
    ['an arm this build does not know', (d) => { d.runs[0].arm = 'lance'; }],
    ['an upgrade rank over its maximum', (d) => { d.runs[2].upgrades = { lungs: 9 }; }],
    ['an upgrade this build does not know', (d) => { d.runs[2].upgrades = { ghost: 1 }; }],
    ['a fractional pearl count', (d) => { d.runs[0].pearls = 3.5; }],
    ['a record with only some of the new fields', (d) => { delete d.runs[0].arm; }],
  ];
  for (const [name, damage] of cases) { const d = doc(); damage(d); assert.equal(parseRunExport(JSON.stringify(d)), null, name); }
});

test('the arm, the upgrades and the pearls survive the export', () => {
  const back = parseRunExport(serialiseRunExport(log(), NOW))?.runs;
  assert.deepEqual(back?.map(run => [run.arm, run.pearls]), [['tideblade', 31], ['spear', 2], ['maul', 119]]);
  assert.deepEqual(back?.[2].upgrades, { lungs: 3, whet: 2, eye: 1, tide: 1 });
});
