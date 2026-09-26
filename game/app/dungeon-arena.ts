// The development arena: a real floor with every spawn cleared and a chosen roster standing in the gate, so a
// kind - a new one especially - can be met on demand instead of hunted for across seeds. It is a floor like
// any other everywhere else (paving, props, the rack on floor one, an open stair since no warden bars it), so
// the fight happens under the game's own lighting, camera and rules rather than on a test stage.
//
// Pure, like the floor generator it wraps: no React, no DOM, no three.js. Development only - dungeon-game.tsx
// reaches this solely from inside its `NODE_ENV !== 'production'` branches, so a production build drops it.
import { ENEMY_KINDS, type EnemyKind } from './dungeon-bestiary.ts';
import { cellKey, generateFloor, TILE, type Spawn } from './dungeon-floor.ts';

export type Floor = ReturnType<typeof generateFloor>;
export type Arena = { roster: EnemyKind[]; level: number };

/** More than this and a gate-sized room is a crowd rather than a fight. */
export const ARENA_MAX = 12;
/**
 * Tiles kept clear around the gate's heart, where the knight arrives, so nothing opens the fight inside his reach.
 * At today's sizes the ring alone keeps it (a full roster stands 3.6 out at the closest); this holds when a
 * smaller gate or a larger roster would push a body inward.
 */
export const ARENA_CLEAR = 2.5;
/** How far bodies stand from the heart: far enough to see coming, close enough to engage at once. */
export const ARENA_RING = 4;
/** Tiles between two bodies, relaxed once if the room is too small to honour it. */
const SPACING = 1.5;

/** Counts per kind, in bestiary order - what the arena picker edits and what a roster is built from. */
export type ArenaPick = Partial<Record<EnemyKind, number>>;

/** The roster a pick asks for, kinds in bestiary order and the total capped at ARENA_MAX. */
export const rosterOf = (pick: ArenaPick): EnemyKind[] =>
  ENEMY_KINDS.flatMap(kind => Array.from({ length: Math.max(0, Math.floor(pick[kind] ?? 0)) }, () => kind)).slice(0, ARENA_MAX);

/**
 * `?arena=guard:2,archer:1&level=2`. Strict: an unknown kind, a count that is not a whole number, or a
 * level outside 1..floors rejects the whole thing rather than quietly fighting something else - a dev link
 * that silently drops half its roster is worse than one that does nothing. An empty roster is no arena.
 */
export function parseArena(spec: string | null, levelText: string | null, floors: number): Arena | null {
  if (!spec) return null;
  const pick: ArenaPick = {};
  for (const entry of spec.split(',')) {
    const match = /^([a-z]+)(?::(\d+))?$/.exec(entry.trim());
    if (!match || !(ENEMY_KINDS as readonly string[]).includes(match[1])) return null;
    const kind = match[1] as EnemyKind;
    pick[kind] = (pick[kind] ?? 0) + Number(match[2] ?? 1);
  }
  const level = levelText === null ? 1 : Number(levelText);
  if (!Number.isInteger(level) || level < 1 || level > floors) return null;
  const roster = rosterOf(pick);
  return roster.length ? { roster, level } : null;
}

/**
 * The floor `generateFloor(seed, level)` lays, with every spawn replaced by `roster`, awake and standing on a
 * ring around the gate's heart. Only `spawns` and `guardCount` differ from the generated floor: the rooms,
 * corridors, props and the weapon drop are its own, so a seed replays the same arena. Bodies are dealt round
 * the ring in roster order, each on the free tile nearest its slot, clear of the knight's arrival, the rack
 * and each other; a roster the room cannot fit is placed as far as it goes, never stacked.
 */
export function arenaFloor(seed: number, level: number, roster: readonly EnemyKind[]): Floor {
  const floor = generateFloor(seed, level);
  const gate = floor.rooms[floor.start];
  const drop = { x: floor.weaponDrop.x / TILE, z: floor.weaponDrop.z / TILE };
  const open = floor.tiles.filter(t => t.room === gate.id && floor.cells.has(cellKey(t.x, t.z)));
  const spawns: Spawn[] = [];
  const count = Math.min(roster.length, ARENA_MAX);
  const free = (x: number, z: number, spacing: number) =>
    Math.hypot(x - gate.x, z - gate.z) >= ARENA_CLEAR
    && Math.hypot(x - drop.x, z - drop.z) >= SPACING
    && spawns.every(other => Math.hypot(other.x - x, other.z - z) >= spacing);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const slot = { x: gate.x + Math.cos(angle) * ARENA_RING, z: gate.z + Math.sin(angle) * ARENA_RING };
    const nearest = (spacing: number) => open
      .filter(t => free(t.x, t.z, spacing))
      .sort((a, b) => Math.hypot(a.x - slot.x, a.z - slot.z) - Math.hypot(b.x - slot.x, b.z - slot.z))[0];
    const tile = nearest(SPACING) ?? nearest(1);
    if (!tile) break;
    spawns.push({ x: tile.x, z: tile.z, kind: roster[i], room: gate.id, ambush: false });
  }
  return { ...floor, spawns, guardCount: spawns.length };
}
