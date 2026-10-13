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
 *  that far round (half a facet gives a flat top and bottom). `slope` tilts every ring, up that far on his right and
 *  down on his left, so ridged rings read as a bandage wound on the diagonal. */
function loft(rings: Ring[], sides: number, { caps = [true, true], jitter = 0, seed = 0, arc, turn = 0, slope = 0 }: { caps?: [boolean, boolean]; jitter?: number; seed?: number; arc?: [number, number]; turn?: number; slope?: number } = {}) {
  const positions: number[] = [], index: number[] = [], open = !!arc, around = open ? sides + 1 : sides, [start, length] = arc ?? [turn, 2 * Math.PI];
  rings.forEach(([y, rx, rz, cx = 0, cz = 0], j) => {
    for (let k = 0; k < around; k++) {
      const a = start + length * k / sides, out = 1 + jitter * (2 * hash(seed * 131 + j * 17 + k) - 1);
      positions.push(cx + rx * out * Math.sin(a), y + slope * Math.sin(a), cz + rz * out * Math.cos(a));
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
// round 2 measured the sheet itself (front, profile and back views; heights as shares of his height, sole to hair).
// Round 3: the critic read round 2's hem as flat (a level line at the sash), where the sheet's poncho is a strong
// diamond from every view - the sides ride high over the arms (.68) and the edge falls in a straight, steep line into
// the front point (.57) and the back point (.52), stepped by two or three ragged sub-points along each edge (each about
// .04 below the line between its notches). Laid as the front and back views see it: the edge is straight in x, so the
// height runs with the sine of the angle. The long tail behind each arm (.465) stays where round 2 measured it.
// Torso-local y = share x 1.822 - 1.065.
// Round 4: the four points clean rather than ragged (the critic: "four clearly pointed corners"), the edges straight in x
// from the notch over each arm into the front and back points with no sub-points along them; the tails behind the arms
// longer, to .435 of his height, as the sheet's outer drape measures in its front, profile and back views (.41 to .44,
// scratch ochre.py, 2026-10-13; round 2 read .465); the back point .53, as its back view draws it (round 3 .52).
const HEM: [number, number][] = [[0, -.026], [11.25, .013], [22.5, .051], [33.75, .086], [45, .116], [56.25, .141], [67.5, .16], [78.75, .171], [90, .175], [101.25, .15],
  [112.5, .05], [123.75, -.29], [135, -.06], [146.25, .045], [157.5, -.002], [168.75, -.052], [180, -.105]];
const hemAt = (degrees: number) => { for (let i = 1; i < HEM.length; i++) if (degrees <= HEM[i]![0]) { const [a, ya] = HEM[i - 1]!, [b, yb] = HEM[i]!; return ya + (yb - ya) * (degrees - a) / (b - a); } return HEM[HEM.length - 1]![1]; };
// The shoulder line the drape falls from (half-widths across and front to back: broad and shallow, as shoulders are),
// the neck ring the yoke rises to, and how far the drape flares out per metre it falls (across) and front to back.
// Round 3, off the sheet's back and profile views sliced as shares of his height (scratch chonk3.ts against sheetw.py):
// round 2's shoulders stood .353 of his height across at .75 up where the sheet's are .30, and the cape spread little
// below them (.375 at .65, the sheet .395); in profile he was .25 deep at .75 up against the sheet's .18. So narrower,
// shallower shoulders and a stronger flare across, the cape spreading over the arms as the sheet's does.
// Round 4: the head an eighth smaller took his height down and the slices with it, so the shoulders a little narrower
// again (.25, were .27) and the flare a little stronger (.45, was .4): .75 up he measured .347 across against the sheet's .304.
const BREAK_Y = .33, NECK_Y = .43, SHOULDER: [number, number] = [.25, .155], NECK: [number, number] = [.105, .085], FLARE: [number, number] = [.45, .13];
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
  // Round 3: the neck opening drops at the front, under the cowl's lowered front and its V, so the yoke never stands up
  // through the cowl there (it showed over the cowl's top as a ragged frill).
  const front = Math.max(0, -c);
  return new THREE.Vector3(s * rx * wobble, THREE.MathUtils.lerp(BREAK_Y, NECK_Y - .035 * front - .09 * front ** 3, t), c * rz * wobble);
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
// Round 3: a tooth to a column (36 before), so the zigzag's teeth sit on the hem's ragged steps rather than across them.
// Round 4: the critic read the zigzag as a wide, doubled white band that dominated the poncho; the sheet draws a thin
// cream line inset from a cream border. The zigzag half as wide and a little shallower, the edge a sixth narrower.
const EDGE = .05, ZIG: [number, number] = [.078, .112], ZIG_WIDTH = .009, TEETH = 32;
function trimGeometry() {
  const positions: number[] = [], index: number[] = [];
  const strip = (rails: [THREE.Vector3, THREE.Vector3][]) => {
    const base = positions.length / 3;
    rails.forEach(([a, b], k) => { positions.push(...a.toArray(), ...b.toArray()); if (k) { const p = base + 2 * (k - 1); index.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); } });
  };
  const samples = 4 * COLUMNS;
  strip(Array.from({ length: samples + 1 }, (_, k) => [drapeAt(k * COLUMNS / samples, -.004, .015), drapeAt(k * COLUMNS / samples, EDGE, .015)] as [THREE.Vector3, THREE.Vector3]));
  strip(Array.from({ length: 2 * TEETH + 1 }, (_, k) => { const u = k * COLUMNS / (2 * TEETH), up = ZIG[k % 2]!; return [drapeAt(u, up, .015), drapeAt(u, up + ZIG_WIDTH, .015)] as [THREE.Vector3, THREE.Vector3]; }));
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
// Round 4: the critic read round 3's roll as a fur stole - a lumpy, noisy collar wound round the neck that swallowed the jaw
// from the game camera. The sheet's cowl is smooth, loose cloth: a soft roll lying low round the neck, open at the throat,
// and two or three large folds sagging in a U onto the chest. So the roll has no noise at all, fewer and broader facets
// (24 columns), its back .05 lower with the hood, and two big folds hang in front of it (COWL_FOLDS below).
const COWL_COLUMNS = 24;
const COWL: Record<'front' | 'side' | 'back', [number, number][]> = {
  // Plan 030 round 2: the front a loose fold slung low across the chest (the sheet's cowl hangs in a U under the
  // throat), the sides up to the jaw, the back gathered to the base of the skull where the hood falls from it.
  // Round 3: lower and a third thinner, with a V at the throat (COWL_V, below).
  // Round 4: the front sags further down the chest and further out over it, the sides lie under the jaw rather than up to
  // it and the back's top is lower against the head (.07 over the neck's base, round 3's .095), so the chin and the back
  // of the neck clear it.
  front: [[.095, .315], [.1, .335], [.13, .34], [.18, .325], [.215, .285], [.22, .245], [.15, .27]],
  side: [[.085, .38], [.09, .44], [.124, .455], [.185, .432], [.232, .37], [.25, .305], [.17, .34]],
  back: [[.088, .38], [.096, .45], [.133, .478], [.19, .462], [.232, .405], [.248, .33], [.17, .355]],
};
const COWL_SECTION = COWL.side.length;
// The V at the throat (plan 030 round 3): within COWL_V[0] radians of his front the roll dips, most at the middle, by up
// to COWL_V[1] over its top and half that over its outside, so the neck and the tunic's collar show in a V under the chin
// as the sheet's close-up draws them (a 25 to 30 degree half-angle).
const COWL_V: [number, number] = [.55, .04];
function cowlPoint(column: number, ring: number) {
  // The front's section holds for a third of the way round to the sides, so the chin has a clear notch over it.
  // Round 4: eased in from the sides (a smoothstep) where round 3's square root stepped the roll down 6 cm in one column
  // just in front of each shoulder.
  const a = column * 2 * Math.PI / COWL_COLUMNS, c = Math.cos(a), e = Math.min(1, Math.max(0, -c) * 1.1), f = e * e * (3 - 2 * e), b = Math.max(0, c), w = [f, 1 - f - b, b];
  const k = ring % COWL_SECTION, blend = (n: 0 | 1) => w[0]! * COWL.front[k]![n] + w[1]! * COWL.side[k]![n] + w[2]! * COWL.back[k]![n];
  // Round 4: no per-column noise (round 3's paired folds and centimetre jitter read as fur). Two broad swells round him
  // instead, out over each shoulder, so the roll reads as a few big planes of cloth.
  const swell = k > 1 && k < COWL_SECTION - 1 ? 1 + .045 * Math.max(0, Math.sin(a) ** 2 - .3) : 1, r = blend(0) * swell;
  const v = Math.max(0, 1 - Math.abs(Math.atan2(Math.sin(a), -c)) / COWL_V[0]), dip = COWL_V[1] * v * (k <= 3 || k === COWL_SECTION - 1 ? 1 : .5);
  return new THREE.Vector3(Math.sin(a) * r, blend(1) - dip, c * r * .92);
}
// The folds sagging in a U across his chest under the roll (round 4), each a fold of the cowl's cloth swept from one
// shoulder down across the chest and up to the other: [half-span, height at the shoulders, height at its lowest, depth in
// front of the neck at the middle, how far its lip stands out from the chest, how tall it is]. Each is a lip of cloth, its
// lit top running out from the chest to the lip and its shaded underside back in, as a fold lying on him does.
const COWL_FOLDS: [number, number, number, number, number, number][] = [[.19, .335, .285, .185, .024, .05], [.21, .32, .245, .19, .022, .045]];
function cowlFold([span, top, low, depth, lip, tall]: (typeof COWL_FOLDS)[number]) {
  const along = 12, section = [[0, 0], [lip, -.35 * tall], [lip * .6, -.7 * tall], [0, -tall]] as const;
  return gridGeometry((column, ring) => {
    const t = -1 + 2 * column / along, x = span * t, sag = 1 - t * t, y = top - (top - low) * sag, z = -Math.sqrt(Math.max(0, depth * depth - x * x * .55)) - .005, out = new THREE.Vector3(x * .55, 0, z).normalize();
    const [o, down] = section[ring]!;
    return new THREE.Vector3(x, y + down, z).addScaledVector(out, o * Math.sqrt(sag));
  }, along, section.length);
}
/** The hood, a closed bag of cloth gathered behind the neck and hanging in a peak to his shoulder blades over the
 *  poncho's back, as the sheet's back and profile views draw it (plan 030 round 2: round 1's hood was a fan laid flat on
 *  the back and read as no hood at all). Rings down the hood, each [height, half-width, half-depth, depth of its centre
 *  behind the neck]: wide where it leaves the cowl, flat on his back, standing a few centimetres proud of the poncho.
 *  Round 3: it leaves the cowl lower, with the cowl's back. Round 4: it leaves the cowl .05 lower and is smooth (its jitter a third); its peak stays at the shoulder blades. */
const HOOD: Ring[] = [[.45, .145, .05, 0, .118], [.41, .175, .062, 0, .152], [.36, .162, .062, 0, .168], [.31, .12, .05, 0, .178], [.26, .065, .032, 0, .186], [.215, .01, .01, 0, .19]];
const cowl = () => mergeGeometries([gridGeometry(cowlPoint, COWL_COLUMNS, COWL_SECTION + 1), ...COWL_FOLDS.map(cowlFold), loft(HOOD, 8, { jitter: .02, seed: 21 })])!;

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
// Round 3 (the operator: the satchel may be simplified, shrunk or moved if it hides the poncho, the hands or the sash):
// further back on the hip and smaller, so from the game camera it no longer covers the sword hand and the sash.
const STRAP_BAG = new THREE.Vector3(.34, -.15, .11);
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
  const geometry = new THREE.SphereGeometry(1, 12, 9), p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Plan 030 round 3: the jaw no longer juts forward (it pushed .12 forward at the chin, and from the game's high camera
    // the critic read jaw and nose together as a snout): a soft, youthful jaw, a centimetre forward at most.
    if (y < 0) { const t = -y; x *= 1 - .42 * t; z *= 1 - .2 * t; if (z < 0) z -= .03 * t * t; y *= 1 + .08 * t; }
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
// Round 4: the head and its hair an eighth smaller on the neck (chin to crown .159 of his height in round 3, the sheet's
// .145), so he reads seven heads tall rather than the five and a half the critic counted.
const HEAD_SCALE = .92;
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
  // Round 4: the critic read the hair as kept close to the skull, where the sheet's spreads about 15% past the head's
  // outline either side: every lock round the sides and back a fifth longer and a tenth wider, and those above the ears
  // falling a fifth less, so they stand out from the head rather than lie down it. The crown's stay as they were, or the
  // head would only grow taller.
  LOCKS.forEach(([azimuth, elevation, reach, broad, drop, sweep, tip], i) => {
    const length = elevation < 55 ? reach * 1.2 : reach, width = broad * 1.1, fall = elevation > 25 ? drop * .8 : drop;
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
  // Round 4: longer, so their tips reach down over the brow as the sheet's do.
  FRINGE.forEach(([x, short, twist], i) => {
    const drop = short * 1.3;
    const root: V3 = [x, FACE_Y + .1, -.085 + Math.abs(x) * .3], tip: V3 = [x * 1.2 + twist * .04, FACE_Y + .1 - drop, -.122 + Math.abs(x) * .35], { at, rot } = along(root, tip), length = Math.hypot(tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]);
    // A cone's apex is its +y, so it stands from its base at the root half its length along the line.
    parts.push({ name: `fringe-${i}`, shape: { cone: [1, 1, 4] }, material: 'hair', at: [at[0] + (tip[0] - root[0]) / 2, at[1] + (tip[1] - root[1]) / 2, at[2] + (tip[2] - root[2]) / 2], rot, scale: [.045, length, .022] });
  });
  return parts;
}

// ---- The tunic's skirt ------------------------------------------------------------------------------------------
// Plan 030 round 3: the critic read round 2's skirt and flap as a flat apron with a hard frame, where the sheet's tunic
// wraps him and shows below the poncho to mid-thigh in uneven points. The skirt is an open grid round his sides and
// back (the flap on the tabard closes the front, so a striding thigh does not come through it), each column's hem at its
// own height, torso-local, column by column from where it opens at his front-left round his back to his front-right:
// points to .40 of his height, notches up at .45.
// Round 4 (the orchestrator: the skirt's points hid the thigh, so the legs read short): shorter at the sides and the back,
// to .45-.47 of his height at the sides and .43 behind, so the tunic is longest at the front centre (the flap), as the
// sheet's is, and the trouser leg reads from the hip.
const SKIRT_HEM = [-.28, -.3, -.25, -.22, -.26, -.24, -.29, -.31, -.28, -.24, -.26, -.22, -.25, -.29, -.3];
// Its rings' heights down from the sash (the last is the hem's), and its half-widths across and front to back at the sash
// and at .37 down, flaring between.
const SKIRT_RINGS = [0, -.12, -.24, -.37], SKIRT_TOP: [number, number] = [.18, .145], SKIRT_FLARE: [number, number] = [.235, .185];
function skirtGeometry() {
  const columns = SKIRT_HEM.length - 1, rings = SKIRT_RINGS.length, [start, length] = [Math.PI + .55, 2 * Math.PI - 1.1];
  return gridGeometry((column, ring) => {
    // Hem first in each column, then up the rings, each kept a few centimetres over the column's hem.
    const a = start + length * column / columns, hem = SKIRT_HEM[column]!, y = ring === 0 ? hem : Math.max(SKIRT_RINGS[rings - 1 - ring]!, hem + .04 * ring);
    const t = y / SKIRT_RINGS[rings - 1]!, out = 1 + .05 * (2 * hash(column * 11 + ring * 3) - 1);
    return new THREE.Vector3(Math.sin(a) * THREE.MathUtils.lerp(SKIRT_TOP[0], SKIRT_FLARE[0], t) * out, y, Math.cos(a) * THREE.MathUtils.lerp(SKIRT_TOP[1], SKIRT_FLARE[1], t) * out);
  }, columns, rings);
}
/** The tunic's front flap (on the tabard): a panel curved round his front, its hem in uneven points like the skirt's,
 *  one face thick (the tunic's cloth is double-sided), so it has no bevelled frame. [x, hem height] across, tabard-local. */
const FLAP_HEM: [number, number][] = [[-.165, -.24], [-.11, -.31], [-.055, -.26], [0, -.34], [.055, -.27], [.11, -.32], [.165, -.25]];
function flapGeometry() {
  const rows = 4;
  return gridGeometry((column, ring) => {
    const [x, hem] = FLAP_HEM[column]!, y = THREE.MathUtils.lerp(hem, .02, ring / (rows - 1));
    return new THREE.Vector3(x, y, 2.2 * x * x + .012 * (2 * hash(column * 7 + ring) - 1));
  }, FLAP_HEM.length - 1, rows);
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
  name: `hip-${side}`, at: [x, .945, 0], rot: [0, 0, x < 0 ? -.045 : .045], parts: [
    // Baggy trousers: narrow under the skirt, widening down the thigh into the knee.
    // Round 4 (the critic: pumpkin trousers, 1.3 times the hips across): baggy but falling nearly straight, a little fuller
    // down the thigh, and the thigh .015 longer (the hip joint .015 higher, the knee where it was).
    { name: `leg-${side}`, shape: { geometry: loft([[.06, .09, .095], [-.08, .1, .105], [-.2, .107, .112], [-.31, .114, .119], [-.395, .12, .125]], 7, { jitter: .05 }) }, material: 'trousers' },
    {
      name: `knee-${side}`, at: [0, -.38, 0], parts: [
        // The knee's balloon, bunched over the wraps and gathered in hard into them. Round 3: a quarter wider at the knee
        // (the critic: trousers fairly straight), about 1.75 times the thigh's top, and gathered higher, at a quarter of his
        // height, so the wrapped shin below runs a sixth of it down to the boot as the sheet's does.
        // Round 4: the critic read the balloon as pumpkin trousers with a hard dark ring where it was gathered in. The knee
        // only a little fuller than the thigh, tapering over a hand's length into a gather well under the knee (a fifth of
        // his height up, as the sheet's), so no underside faces the floor at once.
        { name: `shin-${side}`, shape: { geometry: loft([[.03, .118, .123], [-.02, .122, .127], [-.06, .119, .123], [-.1, .104, .107], [-.135, .085, .087], [-.165, .068, .07]], 8, { jitter: .05 }) }, material: 'trousers' },
        // Round 3: cream wraps wound on the diagonal from just under the knee, three turns standing proud (the critic read
        // level ridges as plaid), and one teal stripe at their top (it sat at the top of the boot).
        // Round 4: the critic read the ridges' shadowed undersides as a barber pole; the turns stand a third as proud, and the
        // one teal band sits low on the wraps over the boot's cuff, as the sheet's does.
        { name: `wrap-${side}`, shape: { geometry: loft([[-.13, .066, .069], [-.155, .064, .067], [-.163, .066, .069], [-.19, .063, .066], [-.198, .065, .068], [-.225, .062, .065], [-.233, .064, .067], [-.26, .061, .064], [-.268, .063, .066], [-.285, .06, .063]], 8, { jitter: .015, slope: .016 }) }, material: 'pale' },
        { name: `stripe-${side}`, shape: { geometry: loft([[-.228, .069, .072], [-.242, .069, .072]], 8, { caps: [false, false] }) }, material: 'teal' },
        // Round 4: the cuff's top .035 lower, at .14 of his height as the sheet's is, so the wraps show between it and the
        // trousers' gather.
        // Broad boots: a shaft, a cuff folded down over it and flared to 1.3 times the shaft, a rounded toe box
        // running straight forward, and in the darker leather a strap round the ankle and the sole.
        { name: `boot-shaft-${side}`, shape: { geometry: loft([[-.27, .078, .082], [-.35, .082, .086], [-.43, .086, .092]], 7) }, material: 'boot' },
        { name: `boot-cuff-${side}`, shape: { geometry: loft([[-.252, .1, .104], [-.268, .108, .112], [-.298, .106, .11], [-.33, .09, .094]], 8, { jitter: .07, seed: 3 }) }, material: 'leather' },
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
      // At the sash, 1.13 over his own floor (round 4: the hips .015 higher under it, for a longer thigh): the joint the run's lean and the swing's twist turn the upper body on.
      name: 'torso', at: [0, 1.15, 0], parts: [
        // The tunic, loose and pale, from the sash to the collar, mostly under the poncho; and its skirt from the sash to
        // mid-thigh, open at the front where the tabard's flap hangs, so a striding thigh does not come through it.
        // Plan 030 round 2: its collar stops at the cowl's front (.39), under the neck, rather than standing up under the chin
        // where the round 1 critic read it from the game camera as a white beard.
        // Round 3: a tenth narrower and an eighth shallower (the critic: a boxy torso).
        { name: 'body', shape: { geometry: loft([[-.05, .16, .125], [.08, .168, .128], [.22, .18, .132], [.32, .175, .122], [.37, .115, .092], [.39, .072, .066]], 8, { jitter: .03, seed: 9 }) }, material: 'pale' },
        { name: 'tunic-skirt', shape: { geometry: skirtGeometry() }, material: 'pale' },
        // The sword arm's upper arm, in the tunic's sleeve, from his right shoulder to the elbow under the poncho, and
        // the sleeve rolled and puffed at the elbow where it leaves the cloth. The forearm and the hand are the sword
        // pivot's, below.
        { name: 'sleeve-r', shape: { geometry: loft([[0, .062, .062], [-.12, .062, .062], [-.24, .058, .058]], 7, { jitter: .05, seed: 11 }) }, material: 'pale', ...hang([.2, .27, 0], [.245, .03, .04]) },
        { name: 'cuff-r', shape: { geometry: loft([[.03, .062, .062], [.02, .08, .08], [-.025, .082, .082], [-.035, .064, .064]], 8, { jitter: .06, seed: 12 }) }, material: 'pale', ...hang([.245, .05, .04], [.25, -.03, .02]) },
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
          // Plan 030 round 3: a neck a third shorter and a little thicker (the critic: "a long thin pale column"), the head
          // .025 lower on it.
          name: 'head', at: [0, .41, 0], parts: [
            // Round 4: narrower, about two thirds of the jaw across, as the sheet's (it read as wide as the jaw, a post).
            { name: 'neck', shape: { geometry: loft([[-.05, .056, .054], [.085, .047, .047]], 7) }, material: 'skin' },
            {
              // Plan 030 round 2: the skull tipped back a little (8 degrees) on the neck, chin up, so the face catches the
              // light from the game's high camera rather than hiding under the hair; baked into the head with the rest.
              name: 'skull', rot: [.14, 0, 0], scale: HEAD_SCALE, parts: [
                { name: 'face', shape: { geometry: faceGeometry() }, material: 'skin', at: [0, FACE_Y, 0] },
                // Round 3: a small nose, about a quarter of the head's depth forward of the face (it was .04 long, a beak from above).
                { name: 'nose', shape: { cone: [1, 1, 3] }, material: 'skin', at: [0, .153, -.098], rot: [-1.75, 0, 0], scale: [.015, .026, .012] },
                { name: 'ear-l', shape: { sphere: [1, 5, 4] }, material: 'skin', at: [-.086, .16, .012], scale: [.016, .028, .02] },
                { name: 'ear-r', shape: { sphere: [1, 5, 4] }, material: 'skin', at: [.086, .16, .012], scale: [.016, .028, .02] },
                // Small dark eyes tucked under level brows, and no mouth: the round 1 critic read the dark marks across the
                // middle of the face as a moustache from the game camera, so the face is one skin tone under a brow line.
                // Round 3: two separate dark marks taller than wide, set apart, and short brows angled up at their outer ends - the
                // critic read round 2's eyes and brows as one horizontal bar, a mask.
                { name: 'eye-l', shape: { box: [.011, .015, .006] }, material: 'wrap', at: [-.035, .18, -.097], rot: [0, .22, 0] },
                { name: 'eye-r', shape: { box: [.011, .015, .006] }, material: 'wrap', at: [.035, .18, -.097], rot: [0, -.22, 0] },
                { name: 'brow-l', shape: { box: [.03, .007, .012] }, material: 'hair', at: [-.038, .2, -.098], rot: [0, .22, .16] },
                { name: 'brow-r', shape: { box: [.03, .007, .012] }, material: 'hair', at: [.038, .2, -.098], rot: [0, -.22, -.16] },
                // The cap: over the crown and the back of the skull, its front edge the hairline above the brow.
                { name: 'hair', shape: { geometry: new THREE.SphereGeometry(1, 9, 6) }, material: 'hair', at: [0, FACE_Y + .05, .022], scale: [.102, .1, .116] },
                { name: 'hair-back', shape: { geometry: new THREE.SphereGeometry(1, 8, 5) }, material: 'hair', at: [0, FACE_Y - .02, .045], scale: [.092, .09, .085] },
                ...hairParts(),
              ],
            },
          ],
        },
        // The sash, wound round the waist, its knot at his left front where the relic hangs.
        { name: 'sash', shape: { geometry: loft([[-.065, .182, .148], [-.03, .196, .16], [.02, .198, .162], [.06, .184, .148]], 12, { jitter: .04, seed: 13 }) }, material: 'red' },
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
              { name: 'satchel-bag', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [0, 0, 0], scale: [.13, .2, .22] },
              { name: 'satchel-flap', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [.012, .058, 0], scale: [.15, .1, .24] },
              { name: 'satchel-buckle', shape: { box: [.03, .07, .06] }, material: 'brass', at: [.078, .02, 0] },
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
  name: 'arm', at: [-.19, .27, 0], rot: [0, 0, -.24], parts: [
    // Round 3: the critic read the sleeves as thin and the rolls as small blobs at the elbow. A full sleeve about 1.4 times
    // the forearm, and the roll a thick band (.045 tall, a third wider than the sleeve) just above the elbow.
    { name: 'sleeve', shape: { geometry: loft([[0, .062, .062], [-.12, .062, .061], [-.21, .06, .058]], 7, { jitter: .05, seed: 14 }) }, material: 'pale' },
    { name: 'cuff', shape: { geometry: loft([[-.19, .064, .062], [-.197, .08, .078], [-.235, .082, .08], [-.245, .066, .064]], 8, { jitter: .06, seed: 15 }) }, material: 'pale' },
    {
      name: 'elbow', at: [0, -.24, 0], rot: [0, 0, -.06], parts: [
        // A forearm with some mass, up into the roll so the elbow is never bare of it.
        { name: 'forearm', shape: { geometry: loft([[.035, .046, .048], [0, .048, .05], [-.08, .044, .046], [-.15, .036, .038]], 7) }, material: 'skin' },
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
/** Plan 030 round 3: the run's carry - the sword pivot (torso-local position and quaternion) with the forearm hanging
 *  from the same elbow, the hand a little behind it at his hip and the blade trailing back and down past his
 *  thigh, about 25 degrees under the level, so a running figure reads as a body and two swinging arms rather than a
 *  sword held out across him (the critic, round 2: "both arms locked holding the sword level"). The game blends the
 *  ready pose towards it while he runs (dungeon-run-pose.ts `carry`) and swings it about `elbow`. Found by turning the
 *  pivot's own frame - its forearm line back to the elbow and its blade, -z - onto the carry's: the forearm lands on its
 *  line exactly and the blade in the plane of the carry's blade, at the angle it already makes with the forearm. */
export const SWORD_CARRY = (() => {
  const forearm = new THREE.Vector3(SWORD_ELBOW[0] - SWORD_PIVOT.x, SWORD_ELBOW[1] - SWORD_PIVOT.y, SWORD_ELBOW[2] - SWORD_PIVOT.z), length = forearm.length();
  const frame = (a: THREE.Vector3, b: THREE.Vector3) => { const x = a.clone().normalize(), y = b.clone().addScaledVector(x, -b.dot(x)).normalize(); return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)); };
  // Round 4: the forearm a little straighter under the elbow (the hand less far behind it), so the blade is carried about
  // 28 degrees under the level and the run's small follow-through (dungeon-run-pose.ts `carrySwing`) never brings it up
  // past 20 degrees under it; any further down and the spear's tip meets the floor.
  const up = new THREE.Vector3(-.1, .94, -.34).normalize(), blade = new THREE.Vector3(.25, -.56, .86).normalize();
  const turn = frame(up, blade).multiply(frame(forearm, new THREE.Vector3(0, 0, -1)).transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(turn), at = new THREE.Vector3(...SWORD_ELBOW).addScaledVector(up, -length);
  return { at: at.toArray() as V3, quaternion: q.toArray() as [number, number, number, number], elbow: SWORD_ELBOW };
})();
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
    { name: 'tunic-flap', shape: { geometry: flapGeometry() }, material: 'pale', rot: [.08, 0, 0] },
    // Round 4: the tails on their own joint at the knot (the critic saw them locked to the body), which the game swings a
    // beat behind the hem (dungeon-cloth.ts stepTails). One more batch, in the sash's red.
    {
      name: 'sash-tails', at: [-.065, 0, -.038], parts: [
        { name: 'sash-tail', shape: { plate: { outline: [[-.035, .02], [.035, .02], [.045, -.34], [0, -.3], [-.04, -.37]], depth: .016 } }, material: 'red', at: [-.035, 0, .003], rot: [.1, 0, .05] },
        { name: 'sash-tail-2', shape: { plate: { outline: [[-.03, .02], [.03, .02], [.035, -.24], [0, -.21], [-.035, -.26]], depth: .016 } }, material: 'red', at: [.035, -.01, -.002], rot: [.1, 0, -.08] },
      ],
    },
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
  const ochre = new THREE.MeshStandardMaterial({ color: 0x80601c, roughness: .9, emissive: 0x1a1104, side: THREE.DoubleSide, flatShading: true });
  // Plan 030 round 3 (the critic: the poncho greenish, the sash coral, the trousers near black): the ochre redder (red over
  // green 1.33, the sheet's #C89530 is 1.34; it was 1.25) with a less yellow glow, the sash the sheet's deep brick (#8E3A2A,
  // scaled as the rest are; it was a coral), the trousers a neutral charcoal a little lighter, and the cowl closer to
  // the poncho so it reads as the same cloth bunched up rather than a separate brown collar.
  // The cowl a shade under the poncho, so the face has a darker band under its chin instead of the same yellow
  // running up to it. It is its own mesh already, so its own material costs no draw call.
  // Round 4: the poncho's ochre a shade down (the critic: the cowl the same cloth, its folds' undersides darker), still dark
  // enough under the chin for the values gate's face-over-cowl edge.
  const cowl = new THREE.MeshStandardMaterial({ color: 0x6e5019, roughness: .92, emissive: 0x0e0903, side: THREE.DoubleSide, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0x906a52, roughness: .8, emissive: 0x1c0d06, flatShading: true });
  const hair = new THREE.MeshStandardMaterial({ color: 0x40291c, roughness: .9, emissive: 0x140b06, flatShading: true });
  // The sheet's lighter tips (#8A5A3A against #6B4128), on a third of the shards.
  const hairtip = new THREE.MeshStandardMaterial({ color: 0x553826, roughness: .9, emissive: 0x140b06, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0x7e3224, roughness: .88, emissive: 0x1a0604, side: THREE.DoubleSide, flatShading: true });
  // The swatch's dark leather (#624335, near enough): darker than the boots, so the bag and the boots read apart. Round 4:
  // darker again, the boots' folded cuff as well as the soles and the bag.
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a3122, roughness: .95, emissive: 0x120a06, side: THREE.DoubleSide, flatShading: true });
  // Round 4: a warmer cream, a little nearer the ochre (the critic: the trim's contrast too loud).
  const trim = new THREE.MeshStandardMaterial({ color: 0x8b8270, roughness: .9, emissive: 0x16130e, side: THREE.DoubleSide, flatShading: true });
  // Round 4 (the critic: the trousers read olive-brown in game, the boots salmon): the charcoal a little cooler, so the
  // warm fill leaves it the sheet's neutral #4A4A4C rather than olive, and the boots a deeper, less orange brown, their
  // folded cuff in the darker leather (#5E3822 on the sheet) so the fold reads.
  const trousers = new THREE.MeshStandardMaterial({ color: 0x4c4f56, roughness: .95, flatShading: true });
  const boot = new THREE.MeshStandardMaterial({ color: 0x5f3d29, roughness: .9, flatShading: true });
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

  const { root: tabard, byName: tabardParts } = buildSpec(TABARD_SPEC, palette);
  const tails = tabardParts['sash-tails'] as THREE.Group; tabard.userData.tails = tails;
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
  bakeStatic(tabard, { keep: [tails], cacheKey: 'knight:tabard' });
  bakeStatic(tails, { cacheKey: 'knight:tails' });
  bakeStatic(swordPivot, { keep: [armed.group], cacheKey: 'knight:pivot' });
  bakeStatic(arm, { keep: [elbow], cacheKey: 'knight:arm' });
  bakeStatic(elbow, { cacheKey: 'knight:elbow' });
  for (const hip of legs) { bakeStatic(hip, { keep: [hip.userData.knee as THREE.Group], cacheKey: 'knight:hip' }); bakeStatic(hip.userData.knee as THREE.Group, { cacheKey: 'knight:knee' }); }
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.62, .74));
  return g;
}
