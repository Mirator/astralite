import * as THREE from 'three';
import { TILE } from './dungeon-floor.ts';

/**
 * The merged two-cell slab `dungeon-paving-layout.ts` plans a pair onto. Same bevel language as
 * `pavingGeometry` in `dungeon-art.ts` - a flat top, a lit rim and a dark skirt into the joint - just
 * built long-axis-first, on independent half-width/half-depth rather than one shared half, since a
 * rectangle's four sides are not a single trapezoid turned four times the way a square's are.
 *
 * Outer footprint 2*TILE-0.05 by TILE-0.05 (2.91 x 1.43), which is exactly two ordinary slab
 * footprints wide with the same 0.05 joint margin `dungeon-art.ts`'s `SLAB` already keeps on every
 * side, so a merged slab reads as two courses fused rather than as a slab of some other size.
 */
const HALF_WIDTH = (2 * TILE - 0.05) / 2;
const HALF_DEPTH = (TILE - 0.05) / 2;
/** Matches `dungeon-art.ts`'s TOP/BASE/LIP exactly - the physical bevel this slab must keep. */
const TOP = 0.09, BASE = -0.09, LIP = 0.075;
/** How much light the joint keeps, same value `dungeon-art.ts` uses for its own skirt. */
const JOINT = 0.52;

type Corner = readonly [number, number, number];
type Bank = { position: number[]; normal: number[]; uv: number[]; color: number[] };

/**
 * Picks the winding order (`a b c d` or `a d c b`) whose flat-shaded normal actually points toward
 * `outward`, rather than trusting a hand-picked corner order to be right. Plan 005's ruins flame
 * shipped a tongue back-face-culled into nothing because a shared winding rule silently disagreed
 * with one face's own geometry; the fix there was to derive "outward" from the shape rather than
 * assume it, and this is the same fix applied while the geometry is still being built instead of
 * after a capture caught it missing.
 */
const orientQuad = (a: Corner, b: Corner, c: Corner, d: Corner, outward: Corner): [Corner, Corner, Corner, Corner] => {
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const dot = nx * outward[0] + ny * outward[1] + nz * outward[2];
  return dot < 0 ? [a, d, c, b] : [a, b, c, d];
};

/** One flat-shaded facet (a triangle or a quad as two), vertex-coloured, planar-mapped from above. */
const facet = (bank: Bank, shade: number, a: Corner, b: Corner, c: Corner, d: Corner | undefined, outward: Corner) => {
  const [pa, pb, pc, pd] = d ? orientQuad(a, b, c, d, outward) : [a, b, c, undefined];
  const nx = (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]);
  const ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
  const nz = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
  const len = Math.hypot(nx, ny, nz) || 1;
  for (const p of pd ? [pa, pb, pc, pa, pc, pd] : [pa, pb, pc]) {
    bank.position.push(p[0], p[1], p[2]);
    bank.normal.push(nx / len, ny / len, nz / len);
    bank.color.push(shade, shade, shade);
    // The whole rectangle mapped over 0..1 once, not the single-tile UV repeated twice: repeating it
    // would paint the existing edge-shaded texture's own border straight down the middle of a merged
    // slab, which is exactly the "texture-painted centre seam" the plan calls out to reject.
    bank.uv.push(p[0] / (2 * HALF_WIDTH) + 0.5, p[2] / (2 * HALF_DEPTH) + 0.5);
  }
};

/**
 * The long-slab geometry, shared by every X-oriented pair in one floor; `dungeon-game.tsx` rotates a
 * quarter turn for a Z-oriented one rather than building a second geometry. Eighteen triangles: one
 * top quad, four rim quads (the lit bevel) and four skirt quads (the dark joint into the neighbouring
 * slab) - the same nine-quad shape `pavingGeometry('plain')` builds for a single tile, just on this
 * footprint's own half-width and half-depth instead of one shared half.
 *
 * Built fresh per call rather than cached at module scope: paving geometry ownership is floor-local
 * in this codebase (`tileGeometry`/`grooveGeometry`/`dishGeometry`/`foundationGeometry` are all built
 * again in every `buildFloor` and swept up by `clearFloor`'s traversal), and this one follows the
 * same rule instead of carrying a `userData.shared` exception through it.
 */
export function pavingPatchGeometry(): THREE.BufferGeometry {
  const innerW = HALF_WIDTH - LIP, innerD = HALF_DEPTH - LIP, shoulder = TOP - LIP;
  const bank: Bank = { position: [], normal: [], uv: [], color: [] };

  // Top.
  facet(bank, 1,
    [-innerW, TOP, innerD], [innerW, TOP, innerD], [innerW, TOP, -innerD], [-innerW, TOP, -innerD],
    [0, 1, 0]);
  // Rim: the two long (+z/-z) sides, then the two short (+x/-x) ends.
  facet(bank, 1,
    [-innerW, TOP, innerD], [-HALF_WIDTH, shoulder, HALF_DEPTH], [HALF_WIDTH, shoulder, HALF_DEPTH], [innerW, TOP, innerD],
    [0, 0, 1]);
  facet(bank, 1,
    [innerW, TOP, -innerD], [HALF_WIDTH, shoulder, -HALF_DEPTH], [-HALF_WIDTH, shoulder, -HALF_DEPTH], [-innerW, TOP, -innerD],
    [0, 0, -1]);
  facet(bank, 1,
    [innerW, TOP, innerD], [HALF_WIDTH, shoulder, HALF_DEPTH], [HALF_WIDTH, shoulder, -HALF_DEPTH], [innerW, TOP, -innerD],
    [1, 0, 0]);
  facet(bank, 1,
    [-innerW, TOP, -innerD], [-HALF_WIDTH, shoulder, -HALF_DEPTH], [-HALF_WIDTH, shoulder, HALF_DEPTH], [-innerW, TOP, innerD],
    [-1, 0, 0]);
  // Skirt: down from the rim's outer shoulder to the slab's underside, one quad per side, same
  // outward direction as the rim quad it continues - what the lens sees of the joint to a neighbour.
  facet(bank, JOINT,
    [-HALF_WIDTH, shoulder, HALF_DEPTH], [-HALF_WIDTH, BASE, HALF_DEPTH], [HALF_WIDTH, BASE, HALF_DEPTH], [HALF_WIDTH, shoulder, HALF_DEPTH],
    [0, 0, 1]);
  facet(bank, JOINT,
    [HALF_WIDTH, shoulder, -HALF_DEPTH], [HALF_WIDTH, BASE, -HALF_DEPTH], [-HALF_WIDTH, BASE, -HALF_DEPTH], [-HALF_WIDTH, shoulder, -HALF_DEPTH],
    [0, 0, -1]);
  facet(bank, JOINT,
    [HALF_WIDTH, shoulder, HALF_DEPTH], [HALF_WIDTH, BASE, HALF_DEPTH], [HALF_WIDTH, BASE, -HALF_DEPTH], [HALF_WIDTH, shoulder, -HALF_DEPTH],
    [1, 0, 0]);
  facet(bank, JOINT,
    [-HALF_WIDTH, shoulder, -HALF_DEPTH], [-HALF_WIDTH, BASE, -HALF_DEPTH], [-HALF_WIDTH, BASE, HALF_DEPTH], [-HALF_WIDTH, shoulder, HALF_DEPTH],
    [-1, 0, 0]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bank.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bank.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bank.uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(bank.color, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Outer footprint, exported so a test can hold the built geometry to the plan's own numbers. */
export const PATCH_HALF_WIDTH = HALF_WIDTH;
export const PATCH_HALF_DEPTH = HALF_DEPTH;
export const PATCH_TOP = TOP;
export const PATCH_BASE = BASE;
