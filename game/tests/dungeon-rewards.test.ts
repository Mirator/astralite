import assert from 'node:assert/strict';
import test from 'node:test';
import { armDeal, ARM_ODDS, dealRewards, generateFloor, type Floor } from '../app/dungeon-floor.ts';
import { wavedFloor } from '../app/dungeon-waves.ts';
import { ARM_ORDER, armFor, armOffer } from '../app/dungeon-meta.ts';
import { STARTING_WEAPON, type WeaponId } from '../app/dungeon-weapon.ts';
import { pickDoor } from '../scripts/balance/sim.ts';

// Plan 025 Stage F (D12 c, D9): the Boon, Pearls and arm doors, dealt on top of the generator from salted streams.
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const laid = (seed: number, level: number) => wavedFloor(generateFloor(seed, level), seed, level);
const plainJson = (f: Floor) => JSON.stringify({ ...f, cells: [...f.cells], roomByCell: [...f.roomByCell] });

test('Boon and Pearls doors are dealt from their own stream: one chamber a layer at most, never the gate, a shrine or the stair hall, and a layer keeps the mend and the purse it offered', () => {
  let boons = 0, pearls = 0, layers = 0;
  for (const level of [1, 2, 3]) for (const seed of SEEDS) {
    const plain = laid(seed, level), before = plainJson(plain), dealt = dealRewards(plain, seed, level);
    assert.equal(plainJson(plain), before, `level ${level} seed ${seed}: dealing the rewards changed the floor it was handed`);
    assert.equal(plainJson(generateFloor(seed, level)), plainJson(generateFloor(seed, level)), 'precondition: the generator repeats');
    assert.deepEqual(dealRewards(laid(seed, level), seed, level).rooms, dealt.rooms, `level ${level} seed ${seed}: dealt twice, dealt differently`);
    const goalLayer = plain.rooms[plain.goal].layer;
    for (let layer = 0; layer <= goalLayer; layer++) {
      const was = plain.rooms.filter(r => r.layer === layer), now = was.map(r => dealt.rooms[r.id]);
      const changed = now.filter((r, i) => r.reward !== was[i].reward);
      layers++;
      assert.ok(changed.length <= 1, `level ${level} seed ${seed} layer ${layer}: ${changed.length} chambers changed reward`);
      for (const r of changed) {
        assert.ok(r.reward === 'boon' || r.reward === 'pearls', `level ${level} seed ${seed}: room ${r.id} was dealt ${r.reward}`);
        assert.ok(layer >= 2 && layer < goalLayer && r.role === 'path' && r.encounter !== 'sanctuary', `level ${level} seed ${seed}: room ${r.id} (${r.role}, ${r.encounter}, layer ${layer}) is no place for a ${r.reward} door`);
        if (r.reward === 'boon') boons++; else pearls++;
        // The chamber turned is one whose old reward a sibling also pays, when the layer has one: both of the old choices stay.
        const old = new Set(was.map(w => w.reward).filter(Boolean)), kept = new Set(now.map(n => n.reward).filter(x => x === 'mend' || x === 'cache'));
        if (was.filter(w => w.reward).length - 1 >= old.size) assert.equal(kept.size, old.size, `level ${level} seed ${seed} layer ${layer}: turning room ${r.id} took away a choice the layer had`);
      }
    }
    assert.equal(dealt.armRack, undefined, `level ${level} seed ${seed}: an arm was dealt without one being asked for`);
  }
  console.log(`  ${boons} Boon and ${pearls} Pearls doors over ${layers} layers of 120 floors`);
  assert.ok(boons > 20 && pearls > 60, `too few new doors were dealt (${boons} Boon, ${pearls} Pearls) for them to be a choice`);
});

/** The run's arm on each floor, as the game and the sim ask it: every arm owned, the Tideblade in hand unless `inHand` says otherwise. */
const runArms = (runSeed: number, owned: readonly WeaponId[] = ARM_ORDER, inHand: WeaponId = STARTING_WEAPON) => [1, 2, 3].map(level => armFor(runSeed, level, owned, inHand));
const RUNS = Array.from({ length: 2000 }, (_, i) => 0x51ed + i * 7919);

test('the arm chamber is rare and at most one a run: floor two or three only, never the arm in hand, only an arm the save owns', () => {
  let dealt = 0;
  for (const runSeed of RUNS) {
    const arms = runArms(runSeed), offered = arms.filter(arm => arm !== null);
    assert.ok(offered.length <= 1, `run ${runSeed} was dealt ${offered.length} arm chambers: ${arms.join(', ')}`);
    assert.equal(arms[0], null, `run ${runSeed} was dealt an arm on floor one`);
    if (offered.length) dealt++;
    for (const arm of offered) assert.notEqual(arm, STARTING_WEAPON, `run ${runSeed} offered the arm in hand`);
    // The arm in hand is never offered, whichever it is; an arm not owned never is either.
    const held = runArms(runSeed, ARM_ORDER, 'maul');
    assert.ok(!held.includes('maul'), `run ${runSeed} offered the maul to a knight holding it`);
    const two = runArms(runSeed, ['tideblade', 'fangs'], 'fangs');
    assert.ok(two.every(arm => arm === null || arm === 'tideblade'), `run ${runSeed} offered an arm the save does not own: ${two.join(', ')}`);
    assert.deepEqual(runArms(runSeed, [STARTING_WEAPON]), [null, null, null], `run ${runSeed}: a fresh save, holding its only arm, was offered one`);
  }
  const rate = dealt / RUNS.length;
  console.log(`  arm chambers dealt in ${(rate * 100).toFixed(1)}% of ${RUNS.length} runs (ARM_ODDS ${ARM_ODDS})`);
  assert.ok(rate > ARM_ODDS * .8 && rate < ARM_ODDS * 1.2, `${(rate * 100).toFixed(1)}% of runs were dealt an arm chamber against ARM_ODDS ${ARM_ODDS}`);
  assert.equal(armOffer(['tideblade'], 'tideblade', .5), null);
  assert.equal(armDeal(RUNS[0]), armDeal(RUNS[0]) === null ? null : armDeal(RUNS[0]), 'the deal is not a pure function of the seed');
});

test('the reward log: walked by the balance knight\'s own door choice, the arm\'s door is offered in at most 15% of runs, and it stands where the generator reserved it', () => {
  let dealt = 0, offered = 0;
  for (const runSeed of RUNS) {
    const arms = runArms(runSeed), level = arms.findIndex(arm => arm !== null) + 1;
    if (level < 2) continue;
    dealt++;
    const floorSeed = runSeed + level - 1, floor = dealRewards(laid(floorSeed, level), floorSeed, level, arms[level - 1]);
    assert.ok(floor.armRack, `run ${runSeed}: an arm was asked for on floor ${level} and none was laid`);
    assert.equal(floor.armRack.room, floor.weaponDrop.room, 'the rack is not on the reserved spot');
    assert.equal(floor.armRack.kind, arms[level - 1]);
    const armRoom = floor.rooms.findIndex(r => r.reward === 'arm');
    assert.equal(armRoom, floor.weaponDrop.room, `run ${runSeed}: the arm door is not the reserved chamber's`);
    assert.equal(floor.rooms.filter(r => r.reward === 'arm').length, 1);
    // Walk the floor as the `explore` knight leaves each cleared chamber (`pickDoor`), from the gate to the stair hall: the arm is offered if a chamber he stood in has a door to it.
    let room = 0, seen = false;
    for (let steps = 0; room !== floor.goal && steps < 20; steps++) {
      if (floor.doors.some(d => d.from === room && d.to === armRoom)) seen = true;
      room = pickDoor(floor, room, true)!.to;
    }
    assert.equal(room, floor.goal, 'the walk did not reach the stair hall');
    if (seen) offered++;
  }
  const rate = offered / RUNS.length;
  console.log(`  arm door offered in ${(rate * 100).toFixed(1)}% of ${RUNS.length} runs (${offered} of the ${dealt} dealt one, ${(offered / dealt * 100).toFixed(0)}%), every arm owned and the knight surviving`);
  assert.ok(dealt > 100, `precondition: only ${dealt} runs were dealt an arm`);
  assert.ok(rate <= .15, `the arm was offered in ${(rate * 100).toFixed(1)}% of runs, over D9's 15%`);
  assert.ok(rate >= .05, `the arm was offered in only ${(rate * 100).toFixed(1)}% of runs: rare has become never`);
});
