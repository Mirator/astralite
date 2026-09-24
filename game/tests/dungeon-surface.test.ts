import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE } from '../app/dungeon-floor.ts';
import { buildSurfaceIndex, sampleSurface, type CellSurface, type SurfaceTriangle } from '../app/dungeon-surface.ts';

// `dungeon-surface.ts`'s own `upwardY` is `(bz-az)*(cx-ax) - (bx-ax)*(cz-az)`: for three points given
// in the order (a, b, c) as written below, that comes out negative - this is the module's real
// convention (a source mesh winds its own faces however it winds them; nothing here assumes CCW),
// so the two helpers below swap b/c to hand back a triangle that is actually upward-facing, rather
// than naming a fixed literal order "up" and being wrong about it.

/** A flat triangle at height `y`, wound so it is genuinely upward-facing per `upwardY`. */
const upTri = (y: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): SurfaceTriangle =>
  ({ ax, ay: y, az, bx: cx, by: y, bz: cz, cx: bx, cy: y, cz: bz });

const meta = (entries: [string, CellSurface][]) => new Map(entries);

test('a tilted (settled) slab interpolates height smoothly, exactly matching its own barycentric weights', () => {
  // One triangle whose three corners sit at three different heights, the way a settled strip's small
  // tilt lifts one edge over another; a genuine plane rather than two flat halves stepped together.
  // Built directly (not through `upTri`, which only swaps winding safely when every corner shares one
  // height) and checked for upward winding explicitly, since each corner now carries its own height.
  const a = { x: -0.7, z: -0.7, y: 0 }, b = { x: 0.7, z: -0.7, y: 0 }, c = { x: 0, z: 0.7, y: 0.06 };
  const tri: SurfaceTriangle = { ax: a.x, ay: a.y, az: a.z, bx: c.x, by: c.y, bz: c.z, cx: b.x, cy: b.y, cz: b.z };
  const upwardY = (tri.bz - tri.az) * (tri.cx - tri.ax) - (tri.bx - tri.ax) * (tri.cz - tri.az);
  assert.ok(upwardY > 0, 'test fixture itself is not upward-wound; fix the fixture before trusting the assertions below');
  const index = buildSurfaceIndex([tri], meta([['0,0', { theme: 'keep', wood: false }]]));
  // The centroid of a triangle carries barycentric weights (1/3, 1/3, 1/3) by construction.
  const centroidX = (a.x + b.x + c.x) / 3, centroidZ = (a.z + b.z + c.z) / 3;
  const expected = (a.y + b.y + c.y) / 3;
  const hit = sampleSurface(index, centroidX, centroidZ)!;
  assert.ok(Math.abs(hit.y - expected) < 1e-9, `centroid height ${hit.y} did not match the expected barycentric average ${expected}`);
  // The apex itself must read back exactly its own height, and the opposite edge's midpoint the
  // average of its two corners - two more points whose expected weights are not 1/3 apiece.
  assert.ok(Math.abs(sampleSurface(index, c.x, c.z)!.y - c.y) < 1e-9);
  assert.ok(Math.abs(sampleSurface(index, (a.x + b.x) / 2, (a.z + b.z) / 2)!.y - (a.y + b.y) / 2) < 1e-9);
});

test('a triangle rotated so its long axis runs along Z is still sampled correctly', () => {
  // A 2.91 x 1.43 merged-pair footprint over cells (0,0) and (0,1), long axis on Z (as
  // `dungeon-game.tsx` builds for a 'z'-oriented pair): containment must not assume the long axis is
  // X. The rectangle is centred on the pair's own midpoint, half a tile off each cell's own centre.
  const halfLong = 1.455, halfShort = 0.715, midZ = TILE / 2;
  const t1 = upTri(0.02, -halfShort, midZ - halfLong, halfShort, midZ - halfLong, halfShort, midZ + halfLong);
  const t2 = upTri(0.02, -halfShort, midZ - halfLong, halfShort, midZ + halfLong, -halfShort, midZ + halfLong);
  const index = buildSurfaceIndex([t1, t2], meta([
    ['0,0', { theme: 'flooded', wood: false }],
    ['0,1', { theme: 'flooded', wood: false }],
  ]));
  assert.ok(Math.abs(sampleSurface(index, 0, 0)!.y - 0.02) < 1e-9, 'the near cell of the pair missed the merged top');
  assert.ok(Math.abs(sampleSurface(index, 0, TILE)!.y - 0.02) < 1e-9, 'the far cell of the pair missed the merged top');
});

test('a merged two-cell top reads the same continuous height on both sides, no seam at the midpoint', () => {
  // Cells (0,0) and (1,0), long axis on X - the rectangle reaches past each cell's own centre.
  const halfLong = 1.455, halfShort = 0.715, midX = TILE / 2;
  const t1 = upTri(0.02, midX - halfLong, -halfShort, midX + halfLong, -halfShort, midX + halfLong, halfShort);
  const t2 = upTri(0.02, midX - halfLong, -halfShort, midX + halfLong, halfShort, midX - halfLong, halfShort);
  const index = buildSurfaceIndex([t1, t2], meta([
    ['0,0', { theme: 'ruins', wood: false }],
    ['1,0', { theme: 'ruins', wood: false }],
  ]));
  const nearCell = sampleSurface(index, 0, 0)!.y;
  const farCell = sampleSurface(index, TILE, 0)!.y;
  const midpoint = sampleSurface(index, midX, 0)!.y;
  // Both cells hit the same barycentric plane, but the two triangles that carry it were built from
  // independently rounded floating-point corners, so the interpolated heights can differ in the last
  // bit or two - a real seam would be off by the 0.02-scale drop the settle math actually applies,
  // not by float64 noise.
  const EPS = 1e-9;
  assert.ok(Math.abs(nearCell - farCell) < EPS, 'the two cells of one merged slab read different heights - a seam, not a continuous top');
  assert.ok(Math.abs(midpoint - nearCell) < EPS);
});

test('a motif-like fragment off the cell centre is still sampled where it actually is', () => {
  // A small off-centre triangle, as a floor motif's own carved fragment might be.
  const tri = upTri(0.038, 0.1, 0.1, 0.5, 0.1, 0.5, 0.5);
  const index = buildSurfaceIndex([tri], meta([['0,0', { theme: 'keep', wood: false }]]));
  assert.ok(sampleSurface(index, 0.35, 0.3));
  assert.equal(sampleSurface(index, -0.4, -0.4), null, 'outside the fragment itself must miss, even inside the same cell');
});

test('overlapping upward faces at a shared edge: the higher one wins', () => {
  const low = upTri(0, -0.7, -0.7, 0.7, -0.7, 0, 0.7);
  const high = upTri(0.5, -0.7, -0.7, 0.7, -0.7, 0, 0.7);
  const index = buildSurfaceIndex([low, high], meta([['0,0', { theme: 'keep', wood: false }]]));
  assert.ok(Math.abs(sampleSurface(index, 0, 0)!.y - 0.5) < 1e-9);
});

test('negative cell coordinates work exactly like positive ones', () => {
  const tri = upTri(0.09, -3 * TILE - 0.7, -2 * TILE - 0.7, -3 * TILE + 0.7, -2 * TILE - 0.7, -3 * TILE, -2 * TILE + 0.7);
  const index = buildSurfaceIndex([tri], meta([['-3,-2', { theme: 'flooded', wood: true }]]));
  const hit = sampleSurface(index, -3 * TILE, -2 * TILE);
  assert.ok(hit);
  assert.equal(hit!.cell, '-3,-2');
  assert.equal(hit!.wood, true);
});
