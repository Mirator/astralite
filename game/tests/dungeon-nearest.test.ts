import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestFirst } from '../app/dungeon-nearest.ts';

test('the nearest few match the prefix of a stable sort, ties in list order', () => {
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let round = 0; round < 500; round++) {
    // Coarse values, so ties are common.
    const items = Array.from({ length: Math.floor(random() * 30) }, (_, id) => ({ id, d: Math.floor(random() * 8) }));
    const count = 1 + Math.floor(random() * 6);
    const want = [...items].sort((a, b) => a.d - b.d).slice(0, count);
    assert.deepEqual(nearestFirst(items, count, (item) => item.d, []), want);
  }
});

test('it reuses the array it is given', () => {
  const into = [99];
  const out = nearestFirst([3, 1, 2], 2, (n) => n, into);
  assert.equal(out, into);
  assert.deepEqual(out, [1, 2]);
});
