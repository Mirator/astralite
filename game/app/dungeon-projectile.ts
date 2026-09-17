// Things that travel. Every melee rule in this keep resolves in the frame it is asked about — the arc
// is tested, the body is in it or not — and none of that helps a bolt, which exists across frames and
// has to be stopped by the first wall or body it meets rather than by wherever it happened to land.
//
// Pure, like the rest of the rules: no React, no DOM, no three.js. The renderer owns the mesh and the
// trail; this owns whether the shot connected and where it stopped.
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
