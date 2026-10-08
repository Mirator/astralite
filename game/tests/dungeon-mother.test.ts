// Plan 021 Stage C: the Pyre Mother's row, and the fight it makes of `decideEnemy`, the fan and the scatter. Stage A proved the move selector, the phases and
// `scatterRings` on a stand-in; Stage B held the Captain's row to D4. This holds the Mother's row to D4 (phase one is volley, volley, scatter; below half a close
// sweep joins them and she scatters twice), to the smallest goal chamber, and to the twelve-arrow pool her fan has to fit in. The game's wiring is in boss.spec.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, BOSS_POOL, ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { ARRIVED, bossReach, CORNERED, decideEnemy, enemyStats, floorAhead, HIT, HOLD_STILL, moveOf, NOTICE_TIME, RECOVERY, REPOSITION_CLEAR, repositionTarget, ROAM_STEP, volleyDemand, wallClearance, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { cellKey, TILE } from '../app/dungeon-floor.ts';
import { ARROW_POOL, BOLT_RADIUS, fanHeadings, HOSTILE_POOL_RINGS } from '../app/dungeon-projectile.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';
import { DEFAULT_POLICY, simulateArena, type Policy } from '../scripts/balance/sim.ts';

const mother = BESTIARY.mother;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'mother', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: 0.8, speed: 2.1, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 50, maxHp: 50, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice, move: intent.move, phase: intent.phase, change: intent.change });

/** The attack and tell of each move the Mother begins against a knight standing still, or keeping pace with her, in the order she began them. She gives ground while she recovers: her position is fed back. */
const tells = (start: EnemyView, standing: { x: number; z: number } | ((enemy: EnemyView) => { x: number; z: number }), count: number) => {
  const w = world(), began: { attack: string | undefined; tell: number; phase: number }[] = [];
  let enemy = start;
  for (let frame = 0; frame < 9000 && began.length < count; frame++) {
    const knight = typeof standing === 'function' ? standing(enemy) : standing;
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0) began.push({ attack: moveOf('mother', intent.phase, intent.move)?.attack, tell: intent.windup, phase: intent.phase });
    enemy = fed(enemy, intent);
  }
  return { began, enemy };
};

// Plan 025 (D3) adds the veil step to phase two, after the sweep (021 D7 lets the move lists change; the rotation was volley, sweep, scatter, scatter).
test('the Pyre Mother is a pool boss with D4\'s rotation: volley, volley, scatter, and below half a close sweep joins it, she steps through the veil and she scatters twice', () => {
  assert.equal(mother.boss, 'pool');
  assert.deepEqual(mother.phases, [0.5]);
  assert.deepEqual(mother.moves!.map(phase => phase.map(move => move.attack)), [['volley', 'volley', 'scatter'], ['volley', 'sweep', 'veil', 'scatter', 'scatter']]);
  assert.ok(!mother.moves![0].some(move => move.attack === 'sweep'), 'phase one already has the sweep, so phase two adds nothing');
  assert.equal(mother.moves![1].filter(move => move.attack === 'scatter').length, 2 * mother.moves![0].filter(move => move.attack === 'scatter').length, 'she does not scatter twice as often below half');
  assert.equal(mother.firstFloor, Infinity, 'the pack mix could deal the Mother standing');
  assert.equal(mother.steadfast, true);
  assert.ok(mother.keepAway > 0, 'a ranged boss gives ground');
  assert.deepEqual(mother.look.scale, [1.5, 1.5, 1.5]);
  assert.equal(mother.title, 'The Pyre Mother');
  assert.equal(mother.phaseNotice?.length, mother.moves!.length, 'a notice for each phase');
  assert.ok(mother.phaseNotice![1].length > 0);
  assert.ok(BOSS_POOL.includes('mother'), 'she is not in the pool, so nothing deals her');
  assert.ok(ENEMY_KINDS.includes('mother'));
  assert.equal(enemyStats('mother', 1).hp, 150, 'plan 022 Stage E: 150, down from 215');
  assert.equal(enemyStats('mother', 2).hp, 150 + HIT, 'a pool boss on floor two takes the usual extra blade of vitality');
  assert.ok(CAUSE_LABELS.mother.length > 0 && CUTAWAY_ELLIPSE.mother.radii[0] > CUTAWAY_ELLIPSE.pyre.radii[0], 'her cause label, and a cutaway window larger than the pyre\'s');
});

test('every reach the Mother has fits the smallest goal chamber: a sweep within Stage 0\'s 5.6, rings within its 28%, a lane that holds its own fan', () => {
  const melee = mother.moves!.flat().filter(move => move.attack === 'swing' || move.attack === 'sweep');
  assert.ok(melee.length === 1 && bossReach('mother') === melee[0].strikeRange, 'precondition: her one close sweep is her whole melee reach');
  assert.ok(bossReach('mother') <= 5.6, `a ${bossReach('mother')} sweep does not fit the 45-tile crypt`);
  assert.ok(melee[0].cue.shape === 'ring' && melee[0].cue.radius === melee[0].strikeRange, 'a sweep\'s ring is drawn at its reach');
  // Rings: the most she marks in one scatter, each the move's own radius, as a share of the smallest chamber's floor (45 free tiles).
  const scatters = mother.moves!.flat().filter(move => move.attack === 'scatter');
  assert.equal(scatters.length, 3, 'precondition: three scatters, one in phase one and two in phase two');
  const rings = Math.max(...scatters.map(move => move.scatter!.rings));
  assert.ok(rings >= 1 && rings <= 3, `a scatter marks ${rings} rings, not one to three (D6)`);
  const share = rings * Math.PI * scatters[0].scatter!.pool.radius ** 2 / (45 * TILE * TILE);
  assert.ok(share <= 0.28, `${rings} rings are ${(share * 100).toFixed(1)}% of the 45-tile crypt, past Stage 0's 28%`);
  assert.ok(rings <= HOSTILE_POOL_RINGS, 'a scatter asks for more rings than the game can draw');
  // A lit ring is out before the next scatter lights one (so the Mother alone never holds more than one scatter's rings), but still burning when the next is marked (so the cap counts it).
  for (const move of scatters) {
    const gap = move.tell + RECOVERY.mother;
    assert.ok(move.scatter!.pool.life < gap, `a ring (${move.scatter!.pool.life}s) outlives the ${gap}s to the next scatter`);
    assert.ok(move.scatter!.pool.life > RECOVERY.mother, 'a ring is out before the next scatter is even marked, so the live-ring count never matters');
  }
  // A volley's lane is drawn wide enough for the fan it looses, and no longer than the bolt flies.
  const volleys = mother.moves!.flat().filter(move => move.attack === 'volley');
  assert.equal(volleys.length, 3);
  for (const move of volleys) {
    assert.ok(move.cue.shape === 'lane' && move.cue.length <= move.bolt!.speed * move.bolt!.flight, 'the lane is longer than the bolt flies');
    const fan = move.bolt!.fan!, widest = Math.sin((fan.count - 1) / 2 * fan.spread) * move.cue.length + BOLT_RADIUS;
    assert.ok(widest <= move.cue.width / 2, `the outer bolt of a fan of ${fan.count} runs ${widest.toFixed(2)} off the line, outside a lane ${move.cue.width} wide`);
  }
});

test('against a knight at range she winds up volley, volley, scatter, in that order and again, each with its own tell', () => {
  const run = tells(foe(), { x: 6, z: 0 }, 6);
  assert.equal(run.began.length, 6, 'the Mother began fewer than six tells');
  assert.deepEqual(run.began.map(b => b.attack), ['volley', 'volley', 'scatter', 'volley', 'volley', 'scatter']);
  assert.deepEqual(run.began.map(b => b.tell), [0.8, 0.8, 0.9, 0.8, 0.8, 0.9], 'a move did not use its own tell');
  assert.deepEqual(run.began.map(b => b.phase), [0, 0, 0, 0, 0, 0], 'she changed phase with her vitality untouched');
});

test('below half she scatters twice running, and the close sweep comes only for a knight within its reach', () => {
  // The near knight follows her as she gives ground (he walks faster than she does), so he is always at her feet when a move is chosen.
  const far = tells(foe({ hp: 24, phase: 1, move: 0 }), { x: 6, z: 0 }, 8), near = tells(foe({ hp: 24, phase: 1, move: 0 }), enemy => ({ x: enemy.x + 1.8, z: enemy.z }), 8);
  const sweeps = (run: typeof far) => run.began.filter(b => b.attack === 'sweep').length;
  assert.ok(far.began.every(b => b.phase === 1) && near.began.every(b => b.phase === 1), 'precondition: both fights are in phase two');
  assert.ok(far.began.length === 8 && near.began.length === 8, 'precondition: both fights ran their eight moves');
  // The rotation reads volley, (sweep), veil, scatter, scatter: out of reach the sweep is skipped, so the veil follows the volley and scatters come twice running, then the volley.
  assert.deepEqual(far.began.slice(0, 8).map(b => b.attack), ['volley', 'veil', 'scatter', 'scatter', 'volley', 'veil', 'scatter', 'scatter']);
  assert.equal(sweeps(far), 0, 'she swept a knight 6 away');
  assert.ok(sweeps(near) >= 2, `she swept a knight standing at her feet only ${sweeps(near)} times in eight moves`);
  assert.equal(near.began[0].attack, 'volley');
  assert.equal(near.began[1].attack, 'sweep', 'the sweep did not follow the volley for a knight in reach');
});

test('a fan looses its aimed bolt first and then outward, evenly, and her densest volley fits the twelve-arrow pool', () => {
  const aim = { x: 0, z: -1 };
  assert.deepEqual(fanHeadings(aim), [aim], 'a volley without a fan is one bolt along the aim');
  const fan = fanHeadings(aim, { count: 5, spread: 0.15 });
  assert.equal(fan.length, 5);
  assert.deepEqual(fan[0], aim, 'the aimed bolt is not first');
  const off = (h: { x: number; z: number }) => Math.atan2(aim.x * h.z - aim.z * h.x, aim.x * h.x + aim.z * h.z);
  assert.deepEqual(fan.map(h => +Math.abs(off(h)).toFixed(6)), [0, 0.15, 0.15, 0.3, 0.3], 'the bolts are not 0.15 radians apart, outward from the aim');
  assert.ok(off(fan[1]) * off(fan[2]) < 0 && off(fan[3]) * off(fan[4]) < 0, 'a pair of bolts does not lie either side of the aim');
  for (const h of fan) assert.ok(Math.abs(Math.hypot(h.x, h.z) - 1) < 1e-9, 'a heading is not a unit vector');
  // What the Mother needs: her widest fan, as many volleys in the air as can overlap.
  assert.ok(volleyDemand('mother') <= ARROW_POOL, `her volleys need ${volleyDemand('mother')} arrows and the pool holds ${ARROW_POOL}`);
  const widest = Math.max(...mother.moves!.flat().filter(move => move.bolt).map(move => move.bolt!.fan!.count));
  assert.equal(widest, 5, 'precondition: her densest volley is the five-bolt fan');
  assert.equal(volleyDemand('mother'), 5, 'two of her volleys cannot be in the air together, so the demand is the widest fan');
  assert.equal(volleyDemand('captain'), 0, 'a body with no volley needs no arrows');
});

test('the knight stepping out of a marked ring is what keeps the fire off him: switched off, more rings light on him', () => {
  const run = (avoidMarks: boolean) => {
    const policy: Policy = { ...DEFAULT_POLICY, dodge: 0, avoidMarks };
    const reports = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => simulateArena(seed, 1, ['mother'], policy));
    return { lit: reports.reduce((sum, r) => sum + r.ringsLit, 0), onKnight: reports.reduce((sum, r) => sum + r.ringsOnKnight, 0), seconds: reports.reduce((sum, r) => sum + r.bossSeconds, 0) };
  };
  const steps = run(true), stands = run(false);
  assert.ok(steps.seconds > 0 && stands.seconds > 0, 'precondition: the Mother was fought');
  assert.ok(steps.lit >= 8 && stands.lit >= 8, `precondition: rings were lit (${steps.lit} and ${stands.lit}), so a share of them means something`);
  assert.ok(stands.onKnight > 0, 'precondition: a knight who never steps out has rings light on him');
  assert.ok(steps.onKnight / steps.lit < stands.onKnight / stands.lit, `a knight who steps out of a marked ring had ${steps.onKnight} of ${steps.lit} light on him, no fewer than the ${stands.onKnight} of ${stands.lit} for one who never does`);
});

// Plan 025 (D3): the Mother moves. The operator's playtest: she was always in the corner. She backed straight away from the knight inside `keepAway` and let the walls stop her, and held still
// between 4 and 6 with a clear line, so she backed into a corner and stayed. Now, cornered or still for long, she walks round the knight to open floor (`repositionTarget`, `roamStep`), and below
// half she steps through the veil to it. The archer keeps the old rule: a cornered archer is the knight's reward. The game's wiring is in boss.spec.ts; the sim's average wall distance is in
// `balance:bosses` (`wall`).
// A 9 by 9 tile chamber, tiles 0 to 8 each way: its walls are the lines half a tile outside the outer tiles, so a point's distance to them is read off the box (not off `wallClearance`).
const chamber = () => { const cells = new Set<string>(); for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) cells.add(cellKey(x, z)); return cells; };
const LOW = -TILE / 2, HIGH = 8.5 * TILE;
const fromWalls = (p: { x: number; z: number }) => Math.min(p.x - LOW, HIGH - p.x, p.z - LOW, HIGH - p.z);
const corner = { x: 0, z: 0 }, cornerKnight = { x: 3 / Math.SQRT2, z: 3 / Math.SQRT2 };
const range = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const fedRoam = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...fed(enemy, intent), roam: intent.roam });
/** The body's places, frame by frame, against a knight standing at `knight`, from `start`, in the 9 by 9 chamber. */
const walk = (start: EnemyView, knight: { x: number; z: number }, seconds: number) => {
  const w: World = { cells: chamber(), activeRoom: 1, pathDistance: () => 0 }, at: { x: number; z: number; veil: boolean; windup: number }[] = [];
  let enemy = start;
  for (let frame = 0; frame < seconds / DT; frame++) { const intent = decideEnemy(enemy, knight, w, DT); at.push({ x: intent.x, z: intent.z, veil: intent.veil, windup: intent.windup }); enemy = fedRoam(enemy, intent); }
  return at;
};

test('from a corner with the knight at 3 units, the spot she picks is at least 1.5 from every wall and 4 to 6 from the knight', () => {
  const cells = chamber();
  assert.ok(fromWalls(corner) < REPOSITION_CLEAR && floorAhead(cells, corner, { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }) < CORNERED, 'precondition: she stands in the corner, with no floor to back onto');
  assert.ok(Math.abs(range(corner, cornerKnight) - 3) < 1e-9, 'precondition: the knight is 3 from her');
  const to = repositionTarget(corner, cornerKnight, cells);
  assert.ok(fromWalls(to) >= 1.5, `she picked ${to.x.toFixed(2)}, ${to.z.toFixed(2)}, ${fromWalls(to).toFixed(2)} from a wall`);
  assert.ok(range(to, cornerKnight) >= 4 - 1e-9 && range(to, cornerKnight) <= 6 + 1e-9, `she picked a spot ${range(to, cornerKnight).toFixed(2)} from the knight, not 4 to 6`);
  // `wallClearance` is what the sim averages: it reads the same walls the box does.
  for (const p of [corner, to, { x: 4 * TILE, z: 4 * TILE }]) assert.ok(Math.abs(wallClearance(cells, p.x, p.z) - Math.min(3, fromWalls(p))) < 1e-9, `wallClearance reads ${wallClearance(cells, p.x, p.z)} at ${p.x}, ${p.z}, the box ${fromWalls(p)}`);
});

test('cornered, she walks round the knight to open floor rather than staying in the corner, and the archer, cornered the same way, stays', () => {
  const knight = cornerKnight, path = walk(foe({ ...corner, cooldown: 99 }), knight, 4.5), end = path[path.length - 1];
  assert.ok(fromWalls(corner) < 1, 'precondition: she began in the corner');
  assert.ok(fromWalls(end) >= REPOSITION_CLEAR, `after 4.5 s she stands ${fromWalls(end).toFixed(2)} from a wall, at ${end.x.toFixed(2)}, ${end.z.toFixed(2)}`);
  assert.ok(range(end, knight) >= 3.9 && range(end, knight) <= 6.1, `she ended ${range(end, knight).toFixed(2)} from the knight`);
  // Round him, not across him: her route keeps the cells it walks through `ROUTE_BERTH` (2.2) from him, so she never comes within 2.
  const nearest = Math.min(...path.map(p => range(p, knight)));
  assert.ok(nearest > 2, `she cut ${nearest.toFixed(2)} past the knight on her way`);
  // The archer keeps its cornering rule: from the same corner it backs straight away, which the walls stop.
  const archer = walk({ ...foe({ ...corner, cooldown: 99 }), kind: 'archer', speed: BESTIARY.archer.stats.speed }, knight, 4.5), held = archer[archer.length - 1];
  assert.ok(fromWalls(held) < 1, `the archer left the corner for ${held.x.toFixed(2)}, ${held.z.toFixed(2)}`);
});

test('held still for more than 2.5 s, she moves: not before, and at least two units from where she stood', () => {
  // Open floor, the knight 5 away, her recovery long: she holds between 4 and 6 with a clear line, which used to be for ever.
  const start = foe({ x: 4 * TILE, z: 4 * TILE - 2.5, cooldown: 99 }), knight = { x: 4 * TILE, z: 4 * TILE + 2.5 }, path = walk(start, knight, 5);
  const moved = path.findIndex(p => p.x !== start.x || p.z !== start.z);
  assert.ok(moved >= 0, 'she never moved in five seconds');
  assert.ok(moved * DT >= HOLD_STILL - DT, `she moved after ${(moved * DT).toFixed(2)} s, before ${HOLD_STILL} s of standing still`);
  assert.ok(moved * DT <= HOLD_STILL + 3 * DT, `she stood ${(moved * DT).toFixed(2)} s before moving`);
  const end = path[path.length - 1];
  assert.ok(range(end, start) >= ROAM_STEP - ARRIVED, `she moved only ${range(end, start).toFixed(2)} from where she stood`);
  assert.ok(range(end, knight) >= 3.9 && range(end, knight) <= 6.1, `she ended ${range(end, knight).toFixed(2)} from the knight`);
});

test('below half she steps through the veil: a 0.5 s tell where she stands, then she stands at open floor 4 to 6 from the knight', () => {
  const slot = mother.moves![1].findIndex(move => move.attack === 'veil'), veil = mother.moves![1][slot];
  assert.ok(slot >= 0 && veil.tell === 0.5 && veil.damage === 0, 'precondition: phase two holds a harmless veil step with a 0.5 s tell');
  const path = walk(foe({ ...corner, hp: 24, phase: 1, move: slot }), cornerKnight, 0.8);
  const began = path.findIndex(p => p.windup > 0), stepped = path.findIndex(p => p.veil);
  assert.ok(began === 0, 'precondition: she began the veil tell at once');
  assert.ok(stepped > 0, 'the veil tell ran out and she never stepped');
  assert.ok(Math.abs((stepped - began) * DT - veil.tell) < 2 * DT, `the veil tell lasted ${((stepped - began) * DT).toFixed(2)} s`);
  assert.ok(path.slice(0, stepped).every(p => p.x === corner.x && p.z === corner.z), 'she moved during the tell');
  const to = path[stepped];
  assert.ok(fromWalls(to) >= REPOSITION_CLEAR, `she stepped to ${to.x.toFixed(2)}, ${to.z.toFixed(2)}, ${fromWalls(to).toFixed(2)} from a wall`);
  assert.ok(range(to, cornerKnight) >= 4 - 1e-9 && range(to, cornerKnight) <= 6 + 1e-9, `she stepped to ${range(to, cornerKnight).toFixed(2)} from the knight`);
});

// Plan 025 (D3), in the balance sim, which calls `decideEnemy` exactly as the game does: averaged over a duel, the Mother's distance to the nearest wall was 1.06 for the default knight on floor one
// before she moved (30 duels, the `wall` column of `balance:bosses -- --duels`, 2026-10-08, on Stage A's scale-aware body radius; 0.55 before Stage A) and the plan asks it to rise by at least a unit.
// Measured after: 2.15 over the same 30 duels.
test('in the balance sim she stands, on average over a duel, at least a unit further from the walls than she did (1.06)', () => {
  const walls = Array.from({ length: 10 }, (_, i) => simulateArena(1 + i * 7919, 1, ['mother'], DEFAULT_POLICY).bossWall);
  assert.ok(walls.every(w => w !== null && w > 0), 'precondition: she noticed the knight in every duel');
  const mean = (walls as number[]).reduce((a, b) => a + b, 0) / walls.length;
  assert.ok(mean >= 1.06 + 1 && mean <= 3, `averaged over ten duels she stood ${mean.toFixed(2)} from a wall, not at least 2.06 (and at most the 3 \`wallClearance\` counts to)`);
});
