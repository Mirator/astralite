import assert from 'node:assert/strict';
import test from 'node:test';
import { ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { CAUSE_LABELS, formatRunTime, summariseRunEnd } from '../app/dungeon-run-summary.ts';

const lost = (over: Partial<Parameters<typeof summariseRunEnd>[0]> = {}) => ({ won: false, cause: 'warden' as const, seconds: 94, boons: ['edge', 'ward'], ...over });

test('every way a run can end has its own wording', () => {
  const causes = [...ENEMY_KINDS, 'hazard'] as const;
  for (const cause of causes) assert.ok(CAUSE_LABELS[cause]?.length > 0, `${cause} has no label`);
  assert.equal(new Set(causes.map((cause) => CAUSE_LABELS[cause])).size, causes.length, 'two causes share one label');
  assert.equal(summariseRunEnd(lost({ cause: 'warden' })).cause, 'Felled by a warden');
  assert.equal(summariseRunEnd(lost({ cause: 'hazard' })).cause, 'Burned by the keep\u2019s embers');
});

test('the run time is m:ss', () => {
  assert.deepEqual([0, 59, 60, 3599].map(formatRunTime), ['0:00', '0:59', '1:00', '59:59']);
  assert.equal(summariseRunEnd(lost({ seconds: 94 })).time, '1:34');
});

test('a won run names no cause, and a lost one always does', () => {
  assert.equal(summariseRunEnd(lost({ won: true, cause: null })).cause, null);
  assert.equal(summariseRunEnd(lost({ won: true, cause: null })).time, '1:34');
  assert.equal(summariseRunEnd(lost({ won: true })).cause, null, 'a won run kept a cause');
  assert.notEqual(summariseRunEnd(lost()).cause, null);
});

test('boons are shown by display name, and none reads as none', () => {
  assert.equal(summariseRunEnd(lost({ boons: ['edge', 'ward'] })).boons, 'Whetted Edge, Salt Ward');
  assert.equal(summariseRunEnd(lost({ boons: [] })).boons, 'no boons');
  assert.equal(summariseRunEnd(lost({ won: true, cause: null, boons: [] })).boons, 'no boons');
  assert.equal(summariseRunEnd(lost({ boons: ['gone'] })).boons, 'gone');
});
