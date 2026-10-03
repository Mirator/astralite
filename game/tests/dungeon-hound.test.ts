// Plan 021 Stage D: the Tide Hound's row, and the chain that is its second phase. Phase one is pounce, swing, pounce; below half the tells shorten and the pounces come two at a time
// (`Move.chain`): the second begins the instant the first leap ends, with no recovery between and a short re-aim, from wherever the knight stands then. Stage A proved the selector
// and the phases on a stand-in; this holds the real row to D4, to the smallest goal chamber, and the chain to the rule that makes it a read: one dash answers both lanes only when it
// is timed between them. The game's wiring is in boss.spec.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { bossReach, decideEnemy, enemyStats, HIT, LUNGE_CONTACT, LUNGE_SPEED, LUNGE_TIME, moveOf, NOTICE_TIME, RECOVERY, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { DASH_IFRAMES, DASH_SPEED, DASH_TIME } from '../app/dungeon-combat.ts';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';

const hound = BESTIARY.hound;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'hound', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.7, speed: 3.0, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 45, maxHp: 45, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });

/** The attack and tell of each move the Hound begins against a knight standing still, in order. */
const tells = (start: EnemyView, knight: { x: number; z: number }, count: number) => {
  const w = world(), began: { attack: string | undefined; tell: number; cooldown: number }[] = [];
  let enemy = start;
  for (let frame = 0; frame < 9000 && began.length < count; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) began.push({ attack: moveOf('hound', intent.phase, intent.move)?.attack, tell: intent.windup, cooldown: enemy.cooldown });
    enemy = fed(enemy, intent);
  }
  return began;
};

test('the Tide Hound is a pool boss with D4\'s rotation: pounce, swing, pounce, and below half its tells shorten and its pounces chain two at a time', () => {
  assert.equal(hound.boss, 'pool');
  assert.deepEqual(hound.phases, [0.5]);
  assert.deepEqual(hound.moves!.map(phase => phase.map(move => move.attack)), [['pounce', 'swing', 'pounce'], ['pounce', 'pounce', 'swing']]);
  assert.deepEqual(hound.moves!.map(phase => phase.map(move => !!move.chain)), [[false, false, false], [false, true, false]], 'only phase two\'s second pounce is chained to the one before it');
  const tell = (phase: number, at: number) => hound.moves![phase][at].tell;
  assert.ok(tell(1, 0) < tell(0, 0) && tell(1, 2) < tell(0, 2) && tell(1, 2) < tell(0, 1) + 0.2, 'below half the pounce\'s tell does not shorten');
  assert.ok(tell(1, 1) < tell(1, 0), 'the chained pounce\'s re-aim is not shorter than the pounce it follows');
  assert.equal(hound.firstFloor, Infinity, 'the pack mix could deal the Hound standing');
  assert.equal(hound.steadfast, true);
  assert.deepEqual(hound.look.scale, [1.6, 1.6, 1.6]);
  assert.equal(hound.title, 'The Tide Hound');
  assert.equal(hound.phaseNotice?.length, hound.moves!.length, 'a notice for each phase');
  assert.ok(hound.phaseNotice![1].length > 0);
  assert.ok(BOSS_POOL.includes('hound'), 'the Hound is not in the pool, so nothing deals it');
  assert.ok(ENEMY_KINDS.includes('hound'));
  assert.equal(enemyStats('hound', 1).hp, 260);
  assert.equal(enemyStats('hound', 2).hp, 260 + HIT, 'a pool boss on floor two takes the usual extra blade of vitality');
  assert.ok(CAUSE_LABELS.hound.length > 0 && CUTAWAY_ELLIPSE.hound.radii[0] > CUTAWAY_ELLIPSE.stalker.radii[0], 'its cause label, and a cutaway window larger than the stalker\'s');
});

test('every reach the Hound has fits the smallest goal chamber: a swing within Stage 0\'s 5.6, a lane that holds the whole leap and leaves the knight room beside it', () => {
  const melee = hound.moves!.flat().filter(move => move.attack === 'swing' || move.attack === 'sweep');
  assert.ok(melee.length === 2 && bossReach('hound') === melee[0].strikeRange, 'precondition: its swing is its whole melee reach');
  assert.ok(bossReach('hound') <= 5.6, `a ${bossReach('hound')} reach does not fit the 45-tile crypt`);
  const leap = LUNGE_SPEED * LUNGE_TIME, lanes = hound.moves!.flat().filter(move => move.attack === 'pounce');
  assert.equal(lanes.length, 4, 'precondition: four pounces, two in each phase');
  for (const move of lanes) {
    assert.ok(move.cue.shape === 'lane', 'a pounce is drawn as a lane');
    // The lane is the leap and the body's reach at its end: a hit a lane did not show would be one nobody could have read.
    assert.ok(move.cue.length >= leap + LUNGE_CONTACT, `the lane (${move.cue.length}) is shorter than the leap (${leap.toFixed(2)}) and its contact (${LUNGE_CONTACT})`);
    assert.ok(move.cue.width / 2 >= LUNGE_CONTACT, `the lane (${move.cue.width} wide) does not cover the leap's contact (${LUNGE_CONTACT} either side)`);
    // The smallest chamber is three tiles across at its narrowest; a lane leaves the knight room to stand beside it.
    assert.ok(move.cue.width <= 3 * TILE - 1.5, `a lane ${move.cue.width} wide leaves no room beside it in a chamber three tiles across`);
    assert.ok(move.attackRange <= 9, 'a pounce begins from further than the chamber is long');
  }
});

test('against a knight in reach the Hound winds up pounce, swing, pounce, each with its own tell, and again', () => {
  const run = tells(foe(), { x: 4, z: 0 }, 6);
  assert.equal(run.length, 6, 'the Hound began fewer than six tells');
  assert.deepEqual(run.map(b => b.attack), ['pounce', 'swing', 'pounce', 'pounce', 'swing', 'pounce']);
  assert.deepEqual(run.map(b => b.tell), [0.7, 0.5, 0.7, 0.7, 0.5, 0.7], 'a move did not use its own tell');
});

/**
 * The Hound in phase two against a knight standing at (4, 0), who runs `knight`: a function of the frame that says where he is and whether his dash is still shielding him.
 * Records, per frame, each pounce's tell and leap and every blow that landed on him.
 */
const chainFight = (knight: (frame: number, events: { leaps: number; tellEnded: number | null; firstHit: number | null; chainTell: number | null }) => { x: number; z: number; immune: boolean }, frames: number) => {
  const w = world(), events = { leaps: 0, tellEnded: null as number | null, firstHit: null as number | null, chainTell: null as number | null };
  const trace: { frame: number; act: string; windup: number; cooldown: number; aim: { x: number; z: number } }[] = [];
  let enemy = foe({ hp: 20, phase: 1, move: 0, x: 0, z: 0 }), hits = 0, at = knight(0, events);
  for (let frame = 1; frame <= frames; frame++) {
    at = knight(frame, events);
    const intent = decideEnemy(enemy, at, w, DT);
    if (enemy.windup === 0 && intent.windup > 0 && intent.move === 1 && events.chainTell === null) events.chainTell = frame;
    if (enemy.lunge === 0 && intent.lunge > 0) { events.leaps++; if (events.tellEnded === null) events.tellEnded = frame; }
    if (intent.act === 'lunge' && intent.hit) { if (events.firstHit === null) events.firstHit = frame; if (!at.immune) hits++; }
    trace.push({ frame, act: intent.act, windup: intent.windup, cooldown: intent.cooldown, aim: intent.aim });
    enemy = fed(enemy, intent);
  }
  return { hits, leaps: events.leaps, trace, events };
};

test('in phase two a pounce chains a second at once, with no recovery between and a short re-aim of its own', () => {
  const stands = chainFight(() => ({ x: 4, z: 0, immune: false }), 150);
  assert.equal(stands.leaps, 2, 'the chained pounce never fired: a Hound that pounced once and then recovered');
  // Between the first leap's end and the second tell there is no pause: the second tell begins within two frames of the leap being over.
  const leapOver = stands.trace.findIndex(t => t.act === 'lunge') + 1;
  const firstLeapEnd = stands.trace.findIndex((t, i) => i > leapOver && t.act !== 'lunge');
  const chainBegins = stands.trace.findIndex((t, i) => i >= firstLeapEnd && t.windup > 0 && t.act === 'ready');
  assert.ok(firstLeapEnd > 0 && chainBegins >= firstLeapEnd, 'precondition: a leap ended and a second tell began after it');
  assert.ok(chainBegins - firstLeapEnd <= 2, `the second pounce began ${chainBegins - firstLeapEnd} frames after the first leap, not at once`);
  assert.ok(stands.trace[chainBegins].windup <= hound.moves![1][1].tell + 1e-9 && hound.moves![1][1].tell < hound.moves![1][0].tell, 'the chained tell is not the short one');
  // A knight who stands in the way is hit by both.
  assert.equal(stands.hits, 2, `a knight who stood still took ${stands.hits} pounces, not two`);
});

test('one dash answers both lanes only when it is timed between them: early, the second lane is aimed at where he landed; at the first blow, it is aimed at where he was', () => {
  // The frames a standing knight's fight has its first leap begin and connect on are the same in every fight up to then, so each dash is timed to them: a dash from one frame is a knight who
  // pressed it that frame (the first frame of a dash is immune, which is how a press just ahead of a blow takes it).
  const stands = chainFight(() => ({ x: 4, z: 0, immune: false }), 150);
  const dashFrom = (from: number) => (frame: number) => {
    const age = frame - from, dashFrames = Math.round(DASH_TIME / DT), going = age >= 0 && age < dashFrames;
    return { x: 4, z: age < 0 ? 0 : Math.min(age + 1, dashFrames) * DASH_SPEED * DT, immune: going && age * DT < DASH_IFRAMES };
  };
  assert.ok(stands.events.tellEnded !== null && stands.events.firstHit !== null, 'precondition: the first leap began and then connected');
  const early = chainFight(dashFrom(stands.events.tellEnded!), 150);
  const between = chainFight(dashFrom(stands.events.firstHit!), 150);
  assert.ok(stands.leaps === 2 && early.leaps === 2 && between.leaps === 2, `precondition: the chained pounce fired in every fight (${stands.leaps}, ${early.leaps}, ${between.leaps} leaps)`);
  assert.equal(stands.hits, 2, 'a knight who stands still is not hit by both pounces');
  // Dashed as the first leap began: out of the first lane, and the chain, which re-aims from where he now stands, is on him.
  assert.equal(early.hits, 1, `a dash spent before the first blow was hit ${early.hits} times: the chain should have caught him once`);
  // Dashed on the first blow: its immunity takes that one, and the second lane was aimed at where he was a dash ago.
  assert.equal(between.hits, 0, `a dash timed to the first blow was hit ${between.hits} times: it should have cleared both lanes`);
});

test('a chained move is taken after the pounce before it and never skipped to', () => {
  // At 8 the first pounce (6.5) is out of reach and the chained one (9) is within its own: the selector must not begin it on its own account.
  const far = tells(foe({ hp: 20, phase: 1, move: 0 }), { x: 8, z: 0 }, 1);
  assert.equal(far.length, 1, 'the Hound began no tell for a knight 8 away');
  assert.equal(far[0].attack === 'pounce' && far[0].tell < hound.moves![1][0].tell, false, 'the chained pounce was begun alone, for a knight beyond the first pounce\'s reach');
  assert.ok(far[0].tell >= hound.moves![1][0].tell - 1e-9, `the first tell was ${far[0].tell}s: the chained move was skipped to`);
  assert.ok(RECOVERY.hound > 0, 'precondition: an ordinary pounce is followed by a recovery');
  const unchained = tells(foe({ hp: 20, phase: 1, move: 0 }), { x: 4, z: 0 }, 3);
  assert.equal(unchained[1].cooldown <= 0, true, 'the chained pounce began after a recovery, not straight from the leap');
  assert.equal(unchained[2].attack, 'swing', 'the round did not go pounce, pounce, swing');
});
