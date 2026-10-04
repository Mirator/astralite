// Plan 021 Stage E: the Bone King's row, the reserve sized from his move list, and the fall that crumbles everything he called. Stage A proved the selector and the phases on a stand-in; this holds the real row to D4
// (phase one is summon, swing, volley; below 60% a sweep and a pounce join it; below 25% he summons on every second move), the reserve to the worst phase's round, the floor to burying exactly that many, and the
// King's fall to the stair. The wiring in the running game is boss.spec.ts and the frame budget.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS, FINAL_BOSS, reserveSize } from '../app/dungeon-bestiary.ts';
import { bossReach, decideEnemy, enemyStats, fallOf, moveOf, NOTICE_TIME, PHASE_CHANGE, volleyDemand, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { bossPush } from '../app/dungeon-hits.ts';
import { ARROW_POOL } from '../app/dungeon-projectile.ts';
import { buryReserves, cellKey, generateFloor } from '../app/dungeon-floor.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';
import { sweepSeeds } from '../scripts/balance/census.ts';
import { buildPolicy } from '../scripts/balance/bands.ts';
import { simulateLevel } from '../scripts/balance/sim.ts';

const king = BESTIARY.king;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'king', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.8, speed: 1.9, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 80, maxHp: 80, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });

/** Every tell the King begins against a knight standing still at `knight`, in order, and the bodies each summon tell that ran out would raise (the move's own `perTell`, read off the move the tell belonged to). */
const fight = (start: EnemyView, knight: { x: number; z: number }, count: number) => {
  const w = world(), began: { attack: string | undefined; phase: number; move: number; tell: number }[] = [], raised: number[] = [];
  let enemy = start;
  for (let frame = 0; frame < 20000 && began.length < count; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) began.push({ attack: moveOf('king', intent.phase, intent.move)?.attack, phase: intent.phase, move: intent.move, tell: intent.windup });
    // The summon is spent on the frame its tell runs out, from the move the body went into that frame on.
    if (intent.raise) raised.push(moveOf('king', enemy.phase, enemy.move)!.summon!.perTell);
    enemy = fed(enemy, intent);
  }
  return { began, raised, enemy };
};
const attacks = (phase: number) => king.moves![phase].map(move => move.attack);
/** A knight inside every move's reach, so no move is skipped and the rotation is the list. */
const CLOSE = { x: 2.2, z: 0 };

test('the Bone King is the final boss with D4\'s phases: summon, swing, volley, then a sweep and a pounce below 60%, then a summon every second move below 25%', () => {
  assert.equal(king.boss, 'final');
  assert.equal(FINAL_BOSS, 'king', 'the last floor does not hold the Bone King');
  assert.ok(!BOSS_POOL.includes('king'), 'the Bone King is in the pool, so floors one and two could deal him');
  assert.deepEqual(king.phases, [0.6, 0.25]);
  assert.deepEqual(attacks(0), ['summon', 'swing', 'volley']);
  assert.ok(!attacks(0).includes('sweep') && !attacks(0).includes('pounce'), 'phase one already has the sweep or the pounce, so phase two adds nothing');
  assert.ok(['summon', 'swing', 'volley', 'sweep', 'pounce'].every(attack => attacks(1).includes(attack as never)), 'below 60% he does not do all five things');
  assert.ok(attacks(1).includes('sweep') && attacks(1).includes('pounce'));
  assert.equal(king.firstFloor, Infinity, 'the pack mix could deal the Bone King standing');
  assert.equal(king.steadfast, true);
  assert.deepEqual(king.look.scale, [1.8, 1.8, 1.8]);
  assert.equal(king.title, 'The Bone King');
  assert.equal(king.phaseNotice?.length, king.moves!.length, 'a notice for each phase');
  assert.ok(king.phaseNotice!.slice(1).every(notice => notice.length > 0));
  assert.ok(ENEMY_KINDS.includes('king'));
  assert.equal(enemyStats('king', 1).hp, 650, 'plan 022 Stage E: 650, up from 500');
  assert.equal(enemyStats('king', 3).hp, 658, 'the last floor\'s boss takes the usual extra blade of vitality a floor, twice');
  assert.ok(CAUSE_LABELS.king.length > 0 && CUTAWAY_ELLIPSE.king.radii[0] > CUTAWAY_ELLIPSE.warden.radii[0], 'its cause label and a cutaway window larger than the warden\'s');
});

test('against a knight in reach the King winds up each phase\'s list in order and again, each move with its own tell', () => {
  const first = fight(foe(), CLOSE, 6);
  assert.deepEqual(first.began.map(b => b.attack), ['summon', 'swing', 'volley', 'summon', 'swing', 'volley']);
  assert.deepEqual(first.began.map(b => b.tell), [1.2, 0.8, 0.8, 1.2, 0.8, 0.8], 'a move did not use its own tell');
  assert.deepEqual([...new Set(first.began.map(b => b.phase))], [0], 'he changed phase with his vitality untouched');
  const second = fight(foe({ phase: 1, hp: 40 }), CLOSE, 10);
  assert.deepEqual(second.began.map(b => b.attack), [...attacks(1), ...attacks(1)]);
});

test('below 60% and again below 25% he changes phase once each, in order, and each change is a second he cannot be hurt in', () => {
  const w = world();
  let enemy = foe({ hp: 47 });
  const into1 = decideEnemy(enemy, CLOSE, w, DT);
  assert.equal(into1.phaseChange, true, 'an 80 vitality King at 47 did not change phase');
  assert.equal(into1.phase, 1);
  assert.ok(Math.abs(into1.change - PHASE_CHANGE) < 1e-9);
  // One blow that took him from 47 to 5 crosses both thresholds: the first is entered, then the second only once that change is over.
  enemy = fed({ ...enemy, hp: 5 }, into1);
  const phases: number[] = [1];
  for (let frame = 0; frame < 300; frame++) { const intent = decideEnemy(enemy, CLOSE, w, DT); if (intent.phaseChange) phases.push(intent.phase); enemy = fed(enemy, intent); }
  assert.deepEqual(phases, [1, 2], 'two thresholds were not crossed one after the other');
  assert.equal(enemy.phase, 2);
});

test('the reserve is sized from the move list: the most any one phase\'s round can raise, and the generated floor buries exactly that many', () => {
  // What each phase's round raises, read off the intents the King returns when his summon tells run out, not off the table that sized the reserve.
  const demand = [0, 1, 2].map(phase => {
    const hp = [80, 47, 19][phase];
    const run = fight(foe({ phase, hp }), CLOSE, king.moves![phase].length);
    assert.ok(run.raised.length > 0, `precondition: phase ${phase} summoned nothing in a round, so there is no demand to size from`);
    return run.raised.reduce((a, b) => a + b, 0);
  });
  assert.deepEqual(demand, [2, 2, 4], 'a round of each phase does not raise 2, 2 and 4');
  const reserve = Math.max(...demand);
  assert.equal(reserveSize('king'), reserve, 'the reserve is not the worst phase\'s round');
  assert.ok(reserve > king.summons!.count, 'precondition: the row\'s `summons.count` is not already the whole reserve, so burying it would pass for sizing it');
  assert.ok(reserve <= 6, `${reserve} rattlers standing do not fit the frame budget: six is the most that fits under 508 calls (Stage 0)`);
  // The generator buries exactly that many, under the King, and the arena's rule is the same one.
  for (const seed of sweepSeeds(3).slice(0, 20)) {
    const floor = generateFloor(seed, 3), at = floor.spawns.findIndex(s => s.kind === 'king');
    assert.ok(at >= 0 && floor.spawns[at].room === floor.goal, `seed ${seed}: the stair hall holds no King`);
    const buried = floor.spawns.filter(s => s.summoner === at);
    assert.equal(buried.length, reserve, `seed ${seed}: the floor buried ${buried.length} rattlers under the King, not the ${reserve} his worst phase raises`);
    assert.ok(buried.every(s => s.buried && s.kind === 'rattler' && s.room === floor.goal && s.x === floor.spawns[at].x && s.z === floor.spawns[at].z), `seed ${seed}: a reserve body is not a buried rattler at the King's feet`);
    assert.equal(floor.spawns.filter(s => s.summoner !== undefined && s.room === floor.goal).length, reserve, `seed ${seed}: something else is buried in the stair hall`);
  }
  assert.equal(buryReserves([{ x: 0, z: 0, kind: 'king', room: 1, ambush: false }]).length, 1 + reserve);
  // An ordinary caller's reserve is still its `summons.count`.
  assert.equal(reserveSize('bonecaller'), BESTIARY.bonecaller.summons!.count);
  assert.equal(reserveSize('captain'), 0);
});

test('below 25% he summons on every second move: the summon is every other tell, and the others are the rest of the round', () => {
  const run = fight(foe({ phase: 2, hp: 19 }), CLOSE, 16);
  assert.equal(run.began.length, 16, 'precondition: he began sixteen moves, two rounds');
  assert.deepEqual([...new Set(run.began.map(b => b.phase))], [2], 'precondition: he stayed in his last phase');
  run.began.forEach((b, n) => assert.equal(b.attack === 'summon', n % 2 === 0, `move ${n} was a ${b.attack}: a summon belongs on every second move, starting with the first`));
  // The moves between are the whole of phase two's other four, in order, so nothing was dropped to make room for the summons.
  assert.deepEqual(run.began.filter((_, n) => n % 2 === 1).slice(0, 4).map(b => b.attack), ['swing', 'volley', 'sweep', 'pounce']);
  // Phase one, for contrast, summons once a round of five.
  const before = fight(foe({ phase: 1, hp: 40 }), CLOSE, 10);
  assert.equal(before.began.filter(b => b.attack === 'summon').length, 2, 'between 60% and 25% he summons once in each round of five');
});

test('every reach the King has fits the smallest goal chamber, with the knight able to stand outside it, and his bolt fits the arrow pool', () => {
  const reaches = king.moves!.flat().filter(move => move.attack === 'swing' || move.attack === 'sweep').map(move => move.strikeRange);
  assert.ok(reaches.length > 0 && Math.max(...reaches) === bossReach('king'), 'precondition: bossReach is the longest melee move');
  assert.ok(bossReach('king') <= 5.6, `a ${bossReach('king')} reach does not fit the 45-tile crypt (Stage 0: 5.6)`);
  for (const move of king.moves!.flat().filter(move => move.attack !== 'summon' && move.attack !== 'volley')) {
    assert.ok(move.attackRange <= move.strikeRange || move.attack === 'pounce', 'a swing or sweep is committed from inside the reach it lands within');
    assert.ok(move.cue.shape !== 'ring' || move.cue.radius === move.strikeRange, 'a sweep\'s ring is drawn at its reach');
  }
  const left = bossPush({ kind: 'king', x: 0, z: 0 }, { x: 1, z: 0 });
  assert.ok(1 + left.x > bossReach('king'), 'the push does not clear the King\'s reach');
  assert.ok(1 + left.x < 6.1 - 0.5, 'the push would put the knight beyond what the smallest chamber holds');
  assert.ok(volleyDemand('king') >= 1 && volleyDemand('king') <= ARROW_POOL, `he needs ${volleyDemand('king')} arrows and the pool holds ${ARROW_POOL}`);
});

test('felling the King crumbles everything he called, standing or buried, and a rattler cut down while he stands goes back into the ground', () => {
  const floor = generateFloor(sweepSeeds(3)[0], 3), at = floor.spawns.findIndex(s => s.kind === 'king');
  // Two of his four stand; two are still in the ground. Every body is alive: the precondition is that something is there to crumble.
  const reserve = floor.spawns.map((s, i) => s.summoner === at ? i : -1).filter(i => i >= 0);
  const bodies = floor.spawns.map((s, i) => ({ summoner: s.summoner ?? -1, dead: false, buried: reserve.indexOf(i) >= 2 }));
  const called = reserve;
  assert.equal(called.length, reserveSize('king'), 'precondition: the King has his whole reserve to crumble');
  assert.ok(called.some(i => bodies[i].buried) && called.some(i => !bodies[i].buried), 'precondition: some of what he called stands and some is buried');
  const fall = fallOf(bodies, at);
  assert.equal(fall.reassembles, false, 'the King\'s fall was put back into the ground');
  assert.deepEqual(fall.crumble.sort((a, b) => a - b), called, 'his fall did not crumble every body he called');
  const cut = fallOf(bodies, called[0]);
  assert.equal(cut.reassembles, true, 'a rattler cut down while the King stands was a death');
  assert.deepEqual(cut.crumble, []);
});

test('the sim fells the King and the stair opens: every body in the stair hall falls with him, so the floor is cleared and not stuck', () => {
  // A floor-three keep fought by the knight with every upgrade bought (a fresh default knight dies to the tuned King). A reserve that was left standing or buried would hold the stair hall open for ever, and the report would be `stuck`.
  const seed = sweepSeeds(3)[0], floor = generateFloor(seed, 3), report = simulateLevel(seed, 3, buildPolicy({ meta: 'max' }), floor);
  assert.equal(report.bossKind, 'king', 'the floor\'s boss is not the King');
  assert.notEqual(report.outcome, 'stuck', 'the floor hit its timeout: something he called was left to hold the stair shut');
  assert.equal(report.outcome, 'cleared', 'the knight did not clear the floor, so the King was not felled');
  assert.ok(report.bossHpLeft !== null, 'the King was never felled');
  assert.ok(report.raised > 0, 'the King summoned nothing, so there was nothing to crumble');
});
