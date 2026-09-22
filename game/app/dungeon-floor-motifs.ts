import * as THREE from 'three';
import type { MotifLayout } from './dungeon-decor-layout.ts';
import { type Room, type generateFloor } from './dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

/**
 * The three theme constructions, built once in local unit space (bed radius 1, y flat at 0) and
 * reused for every room: a room's own instance only ever contributes a scale, a quarter turn and a
 * translation, so the geometry a seed decides on is exactly the geometry this module built at
 * import time — nothing here consumes the generator's PRNG or `Math.random`.
 *
 * Heights follow the visual specification: bed at 0.028, cuts at 0.033, narrow lips at 0.038, and
 * nothing built here rises past 0.045.
 */
const BED_Y = .028, CUT_Y = .033, LIP_Y = .038;

/** Flat vertex buffers under construction, one bank per material. */
type Bank = { position: number[]; normal: number[] };
const bank = (): Bank => ({ position: [], normal: [] });

/**
 * One triangle, flat-shaded and forced to face up (+Y): the two themes with fragments (`ruins`,
 * `flooded`) are built as fans and strips whose winding is easy to get backwards by hand, and a
 * downward face here would read as a hole rather than as carved stone. Rather than trust every call
 * site to wind consistently, this checks the one component of the cross product a flat XZ triangle
 * has and swaps the last two points when it comes out negative.
 */
const addTri = (
  to: Bank,
  ax: number, az: number,
  bx: number, bz: number,
  cx: number, cz: number,
  y: number,
) => {
  const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const [bx2, bz2, cx2, cz2] = up < 0 ? [cx, cz, bx, bz] : [bx, bz, cx, cz];
  to.position.push(ax, y, az, bx2, y, bz2, cx2, y, cz2);
  to.normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
};

/** A convex polygon, fan-triangulated from its first point. */
const addPolygon = (to: Bank, points: readonly [number, number][], y: number) => {
  for (let i = 1; i < points.length - 1; i++) {
    addTri(to, points[0][0], points[0][1], points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], y);
  }
};

/** A thin rectangle running from `a` to `b`, `width` wide — every narrow lip in this file is one. */
const addLine = (to: Bank, a: readonly [number, number], b: readonly [number, number], width: number, y: number) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
  const p0: [number, number] = [a[0] + nx, a[1] + nz], p1: [number, number] = [b[0] + nx, b[1] + nz];
  const p2: [number, number] = [b[0] - nx, b[1] - nz], p3: [number, number] = [a[0] - nx, a[1] - nz];
  addTri(to, p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], y);
  addTri(to, p0[0], p0[1], p2[0], p2[1], p3[0], p3[1], y);
};

const octagonPoint = (angle: number, r = 1): [number, number] => [Math.sin(angle) * r, Math.cos(angle) * r];
/** The eight corners of a unit-radius octagon, quarter-turn aligned. */
const OCTAGON = Array.from({ length: 8 }, (_, i) => octagonPoint((i * Math.PI) / 4));

/** Narrow-edge width every lip in this file uses, inside the 0.02-0.035 band the palette holds it to. */
const LIP_WIDTH = .032;

export type ThemeBanks = { dark: Bank; inlay: Bank; lip: Bank };

/**
 * The standing keep: an octagonal bed, a broad shield cut into its centre, and the shield's own
 * vertical split. `variant` decides whether the bed's own outer trace is a complete octagon (0) or
 * carries the one deliberately incomplete edge the palette allows a keep or ruin border (1) — the
 * only degree of freedom the visual specification leaves this theme, since the shield's own
 * proportions (0.95 wide, 1.2 tall, at radius 1) are fixed.
 */
function keepMotif(variant: 0 | 1): ThemeBanks {
  const dark = bank(), inlay = bank(), lip = bank();
  addPolygon(dark, OCTAGON, BED_Y);
  // Pointed bottom, flat shoulders, flat top - a shield rather than a roundel, and nothing in it
  // reads as text or miniature heraldry.
  const w = .475, top = .6, shoulder = 0, point = -.6;
  const shield: [number, number][] = [[-w, top], [w, top], [w, shoulder], [0, point], [-w, shoulder]];
  addPolygon(inlay, shield, CUT_Y);
  addLine(lip, [0, top], [0, point], LIP_WIDTH, LIP_Y);
  for (let i = 0; i < 8; i++) {
    if (variant === 1 && i === 0) continue; // the one incomplete edge
    addLine(lip, OCTAGON[i], OCTAGON[(i + 1) % 8], LIP_WIDTH, LIP_Y);
  }
  return { dark, inlay, lip };
}

/**
 * One ring segment, `inner` to 1: a fan from the centre when `inner` is (near) zero, and an actual
 * annular strip once it is not. A sanctuary's clear centre is `inner` here, in the same unit space
 * everything else in this module works in - built into the sector itself rather than trimmed out of
 * it afterwards, because a fan from the origin has no triangle small enough to trim a hole out of
 * without losing most of the sector along with it.
 */
const addWedge = (to: Bank, start: number, end: number, inner: number, segments: number, y: number) => {
  if (inner < 1e-4) {
    const points: [number, number][] = [[0, 0]];
    for (let i = 0; i <= segments; i++) points.push(octagonPoint(start + ((end - start) * i) / segments));
    addPolygon(to, points, y);
    return;
  }
  for (let i = 0; i < segments; i++) {
    const a0 = start + ((end - start) * i) / segments, a1 = start + ((end - start) * (i + 1)) / segments;
    const outer0 = octagonPoint(a0, 1), outer1 = octagonPoint(a1, 1);
    const inner0 = octagonPoint(a0, inner), inner1 = octagonPoint(a1, inner);
    addTri(to, inner0[0], inner0[1], outer0[0], outer0[1], outer1[0], outer1[1], y);
    addTri(to, inner0[0], inner0[1], outer1[0], outer1[1], inner1[0], inner1[1], y);
  }
};

/**
 * The collapsed outer works: three separated sectors of a once-octagonal bed, the fourth dropped
 * entirely (25% of the bed gone before the gaps between the survivors are even counted, which is
 * what keeps this inside the 25-35% the palette asks for) and each survivor carrying one broken
 * chevron edge near its outer face. The dropped sector is always index 0 in this local frame; the
 * caller's own quarter-turn is what decides which absolute direction that reads as, so one seed
 * field does both jobs the palette asks of it — orientation and which fragment is missing.
 *
 * `inner` is a sanctuary's clear centre, as a fraction of this bed's own radius: 0 for an ordinary
 * room, in which case every sector still reaches the middle the way the palette's other rooms do.
 */
function ruinsMotif(variant: 0 | 1, inner = 0): ThemeBanks {
  const dark = bank(), lip = bank();
  const gap = variant === 0 ? .07 : .1; // radians of half-gap either side of a sector, ~0.12-0.22 world at this bed's radius
  const arcSegments = 8;
  for (let quadrant = 1; quadrant < 4; quadrant++) {
    const centre = quadrant * (Math.PI / 2);
    const start = centre - Math.PI / 4 + gap, end = centre + Math.PI / 4 - gap;
    addWedge(dark, start, end, inner, arcSegments, BED_Y);
    // The two cut edges a break leaves behind - a narrow lip the same width the keep's own border
    // trace uses, so "separated" reads as separated rather than needing the seal ring's own tint
    // over the paving between sectors to carry the whole claim.
    addLine(lip, octagonPoint(start, inner), octagonPoint(start, 1), LIP_WIDTH, LIP_Y);
    addLine(lip, octagonPoint(end, inner), octagonPoint(end, 1), LIP_WIDTH, LIP_Y);
    // One broken chevron edge, near the sector's outer face - positioned proportionally between
    // the clear centre and the rim, so it always lands on stone this sector actually has.
    const mid = (start + end) / 2;
    const apex = octagonPoint(mid, inner + (1 - inner) * .78);
    const left = octagonPoint(mid - .16, inner + (1 - inner) * .52), right = octagonPoint(mid + .16, inner + (1 - inner) * .52);
    addLine(lip, apex, left, LIP_WIDTH, LIP_Y);
    addLine(lip, apex, right, LIP_WIDTH, LIP_Y);
  }
  return { dark, inlay: bank(), lip };
}

/**
 * The drowned levels: three parallel channels and no disk at all, crossed by two broken bars. Both
 * variants keep every dimension inside the palette's band once scaled by a typical bed radius
 * (~2.35): a channel comes out 0.10-0.14 wide, 2.6-3.8 long, spaced 0.45-0.65 apart; a smaller room
 * shrinks all three together rather than only one drifting out of proportion with the others.
 *
 * A sanctuary's clear centre (`inner`, as a fraction of this bed's radius) cuts a circular gap out
 * of each channel around the origin rather than trimming whichever half a coarse quad happened to
 * land in: a channel offset far enough from the centre to miss the circle entirely is untouched, and
 * one that cannot clear it at all - the tightest sanctuary fits, where the clear circle nearly
 * matches the channel's own half-length - is dropped rather than left as an unreadable sliver.
 */
function floodedMotif(variant: 0 | 1, inner = 0): ThemeBanks {
  const dark = bank(), lip = bank();
  const halfLength = variant === 0 ? .68 : .58;
  const spacing = variant === 0 ? .234 : .27;
  const width = .051;
  for (const offset of [-spacing, 0, spacing]) {
    const gap = inner > Math.abs(offset) ? Math.sqrt(inner * inner - offset * offset) : 0;
    for (const side of [1, -1]) {
      const lo = gap, hi = halfLength;
      if (hi - lo < .04) continue;
      const x0 = side * lo, x1 = side * hi;
      const a: [number, number] = [Math.min(x0, x1), offset - width / 2], b: [number, number] = [Math.max(x0, x1), offset - width / 2];
      const c: [number, number] = [Math.max(x0, x1), offset + width / 2], d: [number, number] = [Math.min(x0, x1), offset + width / 2];
      addTri(dark, a[0], a[1], b[0], b[1], c[0], c[1], BED_Y);
      addTri(dark, a[0], a[1], c[0], c[1], d[0], d[1], BED_Y);
    }
  }
  const span = spacing * 2 + width + .04;
  for (const at of [-halfLength * .45, halfLength * .45]) {
    if (Math.abs(at) < inner) continue; // the bar itself would sit inside the clear disc
    addLine(lip, [at, -span / 2], [at, span / 2], LIP_WIDTH, LIP_Y);
  }
  return { dark, inlay: bank(), lip };
}

const CACHE = new Map<string, ThemeBanks>();
/**
 * The canonical unit-space construction for a theme, variant and (when a sanctuary's clear centre
 * applies) inner fraction. Cached only for the ordinary, centre-reaching case - the one every room
 * but a sanctuary uses - since `inner` is otherwise a continuous value derived from that room's own
 * radius and caching it would either miss on almost every sanctuary or hold one entry per room.
 */
const motifBanks = (theme: Room['theme'], variant: 0 | 1, inner = 0): ThemeBanks => {
  const build = () => (theme === 'keep' ? keepMotif(variant) : theme === 'ruins' ? ruinsMotif(variant, inner) : floodedMotif(variant, inner));
  if (inner > 0) return build();
  const key = `${theme}:${variant}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const built = build();
  CACHE.set(key, built);
  return built;
};

export type MotifBuildResult = {
  /** What actually made it into the scene, for a diagnostic to report rather than recompute. */
  realized: { room: number; theme: Room['theme'] }[];
  dispose(): void;
};

/**
 * Bakes every planned motif straight into merged, per-region, per-material geometry: no per-room
 * mesh, no per-fragment material, and no instancing either, since each room's construction differs
 * by more than a transform once a sanctuary's clear centre drops triangles out of it. The region key
 * mirrors the one `dungeon-game.tsx` batches paving with, so a motif costs the same kind of draw
 * call a chamber's floor already pays for rather than a new one per room.
 */
export function buildFloorMotifs(
  world: THREE.Group,
  floor: Floor,
  layouts: readonly MotifLayout[],
  materials: { dark: THREE.Material; inlay: THREE.Material; lip: THREE.Material },
): MotifBuildResult {
  const rooms = new Map(floor.rooms.map((room) => [room.id, room]));
  const regions = new Map<string, ThemeBanks>();
  const regionFor = (room: Room) => {
    const key = `${Math.floor(room.x / 12)},${Math.floor(room.z / 12)}`;
    const existing = regions.get(key);
    if (existing) return existing;
    const created: ThemeBanks = { dark: bank(), inlay: bank(), lip: bank() };
    regions.set(key, created);
    return created;
  };
  const realized: { room: number; theme: Room['theme'] }[] = [];
  for (const layout of layouts) {
    const room = rooms.get(layout.room);
    if (!room) continue;
    const source = motifBanks(layout.theme, layout.variant, layout.clearRadius ? layout.clearRadius / layout.radius : 0);
    const target = regionFor(room);
    const angle = layout.turn * (Math.PI / 2), cos = Math.cos(angle), sin = Math.sin(angle);
    const append = (from: Bank, to: Bank) => {
      for (let i = 0; i < from.position.length; i += 9) {
        // A safety net, not the primary defence: `motifBanks` already built this construction with
        // the clear centre baked in when `layout.clearRadius` is set, so this rarely drops anything
        // by the time a theme's own geometry gets here — it exists for the one shape (a chevron arm,
        // an arc's discretised edge) that can still land a hair inside the circle it was aimed to clear.
        if (layout.clearRadius) {
          const cx = ((from.position[i] + from.position[i + 3] + from.position[i + 6]) / 3) * layout.radius;
          const cz = ((from.position[i + 2] + from.position[i + 5] + from.position[i + 8]) / 3) * layout.radius;
          if (Math.hypot(cx, cz) < layout.clearRadius) continue;
        }
        for (let v = 0; v < 3; v++) {
          const lx = from.position[i + v * 3] * layout.radius, ly = from.position[i + v * 3 + 1];
          const lz = from.position[i + v * 3 + 2] * layout.radius;
          const wx = lx * cos - lz * sin, wz = lx * sin + lz * cos;
          to.position.push(layout.x + wx, ly, layout.z + wz);
          to.normal.push(from.normal[i + v * 3], from.normal[i + v * 3 + 1], from.normal[i + v * 3 + 2]);
        }
      }
    };
    append(source.dark, target.dark);
    append(source.inlay, target.inlay);
    append(source.lip, target.lip);
    realized.push({ room: layout.room, theme: layout.theme });
  }
  const meshes: THREE.Mesh[] = [];
  const finalize = (from: Bank, material: THREE.Material) => {
    if (!from.position.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(from.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(from.normal, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    // Walked on, not walked through: the later surface-height index (006/008) reads this the same
    // way it reads paving. Freshly built per floor, so it must not carry `userData.shared` — that
    // flag is what tells the floor teardown to skip disposing a geometry, and this one is the
    // floor's own.
    mesh.userData.walkingSurface = true;
    world.add(mesh);
    meshes.push(mesh);
  };
  for (const region of regions.values()) {
    finalize(region.dark, materials.dark);
    finalize(region.inlay, materials.inlay);
    finalize(region.lip, materials.lip);
  }
  return {
    realized,
    // Every geometry here is attached to a mesh already in `world`, and `dungeon-game.tsx` disposes
    // exactly that way on floor teardown; this exists so a caller that does not go through that
    // traversal - a unit test, a future standalone use - still has an explicit way to free them.
    dispose() { for (const mesh of meshes) mesh.geometry.dispose(); },
  };
}
