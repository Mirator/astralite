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
import { canAbortSwing, swordContacts } from '../../app/dungeon-combat.ts';
import { decideEnemy, enemyStats, interruptsWindup, separateCrowd, STRIKE_RANGE, type CrowdBody, type EnemyKind, type EnemyView, type World } from '../../app/dungeon-enemy.ts';
import { playerAttackPose } from '../../app/dungeon-attack-pose.ts';
import { TILE, cellKey, generateFloor, hasClearPath, moveOnFloor } from '../../app/dungeon-floor.ts';
import { TIDEBLADE } from '../../app/dungeon-weapon.ts';
import { clearRoomReward, createRun, draftBoons, heal, hurt, resolveKill, STAIR_DWELL, STAIR_RADIUS, stairDwellStep, takeBoon, tickRun, type Boon, type Run } from '../../app/dungeon-sim.ts';

/** Matches the FLOORS constant in dungeon-game.tsx. */
export const FLOORS = 3;
/** The game runs on rAF with deltas clamped to 40ms; a fixed step keeps a seeded run reproducible. */
const DT = 1 / 60;
/** A floor that has not resolved in this much simulated time is reported stuck rather than scored. */
const FLOOR_TIMEOUT = 480;

export type Cause = 'guard' | 'stalker' | 'warden' | 'hazard';

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
  /** Which card to take from a draft. Defaults to the first offered. */
  pickBoon?: (offer: Boon[], run: Run) => string;
};

export const DEFAULT_POLICY: Policy = { reaction: 0.22, dodge: 0.8, explore: true };

export type FloorReport = {
  level: number;
  /** 'cleared' reached the stair, 'died' ran out of vitality, 'stuck' hit the timeout. */
  outcome: 'cleared' | 'died' | 'stuck';
  seconds: number;
  kills: number;
  spawns: number;
  /** Vitality lost on this floor, split by what dealt it. */
  damage: Record<Cause, number>;
  hpAfter: number;
  maxHpAfter: number;
  rankAfter: number;
};

export type RunReport = {
  seed: number;
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
};

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
      return { seed, outcome: report.outcome === 'died' ? 'died' : 'stuck', floor: level, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], floors };
    }
    // Descending restores a quarter of the bar, as the results card promises.
    if (level < FLOORS) heal(run, Math.round(run.maxHp * 0.25));
  }
  return { seed, outcome: 'escaped', floor: FLOORS, cause, seconds: +elapsed.toFixed(1), kills: run.kills, totalXp: run.totalXp, rank: run.rankLevel, boons: [...run.taken], floors };
}

function simulateFloor(seed: number, level: number, run: Run, policy: Policy, nerve: () => number, draft: () => number): FloorReport {
  const floor = generateFloor(seed, level);
  const damage: Record<Cause, number> = { guard: 0, stalker: 0, warden: 0, hazard: 0 };
  const startKills = run.kills;

  const bodies: Body[] = floor.spawns.map((spawn, index) => {
    const stats = enemyStats(spawn.kind, level);
    return {
      kind: spawn.kind, x: spawn.x * TILE, z: spawn.z * TILE,
      hp: stats.hp, damage: stats.damage, tell: stats.tell, speed: stats.speed,
      // dungeon-game.tsx:617 staggers the opening cooldown so a pack does not swing as one.
      cooldown: 0.4 + (index % 3) * 0.2, hitFlash: 0, windup: 0, lunge: 0,
      aim: { x: 0, z: 0 }, room: spawn.room, awake: !spawn.ambush, dead: false,
    };
  });

  // dungeon-game.tsx:578 lays three ember rings across a gauntlet, offset along x from the room's heart.
  const hazards = floor.rooms.flatMap(room => room.id !== 0 && room.encounter === 'gauntlet'
    ? [-2.5, 0, 2.5].map(offset => ({ x: room.x * TILE + offset, z: room.z * TILE, room: room.id, burned: false }))
    : []);

  const player = { x: floor.rooms[0].x * TILE, z: floor.rooms[0].z * TILE };
  const facing = { x: 0, z: 1 };
  let attackFacing = { x: 0, z: 1 };
  let attackTime = 0, dashTime = 0, dashCooldown = 0, stairDwell = 0, t = 0;
  const swingHits = new Set<Body>();
  const cleared = new Set<number>([0]);

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
    if (key !== playerCell) { playerCell = key; pursuit = flood(floor.cells, cellX, cellZ, 24); }
    const activeRoom = world.activeRoom;

    // dungeon-game.tsx:826 springs a room's ambush the moment the knight is inside it.
    if (activeRoom >= 0) for (const body of bodies) {
      if (body.room === activeRoom && !body.awake && !body.dead) { body.awake = true; body.cooldown = Math.max(body.cooldown, 0.9); }
    }

    // A room the knight stands in with nothing left alive is done with, even if it never held a body to
    // kill. The reward itself is paid on the killing blow, as the game pays it; this only stops the
    // navigator from walking back to a chamber it has already emptied.
    if (activeRoom >= 0 && !cleared.has(activeRoom) && bodies.every(b => b.room !== activeRoom || b.dead)) cleared.add(activeRoom);

    const live = bodies.filter(b => !b.dead && b.awake);

    // --- the knight's turn ---------------------------------------------------------------------
    // A tell it has had time to read, from something close enough to land, is worth a dodge.
    const threat = live.find(b => b.windup > 0 && b.tell - b.windup >= policy.reaction
      && Math.hypot(b.x - player.x, b.z - player.z) < STRIKE_RANGE[b.kind] + (b.kind === 'stalker' ? 2.6 : 0.4));
    if (threat && dashCooldown <= 0 && dashTime <= 0 && canAbortSwing(attackTime, TIDEBLADE) && nerve() < policy.dodge) {
      // A pounce is out-run sideways; a swing is out-run backwards.
      const away = unit(player.x - threat.x, player.z - threat.z);
      const step = threat.kind === 'stalker' ? { x: -away.z, z: away.x } : away;
      facing.x = step.x; facing.z = step.z;
      dashTime = 0.18; dashCooldown = run.dashSpan; attackTime = 0; swingHits.clear();
    }

    // Only a body the knight could actually walk at in a straight line is worth charging. Without the
    // lane check it charges one through the wall of the next room and grinds there until the timeout,
    // which is what eight runs in ten did before this line existed.
    const target = live
      .map(b => ({ body: b, distance: Math.hypot(b.x - player.x, b.z - player.z) }))
      .filter(entry => entry.distance < 14 && hasClearPath(floor.cells, player, entry.body))
      .sort((a, b) => a.distance - b.distance)[0];

    let move: { x: number; z: number } | null = null;
    if (target && dashTime <= 0) {
      const toward = unit(target.body.x - player.x, target.body.z - player.z);
      if (target.distance > 1.55 + run.reach) move = toward;
      else if (attackTime <= 0) { attackTime = TIDEBLADE.duration; attackFacing = toward; facing.x = toward.x; facing.z = toward.z; swingHits.clear(); }
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
    const threatened = live.some(b => (b.x - player.x) ** 2 + (b.z - player.z) ** 2 < 100);
    const speed = dashTime > 0 ? 12 : attackTime > 0 ? TIDEBLADE.moveSpeed : threatened ? 5.8 : 8.5;
    if (dashTime > 0) moveOnFloor(floor.cells, player, facing.x * speed * DT, facing.z * speed * DT);
    else if (move) moveOnFloor(floor.cells, player, move.x * speed * DT, move.z * speed * DT);

    // --- the blade -----------------------------------------------------------------------------
    if (attackTime > 0) {
      attackTime = Math.max(0, attackTime - DT);
      const pose = playerAttackPose(TIDEBLADE.duration - attackTime, TIDEBLADE);
      if (pose.active) for (const body of bodies) {
        if (body.dead || !body.awake || swingHits.has(body)) continue;
        if (!swordContacts(floor.cells, player, attackFacing, body, run.reach, TIDEBLADE)) continue;
        swingHits.add(body);
        body.hp -= run.strike + TIDEBLADE.damage - 1;
        body.hitFlash = 0.2;
        if (interruptsWindup(body.kind, body.windup)) body.windup = 0;
        body.cooldown = Math.max(body.cooldown, 0.4);
        const push = unit(body.x - player.x, body.z - player.z), shove = body.kind === 'warden' ? TIDEBLADE.wardenKnockback : TIDEBLADE.knockback;
        moveOnFloor(floor.cells, body, push.x * shove, push.z * shove);
        if (body.hp <= 0) {
          body.dead = true;
          resolveKill(run);
          if (!cleared.has(body.room) && bodies.every(b => b.room !== body.room || b.dead)) {
            cleared.add(body.room);
            clearRoomReward(run, floor.rooms[body.room].role === 'branch');
          }
        }
      }
    }

    // --- every body ----------------------------------------------------------------------------
    for (const body of bodies) {
      if (body.dead || !body.awake) continue;
      const view: EnemyView = { kind: body.kind, x: body.x, z: body.z, room: body.room, cooldown: body.cooldown, hitFlash: body.hitFlash, windup: body.windup, lunge: body.lunge, tell: body.tell, speed: body.speed, aim: body.aim };
      const intent = decideEnemy(view, player, { ...world, activeRoom }, DT);
      body.cooldown = intent.cooldown; body.hitFlash = intent.hitFlash; body.windup = intent.windup;
      body.lunge = intent.lunge; body.aim = intent.aim;
      if (intent.act !== 'inert') { body.x = intent.x; body.z = intent.z; }
      if (intent.hit) {
        const dealt = hurt(run, body.damage, { dashing: dashTime > 0, warded: true });
        damage[body.kind] += dealt;
        if (run.hp <= 0) return endFloor('died');
      }
    }

    const crowd: CrowdBody[] = bodies.map(b => ({ x: b.x, z: b.z, windup: b.windup, dead: b.dead || !b.awake }));
    separateCrowd(floor.cells, crowd, DT).forEach((spot, i) => { if (!crowd[i].dead) { bodies[i].x = spot.x; bodies[i].z = spot.z; } });

    // --- the keep's own teeth ------------------------------------------------------------------
    // dungeon-game.tsx:855: one 3.6s cycle per room, firing in its last second, one tick per flare.
    for (const ring of hazards) {
      const phase = (t + ring.room * 0.7) % 3.6, firing = phase > 2.6;
      if (!firing) { ring.burned = false; continue; }
      if (ring.burned || Math.hypot(ring.x - player.x, ring.z - player.z) >= 1.8) continue;
      const dealt = hurt(run, 10, { dashing: dashTime > 0 });
      if (dealt) { ring.burned = true; damage.hazard += dealt; if (run.hp <= 0) return endFloor('died'); }
    }

    // --- shrines, boons, the stair ---------------------------------------------------------------
    if (run.pendingRanks > 0) {
      run.choosing = true;
      const offer = draftBoons(run, draft);
      takeBoon(run, policy.pickBoon ? policy.pickBoon(offer, run) : offer[0].id);
    }

    if (stairClear()) {
      const onStair = Math.hypot(player.x - stair.x, player.z - stair.z) < STAIR_RADIUS;
      stairDwell = stairDwellStep(stairDwell, onStair, dashTime > 0, DT);
      if (stairDwell >= STAIR_DWELL) return endFloor('cleared');
    }
  }
  return endFloor('stuck');

  function endFloor(outcome: FloorReport['outcome']): FloorReport {
    return { level, outcome, seconds: +t.toFixed(1), kills: run.kills - startKills, spawns: floor.spawns.length, damage, hpAfter: run.hp, maxHpAfter: run.maxHp, rankAfter: run.rankLevel };
  }
}
