import { ARRIVAL_CLEAR, carves, cellKey, TILE, type Floor, type Room } from './dungeon-floor.ts';

// Plan 025 Stage F (D12 a): props that do something. A chamber is dealt its furniture here, by `furnishFloor`, after the generator and after the waves,
// from a hash stream of its own (`FURNISH_SALT`, one stream a chamber), so `generateFloor` is not asked at all and every seed's layout stays byte for
// byte what it was. What a prop does when it is struck, lit or stood on is dungeon-hits.ts; this file only says what stands where.
//
// HOW TO CHANGE THE FURNITURE. Every number of the layout is here.
//   - `PROP_BAG`: the kinds a chamber draws from, weighted by its theme. `PROPS_PER_ROOM` is how many it draws (inclusive); `CHEST_ODDS` the chance of a
//     chest on top. The generator's own braziers, pillars, rubble and barrels (3 to 7, solid stone) stand as they always did; these come on top.
//   - `DROP_ODDS`: what a breakable holds, decided when it is laid so the game and the balance sim always agree.
//   - What is kept clear (`furnishRoom`): the heart (`HEART_CLEAR_TILES`), the knight's arrival (`ARRIVAL_CLEAR`, the ring no body spawns in either), every
//     spawn tile of every wave (`SPAWN_CLEAR`), every doorway (`DOOR_CLEAR`), the reserved rack spot, and the lane: a walk from the arrival to every door,
//     every spawn and the heart on tiles with no prop on them or beside them (`laneOpen`). A cover block also may not cut a pocket of floor off.
// Only cover is solid: its tile leaves `cells` (so a step, a lane check and a bolt all stop at it, and the walls pass rings it with a low parapet) and stays
// in `tiles`, so the paving runs under it. Everything else stands on walkable floor.

export type PropKind = 'urn' | 'crate' | 'keg' | 'spikes' | 'cover' | 'chest';
/** What a breakable holds: a pearl for the run's purse, a sip of vitality, or nothing (most of them). */
export type PropDrop = 'pearl' | 'sip' | null;
/** One prop: its kind and tile, the chamber it stands in, what it holds, and (spike plates) where in its cycle it starts, in seconds. */
export type Furnishing = { id: number; kind: PropKind; x: number; z: number; room: number; drop: PropDrop; phase: number };

/** The kinds a chamber draws, weighted by theme: the keep is stores (urns, crates), the ruins are broken masonry and traps, the flooded halls powder and urns. */
export const PROP_BAG: Record<Room['theme'], Partial<Record<Exclude<PropKind, 'chest'>, number>>> = {
  keep: { urn: 3, crate: 3, keg: 1, spikes: 1, cover: 2 },
  ruins: { urn: 2, crate: 1, keg: 1, spikes: 2, cover: 3 },
  flooded: { urn: 3, crate: 1, keg: 2, spikes: 1, cover: 2 },
};
/** Props a chamber draws, inclusive, on top of the generator's 3 to 7. */
export const PROPS_PER_ROOM: readonly [number, number] = [4, 7];
/** The chance of a chest on top of them: an occasional bonus. */
export const CHEST_ODDS = 0.15;
/** What a breakable holds: the chance of a sip and of a pearl. Rare on purpose (D12: "rarely"); a chest always holds pearls (`CHEST_PEARLS`, dungeon-hits.ts). */
export const DROP_ODDS: Record<'urn' | 'crate', { sip: number; pearl: number }> = { urn: { sip: 0.1, pearl: 0.06 }, crate: { sip: 0.08, pearl: 0.08 } };
/** Tiles kept clear of the heart (a shrine, the gauntlet's grates, the stair). */
export const HEART_CLEAR_TILES = 2.5;
/** Tiles kept clear of every doorway: the door's tile and the mouth it was cut back from. */
export const DOOR_CLEAR = 2.5;
/** Tiles kept between a prop and any spawn tile: off it and off every tile beside it. */
export const SPAWN_CLEAR = 1.5;
/** Tiles between two props of this pass, and between one and the generator's stone. */
export const PROP_SPACING = 2;
export const STONE_SPACING = 1.5;
/** Placement attempts a prop gets before it is not laid. */
const TRIES = 60;
export const FURNISH_SALT = 0x66726e73;

/** A hash stream of a chamber's own (the waves' form, its own salt): adding a kind to one chamber's bag moves no other chamber's props. */
const stream = (seed: number, level: number, room: number, salt = FURNISH_SALT) => {
  let h = (Math.imul(seed >>> 0 ^ salt, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b) ^ Math.imul(room + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b) >>> 0; h = Math.imul(h ^ h >>> 13, 0xc2b2ae35) >>> 0; h = (h ^ h >>> 16) >>> 0;
  let state = h;
  return () => { state = state + 0x6d2b79f5 >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};

/** Which kind one roll draws from a bag: the share of each weight, in the bag's order. */
export const drawProp = (bag: Partial<Record<PropKind, number>>, roll: number): PropKind => {
  const entries = Object.entries(bag) as [PropKind, number][], total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let edge = 0;
  for (const [kind, weight] of entries) { edge += weight / total; if (roll < edge) return kind; }
  return entries[entries.length - 1][0];
};

/** A chamber's own floor (not a door's alcove, not another chamber's), as `roomTiles` reads it. */
const ownTile = (room: Room, x: number, z: number) => Math.abs(x - room.x) <= room.halfX && Math.abs(z - room.z) <= room.halfZ && carves(room, x - room.x, z - room.z);

/** The tile a door's alcove opens from: the first of the chamber's own floor going back from the door. */
export const doorMouth = (room: Room, door: Floor['doors'][number]) => {
  let at = { x: door.x, z: door.z };
  for (let back = 0; back < 4 && !ownTile(room, at.x, at.z); back++) at = { x: at.x - door.face.x, z: at.z - door.face.z };
  return at;
};

/**
 * Whether a chamber still has its lane: from the knight's arrival, over walkable tiles with no prop on them or on any of the eight beside them, every
 * target is reached. A prop of any kind closes the tiles round it, so the lane is a walk a body's width wide that touches nothing, and a door, a spawn or
 * the heart behind a row of urns and spike plates is cut off as surely as one behind cover. Floods only the chamber it starts in (chambers are islands).
 */
export const laneOpen = (cells: Set<string>, props: readonly { x: number; z: number }[], from: { x: number; z: number }, targets: readonly { x: number; z: number }[]) => {
  const near = new Set<string>();
  for (const p of props) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.add(cellKey(p.x + dx, p.z + dz));
  const free = (x: number, z: number) => cells.has(cellKey(x, z)) && !near.has(cellKey(x, z));
  if (!free(from.x, from.z)) return false;
  const seen = new Set([cellKey(from.x, from.z)]), queue = [from.x, from.z];
  for (let i = 0; i < queue.length; i += 2) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = queue[i] + dx, z = queue[i + 1] + dz, key = cellKey(x, z);
    if (!seen.has(key) && free(x, z)) { seen.add(key); queue.push(x, z); }
  }
  return targets.every(t => seen.has(cellKey(t.x, t.z)));
};

/** Whether every walkable tile of a chamber is still reached from `from` over `cells` (a cover block must not wall off a pocket a wave ring could land in). */
const allReached = (cells: Set<string>, tiles: readonly { x: number; z: number }[], from: { x: number; z: number }) => {
  const seen = new Set([cellKey(from.x, from.z)]), queue = [from.x, from.z];
  for (let i = 0; i < queue.length; i += 2) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = queue[i] + dx, z = queue[i + 1] + dz, key = cellKey(x, z);
    if (!seen.has(key) && cells.has(key)) { seen.add(key); queue.push(x, z); }
  }
  return tiles.every(t => !cells.has(cellKey(t.x, t.z)) || seen.has(cellKey(t.x, t.z)));
};

/**
 * One chamber's furniture. `cells` is the floor's walkable set and is written to: a cover block takes its tile out. `random` is the chamber's own stream.
 * Draws, in order: the count, the chest roll, then per prop its kind and, for the kinds that use them, its drop or its phase, then its tiles in a shuffled
 * order until one passes every rule (the lane last, since it is the expensive one). A prop no tile takes is not laid.
 */
export function furnishRoom(floor: Pick<Floor, 'rooms' | 'tiles' | 'doors' | 'spawns' | 'props' | 'weaponDrop'>, room: Room, cells: Set<string>, random: () => number, firstId = 0): Furnishing[] {
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const tiles = floor.tiles.filter(t => t.room === room.id && ownTile(room, t.x, t.z));
  const doors = floor.doors.filter(d => d.from === room.id), mouths = doors.map(d => doorMouth(room, d));
  const spawns = floor.spawns.filter(s => s.room === room.id);
  const stone = floor.props.filter(p => p.room === room.id);
  const rack = floor.weaponDrop.room === room.id ? { x: floor.weaponDrop.x / TILE, z: floor.weaponDrop.z / TILE } : null;
  const heart = { x: room.x, z: room.z };
  const targets = [...doors, ...spawns, ...(cells.has(cellKey(heart.x, heart.z)) ? [heart] : [])];
  const far = (a: { x: number; z: number }, b: { x: number; z: number }, gap: number) => Math.hypot(a.x - b.x, a.z - b.z) >= gap;
  const placed: Furnishing[] = [];
  const kinds: PropKind[] = [];
  const count = int(PROPS_PER_ROOM[0], PROPS_PER_ROOM[1]), chest = random() < CHEST_ODDS;
  for (let i = 0; i < count; i++) kinds.push(drawProp(PROP_BAG[room.theme], random()));
  if (chest) kinds.push('chest');
  for (const kind of kinds) {
    const drop: PropDrop = kind === 'chest' ? 'pearl' : kind === 'urn' || kind === 'crate' ? (() => { const roll = random(), odds = DROP_ODDS[kind]; return roll < odds.sip ? 'sip' : roll < odds.sip + odds.pearl ? 'pearl' : null; })() : null;
    const phase = kind === 'spikes' ? random() : 0;
    for (let tries = 0; tries < TRIES; tries++) {
      const t = tiles[int(0, tiles.length - 1)];
      if (!t || !cells.has(cellKey(t.x, t.z))) continue;
      if (!far(t, heart, HEART_CLEAR_TILES) || !far(t, room.entry, ARRIVAL_CLEAR)) continue;
      if (![...doors, ...mouths].every(d => far(t, d, DOOR_CLEAR))) continue;
      if (!spawns.every(s => far(t, s, SPAWN_CLEAR)) || !stone.every(p => far(t, p, STONE_SPACING)) || !placed.every(p => far(t, p, PROP_SPACING))) continue;
      if (rack && !far(t, rack, 2)) continue;
      const prop: Furnishing = { id: firstId + placed.length, kind, x: t.x, z: t.z, room: room.id, drop, phase };
      if (kind === 'cover') cells.delete(cellKey(t.x, t.z));
      const keeps = (laneOpen(cells, [...placed, prop], room.entry, targets)) && (kind !== 'cover' || allReached(cells, tiles, room.entry));
      if (!keeps) { if (kind === 'cover') cells.add(cellKey(t.x, t.z)); continue; }
      placed.push(prop);
      break;
    }
  }
  return placed;
}

/**
 * The floor with its furniture laid: every path chamber (not the Tide Gate, not the stair hall, whose fight is a boss's) furnished from its own stream.
 * Returns a copy: `cells` without the cover tiles and `furniture` beside it; the rooms, tiles, props and spawns are the input's. Called after the waves
 * (so every wave's spawn tile is kept clear) and after the rewards (which move nothing it reads).
 */
export function furnishFloor<F extends Pick<Floor, 'rooms' | 'tiles' | 'doors' | 'spawns' | 'props' | 'weaponDrop' | 'cells'>>(floor: F, seed: number, level: number): F & { furniture: Furnishing[] } {
  const cells = new Set(floor.cells), furniture: Furnishing[] = [];
  for (const room of floor.rooms) {
    if (room.role !== 'path') continue;
    furniture.push(...furnishRoom(floor, room, cells, stream(seed, level, room.id), furniture.length));
  }
  return { ...floor, cells, furniture };
}
