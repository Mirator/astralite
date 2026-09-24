import * as THREE from 'three';
import type { Room } from './dungeon-floor';

/** The three room families a brazier can belong to; borrowed rather than redeclared. */
export type FlameTheme = Room['theme'];

type Face = readonly [number, number, number];
type Vertex = readonly [number, number, number];

/**
 * Winds a small closed solid's faces outward and returns its raw triangle positions (not yet a
 * `BufferGeometry` - see `solid` and `mergeSolids` below, which are what callers actually use).
 *
 * "Outward" is decided by testing each face's normal against the vector from `center` to that
 * face's own centroid, and swapping two vertices to flip the face if they disagree. That test is
 * only correct when `center` genuinely sits inside the solid being wound - the origin for `keep`
 * and `flooded`, which really are built star-shaped around it, but NOT the global origin for either
 * of `ruins`'s two tongues individually, since each one is its own small solid sitting well off to
 * one side. Passing the origin for those (as an earlier version of this file did) silently flips
 * the faces on whichever side of a tongue faces back toward the origin - the exact faces a camera
 * looking at that tongue from roughly that direction needs - which is why a capture of the finished
 * scene showed only one tongue rendering at all: the second one's near faces were wound backward and
 * back-face culled, not merely small or hidden behind the halo. `ruinsFlame` calls this once per
 * tongue with that tongue's own vertex centroid as `center`, which is what makes the winding test
 * correct for an off-centre shape.
 */
function windOutward(vertices: readonly Vertex[], faces: readonly Face[], center: Vertex): Float32Array {
  const positions = new Float32Array(faces.length * 9);
  faces.forEach(([i0, i1, i2], f) => {
    const p0 = vertices[i0]; let p1 = vertices[i1]; let p2 = vertices[i2];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (p0[0] + p1[0] + p2[0]) / 3 - center[0];
    const cy = (p0[1] + p1[1] + p2[1]) / 3 - center[1];
    const cz = (p0[2] + p1[2] + p2[2]) / 3 - center[2];
    if (nx * cx + ny * cy + nz * cz < 0) { const swap = p1; p1 = p2; p2 = swap; }
    const o = f * 9;
    positions[o] = p0[0]; positions[o + 1] = p0[1]; positions[o + 2] = p0[2];
    positions[o + 3] = p1[0]; positions[o + 4] = p1[1]; positions[o + 5] = p1[2];
    positions[o + 6] = p2[0]; positions[o + 7] = p2[1]; positions[o + 8] = p2[2];
  });
  return positions;
}

/** Wraps a triangle-position buffer into a finished, normal- and bounds-computed geometry. */
function fromPositions(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Builds a small closed solid that really is star-shaped around the origin: `keep`, `flooded`. */
function solid(vertices: readonly Vertex[], faces: readonly Face[]): THREE.BufferGeometry {
  return fromPositions(windOutward(vertices, faces, [0, 0, 0]));
}

/** The average position of a small vertex list - used as each `ruins` tongue's own winding centre. */
function centroidOf(vertices: readonly Vertex[]): Vertex {
  let x = 0, y = 0, z = 0;
  for (const v of vertices) { x += v[0]; y += v[1]; z += v[2]; }
  return [x / vertices.length, y / vertices.length, z / vertices.length];
}

/** Concatenates several independently-wound triangle buffers into one finished geometry. */
function mergeSolids(parts: readonly Float32Array[]): THREE.BufferGeometry {
  const positions = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { positions.set(p, offset); offset += p.length; }
  return fromPositions(positions);
}

/** One face fan shared by the two bipyramids (`keep`, `flooded`): apex 0, apex 1, ring 2..5. */
const BIPYRAMID_FACES: readonly Face[] = [
  [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2],
  [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5],
];

/** Which mesh a geometry is being built for. */
export type FlamePart = 'body' | 'core';

/**
 * How much smaller the core is than the body: 45-55% width/depth, at most 65% height. This used to
 * be a runtime `Object3D.scale` applied to a core mesh that reused the body's own geometry - correct
 * for `keep` and `flooded`, whose bodies have one peak, but wrong for `ruins`: shrinking the whole
 * two-tongue shape toward its shared local origin also pulls the two apexes proportionally closer
 * together, and at core size that reads as one merged spike - the exact "still looks like keep"
 * failure a capture review caught. Each builder below applies this factor to its own dimensions
 * instead, so `ruins` can shrink each tongue's own height and radius while leaving both apexes at
 * the body's own x position - the core stays two small tongues, not one blurred one.
 */
const CORE_FACTOR = { w: 0.5, h: 0.6, d: 0.5 } as const;
const factorFor = (part: FlamePart) => (part === 'core' ? CORE_FACTOR : { w: 1, h: 1, d: 1 });

/**
 * `keep`: one narrow, asymmetric diamond. A tall bipyramid whose ring sits low and whose own tip
 * leans a few hundredths of a unit off the vertical axis, so the silhouette reads as a single lit
 * tongue standing slightly off true rather than a spinning gem. Rest envelope 0.32 x 0.85 x 0.30.
 */
function keepFlame(part: FlamePart): THREE.BufferGeometry {
  const f = factorFor(part);
  const hw = 0.16 * f.w, hh = 0.425 * f.h, hd = 0.15 * f.d, ringY = -hh * 0.28;
  return solid(
    [
      [0.065 * f.w, hh, -0.045 * f.d],
      [-0.03 * f.w, -hh, 0.02 * f.d],
      [hw, ringY, 0],
      [0, ringY, hd],
      [-hw * 0.72, ringY, 0],
      [0, ringY, -hd * 0.72],
    ],
    BIPYRAMID_FACES,
  );
}

/**
 * `ruins`: two connected-looking, unequal tongues built as two closed tetrahedra sharing one
 * BufferGeometry — never a group with two materials, which would add a draw. The second tongue's
 * apex sits at 65% of the first's height. Both apexes keep the same x position and the same shared
 * base plane at every size - core included - so from the brazier's own raised, angled camera the
 * taller tongue cannot swallow the shorter one into a single spike. Rest envelope 0.50 x 0.65 x 0.35.
 *
 * Getting two tongues that actually READ as two tongues took a second pass past the one above: a
 * projection of both apexes through the game's own fixed orthographic camera (position, lookAt and
 * frustum copied from `dungeon-game.tsx`; see the throwaway script this was checked with) showed the
 * first attempt - apexes 0.32 apart, each tongue a comfortable 0.21-0.15 wide - separating by only
 * about 5px on a 1000-wide canvas, against tongues 5-8px wide apiece: less gap than either tongue's
 * own width, which a captured frame duly showed as one fused shape. Most of the 0.50 width budget
 * now goes to keeping the two apexes apart (0.51 total separation) rather than to either tongue's
 * own radius (0.065/0.048, down from 0.105/0.075), which reprojects to a ~15px gap against ~4-5px
 * -wide tongues at the same camera - a real valley, not a rounding error - while the two tongues'
 * combined span still lands within a pixel or two of the same 0.50 envelope the table gives.
 *
 * Deliberate deviation from the plan's generic "core is 45-55% body width": that figure reads
 * naturally for one peak, where "width" and "how far the flame's own mass reaches" are the same
 * measurement. Here the body's width is mostly the GAP between two peaks, not either peak's own
 * size, and a core scaled the same way in x pulls the two peaks together by exactly that factor -
 * which a captured, reviewed frame showed collapsing into one spike at 45-55%, the same failure the
 * silhouette spec exists to catch. Keeping the peaks apart and shrinking only their own radius and
 * height (still <=65% height, still visibly short of the body's own edges) keeps two legible cores
 * over two legible tongues; a literal width percentage would have bought back the single-spike bug
 * this shape was rebuilt to fix.
 */
function ruinsFlame(part: FlamePart): THREE.BufferGeometry {
  const f = factorFor(part);
  // The 0.65 total height is spent mostly ABOVE the body's own centre and only a little below it,
  // not split evenly: the brazier's bowl and rim sit right at the body's base, and a capture off the
  // real scene showed the shorter tongue's apex disappearing into that cap when the base ran the
  // full -0.325 downward. Raising the base (and the whole height budget with it) clears both tips
  // above the rim's own silhouette without changing the 0.65 figure the spec table gives.
  const baseY = -0.10 * f.h, tallHeight = 0.65 * f.h, shortHeight = tallHeight * 0.65;
  const tallApexY = baseY + tallHeight, shortApexY = baseY + shortHeight;
  const tallX = -0.26, shortX = 0.27, tallR = 0.065 * f.w, shortR = 0.048 * f.w;
  const tongue = (apexX: number, apexY: number, r: number): Vertex[] => [
    [apexX, apexY, 0],
    [apexX, baseY, r],
    [apexX - r * 0.866, baseY, -r * 0.5],
    [apexX + r * 0.866, baseY, -r * 0.5],
  ];
  const tall = tongue(tallX, tallApexY, tallR);
  const short = tongue(shortX, shortApexY, shortR);
  const tetra: readonly Face[] = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
  // Each tongue is wound outward from its OWN centroid, not the shared origin: the two are wide
  // apart on purpose (see above), and testing a face on the far tongue's near side against the
  // origin disagrees with what that face's own solid calls outward, flipping it backward and
  // back-face-culling it invisible - which is why an earlier version of this rendered only one
  // tongue, not a small or washed-out second one. Merging the two independently-wound buffers
  // keeps this "one BufferGeometry, no material group" the same as before.
  return mergeSolids([
    windOutward(tall, tetra, centroidOf(tall)),
    windOutward(short, tetra, centroidOf(short)),
  ]);
}

/**
 * `flooded`: a low, broad, faceted bud with an off-centre peak — the ring dominates the silhouette
 * rather than a tip, and both apexes are pushed sideways so nothing about it reads as a vertical
 * flame. Rest envelope 0.52 x 0.38 x 0.43.
 */
function floodedFlame(part: FlamePart): THREE.BufferGeometry {
  const f = factorFor(part);
  const hw = 0.26 * f.w, hh = 0.19 * f.h, hd = 0.215 * f.d;
  return solid(
    [
      [0.06 * f.w, hh, -0.04 * f.d],
      [-0.045 * f.w, -hh, 0.03 * f.d],
      [hw, 0, 0],
      [0, 0, hd],
      [-hw * 0.85, 0, 0],
      [0, 0, -hd * 0.85],
    ],
    BIPYRAMID_FACES,
  );
}

const BUILDERS: Record<FlameTheme, (part: FlamePart) => THREE.BufferGeometry> = {
  keep: keepFlame,
  ruins: ruinsFlame,
  flooded: floodedFlame,
};

/** Builds the geometry a theme needs for one part, on demand. Callers own the cache and the disposal. */
export function createFlameGeometry(theme: FlameTheme, part: FlamePart = 'body'): THREE.BufferGeometry {
  return BUILDERS[theme](part);
}

/** The body's local scale, offset (added to its fixed centre) and yaw for one theme at one instant. */
export type FlamePose = {
  scale: { x: number; y: number; z: number };
  offset: { x: number; y: number; z: number };
  rotationY: number;
};

const TAU = Math.PI * 2;

/**
 * Pure and allocation-light: given absolute time and a per-source phase, returns the same pose for
 * the same inputs every time, so repeated calls at one instant cannot drift and a paused/zero-time
 * redraw is exactly reproducible. `rotationY` stays 0 for every theme rather than carrying the
 * seeded phase as a static yaw, which an earlier pass tried: it desynchronised same-theme braziers
 * well enough, but `ruins`'s two tongues sit apart along the geometry's own local x axis, and a
 * random yaw just as often turns that axis to face the fixed camera edge-on, hiding the shorter
 * tongue behind the taller one. `phase` still desyncs each source's breathing/sway timing below,
 * which is the desync the visual spec actually asks for; only the constant per-source rotation is
 * dropped.
 */
export function flamePose(theme: FlameTheme, time: number, phase: number): FlamePose {
  if (theme === 'keep') {
    // Slow vertical breathing +/-5%, bob +/-0.025 at 0.65 Hz; no continuous full rotation.
    const w = TAU * 0.65 * time;
    return {
      scale: { x: 1, y: 1 + Math.sin(w + phase) * 0.05, z: 1 },
      offset: { x: 0, y: Math.sin(w + phase + 0.5) * 0.025, z: 0 },
      rotationY: 0,
    };
  }
  if (theme === 'ruins') {
    // Height +/-12%, tip sway +/-0.05 at mixed 1.7 and 2.9 Hz; irregular-looking but deterministic.
    const a = Math.sin(TAU * 1.7 * time + phase), b = Math.sin(TAU * 2.9 * time + phase * 1.3);
    const sway = Math.sin(TAU * 1.7 * time + phase * 0.8) * 0.6 + Math.sin(TAU * 2.9 * time + phase * 1.6) * 0.4;
    return {
      scale: { x: 1, y: 1 + (a * 0.6 + b * 0.4) * 0.12, z: 1 },
      offset: { x: sway * 0.05, y: 0, z: 0 },
      rotationY: 0,
    };
  }
  // flooded: width +/-4%, height +/-6% at 0.45 Hz; no vertical shooting or spin.
  const w = TAU * 0.45 * time;
  return {
    scale: { x: 1 + Math.sin(w + phase) * 0.04, y: 1 + Math.sin(w + phase + Math.PI / 2) * 0.06, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
    rotationY: 0,
  };
}

/** Body centre height, above the bowl rim, that lets each theme's taller/shorter profile clear it. */
export const FLAME_BASE_Y: Record<FlameTheme, number> = { keep: 1.52, ruins: 1.43, flooded: 1.28 };

/**
 * Halo footprint per theme; never exceeds the shared 2.7 x 3.5 ceiling. `ruins` shrinks well past a
 * cosmetic trim: at 2.6 x 2.7 the additive glow was several times wider than the whole twin-tongue
 * body (0.50 wide) and filled in exactly the gap between the two peaks that makes them read as two,
 * turning a real ~15px silhouette valley (see `ruinsFlame`) back into one smooth bright dome in a
 * captured frame. Smaller here is what lets the body's own shape carry the read it needs to.
 */
// Plan 014 round 7 (lever 6): trimmed about 15% off every axis - "slightly smaller", alongside the
// smoother falloff `glowTexture` now draws, since a softer edge earns back some of the presence a
// bigger sprite was previously carrying just to be seen at all.
export const FLAME_HALO_SCALE: Record<FlameTheme, { x: number; y: number }> = {
  keep: { x: 1.7, y: 2.8 },
  ruins: { x: 1.28, y: 1.45 },
  flooded: { x: 2.3, y: 1.62 },
};

/** One ember slot's offset from its source, by theme: rising, drifting or clustered close by. */
export function emberOffset(theme: FlameTheme, t: number, phase: number, slot: number) {
  if (theme === 'ruins') {
    // Rising embers: a quick, wide-scattered climb.
    const rise = (t * 0.6 + slot / 6 + phase) % 1;
    return {
      dx: Math.sin(t * 1.6 + slot * 5 + phase * 6) * rise * 0.32,
      dy: -0.28 + rise * 1.7,
      dz: Math.cos(t * 1.1 + slot * 4) * rise * 0.28,
    };
  }
  if (theme === 'keep') {
    // Slow vertical drift, close to the body.
    const rise = (t * 0.22 + slot / 6 + phase) % 1;
    return {
      dx: Math.sin(t * 0.5 + slot * 3 + phase * 6) * 0.07,
      dy: -0.22 + rise * 1.1,
      dz: Math.cos(t * 0.4 + slot * 3) * 0.07,
    };
  }
  // flooded: short local motes. Half the slots stay tight to the source, which is what
  // "fewer visible flooded motes" means here — no slot is skipped, no draw call is added.
  const rise = (t * 0.3 + slot / 6 + phase) % 1;
  const tight = slot < 3 ? 1 : 0.35;
  return {
    dx: Math.sin(t * 0.8 + slot * 4 + phase * 6) * 0.05 * tight,
    dy: -0.16 + rise * 0.4,
    dz: Math.cos(t * 0.7 + slot * 3) * 0.05 * tight,
  };
}
