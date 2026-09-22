import { decorReservations, type Rect } from './dungeon-decor-layout.ts';
import { cellKey, type Room, TILE, type generateFloor } from './dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

/**
 * A rectangular paving patch spanning two adjacent stone cells of the same room, replacing their
 * two ordinary tops with one continuous top. `a`/`b` are the two cell coordinates (tile units);
 * `x`/`z` is the world-space midpoint the merged slab is centred on; `orientation` says which axis
 * the pair's long side runs along, so `dungeon-game.tsx` knows whether to rotate the shared
 * geometry a quarter turn.
 */
export type PairPatch = {
  room: number;
  theme: Room['theme'];
  ax: number; az: number;
  bx: number; bz: number;
  x: number; z: number;
  orientation: 'x' | 'z';
  /** The 12-tile spatial batch both cells share (matches `dungeon-game.tsx`'s paving batches). */
  batch: string;
};

/** One ordinary-footprint slab, sunk and tilted a little further than the existing damage variant. */
export type SettledSingle = {
  room: number;
  x: number; z: number;
  batch: string;
};

export type PavingPlan = {
  pairs: PairPatch[];
  settled: SettledSingle[];
  /** Every cell key (`"x,z"`) consumed by a pair, on either end. */
  pairedCells: Set<string>;
  /** Every cell key consumed by a settled single. Disjoint from `pairedCells`. */
  settledCells: Set<string>;
};

/** A stable, non-negative integer from a floor seed, a room id and up to three more coordinates. */
const hash32 = (seed: number, room: number, a = 0, b = 0, c = 0) => {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(room + 1, 0x9e3779b1) ^
    Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  return (h ^ (h >>> 16)) >>> 0;
};
const hashFrac = (seed: number, room: number, a = 0, b = 0, c = 0) => hash32(seed, room, a, b, c) / 4294967296;

/** Every room's own stone cells (not wood, not a corridor), keyed by room id. */
const stoneFootprints = (floor: Floor) => {
  const byRoom = new Map<number, Set<string>>();
  for (const t of floor.tiles) {
    if (t.wood || t.room < 0) continue;
    let set = byRoom.get(t.room);
    if (!set) { set = new Set(); byRoom.set(t.room, set); }
    set.add(cellKey(t.x, t.z));
  }
  return byRoom;
};

/** decorReservations expanded by a conservative world-space margin, as the plan requires. */
const RESERVATION_MARGIN = 0.3;
const insideReservation = (rects: Rect[], wx: number, wz: number) => rects.some((r) =>
  wx >= r.minX - RESERVATION_MARGIN && wx <= r.maxX + RESERVATION_MARGIN &&
  wz >= r.minZ - RESERVATION_MARGIN && wz <= r.maxZ + RESERVATION_MARGIN);

/**
 * A cell may host a pair or a settled single only if every cell within two cardinal steps belongs
 * to the same room's own stone footprint (so it is at least two steps clear of any hole, wood tile,
 * corridor or a neighbouring room's ownership - the doorway-approach margin the plan asks for, on
 * top of the plain "four cardinal neighbours" rule, since a cell that only just clears its own
 * immediate neighbours can still sit one step from a mouth) and outside every reserved rectangle,
 * with margin.
 */
const isEligible = (footprint: Set<string>, rects: Rect[], x: number, z: number) => {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (!footprint.has(cellKey(x + dx, z + dz))) return false;
    }
  }
  return !insideReservation(rects, x * TILE, z * TILE);
};

/** How many of the footprint's own cells surround `(x,z)` cleanly, capped at `max` - larger is deeper interior. */
const clearance = (footprint: Set<string>, x: number, z: number, max = 5) => {
  for (let r = 1; r <= max; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!footprint.has(cellKey(x + dx, z + dz))) return r - 1;
      }
    }
  }
  return max;
};

const batchOf = (x: number, z: number) => `${Math.floor(x / 12)},${Math.floor(z / 12)}`;

type Candidate = { ax: number; az: number; bx: number; bz: number; midX: number; midZ: number; orientation: 'x' | 'z'; batch: string };

/**
 * Lower is preferred. Each theme reads the same candidate pool differently: `keep` favours short
 * courses that follow the room's own long axis and stay close to its centreline; `ruins` scatters
 * two or three offset clusters and prefers alternating orientation between them; `flooded` favours
 * the long axis again but pulls candidates toward the room's edges rather than its heart, so the
 * pairs read as broken channels rather than a stripe down the middle.
 */
const scorePair = (candidate: Candidate, room: Room, seed: number) => {
  const long: 'x' | 'z' = room.halfX >= room.halfZ ? 'x' : 'z';
  const relX = candidate.midX - room.x, relZ = candidate.midZ - room.z;
  if (room.theme === 'keep') {
    const misaligned = candidate.orientation === long ? 0 : 3;
    const cross = long === 'x' ? Math.abs(relZ) : Math.abs(relX);
    return misaligned + cross;
  }
  if (room.theme === 'ruins') {
    const clusters = 3;
    let best = Infinity;
    for (let i = 0; i < clusters; i++) {
      const angle = hashFrac(seed, room.id, i, 21) * Math.PI * 2;
      const radius = (0.25 + hashFrac(seed, room.id, i, 22) * 0.35) * Math.max(room.halfX, room.halfZ);
      const cx = Math.cos(angle) * radius, cz = Math.sin(angle) * radius;
      const preferX = i % 2 === 0;
      const orientPenalty = (candidate.orientation === 'x') === preferX ? 0 : 1.5;
      best = Math.min(best, Math.hypot(relX - cx, relZ - cz) + orientPenalty);
    }
    return best;
  }
  // flooded: prefer the long axis, and prefer far from the centre (toward the room's edges) over near it.
  const misaligned = candidate.orientation === long ? 0 : 2;
  const half = long === 'x' ? room.halfX : room.halfZ;
  const along = long === 'x' ? Math.abs(relX) : Math.abs(relZ);
  const edge = half > 0 ? Math.min(1, along / half) : 0;
  return misaligned + (1 - edge) * 2;
};

/** Coverage fraction of the room's remaining eligible singles a settled strip claims, per theme. */
const SETTLED_FRACTION: Record<Room['theme'], number> = { keep: 0.05, ruins: 0.12, flooded: 0.08 };

/**
 * Plans every macro paving patch for a floor: pairs of merged two-cell slabs and settled,
 * staggered strips, both placed only on cells that clear every reservation from
 * `decorReservations` and stay inside a single 12-tile spatial batch. Pure and deterministic - the
 * same floor always plans the same patches, and nothing here mutates the floor it reads.
 */
export function planPavingPatches(floor: Floor): PavingPlan {
  const rects = decorReservations(floor);
  const footprints = stoneFootprints(floor);
  const pairs: PairPatch[] = [];
  const pairedCells = new Set<string>();
  const settled: SettledSingle[] = [];
  const settledCells = new Set<string>();

  const rooms = [...floor.rooms].sort((a, b) => a.id - b.id);
  for (const room of rooms) {
    const footprint = footprints.get(room.id);
    if (!footprint || footprint.size < 2) continue;
    const roomStoneCells = footprint.size;
    const cells = [...footprint]
      .map((key) => { const [x, z] = key.split(',').map(Number); return { x, z }; })
      .sort((a, b) => a.x - b.x || a.z - b.z);
    const eligible = cells.filter((c) => isEligible(footprint, rects, c.x, c.z));
    if (!eligible.length) continue;
    const eligibleSet = new Set(eligible.map((c) => cellKey(c.x, c.z)));

    // --- Pairs: build every adjacent eligible candidate, score it for this room's theme, and take
    // the best-scoring ones that do not reuse a cell, up to a seeded 20-30% coverage target. ---
    let pairsTarget = 0;
    if (eligible.length >= 24) {
      const fraction = 0.2 + hashFrac(floor.seed, room.id, 1) * 0.1;
      const targetCells = Math.round(eligible.length * fraction);
      pairsTarget = Math.min(Math.floor(targetCells / 2), Math.floor((0.35 * roomStoneCells) / 2));
    }
    const roomUsed = new Set<string>();
    if (pairsTarget > 0) {
      const candidates: Candidate[] = [];
      for (const c of eligible) {
        for (const [dx, dz, orientation] of [[1, 0, 'x'], [0, 1, 'z']] as const) {
          const bx = c.x + dx, bz = c.z + dz;
          if (!eligibleSet.has(cellKey(bx, bz))) continue;
          const batchA = batchOf(c.x, c.z), batchB = batchOf(bx, bz);
          if (batchA !== batchB) continue; // never cross a spatial batch boundary
          candidates.push({ ax: c.x, az: c.z, bx, bz, midX: (c.x + bx) / 2, midZ: (c.z + bz) / 2, orientation, batch: batchA });
        }
      }
      candidates.sort((p, q) =>
        scorePair(p, room, floor.seed) - scorePair(q, room, floor.seed) ||
        p.midX - q.midX || p.midZ - q.midZ || p.orientation.localeCompare(q.orientation));
      let placed = 0;
      for (const cand of candidates) {
        if (placed >= pairsTarget) break;
        const ka = cellKey(cand.ax, cand.az), kb = cellKey(cand.bx, cand.bz);
        if (roomUsed.has(ka) || roomUsed.has(kb)) continue;
        roomUsed.add(ka); roomUsed.add(kb);
        pairedCells.add(ka); pairedCells.add(kb);
        pairs.push({
          room: room.id, theme: room.theme,
          ax: cand.ax, az: cand.az, bx: cand.bx, bz: cand.bz,
          x: cand.midX * TILE, z: cand.midZ * TILE,
          orientation: cand.orientation, batch: cand.batch,
        });
        placed++;
      }
    }

    // --- Settled strips: three or four ordinary-footprint singles, staggered, biased toward the
    // room's edges rather than its deep interior, out of whatever eligible cells the pairs left. ---
    const remaining = eligible.filter((c) => !pairedCells.has(cellKey(c.x, c.z)));
    const settledTarget = Math.round(remaining.length * SETTLED_FRACTION[room.theme]);
    if (settledTarget > 0) {
      const ranked = remaining
        .map((c) => ({ ...c, clear: clearance(footprint, c.x, c.z) }))
        .sort((a, b) =>
          a.clear - b.clear ||
          hashFrac(floor.seed, room.id, a.x, a.z, 9) - hashFrac(floor.seed, room.id, b.x, b.z, 9) ||
          a.x - b.x || a.z - b.z);
      const localUsed = new Set<string>();
      let placed = 0;
      for (const seedCell of ranked) {
        if (placed >= settledTarget) break;
        const startKey = cellKey(seedCell.x, seedCell.z);
        if (localUsed.has(startKey) || pairedCells.has(startKey)) continue;
        const stripLen = 3 + (hash32(floor.seed, room.id, seedCell.x, seedCell.z, 7) & 1);
        const axis: 'x' | 'z' = hash32(floor.seed, room.id, seedCell.x, seedCell.z, 8) & 1 ? 'x' : 'z';
        const dir = hash32(floor.seed, room.id, seedCell.x, seedCell.z, 9) & 1 ? 1 : -1;
        let cx = seedCell.x, cz = seedCell.z;
        for (let i = 0; i < stripLen && placed < settledTarget; i++) {
          const key = cellKey(cx, cz);
          if (!eligibleSet.has(key) || localUsed.has(key) || pairedCells.has(key)) break;
          localUsed.add(key); settledCells.add(key);
          settled.push({ room: room.id, x: cx, z: cz, batch: batchOf(cx, cz) });
          placed++;
          if (axis === 'x') cx += dir; else cz += dir;
        }
      }
    }
  }

  return { pairs, settled, pairedCells, settledCells };
}
