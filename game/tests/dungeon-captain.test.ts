// Plan 021 Stage B: the Drowned Captain's row, and the fight it makes of `decideEnemy`. Stage A proved the move selector and the phases on a
// stand-in; this holds the real row to D4 (phase one is swing, swing, sweep; below half it adds a pounce) and to the room it has to fit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS, FINAL_BOSS } from '../app/dungeon-bestiary.ts';
import { bossReach, decideEnemy, enemyStats, moveOf, NOTICE_TIME, PHASE_CHANGE, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { bossPush } from '../app/dungeon-hits.ts';
import { cellKey } from '../app/dungeon-floor.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';

const captain = BESTIARY.captain;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'captain', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.8, speed: 1.8, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 60, maxHp: 60, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });

/** The attack of each tell the Captain begins over `frames` frames against a knight standing still at `knight`, in the order it began them. */
const tells = (start: EnemyView, knight: { x: number; z: number }, count: number) => {
  const w = world(), began: { attack: string | undefined; tell: number; move: number; phase: number }[] = [];
  let enemy = start;
  for (let frame = 0; frame < 6000 && began.length < count; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) began.push({ attack: moveOf('captain', intent.phase, intent.move)?.attack, tell: intent.windup, move: intent.move, phase: intent.phase });
    enemy = fed(enemy, intent);
  }
  return { began, enemy };
};

test('the Captain is a pool boss with D4\'s phases: swing, swing, sweep, and below half a pounce joins them', () => {
  assert.equal(captain.boss, 'pool');
  assert.deepEqual(captain.phases, [0.5]);
  assert.deepEqual(captain.moves!.map(phase => phase.map(move => move.attack)), [['swing', 'swing', 'sweep'], ['swing', 'pounce', 'sweep']]);
  assert.ok(!captain.moves![0].some(move => move.attack === 'pounce'), 'phase one already has the pounce, so phase two adds nothing');
  assert.ok(captain.moves![1].some(move => move.attack === 'pounce'));
  assert.equal(captain.firstFloor, Infinity, 'the pack mix could deal the Captain standing');
  assert.equal(captain.steadfast, true);
  assert.deepEqual(captain.look.scale, [1.7, 1.7, 1.7]);
  assert.equal(captain.title, 'The Drowned Captain');
  assert.equal(captain.phaseNotice?.length, captain.moves!.length, 'a notice for each phase');
  assert.ok(captain.phaseNotice![1].length > 0);
});

test('the Captain stands in the pool, in every table that has a row per kind, and on floor one has 60 vitality', () => {
  assert.deepEqual([...BOSS_POOL], ['captain']);
  assert.equal(FINAL_BOSS, 'captain', 'the final floor holds the Captain until the Bone King has a row');
  assert.ok(ENEMY_KINDS.includes('captain'));
  assert.equal(enemyStats('captain', 1).hp, 60);
  assert.equal(enemyStats('captain', 2).hp, 64, 'a pool boss on floor two takes the usual extra blade of vitality');
  assert.ok(CAUSE_LABELS.captain.length > 0 && CUTAWAY_ELLIPSE.captain.radii[0] > CUTAWAY_ELLIPSE.warden.radii[0], 'its cause label and a cutaway window larger than the warden\'s');
});

test('every reach the Captain has fits the smallest goal chamber, with the knight able to stand outside it (Stage 0: a sweep may reach 5.6 at most)', () => {
  const reaches = captain.moves!.flat().filter(move => move.attack === 'swing' || move.attack === 'sweep').map(move => move.strikeRange);
  assert.ok(reaches.length === 5 && Math.max(...reaches) === bossReach('captain'), 'precondition: bossReach is the longest melee move');
  assert.ok(bossReach('captain') <= 5.6, `a ${bossReach('captain')} sweep does not fit the 45-tile crypt`);
  for (const move of captain.moves!.flat()) {
    assert.ok(move.attackRange <= move.strikeRange || move.attack === 'pounce', 'a swing or sweep is committed from inside the reach it lands within: no gap is the telegraph');
    assert.ok(move.cue.shape !== 'ring' || move.cue.radius === move.strikeRange, 'a sweep\'s ring is drawn at its reach');
  }
  // The push after a phase change leaves the knight beyond the largest reach, with room for it in the smallest chamber (refuge 6.10).
  const left = bossPush({ kind: 'captain', x: 0, z: 0 }, { x: 1, z: 0 });
  assert.ok(1 + left.x > bossReach('captain'), 'the push does not clear the Captain\'s reach');
  assert.ok(1 + left.x < 6.1 - 0.5, 'the push would put the knight beyond what the smallest chamber holds');
});

test('against a knight who stays in reach the Captain winds up swing, swing, sweep, in that order and again, each with its own tell', () => {
  const run = tells(foe(), { x: 2.4, z: 0 }, 6);
  assert.equal(run.began.length, 6, 'the Captain began fewer than six tells');
  assert.deepEqual(run.began.map(b => b.attack), ['swing', 'swing', 'sweep', 'swing', 'swing', 'sweep']);
  assert.deepEqual(run.began.map(b => b.tell), [0.8, 0.7, 1.1, 0.8, 0.7, 1.1], 'a move did not use its own tell');
  assert.deepEqual(run.began.map(b => b.phase), [0, 0, 0, 0, 0, 0], 'it changed phase with its vitality untouched');
});

test('below half its vitality it changes phase once, and then a knight out of the melee reach is met with the pounce', () => {
  const w = world(), knight = { x: 4.4, z: 0 };
  let enemy = foe({ hp: 29 }), changes = 0;
  const first = decideEnemy(enemy, knight, w, DT);
  assert.equal(first.phaseChange, true, 'a Captain with 29 of 60 did not change phase');
  assert.equal(first.phase, 1);
  enemy = fed(enemy, first);
  for (let frame = 0; frame < 120; frame++) { const intent = decideEnemy(enemy, knight, w, DT); if (intent.phaseChange) changes++; enemy = fed(enemy, intent); }
  assert.equal(changes, 0, 'it changed phase more than once');
  // 4.4 out is past the swing's 2.7 and inside the pounce's 5.5: the swing is skipped for the pounce, which is what phase two adds.
  const after = tells({ ...enemy, windup: 0, cooldown: 0, change: 0, x: 0, z: 0 }, knight, 1);
  assert.equal(after.began[0].attack, 'pounce', 'a knight out of the swing\'s reach was not met with the pounce');
  assert.ok(Math.abs(first.change - PHASE_CHANGE) < 1e-9);
});
