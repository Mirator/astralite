// What the floor generator deals, counted (plan 018). Pure: it reads only `generateFloor`, so it costs
// a second where a balance batch costs six minutes, and it is how the shares in `PACK_MIX` are set against
// the targets the plan names instead of guessed.
//
//   npm run census
//
// The sweep is the one `balance:check` walks: the runs and first seed in bands.json, and each floor of a run
// laid from `seed + level - 1`, as `simulateRun` does.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ENEMY_KINDS, type EnemyKind } from '../../app/dungeon-bestiary.ts';
import { generateFloor, packSource } from '../../app/dungeon-floor.ts';

/** The kinds plan 018 promotes into the descent. */
export const NEW_KINDS = ['bonecaller', 'pyre', 'shieldbearer'] as const satisfies readonly EnemyKind[];
export type NewKind = typeof NEW_KINDS[number];

const sweep = JSON.parse(readFileSync(new URL('./bands.json', import.meta.url), 'utf8')) as { runs: number; firstSeed: number };

/** The floor seeds `balance:check` lays for one level: run `i` starts at `firstSeed + i * 7919`. */
export const sweepSeeds = (level: number) => Array.from({ length: sweep.runs }, (_, i) => sweep.firstSeed + i * 7919 + level - 1);

export type Census = {
  level: number;
  floors: number;
  /** Chambers other than the stair hall that hold at least one standing body. */
  fights: number;
  /** Of those, the ones in the first two layers past the gate. */
  earlyFights: number;
  guards: number;
  bodies: Record<string, number>;
  /** Fight chambers holding at least one of each promoted kind, and at least one of any. */
  holding: Record<NewKind, number>;
  holdingAny: number;
  /**
   * The count plan 018's targets are set against (D5): only the chambers whose pack is drawn from `PACK_MIX.middle` or
   * `.late`. Ambush, gauntlet, purse, opening, shrine and stair-hall chambers can never hold a promoted kind, so
   * counting them only dilutes the share.
   */
  eligible: number;
  eligibleHolding: Record<NewKind, number>;
  eligibleHoldingAny: number;
  earlyHoldingAny: number;
  /** The most pyres standing in a single chamber. */
  maxPyres: number;
  /** Chambers by how many bonecallers stand in them: index 0, 1, 2 or more. */
  callers: [number, number, number];
};

export function takeCensus(level: number, seeds = sweepSeeds(level)): Census {
  const census: Census = { level, floors: seeds.length, fights: 0, earlyFights: 0, guards: 0, bodies: Object.fromEntries(ENEMY_KINDS.map(k => [k, 0])), holding: { bonecaller: 0, pyre: 0, shieldbearer: 0 }, holdingAny: 0, eligible: 0, eligibleHolding: { bonecaller: 0, pyre: 0, shieldbearer: 0 }, eligibleHoldingAny: 0, earlyHoldingAny: 0, maxPyres: 0, callers: [0, 0, 0] };
  for (const seed of seeds) {
    const floor = generateFloor(seed, level), goalLayer = floor.rooms[floor.goal].layer;
    for (const room of floor.rooms) {
      if (room.id === floor.goal) continue;
      const here = floor.spawns.filter(s => s.room === room.id && !s.buried);
      if (!here.length) continue;
      census.fights++;
      const early = room.layer <= 2;
      if (early) census.earlyFights++;
      for (const s of here) census.bodies[s.kind]++;
      census.guards += here.filter(s => s.kind === 'guard').length;
      const present = NEW_KINDS.filter(kind => here.some(s => s.kind === kind));
      for (const kind of present) census.holding[kind]++;
      if (present.length) { census.holdingAny++; if (early) census.earlyHoldingAny++; }
      const source = packSource(room, level, goalLayer);
      if (source === 'middle' || source === 'late') {
        census.eligible++;
        for (const kind of present) census.eligibleHolding[kind]++;
        if (present.length) census.eligibleHoldingAny++;
      }
      census.maxPyres = Math.max(census.maxPyres, here.filter(s => s.kind === 'pyre').length);
      census.callers[Math.min(2, here.filter(s => s.kind === 'bonecaller').length)]++;
    }
  }
  return census;
}

const pct = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : '-';

export function printCensus(rows: Census[]) {
  console.log(`\n  ${sweep.runs} floors a level from seed ${sweep.firstSeed}; a fight chamber is any chamber but the stair hall with a standing body\n`);
  console.log('  floor   fights   guards   ' + [...NEW_KINDS.map(k => `${k} chambers`), 'any new kind', 'in layers 1-2', 'max pyres', 'callers 0/1/2+'].join('   '));
  for (const c of rows) {
    console.log(`  ${String(c.level).padEnd(5)}   ${String(c.fights).padStart(6)}   ${String(c.guards).padStart(6)}   ` + [
      ...NEW_KINDS.map(k => `${c.holding[k]} (${pct(c.holding[k], c.fights)})`.padStart(k.length + 9)),
      `${c.holdingAny} (${pct(c.holdingAny, c.fights)})`.padStart(12),
      `${c.earlyHoldingAny}/${c.earlyFights} (${pct(c.earlyHoldingAny, c.earlyFights)})`.padStart(13),
      String(c.maxPyres).padStart(9), c.callers.join('/').padStart(14),
    ].join('   '));
  }
  console.log('\n  eligible chambers (a pack drawn from the middle or late mix): the D5 denominator');
  console.log('  floor   eligible   ' + [...NEW_KINDS.map(k => `${k}`), 'any new kind'].join('   '));
  for (const c of rows) console.log(`  ${String(c.level).padEnd(5)}   ${String(c.eligible).padStart(8)}   ` + [
    ...NEW_KINDS.map(k => `${c.eligibleHolding[k]} (${pct(c.eligibleHolding[k], c.eligible)})`.padStart(k.length)),
    `${c.eligibleHoldingAny} (${pct(c.eligibleHoldingAny, c.eligible)})`.padStart(12),
  ].join('   '));
  console.log('\n  bodies by kind');
  console.log('  floor   ' + ENEMY_KINDS.map(k => k.padStart(13)).join(''));
  for (const c of rows) console.log(`  ${String(c.level).padEnd(5)}   ` + ENEMY_KINDS.map(k => String(c.bodies[k]).padStart(13)).join(''));
  console.log('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printCensus([1, 2, 3].map(level => takeCensus(level)));
