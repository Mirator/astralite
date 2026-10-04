import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFloor, type Spawn } from '../app/dungeon-floor.ts';
import { BESTIARY, ELITE_MODIFIERS, ELITES, eliteKind, elitesFor, ENEMY_KINDS, deathPoolOf, type EliteModifier } from '../app/dungeon-bestiary.ts';
import { cellKey } from '../app/dungeon-floor.ts';
import { decideEnemy, eliteStats, enemyStats, NOTICE_TIME, type EnemyView, type World } from '../app/dungeon-enemy.ts';
import { allElite, dealElites, dealWaves, ELITE_PER_WAVE, ELITE_RATE, parseElite, wavedFloor } from '../app/dungeon-waves.ts';
import { createRun, resolveKill, XP_PER_ELITE, XP_PER_ENEMY } from '../app/dungeon-sim.ts';
import { bank, ELITE_PEARLS, freshMeta, pearlsFor } from '../app/dungeon-meta.ts';
import { deathPool, poolCatches, poolStep } from '../app/dungeon-projectile.ts';
import { parseRun, type RunEnd } from '../app/dungeon-save.ts';

// Plan 022 Stage C (D7, D8, D9). The modifiers' numbers, who is dealt one, what an elite pays and what its death leaves. The look (the glow, the eyes, the bar's pip) is in dungeon-enemy-view.test.ts;
// the running game's wiring is tests/browser/elites.spec.ts.

const SEEDS = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13);
const spawnsOf = (seed: number, level: number) => dealWaves(generateFloor(seed, level), seed, level);

test('each modifier changes the numbers D7 says and no others, on every floor, for every kind that can carry one', () => {
  const carriers = ENEMY_KINDS.filter(eliteKind);
  assert.deepEqual(carriers, ['guard', 'stalker', 'warden', 'archer', 'shieldbearer', 'reaper', 'pyre'], 'precondition: the kinds that can be elite are the ordinary ones, not the bosses, the caller or its rattlers');
  for (const kind of carriers) for (const level of [1, 2, 3]) {
    const plain = enemyStats(kind, level);
    assert.deepEqual(eliteStats(kind, level), plain, 'no modifier is the plain body');
    const hasted = eliteStats(kind, level, 'hasted'), armoured = eliteStats(kind, level, 'armoured'), wrathful = eliteStats(kind, level, 'wrathful'), volatile = eliteStats(kind, level, 'volatile');
    assert.equal(armoured.hp, plain.hp * 2, `${kind} floor ${level}: armoured is not twice the vitality`);
    assert.deepEqual({ ...armoured, hp: plain.hp }, plain, `${kind} floor ${level}: armoured changed more than vitality`);
    assert.equal(hasted.speed, plain.speed * 1.35, `${kind} floor ${level}: hasted is not 1.35 times as fast`);
    assert.equal(hasted.tell, plain.tell * 0.8, `${kind} floor ${level}: hasted does not tell in 0.8 of the time`);
    assert.deepEqual({ ...hasted, speed: plain.speed, tell: plain.tell }, plain, `${kind} floor ${level}: hasted changed more than speed and tell`);
    assert.equal(wrathful.damage, Math.round(plain.damage * 1.4), `${kind} floor ${level}: wrathful is not 1.4 times the damage`);
    assert.ok(wrathful.damage > plain.damage, `${kind} floor ${level}: wrathful does not hit harder`);
    assert.deepEqual({ ...wrathful, damage: plain.damage }, plain, `${kind} floor ${level}: wrathful changed more than damage`);
    assert.deepEqual(volatile, plain, `${kind} floor ${level}: volatile changes no number: it leaves fire`);
  }
});

test('a hasted body begins its blow in 0.8 of the tell, as decideEnemy runs it, and walks 1.35 times as far', () => {
  const cells = new Set<string>(); for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) cells.add(cellKey(x, z));
  const world: World = { cells, activeRoom: 1, pathDistance: (x, z) => Math.hypot(x, z) };
  const view = (kind: 'guard' | 'stalker', modifier: EliteModifier | undefined, at: number): EnemyView => {
    const stats = eliteStats(kind, 1, modifier);
    return { kind, x: at, z: 0, room: 1, cooldown: 0, hitFlash: 0, windup: 0, lunge: 0, tell: stats.tell, speed: stats.speed, aim: { x: 1, z: 0 }, anchor: { x: at, z: 0 }, notice: NOTICE_TIME, hp: stats.hp, maxHp: stats.hp, move: 0, phase: 0, change: 0 };
  };
  for (const kind of ['guard', 'stalker'] as const) {
    // Close enough to start the blow: the tell the body winds up for is the one it was built with.
    const plain = decideEnemy(view(kind, undefined, 1), { x: 0, z: 0 }, world, 0.016), hasted = decideEnemy(view(kind, 'hasted', 1), { x: 0, z: 0 }, world, 0.016);
    assert.ok(plain.windup > 0 && hasted.windup > 0, `precondition: the ${kind} began a blow, plain and hasted`);
    assert.ok(Math.abs(hasted.windup - plain.windup * 0.8) < 1e-9, `the hasted ${kind} winds up ${hasted.windup}, not 0.8 of the plain ${plain.windup}`);
    assert.ok(hasted.windup < plain.windup);
  }
  // Out of reach and closing in: the same frame carries it 1.35 times as far.
  const far = (modifier?: EliteModifier) => { const intent = decideEnemy(view('guard', modifier, 9), { x: 0, z: 0 }, world, 0.1); return 9 - intent.x; };
  assert.ok(far() > 0, 'precondition: the plain guard walked toward the knight');
  assert.ok(Math.abs(far('hasted') - far() * 1.35) < 1e-9, `the hasted guard stepped ${far('hasted')} against the plain one's ${far()}`);
});

test('no boss, rattler or bonecaller is dealt an elite, over 1,000 seeds on every floor, at the rate it is dealt and at a rate that asks for everyone', () => {
  const seen = { boss: 0, rattler: 0, bonecaller: 0 };
  for (const level of [1, 2, 3]) for (const seed of SEEDS) {
    const spawns = spawnsOf(seed, level);
    for (const rate of [ELITE_RATE[level], 1]) for (const spawn of dealElites(spawns, seed, level, rate, 99)) {
      if (!spawn.elite) continue;
      assert.ok(eliteKind(spawn.kind), `seed ${seed} floor ${level}: a ${spawn.kind} was dealt ${spawn.elite}`);
      assert.ok(!BESTIARY[spawn.kind].boss && spawn.kind !== 'rattler' && spawn.kind !== 'bonecaller', `seed ${seed} floor ${level}: a ${spawn.kind} was dealt ${spawn.elite}`);
      assert.ok(!spawn.buried, `seed ${seed} floor ${level}: a buried body was dealt ${spawn.elite}`);
    }
    for (const spawn of spawns) { if (BESTIARY[spawn.kind].boss) seen.boss++; if (spawn.kind === 'rattler') seen.rattler++; if (spawn.kind === 'bonecaller') seen.bonecaller++; }
  }
  // The check is only meaningful if the floors held what it keeps elites off.
  assert.ok(seen.boss > 2000 && seen.rattler > 500 && seen.bonecaller > 100, `precondition: only ${JSON.stringify(seen)} of the bodies elites are kept off were dealt`);
  // And at a rate that asks for everyone, everyone who can be is.
  const all = dealElites(spawnsOf(SEEDS[0], 3), SEEDS[0], 3, 1, 99);
  assert.ok(all.some(s => s.elite) && all.every(s => !!s.elite === (!s.buried && elitesFor(s.kind).length > 0)), 'at rate 1 every eligible standing body is elite and nothing else is');
  assert.deepEqual(elitesFor('rattler'), []); assert.deepEqual(elitesFor('king'), []); assert.deepEqual(elitesFor('bonecaller'), []);
});

test('a pyre is never volatile, since it leaves a fire on its own', () => {
  assert.ok(!elitesFor('pyre').includes('volatile'));
  assert.deepEqual(elitesFor('guard'), [...ELITE_MODIFIERS]);
  assert.equal(deathPoolOf('pyre', 'hasted'), BESTIARY.pyre.deathPool);
});

test('the rates are held per floor over 1,000 seeds: none on floor one, 15% of eligible bodies on floor two and 25% on floor three, before the caps', () => {
  const measured: Record<number, { eligible: number; uncapped: number; capped: number; widest: number }> = {};
  for (const level of [1, 2, 3]) {
    let eligible = 0, uncapped = 0, capped = 0, widest = 0;
    for (const seed of SEEDS) {
      const spawns = spawnsOf(seed, level);
      eligible += spawns.filter(s => !s.buried && eliteKind(s.kind)).length;
      uncapped += dealElites(spawns, seed, level, ELITE_RATE[level], 99).filter(s => s.elite).length;
      const dealt = dealElites(spawns, seed, level), perWave = new Map<string, number>();
      for (const s of dealt) if (s.elite) { capped++; const key = `${s.room}:${s.wave ?? 1}`; perWave.set(key, (perWave.get(key) ?? 0) + 1); widest = Math.max(widest, perWave.get(key)!); }
    }
    measured[level] = { eligible, uncapped, capped, widest };
  }
  // Measured 2026-10-03 over these seeds: floor 2 9,233 of 61,515 eligible bodies at the rate alone (15.01%), 7,839 once a wave holds at most one (12.74%); floor 3 18,374 of 73,380 (25.04%), 17,733 with at most two a wave (24.17%).
  assert.equal(measured[1].uncapped + measured[1].capped, 0, 'floor one dealt an elite');
  assert.ok(measured[1].eligible > 20_000, 'precondition: floor one held bodies that could have been elite');
  for (const [level, rate] of [[2, 0.15], [3, 0.25]] as const) {
    const { eligible, uncapped } = measured[level];
    assert.ok(eligible > 50_000, `precondition: floor ${level} held only ${eligible} eligible bodies`);
    assert.ok(Math.abs(uncapped / eligible - rate) < 0.01, `floor ${level}: ${(uncapped / eligible * 100).toFixed(2)}% of eligible bodies roll an elite against the ${rate * 100}% asked`);
  }
  // The caps hold, and they bite: with them the share is below the rate and above a floor of its own.
  assert.equal(measured[2].widest, ELITE_PER_WAVE[2], 'floor two holds more than one elite in a wave, or never reaches the one');
  assert.equal(measured[3].widest, ELITE_PER_WAVE[3], 'floor three holds more than two elites in a wave, or never reaches two');
  assert.ok(measured[2].capped < measured[2].uncapped && measured[3].capped < measured[3].uncapped, 'precondition: the per-wave caps never bound a roll');
  assert.ok(measured[2].capped / measured[2].eligible > 0.115 && measured[3].capped / measured[3].eligible > 0.225, 'the caps cost more elites than they were measured to');
});

test('dealing elites changes nothing but the elite field, and leaves a spawn that is not elite the very object it was', () => {
  for (const level of [2, 3]) for (const seed of SEEDS.slice(0, 120)) {
    const spawns = spawnsOf(seed, level), before = structuredClone(spawns), out = dealElites(spawns, seed, level);
    assert.deepEqual(spawns, before, 'dealElites changed its input');
    assert.equal(out.length, spawns.length);
    out.forEach((spawn, i) => { const { elite, ...rest } = spawn; assert.deepEqual(rest, spawns[i], `seed ${seed} floor ${level}: spawn ${i} moved or changed beyond its elite field`); if (!elite) assert.equal(spawn, spawns[i]); });
  }
  const floor = generateFloor(SEEDS[3], 3);
  assert.ok(wavedFloor(floor, SEEDS[3], 3).spawns.some(s => s.elite), 'precondition: the floor the game deals holds an elite');
  assert.ok(!floor.spawns.some(s => s.elite), 'generateFloor dealt an elite: that is dealElites\'s alone, or every seed pinned to its spawns moves');
});

test('an elite is dealt from a stream of its own: the wave table moves no elite, and the elites move no wave', () => {
  const seed = SEEDS[5], level = 3, floor = generateFloor(seed, level);
  const base = dealElites(floor.spawns, seed, level);
  const withWaves = dealElites(dealWaves(floor, seed, level), seed, level);
  // The first wave's bodies are the same bodies in both, and wear the same modifiers.
  assert.deepEqual(withWaves.slice(0, floor.spawns.length).map(s => s.elite), base.map(s => s.elite).slice(0, floor.spawns.length), 'dealing waves changed which first-wave bodies are elite');
  assert.ok(base.some(s => s.elite), 'precondition: the first wave of this floor holds an elite');
});

test('`?elite=` names one of the four modifiers or nothing, and makes every body that can carry it that elite', () => {
  for (const m of ELITE_MODIFIERS) assert.equal(parseElite(m), m);
  for (const bad of [null, '', 'fast', 'Hasted', 'hasted,armoured']) assert.equal(parseElite(bad), null, String(bad));
  const spawns: Spawn[] = [{ x: 1, z: 1, kind: 'guard', room: 1, ambush: false }, { x: 2, z: 1, kind: 'captain', room: 1, ambush: false }, { x: 3, z: 1, kind: 'bonecaller', room: 1, ambush: false }, { x: 3, z: 1, kind: 'rattler', room: 1, ambush: false, buried: true }, { x: 4, z: 1, kind: 'pyre', room: 1, ambush: false }];
  assert.deepEqual(allElite(spawns, 'volatile').map(s => s.elite ?? null), ['volatile', null, null, null, null], 'a boss, a caller, a reserve or a pyre was made volatile');
  assert.deepEqual(allElite(spawns, 'armoured').map(s => s.elite ?? null), ['armoured', null, null, null, 'armoured']);
});

test('an elite pays double experience and 2 pearls, a plain body one of each, and a boss is not an elite', () => {
  const plain = createRun(), elite = createRun();
  assert.equal(resolveKill(plain, 'guard').xp, XP_PER_ENEMY, 'a plain body\'s experience moved');
  assert.equal(resolveKill(elite, 'guard', true).xp, 2 * XP_PER_ENEMY, 'an elite did not pay double experience');
  assert.equal(XP_PER_ELITE, 2 * XP_PER_ENEMY);
  assert.deepEqual([plain.kills, plain.elites, plain.totalXp], [1, 0, 25]);
  assert.deepEqual([elite.kills, elite.elites, elite.totalXp], [1, 1, 50], 'an elite is a kill, an elite kill and 50 experience');
  assert.equal(resolveKill(createRun(), 'captain', true).xp, 100, 'a boss pays the boss\'s purse whatever it carries');
  const end = (patch: Partial<RunEnd> = {}) => ({ floor: 2, won: false, kills: 10, ...patch });
  assert.equal(pearlsFor(end({ elites: 3 })) - pearlsFor(end()), 3 * ELITE_PEARLS);
  assert.equal(ELITE_PEARLS, 1, 'an elite is worth a kill (1 pearl) and one more: 2');
  assert.equal(bank(freshMeta(), end({ elites: 3 })).pearls - bank(freshMeta(), end()).pearls, 3);
});

test('a run that felled elites says so in its record, and an old record or a run with none has no field', () => {
  const base = { at: 1, floor: 2, won: false, cause: 'guard', seconds: 90, rank: 2, xp: 300, kills: 12, boons: [], seed: 5, arm: 'tideblade', upgrades: {}, pearls: 40, bosses: 0 };
  assert.equal(parseRun({ ...base, elites: 4 })?.elites, 4);
  assert.ok(!('elites' in (parseRun(base) ?? {})), 'a record from before elites gained a field');
  assert.ok(!('elites' in (parseRun({ ...base, elites: 0 }) ?? {})));
  assert.ok(!('elites' in (parseRun({ ...base, elites: -3 }) ?? {})), 'a negative count was kept');
});

test('a volatile body leaves the pyre\'s fire where it falls, and it bites a knight standing in it; a plain body leaves none', () => {
  const at = { x: 4, z: -2 };
  assert.equal(deathPool('guard', at), null);
  assert.equal(deathPool('guard', at, 'hasted'), null, 'a hasted guard left fire');
  const fire = deathPool('guard', at, 'volatile');
  assert.ok(fire, 'a volatile guard left no fire');
  assert.deepEqual({ radius: fire.radius, life: fire.life, damage: fire.damage, interval: fire.interval }, BESTIARY.pyre.deathPool, 'it is not the pyre\'s own fire');
  assert.deepEqual(ELITES.volatile.pool, { radius: 1.7, life: 3.5, damage: 8, interval: 0.6 });
  assert.ok(poolCatches(fire, 4.5, -2) && !poolCatches(fire, 6, -2), 'the fire is not where the body fell');
  assert.equal(poolStep(fire, 0.016).bites, 1, 'a knight standing in it is not bitten on the first frame');
  let bites = 0, pool = { ...fire }; for (let t = 0; t < 4; t += 0.016) { const step = poolStep(pool, 0.016); bites += step.bites; pool = { ...pool, life: step.life, timer: step.timer }; }
  assert.ok(bites >= 5, `the fire bit ${bites} times in four seconds`);
});
