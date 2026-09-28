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
import { AIM_LOCK, ALERT_STAGGER, BESTIARY, decideEnemy, ENEMY_KINDS, enemyStats, nearbyDozers, separateCrowd, STRIKE_RANGE, type CrowdBody, type EnemyKind, type EnemyView, type Wakeable, type World } from '../../app/dungeon-enemy.ts';
import { landBlow } from '../../app/dungeon-hits.ts';
import { playerAttackPose, playerSpecialPose } from '../../app/dungeon-attack-pose.ts';
import { TILE, cellKey, generateFloor, hasClearPath, moveOnFloor } from '../../app/dungeon-floor.ts';
import { TIDEBLADE, type Weapon } from '../../app/dungeon-weapon.ts';
import { BOLT_RADIUS, flashpointHits, flyHostile, flyShot, homeStep, hostileBolt, poolCatches, poolStep, reloadStep, type Mark, type Pool, type Shot } from '../../app/dungeon-projectile.ts';
import { clearRoomReward, createRun, draftBoons, heal, hurt, resolveKill, specialReady, spendSpecial, STAIR_RADIUS, takeBoon, tickRun, type Boon, type Run } from '../../app/dungeon-sim.ts';

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
  /** Detour into branch rooms for the XP and the heal, or walk the trunk. */
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
  /**
   * Cross-cutting, not a fifth bucket: of `idle`, how much was spent retracing a dead-end branch's own
   * footprint (its room(s), role === 'branch', plus the corridor only they are reachable through - see
   * `branchFootprint`) back toward the trunk. A tile only ever counts once the knight has already stood
   * on it earlier this floor; the flag then holds until he steps onto a tile outside that footprint, or
   * one he has never stood on before. That makes a pause mid-retreat still count, while a first walk in,
   * or a shuffle back onto trodden ground mid-fight, mostly does not - a live fight is rarely `idle` in
   * the first place, since IDLE_RADIUS is wide enough to still see the body being fought.
   */
  idleBacktrack: number;
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
  /**
   * One entry per room fought and cleared this floor: seconds from the first frame one of that room's woken
   * bodies came within REACH_RADIUS of the knight to the frame the room held nothing alive. It is the fight
   * alone, without the walk to it, which is what a special can actually shorten. A ranged arm that clears a
   * room before anything closes records no fight for it, so read this column for the melee arms.
   */
  fights: number[];
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
  floors: FloorReport[];
};

type Body = {
  kind: EnemyKind;
  x: number; z: number;
  hp: number; damage: number; tell: number; speed: number;
  cooldown: number; hitFlash: number; windup: number; lunge: number;
  aim: { x: number; z: number };
  room: number; awake: boolean; dead: boolean;
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

/**
 * Packed cell keys belonging to a dead-end branch: its room(s) (role === 'branch' - a stub can itself
 * grow a nested branch, both marked the same way) plus the corridor that reaches them, stopping the
 * instant the flood would step onto a tile owned by a room that is not part of the branch. dungeon-floor
 * builds every floor as a tree, so a branch hangs off exactly one junction and nothing else ever shares
 * its corridor - anything in this set can only be reached, and left, by that one path.
 */
const branchFootprint = (floor: ReturnType<typeof generateFloor>) => {
  const packed = new Set<number>();
  const branchRooms = new Set(floor.rooms.filter(r => r.role === 'branch').map(r => r.id));
  if (!branchRooms.size) return packed;
  const queue: [number, number][] = [];
  for (const t of floor.tiles) if (branchRooms.has(t.room)) { const pk = packKey(t.x, t.z); if (!packed.has(pk)) { packed.add(pk); queue.push([t.x, t.z]); } }
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, cell = cellKey(nx, nz), pk = packKey(nx, nz);
      if (packed.has(pk) || !floor.cells.has(cell)) continue;
      const owner = floor.roomByCell.get(cell);
      if (owner !== undefined && !branchRooms.has(owner)) continue;
      packed.add(pk); queue.push([nx, nz]);
    }
  }
  return packed;
};

/** Mulberry32, the generator dungeon-floor seeds its keep with, so a batch replays exactly. */
const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};

const unit = (x: number, z: number) => { const length = Math.hypot(x, z) || 1; return { x: x / length, z: z / length }; };

/** One descent, start to stair or to death. */
export function simulateRun(seed: number, policy: Policy = DEFAULT_POLICY): RunReport {
  // Two streams, deliberately. The knight's dodge rolls are consumed per frame, so a change of skill
  // changes how many numbers have been drawn — and if the draft shared the stream, raising `dodge`
  // would silently deal a different set of boons. That confound made a skill sweep read non-monotonic
  // here before the streams were split: the clumsier knight was simply being handed better cards.
  const nerve = rng(seed ^ 0x9e3779b9);
  const draft = rng(seed ^ 0x85ebca6b);
  const run = createRun();
  const floors: FloorReport[] = [];
  let elapsed = 0, cause: Cause | null = null;

  for (let level = 1; level <= FLOORS; level++) {
    const report = simulateFloor(seed + level - 1, level, run, policy, nerve, draft);
    floors.push(report);
    elapsed += report.seconds;
    if (report.outcome !== 'cleared') {
      // Whatever took the last of the vitality is what the run log would record.
      const damage = report.damage;
      cause = (Object.keys(damage) as Cause[]).filter(k => damage[k] > 0).sort((a, b) => damage[b] - damage[a])[0] ?? null;
      return { seed, weapon: policy.weapon.id, outcome: report.outcome === 'died' ? 'died' : 'stuck', floor: level, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], floors };
    }
    // Descending restores a quarter of the bar, as the results card promises.
    if (level < FLOORS) heal(run, Math.round(run.maxHp * 0.25));
  }
  return { seed, weapon: policy.weapon.id, outcome: 'escaped', floor: FLOORS, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], floors };
}

function simulateFloor(seed: number, level: number, run: Run, policy: Policy, nerve: () => number, draft: () => number): FloorReport {
  const floor = generateFloor(seed, level);
  const weapon = policy.weapon;
  const damage = Object.fromEntries([...ENEMY_KINDS, 'hazard'].map(cause => [cause, 0])) as Record<Cause, number>;
  let surrounded = 0, contact = 0, shotCount = 0, landedCount = 0, specialCount = 0;
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
  const branchCells = branchFootprint(floor);
  // Every cell the knight has ever stood on, keyed the same way `pursuit`/`goalField` are, so a second
  // arrival on one is a single Set lookup.
  const visitedCells = new Set<number>();
  const corridorTileSet = new Set<number>();
  let backtracking = false;
  let idleCorridor = 0, idleBarren = 0, idleSpent = 0, idleLiveNoContact = 0, idleBacktrack = 0;
  let corridorSeconds = 0, spentRecross = 0;

  const bodies: Body[] = floor.spawns.map((spawn, index) => {
    const stats = enemyStats(spawn.kind, level);
    return {
      kind: spawn.kind, x: spawn.x * TILE, z: spawn.z * TILE,
      hp: stats.hp, damage: stats.damage, tell: stats.tell, speed: stats.speed,
      // dungeon-game.tsx:617 staggers the opening cooldown so a pack does not swing as one.
      cooldown: 0.4 + (index % 3) * 0.2, hitFlash: 0, windup: 0, lunge: 0,
      aim: { x: 0, z: 0 }, room: spawn.room, awake: !spawn.ambush, dead: false,
      anchor: { x: spawn.x * TILE, z: spawn.z * TILE }, notice: 0, alertIn: Infinity,
    };
  });

  // dungeon-game.tsx:578 lays three ember rings across a gauntlet, offset along x from the room's heart.
  const hazards = floor.rooms.flatMap(room => room.id !== 0 && room.encounter === 'gauntlet'
    ? [-2.5, 0, 2.5].map(offset => ({ x: room.x * TILE + offset, z: room.z * TILE, room: room.id, burned: false }))
    : []);

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
  const cleared = new Set<number>([0]);
  // Plan 016 fight duration: when each room's fight started, and how long each finished one took.
  const fightStart = new Map<number, number>(), fights: number[] = [];
  const clearRoom = (room: number) => {
    cleared.add(room);
    const began = fightStart.get(room);
    if (began !== undefined) { fights.push(+(t - began).toFixed(2)); fightStart.delete(room); }
  };

  const goal = floor.rooms[floor.goal];
  const stair = { x: goal.x * TILE, z: goal.z * TILE };
  // One flood per destination, reused every frame: the keep does not move, only the knight does.
  const goalField = flood(floor.cells, goal.x, goal.z);
  const branchFields = new Map<number, Map<number, number>>();
  const fieldFor = (room: number) => {
    let field = branchFields.get(room);
    if (!field) { const target = floor.rooms[room]; field = flood(floor.cells, target.x, target.z); branchFields.set(room, field); }
    return field;
  };

  let playerCell = '';
  let pursuit = new Map<number, number>();
  const world: World = {
    cells: floor.cells,
    get activeRoom() { return floor.roomByCell.get(cellKey(Math.round(player.x / TILE), Math.round(player.z / TILE))) ?? -1; },
    pathDistance: (x: number, z: number) => pursuit.get(packKey(x, z)) ?? Infinity,
  };

  const stairClear = () => bodies.every(b => b.room !== floor.goal || b.dead);

  while (t < FLOOR_TIMEOUT) {
    t += DT;
    tickRun(run, DT);
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
      backtracking = branchCells.has(packed) && visitedCells.has(packed);
      visitedCells.add(packed);
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
    if (activeRoom >= 0) for (const body of bodies) {
      if (body.room === activeRoom && !body.awake && !body.dead) { body.awake = true; body.cooldown = Math.max(body.cooldown, 0.9); }
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
      const bolt = BESTIARY[b.kind].bolt;
      if (!bolt) return b.tell - b.windup >= policy.reaction;
      return b.windup <= AIM_LOCK && AIM_LOCK - b.windup + Math.hypot(b.x - player.x, b.z - player.z) / bolt.speed >= policy.reaction;
    };
    const threat = live.find(b => b.windup > 0 && readable(b)
      && Math.hypot(b.x - player.x, b.z - player.z) < STRIKE_RANGE[b.kind] + (BESTIARY[b.kind].attack === 'pounce' ? 2.6 : 0.4));
    if (threat && dashCooldown <= 0 && dashTime <= 0 && canAbortSwing(attackTime, swing) && nerve() < policy.dodge) {
      // A pounce or a bolt is out-run sideways; a swing is out-run backwards.
      const away = unit(player.x - threat.x, player.z - threat.z);
      const step = BESTIARY[threat.kind].attack !== 'swing' ? { x: -away.z, z: away.x } : away;
      facing.x = step.x; facing.z = step.z;
      dashTime = DASH_TIME; dashCooldown = run.dashSpan; attackTime = 0; chainBeat = 0; chainIdle = Infinity; swing = weapon; swingHits.clear();
      charging = null; swingKind = 'strike';
    }

    // Only a body the knight could actually walk at in a straight line is worth charging. Without the
    // lane check it charges one through the wall of the next room and grinds there until the timeout,
    // which is what eight runs in ten did before this line existed.
    const target = live
      .map(b => ({ body: b, distance: Math.hypot(b.x - player.x, b.z - player.z) }))
      .filter(entry => entry.distance < 14 && hasClearPath(floor.cells, player, entry.body))
      .sort((a, b) => a.distance - b.distance)[0];

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
      // Nothing awake in reach: walk the flood. A branch worth plundering first, then the stair.
      const detour = policy.explore
        ? floor.rooms.find(room => room.role === 'branch' && !cleared.has(room.id))
        : undefined;
      const field = stairClear() || !detour ? goalField : fieldFor(detour.id);
      const here = field.get(packKey(cellX, cellZ));
      const next = ([[cellX + 1, cellZ], [cellX - 1, cellZ], [cellX, cellZ + 1], [cellX, cellZ - 1]] as [number, number][])
        .filter(([x, z]) => floor.cells.has(cellKey(x, z)))
        .sort((a, b) => (field.get(packKey(a[0], a[1])) ?? Infinity) - (field.get(packKey(b[0], b[1])) ?? Infinity))[0];
      const ahead = next ? field.get(packKey(next[0], next[1])) ?? Infinity : Infinity;
      if (next && (here === undefined || ahead < here)) move = unit(next[0] * TILE - player.x, next[1] * TILE - player.z);
      else if (stairClear()) move = unit(stair.x - player.x, stair.z - player.z);
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
            body.hp -= swing.damage + run.strike; body.hitFlash = 0.2;
            if (body.hp <= 0) {
              body.dead = true;
              resolveKill(run);
              if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
                clearRoom(body.room);
                clearRoomReward(run, floor.rooms[body.room].role === 'branch');
              }
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
        landBlow(floor.cells, body, body, { damage: swing.damage + run.strike, stagger: swing.stagger, knockback: shover.knockback, wardenKnockback: shover.wardenKnockback }, unit(body.x - player.x, body.z - player.z));
        if (body.hp <= 0) {
          body.dead = true;
          resolveKill(run);
          if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
            clearRoom(body.room);
            clearRoomReward(run, floor.rooms[body.room].role === 'branch');
          }
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
      const view: EnemyView = { kind: body.kind, x: body.x, z: body.z, room: body.room, cooldown: body.cooldown, hitFlash: body.hitFlash, windup: body.windup, lunge: body.lunge, tell: body.tell, speed: body.speed, aim: body.aim, anchor: body.anchor, notice: body.notice };
      const intent = decideEnemy(view, player, { ...world, activeRoom }, DT);
      const startedNoticing = body.notice <= 0 && intent.notice > 0;
      body.cooldown = intent.cooldown; body.hitFlash = intent.hitFlash; body.windup = intent.windup;
      body.lunge = intent.lunge; body.aim = intent.aim; body.notice = intent.notice;
      body.x = intent.x; body.z = intent.z;
      if (startedNoticing) {
        const snapshot: Wakeable[] = bodies.map(b => ({ x: b.x, z: b.z, room: b.room, notice: b.notice, dead: b.dead || !b.awake }));
        nearbyDozers(snapshot, i).forEach((idx, rank) => {
          const delay = (rank + 1) * ALERT_STAGGER;
          if (delay < bodies[idx].alertIn) bodies[idx].alertIn = delay;
        });
      }
      if (intent.hit) {
        const dealt = hurt(run, body.damage, { dashing: dashImmune(dashTime), warded: true });
        damage[body.kind] += dealt;
        if (dealt && live.filter(b => Math.hypot(b.x - player.x, b.z - player.z) < 4).length >= 3) surrounded += dealt;
        if (run.hp <= 0) return endFloor('died');
      }
      // dungeon-game.tsx looses the same bolt on the same frame.
      const bolt = BESTIARY[body.kind].bolt;
      if (intent.loose && bolt) hostile.push({ kind: body.kind, shot: hostileBolt(body, intent.loose, bolt, body.damage) });
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
      if (dealt && live.filter(b => Math.hypot(b.x - player.x, b.z - player.z) < 4).length >= 3) surrounded += dealt;
      if (run.hp <= 0) return endFloor('died');
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
          landBlow(floor.cells, body, body, blow, unit(body.x - player.x, body.z - player.z));
          if (drags && hurled?.hurl && harpoon) {
            harpoon.dragged = true;
            const pull = dragToward(body, player, hurled.hurl.drag);
            moveOnFloor(floor.cells, body, pull.x, pull.z);
          }
          if (body.hp <= 0) {
            body.dead = true;
            resolveKill(run);
            if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
              clearRoom(body.room);
              clearRoomReward(run, floor.rooms[body.room].role === 'branch');
            }
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
        if (body.dead || !body.awake || !poolCatches(pool, body.x, body.z)) continue;
        body.hp -= pool.damage;
        body.hitFlash = 0.2;
        if (body.hp <= 0) {
          body.dead = true;
          resolveKill(run);
          if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
            clearRoom(body.room);
            clearRoomReward(run, floor.rooms[body.room].role === 'branch');
          }
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
      // Cross-cutting: counted above in whichever of the four it fell into, and again here.
      if (backtracking) idleBacktrack += DT;
    }
    else aloneRun = 0;

    const crowd: CrowdBody[] = bodies.map(b => ({ x: b.x, z: b.z, windup: b.windup, dead: b.dead || !b.awake }));
    separateCrowd(floor.cells, crowd, DT).forEach((spot, i) => { if (!crowd[i].dead) { bodies[i].x = spot.x; bodies[i].z = spot.z; } });

    // --- the keep's own teeth ------------------------------------------------------------------
    // dungeon-game.tsx:855: one 3.6s cycle per room, firing in its last second, one tick per flare.
    for (const ring of hazards) {
      const phase = (t + ring.room * 0.7) % 3.6, firing = phase > 2.6;
      if (!firing) { ring.burned = false; continue; }
      if (ring.burned || Math.hypot(ring.x - player.x, ring.z - player.z) >= 1.8) continue;
      const dealt = hurt(run, 10, { dashing: dashImmune(dashTime) });
      if (dealt) { ring.burned = true; damage.hazard += dealt; if (run.hp <= 0) return endFloor('died'); }
    }

    // --- shrines, boons, the stair ---------------------------------------------------------------
    if (run.pendingRanks > 0) {
      run.choosing = true;
      const offer = draftBoons(run, draft);
      takeBoon(run, policy.pickBoon ? policy.pickBoon(offer, run) : offer[0].id);
    }

    if (stairClear()) {
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
      level, outcome, seconds: +t.toFixed(1), kills: run.kills - startKills, spawns: floor.spawns.length, damage, surrounded,
      contact: +contact.toFixed(1), idle: +idle.toFixed(1),
      idleCorridor: +idleCorridor.toFixed(2), idleBarren: +idleBarren.toFixed(2), idleSpent: +idleSpent.toFixed(2),
      idleLiveNoContact: +idleLiveNoContact.toFixed(2), idleBacktrack: +idleBacktrack.toFixed(2),
      corridorSeconds: +corridorSeconds.toFixed(2), corridorTiles: corridorTileSet.size,
      barrenRooms: barrenRoomIds.size, spentRecrossings: spentRecross,
      alone: +aloneMax.toFixed(1),
      firstContact: +(firstContactCount ? firstContactSum / firstContactCount : 0).toFixed(2),
      shots: shotCount, landed: landedCount, specials: specialCount, fights, hpAfter: run.hp, maxHpAfter: run.maxHp, rankAfter: run.rankLevel,
    };
  }
}
