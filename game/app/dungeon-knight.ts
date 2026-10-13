// The player figure, as a part list (plan 012 Stage B). Every cloth panel, joint and strap is a named
// entry here, findable and editable without reading a builder function. The file and `makeKnight` keep
// the knight's name because the game, the bench and the tests all call him that.
//
// Drawn to the Relic Seeker turnaround (plans/relic-seeker-turnaround.png), plan 030: an unarmoured explorer about
// seven heads tall, his legs half his height, so any arm the armoury hands him reads as his rather than as a class. A
// thick ochre cowl wound up to his jaw with a hood bunched behind the neck, an ochre poncho falling from broad shoulders
// to four points (front, back and a long one at each side, behind the arm) with a cream edge and a cream zigzag band
// inset from it, a bare head under tousled, spiky dark-brown hair, a dark strap crossing the front to a satchel at his
// right hip, and a small turquoise bead with a gold cap on a cord from the sash at his left. Under the poncho a pale
// tunic with rolled sleeves puffed at the elbow, bare forearms in dark wrist wraps banded teal, a red-brown sash with
// its tails and a braided rope, baggy charcoal trousers ballooning at the knee and gathered into cream calf wraps with
// a teal stripe, and broad brown boots with a folded cuff and a rounded toe. He stands the height the knight stood.
//
// Two things do NOT fit the spec's narrow shape model and stay imperative: the sword pivot's weapon (built
// by makeWeapon() from the equipped WeaponId, not fixed data) and the tabard (here the tunic's front flap, the
// sash's tails and the rope), which is spec data but has to be spliced in as a kept subtree so it can turn with the
// legs. Both are spliced into the tree after buildSpec runs.
//
// Ordering note for anyone editing this file: bakeStatic merges every plain, opaque, visible mesh under a
// bake root into one mesh per material, in the order that material is FIRST met walking the tree
// depth-first. Which part contributes which vertices to a merged mesh never depends on order - a sum and
// a bounding box do not care - but WHICH material lands at baked:0 vs baked:1 does, and anything addressing
// a batch by index would notice. So: reordering parts that already share a material with something earlier in the walk is
// free; introducing a part in a NEW material earlier than before will shift every batch after it. If you
// need to reorder for real, say why in the commit.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { contactShadow } from './dungeon-characters.ts';
import { bakeStatic } from './dungeon-bake.ts';
import { makeWeapon, type ArmoryPalette, type Plate } from './dungeon-armory.ts';
import { STARTING_WEAPON } from './dungeon-weapon.ts';
import { buildSpec, type Node, type Part, type V3 } from './dungeon-figure-spec.ts';
import { HEM_MAX, type Tunic } from './dungeon-cloth.ts';

const roundedUnitBox = () => new RoundedBoxGeometry(1, 1, 1, 1, .08);
// A fixed hash in [0, 1), never Math.random: the cached-rebuild fingerprint needs the same figure every build.
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** One ring of a loft: its height, its half-widths across (x) and front to back (z), and its centre's offset. */
type Ring = [y: number, rx: number, rz: number, cx?: number, cz?: number];
/** A faceted tube through `rings` (ascending or not), `sides` round, capped at either end unless told otherwise.
 *  `jitter` moves each vertex in or out by up to that share of its radius, so a sleeve or a trouser leg reads as
 *  crumpled cloth under flat shading rather than as a turned post. `arc` leaves the tube open: [start, length] in
 *  radians from his back (+z) towards his right (+x), as the lathes below count; `turn` starts a closed one's facets
 *  that far round (half a facet gives a flat top and bottom). */
function loft(rings: Ring[], sides: number, { caps = [true, true], jitter = 0, seed = 0, arc, turn = 0 }: { caps?: [boolean, boolean]; jitter?: number; seed?: number; arc?: [number, number]; turn?: number } = {}) {
  const positions: number[] = [], index: number[] = [], open = !!arc, around = open ? sides + 1 : sides, [start, length] = arc ?? [turn, 2 * Math.PI];
  rings.forEach(([y, rx, rz, cx = 0, cz = 0], j) => {
    for (let k = 0; k < around; k++) {
      const a = start + length * k / sides, out = 1 + jitter * (2 * hash(seed * 131 + j * 17 + k) - 1);
      positions.push(cx + rx * out * Math.sin(a), y, cz + rz * out * Math.cos(a));
    }
  });
  for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k < sides; k++) {
    const a = j * around + k, b = j * around + (k + 1) % around, c = b + around, d = a + around;
    index.push(a, b, d, b, c, d);
  }
  rings.forEach(([y, , , cx = 0, cz = 0], j) => {
    if (open || !caps[j === 0 ? 0 : 1] || (j !== 0 && j !== rings.length - 1)) return;
    const centre = positions.length / 3; positions.push(cx, y, cz);
    for (let k = 0; k < sides; k++) index.push(centre, j * around + (k + 1) % around, j * around + k);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}
/** A loft laid along -z instead of up y (a boot's foot, a hand): ring heights become distances forward, and a ring's
 *  z half-width and centre become its half-height and its height. */
const loftForward = (rings: Ring[], sides: number, options?: Parameters<typeof loft>[2]) => loft(rings, sides, options).rotateX(-Math.PI / 2);
/** A part whose local +y runs from `from` to `to` (a forearm, a shard of hair): its position and Euler rotation. */
function along(from: V3, to: V3): { at: V3; rot: V3 } {
  const a = new THREE.Vector3(...from), d = new THREE.Vector3(...to).sub(a).normalize();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
  return { at: from, rot: [e.x, e.y, e.z] };
}
/** A part hanging from `from` towards `to` along its local -y (a sleeve from the shoulder to the elbow). */
const hang = (from: V3, to: V3) => along(from, [2 * from[0] - to[0], 2 * from[1] - to[1], 2 * from[2] - to[2]]);

// ---- The poncho -------------------------------------------------------------------------------------------------
/** The poncho is a lathe-shaped grid, built by hand rather than turned: COLUMNS columns round him, each one a line of
 *  RINGS points from its hem up to the neck, so the hem can hang at a different height on every column and the drape
 *  above a long point is longer, not cut off. Column i stands at i * 360 / COLUMNS degrees from his back towards +x,
 *  his right (the satchel and the sword): 0 back, 8 right, 16 front, 24 left, and a last column closes the seam on
 *  the first, as THREE.LatheGeometry lays them out, so the tests read columns the way they always have. */
const COLUMNS = 32, FACET = 2 * Math.PI / COLUMNS;
// The hem, torso-local metres against degrees from his FRONT (the same both sides), one entry per column: plan 030
// round 2 measured the sheet itself (front, profile and back views; heights as shares of his height, sole to hair):
// a shallow point at the front at .60, the sides rising to the elbow (.65) where the arms come out, a long ragged
// tail behind each arm to .465 (the profile's long back drape and the flap beside his left arm in the front view),
// and a shallow back point at .50 - with small secondary points along the side hems, the sheet's ragged step.
// Torso-local y = share x 1.822 - 1.065.
const HEM: [number, number][] = [[0, .028], [11.25, .05], [22.5, .079], [33.75, .062], [45, .101], [56.25, .076], [67.5, .116], [78.75, .11], [90, .123], [101.25, .083], [112.5, .028],
  [123.75, -.218], [135, -.099], [146.25, -.054], [157.5, -.099], [168.75, -.127], [180, -.163]];
const hemAt = (degrees: number) => { for (let i = 1; i < HEM.length; i++) if (degrees <= HEM[i]![0]) { const [a, ya] = HEM[i - 1]!, [b, yb] = HEM[i]!; return ya + (yb - ya) * (degrees - a) / (b - a); } return HEM[HEM.length - 1]![1]; };
// The shoulder line the drape falls from (half-widths across and front to back: broad and shallow, as shoulders are),
// the neck ring the yoke rises to, and how far the drape flares out per metre it falls (across) and front to back.
const BREAK_Y = .33, NECK_Y = .43, SHOULDER: [number, number] = [.305, .195], NECK: [number, number] = [.105, .095], FLARE: [number, number] = [.2, .09];
// Each column's points, hem up: seven down the drape (as shares of its length, closer at the hem where the cloth
// swings), then the yoke's middle and the neck.
const DRAPE = [0, .1, .22, .38, .56, .78, 1];
const RINGS = DRAPE.length + 2, BREAK = DRAPE.length - 1;
const columnHem = (column: number) => hemAt(Math.abs(180 - (column % COLUMNS) * 360 / COLUMNS));
function ponchoPoint(column: number, ring: number): THREE.Vector3 {
  const a = column * FACET, s = Math.sin(a), c = Math.cos(a), hem = columnHem(column), drop = BREAK_Y - hem;
  // Jitter in or out on the drape and up or down inside it, so the facets read as cloth; none on the neck ring (the
  // cowl sits on it) or on the hem's height (the tests read the points' heights off it).
  const wobble = ring < RINGS - 1 ? 1 + .028 * (2 * hash(column % COLUMNS * 7 + ring * 101) - 1) : 1, lift = ring > 0 && ring < BREAK ? .012 * (2 * hash(column % COLUMNS * 13 + ring * 7) - 1) : 0;
  if (ring <= BREAK) {
    const fall = drop * (1 - DRAPE[ring]!), y = BREAK_Y - fall + lift, flare = Math.min(fall, .42);
    return new THREE.Vector3(s * (SHOULDER[0] + FLARE[0] * flare) * wobble, y, c * (SHOULDER[1] + FLARE[1] * flare) * wobble);
  }
  // The yoke: a little proud of the straight line between the shoulder and the neck, as cloth over a shoulder is.
  const t = ring === BREAK + 1 ? .55 : 1, rx = THREE.MathUtils.lerp(SHOULDER[0], NECK[0], t) + (t < 1 ? .02 : 0), rz = THREE.MathUtils.lerp(SHOULDER[1], NECK[1], t) + (t < 1 ? .015 : 0);
  return new THREE.Vector3(s * rx * wobble, THREE.MathUtils.lerp(BREAK_Y, NECK_Y - .035 * Math.max(0, -c), t), c * rz * wobble);
}
/** The grid as one indexed mesh, column-major (COLUMNS + 1 columns of RINGS vertices each), hem first in each column. */
function gridGeometry(point: (column: number, ring: number) => THREE.Vector3, columns: number, rings: number) {
  const positions: number[] = [], index: number[] = [];
  for (let i = 0; i <= columns; i++) for (let j = 0; j < rings; j++) positions.push(...point(i, j).toArray());
  for (let i = 0; i < columns; i++) for (let j = 0; j + 1 < rings; j++) { const a = i * rings + j, b = a + rings; index.push(a, b, a + 1, b, b + 1, a + 1); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}
/** A point on the drape `up` metres above the hem at a fractional column (`u` in columns from his back), read off the
 *  grid as built (jitter included) by blending the four grid points round it, and lifted `lift` off it along the
 *  horizontal outward direction there - so a band laid through these points lies on the cloth the game draws. */
function drapeAt(u: number, up: number, lift: number) {
  const i = Math.floor(u), t = u - i, at = (column: number) => {
    const drop = BREAK_Y - columnHem(column), s = THREE.MathUtils.clamp(up / drop, 0, 1);
    let j = 0; while (j < BREAK - 1 && DRAPE[j + 1]! < s) j++;
    const f = (s - DRAPE[j]!) / (DRAPE[j + 1]! - DRAPE[j]!);
    return ponchoPoint(column, j).lerp(ponchoPoint(column, j + 1), f);
  };
  const p = at(i).lerp(at(i + 1), t), out = new THREE.Vector3(p.x, 0, p.z).normalize();
  return p.addScaledVector(out, lift);
}
// The trim, in the trim's cream: an edge band .06 deep along the hem and a zigzag band inset above it, its teeth
// running between .085 and .125 up the cloth, as the sheet draws both. One mesh, laid on the drape through drapeAt.
const EDGE = .06, ZIG: [number, number] = [.085, .125], ZIG_WIDTH = .018, TEETH = 36;
function trimGeometry() {
  const positions: number[] = [], index: number[] = [];
  const strip = (rails: [THREE.Vector3, THREE.Vector3][]) => {
    const base = positions.length / 3;
    rails.forEach(([a, b], k) => { positions.push(...a.toArray(), ...b.toArray()); if (k) { const p = base + 2 * (k - 1); index.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); } });
  };
  const samples = 4 * COLUMNS;
  strip(Array.from({ length: samples + 1 }, (_, k) => [drapeAt(k * COLUMNS / samples, -.004, .012), drapeAt(k * COLUMNS / samples, EDGE, .01)] as [THREE.Vector3, THREE.Vector3]));
  strip(Array.from({ length: 2 * TEETH + 1 }, (_, k) => { const u = k * COLUMNS / (2 * TEETH), up = ZIG[k % 2]!; return [drapeAt(u, up, .011), drapeAt(u, up + ZIG_WIDTH, .011)] as [THREE.Vector3, THREE.Vector3]; }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

// ---- The cowl and the hood ----------------------------------------------------------------------------------------
// The cowl: the same cloth bunched round the neck, a closed section swept round him whose shape changes with the
// angle - low at the front, so the throat and the tunic's collar show under the chin (dungeon-figures.test.ts holds
// the gap), up to the jaw at the sides, and highest and fullest at the back where the hood is gathered. Each section is
// [radius, height] round its loop: up the inside by the neck, over the roll's top, and down its outside in a slope that
// spreads over the shoulders onto the yoke, as the sheet's cowl does.
const COWL_COLUMNS = 24;
const COWL: Record<'front' | 'side' | 'back', [number, number][]> = {
  // Plan 030 round 2: the front a loose fold slung low across the chest (the sheet's cowl hangs in a U under the
  // throat), the sides up to the jaw, the back gathered to the base of the skull where the hood falls from it.
  front: [[.088, .37], [.092, .393], [.125, .405], [.18, .398], [.225, .362], [.235, .32], [.16, .345]],
  side: [[.088, .4], [.092, .47], [.128, .502], [.195, .48], [.25, .415], [.275, .345], [.17, .37]],
  back: [[.09, .42], [.1, .495], [.14, .53], [.21, .515], [.255, .45], [.27, .37], [.17, .39]],
};
const COWL_SECTION = COWL.side.length;
function cowlPoint(column: number, ring: number) {
  // The front's section holds for a third of the way round to the sides, so the chin has a clear notch over it.
  const a = column * 2 * Math.PI / COWL_COLUMNS, c = Math.cos(a), f = Math.pow(Math.max(0, -c), .5), b = Math.max(0, c), w = [f, 1 - f - b, b];
  const k = ring % COWL_SECTION, blend = (n: 0 | 1) => w[0]! * COWL.front[k]![n] + w[1]! * COWL.side[k]![n] + w[2]! * COWL.back[k]![n];
  // Folds: every other column in or out, and the roll's top and outside up or down a centimetre.
  const fold = k > 0 && k < COWL_SECTION - 1 ? 1 + .09 * (2 * hash(column % COWL_COLUMNS * 3 + k * 29) - 1) + (column % 2 ? .03 : -.02) : 1, r = blend(0) * (k > 1 ? fold : 1);
  return new THREE.Vector3(Math.sin(a) * r, blend(1) + (k > 1 && k < COWL_SECTION - 1 ? .012 * (2 * hash(column * 5 + k) - 1) : 0), c * r * .92);
}
/** The hood, a closed bag of cloth gathered behind the neck and hanging in a peak to his shoulder blades over the
 *  poncho's back, as the sheet's back and profile views draw it (plan 030 round 2: round 1's hood was a fan laid flat on
 *  the back and read as no hood at all). Rings down the hood, each [height, half-width, half-depth, depth of its centre
 *  behind the neck]: wide where it leaves the cowl, flat on his back, standing a few centimetres proud of the poncho. */
const HOOD: Ring[] = [[.535, .15, .05, 0, .13], [.475, .175, .07, 0, .18], [.41, .16, .07, 0, .195], [.35, .12, .055, 0, .205], [.29, .065, .035, 0, .212], [.235, .01, .01, 0, .218]];
const cowl = () => mergeGeometries([gridGeometry(cowlPoint, COWL_COLUMNS, COWL_SECTION + 1), loft(HOOD, 8, { jitter: .06, seed: 21 })])!;

// ---- The strap --------------------------------------------------------------------------------------------------
/** A flat strap through `points`, `width` across and lifted `lift` along each point's `out`. Leather is
 *  double-sided for it, so one face is enough. */
function ribbon(points: THREE.Vector3[], outs: THREE.Vector3[], width = .085, lift = .018) {
  const positions: number[] = [], index: number[] = [], last = points.length - 1;
  points.forEach((p, k) => {
    const along = points[Math.min(k + 1, last)]!.clone().sub(points[Math.max(k - 1, 0)]!).normalize();
    const across = along.clone().cross(outs[k]!).normalize().multiplyScalar(width / 2), lifted = p.clone().addScaledVector(outs[k]!, lift);
    positions.push(...lifted.clone().add(across).toArray(), ...lifted.clone().sub(across).toArray());
    if (k) { const a = 2 * k - 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}
/** The satchel's strap (the operator left the bag and strap as they were in plan 030; this only re-lays it on the new
 *  poncho): up the back from STRAP_BACK to his left shoulder at STRAP_FROM, down across his front to STRAP_TO, each
 *  point found by casting a ray at the poncho as built, so it lies on the cloth, and off the cloth straight on to the
 *  bag's joint (STRAP_BAG) in four points. */
const STRAP_FROM: [number, number] = [-.1, .39], STRAP_TO: [number, number] = [.16, -.02], STRAP_BACK: [number, number] = [.2, .02];
const STRAP_BAG = new THREE.Vector3(.36, -.15, .05);
function strap(poncho: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(poncho, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster(), points: THREE.Vector3[] = [], outs: THREE.Vector3[] = [];
  const cast = (x: number, y: number, side: 1 | -1) => {
    ray.set(new THREE.Vector3(x, y, side * 2), new THREE.Vector3(0, 0, -side));
    const hit = ray.intersectObject(mesh)[0];
    if (!hit) return;
    const out = new THREE.Vector3(hit.point.x, 0, hit.point.z).normalize().lerp(new THREE.Vector3(0, 1, 0), THREE.MathUtils.clamp((y - BREAK_Y) / .1, 0, .6)).normalize();
    points.push(hit.point); outs.push(out);
  };
  const steps = 14;
  for (let k = 0; k <= steps; k++) cast(THREE.MathUtils.lerp(STRAP_BACK[0], STRAP_FROM[0], k / steps), THREE.MathUtils.lerp(STRAP_BACK[1], STRAP_FROM[1], k / steps), 1);
  for (let k = 1; k <= steps; k++) cast(THREE.MathUtils.lerp(STRAP_FROM[0], STRAP_TO[0], k / steps), THREE.MathUtils.lerp(STRAP_FROM[1], STRAP_TO[1], k / steps), -1);
  const end = points[points.length - 1]!, drop = new THREE.Vector3().subVectors(STRAP_BAG, end), out = outs[outs.length - 1]!;
  for (let k = 1; k <= 4; k++) { points.push(end.clone().addScaledVector(drop, k / 4)); outs.push(out.clone()); }
  return ribbon(points, outs);
}

// ---- The head ---------------------------------------------------------------------------------------------------
/** The face: a ball cut down at the jaw, so it narrows to a chin under the cheekbones and comes forward at the chin
 *  rather than sitting as an egg on the neck. Half-widths .085 across, .118 tall, .1 deep. */
function faceGeometry() {
  const geometry = new THREE.SphereGeometry(1, 10, 8), p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) { const t = -y; x *= 1 - .42 * t; z *= 1 - .2 * t; if (z < 0) z -= .12 * t * t; y *= 1 + .08 * t; }
    // The brow and the cheekbones a little forward, the back of the skull a little fuller.
    if (z < 0 && y > -.1 && y < .45) z -= .04;
    if (z > 0) z *= 1.06;
    p.setXYZ(i, x * .085, y * .118, z * .1);
  }
  geometry.computeVertexNormals();
  return geometry;
}
// The hair: a cap over the skull and the back of the head, and locks standing out of it - plan 030 round 2 redrew them
// off the sheet's tousled mop (round 1's seventeen shards swept up and back read as a pinecone or a helmet): long flat
// locks, .4 to .6 of the head's length, splaying out and falling from the crown, the top ones swept forward and to the
// sides, layered points falling over the nape, strands over the ears and pointed fringe locks over the brow. Each lock
// is a flattened four-sided cone [azimuth from his front towards his right (degrees), elevation on the skull (degrees),
// length, width, how far it falls (0 straight out from the skull, 1 straight down), how far it sweeps forward, and
// whether it is one of the few lighter tips]. Head-local metres; the skull's centre is FACE_Y.
const FACE_Y = .17;
const LOCKS: [number, number, number, number, number, number, 0 | 1][] = [
  // The crown, up and swept forward and out.
  [15, 70, .1, .085, .2, .65, 0], [-30, 66, .1, .08, .25, .6, 1], [110, 64, .1, .08, .4, .25, 0], [-120, 62, .1, .08, .4, .2, 0], [175, 58, .095, .085, .5, 0, 0],
  // The upper ring, out and falling, the front ones swept forward.
  [40, 40, .11, .08, .55, .5, 0], [-45, 40, .105, .08, .55, .5, 0], [80, 36, .1, .08, .9, .3, 1], [-82, 36, .1, .08, .9, .3, 0],
  [120, 34, .105, .08, .8, .05, 0], [-120, 34, .105, .08, .8, .05, 0], [155, 32, .1, .08, .85, -.05, 0], [-155, 32, .1, .08, .85, -.05, 0],
  // The layered back and the nape, falling.
  [180, 18, .1, .085, 1.4, -.1, 0], [145, 2, .095, .07, 1.8, 0, 0], [-145, 2, .095, .07, 1.8, 0, 0], [180, -10, .085, .075, 2.2, -.1, 0],
  // Strands over the ears.
  [95, 10, .09, .055, 2.6, .3, 0], [-95, 10, .09, .055, 2.6, .3, 0],
];
// Each fringe lock [across, how far it falls, its sideways turn]: two long ones over the brow, a shorter one between.
const FRINGE: [number, number, number][] = [[-.05, .085, .5], [.01, .06, -.2], [.055, .09, -.55]];
function hairParts(): Part[] {
  const skull = new THREE.Vector3(.096, .11, .112), parts: Part[] = [];
  const onSkull = (azimuth: number, elevation: number) => { const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation); return new THREE.Vector3(Math.sin(az) * Math.cos(el) * skull.x, Math.sin(el) * skull.y + FACE_Y + .015, -Math.cos(az) * Math.cos(el) * skull.z + .012); };
  LOCKS.forEach(([azimuth, elevation, length, width, fall, sweep, tip], i) => {
    const root = onSkull(azimuth, elevation), out = root.clone().sub(new THREE.Vector3(0, FACE_Y, 0)).normalize();
    const dir = out.add(new THREE.Vector3(0, -fall, -sweep)).normalize(), centre = root.clone().addScaledVector(dir, length / 2 - .035);
    // The lock lies flat on the skull: its broad side faces out of the head, so the cone's z (its thin axis) is turned
    // to the outward direction round the lock's own line.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), z = new THREE.Vector3(0, 0, 1).applyQuaternion(q), flat = root.clone().sub(new THREE.Vector3(0, FACE_Y, 0));
    flat.addScaledVector(dir, -flat.dot(dir)).normalize();
    const turn = Math.atan2(new THREE.Vector3().crossVectors(z, flat).dot(dir), z.dot(flat)), e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromAxisAngle(dir, turn).multiply(q));
    parts.push({ name: `lock-${i}`, shape: { cone: [1, 1, 4] }, material: tip ? 'hairtip' : 'hair', at: centre.toArray() as V3, rot: [e.x, e.y, e.z], scale: [width, length, width * .45] });
  });
  // The fringe: thick flat locks from the hairline down over the brow, each its own length and turn.
  FRINGE.forEach(([x, drop, twist], i) => {
    const root: V3 = [x, FACE_Y + .1, -.085 + Math.abs(x) * .3], tip: V3 = [x * 1.2 + twist * .04, FACE_Y + .1 - drop, -.122 + Math.abs(x) * .35], { at, rot } = along(root, tip), length = Math.hypot(tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]);
    // A cone's apex is its +y, so it stands from its base at the root half its length along the line.
    parts.push({ name: `fringe-${i}`, shape: { cone: [1, 1, 4] }, material: 'hair', at: [at[0] + (tip[0] - root[0]) / 2, at[1] + (tip[1] - root[1]) / 2, at[2] + (tip[2] - root[2]) / 2], rot, scale: [.04, length, .02] });
  });
  return parts;
}

/**
 * The explorer's part tree. `tabard`, `sword-pivot` and `arm` are deliberately NOT here: they are spliced
 * onto `torso` after buildSpec runs (see makeKnight below), because bakeStatic always skips a kept subtree
 * regardless of where it sits among its siblings, so their position among the parts below cannot affect the
 * merge - only their position relative to EACH OTHER and to `cloak` and `head` (before them) does.
 *
 * Plan 030's proportions, off the sheet's front view (the sole to the top of his hair, 1.82): hair top 1.82 above the
 * sole, chin 1.56, shoulders 1.36, the sash 1.08, the elbow at the sash, the crotch .78, the knee .5, the boot's top .26.
 * His soles stand at .065 in his own frame, as the knight's did; the torso's joint is at the sash, 1.13.
 */
// The tunic the cloth deform keeps the poncho outside of (dungeon-cloth.ts), [height, radius] up the torso: the
// skirt under the body, circumradii of the cylinders below.
const TUNIC: Tunic = [[-.34, .23], [-.04, .2], [.3, .21], [.42, .12]];
const legSpec = (side: 'l' | 'r', x: number): Node => ({
  // Splayed out a few degrees, so the boots stand apart as the sheet's do while the hips stay inside the skirt. Plan 030
  // round 2: closer (the sheet's legs together are .26 of his height across, round 1's .31) and less splayed, toes forward.
  name: `hip-${side}`, at: [x, .93, 0], rot: [0, 0, x < 0 ? -.045 : .045], parts: [
    // Baggy trousers: narrow under the skirt, widening down the thigh into the knee.
    { name: `leg-${side}`, shape: { geometry: loft([[.06, .088, .093], [-.08, .1, .106], [-.2, .11, .116], [-.31, .122, .128], [-.38, .126, .13]], 7, { jitter: .05 }) }, material: 'trousers' },
    {
      name: `knee-${side}`, at: [0, -.365, 0], parts: [
        // The knee's balloon, about 1.4 times the thigh's top, bunched over the wraps and gathered in hard into them.
        { name: `shin-${side}`, shape: { geometry: loft([[.04, .126, .13], [-.03, .136, .14], [-.085, .132, .136], [-.12, .108, .11], [-.145, .078, .08], [-.16, .068, .07]], 7, { jitter: .06 }) }, material: 'trousers' },
        // Cream wraps wound shin to ankle, their turns standing proud in alternate rings.
        { name: `wrap-${side}`, shape: { geometry: loft([[-.13, .066, .07], [-.16, .063, .067], [-.175, .068, .072], [-.2, .061, .065], [-.215, .066, .07], [-.245, .06, .064]], 7, { jitter: .03 }) }, material: 'pale' },
        // The teal stripe at the top of the boot.
        { name: `stripe-${side}`, shape: { geometry: loft([[-.198, .07, .074], [-.218, .07, .074]], 7, { caps: [false, false] }) }, material: 'teal' },
        // Broad boots: a shaft, a cuff folded down over it and flared to 1.3 times the shaft, a rounded toe box
        // running straight forward, and in the darker leather a strap round the ankle and the sole.
        { name: `boot-shaft-${side}`, shape: { geometry: loft([[-.24, .078, .082], [-.33, .082, .086], [-.43, .086, .092]], 7) }, material: 'boot' },
        { name: `boot-cuff-${side}`, shape: { geometry: loft([[-.218, .1, .104], [-.235, .108, .112], [-.27, .106, .11], [-.305, .09, .094]], 8, { jitter: .07, seed: 3 }) }, material: 'boot' },
        { name: `boot-shape-${side}`, shape: { geometry: loftForward([[-.1, .062, .052, 0, .052], [-.07, .074, .064, 0, .064], [0, .08, .068, 0, .066], [.08, .082, .058, 0, .056], [.14, .079, .05, 0, .049], [.19, .068, .04, 0, .04], [.215, .044, .028, 0, .032], [.222, .012, .01, 0, .032]], 8, { turn: Math.PI / 8 }) }, material: 'boot', at: [0, -.5, -.03] },
        { name: `boot-strap-${side}`, shape: { geometry: loft([[-.352, .092, .098], [-.38, .094, .1]], 8, { caps: [false, false] }) }, material: 'leather' },
        { name: `boot-sole-${side}`, shape: { geometry: loftForward([[-.105, .064, .012, 0, .008], [.2, .07, .012, 0, .008], [.222, .046, .012, 0, .008]], 8, { turn: Math.PI / 8 }) }, material: 'leather', at: [0, -.5, -.03] },
      ],
    },
  ],
});
const KNIGHT_SPEC: Node = {
  name: 'knight',
  parts: [
    {
      // At the sash, 1.13 over his own floor: the joint the run's lean and the swing's twist turn the upper body on.
      name: 'torso', at: [0, 1.13, 0], parts: [
        // The tunic, loose and pale, from the sash to the collar, mostly under the poncho; and its skirt from the sash to
        // mid-thigh, open at the front where the tabard's flap hangs, so a striding thigh does not come through it.
        // Plan 030 round 2: its collar stops at the cowl's front (.39), under the neck, rather than standing up under the chin
        // where the round 1 critic read it from the game camera as a white beard.
        { name: 'body', shape: { geometry: loft([[-.05, .175, .145], [.08, .185, .15], [.22, .2, .155], [.32, .19, .14], [.37, .12, .1], [.39, .075, .07]], 8, { jitter: .03, seed: 9 }) }, material: 'pale' },
        { name: 'tunic-skirt', shape: { geometry: loft([[0, .19, .16], [-.12, .2, .17], [-.24, .215, .18], [-.34, .23, .19]], 10, { arc: [Math.PI + .55, 2 * Math.PI - 1.1], jitter: .04, seed: 10 }) }, material: 'pale' },
        // The sword arm's upper arm, in the tunic's sleeve, from his right shoulder to the elbow under the poncho, and
        // the sleeve rolled and puffed at the elbow where it leaves the cloth. The forearm and the hand are the sword
        // pivot's, below.
        { name: 'sleeve-r', shape: { geometry: loft([[0, .052, .052], [-.12, .05, .05], [-.24, .048, .048]], 6, { jitter: .05, seed: 11 }) }, material: 'pale', ...hang([.2, .27, 0], [.245, .03, .04]) },
        { name: 'cuff-r', shape: { geometry: loft([[.02, .058, .058], [-.01, .072, .072], [-.05, .07, .07], [-.075, .055, .055]], 7, { jitter: .08, seed: 12 }) }, material: 'pale', ...hang([.245, .05, .04], [.25, -.03, .02]) },
        {
          // Everything the cloth deform moves (plan 027 Stage B), kept out of the torso's bake so each mesh
          // keeps its own vertices: the poncho, its trim in its own paler cream so it reads as an edge and a band
          // and not as more tunic, the satchel's strap (see `strap` above) and the cowl with its hood.
          name: 'cloak', parts: [
            { name: 'poncho', shape: { geometry: gridGeometry(ponchoPoint, COLUMNS, RINGS) }, material: 'ochre' },
            { name: 'poncho-trim', shape: { geometry: trimGeometry() }, material: 'trim' },
            { name: 'cowl', shape: { geometry: cowl() }, material: 'cowl' },
          ],
        },
        {
          // Bare: a warm face under tousled, spiky hair, on a neck that turns. Its joint is the neck's base.
          name: 'head', at: [0, .43, 0], parts: [
            { name: 'neck', shape: { geometry: loft([[-.06, .055, .055], [.1, .045, .048]], 6) }, material: 'skin' },
            {
              // Plan 030 round 2: the skull tipped back a little (8 degrees) on the neck, chin up, so the face catches the
              // light from the game's high camera rather than hiding under the hair; baked into the head with the rest.
              name: 'skull', rot: [.14, 0, 0], parts: [
                { name: 'face', shape: { geometry: faceGeometry() }, material: 'skin', at: [0, FACE_Y, 0] },
                { name: 'nose', shape: { cone: [1, 1, 3] }, material: 'skin', at: [0, .155, -.103], rot: [-1.85, 0, 0], scale: [.016, .04, .016] },
                { name: 'ear-l', shape: { sphere: [1, 5, 4] }, material: 'skin', at: [-.086, .16, .012], scale: [.016, .028, .02] },
                { name: 'ear-r', shape: { sphere: [1, 5, 4] }, material: 'skin', at: [.086, .16, .012], scale: [.016, .028, .02] },
                // Small dark eyes tucked under level brows, and no mouth: the round 1 critic read the dark marks across the
                // middle of the face as a moustache from the game camera, so the face is one skin tone under a brow line.
                { name: 'eye-l', shape: { box: [.022, .011, .008] }, material: 'wrap', at: [-.034, .181, -.098], rot: [0, .2, -.06] },
                { name: 'eye-r', shape: { box: [.022, .011, .008] }, material: 'wrap', at: [.034, .181, -.098], rot: [0, -.2, .06] },
                { name: 'brow-l', shape: { box: [.04, .012, .016] }, material: 'hair', at: [-.036, .198, -.099], rot: [0, .2, .1] },
                { name: 'brow-r', shape: { box: [.04, .012, .016] }, material: 'hair', at: [.036, .198, -.099], rot: [0, -.2, -.1] },
                // The cap: over the crown and the back of the skull, its front edge the hairline above the brow.
                { name: 'hair', shape: { geometry: new THREE.SphereGeometry(1, 9, 6) }, material: 'hair', at: [0, FACE_Y + .05, .022], scale: [.102, .1, .116] },
                { name: 'hair-back', shape: { geometry: new THREE.SphereGeometry(1, 8, 5) }, material: 'hair', at: [0, FACE_Y - .02, .045], scale: [.092, .09, .085] },
                ...hairParts(),
              ],
            },
          ],
        },
        // The sash, wound round the waist, its knot at his left front where the relic hangs.
        { name: 'sash', shape: { geometry: loft([[-.065, .195, .165], [-.03, .21, .178], [.02, .212, .18], [.06, .197, .166]], 12, { jitter: .04, seed: 13 }) }, material: 'red' },
        { name: 'sash-knot', shape: { dodeca: [.042] }, material: 'red', at: [-.14, -.01, -.15], scale: [1, .8, .7] },
        // The relic, the one cool and the one bright thing on him: a small faceted bead on a two-piece cord from the
        // knot, under a gold cap, with a brass bead and a red tassel below - at his left front, outside the tunic
        // flap's edge (x .123), which would cover it from the front and swing over it with every stride.
        { name: 'relic-cord', shape: { box: [.012, .045, .012] }, material: 'leather', at: [-.16, -.05, -.15], rot: [0, 0, .15] },
        { name: 'relic-cord-2', shape: { box: [.012, .04, .012] }, material: 'leather', at: [-.168, -.09, -.152], rot: [0, 0, -.1] },
        { name: 'relic-cap', shape: { cylinder: [.012, .024, .024, 6] }, material: 'brass', at: [-.17, -.118, -.152] },
        { name: 'relic', shape: { dodeca: [.045] }, material: 'relic', at: [-.17, -.16, -.152] },
        { name: 'relic-bead', shape: { dodeca: [.013] }, material: 'brass', at: [-.17, -.212, -.152] },
        { name: 'relic-tassel', shape: { cone: [.016, .06, 5] }, material: 'red', at: [-.17, -.25, -.152], rot: [Math.PI, 0, 0] },
        // The satchel on his right hip: it hangs from the strap's end (STRAP_BAG), the joint the game swings it on
        // (plan 027), so the strap and the bag never part; flap and buckle in the bag's frame.
        {
          name: 'satchel', at: [STRAP_BAG.x, STRAP_BAG.y, STRAP_BAG.z], parts: [{
            name: 'satchel-body', at: [0, -.12, 0], rot: [0, 0, .06], parts: [
              { name: 'satchel-bag', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [0, 0, 0], scale: [.15, .24, .28] },
              { name: 'satchel-flap', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [.012, .07, 0], scale: [.17, .12, .3] },
              { name: 'satchel-buckle', shape: { box: [.03, .07, .06] }, material: 'brass', at: [.09, .025, 0] },
            ],
          }],
        },
      ],
    },
    legSpec('l', -.115),
    legSpec('r', .115),
  ],
};

/** The free arm, kept as its own spec so `arm`'s bakeStatic call (below) sees the same part order: the tunic's
 *  sleeve and its rolled, puffed cuff at the elbow, then (plan 027) an elbow joint carrying a bare forearm, a dark
 *  wrist wrap with two teal bands and a hand. Its pivot is the left shoulder under the poncho's shoulder line; it hangs
 *  a few degrees out from his side, as the sheet's arms do. The elbow flexes forward (positive x) from straight. */
const ARM_SPEC: Node = {
  // Plan 030 round 2: hung out from his side as the sheet's arms are (about 13 degrees, and a little more from the
  // elbow), so the rolled sleeve and the bare forearm come out at the poncho's edge instead of under it.
  name: 'arm', at: [-.21, .27, 0], rot: [0, 0, -.19], parts: [
    { name: 'sleeve', shape: { geometry: loft([[0, .054, .054], [-.12, .052, .052], [-.21, .05, .05]], 6, { jitter: .05, seed: 14 }) }, material: 'pale' },
    // The roll: about 1.3 times the sleeve's width, a puffed ring of cloth round the elbow.
    { name: 'cuff', shape: { geometry: loft([[-.185, .058, .058], [-.205, .074, .072], [-.235, .076, .074], [-.265, .066, .064], [-.28, .05, .05]], 7, { jitter: .08, seed: 15 }) }, material: 'pale' },
    {
      name: 'elbow', at: [0, -.24, 0], rot: [0, 0, -.06], parts: [
        { name: 'forearm', shape: { geometry: loft([[0, .044, .046], [-.08, .042, .044], [-.15, .035, .037]], 6) }, material: 'skin' },
        { name: 'wrist-wrap', shape: { geometry: loft([[-.12, .041, .043], [-.17, .044, .046], [-.215, .038, .04]], 6, { jitter: .05, seed: 16 }) }, material: 'wrap' },
        { name: 'wrist-band', shape: { geometry: loft([[-.138, .047, .049], [-.15, .047, .049]], 6, { caps: [false, false] }) }, material: 'teal' },
        { name: 'wrist-band-2', shape: { geometry: loft([[-.185, .046, .048], [-.197, .046, .048]], 6, { caps: [false, false] }) }, material: 'teal' },
        // The hand, flat across the palm, hanging with the palm to his thigh, fingers a little curled, and the thumb.
        { name: 'hand', shape: { geometry: loft([[-.21, .025, .04], [-.25, .029, .047], [-.29, .025, .044], [-.34, .018, .03]], 6) }, material: 'skin', rot: [-.12, 0, 0] },
        { name: 'thumb', shape: { cone: [.013, .05, 4] }, material: 'skin', at: [.012, -.255, -.037], rot: [-.5, 0, .3] },
      ],
    },
  ],
};

/** Where the sword hand rests, torso-local: one constant, read here and by dungeon-game.tsx's posePlayer,
 *  which sets the pivot back to it (less the swing's reach) every frame. World 1.06 standing (the torso's 1.13, less
 *  .1, and the .03 he stands at): every arm's screen read is tuned against the hand at 1.02-1.10, so the hand stayed
 *  at that height when plan 030 raised the torso round it; it is in from his side and a little forward, where the
 *  forearm from an elbow at his side under the poncho reaches. */
export const SWORD_PIVOT = { x: .31, y: -.1, z: -.1 } as const;
// The right elbow (torso-local), where the sword forearm reaches back to, under the poncho beside the sleeve's cuff.
const SWORD_ELBOW: V3 = [.25, .0, .03];
/** The sword pivot's own forearm and hand, laid along the line from the hand back to SWORD_ELBOW (a node whose +y is
 *  that line); `armed.group` (the equipped weapon) is spliced in by makeKnight() below. */
const forearmLine = along([0, 0, 0], [SWORD_ELBOW[0] - SWORD_PIVOT.x, SWORD_ELBOW[1] - SWORD_PIVOT.y, SWORD_ELBOW[2] - SWORD_PIVOT.z]);
const SWORD_PIVOT_SPEC: Node = {
  name: 'sword-pivot', at: [SWORD_PIVOT.x, SWORD_PIVOT.y, SWORD_PIVOT.z], parts: [{
    name: 'sword-forearm', rot: forearmLine.rot, parts: [
      // The fist round the grip, then the wrist wrap with its two teal bands, then the bare forearm to the elbow.
      { name: 'glove', shape: { geometry: loft([[-.045, .036, .03], [-.01, .046, .042], [.035, .04, .036], [.05, .03, .03]], 6) }, material: 'skin' },
      { name: 'sword-wrap', shape: { geometry: loft([[.04, .036, .038], [.08, .04, .042], [.115, .038, .04]], 6, { jitter: .05, seed: 17 }) }, material: 'wrap' },
      { name: 'sword-band', shape: { geometry: loft([[.055, .042, .044], [.065, .042, .044]], 6, { caps: [false, false] }) }, material: 'teal' },
      { name: 'sword-band-2', shape: { geometry: loft([[.095, .043, .045], [.105, .043, .045]], 6, { caps: [false, false] }) }, material: 'teal' },
      { name: 'sword-sleeve', shape: { geometry: loft([[.11, .034, .036], [.17, .04, .042], [.215, .043, .045]], 6) }, material: 'skin' },
    ],
  }],
};

/** The tunic's front flap, the sash's two hanging tails and the braided rope looping across the front, on the knight's
 *  old tabard joint at the belt: the game swings it forward with whichever leg leads, which is what keeps a running
 *  thigh from coming through it. The tails hang on his left, on the relic's side, as the sheet ties them. */
const BRAID = new THREE.CatmullRomCurve3([new THREE.Vector3(-.15, .03, .005), new THREE.Vector3(-.08, -.08, -.025), new THREE.Vector3(.03, -.12, -.03), new THREE.Vector3(.12, -.07, -.02), new THREE.Vector3(.16, .02, 0)]);
const TABARD_SPEC: Node = {
  name: 'tabard', at: [0, -.045, -.175], scale: [.82, 1, 1], parts: [
    { name: 'tunic-flap', shape: { plate: { outline: [[-.15, .02], [.15, .02], [.16, -.27], [.05, -.31], [-.07, -.29], [-.16, -.26]], depth: .018 } }, material: 'pale', rot: [.08, 0, 0] },
    { name: 'sash-tail', shape: { plate: { outline: [[-.035, .02], [.035, .02], [.045, -.34], [0, -.3], [-.04, -.37]], depth: .016 } }, material: 'red', at: [-.1, 0, -.035], rot: [.1, 0, .05] },
    { name: 'sash-tail-2', shape: { plate: { outline: [[-.03, .02], [.03, .02], [.035, -.24], [0, -.21], [-.035, -.26]], depth: .016 } }, material: 'red', at: [-.03, -.01, -.04], rot: [.1, 0, -.08] },
    { name: 'braid', shape: { geometry: new THREE.TubeGeometry(BRAID, 14, .011, 3, false) }, material: 'boot', at: [0, 0, -.03] },
  ],
};

export function makeKnight() {
  // Cloth, skin and leather are all rough, matte and flat-shaded, as the sheet's low-poly facets are; only the relic
  // and the brass catch a highlight. Plan 028: the sheet's swatches were too light for the game's light (he stands in
  // his own warm fill and under the moon, and at the sheet's values more than half of his pixels came out at the top of
  // the range), so each light colour is the sheet's scaled down in linear light. Plan 030 moved the hues to the sheet's
  // (the poncho more ochre and less olive, the face less orange, the hair warmer) at the same values; the values gate
  // (art-direction.spec.ts) holds them in game light. Judge these in game frames, not on the bench: the bench is lit
  // far more softly and shows all of them darker than he is drawn.
  const pale = new THREE.MeshStandardMaterial({ color: 0x857f74, roughness: .92, side: THREE.DoubleSide, flatShading: true });
  const ochre = new THREE.MeshStandardMaterial({ color: 0x7c6320, roughness: .9, emissive: 0x1a1406, side: THREE.DoubleSide, flatShading: true });
  // The cowl a shade under the poncho, so the face has a darker band under its chin instead of the same yellow
  // running up to it. It is its own mesh already, so its own material costs no draw call.
  const cowl = new THREE.MeshStandardMaterial({ color: 0x5b4216, roughness: .92, emissive: 0x0e0a03, side: THREE.DoubleSide, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0x906a52, roughness: .8, emissive: 0x1c0d06, flatShading: true });
  const hair = new THREE.MeshStandardMaterial({ color: 0x40291c, roughness: .9, emissive: 0x140b06, flatShading: true });
  // The sheet's lighter tips (#8A5A3A against #6B4128), on a third of the shards.
  const hairtip = new THREE.MeshStandardMaterial({ color: 0x553826, roughness: .9, emissive: 0x140b06, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0x963f32, roughness: .88, emissive: 0x1a0604, side: THREE.DoubleSide, flatShading: true });
  // The swatch's dark leather (#624335, near enough): darker than the boots, so the bag and the boots read apart.
  const leather = new THREE.MeshStandardMaterial({ color: 0x5f4232, roughness: .95, emissive: 0x120a06, side: THREE.DoubleSide, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8f897d, roughness: .9, emissive: 0x16130e, side: THREE.DoubleSide, flatShading: true });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x4f5054, roughness: .95, flatShading: true });
  const boot = new THREE.MeshStandardMaterial({ color: 0x6e4530, roughness: .9, flatShading: true });
  // Plan 030: the wrist wraps' dark brown (#4A3528, also the eyes) and the sheet's teal bands (#3FA3A6), both scaled
  // down as the rest are.
  const wrap = new THREE.MeshStandardMaterial({ color: 0x3a291f, roughness: .95, flatShading: true });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2f8a8e, roughness: .7, emissive: 0x08292b, side: THREE.DoubleSide, flatShading: true });
  const relic = new THREE.MeshStandardMaterial({ color: 0x2fa0aa, roughness: .3, metalness: .2, emissive: 0x1f7a84, flatShading: true });
  // The armoury's materials. He wears none of them now except the brass, but every arm he can be
  // handed is built from them (dungeon-armory.ts), so they stay exactly as the knight's plate had them.
  // Plan 014 rounds 4, 5 and 8 tuned the metals: a metalness real steel still reads as metal at under a
  // dim environment, `envMapIntensity` raised on these alone, and no flatShading.
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0e15, roughness: 0.82 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3c4056, roughness: .38, metalness: 0.62, envMapIntensity: 1.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xffc86a, roughness: .38, metalness: .55, emissive: 0x4a2c07 });
  const shadow = new THREE.MeshStandardMaterial({ color: 0x05090c, roughness: 1 });
  // The armoury's leather is the knight's old near-black grip, darker than his satchel, so no arm changed.
  const grip = new THREE.MeshStandardMaterial({ color: 0x2c1a14, roughness: 1 });
  // A long bright blade, the palest thing he holds. Bound to the armoury's "steel" slot.
  const blade = new THREE.MeshStandardMaterial({ color: 0xdcded9, roughness: 0.2, metalness: 0.6, envMapIntensity: 1.5 });
  const plate: Plate = (outline, depth, material) => {
    const shape = new THREE.Shape(); outline.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2); return new THREE.Mesh(geometry, material);
  };
  const palette = { pale, ochre, cowl, trim, skin, hair, hairtip, red, leather, trousers, boot, wrap, teal, relic, brass };
  // Each material named after its palette key, so a test can tell the rendered cloth from the skin (plan 028).
  for (const [name, material] of Object.entries(palette)) material.name = name;

  const { root: g, byName } = buildSpec(KNIGHT_SPEC, palette);
  const torso = byName['torso'] as THREE.Group;
  const cloak = byName['cloak'] as THREE.Group, poncho = byName['poncho'] as THREE.Mesh, head = byName['head'] as THREE.Group;
  // The strap is laid on the poncho as built, so it is added after it, between the trim and the cowl as it always stood.
  const strapMesh = new THREE.Mesh(strap(poncho.geometry), leather); strapMesh.name = 'strap';
  cloak.add(strapMesh); cloak.children.splice(cloak.children.indexOf(strapMesh), 1); cloak.children.splice(2, 0, strapMesh);

  const { root: tabard } = buildSpec(TABARD_SPEC, palette);
  const armoryPalette: ArmoryPalette = { steel: blade, iron, brass, leather: grip, dark, shadow };
  const armed = makeWeapon(STARTING_WEAPON, armoryPalette, plate);
  const { root: swordPivot } = buildSpec(SWORD_PIVOT_SPEC, palette);
  swordPivot.add(armed.group);
  const { root: arm, byName: armParts } = buildSpec(ARM_SPEC, palette);
  const elbow = armParts['elbow'] as THREE.Group; arm.userData.elbow = elbow;
  // Order matters here only relative to `cloak` and `head` (already built, so already before these) and to
  // each other: bakeStatic always skips a kept subtree wherever it sits among torso's other children, but the
  // kept subtrees themselves end up in the tree in the order they were added, and anything that walks
  // the tree by index follows that order.
  torso.add(tabard); torso.add(swordPivot); torso.add(arm);
  // The chin, as a bare node at the face's lowest point, so a test reads it off the built tree instead of restating
  // the spec. Added before the head's bake, like the boots' soles.
  const chinAt = new THREE.Vector3(); { const p = (byName['face'] as THREE.Mesh).geometry.getAttribute('position'); let low = 0; for (let i = 1; i < p.count; i++) if (p.getY(i) < p.getY(low)) low = i; chinAt.fromBufferAttribute(p, low); }
  const chin = new THREE.Object3D(); chin.name = 'chin'; chin.position.set(chinAt.x, FACE_Y + chinAt.y, chinAt.z); (byName['skull'] as THREE.Group).add(chin);

  const legs = [byName['hip-l'] as THREE.Group, byName['hip-r'] as THREE.Group];
  for (const hip of legs) { hip.userData.knee = byName[`knee-${hip === legs[0] ? 'l' : 'r'}`]; hip.userData.boot = byName[`boot-shape-${hip === legs[0] ? 'l' : 'r'}`]; }
  g.userData.arm = arm; g.userData.legs = legs; g.userData.cape = poncho; g.userData.cloak = cloak; g.userData.head = head; g.userData.chin = chin; g.userData.tabard = tabard; g.userData.body = torso;
  g.userData.sword = swordPivot; g.userData.torso = torso;
  g.userData.armoury = { palette: armoryPalette, plate }; g.userData.armed = armed;

  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  // The strap and the trim lie just off the poncho, close enough that their own shadow fringes them in black
  // under the key light. One more batch (the bake splits by castShadow), inside the budget.
  for (const mesh of [strapMesh, byName['poncho-trim'] as THREE.Mesh, byName['cowl'] as THREE.Mesh]) mesh.castShadow = false;
  // Plan 027 Stage B: what the game's cloth deform (dungeon-cloth.ts swayCloth) needs, kept on the cloak group.
  // Each swayed mesh's rest positions, copied once (not the cowl's: it lies above the break, weight 0 throughout);
  // the band the sway fades over, from the shoulder line (BREAK_Y) to its lowest vertex; the tunic it must stay outside
  // of; the back point's lowest vertex (column 0's hem, vertex 0), which the snapshot reads; and, for the strap, the
  // vertex its drop onto the satchel starts at (four points, two vertices each), which stays at rest so the strap's end
  // stays on the satchel's joint. Every swayed geometry's bounding sphere is grown by HEM_MAX once, so a swayed hem is
  // never culled while part of it is on screen and nothing is recomputed per frame.
  const ponchoRest = poncho.geometry.getAttribute('position');
  let bottom = Infinity; for (let i = 0; i < ponchoRest.count; i++) bottom = Math.min(bottom, ponchoRest.getY(i));
  let tip = 0; for (let i = 0; i < RINGS; i++) if (ponchoRest.getY(i) < ponchoRest.getY(tip)) tip = i;
  cloak.userData.meshes = cloak.children.filter(mesh => mesh.name !== 'cowl').map((mesh) => {
    const geometry = (mesh as THREE.Mesh).geometry; geometry.computeBoundingSphere(); geometry.boundingSphere!.radius += HEM_MAX;
    return { mesh, rest: new Float32Array(geometry.getAttribute('position').array), pinnedFrom: mesh === strapMesh ? geometry.getAttribute('position').count - 8 : Infinity };
  });
  cloak.userData.top = BREAK_Y; cloak.userData.bottom = bottom; cloak.userData.tunic = TUNIC; cloak.userData.tip = tip;
  // Plan 010: nothing between two joints moves, so every joint is folded into one mesh per material -
  // after the shadow flags, which the batches carry. The animated joints and the swapped arm are kept out. Footsteps
  // read the boot's world matrix, and the boot is about to be merged into its knee, so the reference moves first to a
  // bare node .08 over the sole (posePlayer's footfall reads .08 under it).
  for (const hip of legs) {
    const knee = hip.userData.knee as THREE.Group, sole = new THREE.Object3D();
    sole.name = 'boot'; sole.position.set(0, -.5 + .08, -.03); knee.add(sole); hip.userData.boot = sole;
  }
  // The cloak is not baked at all (the cloth deform rewrites each of its meshes' vertices) and the head is baked on
  // its own so it can turn on the neck; the satchel swings on the strap's end, so it is kept out too.
  const satchel = byName['satchel'] as THREE.Group;
  bakeStatic(torso, { keep: [cloak, head, satchel, tabard, swordPivot, arm], cacheKey: 'knight:torso' });
  bakeStatic(satchel, { cacheKey: 'knight:satchel' }); g.userData.satchel = satchel;
  bakeStatic(head, { cacheKey: 'knight:head' });
  bakeStatic(tabard, { cacheKey: 'knight:tabard' });
  bakeStatic(swordPivot, { keep: [armed.group], cacheKey: 'knight:pivot' });
  bakeStatic(arm, { keep: [elbow], cacheKey: 'knight:arm' });
  bakeStatic(elbow, { cacheKey: 'knight:elbow' });
  for (const hip of legs) { bakeStatic(hip, { keep: [hip.userData.knee as THREE.Group], cacheKey: 'knight:hip' }); bakeStatic(hip.userData.knee as THREE.Group, { cacheKey: 'knight:knee' }); }
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.62, .74));
  return g;
}
