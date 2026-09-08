export const TILE = 1.48;
export const ROOM_COUNT = 12;
export const GUARD_COUNT = (ROOM_COUNT - 1) * 2;
export type Room = { id: number; x: number; z: number; halfX: number; halfZ: number };
export const cellKey = (x: number, z: number) => `${x},${z}`;

export function generateFloor(seed: number) {
  let state = seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rooms: Room[] = Array.from({ length: ROOM_COUNT }, (_, id) => ({ id, x: id % 4 * 23 + Math.floor(random() * 3), z: Math.floor(id / 4) * 23 + Math.floor(random() * 3), halfX: 6 + Math.floor(random() * 3), halfZ: 6 + Math.floor(random() * 3) }));
  const cells = new Set<string>();
  const carve = (x: number, z: number) => cells.add(cellKey(x, z));
  rooms.forEach(r => { for (let x = r.x - r.halfX; x <= r.x + r.halfX; x++) for (let z = r.z - r.halfZ; z <= r.z + r.halfZ; z++) carve(x, z); });
  const edges: [number, number][] = [];
  const connected = new Set([0]);
  // Randomized spanning tree guarantees every chamber can be reached.
  while (connected.size < rooms.length) {
    const frontier: [number, number][] = [];
    connected.forEach(id => { for (const next of [id - 4, id + 4, ...(id % 4 ? [id - 1] : []), ...(id % 4 < 3 ? [id + 1] : [])]) if (next >= 0 && next < ROOM_COUNT && !connected.has(next)) frontier.push([id, next]); });
    const edge = frontier[Math.floor(random() * frontier.length)]; edges.push(edge); connected.add(edge[1]);
  }
  for (let id = 0; id < ROOM_COUNT; id++) for (const next of [...(id % 4 < 3 ? [id + 1] : []), ...(id < 8 ? [id + 4] : [])]) if (random() < 0.35 && !edges.some(([a,b]) => a === id && b === next || a === next && b === id)) edges.push([id,next]);
  edges.forEach(([a, b]) => {
    let { x, z } = rooms[a]; const end = rooms[b];
    const wide = () => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) carve(x + dx, z + dz); };
    wide(); const horizontalFirst = random() < 0.5;
    for (const axis of horizontalFirst ? ['x', 'z'] : ['z', 'x']) {
      while (axis === 'x' ? x !== end.x : z !== end.z) { if (axis === 'x') x += Math.sign(end.x - x); else z += Math.sign(end.z - z); wide(); }
    }
  });
  // Solid brazier bases are part of navigation, so actors cannot walk through them.
  rooms.forEach(r => { for (const [dx,dz] of [[4,0],[-4,0],[0,4],[0,-4]]) cells.delete(cellKey(r.x+dx,r.z+dz)); });
  const tiles = [...cells].map(key => { const [x,z] = key.split(',').map(Number); return { x,z }; });
  const bounds = { minX: Math.min(...tiles.map(t => t.x)), maxX: Math.max(...tiles.map(t => t.x)), minZ: Math.min(...tiles.map(t => t.z)), maxZ: Math.max(...tiles.map(t => t.z)) };
  return { seed, rooms, edges, cells, tiles, bounds };
}

export function canStand(cells: Set<string>, x: number, z: number, radius = 0.32) {
  for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) if (!cells.has(cellKey(Math.round((x + dx) / TILE), Math.round((z + dz) / TILE)))) return false;
  return true;
}

export function moveOnFloor(cells: Set<string>, position: { x: number; z: number }, dx: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.15));
  for (let i = 0; i < steps; i++) {
    if (canStand(cells, position.x + dx / steps, position.z)) position.x += dx / steps;
    if (canStand(cells, position.x, position.z + dz / steps)) position.z += dz / steps;
  }
}
