// Plan 025 Stage G (D12 b): the bomber, the first new ordinary kind. Its row, the rule `decideEnemy` runs for it (a scatter of one ring, its own), where the bomb comes down and what it does there
// (`bombMarks`, `bombLands`), where the pack mix deals it, and that the balance sim models it. The game's wiring is in tests/browser/arena-kinds.spec.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BESTIARY, eliteKind, ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { bombLands, bombMarks, decideEnemy, enemyStats, NOTICE_TIME, ORDINARY_DAMAGE, RECOVERY, scaledDamage, volleyDemand, type EnemyIntent, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { cellKey, generateFloor, PACK_MIX, packSource } from '../app/dungeon-floor.ts';
import { HOSTILE_POOL_RINGS, poolStep } from '../app/dungeon-projectile.ts';
import { CAUSE_LABELS } from '../app/dungeon-run-summary.ts';
import { CUTAWAY_ELLIPSE } from '../app/dungeon-occlusion.ts';
import { wavedFloor } from '../app/dungeon-waves.ts';
import { sweepSeeds } from '../scripts/balance/census.ts';
import { DEFAULT_POLICY, simulateArena } from '../scripts/balance/sim.ts';

const bomber = BESTIARY.bomber;
const DT = 1 / 60;
const open = () => { const cells = new Set<string>(); for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) cells.add(cellKey(x, z)); return cells; };
const world = (): World => ({ cells: open(), activeRoom: 1, pathDistance: () => 0 });
const foe = (patch: Partial<EnemyView> = {}): EnemyView => ({ kind: 'bomber', x: 0, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: bomber.stats.tell, speed: bomber.stats.speed, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 6, maxHp: 6, move: 0, phase: 0, change: 0, ...patch });
const fed = (enemy: EnemyView, intent: EnemyIntent): EnemyView => ({ ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice });

test('the bomber is an ordinary kind from floor two whose one attack is a scatter of one ring of its own, with a cause, a cutaway and no bolts', () => {
  assert.ok(ENEMY_KINDS.includes('bomber'));
  assert.equal(bomber.boss, undefined);
  assert.equal(bomber.moves, undefined, 'a bomber with moves would mark off its move, not its row');
  assert.equal(bomber.attack, 'scatter');
  assert.equal(bomber.scatter?.rings, 1, 'a bomb is one ring');
  assert.equal(bomber.firstFloor, 2, 'floor one teaches the melee kinds before anything throws');
  assert.ok(bomber.keepAway > 0 && bomber.attackRange > bomber.keepAway, 'it hangs back and lobs from beyond where it gives ground');
  assert.equal(bomber.steadfast, false, 'an early blow should break its throw');
  assert.ok(eliteKind('bomber'));
  assert.ok(CAUSE_LABELS.bomber.length > 0);
  assert.ok(CUTAWAY_ELLIPSE.bomber.radii[0] > 0);
  assert.equal(volleyDemand('bomber'), 0, 'a bomb is not an arrow: it draws on the fire rings, not the arrow pool');
});

test('a bomber begins its tell with the knight inside its reach and lands the bomb only when the whole tell has run, once', () => {
  const w = world(), knight = { x: 5, z: 0 };
  let enemy = foe(), began = -1, landed = -1, landings = 0;
  for (let frame = 0; frame < 400; frame++) {
    const intent = decideEnemy(enemy, knight, w, DT);
    if (enemy.windup === 0 && intent.windup > 0 && began < 0) { began = frame; assert.equal(intent.sound, 'warn', 'the tell begins without its warning'); assert.equal(intent.scatter, false, 'the bomb lands on the frame its tell begins'); }
    if (intent.scatter) { landings++; if (landed < 0) landed = frame; }
    enemy = fed(enemy, intent);
    if (landed >= 0 && frame > landed + 5) break;
  }
  // The precondition: a tell began at all, against a knight standing well inside its reach.
  assert.ok(began >= 0, 'the bomber never began a tell at a knight 5 away');
  assert.ok(landed > began, 'the bomb never landed');
  assert.ok((landed - began) * DT >= bomber.stats.tell - DT, `the bomb landed with no tell: ${((landed - began) * DT).toFixed(2)} s after it began, against a ${bomber.stats.tell} s tell`);
  assert.equal(landings, 1, 'one tell brought more than one bomb down');
  assert.ok(enemy.cooldown > RECOVERY.bomber - 10 * DT && enemy.cooldown < RECOVERY.bomber, 'the bomber does not recover after its throw');
});

test('a bomber does not throw at a knight beyond its reach, nor through a wall', () => {
  const w = world();
  let enemy = foe();
  for (let frame = 0; frame < 120; frame++) { const intent = decideEnemy(enemy, { x: 0, z: bomber.attackRange + 1 }, w, DT); assert.equal(intent.windup, 0, 'it began a tell at a knight beyond its reach'); enemy = { ...fed(enemy, intent), x: 0, z: 0 }; }
  const walled = world(); for (let z = -9; z <= 9; z++) walled.cells.delete(cellKey(2, z));
  enemy = foe();
  for (let frame = 0; frame < 120; frame++) { const intent = decideEnemy(enemy, { x: 5 * 1, z: 0 }, walled, DT); assert.equal(intent.windup, 0, 'it began a tell through a wall'); enemy = { ...fed(enemy, intent), x: 0, z: 0 }; }
});

test('the bomb is marked on the knight where he stands when the tell begins, and only on a fire ring the game can still draw', () => {
  const at = { x: 3.2, z: -1.5 };
  assert.deepEqual(bombMarks('bomber', at, { hostile: 0, own: 0 }), [at]);
  assert.deepEqual(bombMarks('bomber', at, { hostile: HOSTILE_POOL_RINGS - 1, own: 0 }), [at], 'the last free ring was not used');
  assert.deepEqual(bombMarks('bomber', at, { hostile: HOSTILE_POOL_RINGS - 2, own: 2 }), [], 'a seventh ring was marked: the game draws six, so this bomb would land with no ring drawn');
  // A boss marks off its move (and a guard has nothing to throw).
  assert.deepEqual(bombMarks('mother', at, { hostile: 0, own: 0 }), []);
  assert.deepEqual(bombMarks('guard', at, { hostile: 0, own: 0 }), []);
});

test('the blast catches the knight inside the ring and nowhere else, and the fire it leaves bites after the blast and burns out', () => {
  const at = { x: 0, z: 0 }, fire = bomber.scatter!.pool;
  assert.equal(bombLands('bomber', at, { x: fire.radius - .05, z: 0 })!.hurts, true, 'the knight standing in the ring was not caught');
  assert.equal(bombLands('bomber', at, { x: fire.radius + .05, z: 0 })!.hurts, false, 'the knight who stepped out of the ring was caught');
  assert.equal(bombLands('guard', at, at), null);
  const { pool } = bombLands('bomber', at, at)!;
  assert.deepEqual([pool.x, pool.z, pool.radius, pool.damage], [0, 0, fire.radius, fire.damage]);
  // The first bite waits an interval, so the blast and the fire never land on him in one frame.
  assert.equal(poolStep(pool, DT).bites, 0, 'the fire bit on the frame the bomb landed');
  // It burns out: stepped frame by frame, its life reaches nothing within its own life and a frame.
  let burning = { ...pool }, frames = 0;
  while (burning.life > 0 && frames < 10_000) { const step = poolStep(burning, DT); burning = { ...burning, life: step.life, timer: step.timer }; frames++; }
  assert.ok(burning.life <= 0 && frames * DT <= fire.life + DT, `the bomber's fire never burns out (${(frames * DT).toFixed(1)} s and still burning)`);
  // And it is short: a patch that holds the ground for a breath, not a pyre's death fire.
  assert.ok(pool.life > 0 && pool.life <= 2, `the bomber's fire is not short: ${pool.life} s`);
});

test("the bomb's blast costs the bomber's own damage, ORDINARY_DAMAGE and the floor step included", () => {
  for (const level of [1, 2, 3]) assert.equal(enemyStats('bomber', level).damage, scaledDamage(bomber.stats.damage * ORDINARY_DAMAGE, level, 0.15));
  assert.ok(enemyStats('bomber', 2).damage > bomber.stats.damage, 'the ordinary damage scale did not reach the bomber');
});

// The deal: floor one never holds a bomber (its `firstFloor`), and floors two and three hold it only where a pack is drawn from the middle or late mix - wave one of such a chamber, or a later wave
// (`WAVE_TABLE` draws from the late mix). Over the balance sweep's floors, so a share change shows up here as well as in the census.
test('a bomber is dealt only from floor two down, and only into chambers whose pack is drawn from the middle or late mix', () => {
  assert.ok(PACK_MIX.middle.bomber! > 0 && PACK_MIX.late.bomber! > 0, 'the bomber has no share, so it is never dealt');
  const met: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const level of [1, 2, 3]) for (const seed of sweepSeeds(level)) {
    const floor = wavedFloor(generateFloor(seed, level), seed, level), goalLayer = floor.rooms[floor.goal].layer;
    for (const spawn of floor.spawns.filter(s => s.kind === 'bomber')) {
      met[level]++;
      assert.notEqual(level, 1, `a bomber was dealt on floor one (seed ${seed}, room ${spawn.room})`);
      const room = floor.rooms[spawn.room], source = packSource(room.id === floor.weaponDrop.room ? { ...room, reward: null } : room, level, goalLayer);
      assert.ok(source === 'middle' || source === 'late', `a bomber was dealt into a ${source} chamber (seed ${seed}, floor ${level}, room ${spawn.room})`);
    }
  }
  // The precondition: the deeper floors deal it, or the floor-one check above holds of a kind nothing deals.
  assert.ok(met[2] >= 10 && met[3] >= 10, `too few bombers dealt to judge the deal: ${met[2]} on floor two, ${met[3]} on floor three`);
});

// The sim's model (scripts/balance/sim.ts): two bombers behind a shieldbearer and a warden, which keep the knight busy, against a knight who never steps out of a ring and then the default knight, over ten
// seeds. What lands is billed as the bomber's blow. A bomber alone is cut down before its first bomb lands (it is frail: that is the answer to it), so it is fought behind a front.
test("the balance sim lands a bomber's bombs, bills each blast at its damage and steps the default knight out of the ring more often than not", () => {
  const roster = ['shieldbearer', 'warden', 'bomber', 'bomber'] as const, seeds = Array.from({ length: 10 }, (_, i) => 11 + i);
  const tally = (policy: typeof DEFAULT_POLICY) => seeds.map(seed => simulateArena(seed, 2, roster, policy)).reduce((sum, r) => ({ landed: sum.landed + r.bombsLanded, on: sum.on + r.bombsOnKnight, blast: sum.blast + r.damage.bomber - r.poolDamage.bomber }), { landed: 0, on: 0, blast: 0 });
  const still = tally({ ...DEFAULT_POLICY, dodge: 0, avoidMarks: false });
  assert.ok(still.landed >= 10, `too few bombs landed to judge: ${still.landed}`);
  assert.ok(still.on > 0, 'no bomb caught a knight who never steps out of a ring');
  assert.equal(still.blast, still.on * enemyStats('bomber', 2).damage, "a blast did not cost the bomber's own damage");
  const reading = tally(DEFAULT_POLICY);
  assert.ok(reading.landed >= 10, `too few bombs landed against the default knight to judge: ${reading.landed}`);
  assert.ok(reading.on / reading.landed < still.on / still.landed, `the default knight is caught as often as one who never steps out: ${reading.on}/${reading.landed} against ${still.on}/${still.landed}`);
  console.log(`bombs on the knight: never stepping out ${still.on}/${still.landed}, default ${reading.on}/${reading.landed}`);
});
