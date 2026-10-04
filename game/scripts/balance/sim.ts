// A whole run, played headlessly by a scripted knight against the real rules.
//
// Every decision here calls the same pure module the browser calls: generateFloor lays the keep,
// decideEnemy drives every body, swordContacts decides every hit, and hurt/resolveKill/takeBoon move
// the run's numbers. Nothing is re-implemented, so a tuning change lands here the same frame it lands
// in the game. What is modelled rather than shared is the renderer's own bookkeeping — the ember ring
// placement, the ambush wake, the spawn cooldown stagger — and each of those carries the line of
// dungeon-game.tsx it mirrors, because that is the seam where this harness can silently go stale.
//
// The knight is a policy, not a player: it walks the flood toward the stair, engages what wakes, and
// dodges a tell it has had time to read. It is a consistent yardstick for comparing builds against each
// other, not a claim about how well a human plays.
import { eightWay } from '../../app/dungeon-aim.ts';
import { beatOf, chainLength, chargeLevel, drawDamage, drawn, lungeStep, specialSwing, vaultLanded, vaultStep } from '../../app/dungeon-weapon.ts';
import { canAbortSwing, DASH_TIME, dashImmune, dragToward, hurledBlow, lineContacts, playerSpeed, specialAvailable, specialGate, specialSpends, swordContacts, vaultLanding, vaultTarget } from '../../app/dungeon-combat.ts';
import { AIM_LOCK, ALERT_STAGGER, BESTIARY, decideEnemy, ENEMY_KINDS, eliteStats, fallOf, moveOf, nearbyDozers, raiseSpot, scaledDamage, separateCrowd, type CrowdBody, type EliteModifier, type EnemyKind, type EnemyView, type Move, type Wakeable, type World } from '../../app/dungeon-enemy.ts';
import { bossPush, landBlow } from '../../app/dungeon-hits.ts';
import { playerAttackPose, playerSpecialPose } from '../../app/dungeon-attack-pose.ts';
import { TILE, bossOnFloor, cellKey, dealBosses, generateFloor, hasClearPath, moveOnFloor } from '../../app/dungeon-floor.ts';
import { arenaFloor, type Floor } from '../../app/dungeon-arena.ts';
import { calledIn, idleClock, roomTiles, springing, waveDue, wavedFloor, waveSpots, type WaveClock } from '../../app/dungeon-waves.ts';
import { TIDEBLADE, type Weapon } from '../../app/dungeon-weapon.ts';
import { BOLT_RADIUS, deathPool, flashpointHits, flyHostile, flyShot, HOSTILE_POOL_RINGS, homeStep, hostileBolt, poolCatches, poolStep, reloadStep, sampleTrail, scatterPool, scatterRings, fanHeadings, ARROW_POOL, type Mark, type Pool, type Shot } from '../../app/dungeon-projectile.ts';
import { pearlsFor, runStart, type Meta } from '../../app/dungeon-meta.ts';
import { clearChamber, createRun, DOOR_RADIUS, draftBoons, heal, hurt, resolveKill, SHRINE, SHRINE_REACH, specialReady, spendSpecial, STAIR_RADIUS, takeBoon, tickRun, type Boon, type Run } from '../../app/dungeon-sim.ts';

/** Matches the FLOORS constant in dungeon-game.tsx. */
export const FLOORS = 3;
/** The game runs on rAF with deltas clamped to 40ms; a fixed step keeps a seeded run reproducible. */
const DT = 1 / 60;
/** A floor that has not resolved in this much simulated time is reported stuck rather than scored. */
const FLOOR_TIMEOUT = 480;

export type Cause = EnemyKind | 'hazard';

/** How well the knight plays. One policy across a batch is what makes two batches comparable. */
export type Policy = {
  /** Seconds of a tell that must have elapsed before the knight reacts to it. Human-ish is 0.2-0.25. */
  reaction: number;
  /**
   * Fraction of readable tells it actually dodges, 0..1. The response is not monotonic and is not
   * meant to be read as a skill dial: a dodge cancels the swing it interrupts and spends a 1.35s
   * cooldown, so a knight that dodges everything draws fights out and eats more tells than one that
   * dodges selectively. Hold it fixed across a comparison rather than reading a single batch as
   * "this is how hard the game is at skill X".
   */
  dodge: number;
  /** Take the door that pays - a purse, else a mending - over the first one offered (plan 017). */
  explore: boolean;
  /** What the knight carries for the whole descent. */
  weapon: Weapon;
  /**
   * Back away from whatever is nearest instead of closing on it. The knight walks at 8.5 and the
   * fastest body in the keep manages 3.2, so this is not a style, it is the strongest play available to
   * anyone holding a ranged arm — and the reason the crossbow is limited by a quiver rather than by a
   * cooldown. Off by default so a comparison measures arms rather than exploits; on, it measures how
   * much the exploit is worth.
   */
  kite: boolean;
  /**
   * Aim the way a keyboard does: eight screen directions, so a swing is up to 22.5 degrees off what it
   * was pointed at. Off by default, because the navigator has always aimed exactly and every balance
   * number this repository has recorded was measured that way — turning it on by default would silently
   * reinterpret all of them. On, it measures the world a keyboard-only player actually played before
   * pointer and stick aim existed, which is the only way to price what aim was worth.
   */
  quantise: boolean;
  /**
   * Plan 016: use the arm's special whenever it is ready and it would reach at least two bodies (the lunge and
   * the vault: one; the Heavy Bolt: two on its line; the Flashpoint: two standing in fire). Off for every existing policy, so `balance:check` holding the old bands is the proof that adding
   * specials moved nothing else.
   */
  special?: boolean;
  /** Seconds the `special` policy holds a charged special before letting go; absent means its minimum. */
  charge?: number;
  /**
   * Plan 018: step out of a pyre's fire. While the knight stands in a hostile pool his move is away from its centre;
   * his dodge and his strike are unchanged. Inert until a pyre has fallen, so it moves no floor that deals none.
   * On unless it is `false`; a test switches it off to price the fire.
   */
  avoidFire?: boolean;
  /**
   * Plan 021: step out of a ring a boss's scatter has marked, before it lights. On unless it is `false`; a test switches it off to count the rings that light on him.
   */
  avoidMarks?: boolean;
  /**
   * Plan 018: go for a standing bonecaller before anything nearer. On unless it is `false`; a test switches it off to
   * watch the rattlers stand up and be cut down again, which a knight that goes straight for the caller cuts short.
   */
  callerFirst?: boolean;
  /**
   * Plan 019: what the knight bought between runs, applied through `createRun(runStart(meta))`. Absent means
   * a fresh save, and `createRun()` deals exactly what it always did. Only the numbers apply: the arm is
   * still `weapon`, because a policy names the arm it measures.
   */
  meta?: Meta;
  /** Which card to take from a draft. Defaults to the first offered. */
  pickBoon?: (offer: Boon[], run: Run) => string;
};

export const DEFAULT_POLICY: Policy = { reaction: 0.22, dodge: 0.8, explore: true, weapon: TIDEBLADE, kite: false, quantise: false };

export type FloorReport = {
  level: number;
  /** 'cleared' reached the stair, 'died' ran out of vitality, 'stuck' hit the timeout. */
  outcome: 'cleared' | 'died' | 'stuck';
  seconds: number;
  kills: number;
  spawns: number;
  /** Vitality lost on this floor, split by what dealt it. */
  damage: Record<Cause, number>;
  /**
   * Of that, how much landed while three or more woken bodies stood within four units. A narrow arc
   * costs nothing against one body at a time, which is all a duel measures — this is the only column
   * that can see what a thrusting weapon gives up, and what a half-circle of edge is bought with.
   */
  surrounded: number;
  /** Seconds spent within reach of a woken body. A weapon that never closes shows up here as near zero. */
  contact: number;
  /**
   * Seconds with no woken body within IDLE_RADIUS of the knight - the silence a blind reviewer of our
   * frames was counting. A keep where fights queue up one guard at a time reads high here even when
   * `contact` and `surrounded` look fine, because the numbers those two track only start once something
   * is already close.
   */
  idle: number;
  /**
   * `idle` split into exactly one of four buckets, so the four sum to it (see the assertion in
   * `simulateFloor`): `idleCorridor` is idle time on a tile whose room is negative; `idleBarren` is idle
   * time in a room that never held a spawn at all (the start chamber, any sanctuary); `idleSpent` is idle
   * time in a room that did hold spawns and has none left alive; `idleLiveNoContact` is idle time in a
   * room that still holds a living body, just none woken and within IDLE_RADIUS.
   */
  idleCorridor: number;
  idleBarren: number;
  idleSpent: number;
  idleLiveNoContact: number;
  /** Seconds spent on a corridor tile, idle or not - what `idleCorridor` is a fraction of. */
  corridorSeconds: number;
  /** Distinct corridor tiles the knight's feet touched this floor. */
  corridorTiles: number;
  /** Rooms this floor that never held a spawn at all - fixed by the seed, not by play. */
  barrenRooms: number;
  /** Times the knight walked into a room a second or later time after it was already fully spent. */
  spentRecrossings: number;
  /**
   * The longest single unbroken stretch of `idle` on the floor: not how much silence there is in total,
   * but the size of the worst gap in it. A floor could hold its idle total in one dead corridor or spread
   * it evenly between fights; this is what tells them apart.
   */
  alone: number;
  /**
   * Mean seconds from walking into a room to a woken body first coming within reach, averaged over every
   * room entered this floor that ever got one. A room a guard reaches instantly reads near zero; a queue
   * that makes the knight wait for the next arrival reads high.
   */
  firstContact: number;
  /** Shots fired and shots that found a body, for an arm that throws something. */
  shots: number;
  landed: number;
  /** Specials that reached contact (plan 016); zero for every policy but `special`. */
  specials: number;
  /** Plan 018. Blows a shield turned aside; bodies a bonecaller stood up; raised bodies cut down and put back. */
  blocked: number;
  raised: number;
  reassembled: number;
  /** Vitality a pyre's fire took, by the kind that lit it - the part of `damage` that came from the ground. */
  poolDamage: Record<Cause, number>;
  /**
   * Plan 021, for the boss this floor holds (a kind whose archetype says `boss`): its kind, or null on a floor with none; the
   * vitality it took off the knight, by blow, bolt and fire; 1 if it was what killed him; the seconds from its noticing him to its
   * fall (or to his, or the floor's end); his vitality as a share of his maximum the moment it fell, before the room's top-up
   * (`bands.ts` reads the floor's after it), null if it never fell; and the phase changes it went through.
   */
  bossKind: EnemyKind | null;
  bossDamage: number;
  bossDeaths: number;
  bossSeconds: number;
  bossHpLeft: number | null;
  phaseChanges: number;
  /** Plan 021 Stage C: the rings a boss's scatter lit this floor, and how many of them lit with the knight standing inside - what stepping out of a marked ring (`avoidMarks`) saves. */
  ringsLit: number;
  ringsOnKnight: number;
  /** Plan 021 Stage D: blows a shield turned aside after its boss changed phase - none, for the Bastion, whose shield breaks in the change. */
  blockedLate: number;
  /**
   * One entry per room fought and cleared this floor: seconds from the first frame one of that room's woken
   * bodies came within REACH_RADIUS of the knight to the frame the room held nothing alive. It is the fight
   * alone, without the walk to it, which is what a special can actually shorten. A ranged arm that clears a
   * room before anything closes records no fight for it, so read this column for the melee arms.
   */
  fights: number[];
  /** Plan 022: the encounter of the room each entry of `fights` was fought in (`watch`, `ambush`, `gauntlet`), in the same order, so a fight length can be read per kind of chamber. */
  fightEncounters: string[];
  /** Plan 022: the knight's vitality as a share of his maximum the moment he walked into the stair hall (the boss's chamber); null on a floor he never reached it on (he died first, or the floor has no door to it). */
  hpAtStair: number | null;
  /** Plan 022 (D7): elites the knight felled this floor, by modifier (a modifier none was felled of is absent). */
  eliteKills: Partial<Record<EliteModifier, number>>;
  /** Plan 022: 1 if the knight died on this floor before he walked into the stair hall (`hpAtStair` null), so something other than the boss ended the run; 0 otherwise. D13 asks for a third of the default knight's deaths to be these. */
  deathsBeforeBoss: number;
  /** Plan 022: waves the floor's chambers called (each later wave of each chamber that stood up counts once). */
  wavesRaised: number;
  /** Plan 022: `fights` of the chambers that were dealt later waves, in the same units - the fight D13 measures. */
  waveFights: number[];
  /** Plan 022: every body of a later wave the sim stood on this floor (read off the bodies it ran), by chamber and wave, reserves included: what the game's scene is held against. */
  waveBodies: { room: number; wave: number; kind: EnemyKind; buried: boolean }[];
  /** Plan 022 (D7): every elite the sim stood on this floor (read off the bodies it ran), with the vitality it was built with: what the game's scene is held against. */
  eliteBodies: { room: number; wave: number; kind: EnemyKind; elite: EliteModifier; hp: number }[];
  /** Plan 022: each mend a shrine made, by the chamber it stands in and the vitality it gave (at most `SHRINE`, the first time the knight stood hurt within reach of it). */
  shrineMends: { room: number; healed: number }[];
  hpAfter: number;
  maxHpAfter: number;
  rankAfter: number;
};

export type RunReport = {
  seed: number;
  weapon: string;
  outcome: 'escaped' | 'died' | 'stuck';
  /** The floor the run ended on, 1-based. */
  floor: number;
  cause: Cause | null;
  seconds: number;
  kills: number;
  totalXp: number;
  rank: number;
  boons: string[];
  /** Plan 019: what banking this run would pay (`pearlsFor`), so earnings can be measured without game code. */
  pearls: number;
  /** Plan 023 (D1): the fight chambers cleared, which `pearls` pays `CHAMBER_PEARLS` each for. */
  chambers: number;
  floors: FloorReport[];
};

type Body = {
  kind: EnemyKind;
  x: number; z: number;
  hp: number; damage: number; tell: number; speed: number;
  cooldown: number; hitFlash: number; windup: number; lunge: number;
  aim: { x: number; z: number };
  room: number; awake: boolean; dead: boolean;
  // Plan 018. `face` is the yaw it last turned to (dungeon-enemy-view.ts:180 takes it from the pose; here it is
  // `intent.face`, which agrees except mid-trail, when a shield is down anyway). A `buried` body is a
  // summoner's reserve: asleep, untargetable and outside every count until its `summoner` (a spawn index) raises it.
  face: number; buried: boolean; summoner: number; maxHp: number;
  // Plan 022 (D7): the modifier this body carries, if it is an elite: `eliteStats` made its numbers, a volatile one leaves fire, and it pays double.
  elite?: EliteModifier;
  // Plan 022 (dungeon-waves.ts): 1 for every body generateFloor lays; 2 or more for a body its chamber calls once the wave before it is down.
  wave: number;
  // Plan 021. A boss's rotation slot, phase and the seconds of phase change left (EnemyView), the move whose tell is running
  // (its tell, reach and bolt are what the knight reads) and the rings a `scatter` tell has marked, to become fire when it ends.
  move: number; phase: number; change: number; winding: Move | null; marks: { x: number; z: number }[];
  /** The phase again, under the name `landBlow` reads (`Struck.bossPhase`): a boss's shield breaks in one. */
  readonly bossPhase: number;
  // Where it spawned, for a dozing body's pace, and how far into noticing it is - see dungeon-enemy.ts.
  anchor: { x: number; z: number }; notice: number;
  // Countdown to a contagion kick a neighbour scheduled for this body; Infinity means none is pending.
  // dungeon-game.tsx:1335-ish carries the identical bookkeeping so the two sims agree on when a room
  // wakes together rather than one body at a time.
  alertIn: number;
};

/** Seconds spent with no woken body this close counts as idle - see FloorReport.idle. */
const IDLE_RADIUS = 12;
/** Matches the `contact` column's own definition of "within reach". */
const REACH_RADIUS = 2.5;

// The renderer keys its flood by a packed integer for the same reason: a Map keyed by a fresh string
// re-hashes on every probe, and pursuit probes four cells per body per frame.
const packKey = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);

/** Breadth-first step count over walkable floor, from one cell outward. */
const flood = (cells: Set<string>, fromX: number, fromZ: number, radius = Infinity) => {
  const distances = new Map<number, number>();
  if (!cells.has(cellKey(fromX, fromZ))) return distances;
  distances.set(packKey(fromX, fromZ), 0);
  const queue = [fromX, fromZ, 0];
  for (let i = 0; i < queue.length; i += 3) {
    const cx = queue[i], cz = queue[i + 1], distance = queue[i + 2];
    if (distance >= radius) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz, next = packKey(nx, nz);
      if (!distances.has(next) && cells.has(cellKey(nx, nz))) { distances.set(next, distance + 1); queue.push(nx, nz, distance + 1); }
    }
  }
  return distances;
};

/** Mulberry32, the generator dungeon-floor seeds its keep with, so a batch replays exactly. */
const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};

const unit = (x: number, z: number) => { const length = Math.hypot(x, z) || 1; return { x: x / length, z: z / length }; };

const startRun = (policy: Policy) => createRun(policy.meta && runStart(policy.meta));

/** One descent, start to stair or to death. */
export function simulateRun(seed: number, policy: Policy = DEFAULT_POLICY): RunReport {
  // Two streams, deliberately. The knight's dodge rolls are consumed per frame, so a change of skill
  // changes how many numbers have been drawn — and if the draft shared the stream, raising `dodge`
  // would silently deal a different set of boons. That confound made a skill sweep read non-monotonic
  // here before the streams were split: the clumsier knight was simply being handed better cards.
  const nerve = rng(seed ^ 0x9e3779b9);
  const draft = rng(seed ^ 0x85ebca6b);
  const run = startRun(policy);
  const floors: FloorReport[] = [];
  let elapsed = 0, cause: Cause | null = null;

  // Plan 021 (D13): the run's bosses are dealt as the game deals them, from floor one's seed, and each floor is laid with its own.
  const dealt = dealBosses(seed);
  for (let level = 1; level <= FLOORS; level++) {
    const report = simulateFloor(seed + level - 1, level, run, policy, nerve, draft, wavedFloor(generateFloor(seed + level - 1, level, { boss: bossOnFloor(dealt, level) }), seed + level - 1, level));
    floors.push(report);
    elapsed += report.seconds;
    if (report.outcome !== 'cleared') {
      // Whatever took the last of the vitality is what the run log would record.
      const damage = report.damage;
      cause = (Object.keys(damage) as Cause[]).filter(k => damage[k] > 0).sort((a, b) => damage[b] - damage[a])[0] ?? null;
      return { seed, weapon: policy.weapon.id, outcome: report.outcome === 'died' ? 'died' : 'stuck', floor: level, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], pearls: pearlsFor({ floor: level, won: false, kills: run.kills, chambers: run.chambers, bosses: run.bosses, elites: run.elites }), chambers: run.chambers, floors };
    }
    // Descending restores a quarter of the bar, as the results card promises.
    if (level < FLOORS) heal(run, Math.round(run.maxHp * 0.25));
  }
  return { seed, weapon: policy.weapon.id, outcome: 'escaped', floor: FLOORS, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], pearls: pearlsFor({ floor: FLOORS, won: true, kills: run.kills, chambers: run.chambers, bosses: run.bosses, elites: run.elites }), chambers: run.chambers, floors };
}

/**
 * One floor laid out as the development arena (dungeon-arena.ts): `roster` awake in the Tide Gate, a caller's
 * reserve buried under it. The run ends when the roster is dead or the knight is - never by walking out of the
 * gate or down the stair, which is open from the start - so what a test reads is the fight. `start` is how much of his bar he begins on (plan 022).
 */
export function simulateArena(seed: number, level: number, roster: readonly EnemyKind[], policy: Policy = DEFAULT_POLICY, start = 1): FloorReport {
  // Plan 022: `start` is the share of his maximum vitality the knight begins on (1 is a full bar): the duel the stair hall really is, from what the keep leaves of him (scripts/balance/bosses.ts `--at-stair`).
  const run = startRun(policy);
  run.hp = Math.max(1, Math.round(run.maxHp * Math.min(1, Math.max(0, start))));
  return simulateFloor(seed, level, run, policy, rng(seed ^ 0x9e3779b9), rng(seed ^ 0x85ebca6b), arenaFloor(seed, level, roster), true);
}

/** One generated floor fought by a fresh knight: no earlier floors, no boons, full vitality. For a test that needs a floor and not a descent; `built` is a floor the test laid itself (a chosen boss). */
export function simulateLevel(seed: number, level: number, policy: Policy = DEFAULT_POLICY, built?: Floor): FloorReport {
  return simulateFloor(seed, level, startRun(policy), policy, rng(seed ^ 0x9e3779b9), rng(seed ^ 0x85ebca6b), built);
}

function simulateFloor(seed: number, level: number, run: Run, policy: Policy, nerve: () => number, draft: () => number, built?: Floor, arena = false): FloorReport {
  // Plan 022: a floor the sim lays itself is dealt its later waves as the game's is (`wavedFloor`); one a test hands in is its own.
  const floor = built ?? wavedFloor(generateFloor(seed, level), seed, level);
  const weapon = policy.weapon;
  const damage = Object.fromEntries([...ENEMY_KINDS, 'hazard'].map(cause => [cause, 0])) as Record<Cause, number>;
  let surrounded = 0, contact = 0, shotCount = 0, landedCount = 0, specialCount = 0, blockedCount = 0, raisedCount = 0, reassembledCount = 0;
  // Plan 021: the boss's numbers (see FloorReport), and whatever last took vitality, which is what the knight died to if he died.
  let phaseChanges = 0, blockedLate = 0, ringsLit = 0, ringsOnKnight = 0, bossHpLeft: number | null = null, bossFrom: number | null = null, bossTo: number | null = null, lastBlow: Cause | null = null;
  // Where the knight has been, oldest first, one sample a TRAIL_STEP: what a `scatter` marks its rings on.
  const trail: { x: number; z: number }[] = [];
  let trailTimer = 0;
  const poolDamage = Object.fromEntries([...ENEMY_KINDS, 'hazard'].map(cause => [cause, 0])) as Record<Cause, number>;
  let idle = 0, aloneRun = 0, aloneMax = 0, firstContactSum = 0, firstContactCount = 0;
  // Rooms already given a first-contact measurement (whether it resolved or the knight walked on), so a
  // second visit never double-counts, and rooms currently waiting on their first arrival.
  const roomsTouched = new Set<number>();
  const pendingContact = new Map<number, number>();
  let lastRoom = -1;
  const startKills = run.kills;

  // Rooms that never held a spawn at all - the start chamber, any sanctuary, and whatever else the
  // generator's own placement odds left empty. Checked against the spawn list itself rather than
  // `encounter`, since a tiny room can drop every one of a non-empty roster's placement tries.
  const spawnedRooms = new Set(floor.spawns.map(s => s.room));
  const barrenRoomIds = new Set(floor.rooms.filter(r => !spawnedRooms.has(r.id)).map(r => r.id));
  const corridorTileSet = new Set<number>();
  let idleCorridor = 0, idleBarren = 0, idleSpent = 0, idleLiveNoContact = 0;
  let corridorSeconds = 0, spentRecross = 0;

  const bodies: Body[] = floor.spawns.map((spawn, index) => {
    const stats = eliteStats(spawn.kind, level, spawn.elite);
    return {
      kind: spawn.kind, elite: spawn.elite, x: spawn.x * TILE, z: spawn.z * TILE,
      hp: stats.hp, damage: stats.damage, tell: stats.tell, speed: stats.speed,
      // dungeon-game.tsx:617 staggers the opening cooldown so a pack does not swing as one.
      cooldown: 0.4 + (index % 3) * 0.2, hitFlash: 0, windup: 0, lunge: 0,
      // A buried body sleeps until a summon tell stands it up: `awake: !spawn.ambush` alone woke the whole reserve
      // at the start, the hole the arena's first version had (progress.md, 2026-09-26).
      aim: { x: 0, z: 0 }, room: spawn.room, awake: !spawn.ambush && !spawn.buried, dead: false,
      face: 0, buried: !!spawn.buried, summoner: spawn.summoner ?? -1, maxHp: stats.hp, wave: spawn.wave ?? 1,
      move: 0, phase: 0, change: 0, winding: null, marks: [], get bossPhase() { return this.phase; },
      anchor: { x: spawn.x * TILE, z: spawn.z * TILE }, notice: 0, alertIn: Infinity,
    };
  });

  // dungeon-game.tsx:578 lays three ember rings across a gauntlet, offset along x from the room's heart.
  const hazards = floor.rooms.flatMap(room => room.id !== 0 && room.encounter === 'gauntlet'
    ? [-2.5, 0, 2.5].map(offset => ({ x: room.x * TILE + offset, z: room.z * TILE, room: room.id, burned: false }))
    : []);

  // dungeon-floor-scene.ts lays a shrine on the heart of every sanctuary chamber but the gate; dungeon-game.tsx heals SHRINE the first frame the knight is within SHRINE_REACH of an unused one with vitality to mend.
  // Plan 022 Stage 0: the sim did not model it, so a knight who walked into a quiet chamber was never mended there. A knight who stands in a sanctuary hurt walks to the shrine before the door.
  const shrines = floor.rooms.filter(room => room.id !== 0 && room.encounter === 'sanctuary').map(room => ({ room: room.id, x: room.x * TILE, z: room.z * TILE, cell: { x: room.x, z: room.z }, used: false }));
  const player = { x: floor.rooms[0].x * TILE, z: floor.rooms[0].z * TILE };
  const facing = { x: 0, z: 1 };
  let attackFacing = { x: 0, z: 1 };
  let attackTime = 0, dashTime = 0, dashCooldown = 0, t = 0;
  // The attack string, exactly as dungeon-game.tsx keeps it. Without this the batch measures a
  // chainless sword against a game that chains, which is the same class of mistake as the
  // navigator aiming perfectly while the player could not.
  let chainBeat = 0, chainIdle = Infinity, swing: Weapon = weapon;
  // The special, as dungeon-game.tsx keeps it: which verb the live swing is, a charge being held, where a
  // lunge started, and the spear while it is out of the hand. Only the `special` policy ever sets any of it.
  let swingKind: 'strike' | 'special' = 'strike', charging: number | null = null, lungeFrom = { x: 0, z: 0 };
  let harpoon: { shot: Shot | null; x: number; z: number; dragged: boolean } | null = null;
  // Stage C: the vault in progress and the Heavy Bolts in the air, which hit with the special's numbers.
  let vault: { target: Body | null; distance: number; dir: { x: number; z: number }; landed: boolean } | null = null;
  const heavy = new Set<Shot>();
  // Read through a function for the same reason as `isSpecial`.
  const hopping = () => vault;
  // Read through a function: the closures below assign it, which the loop's own narrowing cannot see.
  const isSpecial = () => swingKind === 'special';
  const swingHits = new Set<Body>();
  const shots: Shot[] = [];
  // Bolts loosed at the knight, with the kind that loosed them for the damage split.
  const hostile: { shot: Shot; kind: EnemyKind }[] = [];
  let quiver = weapon.ranged ? weapon.ranged.capacity : 0, reload = 0;
  const pools: Pool[] = [];
  // A pyre's fire (dungeon-game.tsx:379-380): it bites the knight, not the bodies, and there are only so many rings.
  const fires: { pool: Pool; kind: EnemyKind }[] = [];
  const cleared = new Set<number>([0]);
  // Plan 016 fight duration: when each room's fight started, and how long each finished one took.
  const fightStart = new Map<number, number>(), fights: number[] = [], fightEncounters: string[] = [];
  const eliteKills: Partial<Record<EliteModifier, number>> = {};
  let hpAtStair: number | null = null, wavesRaised = 0; const waveFights: number[] = [], shrineMends: { room: number; healed: number }[] = [];
  const clearRoom = (room: number) => {
    cleared.add(room);
    const began = fightStart.get(room);
    if (began !== undefined) { fights.push(+(t - began).toFixed(2)); fightEncounters.push(floor.rooms[room].encounter); fightStart.delete(room); if (bodies.some(b => b.room === room && b.wave > 1)) waveFights.push(fights[fights.length - 1]); }
  };

  const goal = floor.rooms[floor.goal];
  const stair = { x: goal.x * TILE, z: goal.z * TILE };
  // One flood per destination, reused every frame: the keep does not move, only the knight does.
  const goalField = flood(floor.cells, goal.x, goal.z);
  // Floods toward a cell, kept until the knight changes chamber. A chamber is an island, so each one
  // covers a few hundred cells at most.
  const fields = new Map<number, Map<number, number>>();
  const fieldTo = (x: number, z: number) => {
    let field = fields.get(packKey(x, z));
    if (!field) { field = flood(floor.cells, x, z); fields.set(packKey(x, z), field); }
    return field;
  };
  // The door a chamber is left by, once it is clear: the policy's preference among this chamber's doors.
  const chooseDoor = (room: number) => {
    const ways = floor.doors.filter(d => d.from === room);
    if (!policy.explore) return ways[0];
    const pays = (d: typeof ways[number]) => ({ cache: 0, mend: 1 } as Record<string, number>)[floor.rooms[d.to].reward ?? ''] ?? 3;
    return [...ways].sort((a, b) => pays(a) - pays(b))[0];
  };
  let chamber = 0;
  // Plan 022 (dungeon-waves.ts): the wave clock of the chamber the knight is in, and where each body of the wave whose rings show will stand (dungeon-game.tsx keeps the same clock and the same rings).
  let waveClock: WaveClock = idleClock();
  const waveRings = new Map<Body, { x: number; z: number }>();
  const openTiles = new Map<number, { x: number; z: number }[]>();
  const openOf = (room: number) => { let open = openTiles.get(room); if (!open) { open = roomTiles(floor, room).map(t => ({ x: t.x * TILE, z: t.z * TILE })); openTiles.set(room, open); } return open; };

  let playerCell = '';
  let pursuit = new Map<number, number>();
  const world: World = {
    cells: floor.cells,
    get activeRoom() { return floor.roomByCell.get(cellKey(Math.round(player.x / TILE), Math.round(player.z / TILE))) ?? -1; },
    pathDistance: (x: number, z: number) => pursuit.get(packKey(x, z)) ?? Infinity,
  };

  const stairClear = () => bodies.every(b => b.room !== floor.goal || b.dead);

  // The heading a body looks along, off the yaw it last turned to (dungeon-game.tsx:392 `facingOf`).
  const facingOf = (body: Body) => ({ x: -Math.sin(body.face), z: -Math.cos(body.face) });
  // A body going down, however it was brought there (dungeon-game.tsx:373-393 `fell`): one a bonecaller raised
  // and whose caller still stands goes back into the reserve whole and unpaid; any other fall is a kill, leaves a
  // pyre's fire where it lay, and crumbles everything the fallen one called, unpaid. Whichever way the chamber
  // was emptied, the reward is paid once (`settleRoom`).
  const fell = (body: Body) => {
    const fall = fallOf(bodies, bodies.indexOf(body));
    if (fall.reassembles) {
      const caller = bodies[body.summoner];
      body.buried = true; body.awake = false; body.hp = body.maxHp;
      body.windup = 0; body.lunge = 0; body.hitFlash = 0; body.notice = 0;
      body.x = caller.x; body.z = caller.z;
      reassembledCount++;
      return;
    }
    body.dead = true;
    // A boss's fall, read before this kill's draught or the room's top-up can touch his vitality (plan 021 D9).
    if (BESTIARY[body.kind].boss) { bossHpLeft = run.hp / run.maxHp * 100; bossTo = t; }
    resolveKill(run, body.kind, !!body.elite);
    if (body.elite) eliteKills[body.elite] = (eliteKills[body.elite] ?? 0) + 1;
    const fire = deathPool(body.kind, body, body.elite);
    if (fire && fires.length < HOSTILE_POOL_RINGS) fires.push({ pool: fire, kind: body.kind });
    for (const at of fall.crumble) bodies[at].dead = true;
    if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
      clearRoom(body.room);
      clearChamber(run, floor.rooms[body.room]);
    }
  };
  // A bonecaller's tell ran out (dungeon-game.tsx:398-408 `raise`): the next `perTell` of its buried reserve stand
  // up side by side a pace toward the knight, awake.
  const raise = (caller: Body, index: number, perTell = BESTIARY[caller.kind].summons?.perTell ?? 0) => {
    const reserve = bodies.filter(e => e.buried && !e.dead && e.summoner === index).slice(0, perTell);
    reserve.forEach((body, slot) => {
      const at = raiseSpot(floor.cells, caller, player, slot);
      body.buried = false; body.awake = true; body.room = caller.room;
      body.x = at.x; body.z = at.z; body.anchor = { x: at.x, z: at.z }; body.cooldown = Math.max(body.cooldown, 0.6);
      raisedCount++;
    });
  };

  while (t < FLOOR_TIMEOUT) {
    t += DT;
    tickRun(run, DT);
    trailTimer = sampleTrail(trail, trailTimer, player, DT);
    dashTime = Math.max(0, dashTime - DT);
    dashCooldown = Math.max(0, dashCooldown - DT);

    // The renderer re-floods only when the knight changes cell; matching that keeps the cost honest.
    const cellX = Math.round(player.x / TILE), cellZ = Math.round(player.z / TILE), key = cellKey(cellX, cellZ);
    let cellChanged = false;
    if (key !== playerCell) { playerCell = key; pursuit = flood(floor.cells, cellX, cellZ, 24); cellChanged = true; }
    const activeRoom = world.activeRoom;

    // Cell-level bookkeeping for the idle attribution below: only touched the frame the knight actually
    // steps onto a new cell, so standing still never re-triggers a "revisit".
    if (cellChanged) {
      const packed = packKey(cellX, cellZ);
      if (activeRoom < 0) corridorTileSet.add(packed);
    }

    // A fresh room, not yet measured: start the clock on how long it takes something to reach him. A room
    // entered again after it was already fully spent is a re-crossing - ground the navigator is walking
    // back over rather than a new arrival.
    if (activeRoom >= 0 && activeRoom !== lastRoom) {
      if (!roomsTouched.has(activeRoom)) { roomsTouched.add(activeRoom); pendingContact.set(activeRoom, t); }
      else if (cleared.has(activeRoom) && !barrenRoomIds.has(activeRoom)) spentRecross++;
    }
    lastRoom = activeRoom;

    // dungeon-game.tsx:826 springs a room's ambush the moment the knight is inside it.
    // Plan 022: never a later wave - `springing` (dungeon-waves.ts) is the filter the game reads too.
    if (activeRoom >= 0) for (const body of springing(bodies, activeRoom)) { body.awake = true; body.cooldown = Math.max(body.cooldown, 0.9); }

    // Plan 022 (D3, D4; dungeon-game.tsx asks the same rule): the chamber calls its next wave when every body before it is down - after the pause the rings go down where the bodies will stand
    // (a spot within the clearance of the knight moves), and when they have shown long enough the bodies stand, awake, with the ambush's opening cooldown.
    if (activeRoom >= 0) {
      const due = waveDue(bodies, activeRoom, waveClock, DT);
      waveClock = due.clock;
      if (due.mark !== null) {
        const called = bodies.filter(b => b.room === activeRoom && b.wave === due.mark && !b.dead && !b.buried);
        waveSpots(openOf(activeRoom), called.map(b => ({ x: b.x, z: b.z })), player).forEach((at, i) => waveRings.set(called[i], at));
      }
      if (due.raise !== null) {
        // D4: a ring the knight has since walked onto moves off him, as the game moves it at the raise.
        const rung = [...waveRings.keys()], placed = waveSpots(openOf(activeRoom), rung.map(b => waveRings.get(b)!), player);
        rung.forEach((b, i) => waveRings.set(b, placed[i]));
        for (const [body, at] of waveRings) { body.awake = true; body.x = at.x; body.z = at.z; body.anchor = { x: at.x, z: at.z }; body.cooldown = Math.max(body.cooldown, 0.9); }
        waveRings.clear(); wavesRaised++;
      }
    }

    // A room the knight stands in with nothing left alive is done with, even if it never held a body to
    // kill. The reward itself is paid on the killing blow, as the game pays it; this only stops the
    // navigator from walking back to a chamber it has already emptied.
    if (activeRoom >= 0 && !cleared.has(activeRoom) && bodies.every(b => b.room !== activeRoom || b.dead)) clearRoom(activeRoom);

    const live = bodies.filter(b => !b.dead && b.awake);

    // --- the knight's turn ---------------------------------------------------------------------
    // A tell it has had time to read, from something close enough to land, is worth a dodge. A volley is
    // read from its lock rather than its start - dodging a lane that is still following him only moves
    // the lane - and the bolt's flight to him is reaction time too.
    const readable = (b: Body) => {
      // A boss reads off the move it is winding up (plan 021); every other body off its one attack.
      const bolt = (b.winding ?? BESTIARY[b.kind]).bolt;
      if (!bolt) return b.tell - b.windup >= policy.reaction;
      return b.windup <= AIM_LOCK && AIM_LOCK - b.windup + Math.hypot(b.x - player.x, b.z - player.z) / bolt.speed >= policy.reaction;
    };
    // A scatter's tell is not a blow he can dash: its rings are stepped out of instead (below).
    const threat = live.find(b => b.windup > 0 && b.winding?.attack !== 'scatter' && readable(b)
      && Math.hypot(b.x - player.x, b.z - player.z) < (b.winding ?? BESTIARY[b.kind]).strikeRange + ((b.winding ?? BESTIARY[b.kind]).attack === 'pounce' ? 2.6 : 0.4));
    if (threat && dashCooldown <= 0 && dashTime <= 0 && canAbortSwing(attackTime, swing) && nerve() < policy.dodge) {
      // A pounce or a bolt is out-run sideways; a swing is out-run backwards. A boss is read off the move it is winding up.
      const away = unit(player.x - threat.x, player.z - threat.z);
      const step = (threat.winding ?? BESTIARY[threat.kind]).attack !== 'swing' ? { x: -away.z, z: away.x } : away;
      facing.x = step.x; facing.z = step.z;
      dashTime = DASH_TIME; dashCooldown = run.dashSpan; attackTime = 0; chainBeat = 0; chainIdle = Infinity; swing = weapon; swingHits.clear();
      charging = null; swingKind = 'strike';
    }

    // Only a body the knight could actually walk at in a straight line is worth charging. Without the
    // lane check it charges one through the wall of the next room and grinds there until the timeout,
    // which is what eight runs in ten did before this line existed.
    const candidates = live
      .map(b => ({ body: b, distance: Math.hypot(b.x - player.x, b.z - player.z) }))
      .filter(entry => entry.distance < 14 && hasClearPath(floor.cells, player, entry.body))
      .sort((a, b) => a.distance - b.distance);
    // Plan 018: a standing caller is the target before anything nearer. Its rattlers stand up again as fast as they
    // are cut down, so a knight that always swings at the nearest one loops until the timeout and the report
    // says `stuck` instead of measuring the fight. Inert unless a caller is awake.
    const target = (policy.callerFirst !== false ? candidates.find(entry => BESTIARY[entry.body.kind].summons) : undefined) ?? candidates[0];

    // The keyboard's eight, on the same screen basis the game builds its movement from. Snapping the
    // aim rather than the movement is deliberate: what the keys quantise is the direction the swing
    // goes out in, and the knight walked in eight directions before and after.
    const aimAs = (to: { x: number; z: number }) => policy.quantise ? eightWay(to) : to;

    // Continue the string if the last swing ended inside the arm's window, else start a new one.
    const openSwing = () => {
      const linking = chainIdle <= (weapon.chain?.window ?? 0) && chainBeat + 1 < chainLength(weapon);
      chainBeat = linking ? chainBeat + 1 : 0;
      chainIdle = 0;
      swing = beatOf(weapon, chainBeat); swingKind = 'strike';
      if (harpoon && weapon.special?.hurl) swing = { ...swing, damage: swing.damage * weapon.special.hurl.bare };
      attackTime = swing.duration;
    };
    const openSpecial = (charge: number, aimed: { x: number; z: number }) => {
      swing = specialSwing(weapon, charge); swingKind = 'special'; attackTime = swing.duration;
      chainBeat = 0; chainIdle = Infinity; swingHits.clear();
      attackFacing = aimed; facing.x = aimed.x; facing.z = aimed.z; lungeFrom = { x: player.x, z: player.z };
      vault = null;
      const hop = weapon.special?.vault;
      if (hop) {
        const at = vaultTarget(floor.cells, player, aimed, live, hop.range, hop.cone);
        const path = vaultLanding(floor.cells, player, aimed, at >= 0 ? live[at] : null, hop.over, hop.hop);
        vault = { target: at >= 0 ? live[at] : null, distance: path.distance, dir: path.dir, landed: false };
      }
    };
    // The `special` policy's one decision: fire it whenever it is ready and would reach enough bodies.
    const special = weapon.special;
    if (policy.special && special && dashTime <= 0 && charging === null
      && specialGate({ weapon, ready: specialAvailable(special, { cooled: specialReady(run), quiver, out: !!harpoon }), attackTime, swing, dashTime, specialLive: isSpecial() && attackTime > 0, busy: !!harpoon, pools: pools.length }) === 'start') {
      const range = (special.swing.ranged?.speed ?? 0) * (special.swing.ranged?.flight ?? 0) * 0.8;
      const reach = special.kind === 'lunge' ? (special.lunge?.distance ?? 0) + (special.lunge?.width ?? 0)
        : special.kind === 'throw' || special.kind === 'draw' ? range
          : special.kind === 'vault' ? special.vault?.range ?? 0
            : special.kind === 'whirl' ? (special.swing.reach ?? weapon.reach) + run.reach
              : special.kind === 'detonate' ? Infinity
                : special.radius?.[0] ?? 0;
      let near = live
        .map(b => ({ body: b, distance: Math.hypot(b.x - player.x, b.z - player.z) }))
        .filter(entry => entry.distance < reach && (special.kind === 'detonate' || hasClearPath(floor.cells, player, entry.body)))
        .sort((a, b) => a.distance - b.distance);
      // The bolt counts only what lies on its line to the nearest body; the Flashpoint only what stands in fire.
      if (special.kind === 'draw' && near.length) {
        const aim = unit(near[0].body.x - player.x, near[0].body.z - player.z), end = { x: player.x + aim.x * range, z: player.z + aim.z * range };
        near = near.filter(entry => lineContacts(floor.cells, player, end, entry.body, BOLT_RADIUS));
      }
      if (special.kind === 'detonate') {
        const caught = new Set(flashpointHits(pools, near.map((entry, index) => ({ x: entry.body.x, z: entry.body.z, index }))));
        near = near.filter((_, index) => caught.has(index));
      }
      if (near.length >= (special.kind === 'lunge' || special.kind === 'vault' ? 1 : 2)) {
        attackTime = 0; swing = weapon;
        const aimed = aimAs(unit(near[0].body.x - player.x, near[0].body.z - player.z));
        if (special.kind === 'charge' || special.kind === 'draw') { charging = 0; attackFacing = aimed; }
        else openSpecial(1, aimed);
      }
    }
    // A charge is let go at `policy.charge` seconds, and by default the moment it would slam: a bot that
    // stands rooted for a full second beside two bodies measured as a floor-two death rate, not as an arm.
    // The dodge above is the only thing that drops it early.
    if (charging !== null && special) {
      charging += DT;
      // A drawn bolt keeps its line on the nearest body, and is let go the moment it is full.
      if (special.draw) {
        if (target) attackFacing = aimAs(unit(target.body.x - player.x, target.body.z - player.z));
        if (drawn(special, charging)) { charging = null; if (quiver > 0) openSpecial(1, attackFacing); }
      } else if (charging >= Math.min(special.chargeMax ?? 0, Math.max(special.chargeMin ?? 0, policy.charge ?? 0))) { const level = chargeLevel(special, charging); charging = null; openSpecial(level, attackFacing); }
    }

    let move: { x: number; z: number } | null = null;
    if (target && dashTime <= 0) {
      const toward = unit(target.body.x - player.x, target.body.z - player.z);
      const away = { x: -toward.x, z: -toward.z };
      const bow = weapon.ranged;
      if (bow) {
        // Firing is the whole arm: it is loosed from wherever the knight stands, so what governs is
        // whether there is a bolt in hand, not whether he is close enough to swing.
        const range = bow.speed * bow.flight;
        if (quiver > 0 && attackTime <= 0 && charging === null && target.distance < range * 0.8) {
          const aimed = aimAs(toward);
          openSwing(); attackFacing = aimed; facing.x = aimed.x; facing.z = aimed.z;
        }
        // Dry, or being crowded, and the knight simply outruns everything in the keep.
        if (policy.kite || quiver === 0) { if (target.distance < range * 0.55) move = away; }
        else if (target.distance > range * 0.6) move = toward;
      } else if (target.distance > weapon.reach * 0.85 + run.reach) {
        // Close to just inside the arm's own reach rather than to a fixed 1.55, or a spear would walk
        // into a hammer it could have worked from outside, and a cleaver would stop short of its own edge.
        move = policy.kite && target.distance < 1.2 ? away : toward;
      } else if (attackTime <= 0 && charging === null) {
        const aimed = aimAs(toward);
        openSwing(); attackFacing = aimed; facing.x = aimed.x; facing.z = aimed.z; swingHits.clear();
      }
    } else if (dashTime <= 0) {
      // Nothing awake in reach. A sealed chamber is fought out first: walk at whatever is left alive in it.
      // Once it is clear the stair, in the warden hall, or else the chosen door, and through it.
      const quarry = bodies.filter(b => !b.dead && !b.buried && b.room === chamber && calledIn(b)).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
      const shrine = !quarry ? shrines.find(shrine => shrine.room === chamber && !shrine.used && run.hp < run.maxHp) : undefined;
      // Plan 022: a chamber whose next wave has not been called yet is not clear - he holds his ground for the rings instead of walking at the door.
      const waiting = !quarry && bodies.some(b => b.room === chamber && !b.dead && !b.buried && !calledIn(b));
      const door = !quarry && !shrine && !waiting && chamber !== floor.goal ? chooseDoor(chamber) : undefined;
      if (door && cleared.has(chamber) && Math.hypot(door.x * TILE - player.x, door.z * TILE - player.z) < DOOR_RADIUS) {
        // The swap key, pressed the frame it arrives: the next chamber's near wall, and nothing carried over.
        const next = floor.rooms[door.to];
        chamber = next.id; player.x = next.entry.x * TILE; player.z = next.entry.z * TILE; fields.clear();
        if (next.id === floor.goal && hpAtStair === null) hpAtStair = run.hp / run.maxHp * 100;
        shots.length = 0; hostile.length = 0; pools.length = 0; fires.length = 0;
      } else if (waiting) {
        // holds: nothing to walk at until the rings have shown and the wave has stood
      } else {
        const field = quarry ? fieldTo(Math.round(quarry.x / TILE), Math.round(quarry.z / TILE)) : shrine ? fieldTo(shrine.cell.x, shrine.cell.z) : door ? fieldTo(door.x, door.z) : goalField;
        const here = field.get(packKey(cellX, cellZ));
        const next = ([[cellX + 1, cellZ], [cellX - 1, cellZ], [cellX, cellZ + 1], [cellX, cellZ - 1]] as [number, number][])
          .filter(([x, z]) => floor.cells.has(cellKey(x, z)))
          .sort((a, b) => (field.get(packKey(a[0], a[1])) ?? Infinity) - (field.get(packKey(b[0], b[1])) ?? Infinity))[0];
        const ahead = next ? field.get(packKey(next[0], next[1])) ?? Infinity : Infinity;
        if (next && (here === undefined || ahead < here)) move = unit(next[0] * TILE - player.x, next[1] * TILE - player.z);
        else if (quarry) move = unit(quarry.x - player.x, quarry.z - player.z);
        else if (shrine) move = unit(shrine.x - player.x, shrine.z - player.z);
        else if (door) move = unit(door.x * TILE - player.x, door.z * TILE - player.z);
        else if (stairClear()) move = unit(stair.x - player.x, stair.z - player.z);
      }
    }

    // Plan 018: standing in a pyre's fire, walk out of it - straight away from its heart. The dodge and the strike
    // above are unchanged; this only replaces where he walks, and only while a fire is under him.
    if (policy.avoidFire !== false && dashTime <= 0) {
      const burning = fires.find(f => poolCatches(f.pool, player.x, player.z));
      if (burning) move = unit(player.x - burning.pool.x, player.z - burning.pool.z);
    }
    // Plan 021 (Stage C): the rings a boss's scatter has marked are stepped out of before they light, straight away from the nearest one's heart; once a ring is lit it is `avoidFire`'s. Dashing is
    // not for it (a scatter hurts no one in its tell), and the dodge and the strike are unchanged: this only replaces where he walks, and only while he stands in a marked ring.
    if (policy.avoidMarks !== false && dashTime <= 0) {
      const inside = live.flatMap(b => b.marks.map(at => ({ at, radius: b.winding?.scatter?.pool.radius ?? 0, from: b }))).find(({ at, radius }) => Math.hypot(player.x - at.x, player.z - at.z) < radius);
      // The newest ring is marked on the very spot he stands on, which has no "away" to it: he steps away from the boss that marked it instead.
      if (inside) move = Math.hypot(player.x - inside.at.x, player.z - inside.at.z) < 0.05 ? unit(player.x - inside.from.x, player.z - inside.from.z) : unit(player.x - inside.at.x, player.z - inside.at.z);
    }
    if (move) { facing.x = move.x; facing.z = move.z; }
    const speed = charging !== null && dashTime <= 0 ? weapon.moveSpeed * (special?.moveScale ?? 1) : playerSpeed({ dashing: dashTime > 0, attacking: attackTime > 0, weapon: swing });
    // The lunge carries him down its line for its travel window, as dungeon-game.tsx does.
    const lunge = isSpecial() && attackTime > 0 && special?.lunge ? lungeStep(special, swing.anticipation, swing.duration - attackTime + DT, DT) : 0;
    const vaulted = hopping(), hop = isSpecial() && attackTime > 0 && vaulted && special?.vault ? vaultStep(special, swing.anticipation, vaulted.distance, swing.duration - attackTime + DT, DT) : 0;
    if (lunge > 0) moveOnFloor(floor.cells, player, attackFacing.x * lunge, attackFacing.z * lunge);
    else if (hop > 0 && vaulted) moveOnFloor(floor.cells, player, vaulted.dir.x * hop, vaulted.dir.z * hop);
    else if (dashTime > 0) moveOnFloor(floor.cells, player, facing.x * speed * DT, facing.z * speed * DT);
    else if (move) moveOnFloor(floor.cells, player, move.x * speed * DT, move.z * speed * DT);

    // --- the blade -----------------------------------------------------------------------------
    // Bolts come back on their own clock, not on a cooldown: a cooldown still lets the knight back away
    // and fire forever, because he outruns every body in the keep.
    if (weapon.ranged && quiver < weapon.ranged.capacity) {
      const back = reloadStep(quiver, weapon.ranged.capacity, reload, weapon.ranged.refill, DT);
      quiver = back.spare; reload = back.timer;
    }
    chainIdle = attackTime > 0 && !isSpecial() ? 0 : chainIdle + DT;
    if (attackTime > 0) {
      const poseAt = (age: number) => isSpecial() && special ? playerSpecialPose(age, swing, special.kind) : playerAttackPose(age, swing, chainBeat);
      const wasLive = poseAt(swing.duration - attackTime).active;
      attackTime = Math.max(0, attackTime - DT);
      const pose = poseAt(swing.duration - attackTime);
      // A Flashpoint whose fire all went out in its wind-up ends on its contact frame, and spends nothing.
      if (isSpecial() && special && pose.active && !wasLive && !specialSpends(special, { pools: pools.length })) attackTime = 0;
      else if (isSpecial() && special && pose.active && !wasLive) {
        spendSpecial(run, special.cooldown); specialCount += 1;
        // The spear leaves the hand down the same flight a bolt takes, and comes back below.
        if (special.kind === 'throw' && swing.ranged) {
          const shot: Shot = { x: player.x, z: player.z, dx: attackFacing.x, dz: attackFacing.z, speed: swing.ranged.speed, life: swing.ranged.flight, pierce: swing.ranged.pierce, damage: swing.damage + run.strike, spent: new Set<number>() };
          shots.push(shot); harpoon = { shot, x: player.x, z: player.z, dragged: false };
        }
        // Stage C. The Heavy Bolt spends the quiver on one bolt that passes through everything on its line.
        if (special.kind === 'draw' && swing.ranged && quiver > 0) {
          const shot: Shot = { x: player.x, z: player.z, dx: attackFacing.x, dz: attackFacing.z, speed: swing.ranged.speed, life: swing.ranged.flight, pierce: swing.ranged.pierce, damage: drawDamage(weapon, quiver) + run.strike, spent: new Set<number>() };
          shots.push(shot); heavy.add(shot); quiver = 0; reload = 0;
        }
        // The Flashpoint: every pool goes up and is spent; each body in any of them is caught once.
        if (special.kind === 'detonate' && pools.length) {
          const caught = flashpointHits(pools, bodies.map((b, index) => ({ x: b.x, z: b.z, index })).filter(mark => !bodies[mark.index].dead && bodies[mark.index].awake));
          pools.length = 0;
          for (const index of caught) {
            const body = bodies[index];
            if (body.change > 0) continue;
            body.hp -= swing.damage + run.strike; body.hitFlash = 0.2;
            if (body.hp <= 0) {
              fell(body);
            }
          }
        }
      }
      // One bolt on the frame the blade would have gone live, rather than damage for every live frame.
      if (!isSpecial() && weapon.ranged && pose.active && !wasLive && quiver > 0) {
        quiver -= 1; shotCount += 1;
        shots.push({ x: player.x, z: player.z, dx: attackFacing.x, dz: attackFacing.z, speed: weapon.ranged.speed, life: weapon.ranged.flight, pierce: weapon.ranged.pierce, damage: weapon.damage + run.strike, spent: new Set<number>() });
      }
      const line = isSpecial() ? special?.lunge : undefined;
      const lineTo = line ? { x: player.x + attackFacing.x * line.width, z: player.z + attackFacing.z * line.width } : null;
      // The vault cuts nothing in the air; on landing it turns on the body it went over, and scores that alone.
      const vaulting = isSpecial() && special?.kind === 'vault' ? special : undefined, leap = hopping();
      if (vaulting && leap && pose.active && !leap.landed && vaultLanded(vaulting, swing.anticipation, swing.duration - attackTime)) {
        leap.landed = true;
        if (leap.target && !leap.target.dead) { const turn = unit(leap.target.x - player.x, leap.target.z - player.z); if (turn.x || turn.z) attackFacing = turn; }
      }
      const scoring = !isSpecial() || (special?.kind !== 'detonate' && special?.kind !== 'draw' && (!vaulting || !!leap?.landed));
      if (!swing.ranged && pose.active && scoring) for (const body of bodies) {
        if (body.dead || !body.awake || swingHits.has(body)) continue;
        if (vaulting && body !== leap?.target) continue;
        if (!(line && lineTo ? lineContacts(floor.cells, lungeFrom, lineTo, body, line.width, player) : swordContacts(floor.cells, player, attackFacing, body, run.reach, swing))) continue;
        swingHits.add(body);
        // The game's own blow: damage, flash, broken tell, cooldown and shove, in dungeon-hits. A strike shoves
        // with the arm's own numbers, as it always has here; a special with its own.
        const shover = isSpecial() ? swing : weapon;
        // The body's facing goes in, so a shield turns a frontal blow aside as it does in the game (dungeon-game.tsx:1847).
        if (landBlow(floor.cells, body, body, { damage: swing.damage + run.strike, stagger: swing.stagger, knockback: shover.knockback, wardenKnockback: shover.wardenKnockback }, unit(body.x - player.x, body.z - player.z), facingOf(body)).blocked) { blockedCount++; if (body.phase > 0) blockedLate++; }
        if (body.hp <= 0) {
          fell(body);
        }
      }
    }

    // --- every body ----------------------------------------------------------------------------
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body.dead || !body.awake) continue;
      // A neighbour's noticing beat can pull a still-dormant body in early; dungeon-game.tsx:1335-ish
      // carries the identical countdown so a room wakes the same way in both sims.
      if (body.alertIn < Infinity) {
        body.alertIn -= DT;
        if (body.alertIn <= 0) { if (body.notice <= 0) body.notice = DT; body.alertIn = Infinity; }
      }
      const view: EnemyView = { kind: body.kind, x: body.x, z: body.z, room: body.room, cooldown: body.cooldown, hitFlash: body.hitFlash, windup: body.windup, lunge: body.lunge, tell: body.tell, speed: body.speed, aim: body.aim, anchor: body.anchor, notice: body.notice, hp: body.hp, maxHp: body.maxHp, move: body.move, phase: body.phase, change: body.change };
      const intent = decideEnemy(view, player, { ...world, activeRoom }, DT);
      const startedNoticing = body.notice <= 0 && intent.notice > 0;
      body.cooldown = intent.cooldown; body.hitFlash = intent.hitFlash; body.windup = intent.windup;
      body.lunge = intent.lunge; body.aim = intent.aim; body.notice = intent.notice;
      body.x = intent.x; body.z = intent.z;
      if (intent.face !== null) body.face = intent.face;
      // Plan 021. The move this frame's blow belongs to is the one the body went into the frame on (the rotation slot moves on in
      // the very intent that spends it); null for every ordinary kind, which keeps its one attack and the damage it was built with.
      const doing = moveOf(body.kind, view.phase, view.move), strike = doing ? scaledDamage(doing.damage, level) : body.damage;
      if (BESTIARY[body.kind].moves) {
        body.move = intent.move; body.phase = intent.phase; body.change = intent.change;
        if (bossFrom === null && BESTIARY[body.kind].boss && intent.notice > 0) bossFrom = t;
        // A tell starting: the move's own tell is what he reads, and a scatter lays its rings on where he has been (the game's
        // twin of this is plan 021 Stage C).
        if (view.windup <= 0 && intent.windup > 0) {
          body.winding = moveOf(body.kind, intent.phase, intent.move); body.tell = body.winding?.tell ?? body.tell;
          if (body.winding?.scatter) body.marks = scatterRings([...trail, { x: player.x, z: player.z }], body.winding.scatter.rings, { hostile: fires.length, own: pools.length });
        }
        if (intent.windup <= 0 && !intent.scatter) { body.winding = null; body.marks = []; }
        // A phase change (plan 021 D3; the game's twin is Stage B): the knight is pushed out of its reach, and for `change` seconds
        // nothing hurts it (`Struck.change`, read by `landBlow`).
        if (intent.phaseChange) { phaseChanges++; const push = bossPush(body, player); moveOnFloor(floor.cells, player, push.x, push.z); }
        if (intent.scatter && doing?.scatter) {
          for (const at of body.marks) if (fires.length < HOSTILE_POOL_RINGS) {
            const pool = scatterPool(at, doing.scatter.pool, scaledDamage(doing.scatter.pool.damage, level));
            fires.push({ kind: body.kind, pool }); ringsLit++; if (poolCatches(pool, player.x, player.z)) ringsOnKnight++;
          }
          body.marks = []; body.winding = null;
        }
      }
      if (intent.raise) raise(body, i, doing?.summon?.perTell);
      if (startedNoticing) {
        const snapshot: Wakeable[] = bodies.map(b => ({ x: b.x, z: b.z, room: b.room, notice: b.notice, dead: b.dead || !b.awake }));
        nearbyDozers(snapshot, i).forEach((idx, rank) => {
          const delay = (rank + 1) * ALERT_STAGGER;
          if (delay < bodies[idx].alertIn) bodies[idx].alertIn = delay;
        });
      }
      if (intent.hit) {
        const dealt = hurt(run, strike, { dashing: dashImmune(dashTime), warded: true });
        damage[body.kind] += dealt;
        if (dealt) lastBlow = body.kind;
        if (dealt && live.filter(b => Math.hypot(b.x - player.x, b.z - player.z) < 4).length >= 3) surrounded += dealt;
        if (run.hp <= 0) return endFloor('died');
      }
      // dungeon-game.tsx looses the same bolt on the same frame.
      const bolt = (doing ?? BESTIARY[body.kind]).bolt;
      // A fan looses several, the aimed one first, into the same twelve arrows the game has (a thirteenth is dropped).
      if (intent.loose && bolt) for (const heading of fanHeadings(intent.loose, bolt.fan)) if (hostile.length < ARROW_POOL) hostile.push({ kind: body.kind, shot: hostileBolt(body, heading, bolt, strike) });
    }

    // Bolts at the knight fly after the bodies have moved, as the game flies them.
    for (let i = hostile.length - 1; i >= 0; i--) {
      const { shot, kind } = hostile[i];
      const flight = flyHostile(shot, floor.cells, player, dashImmune(dashTime), DT);
      shot.x = flight.x; shot.z = flight.z; shot.life = flight.life; shot.pierce = flight.pierce;
      if (flight.done) hostile.splice(i, 1);
      if (!flight.hit) continue;
      const dealt = hurt(run, shot.damage, { dashing: dashImmune(dashTime), warded: true });
      damage[kind] += dealt;
      if (dealt) lastBlow = kind;
      if (dealt && live.filter(b => Math.hypot(b.x - player.x, b.z - player.z) < 4).length >= 3) surrounded += dealt;
      if (run.hp <= 0) return endFloor('died');
    }

    // A pyre's fire, burning the knight on the same clock his own burns bodies on (dungeon-game.tsx:1945-1951).
    for (let i = fires.length - 1; i >= 0; i--) {
      const { pool, kind } = fires[i], bite = poolStep(pool, DT);
      pool.life = bite.life; pool.timer = bite.timer;
      if (bite.bites && poolCatches(pool, player.x, player.z)) {
        const dealt = hurt(run, pool.damage, { dashing: dashImmune(dashTime), warded: true });
        damage[kind] += dealt; poolDamage[kind] += dealt;
        if (dealt) lastBlow = kind;
        if (run.hp <= 0) return endFloor('died');
      }
      if (pool.life <= 0) fires.splice(i, 1);
    }

    // Bolts fly after the bodies have moved, against where they actually are this frame.
    if (shots.length) {
      const marks: Mark[] = bodies.map((b, index) => ({ x: b.x, z: b.z, index })).filter(mark => !bodies[mark.index].dead && bodies[mark.index].awake);
      for (let i = shots.length - 1; i >= 0; i--) {
        const shot = shots[i];
        const flight = flyShot(shot, floor.cells, marks, DT);
        shot.x = flight.x; shot.z = flight.z; shot.life = flight.life; shot.pierce = flight.pierce;
        const hurled = harpoon?.shot === shot || heavy.has(shot) ? special : undefined;
        for (const index of flight.hits) {
          const body = bodies[index];
          if (body.dead) continue;
          if (!hurled) landedCount += 1;
          // The Harpoon drags the first body it bites that is not steadfast, instead of shoving it; a special's
          // bolt otherwise carries the special's numbers, a plain bolt the arm's.
          const thrown = hurled ? hurledBlow(hurled, { harpoon: harpoon?.shot === shot, damage: shot.damage }, { free: !!harpoon && !harpoon.dragged, steadfast: BESTIARY[body.kind].steadfast }) : null;
          const drags = !!thrown?.drags;
          const blow = thrown ? thrown.blow : { ...weapon, damage: shot.damage };
          // The push is the bolt's own heading, not the line from the knight to the body: the two differ once he has moved, for a pierced second body and for the harpoon (dungeon-game.tsx:2004-2010).
          // A shield-turned bolt is done with the body: no drag, and the harpoon keeps its one drag (dungeon-game.tsx:2011).
          if (landBlow(floor.cells, body, body, blow, { x: shot.dx, z: shot.dz }, facingOf(body)).blocked) { blockedCount++; if (body.phase > 0) blockedLate++; continue; }
          if (drags && hurled?.hurl && harpoon) {
            harpoon.dragged = true;
            const pull = dragToward(body, player, hurled.hurl.drag);
            moveOnFloor(floor.cells, body, pull.x, pull.z);
          }
          if (body.hp <= 0) {
            fell(body);
          }
        }
        if (hurled && harpoon) { harpoon.x = flight.x; harpoon.z = flight.z; }
        if (flight.done && hurled && harpoon) { harpoon.shot = null; shots.splice(i, 1); }
        else if (flight.done) {
          if (heavy.delete(shot)) { shots.splice(i, 1); continue; }
          if (weapon.burst) pools.push({ x: flight.x, z: flight.z, radius: weapon.burst.radius, life: weapon.burst.life, damage: weapon.burst.damage, interval: weapon.burst.interval, timer: 0 });
          shots.splice(i, 1);
        }
      }
    }
    // The spear on its way home, straight at the knight at the speed it left.
    if (harpoon && !harpoon.shot) {
      const home = homeStep(harpoon, player, special?.swing.ranged?.speed ?? 1, DT);
      harpoon.x = home.x; harpoon.z = home.z;
      if (home.home) harpoon = null;
    }
    // Fire on the ground bites what stands in it. It is the only thing the knight owns that goes on
    // working after he has stopped paying attention to it.
    for (let i = pools.length - 1; i >= 0; i--) {
      const pool = pools[i];
      const burn = poolStep(pool, DT);
      pool.life = burn.life; pool.timer = burn.timer;
      if (burn.bites) for (const body of bodies) {
        if (body.dead || !body.awake || body.change > 0 || !poolCatches(pool, body.x, body.z)) continue;
        body.hp -= pool.damage;
        body.hitFlash = 0.2;
        if (body.hp <= 0) {
          fell(body);
        }
      }
      if (pool.life <= 0) pools.splice(i, 1);
    }
    // How long the knight actually stands where something can reach him. An arm that never closes reads
    // as near zero here, which is the only column that catches a weapon winning by walking backwards.
    const reached = live.some(b => Math.hypot(b.x - player.x, b.z - player.z) < REACH_RADIUS);
    if (reached) contact += DT;
    for (const b of live) if (!cleared.has(b.room) && !fightStart.has(b.room) && Math.hypot(b.x - player.x, b.z - player.z) < REACH_RADIUS) fightStart.set(b.room, t);
    // The room this frame's reach belongs to may already have moved on if the knight is mid-corridor by
    // the time contact lands; pendingContact only ever holds the room he is measured against.
    if (reached && activeRoom >= 0 && pendingContact.has(activeRoom)) {
      firstContactSum += t - pendingContact.get(activeRoom)!; firstContactCount++; pendingContact.delete(activeRoom);
    }
    // Time on a corridor tile, idle or not - the denominator idleCorridor is measured against.
    if (activeRoom < 0) corridorSeconds += DT;

    // The silence between fights: nothing woken anywhere near him, and how long the worst single gap ran.
    if (!live.some(b => Math.hypot(b.x - player.x, b.z - player.z) < IDLE_RADIUS)) {
      idle += DT; aloneRun += DT; aloneMax = Math.max(aloneMax, aloneRun);
      // Every idle tick lands in exactly one of these four - see the assertion in endFloor.
      if (activeRoom < 0) idleCorridor += DT;
      else if (barrenRoomIds.has(activeRoom)) idleBarren += DT;
      else if (cleared.has(activeRoom)) idleSpent += DT;
      else idleLiveNoContact += DT;
    }
    else aloneRun = 0;

    const crowd: CrowdBody[] = bodies.map(b => ({ x: b.x, z: b.z, windup: b.windup, dead: b.dead || !b.awake }));
    separateCrowd(floor.cells, crowd, DT).forEach((spot, i) => { if (!crowd[i].dead) { bodies[i].x = spot.x; bodies[i].z = spot.z; } });

    // dungeon-game.tsx:1865 (`SHRINE`): the first step within reach of an unused shrine, with vitality to mend, mends it for good.
    for (const shrine of shrines) if (!shrine.used && Math.hypot(shrine.x - player.x, shrine.z - player.z) < SHRINE_REACH && run.hp < run.maxHp) { shrine.used = true; shrineMends.push({ room: shrine.room, healed: heal(run, SHRINE) }); }

    // --- the keep's own teeth ------------------------------------------------------------------
    // dungeon-game.tsx:855: one 3.6s cycle per room, firing in its last second, one tick per flare.
    for (const ring of hazards) {
      const phase = (t + ring.room * 0.7) % 3.6, firing = phase > 2.6;
      if (!firing) { ring.burned = false; continue; }
      if (ring.burned || Math.hypot(ring.x - player.x, ring.z - player.z) >= 1.8) continue;
      const dealt = hurt(run, 10, { dashing: dashImmune(dashTime) });
      if (dealt) { ring.burned = true; damage.hazard += dealt; lastBlow = 'hazard'; if (run.hp <= 0) return endFloor('died'); }
    }

    // --- shrines, boons, the stair ---------------------------------------------------------------
    if (run.pendingRanks > 0) {
      run.choosing = true;
      const offer = draftBoons(run, draft, run.draftSize);
      takeBoon(run, policy.pickBoon ? policy.pickBoon(offer, run) : offer[0].id);
    }

    // An arena has no stair to walk to: it ends when its roster is dead.
    if (arena) { if (bodies.every(b => b.dead)) return endFloor('cleared'); }
    else if (stairClear()) {
      // The stair waits on the swap key, and the policy presses it the frame it arrives.
      if (Math.hypot(player.x - stair.x, player.z - stair.z) < STAIR_RADIUS) return endFloor('cleared');
    }
  }
  return endFloor('stuck');

  function endFloor(outcome: FloorReport['outcome']): FloorReport {
    // A silent misattribution here would send the whole corridor-vs-not question the wrong way, so the
    // four buckets are checked against `idle` itself rather than trusted by construction.
    const idleSum = idleCorridor + idleBarren + idleSpent + idleLiveNoContact;
    if (Math.abs(idleSum - idle) > 1e-6) {
      throw new Error(`idle attribution does not sum to idle on floor ${level} (seed ${seed}): buckets ${idleSum}, idle ${idle}`);
    }
    return {
      level, outcome, seconds: +t.toFixed(1), kills: run.kills - startKills, spawns: floor.guardCount, damage, surrounded,
      contact: +contact.toFixed(1), idle: +idle.toFixed(1),
      idleCorridor: +idleCorridor.toFixed(2), idleBarren: +idleBarren.toFixed(2), idleSpent: +idleSpent.toFixed(2),
      idleLiveNoContact: +idleLiveNoContact.toFixed(2),
      corridorSeconds: +corridorSeconds.toFixed(2), corridorTiles: corridorTileSet.size,
      barrenRooms: barrenRoomIds.size, spentRecrossings: spentRecross,
      alone: +aloneMax.toFixed(1),
      firstContact: +(firstContactCount ? firstContactSum / firstContactCount : 0).toFixed(2),
      shots: shotCount, landed: landedCount, specials: specialCount, blocked: blockedCount, raised: raisedCount, reassembled: reassembledCount, poolDamage,
      bossKind: floor.spawns.find(spawn => BESTIARY[spawn.kind].boss)?.kind ?? null,
      bossDamage: ENEMY_KINDS.filter(kind => BESTIARY[kind].boss).reduce((sum, kind) => sum + damage[kind], 0),
      bossDeaths: outcome === 'died' && lastBlow !== null && lastBlow !== 'hazard' && BESTIARY[lastBlow].boss ? 1 : 0,
      bossSeconds: +(bossFrom === null ? 0 : (bossTo ?? t) - bossFrom).toFixed(2), bossHpLeft, phaseChanges, ringsLit, ringsOnKnight, blockedLate, fights, fightEncounters, hpAtStair, eliteKills, deathsBeforeBoss: outcome === 'died' && hpAtStair === null ? 1 : 0, wavesRaised, waveFights, waveBodies: bodies.filter(b => b.wave > 1).map(b => ({ room: b.room, wave: b.wave, kind: b.kind, buried: b.buried })), eliteBodies: bodies.filter(b => b.elite && !b.buried).map(b => ({ room: b.room, wave: b.wave, kind: b.kind, elite: b.elite!, hp: b.maxHp })), shrineMends, hpAfter: run.hp, maxHpAfter: run.maxHp, rankAfter: run.rankLevel,
    };
  }
}
