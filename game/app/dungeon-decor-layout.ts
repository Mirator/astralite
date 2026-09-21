import { type Room, TILE, type generateFloor } from './dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

/** A conservative world-space footprint another system (later macro paving) must not colour over. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Where a room's floor motif sits, and which of the three theme constructions it realizes. */
export type MotifLayout = {
  room: number;
  theme: Room['theme'];
  x: number;
  z: number;
  radius: number;
  turn: 0 | 1 | 2 | 3;
  variant: 0 | 1;
  /**
   * Sanctuary rooms keep this radius clear at the centre (the shrine reservation). Only `ruins`
   * and `flooded` ever carry it — the `keep` bed is one continuous shield with no room to hollow.
   */
  clearRadius?: number;
};

const rectAt = (cx: number, cz: number, halfX: number, halfZ = halfX): Rect => ({
  minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ,
});

/** The bed radius a theme's motif starts from, before it is shrunk to fit or rejected. */
const baseRadius = (room: Room) => (room.shape === 'round' ? 3.15 : 2.35);

/**
 * Conservative world-space rectangles every later system must leave alone: the space a motif is
 * planned into (even one `planRoomMotif` goes on to skip), the goal room, every sanctuary's clear
 * centre, the weapon drop, and a gauntlet's whole floor. This is the shared placement contract —
 * plan 006's macro paving reads it — so it is exported even for a room that ends up with no motif.
 *
 * This reserves space FOR a motif against later paving; it is not an exclusion `planRoomMotif`
 * applies to that same motif; the two are read against different reasons (see below) so a motif
 * never rejects itself against its own reservation here.
 */
export function decorReservations(floor: Floor): Rect[] {
  const rects: Rect[] = [];
  for (const room of floor.rooms) {
    const cx = room.x * TILE, cz = room.z * TILE;
    if (room.encounter === 'gauntlet') {
      rects.push(rectAt(cx, cz, room.halfX * TILE, room.halfZ * TILE));
      continue;
    }
    if (room.role === 'goal') { rects.push(rectAt(cx, cz, 2.2)); continue; }
    if (room.encounter === 'sanctuary') rects.push(rectAt(cx, cz, 1.6));
    rects.push(rectAt(cx, cz, baseRadius(room) + .2));
  }
  const drop = floor.weaponDrop;
  rects.push(rectAt(drop.x * TILE, drop.z * TILE, 1.5));
  return rects;
}

/** A stable, non-negative integer for a floor seed and room id. Never touches `Math.random`. */
const roomHash = (seed: number, room: number) => {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(room + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * Whether every cell the motif's inscribed footprint touches belongs to this room's own floor,
 * unowned by a corridor, and not a wood plank or a prop hole — both of which are already absent
 * from `floor.tiles` (a prop takes its cell out of `cells`/`ownership` at generation, and a wood
 * tile is filtered here the same way `addCarvedArchitecture` filters it for the disk it replaces).
 * The 0.72 factor is conservative: the widest shape at this radius is a flooded strip tip, and nothing
 * built here reaches farther than that fraction of the nominal radius from room centre.
 */
const fits = (owner: Set<string>, room: Room, radius: number) => {
  const reach = Math.ceil(radius / TILE), threshold = radius * .72;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      if (Math.hypot(dx * TILE, dz * TILE) > threshold) continue;
      if (!owner.has(`${room.x + dx},${room.z + dz}`)) return false;
    }
  }
  return true;
};

/** Below this, a shrunk bed reads as a stain rather than a motif; skip instead. */
const MIN_RADIUS = 1.5;
/** A sanctuary's clear centre eats into the bed a plain room does not lose; skip below this. */
const MIN_SANCTUARY_RADIUS = 1.9;
const SANCTUARY_CLEAR = 1.6;
/** Half-size of the weapon drop's own reservation (matches `decorReservations`). */
const DROP_HALF = 1.5;

/**
 * The one motif a room gets, or none. Only two rejections are "this room may not have one at all":
 * a gauntlet (which reserves its whole floor for the fight) and the goal room (its own stair seal
 * owns the centre). Everything else is either a genuine clearance — the drop's own reservation, a
 * sanctuary's shrine centre — or a fit failure, shrunk for conservatively before it is given up on.
 * These are explicit rather than a lookup into `decorReservations`, so a room's own motif rectangle
 * never rejects itself.
 */
export function planRoomMotif(floor: Floor, room: Room): MotifLayout | null {
  if (room.encounter === 'gauntlet' || room.role === 'goal') return null;
  const theme = room.theme;
  const sanctuary = room.encounter === 'sanctuary';
  // The keep bed is one continuous shield with no fragments to hold a clear centre with.
  if (sanctuary && theme === 'keep') return null;
  const drop = floor.weaponDrop;
  const dropHere = drop.room === room.id;
  // Chebyshev distance, to match the axis-aligned square `decorReservations` gives the drop: a
  // circular distance would let a diagonal motif creep closer than the reservation actually allows.
  const dropDistance = dropHere
    ? Math.max(Math.abs(drop.x - room.x), Math.abs(drop.z - room.z)) * TILE
    : Infinity;
  const owner = new Set(
    floor.tiles.filter((t) => t.room === room.id && !t.wood).map((t) => `${t.x},${t.z}`),
  );
  let radius = baseRadius(room);
  const floorLimit = sanctuary ? MIN_SANCTUARY_RADIUS : MIN_RADIUS;
  while (radius >= floorLimit && !fits(owner, room, radius)) radius -= .25;
  if (radius < floorLimit) return null;
  if (dropHere && dropDistance < radius + DROP_HALF) {
    // Try once to fit under the drop's own clearance before giving the room up entirely; a small
    // room with the drop right at its heart still gets nothing, which is the intended fallback.
    radius = Math.min(radius, dropDistance - DROP_HALF);
    if (radius < floorLimit) return null;
  }
  const hash = roomHash(floor.seed, room.id);
  const turn = (hash & 3) as 0 | 1 | 2 | 3;
  const variant = ((hash >>> 2) & 1) as 0 | 1;
  const layout: MotifLayout = { room: room.id, theme, x: room.x * TILE, z: room.z * TILE, radius, turn, variant };
  if (sanctuary) layout.clearRadius = SANCTUARY_CLEAR;
  return layout;
}

/** Every room's motif, skipping the ones `planRoomMotif` rejects. */
export function planFloorMotifs(floor: Floor): MotifLayout[] {
  const layouts: MotifLayout[] = [];
  for (const room of floor.rooms) {
    const layout = planRoomMotif(floor, room);
    if (layout) layouts.push(layout);
  }
  return layouts;
}
