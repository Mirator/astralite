import assert from 'node:assert/strict';
import test from 'node:test';
import { appendRun, betterRun, parseBest, parseRun, parseRuns, parseSeed, readBest, readRuns, readSeed, RUN_LOG_CAP, summariseRuns, writeBest, writeRuns, writeSeed, type BestRun, type RunEnd } from '../app/dungeon-save.ts';

const run = (floor: number, xp: number): BestRun => ({ floor, xp, kills: 0, won: false });
// A plausible death on floor 2, which every history test varies one field of.
const end = (over: Partial<RunEnd> = {}): RunEnd => ({ at: 1_700_000_000_000, floor: 2, won: false, cause: 'guard', seconds: 94, rank: 3, xp: 415, kills: 12, boons: ['edge', 'ward'], seed: 0xc0ffee, ...over });
const won = (over: Partial<RunEnd> = {}): RunEnd => end({ floor: 3, won: true, cause: null, ...over });

test('the best run is the deepest, with XP only breaking a tie on the same floor', () => {
  assert.equal(betterRun(null, null), null);
  assert.deepEqual(betterRun(null, run(1, 50)), run(1, 50));
  assert.deepEqual(betterRun(run(1, 50), null), run(1, 50));
  // Deeper wins even with less XP; a shallower run never displaces it.
  assert.deepEqual(betterRun(run(1, 900), run(3, 10)), run(3, 10));
  assert.deepEqual(betterRun(run(3, 10), run(1, 900)), run(3, 10));
  assert.deepEqual(betterRun(run(2, 100), run(2, 101)), run(2, 101));
  // A tie is not a new record, so the held run is returned by identity and nothing is rewritten.
  const held = run(2, 100);
  assert.equal(betterRun(held, run(2, 100)), held);
});

test('anything that is not a complete, sane record reads as no record', () => {
  assert.equal(parseBest(null), null);
  assert.equal(parseBest(''), null);
  assert.equal(parseBest('{'), null);
  assert.equal(parseBest('null'), null);
  assert.equal(parseBest('7'), null);
  assert.equal(parseBest('[]'), null);
  assert.equal(parseBest('{"floor":0,"xp":10}'), null);
  assert.equal(parseBest('{"floor":"3","xp":10}'), null);
  assert.equal(parseBest('{"floor":3}'), null);
  assert.equal(parseBest('{"floor":3,"xp":null}'), null);
  assert.equal(parseBest('{"floor":3,"xp":-5}'), null);
  // JSON.parse turns an overflowing literal into Infinity, which must not survive as a score.
  assert.equal(parseBest('{"floor":3,"xp":1e400}'), null);
  assert.deepEqual(parseBest('{"floor":2.9,"xp":75.4,"kills":"x","won":"yes"}'), { floor: 2, xp: 75, kills: 0, won: false });
  assert.deepEqual(parseBest('{"floor":3,"xp":940,"kills":31,"won":true}'), { floor: 3, xp: 940, kills: 31, won: true });
});

test('a stored seed survives only if it is still a whole 32-bit value', () => {
  assert.equal(parseSeed(null), null);
  assert.equal(parseSeed(''), null);
  assert.equal(parseSeed('abc'), null);
  assert.equal(parseSeed('-1'), null);
  assert.equal(parseSeed('1.5'), null);
  assert.equal(parseSeed('4294967296'), null);
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed('4294967295'), 4294967295);
});

test('a finished run lands at the end of the history and comes back unchanged', () => {
  assert.deepEqual(appendRun([], end()), [end()]);
  const first = end({ at: 1 }), second = won({ at: 2 });
  assert.deepEqual(appendRun([first], second), [first, second]);
  // The caller's list is never mutated, so a stale snapshot can never silently grow a phantom entry.
  const held = [first];
  appendRun(held, second);
  assert.deepEqual(held, [first]);
  // Through the exact JSON a browser would be holding: every field survives, which is the whole point
  // of writing one down — a run recorded in one session has to still be there in the next.
  assert.deepEqual(parseRuns(JSON.stringify([first, second])), [first, second]);
});

test('the history is capped and the run that goes is the oldest', () => {
  const full = Array.from({ length: RUN_LOG_CAP }, (_, i) => end({ at: i + 1 }));
  const rolled = appendRun(full, end({ at: 9999 }));
  assert.equal(rolled.length, RUN_LOG_CAP);
  assert.equal(rolled[0].at, 2);
  assert.equal(rolled[RUN_LOG_CAP - 1].at, 9999);
  assert.equal(appendRun(full.slice(0, 3), end({ at: 9999 })).length, 4);
  // A cell left by a build with a looser cap is trimmed on the way in as well, newest kept.
  const oversized = parseRuns(JSON.stringify(Array.from({ length: RUN_LOG_CAP + 25 }, (_, i) => end({ at: i + 1 }))));
  assert.equal(oversized.length, RUN_LOG_CAP);
  assert.equal(oversized[0].at, 26);
});

test('an entry is kept only if it still says where and how the run ended', () => {
  assert.equal(parseRun(null), null);
  assert.equal(parseRun('x'), null);
  assert.equal(parseRun(7), null);
  assert.equal(parseRun([]), null);
  assert.equal(parseRun({ floor: 2 }), null);
  assert.equal(parseRun({ ...end(), at: 'now' }), null);
  assert.equal(parseRun({ ...end(), at: -1 }), null);
  assert.equal(parseRun({ ...end(), floor: 0 }), null);
  assert.equal(parseRun({ ...end(), seed: 0x100000000 }), null);
  // JSON.parse turns an overflowing literal into Infinity, which must not survive as a replay seed.
  assert.deepEqual(parseRuns('[{"at":1,"floor":2,"won":false,"cause":"guard","seed":1e400}]'), []);
  // A death filed under nothing, or under a cause this build has never heard of, is not a data point.
  assert.equal(parseRun({ ...end(), cause: null }), null);
  assert.equal(parseRun({ ...end(), cause: 'ghost' }), null);
  // And a win cannot have killed anyone, so a record claiming both is incoherent either way round.
  assert.equal(parseRun({ ...end(), won: true }), null);
  assert.equal(parseRun({ ...won(), won: false }), null);
  // Fields that only colour an entry degrade to a floor rather than sinking it.
  assert.deepEqual(parseRun({ at: 9, floor: 2, won: false, cause: 'warden', seed: 3 }), { at: 9, floor: 2, won: false, cause: 'warden', seconds: 0, rank: 1, xp: 0, kills: 0, boons: [], seed: 3 });
  assert.deepEqual(parseRun({ ...end(), boons: ['edge', 7, null, 'ward'] })?.boons, ['edge', 'ward']);
  assert.deepEqual(parseRun({ ...end(), boons: 'edge' })?.boons, []);
  assert.deepEqual(parseRun({ ...end(), boons: Array(30).fill('edge') })?.boons.length, 12);
});

test('a corrupt entry is dropped on its own and never takes the rest of the log with it', () => {
  const good = end({ at: 5 }), later = won({ at: 6 });
  const poisoned = [good, { floor: 2 }, null, 7, 'x', [], { ...end(), cause: 'ghost' }, { ...end(), floor: 0 }, later];
  assert.deepEqual(parseRuns(JSON.stringify(poisoned)), [good, later]);
  // Anything that is not a list of runs is not a history — including the record shape of the best run.
  assert.deepEqual(parseRuns(null), []);
  assert.deepEqual(parseRuns(''), []);
  assert.deepEqual(parseRuns('{"floor":3,"xp":940}'), []);
  assert.deepEqual(parseRuns('null'), []);
  assert.deepEqual(parseRuns('7'), []);
  // Truncated JSON cannot be partly recovered, so the cell reads as no history rather than half of one.
  assert.deepEqual(parseRuns('[{"at":1,"floor":'), []);
});

test('the summary counts the descents, the escapes and the floor that takes the most knights', () => {
  assert.deepEqual(summariseRuns([]), { runs: 0, wins: 0, worstFloor: 0, worstFalls: 0 });
  assert.deepEqual(summariseRuns([end({ floor: 1 }), end({ floor: 2 }), end({ floor: 2 }), won()]), { runs: 4, wins: 1, worstFloor: 2, worstFalls: 2 });
  // A floor only ever escaped from is not a floor that kills, however many runs end there.
  assert.deepEqual(summariseRuns([won(), won(), end({ floor: 1 })]), { runs: 3, wins: 2, worstFloor: 1, worstFalls: 1 });
  // A tie goes to the shallower floor whichever order the runs happened to arrive in.
  assert.equal(summariseRuns([end({ floor: 3 }), end({ floor: 1 })]).worstFloor, 1);
  assert.equal(summariseRuns([end({ floor: 1 }), end({ floor: 3 })]).worstFloor, 1);
});

test('a history that is missing, hostile or unwritable costs the log and nothing else', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    delete owner.localStorage;
    assert.deepEqual(readRuns(), []);
    writeRuns([end()]);
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.deepEqual(readRuns(), []);
    writeRuns([end()]);
    // A working store is the reload: what one session wrote is what the next session reads back.
    const cell = new Map<string, string>();
    const store = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    owner.localStorage = store;
    writeRuns([end({ at: 1 }), won({ at: 2 })]);
    assert.deepEqual(readRuns(), [end({ at: 1 }), won({ at: 2 })]);
    // A write refused for quota leaves the last good history readable instead of emptying it.
    owner.localStorage = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); } };
    writeRuns([end({ at: 3 })]);
    assert.deepEqual(readRuns(), [end({ at: 1 }), won({ at: 2 })]);
    owner.localStorage = store;
    // Junk in the cell reads as no history, and the next run written over it starts the log clean.
    cell.set('drowned-keep:runs', '[{"at":1,');
    assert.deepEqual(readRuns(), []);
    cell.set('drowned-keep:runs', '{"floor":2}');
    assert.deepEqual(readRuns(), []);
    writeRuns(appendRun(readRuns(), end({ at: 4 })));
    assert.deepEqual(readRuns(), [end({ at: 4 })]);
    // The cap holds in the cell itself, not only on the way back in: an oversized log handed straight to
    // the writer is trimmed before it is stored, so storage cannot quietly grow past the bound.
    writeRuns(Array.from({ length: RUN_LOG_CAP + 5 }, (_, i) => end({ at: i + 1 })));
    const stored = JSON.parse(cell.get('drowned-keep:runs') ?? '[]') as RunEnd[];
    assert.equal(stored.length, RUN_LOG_CAP);
    assert.equal(stored[0].at, 6);
  } finally {
    if (original) Object.defineProperty(owner, 'localStorage', original); else delete owner.localStorage;
  }
});

test('storage that is missing or throws is indistinguishable from an empty one', () => {
  const owner = globalThis as { localStorage?: unknown };
  const original = Object.getOwnPropertyDescriptor(owner, 'localStorage');
  try {
    // No storage object at all: naming it throws a ReferenceError, which must not escape.
    delete owner.localStorage;
    assert.equal(readBest(), null);
    assert.equal(readSeed(), null);
    writeBest({ floor: 3, xp: 900, kills: 20, won: true });
    writeSeed(1234);
    // Storage present but hostile, as in a private window with site data blocked.
    owner.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    assert.equal(readBest(), null);
    assert.equal(readSeed(), null);
    writeBest({ floor: 3, xp: 900, kills: 20, won: true });
    writeSeed(1234);
    // A working store round-trips, and a corrupt value there still reads as absent.
    const cell = new Map<string, string>();
    owner.localStorage = { getItem: (k: string) => cell.get(k) ?? null, setItem: (k: string, v: string) => { cell.set(k, v); } };
    writeBest({ floor: 2, xp: 310, kills: 9, won: false });
    writeSeed(0xdeadbeef);
    assert.deepEqual(readBest(), { floor: 2, xp: 310, kills: 9, won: false });
    assert.equal(readSeed(), 0xdeadbeef);
    cell.set('drowned-keep:best', '{"floor":');
    assert.equal(readBest(), null);
  } finally {
    if (original) Object.defineProperty(owner, 'localStorage', original); else delete owner.localStorage;
  }
});
