import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_POLICY, simulateArena, simulateLevel, simulateRun, type Policy } from '../scripts/balance/sim.ts';
import { arenaFloor } from '../app/dungeon-arena.ts';
import { generateFloor } from '../app/dungeon-floor.ts';
import type { EnemyKind } from '../app/dungeon-bestiary.ts';
import { weaponById } from '../app/dungeon-weapon.ts';
import { hurledBlow } from '../app/dungeon-combat.ts';
import { landBlow } from '../app/dungeon-hits.ts';

// The harness is a measuring instrument, so what it owes the suite is not a balance assertion — those
// are for a human reading a batch — but proof that it is measuring the same game twice. A sim that
// drifts between runs, or that quietly stops reaching the stair, would report a tuning change that
// never happened.

const policy = (patch: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...patch });

test('the same seed and policy replay exactly', () => {
  const a = simulateRun(0x51ed, policy());
  const b = simulateRun(0x51ed, policy());
  assert.deepEqual(a, b, 'a seeded run must be reproducible or a batch cannot be compared to a batch');
});

test('different seeds lay different keeps', () => {
  const a = simulateRun(0x1, policy());
  const b = simulateRun(0x2, policy());
  assert.notDeepEqual(a.floors.map(f => f.spawns), b.floors.map(f => f.spawns));
});

test('the boon draft is independent of how often the knight dodges', () => {
  // Both streams come off the seed, but through different generators. Sharing one would make the
  // dodge rate silently deal different cards, which is exactly the confound that made an early skill
  // sweep read backwards.
  const bold = simulateRun(0x7c0de, policy({ dodge: 1 }));
  const timid = simulateRun(0x7c0de, policy({ dodge: 0 }));
  assert.deepEqual(bold.boons, timid.boons);
});

test('fight duration is measured per room fought, inside the floor it was fought on', () => {
  // Plan 016's yardstick for a special. Every cleared floor with kills fought at least one room, and no
  // fight can outlast its floor or number more than the rooms the floor holds.
  const run = simulateRun(0x1, policy());
  for (const floor of run.floors) {
    if (floor.kills) assert.ok(floor.fights.length > 0, `floor ${floor.level} killed ${floor.kills} and recorded no fight`);
    for (const seconds of floor.fights) assert.ok(seconds >= 0 && seconds <= floor.seconds, `fight of ${seconds}s on a ${floor.seconds}s floor`);
  }
});

test('the harness flies archers\' bolts and bills what lands to the archer, from floor two on', () => {
  // A knight that never dodges, so a bolt that is loosed and flies true has nothing between it and him.
  const runs = [1, 2, 3, 4].map(seed => simulateRun(seed * 7919, policy({ dodge: 0 })));
  const deeper = runs.flatMap(run => run.floors.filter(floor => floor.level > 1));
  assert.ok(deeper.length >= runs.length, `the runs barely left floor one (${deeper.length} deeper floors), so this measured nothing`);
  const onFloorOne = runs.reduce((sum, run) => sum + run.floors[0].damage.archer, 0);
  const deeperArcher = deeper.reduce((sum, floor) => sum + floor.damage.archer, 0);
  assert.equal(onFloorOne, 0, 'something billed archer damage on a floor with no archers');
  assert.ok(deeperArcher > 0, 'archers on floors two and three never landed a bolt in the harness');
});

// Plan 018 Stage A: the sim models the three kinds' mechanics before anything deals them. Nothing in the floor
// generator deals a shieldbearer, a pyre or a bonecaller yet, so these fight on `simulateArena` - the arena's
// roster awake in the Tide Gate, the reserve of a caller buried under it - and read what the report counted.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const fight = (roster: EnemyKind[], patch: Partial<Policy> = {}, seeds = SEEDS) => seeds.map(seed => {
  const staged = arenaFloor(seed, 3, roster);
  assert.equal(staged.spawns.filter(s => !s.buried).length, roster.length, `seed ${seed}: the arena did not stage the roster`);
  return simulateArena(seed, 3, roster, policy(patch));
});
const total = (reports: ReturnType<typeof fight>, read: (r: ReturnType<typeof fight>[number]) => number) => reports.reduce((sum, r) => sum + read(r), 0);
/** A pack a caller can hide in: it is not the first body to fall, so the reserve gets to stand up. */
const PACK: EnemyKind[] = ['bonecaller', 'guard', 'guard', 'pyre'];

test('a shieldbearer blocks the Tideblade plain strike, and the fight still ends in a kill', () => {
  const reports = fight(['shieldbearer']);
  for (const r of reports) assert.equal(r.kills, 1, 'the shieldbearer was never brought down, so the block cost nothing to measure');
  assert.ok(total(reports, r => r.blocked) > 0, 'the plain strike never met a raised shield: the sim passes no facing to landBlow');
});

test('a shield turns a knight bolt by the heading the bolt left along, not the line from the knight to the body', () => {
  // Measured 2026-09-30 in the arena at level 3, Keep Crossbow, roster shieldbearer x2 + guard. Seeds 3 and 7 are where the
  // knight has moved or the bolt pierces a second body off his line, so heading and knight-to-body direction disagree on
  // whether the shield faces the bolt: pushing along knight-to-body gave 5 and 11 blocks there, the bolt's heading gives 7 and 10.
  // Every other seed agrees between the two, so they cannot tell them apart and are not asserted.
  const roster: EnemyKind[] = ['shieldbearer', 'shieldbearer', 'guard'];
  const reports = fight(roster, { weapon: weaponById('crossbow') }, [3, 7]);
  for (const r of reports) assert.ok(r.landed > 0, 'no bolt landed, so no push was ever passed to landBlow');
  assert.deepEqual(reports.map(r => r.blocked), [7, 10], 'blocked bolts do not follow the bolt heading: the sim pushes along the knight-to-body line');
});

test('the harpoon breaks a raised shield, so the sim never has a blocked throw to withhold the drag from', () => {
  // The sim's `continue` after a blocked bolt (sim.ts, as dungeon-game.tsx:2011) is parity, not behaviour that can be
  // observed on the harpoon: its blow staggers, and a stagger breaks the guard. Measured 2026-09-30: spear special against
  // shieldbearer rosters on seeds 1-24 gave identical reports with and without the `continue`. What can fail is the reason
  // it cannot matter - the same throw with the stagger taken off is turned aside by the very same shield.
  const harpoon = weaponById('spear').special!;
  const shield = () => ({ kind: 'shieldbearer' as const, hp: 30, windup: 0, cooldown: 0, hitFlash: 0 });
  const facing = { x: -1, z: 0 }, push = { x: 1, z: 0 }, at = { x: 0, z: 0 };
  const throwAt = (stagger: boolean) => landBlow(new Set<string>(), shield(), { ...at }, { ...hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: true, steadfast: false }).blow, stagger }, push, facing);
  assert.equal(throwAt(false).blocked, true, 'the staged shield does not turn a plain blow, so the harpoon test below proves nothing');
  const thrown = hurledBlow(harpoon, { harpoon: true, damage: 6 }, { free: true, steadfast: false });
  assert.equal(thrown.drags, true, 'the staged throw would not drag, so there is no drag to withhold');
  assert.equal(landBlow(new Set<string>(), shield(), { ...at }, thrown.blow, push, facing).blocked, false, 'a shield turned the harpoon aside: its blow no longer staggers');
});

test('the maul swing staggers, so it breaks a shield and records no block', () => {
  const reports = fight(['shieldbearer'], { weapon: weaponById('maul') });
  for (const r of reports) assert.equal(r.kills, 1, 'the shieldbearer was never brought down, so nothing was struck');
  assert.equal(total(reports, r => r.blocked), 0, 'a stagger arm was turned aside by the shield');
});

test('a bonecaller raises, and a raised rattler is cut down and put back while the caller stands', () => {
  const reports = fight(PACK, { callerFirst: false });
  assert.ok(total(reports, r => r.raised) > 0, 'the caller never raised anything: the sim ignores intent.raise');
  assert.ok(total(reports, r => r.reassembled) > 0, 'no raised rattler was cut down and reassembled while the caller stood');
});

test('when the caller falls nothing is left standing or buried, and only the caller pays', () => {
  const reports = fight(PACK, { callerFirst: false }).filter(r => r.raised > 0);
  assert.ok(reports.length >= 2, 'too few seeds let the caller raise, so this measured nothing');
  for (const r of reports) {
    // An arena run ends only when every body, buried ones included, is dead: 'cleared' means the reserve crumbled.
    assert.equal(r.outcome, 'cleared', 'the caller fell and left rattlers behind: the sim skips the crumble in fallOf');
    assert.equal(r.kills, PACK.length, 'a rattler paid a kill, or a body was missed');
  }
});

test('nothing in the reserve of a caller stirs before its first summon tell runs out', () => {
  // Knight and caller alone: the caller falls to the first rush, well inside its 1.2s tell. Had the reserve been awake at
  // the start it would have charged him, been cut down and reassembled, or bitten.
  const reports = fight(['bonecaller']);
  assert.equal(total(reports, r => r.raised), 0, 'precondition: the caller must fall before its first tell runs out');
  assert.equal(total(reports, r => r.reassembled), 0, 'a buried rattler was awake and was struck before it was called');
  assert.equal(total(reports, r => r.damage.rattler), 0, 'a buried rattler bit the knight before it was called');
});

test('a pyre leaves fire that burns a knight who stays in it', () => {
  const reports = fight(['pyre'], { avoidFire: false });
  for (const r of reports) assert.equal(r.kills, 1, 'the pyre never fell, so it left no fire');
  assert.ok(total(reports, r => r.poolDamage.pyre) > 0, 'a pyre fell and the fire never touched a knight standing beside it');
});

test('a knight who steps out of the fire takes less of it', () => {
  // Fire only costs a knight who is still fighting when it lights: pyres alone fall and the fight is over. Measured
  // 2026-09-29 over these eight seeds: 232 with him staying, 88 stepping out.
  const pyres: EnemyKind[] = ['pyre', 'pyre', 'guard', 'guard', 'guard', 'stalker'];
  const stays = total(fight(pyres, { avoidFire: false }), r => r.poolDamage.pyre);
  const leaves = total(fight(pyres, { avoidFire: true }), r => r.poolDamage.pyre);
  assert.ok(stays > 0, 'precondition: staying put must burn');
  assert.ok(leaves < stays, `stepping away cost ${leaves}, staying ${stays}`);
});

test('a knight who goes for the caller first ends the fight sooner than one who swings at the nearest', () => {
  const first = fight(PACK, { callerFirst: true }), nearest = fight(PACK, { callerFirst: false });
  assert.ok(total(nearest, r => r.raised) > 0, 'precondition: the nearest-first knight must meet raised rattlers');
  for (const r of [...first, ...nearest]) assert.notEqual(r.outcome, 'stuck', 'a caller fight hit the floor timeout');
  const seconds = (reports: typeof first) => total(reports, r => r.seconds);
  assert.ok(seconds(first) < seconds(nearest), `caller first took ${seconds(first).toFixed(1)}s, nearest first ${seconds(nearest).toFixed(1)}s`);
});

// Plan 018 Stage B: the same sim on floors the generator really lays, callers dealt into them.
// Floor-three keeps that deal a bonecaller, three of them a chamber away from the gate (layer 1 or 2): 15841, 39598, 79193.
const CALLER_KEEPS = [3, 15841, 39598, 63355, 79193, 126707, 134626];
test('walking into a chamber that holds a bonecaller wakes nothing in its reserve', () => {
  // The entry wake springs every sleeping body in the chamber, so it catches a buried reserve in any chamber, not only an
  // ambush. A caller cut down before its first summon tell raised nothing, so no rattler may have acted at all.
  let quiet = 0;
  for (const seed of CALLER_KEEPS) {
    assert.ok(generateFloor(seed, 3).spawns.some(s => s.kind === 'bonecaller'), `seed ${seed} no longer deals a caller: pick another seed`);
    const report = simulateLevel(seed, 3, policy());
    assert.notEqual(report.outcome, 'stuck', `seed ${seed}: the floor hit its timeout`);
    if (report.raised > 0) continue;
    quiet++;
    assert.equal(report.reassembled, 0, `seed ${seed}: a rattler was cut down before any was called`);
    assert.equal(report.damage.rattler, 0, `seed ${seed}: a rattler bit the knight before any was called`);
  }
  assert.ok(quiet >= 3, `only ${quiet} keeps let the caller fall before its first tell, so this measured nothing`);
});
