// The spatial half of a run: whether a body is close enough to care, which way it steps, and whether a
// blow reaches across the gap. Nothing here imports three.js or touches the DOM — dungeon-game.tsx owns
// the THREE.Group, the poses, the sound and the particles, and asks this module for the decision behind
// each of them. Everything works over plain {x, z} points, so a whole fight can be replayed in node
// instead of by hand-driving a browser, which is how every spatial regression here has been caught.
import { TILE, cellKey, hasClearPath, moveOnFloor } from './dungeon-floor.ts';

export type Point = { x: number; z: number };
export type EnemyKind = 'guard' | 'stalker' | 'warden';

// A body stops caring about the knight once the walk to him is long enough. The cutoff is generous
// inside the room he stands in — a hall should wake as one — and tight everywhere else, so the floor
// does not simulate a pursuit three rooms away that the player will never see.
export const ACTIVATION = { sameRoom: 22, elsewhere: 10 };
// How far a committed blow actually reaches, versus how far away the enemy will start winding one up.
// The gap between the two is the telegraph: it commits while you are still walking in.
export const STRIKE_RANGE: Record<EnemyKind, number> = { guard: 1.55, stalker: 1.55, warden: 2.55 };
export const ATTACK_RANGE: Record<EnemyKind, number> = { guard: 1.15, stalker: 4.2, warden: 2.2 };
// Inside this it stands its ground rather than shuffling into the knight's chest.
export const HOLD_RANGE: Record<EnemyKind, number> = { guard: 1.15, stalker: 1.15, warden: 2.0 };
// Recovery after a swing lands or misses. A stalker pays most for its pounce.
export const RECOVERY: Record<EnemyKind, number> = { guard: 1.25, stalker: 1.7, warden: 1.6 };
export const LUNGE_SPEED = 13, LUNGE_TIME = 0.32, LUNGE_CONTACT = 0.85;
// Bodies hold each other this far apart, corrected gently rather than snapped.
export const CROWD_SPACING = 0.82, CROWD_PUSH_RATE = 3;
// Past this the enemy stops walking straight at the knight and follows the flood instead, which is what
// gets it round a corner; inside it, a straight line is both correct and smoother to watch.
export const DIRECT_STEP = TILE * 1.5;

// Everything a decision reads off an enemy. The renderer's Enemy also carries a THREE.Group, a health
// bar, a telegraph mesh and a gait phase; none of that decides anything.
export type EnemyView = { kind: EnemyKind; x: number; z: number; room: number; cooldown: number; hitFlash: number; windup: number; lunge: number; tell: number; speed: number; aim: Point };

export type World = {
  cells: Set<string>;
  // The room the knight stands in; -1 in a corridor, which no enemy claims, so corridor-standing keeps
  // every body on the tight cutoff.
  activeRoom: number;
  // Steps along walkable floor from the knight to that cell. Anything the flood never reached must read
  // back as Infinity — see isActive for what a missing value means.
  pathDistance: (cellX: number, cellZ: number) => number;
};

// What the enemy should do this frame. The caller applies it: it owns the body, the animation and the
// damage call. `act` says which branch ran, because each drives a different set of poses:
//   inert  — too far to simulate. Only cooldown and hitFlash are meaningful; ignore the rest.
//   lunge  — mid-pounce. Already moved; the trailing walk/idle animation is skipped for it.
//   windup — committed to a swing, weapon rising. `hit` on the frame the tell runs out.
//   ready  — on guard: turned to `face`, and stepped if it had room to.
export type EnemyIntent = {
  act: 'inert' | 'lunge' | 'windup' | 'ready';
  x: number; z: number;
  cooldown: number; hitFlash: number; windup: number; lunge: number;
  aim: Point;
  // Yaw to turn the body to, or null to leave it as it is (a lunging or winding body is committed).
  face: number | null;
  // This frame's blow connects. The caller decides what the knight's invulnerability makes of it.
  hit: boolean;
  sound: 'warn' | 'dash' | null;
  // Range to the knight before this frame's movement, which is what the gait and the poses read.
  // Not computed for an inert body, which nothing looks at again this frame.
  distance: number;
};

export type CrowdBody = { x: number; z: number; windup: number; dead: boolean };

// Frame deltas arrive from rAF, from the manual stepper and from a tab that was hidden for a minute, so
// a junk one is dropped rather than subtracted: a single NaN would otherwise make every cooldown NaN
// and freeze that body's cooldown gate open forever.
const step = (dt: number) => Number.isFinite(dt) && dt > 0 ? dt : 0;
// THREE's normalize divides by `length || 1`, so a zero vector normalizes to zero rather than to NaN.
const unit = (x: number, z: number, length: number): Point => ({ x: x / (length || 1), z: z / (length || 1) });

// A cell the flood never reached is unreachable, not adjacent: anything non-finite reads as far away.
export const isActive = (pathDistance: number, sameRoom: boolean) =>
  (Number.isFinite(pathDistance) ? pathDistance : Infinity) <= (sameRoom ? ACTIVATION.sameRoom : ACTIVATION.elsewhere);

// The four orthogonal neighbours, nearest-to-the-knight first, walls dropped. The candidate order is
// the tiebreak, so a body crossing an open hall leans the same way every frame instead of shivering
// between two equally good steps. Null when the body is walled in on all four sides.
export function pursuitStep(world: World, cellX: number, cellZ: number): [number, number] | null {
  const open = ([[cellX + 1, cellZ], [cellX - 1, cellZ], [cellX, cellZ + 1], [cellX, cellZ - 1]] as [number, number][]).filter(([x, z]) => world.cells.has(cellKey(x, z)));
  return open.sort((a, b) => world.pathDistance(a[0], a[1]) - world.pathDistance(b[0], b[1]))[0] ?? null;
}

// A 13 u/s pounce covers most of a tile in one frame, so contact is tested against the whole segment it
// swept. Testing only where it landed let a stalker pass clean through the knight and stop behind him.
export function sweptContact(from: Point, to: Point, target: Point, radius = LUNGE_CONTACT) {
  const travelX = to.x - from.x, travelZ = to.z - from.z, towardX = target.x - from.x, towardZ = target.z - from.z;
  const fraction = Math.min(1, Math.max(0, (towardX * travelX + towardZ * travelZ) / Math.max(0.0001, travelX * travelX + travelZ * travelZ)));
  return Math.hypot(from.x + travelX * fraction - target.x, from.z + travelZ * fraction - target.z) < radius;
}

// Resolve a crowd so bodies do not stack into one silhouette. Two short passes keep the correction
// gentle; a body mid-windup carries no weight, because shoving a guard out of its own committed swing
// reads as the swing missing for no reason the player can see. Returns fresh points, in input order.
export function separateCrowd(cells: Set<string>, bodies: readonly CrowdBody[], dt: number): Point[] {
  const moved = bodies.map(body => ({ x: body.x, z: body.z }));
  if (!(step(dt) > 0)) return moved;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    if (bodies[i].dead || bodies[j].dead) continue;
    const a = moved[i], b = moved[j];
    let dx = b.x - a.x, dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= CROWD_SPACING) continue;
    // Two bodies exactly on top of each other have no direction to separate along; any axis will do.
    if (distance < 0.001) { dx = 1; dz = 0; } else { dx /= distance; dz /= distance; }
    const weightA = bodies[i].windup > 0 ? 0 : 1, weightB = bodies[j].windup > 0 ? 0 : 1, total = weightA + weightB;
    if (!total) continue;
    const push = Math.min(CROWD_SPACING - distance, dt * CROWD_PUSH_RATE);
    moveOnFloor(cells, a, -dx * push * weightA / total, -dz * push * weightA / total);
    moveOnFloor(cells, b, dx * push * weightB / total, dz * push * weightB / total);
  }
  return moved;
}

// One enemy, one frame. Assumes the caller has already dropped the asleep and the dying — those two are
// visual states the renderer resolves, and neither ticks a cooldown.
export function decideEnemy(enemy: EnemyView, player: Point, world: World, frameDt: number): EnemyIntent {
  const dt = step(frameDt);
  // Ticked before the activation cutoff, so a body that has been standing in a far room still comes out
  // of its recovery: reaching it must not hand the player a free swing it never earned.
  const hitFlash = Math.max(0, enemy.hitFlash - dt), cooldown = enemy.cooldown - dt;
  const rest = { x: enemy.x, z: enemy.z, cooldown, hitFlash, windup: enemy.windup, lunge: enemy.lunge, aim: { x: enemy.aim.x, z: enemy.aim.z }, face: null, hit: false, sound: null } satisfies Omit<EnemyIntent, 'act' | 'distance'>;
  const cellX = Math.round(enemy.x / TILE), cellZ = Math.round(enemy.z / TILE);
  if (!isActive(world.pathDistance(cellX, cellZ), enemy.room === world.activeRoom)) return { ...rest, act: 'inert', distance: 0 };

  const toX = player.x - enemy.x, toZ = player.z - enemy.z, distance = Math.hypot(toX, toZ);

  if (enemy.lunge > 0) {
    const landed = { x: enemy.x, z: enemy.z };
    moveOnFloor(world.cells, landed, enemy.aim.x * LUNGE_SPEED * dt, enemy.aim.z * LUNGE_SPEED * dt);
    // Connecting ends the pounce outright, so one leap can never bill the knight twice.
    const hit = sweptContact(enemy, landed, player);
    return { ...rest, act: 'lunge', x: landed.x, z: landed.z, lunge: hit ? 0 : Math.max(0, enemy.lunge - dt), hit, distance };
  }

  if (enemy.windup > 0) {
    const windup = Math.max(0, enemy.windup - dt);
    if (windup > 0) return { ...rest, act: 'windup', windup, distance };
    // The tell has run out and the swing is committed: it is tested against where the knight is *now*,
    // along the direction it aimed at when it started, which is what makes stepping around it work.
    const pounce = enemy.kind === 'stalker';
    const aimed = (toX * enemy.aim.x + toZ * enemy.aim.z) / (distance || 1);
    const hit = !pounce && distance < STRIKE_RANGE[enemy.kind] && hasClearPath(world.cells, enemy, player) && aimed > 0.45;
    return { ...rest, act: 'windup', windup: 0, cooldown: RECOVERY[enemy.kind], lunge: pounce ? LUNGE_TIME : enemy.lunge, hit, sound: pounce ? 'dash' : null, distance };
  }

  // On guard. Turning is free and happens even while flinching, so a hit never leaves a body facing the
  // wrong way once it recovers.
  const face = Math.atan2(-toX, -toZ);
  if (hitFlash > 0) return { ...rest, act: 'ready', face, distance };
  const clearAttackLine = distance <= ATTACK_RANGE[enemy.kind] && hasClearPath(world.cells, enemy, player);
  if (clearAttackLine && cooldown <= 0) return { ...rest, act: 'ready', face, windup: enemy.tell, aim: unit(toX, toZ, distance), sound: 'warn', distance };
  // Hold position when already in place with a clear line, and let a stalker stand still late in its
  // recovery rather than trotting in with a swing it cannot throw yet.
  if (!(distance > HOLD_RANGE[enemy.kind] || !clearAttackLine)) return { ...rest, act: 'ready', face, distance };
  if (enemy.kind === 'stalker' && !(cooldown < 0.9)) return { ...rest, act: 'ready', face, distance };

  let dirX = toX, dirZ = toZ;
  if (distance > DIRECT_STEP || !clearAttackLine) {
    const next = pursuitStep(world, cellX, cellZ);
    if (next) { dirX = next[0] * TILE - enemy.x; dirZ = next[1] * TILE - enemy.z; }
  }
  const direction = unit(dirX, dirZ, Math.hypot(dirX, dirZ));
  const landed = { x: enemy.x, z: enemy.z };
  moveOnFloor(world.cells, landed, direction.x * enemy.speed * dt, direction.z * enemy.speed * dt);
  return { ...rest, act: 'ready', face, x: landed.x, z: landed.z, distance };
}
