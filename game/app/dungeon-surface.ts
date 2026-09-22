import { cellKey, TILE } from './dungeon-floor.ts';

/**
 * A presentation-only support-height index over the floor's own walking surfaces: paving, wood
 * planks and floor motifs. `dungeon-game.tsx` builds one bridge from the realized scene into this
 * module's numeric shape after every floor build (see `buildSurfaceIndex`'s doc comment for what it
 * reads); this file itself never imports three.js and never sees a mesh, so it stays as directly
 * testable as the rest of the pure rule modules. Plan 008 (footstep feedback) is the reason this
 * exists as a standalone, reusable module rather than inline in the game file - collision continues
 * to use `floor.cells`/`canStand`, and nothing here is consulted for whether an actor may stand
 * somewhere, only for what the ground under an already-legal position looks like.
 */

/** One triangle in world space, wound however its source mesh wound it - winding is not assumed. */
export type SurfaceTriangle = {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
};

/** What a cell's surface is made of, independent of any triangle actually landing in it. */
export type CellSurface = { theme: 'keep' | 'ruins' | 'flooded'; wood: boolean };

export type SurfaceHit = { cell: string; y: number; theme: 'keep' | 'ruins' | 'flooded'; wood: boolean };

export type SurfaceIndex = {
  cells: Map<string, SurfaceTriangle[]>;
  meta: Map<string, CellSurface>;
};

/** The grid cell a world position sits over - same rounding `canStand`/`moveOnFloor` key off. */
export const surfaceCell = (x: number, z: number) => cellKey(Math.round(x / TILE), Math.round(z / TILE));

/** Twice the signed XZ area of the triangle; its sign is the triangle's own winding, not assumed. */
const signedArea2 = (t: SurfaceTriangle) =>
  (t.bx - t.ax) * (t.cz - t.az) - (t.bz - t.az) * (t.cx - t.ax);

/**
 * Barycentric weights for `(px, pz)` against `t`'s XZ projection, or `null` outside it (a small
 * negative epsilon admits a point sitting exactly on an edge, which real query points do at a slab
 * boundary rather than only in theory). Degenerate (zero-area) triangles never match anything.
 */
const containment = (t: SurfaceTriangle, px: number, pz: number) => {
  const area = signedArea2(t);
  if (Math.abs(area) < 1e-9) return null;
  const u = ((t.bx - px) * (t.cz - pz) - (t.bz - pz) * (t.cx - px)) / area;
  const v = ((t.cx - px) * (t.az - pz) - (t.cz - pz) * (t.ax - px)) / area;
  const w = 1 - u - v;
  const eps = -1e-6;
  if (u < eps || v < eps || w < eps) return null;
  return { u, v, w };
};

/** The upward-facing normal's Y component, unnormalized - only its sign is ever used. */
const upwardY = (t: SurfaceTriangle) =>
  (t.bz - t.az) * (t.cx - t.ax) - (t.bx - t.ax) * (t.cz - t.az);

/**
 * Bins every upward-facing triangle into each grid cell its XZ footprint could touch. Binning is
 * conservative (by axis-aligned bounding box, not exact polygon clipping) and cheap; `sampleSurface`
 * does the exact containment test per query, so a triangle sitting in one extra neighbouring cell's
 * bucket costs nothing beyond one rejected barycentric test. A downward-facing triangle - the
 * underside of a rim, a foundation's side - is dropped here rather than carried and filtered later,
 * since nothing above ever wants to stand on the inside of the floor.
 */
export function buildSurfaceIndex(triangles: readonly SurfaceTriangle[], cellMetadata: ReadonlyMap<string, CellSurface>): SurfaceIndex {
  const cells = new Map<string, SurfaceTriangle[]>();
  for (const t of triangles) {
    if (upwardY(t) <= 0) continue;
    const minX = Math.min(t.ax, t.bx, t.cx), maxX = Math.max(t.ax, t.bx, t.cx);
    const minZ = Math.min(t.az, t.bz, t.cz), maxZ = Math.max(t.az, t.bz, t.cz);
    const x0 = Math.floor(minX / TILE + 0.5), x1 = Math.floor(maxX / TILE + 0.5);
    const z0 = Math.floor(minZ / TILE + 0.5), z1 = Math.floor(maxZ / TILE + 0.5);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = cellKey(x, z);
        const bucket = cells.get(key);
        if (bucket) bucket.push(t); else cells.set(key, [t]);
      }
    }
  }
  return { cells, meta: new Map(cellMetadata) };
}

/**
 * The highest upward-facing surface under `(x, z)`, or `null` when nothing binned in that cell
 * actually contains the point - a real gap (a seam, a hole) rather than an invented flat plane. When
 * more than one face contains the point (a settled slab's tilt can dip one corner under a neighbour's
 * rim at the shared edge), the higher one wins, which is what a foot standing on real overlapping
 * stone would rest on.
 */
export function sampleSurface(index: SurfaceIndex, x: number, z: number): SurfaceHit | null {
  const key = surfaceCell(x, z);
  const bucket = index.cells.get(key);
  if (!bucket || !bucket.length) return null;
  let bestY = -Infinity, hit = false;
  for (const t of bucket) {
    const bary = containment(t, x, z);
    if (!bary) continue;
    const y = bary.u * t.ay + bary.v * t.by + bary.w * t.cy;
    if (y > bestY) { bestY = y; hit = true; }
  }
  if (!hit) return null;
  const meta = index.meta.get(key);
  return { cell: key, y: bestY, theme: meta?.theme ?? 'keep', wood: meta?.wood ?? false };
}
