import assert from 'node:assert/strict';
import test from 'node:test';
import { betterRun, parseBest, parseSeed, readBest, readSeed, writeBest, writeSeed, type BestRun } from '../app/dungeon-save.ts';

const run = (floor: number, xp: number): BestRun => ({ floor, xp, kills: 0, won: false });

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
