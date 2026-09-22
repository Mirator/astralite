import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey, generateFloor, TILE } from '../app/dungeon-floor.ts';
import { contactCount, footfalls, footSupport, landingLeg, MAX_FOOTFALLS_PER_UPDATE } from '../app/dungeon-footstep-rules.ts';
import { playerRunPose } from '../app/dungeon-run-pose.ts';
import { buildSurfaceIndex, type CellSurface, type SurfaceTriangle } from '../app/dungeon-surface.ts';

const walk = { dashing: false, dt: 1 / 60, travelled: 0.12 };
const HALF = Math.PI / 2;

/** An upward-wound flat square over one cell, as two triangles (winding per dungeon-surface's own convention). */
const slab = (cx: number, cz: number, y: number, half = 0.7): SurfaceTriangle[] => {
  const x = cx * TILE, z = cz * TILE;
  const up = (ax: number, az: number, bx: number, bz: number, qx: number, qz: number): SurfaceTriangle =>
    ({ ax, ay: y, az, bx: qx, by: y, bz: qz, cx: bx, cy: y, cz: bz });
  return [up(x - half, z - half, x + half, z - half, x + half, z + half), up(x - half, z - half, x + half, z + half, x - half, z + half)];
};

test('the contact count is exactly the step-audio threshold the game already uses', () => {
  for (const phase of [0, 0.3, HALF - 1e-9, HALF, HALF + 1e-9, Math.PI, 3 * HALF, 10.7]) {
    assert.equal(contactCount(phase), Math.floor((phase + Math.PI / 2) / Math.PI));
  }
});

test('a crossing yields one footfall; an equal or unchanged phase yields none', () => {
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, walk), [{ count: 1, side: 0 }]);
  assert.deepEqual(footfalls(3 * HALF - 0.1, 3 * HALF + 0.1, walk), [{ count: 2, side: 1 }]);
  assert.deepEqual(footfalls(1, 1, walk), []);
  assert.deepEqual(footfalls(0.2, 0.9, walk), [], 'moved but never crossed');
  // Landing exactly on the boundary counts once, and starting exactly on it does not count again.
  assert.equal(footfalls(HALF - 0.05, HALF, walk).length, 1);
  assert.equal(footfalls(HALF, HALF + 0.05, walk).length, 0);
});

test('an ordinary sub-stepped walk produces the same footfalls, in order, as the audio crossings', () => {
  let phase = 0, audio = 0;
  const seen: number[] = [];
  for (let i = 0; i < 600; i++) {
    const next = phase + 0.42 * (0.5 + 0.5 * Math.sin(i * 0.37));
    if (contactCount(phase) !== contactCount(next)) audio++;
    const falls = footfalls(phase, next, walk);
    assert.ok(falls.length <= 1, 'a sub-step under PI produced more than one footfall');
    seen.push(...falls.map(f => f.count));
    phase = next;
  }
  assert.equal(seen.length, audio);
  seen.forEach((count, i) => assert.equal(count, i + 1));
});

test('feet alternate, and the landing leg is the one the run pose has at full forward extension', () => {
  const sides = footfalls(0, 8 * Math.PI, walk, 100).map(f => f.side);
  sides.forEach((side, i) => { if (i) assert.notEqual(side, sides[i - 1]); });
  for (let count = 1; count <= 6; count++) {
    const pose = playerRunPose(count * Math.PI - HALF, 6);
    const leg = landingLeg(count), other = leg === 0 ? 1 : 0;
    // A positive hip angle swings the boot toward the rig's forward -Z: the landing leg leads.
    assert.ok(pose.legs[leg].hip > 0 && pose.legs[other].hip < 0, `count ${count}: leg ${leg} is not the leading one`);
    assert.ok(pose.legs[leg].hip > pose.legs[other].hip);
  }
});

test('an unusually large delta is capped, keeping the newest crossings, never an unbounded burst', () => {
  const falls = footfalls(0, 40 * Math.PI, walk);
  assert.equal(falls.length, MAX_FOOTFALLS_PER_UPDATE);
  assert.deepEqual(falls.map(f => f.count), [39, 40]);
});

test('dash, hit-stop (zero dt) and zero displacement never produce a footfall', () => {
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, { ...walk, dashing: true }), []);
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, { ...walk, dt: 0 }), []);
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, { ...walk, travelled: 0 }), []);
  assert.deepEqual(footfalls(HALF - 0.1, HALF + 0.1, { ...walk, dt: Number.NaN }), []);
  // Reset to zero on a restart is a backward jump, not a stride.
  assert.deepEqual(footfalls(12, 0, walk), []);
});

test('support: stone is classified by its own tile theme, wood and gaps give nothing, negative cells work', () => {
  const meta = new Map<string, CellSurface>([
    ['0,0', { theme: 'keep', wood: false }],
    ['1,0', { theme: 'ruins', wood: false }],
    ['2,0', { theme: 'flooded', wood: false }],
    ['3,0', { theme: 'flooded', wood: true }],
    ['-2,-3', { theme: 'ruins', wood: false }],
  ]);
  const index = buildSurfaceIndex([...slab(0, 0, 0.02), ...slab(1, 0, 0.035), ...slab(2, 0, -0.01), ...slab(3, 0, 0.06), ...slab(-2, -3, 0.04), ...slab(5, 5, 0.02)], meta);
  assert.deepEqual(footSupport(index, 0.1, -0.2), { kind: 'keep', cell: '0,0', y: 0.02 });
  assert.equal(footSupport(index, TILE, 0)?.kind, 'ruins');
  assert.equal(footSupport(index, 2 * TILE + 0.3, 0.1)?.kind, 'flooded');
  assert.ok(Math.abs(footSupport(index, 2 * TILE, 0)!.y + 0.01) < 1e-9, 'the sampled top height was not used');
  assert.equal(footSupport(index, 3 * TILE, 0), null, 'wood always wins: no dust and no drips off planks');
  assert.deepEqual(footSupport(index, -2 * TILE + 0.2, -3 * TILE - 0.2), { kind: 'ruins', cell: '-2,-3', y: 0.04 });
  // Inside cell 0,0 but in the seam past the slab's own edge: no support, no invented plane.
  assert.equal(footSupport(index, 0.72, 0), null);
  // Triangles exist but the cell is not one of the floor's own tiles.
  assert.equal(footSupport(index, 5 * TILE, 5 * TILE), null);
  assert.equal(footSupport(null, 0, 0), null, 'no index yet (or a floor being replaced) means no effect');
  assert.equal(footSupport(index, Number.NaN, 0), null);
});

test('corridors take the tile theme the floor build assigns, never the global mood; a replaced floor replaces the answer', () => {
  // The same themeOf rule dungeon-game.tsx builds its cell metadata with: the owning room, else the
  // nearest chamber centre.
  const metaFor = (floor: ReturnType<typeof generateFloor>) => {
    const themeOf = (x: number, z: number, room: number) => {
      if (room >= 0) return floor.rooms[room].theme;
      let best = Infinity, theme = floor.rooms[0].theme;
      for (const r of floor.rooms) { const d = (r.x - x) ** 2 + (r.z - z) ** 2; if (d < best) { best = d; theme = r.theme; } }
      return theme;
    };
    return new Map(floor.tiles.map(t => [cellKey(t.x, t.z), { theme: themeOf(t.x, t.z, t.room), wood: t.wood }] as [string, CellSurface]));
  };
  const floor = generateFloor(0x5d, 1);
  const meta = metaFor(floor);
  const corridor = floor.tiles.find(t => t.room < 0 && !t.wood);
  assert.ok(corridor, 'fixture floor has no stone corridor tile');
  const index = buildSurfaceIndex(slab(corridor.x, corridor.z, 0.02), meta);
  const hit = footSupport(index, corridor.x * TILE, corridor.z * TILE);
  assert.ok(hit);
  assert.equal(hit.kind, meta.get(cellKey(corridor.x, corridor.z))!.theme);
  assert.equal(floor.roomByCell.has(cellKey(corridor.x, corridor.z)), false);
  // Floor replacement: a new index built for another floor knows nothing about the old cell.
  const other = generateFloor(0x7, 1);
  const replaced = buildSurfaceIndex([], metaFor(other));
  assert.equal(footSupport(replaced, corridor.x * TILE, corridor.z * TILE), null);
});
