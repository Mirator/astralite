import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_POLICY, simulateArena, simulateLevel, simulateRun, type Policy } from '../scripts/balance/sim.ts';
import { arenaFloor } from '../app/dungeon-arena.ts';
import { generateFloor } from '../app/dungeon-floor.ts';
import type { EnemyKind } from '../app/dungeon-bestiary.ts';
import { weaponById } from '../app/dungeon-weapon.ts';
import { freshMeta, type Meta } from '../app/dungeon-meta.ts';
import { hurledBlow } from '../app/dungeon-combat.ts';
import { landBlow } from '../app/dungeon-hits.ts';
import { asReaper, TEST_BOSS, TEST_SCATTERER } from './fixtures/test-boss.ts';

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

// --- Plan 019 -------------------------------------------------------------------------------------------
const bought = (upgrades: Meta['upgrades']): Meta => ({ ...freshMeta(), upgrades });

test('a policy that carries a meta starts every floor with what it bought', () => {
  // The same seed deals the same boons to both, so what separates the two bars is the purchase and nothing else.
  const plain = simulateLevel(0x1, 1, policy()), lunged = simulateLevel(0x1, 1, policy({ meta: bought({ lungs: 3 }) }));
  assert.ok(plain.maxHpAfter >= 100, 'precondition: a fresh knight ends the floor on at least a 100 bar');
  assert.equal(lunged.maxHpAfter - plain.maxHpAfter, 30, 'a policy meta did not reach the run');
  const arena = (meta?: Meta) => simulateArena(0x1, 1, ['guard'], policy({ meta })).maxHpAfter;
  assert.equal(arena(bought({ lungs: 1 })) - arena(), 10);
});

test('the sim offers as many cards as the run it plays is owed', () => {
  const sizes: number[] = [];
  const watch = (offer: { id: string }[]) => { sizes.push(offer.length); return offer[0].id; };
  simulateRun(0x7c0de, policy({ meta: bought({ eye: 1 }), pickBoon: watch }));
  assert.ok(sizes.length > 0, 'precondition: the run drafted at least once');
  assert.deepEqual([...new Set(sizes)], [4], 'a knight with Keen Eye was not offered four cards in the sim');
  sizes.length = 0;
  simulateRun(0x7c0de, policy({ pickBoon: watch }));
  assert.ok(sizes.length > 0);
  assert.deepEqual([...new Set(sizes)], [3], 'a knight without Keen Eye was not offered three cards in the sim');
});

test('a run report says what banking it would pay', () => {
  // Written out, not recomputed: a pearl a kill, 15 a floor behind him, 25 for getting out, and (plan 021) ten for each boss the floors say fell.
  const felled = (report: ReturnType<typeof simulateRun>) => report.floors.filter(floor => floor.bossHpLeft !== null).length;
  const won = simulateRun(0x1, policy());
  assert.equal(won.outcome, 'escaped', 'precondition: the default knight escapes this seed');
  assert.equal(felled(won), 3, 'precondition: the escape went through three bosses');
  assert.equal(won.pearls, won.kills + 3 * 15 + 25 + 3 * 10, 'an escaped run report does not carry what a win pays');
  // Seeds 207 and 158381 are lost by the weak knight on floors 2 and 3. Plan 021 re-picks the first whenever the pool grows (the bosses a seed is dealt change with it): Stage B moved it from 15839, Stage C from 159.
  for (const [seed, floor] of [[207, 2], [158381, 3]] as const) {
    const lost = simulateRun(seed, policy({ dodge: 0, reaction: 0.6 }));
    assert.deepEqual([lost.outcome, lost.floor], ['died', floor], `precondition: seed ${seed} is lost on floor ${floor}`);
    assert.equal(felled(lost), floor - 1, `precondition: a run lost on floor ${floor} felled the ${floor - 1} bosses behind it`);
    assert.equal(lost.pearls, lost.kills + (floor - 1) * 15 + (floor - 1) * 10, `a run lost on floor ${floor} does not report what a death pays`);
  }
});

// Plan 021 Stage A: the sim models a boss's moves and phases before anything deals one. A test archetype (tests/fixtures/test-boss.ts)
// stands in for the reaper, the one kind nothing deals, and fights on `simulateArena`.
test('a boss with two phases hurts the knight, changes phase once, and the report says what it did and how he stood when it fell', () => {
  asReaper(TEST_BOSS, () => {
    const reports = fight(['reaper'], { dodge: 0 });
    for (const r of reports) {
      assert.equal(r.bossKind, 'reaper', 'the report does not name the boss');
      assert.ok(r.bossSeconds > 0, 'the boss never noticed the knight, so nothing was fought');
      assert.ok(r.phaseChanges <= 1, `a boss with one threshold changed phase ${r.phaseChanges} times`);
      assert.equal(r.bossDeaths, r.outcome === 'died' ? 1 : 0, 'the knight died to the only body on the floor and the report did not say so');
    }
    assert.ok(total(reports, r => r.bossDamage) > 0, 'the boss never hurt the knight: bossDamage is not read off its blows');
    assert.ok(total(reports, r => r.phaseChanges) > 0, 'no boss ever changed phase: the sim never applies intent.phaseChange');
    const fell = reports.filter(r => r.bossHpLeft !== null);
    assert.ok(fell.length >= 3, `only ${fell.length} bosses fell, too few to check how the knight stood`);
    for (const r of fell) {
      // He took nothing but the boss's blows and gained nothing but the kill's, so at its fall he held what he started with less what it
      // dealt. (The arena's gate is cleared from the start and pays no top-up, so this pins the value at the fall; that it is read before
      // a goal chamber's top-up is for Stage B, which has a boss in one.)
      assert.ok(r.bossDamage > 0, 'precondition: the boss took vitality, so a figure that ignored it would differ');
      assert.ok(Math.abs(r.bossHpLeft! - (r.maxHpAfter - r.bossDamage) / r.maxHpAfter * 100) < 1e-6, `the knight stood at ${r.bossHpLeft}% when it fell, not ${((r.maxHpAfter - r.bossDamage) / r.maxHpAfter * 100).toFixed(2)}%`);
    }
  });
});

test('the rings a scatter marks become fire that bites the knight and bills the boss that marked them', () => {
  asReaper(TEST_SCATTERER, () => {
    const reports = fight(['reaper'], { dodge: 0, avoidFire: false });
    // The boss does nothing but scatter, so every point it took off the knight came off the ground.
    assert.ok(total(reports, r => r.bossSeconds) > 0, 'precondition: the boss fought');
    assert.ok(total(reports, r => r.poolDamage.reaper) > 0, 'the rings a scatter marked never became fire that bit the knight');
    for (const r of reports) assert.equal(r.damage.reaper, r.poolDamage.reaper, 'a scatterer dealt damage that was not fire');
    assert.equal(total(reports, r => r.bossDamage), total(reports, r => r.poolDamage.reaper), 'the fire was not billed to the boss');
  });
});
