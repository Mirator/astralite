import assert from 'node:assert/strict';
import test from 'node:test';
import { footfalls, MAX_FOOTFALLS_PER_UPDATE } from '../app/dungeon-footstep-rules.ts';

const walk = { dashing: false, dt: 1 / 60, travelled: 0.12 };
const HALF = Math.PI / 2;

test('a crossing yields one footfall; an equal or unchanged phase yields none', () => {
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, walk), [{ count: 1, side: 0 }]);
  assert.deepEqual(footfalls(3 * HALF - 0.1, 3 * HALF + 0.1, walk), [{ count: 2, side: 1 }]);
  assert.deepEqual(footfalls(1, 1, walk), []);
  assert.deepEqual(footfalls(0.2, 0.9, walk), [], 'moved but never crossed');
  // Landing exactly on the boundary counts once, and starting exactly on it does not count again.
  assert.equal(footfalls(HALF - 0.05, HALF, walk).length, 1);
  assert.equal(footfalls(HALF, HALF + 0.05, walk).length, 0);
});

test('an unusually large delta is capped, keeping the newest crossings, never an unbounded burst', () => {
  const falls = footfalls(0, 40 * Math.PI, walk);
  assert.equal(falls.length, MAX_FOOTFALLS_PER_UPDATE);
  assert.deepEqual(falls.map(f => f.count), [39, 40]);
});
