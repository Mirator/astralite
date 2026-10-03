// Plan 021 Stage D: the Bastion's row, and the shield that is its first phase. Phase one holds a tower shield square to the front whenever it is not winding up or recovering from
// its own blow, and goes swing, swing, sweep; below half the shield breaks and a charging pounce joins the round. Stage A proved the selector and the phases on a stand-in and the
// shieldbearer's `blocks` is held in dungeon-hits.test.ts; this holds the real row to D4, to the smallest goal chamber, and the shield to the phase. The wiring is in boss.spec.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { bossReach, decideEnemy, enemyStats, HIT, HIT_COOLDOWN, LUNGE_CONTACT, LUNGE_SPEED, LUNGE_TIME, moveOf, NOTICE_TIME, RECOVERY, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { blocks, bossPush, landBlow, type Struck } from '../app/dungeon-hits.ts';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';
import { DEFAULT_POLICY, simulateArena } from '../scripts/balance/sim.ts';

const bastion = BESTIARY.bastion;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'bastion', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.7, speed: 1.7, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 70, maxHp: 70, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });

/** The attack and tell of each move the Bastion begins against a knight standing still, in order. */
const tells = (start: EnemyView, knight: { x: number; z: number }, count: number) => {
  const w = world(), began: { attack: string | undefined; tell: number }[] = [];
  let enemy = start;
  for (let frame = 0; frame < 9000 && began.length < count; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) began.push({ attack: moveOf('bastion', intent.phase, intent.move)?.attack, tell: intent.windup });
    enemy = fed(enemy, intent);
  }
  return began;
};

test('the Bastion is a pool boss with D4\'s rotation: swing, swing, sweep behind a shield, and below half the shield breaks and a charge joins the round', () => {
  assert.equal(bastion.boss, 'pool');
  assert.deepEqual(bastion.phases, [0.5]);
  assert.deepEqual(bastion.moves!.map(phase => phase.map(move => move.attack)), [['swing', 'swing', 'sweep'], ['swing', 'swing', 'sweep', 'pounce']]);
  assert.ok(!bastion.moves![0].some(move => move.attack === 'pounce'), 'phase one already has the charge, so phase two adds nothing');
  assert.deepEqual(bastion.shield, { arc: 0.3, until: 1 }, 'the shield is not the shieldbearer\'s, breaking in phase two');
  assert.deepEqual(BESTIARY.shieldbearer.shield, { arc: 0.3 }, 'precondition: the shieldbearer\'s shield has no `until`, so it is never broken by a phase');
  assert.equal(bastion.firstFloor, Infinity, 'the pack mix could deal the Bastion standing');
  assert.equal(bastion.steadfast, true);
  assert.deepEqual(bastion.look.scale, [1.7, 1.7, 1.7]);
  assert.equal(bastion.look.shieldArm, true, 'the arm does not carry the shield');
  assert.equal(bastion.title, 'The Bastion');
  assert.equal(bastion.phaseNotice?.length, bastion.moves!.length, 'a notice for each phase');
  assert.ok(bastion.phaseNotice![1].length > 0);
  assert.ok(BOSS_POOL.includes('bastion'), 'the Bastion is not in the pool, so nothing deals it');
  assert.ok(ENEMY_KINDS.includes('bastion'));
  assert.equal(enemyStats('bastion', 1).hp, 70);
  assert.equal(enemyStats('bastion', 2).hp, 70 + HIT, 'a pool boss on floor two takes the usual extra blade of vitality');
  assert.ok(CAUSE_LABELS.bastion.length > 0 && CUTAWAY_ELLIPSE.bastion.radii[0] > CUTAWAY_ELLIPSE.shieldbearer.radii[0], 'its cause label, and a cutaway window larger than the shieldbearer\'s');
});

test('every reach the Bastion has fits the smallest goal chamber: a sweep within Stage 0\'s 5.6, a charge lane that holds its leap, the push clear of it', () => {
  const reaches = bastion.moves!.flat().filter(move => move.attack === 'swing' || move.attack === 'sweep');
  assert.ok(reaches.length === 6 && Math.max(...reaches.map(move => move.strikeRange)) === bossReach('bastion'), 'precondition: bossReach is the longest melee move');
  assert.ok(bossReach('bastion') <= 5.6, `a ${bossReach('bastion')} sweep does not fit the 45-tile crypt`);
  for (const move of reaches) {
    assert.ok(move.attackRange <= move.strikeRange, 'a swing or sweep is committed from inside the reach it lands within: no gap is the telegraph');
    assert.ok(move.cue.shape !== 'ring' || move.cue.radius === move.strikeRange, 'a sweep\'s ring is drawn at its reach');
  }
  const charge = bastion.moves![1][3], leap = LUNGE_SPEED * LUNGE_TIME;
  assert.ok(charge.cue.shape === 'lane' && charge.cue.length >= leap + LUNGE_CONTACT && charge.cue.width / 2 >= LUNGE_CONTACT, 'the charge\'s lane does not hold the whole leap and its contact');
  assert.ok(charge.cue.width <= 3 * TILE - 1.5, 'a charge lane leaves no room beside it in a chamber three tiles across');
  const left = bossPush({ kind: 'bastion', x: 0, z: 0 }, { x: 1, z: 0 });
  assert.ok(1 + left.x > bossReach('bastion'), 'the push does not clear the Bastion\'s reach');
  assert.ok(1 + left.x < 6.1 - 0.5, 'the push would put the knight beyond what the smallest chamber holds');
});

test('against a knight in reach it winds up swing, swing, sweep, and below half a knight beyond its reach is met with the charge', () => {
  const one = tells(foe(), { x: 2, z: 0 }, 6);
  assert.deepEqual(one.map(b => b.attack), ['swing', 'swing', 'sweep', 'swing', 'swing', 'sweep']);
  assert.deepEqual(one.map(b => b.tell), [0.7, 0.6, 1.0, 0.7, 0.6, 1.0], 'a move did not use its own tell');
  const two = tells(foe({ hp: 30, phase: 1, move: 0 }), { x: 2, z: 0 }, 4);
  assert.deepEqual(two.map(b => b.attack), ['swing', 'swing', 'sweep', 'pounce'], 'the charge did not join the round below half');
  assert.deepEqual(two.map(b => b.tell), [0.6, 0.5, 0.9, 0.8], 'phase two\'s moves did not use their own tells');
  // Out of the swing's reach (2.4) and inside the charge's (6): only phase two has a move for him, and it is the charge.
  assert.equal(tells(foe({ hp: 30, phase: 1, move: 0 }), { x: 5, z: 0 }, 1)[0].attack, 'pounce', 'a knight 5 away was not met with the charge below half');
  assert.equal(tells(foe(), { x: 5, z: 0 }, 1)[0].attack, 'swing', 'in phase one the Bastion has no move for a knight beyond its reach but to close in on him');
});

/** A Bastion with the blood on it a landed blow reads, in this phase. */
const body = (patch: Partial<Struck> = {}): Struck => ({ kind: 'bastion', hp: 70, windup: 0, cooldown: 0, hitFlash: 0, change: 0, bossPhase: 0, ...patch });
/** The knight's heading toward the boss when he stands in front of it (it faces him) and when he stands behind it. */
const facing = { x: 1, z: 0 }, fromFront = { x: 1, z: 0 }, fromBehind = { x: -1, z: 0 };
const plain = { damage: 4, stagger: false, knockback: 0.4, wardenKnockback: 0.12 };

test('its shield turns a frontal blow aside in phase one, and in phase two it does not: a stagger arm and a flank get through in phase one', () => {
  const cells = open();
  const strike = (target: Struck, push: { x: number; z: number }, stagger = false) => landBlow(cells, target, { x: 0, z: 0 }, { ...plain, stagger }, push, facing);
  // Phase one (phase 0 in the table): the shield is up for a frontal blow.
  const held = body();
  assert.equal(blocks(held, facing, fromBehind, false), true, 'precondition: the shield is up in phase one, so a phase two that lets the blow through means something');
  const turned = strike(held, fromBehind);
  assert.equal(turned.blocked, true, 'a frontal blow was not turned aside by the shield in phase one');
  assert.equal(held.hp, 70, 'a frontal blow wounded a raised shield');
  // The openings in phase one: its own blow (the shield is down while it winds up and while it recovers), an arm that staggers, and standing behind it.
  assert.equal(strike(body({ windup: 0.3 }), fromBehind).blocked, false, 'the shield stayed up through its own tell');
  assert.equal(strike(body({ cooldown: RECOVERY.bastion }), fromBehind).blocked, false, 'the shield stayed up while it recovered');
  assert.equal(strike(body({ cooldown: HIT_COOLDOWN }), fromBehind).blocked, true, 'a plain flinch dropped the shield');
  const staggered = body();
  assert.equal(strike(staggered, fromBehind, true).blocked, false, 'a stagger arm was turned aside by the shield');
  assert.equal(staggered.hp, 66, 'a stagger arm did not wound it through the shield');
  const flanked = body();
  assert.equal(strike(flanked, fromFront).blocked, false, 'a blow from behind was turned aside by a shield held to the front');
  assert.equal(flanked.hp, 66);
  // Phase two: the shield is broken, and the same blow from the same place lands.
  const broken = body({ bossPhase: 1 });
  assert.equal(blocks(broken, facing, fromBehind, false), false, 'the shield held in phase two');
  assert.equal(strike(broken, fromBehind).blocked, false, 'a frontal blow was turned aside in phase two, with the shield broken');
  assert.equal(broken.hp, 66, 'a frontal blow in phase two did not wound it');
  // Only the Bastion's shield breaks: the shieldbearer's holds in whatever phase it is asked in.
  assert.equal(blocks({ kind: 'shieldbearer', windup: 0, cooldown: 0, bossPhase: 1 }, facing, fromBehind, false), true, 'a phase broke an ordinary shieldbearer\'s shield');
});

test('in the balance sim the Bastion\'s shield turns blows aside while it holds and not after it breaks', () => {
  // The knight takes the Bastion down in about ten seconds, so it holds 200 here, long enough to be struck behind its shield and then past its change.
  const stats = BESTIARY.bastion.stats, was = stats.hp;
  stats.hp = 200;
  try {
    const reports = [1, 2, 3, 4].map(seed => simulateArena(seed, 1, ['bastion'], { ...DEFAULT_POLICY, dodge: 0.8 }));
    assert.ok(reports.every(r => r.phaseChanges === 1), `precondition: every Bastion changed phase once (${reports.map(r => r.phaseChanges).join(', ')})`);
    assert.ok(reports.reduce((sum, r) => sum + r.blocked, 0) > 0, 'precondition: the shield turned a blow aside in phase one');
    for (const r of reports) assert.equal(r.blockedLate, 0, `the Bastion's shield turned ${r.blockedLate} blows aside after it broke`);
  } finally { stats.hp = was; }
});
