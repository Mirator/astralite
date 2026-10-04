// Things that travel. Every melee rule in this keep resolves in the frame it is asked about — the arc
// is tested, the body is in it or not — and none of that helps a bolt, which exists across frames and
// has to be stopped by the first wall or body it meets rather than by wherever it happened to land.
//
// Pure, like the rest of the rules: no React, no DOM, no three.js. The renderer owns the mesh and the
// trail; this owns whether the shot connected and where it stopped.
import { deathPoolOf, type Bolt, type EliteModifier, type EnemyKind } from './dungeon-bestiary.ts';
import { TILE, cellKey } from './dungeon-floor.ts';

export type Shot = {
  x: number; z: number;
  /** Normalised heading. A bolt does not steer. */
  dx: number; dz: number;
  /** Units a second. */
  speed: number;
  /** Seconds of flight left before it falls out of the air. */
  life: number;
  /** How many more bodies it can pass through before it stops. */
  pierce: number;
  damage: number;
  /** Bodies it has already billed, so one bolt never bills the same body twice. */
  spent: Set<number>;
};

/** Anything a bolt can hit. Index is the caller's, and is what comes back in `hits`. */
export type Mark = { x: number; z: number; index: number };

export type Flight = {
  /** Where the bolt is now. */
  x: number; z: number;
  life: number;
  pierce: number;
  /** Indices struck this step, nearest first, each at most once across the bolt's whole life. */
  hits: number[];
  /** The bolt is finished: it hit stone, ran out of bodies to pass through, or ran out of air. */
  done: boolean;
  /** It stopped because of a wall rather than a body or the clock, which is what sparks off stone. */
  struck: boolean;
};

/** How many enemy arrows the game can have in the air at once: a thirteenth volley is silently dropped, so a boss's volleys are designed inside it (`volleyDemand`, dungeon-enemy.ts). */
export const ARROW_POOL = 12;

/**
 * The headings a volley is loosed along (plan 021): its aim, and for a fan `count` bolts `spread` radians apart centred on it, the aimed one first and then outward, left then right, so a pool
 * that ran short would drop the outermost bolts and never the one that was aimed. A volley without a fan is the one heading, as it always was.
 */
export const fanHeadings = (aim: { x: number; z: number }, fan?: Bolt['fan']): { x: number; z: number }[] => {
  const count = fan ? Math.max(1, Math.floor(finite(fan.count))) : 1, spread = fan ? finite(fan.spread) : 0, angle = Math.atan2(aim.x, aim.z);
  return Array.from({ length: count }, (_, n) => {
    const away = Math.ceil(n / 2) * (n % 2 ? -1 : 1), turned = angle + away * spread;
    return n === 0 ? { x: aim.x, z: aim.z } : { x: Math.sin(turned), z: Math.cos(turned) };
  });
};

/** How close a bolt passes before it counts. Generous, because a bolt is thin and a body is not. */
export const BOLT_RADIUS = 0.62;
/**
 * A bolt covers most of a tile in a frame at any speed worth having, so flight is walked in steps no
 * longer than this rather than teleported. Testing only where it landed let it pass clean through a
 * body and carry on, which is the same bug the stalker's pounce had before sweptContact existed.
 */
const MAX_STEP = 0.35;

const finite = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

/** Whether a point is inside stone. A bolt is stopped by the same walls a body is. */
export const blocked = (cells: Set<string>, x: number, z: number) =>
  !cells.has(cellKey(Math.round(x / TILE), Math.round(z / TILE)));

/** Distance from a point to the segment it was swept along, which is what a thin bolt needs. */
const nearSegment = (fromX: number, fromZ: number, toX: number, toZ: number, at: Mark) => {
  const travelX = toX - fromX, travelZ = toZ - fromZ;
  const towardX = at.x - fromX, towardZ = at.z - fromZ;
  const along = Math.min(1, Math.max(0, (towardX * travelX + towardZ * travelZ) / Math.max(1e-4, travelX * travelX + travelZ * travelZ)));
  return { distance: Math.hypot(fromX + travelX * along - at.x, fromZ + travelZ * along - at.z), along };
};

/**
 * Advance one bolt by one frame. The caller applies the result: it owns the mesh, the sound and the
 * damage call, and decides what the knight's own rules make of a hit.
 */
export function flyShot(shot: Shot, cells: Set<string>, marks: readonly Mark[], frameDt: number): Flight {
  const dt = finite(frameDt);
  const life = Math.max(0, shot.life - dt);
  let x = shot.x, z = shot.z, pierce = shot.pierce, struck = false;
  const hits: number[] = [];
  if (!dt) return { x, z, life, pierce, hits, done: life <= 0, struck };

  // Walked rather than jumped, so nothing is passed through between one frame and the next.
  const travel = shot.speed * dt;
  const steps = Math.max(1, Math.ceil(travel / MAX_STEP));
  const stride = travel / steps;
  for (let i = 0; i < steps && !struck && pierce >= 0; i++) {
    const nextX = x + shot.dx * stride, nextZ = z + shot.dz * stride;
    if (blocked(cells, nextX, nextZ)) { struck = true; break; }
    // Everything the segment brushed this step, nearest first, so a bolt that pierces spends itself on
    // the closest body rather than on whichever happened to be first in the caller's array.
    const brushed = marks
      .filter(mark => !shot.spent.has(mark.index))
      .map(mark => ({ mark, ...nearSegment(x, z, nextX, nextZ, mark) }))
      .filter(entry => entry.distance < BOLT_RADIUS)
      .sort((a, b) => a.along - b.along);
    x = nextX; z = nextZ;
    for (const entry of brushed) {
      if (pierce < 0) break;
      shot.spent.add(entry.mark.index);
      hits.push(entry.mark.index);
      pierce -= 1;
    }
  }
  return { x, z, life, pierce, hits, done: struck || pierce < 0 || life <= 0, struck };
}

/**
 * A bolt an archer looses at the knight: from where it stands, along the heading its lane locked on, at
 * its own speed and range. It pierces nothing - it is stopped by the knight or by stone, and it flies
 * through the archer's own side, because friendly fire would make a pack thin itself for the player.
 */
export const hostileBolt = (from: { x: number; z: number }, heading: { x: number; z: number }, bolt: { speed: number; flight: number }, damage: number): Shot =>
  ({ x: from.x, z: from.z, dx: heading.x, dz: heading.z, speed: bolt.speed, life: bolt.flight, pierce: 0, damage, spent: new Set<number>() });

/**
 * One frame of a hostile bolt against the knight. While he is immune (a dash's opening frames) he is not
 * a mark at all, so the bolt flies on through him rather than being spent on a blow that cannot land:
 * that is what makes dashing through a volley the answer rather than a way to waste it. `hit` says it
 * reached him this frame; what that costs is the caller's (`hurt` in dungeon-sim.ts).
 */
export function flyHostile(shot: Shot, cells: Set<string>, knight: { x: number; z: number }, immune: boolean, frameDt: number) {
  const flight = flyShot(shot, cells, immune ? [] : [{ x: knight.x, z: knight.z, index: 0 }], frameDt);
  return { ...flight, hit: flight.hits.length > 0 };
}

/**
 * Bolts come back on their own clock rather than on a cooldown. A cooldown still lets the knight back
 * away and fire forever — he outruns every body in the keep, a guard by more than two to one — so what
 * limits a ranged arm has to be a quiver that runs dry, not a wait between shots.
 */
export const reloadStep = (spare: number, capacity: number, timer: number, refill: number, dt: number) => {
  const step = finite(dt);
  if (spare >= capacity) return { spare, timer: 0 };
  const next = timer + step;
  if (next < refill) return { spare, timer: next };
  // A long hidden tab must not hand back a full quiver in one frame, so whole refills are counted out.
  const gained = Math.floor(next / refill);
  return { spare: Math.min(capacity, spare + gained), timer: next % refill };
};

/**
 * What a thrown flask leaves behind. A bolt resolves against a body; a flask resolves against ground,
 * and then keeps resolving for a while — which is the only way the keep has of denying a doorway rather
 * than killing what is already through it.
 */
export type Pool = {
  x: number; z: number;
  radius: number;
  /** Seconds of burning left. */
  life: number;
  damage: number;
  /** Seconds between bites. Counted down rather than accumulated, so a long frame cannot bill twice. */
  interval: number;
  timer: number;
};

/** How many hostile fires the game can draw at once: a pyre falling with every ring lit leaves no fire, and no bite. */
export const HOSTILE_POOL_RINGS = 6;

/**
 * The fire a kind leaves where it falls (`deathPool` in the bestiary, or a volatile elite's, plan 022 D7), burning from its first bite; null for
 * every body that leaves none. What it bites is the caller's choice - the game turns these on the knight.
 */
export const deathPool = (kind: EnemyKind, at: { x: number; z: number }, elite?: EliteModifier): Pool | null => {
  const fire = deathPoolOf(kind, elite);
  return fire ? { x: at.x, z: at.z, radius: fire.radius, life: fire.life, damage: fire.damage, interval: fire.interval, timer: 0 } : null;
};

/** Ring centres a `scatter` lays are at least this far apart, so three marks are three places and not one. */
export const SCATTER_SPACING = 2;
/** Where the knight has been, oldest first: one sample every `TRAIL_STEP` seconds, the last `TRAIL_LENGTH` of them. */
export const TRAIL_STEP = 0.25, TRAIL_LENGTH = 8;

/**
 * The rings a boss's `scatter` may mark (plan 021 D6): at most `count`, at the knight's last positions, newest first, each at
 * least SCATTER_SPACING from the ones already chosen, and never more than the rings the game can still draw. There are
 * `HOSTILE_POOL_RINGS` of them and a seventh pool is silently never created, so what is already burning is subtracted first:
 * `live.hostile` the fire boss and pyre bodies have laid, `live.own` the knight's own flask pools, which share the cap. Every
 * spot comes off `trail`; a trail shorter than the wish yields fewer.
 */
export const scatterRings = (trail: readonly { x: number; z: number }[], count: number, live: { hostile: number; own: number }) => {
  const free = Math.max(0, HOSTILE_POOL_RINGS - finite(live.hostile) - finite(live.own)), wanted = Math.min(Math.floor(finite(count)), free);
  const spots: { x: number; z: number }[] = [];
  for (let i = trail.length - 1; i >= 0 && spots.length < wanted; i--) {
    if (spots.every(spot => Math.hypot(spot.x - trail[i].x, spot.z - trail[i].z) >= SCATTER_SPACING)) spots.push({ x: trail[i].x, z: trail[i].z });
  }
  return spots;
};

/**
 * One frame of the knight's trail, the record `scatterRings` marks from: a sample of where he stands every `TRAIL_STEP` seconds, the last `TRAIL_LENGTH` of them. `timer` is the clock to feed back
 * and `trail` is changed in place. A junk frame delta adds nothing.
 */
export const sampleTrail = (trail: { x: number; z: number }[], timer: number, at: { x: number; z: number }, frameDt: number) => {
  const next = timer + finite(frameDt);
  if (next < TRAIL_STEP) return next;
  trail.push({ x: at.x, z: at.z });
  if (trail.length > TRAIL_LENGTH) trail.shift();
  return next - TRAIL_STEP;
};

/** The fire a lit `scatter` ring becomes: a pool of the move's own fire at the marked spot, burning from its first bite. `damage` is what a bite costs on this floor (`scaledDamage`, dungeon-enemy.ts). */
export const scatterPool = (at: { x: number; z: number }, fire: { radius: number; life: number; interval: number }, damage: number): Pool =>
  ({ x: at.x, z: at.z, radius: fire.radius, life: fire.life, damage, interval: fire.interval, timer: 0 });

/** Whether a point is standing in the fire. */
export const poolCatches = (pool: Pool, x: number, z: number) => Math.hypot(pool.x - x, pool.z - z) < pool.radius;

/**
 * Burn for one frame. `bites` is how many times it billed this frame — at most one, whatever the frame
 * delta, because a tab hidden for a minute must not cash in two minutes of fire on the frame it returns.
 */
export const poolStep = (pool: Pool, frameDt: number) => {
  const dt = finite(frameDt);
  const life = Math.max(0, pool.life - dt);
  if (!dt) return { life: pool.life, timer: pool.timer, bites: 0 };
  const timer = pool.timer - dt;
  if (timer > 0) return { life, timer, bites: 0 };
  return { life, timer: pool.interval, bites: 1 };
};

/**
 * The Flashpoint (plan 016 Stage C): every live pool goes up at once. Returns each mark standing in any of
 * them exactly once, however many pools overlap it, because it is one blow; the caller ends the pools.
 */
export const flashpointHits = (pools: readonly Pool[], marks: readonly Mark[]) =>
  marks.filter(mark => pools.some(pool => pool.life > 0 && poolCatches(pool, mark.x, mark.z))).map(mark => mark.index);

/**
 * How far a shot fired from `from` along the normalised `dx, dz` can travel before stone stops it, up to
 * `range`: the same `blocked` test `flyShot` stops on, walked at its own step. The Heavy Bolt draws its line
 * on the floor this long, so the line shows where the bolt will actually go.
 */
export const laneLength = (cells: Set<string>, from: { x: number; z: number }, dx: number, dz: number, range: number) => {
  const steps = Math.max(1, Math.ceil(finite(range) / MAX_STEP));
  for (let i = 1; i <= steps; i++) {
    const along = Math.min(range, i * MAX_STEP);
    if (blocked(cells, from.x + dx * along, from.z + dz * along)) return (i - 1) * MAX_STEP;
  }
  return finite(range);
};

/**
 * A thrown arm coming back to the hand that threw it (plan 016's Harpoon): straight at wherever the knight
 * is now, at `speed`, and home the step it would reach or pass him. It does not hit anything on the way
 * back - the throw was the blow.
 */
export const homeStep = (from: { x: number; z: number }, to: { x: number; z: number }, speed: number, frameDt: number) => {
  const step = speed * finite(frameDt), dx = to.x - from.x, dz = to.z - from.z, distance = Math.hypot(dx, dz);
  if (distance <= step || distance < 1e-6) return { x: to.x, z: to.z, home: true };
  return { x: from.x + dx / distance * step, z: from.z + dz / distance * step, home: false };
};
