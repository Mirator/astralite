// The player figure, as a part list (plan 012 Stage B). Every cloth panel, joint and strap is a named
// entry here, findable and editable without reading a builder function. The file and `makeKnight` keep
// the knight's name because the game, the bench and the tests all call him that.
//
// Redrawn from the Relic Seeker turnaround (plans/relic-seeker-design.md): an unarmoured explorer, so any
// arm the armoury hands him reads as his rather than as a class. In order of what has to read from the
// game camera: an ochre poncho with a raised cowl (the broad shoulder triangle), a bare head with short
// dark hair, one dark strap crossing the front to a satchel on his right hip, and a turquoise relic on the
// sash at his left. Under the poncho, a pale tunic, a red-brown sash, charcoal trousers, pale calf wraps
// and brown boots. He stands the height the knight stood. Tassels, stitching and the trim's zigzag are
// left off: none of them survives the camera distance.
//
// Two things do NOT fit the spec's narrow shape model and stay imperative: the sword pivot's weapon (built
// by makeWeapon() from the equipped WeaponId, not fixed data) and the tabard (here the tunic's front flap and
// the sash's tail), which is spec data but has to be spliced in as a kept subtree so it can turn with the
// legs. Both are spliced into the tree after buildSpec runs. The old cape (a separate flat plane for the
// poncho's back point) is gone since plan 027: the back point is the poncho lathe's own back column.
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
import { contactShadow } from './dungeon-characters.ts';
import { bakeStatic } from './dungeon-bake.ts';
import { makeWeapon, type ArmoryPalette, type Plate } from './dungeon-armory.ts';
import { STARTING_WEAPON } from './dungeon-weapon.ts';
import { buildSpec, type Node } from './dungeon-figure-spec.ts';

const roundedUnitBox = () => new RoundedBoxGeometry(1, 1, 1, 1, .08);
const unitSpike = () => new THREE.ConeGeometry(1, 1, 4);
// Eight by five: the head's features are secondary at the game camera (the brief), and four balls at ten by
// seven were a third of his triangles.
const unitBall = () => new THREE.SphereGeometry(1, 8, 5);

/** The poncho is a lathe: one profile turned COLUMNS times, so it stays as faceted as the sheet draws it.
 *  `profile` runs hem to neck as [radius, height]. The hem is then cut uneven by `drops`, one per column
 *  (see HEM), and each drop fades out up the cloth to nothing at the shoulder break (HEM_TOP + HEM_FADE), so
 *  a point pulls the drape above it down (or a slit lifts it) without moving the yoke or the strap on it.
 *  That is the pointed hem without a single extra vertex. The trim is a lathe of its own through the same
 *  fade, so it follows the hem. Sixteen columns, not eight: the points and the arm slits need a column each
 *  with a neighbour either side, or every corner is a whole octant wide. */
const COLUMNS = 16, FACET = 2 * Math.PI / COLUMNS;
const HEM_TOP = .04, HEM_FADE = .33;
const hemDrop = (column: number, y: number, drops: number[]) => drops[column % COLUMNS]! * THREE.MathUtils.clamp(1 - (y - HEM_TOP) / HEM_FADE, 0, 1);
// Alternate columns stand a centimetre in or out, so the facets read as cloth and not as a turned cone. A
// fixed table, never Math.random: the cached-rebuild fingerprint needs the same lathe every build. Not on
// the neck ring, which the cowl sits on.
const JITTER = [0, .01, 0, -.008, 0, .006, 0, -.01, 0, .01, 0, -.006, 0, .008, 0, -.01];
// Every lathe here is a shade narrower front to back than across, as cloth over shoulders falls. Baked into
// the geometry rather than set as a node scale, so the cloak's vertices are in the torso's own metres.
const PONCHO_DEPTH = .86;
function ponchoLathe(profile: [number, number][], drops: number[], fade: (column: number, ring: number, y: number) => number = (column, _ring, y) => hemDrop(column, y, drops)) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), COLUMNS), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const column = Math.floor(i / profile.length), ring = i % profile.length, r = profile[ring]![0], out = ring < profile.length - 1 ? (r + JITTER[column % COLUMNS]!) / r : 1;
    positions.setXYZ(i, positions.getX(i) * out, positions.getY(i) - fade(column, ring, positions.getY(i)), positions.getZ(i) * out);
  }
  geometry.scale(1, 1, PONCHO_DEPTH); geometry.computeVertexNormals();
  return geometry;
}
// Column i of the lathe stands at i * 22.5 degrees from his back towards +x, which is his right (the satchel
// and the sword): 0 back, 4 right, 8 front, 12 left. One long point at the front and one a little shorter at
// the back, below the sash, as the sheet draws them; the diagonals at the elbow; and at each arm a slit
// whose hem rises almost to the shoulder break, so the sleeve and the fist come out of a side opening rather
// than through the cloth. Not quite to the break: a hem on the break would fold the drape's rings flat.
const HEM = [.17, .09, 0, -.07, -.3, -.07, 0, .1, .19, .1, 0, -.07, -.3, -.07, 0, .09];
// The poncho's profile, hem to neck: a drape falling from a shoulder break at .37 to the hem, 10 degrees
// out from vertical (straight down read as a barrel on the bench), then a flat yoke rising 24 degrees to the
// neck ring the cowl sits on. The sheet's shape: a shoulder line and a drape, not the old 40-degree lampshade.
const PONCHO: [number, number][] = [[.385, .04], [.36, .2], [.33, .37], [.25, .405], [.17, .44]];
// The cowl, a lathe of its own: a loose roll resting on the yoke, wider than the neck by a tenth, low all
// round the front half and at the sides so the chin and the throat show from the front facings, and rising
// at the back as the hood's fold. Its rings above the foot take COWL's drop (positive is down), a third of it
// on the first so that ring stays above the foot.
// The first ring lies in against the neck, closing the gap down to the tunic between the neck and the yoke.
const COWL_PROFILE: [number, number][] = [[.1, .425], [.2, .435], [.27, .46], [.265, .5], [.21, .51]];
const COWL = Array.from({ length: COLUMNS }, (_, i) => .05 - .08 * Math.max(0, Math.cos(i * FACET)));
const cowl = () => ponchoLathe(COWL_PROFILE, COWL, (column, ring) => COWL[column % COLUMNS]! * (ring < 2 ? 0 : ring === 2 ? .3 : 1));

/** A point on the poncho's outside at [x, height], on its front (`side` -1) or its back (1), and the outward
 *  direction there. It reads the lathe as built - the profile, the faded hem drops either side, the jitter
 *  and the flat facet between two columns - so a strap laid through these points lies on the cloth. Below
 *  the neck ring only. Approximate where it is cheap to be: the facet correction is applied to a radius
 *  lerped between two columns, and `out` ignores PONCHO_DEPTH (up to 4 degrees off the true normal); both
 *  are under .01 at a .02 lift. */
function ponchoSurface(x: number, y: number, side: 1 | -1) {
  const radiusOn = (column: number) => {
    const ys = PONCHO.map(([, h]) => h - hemDrop(column, h, HEM)), rs = PONCHO.map(([r], i) => i < PONCHO.length - 1 ? r + JITTER[column % COLUMNS]! : r);
    for (let i = 1; i < PONCHO.length; i++) if (y <= ys[i]! || i === PONCHO.length - 1) return ys[i]! - ys[i - 1]! < 1e-6 ? rs[i]! : rs[i - 1]! + (rs[i]! - rs[i - 1]!) * THREE.MathUtils.clamp((y - ys[i - 1]!) / (ys[i]! - ys[i - 1]!), 0, 1);
    return rs[0]!;
  };
  let around = side < 0 ? Math.PI : 0;
  for (let pass = 0; pass < 3; pass++) {
    const column = Math.floor(around / FACET + COLUMNS) % COLUMNS, t = around / FACET - Math.floor(around / FACET);
    const r = THREE.MathUtils.lerp(radiusOn(column), radiusOn(column + 1), t) * Math.cos(FACET / 2) / Math.cos((t - .5) * FACET);
    const s = Math.asin(THREE.MathUtils.clamp(x / r, -1, 1));
    around = side < 0 ? Math.PI - s : s;
    if (pass === 2) return { point: new THREE.Vector3(Math.sin(around) * r, y, Math.cos(around) * r * PONCHO_DEPTH), out: new THREE.Vector3(Math.sin(around), 0, Math.cos(around)) };
  }
  throw new Error('unreachable');
}

/** A flat strap through `points`, `width` across and lifted `lift` along each point's `out`. Leather is
 *  double-sided for it, so one face is enough. */
function ribbon(points: THREE.Vector3[], outs: THREE.Vector3[], width = .1, lift = .02) {
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

/** The satchel's strap, one ribbon: up from the back hem, over his left shoulder's ridge (where the front
 *  and back samples meet, since STRAP_FROM's x is past the lathe's radius there and both clamp to the side),
 *  down across the front to the hem at his right, through sampled surface points - a straight box over a
 *  faceted cone either stands off it at the ends or sinks into it in the middle - and off the hem straight
 *  on to the bag's top. The back run stops at the back hem. */
const STRAP_FROM: [number, number] = [-.32, .375], STRAP_TO: [number, number] = [.3, .07], STRAP_BAG = new THREE.Vector3(.36, .06, -.12);
function strap() {
  const steps = 16, run = (side: 1 | -1) => Array.from({ length: steps + 1 }, (_, k) => ponchoSurface(THREE.MathUtils.lerp(STRAP_FROM[0], STRAP_TO[0], k / steps), THREE.MathUtils.lerp(STRAP_FROM[1], STRAP_TO[1], k / steps), side));
  const samples = [...run(1).reverse(), ...run(-1).slice(1)], points = samples.map(s => s.point), outs = samples.map(s => s.out);
  const end = points[points.length - 1]!, drop = new THREE.Vector3().subVectors(STRAP_BAG, end), out = outs[outs.length - 1]!;
  for (let k = 1; k <= 4; k++) { points.push(end.clone().addScaledVector(drop, k / 4)); outs.push(out.clone()); }
  return ribbon(points, outs);
}

/**
 * The explorer's part tree. `tabard`, `sword-pivot` and `arm` are deliberately NOT here: they are spliced
 * onto `torso` after buildSpec runs (see makeKnight below), because bakeStatic always skips a kept subtree
 * regardless of where it sits among its siblings, so their position among the parts below cannot affect the
 * merge - only their position relative to EACH OTHER and to `cloak` and `head` (before them) does.
 *
 * Plan 027's proportions: the head is the knight's, at the height it stood, and everything under it was
 * re-cut round it. Legs from the sole at .06 to a hip pivot at .75 (nearly two fifths of his height against
 * a quarter: the head read small because the body under it was squat, not because it was), a shorter torso
 * between the sash and the shoulders, and a poncho no wider than .40 with its hem at the elbows.
 */
const KNIGHT_SPEC: Node = {
  name: 'knight',
  parts: [
    {
      // At the sash, .15 over the hip pivots. The head is set .60 above, so it stands exactly where the
      // knight's did (.76 + .74), and the arm and sword pivots are placed for the new shoulders below.
      name: 'torso', at: [0, .9, 0], parts: [
        // The tunic, loose and pale, from the sash to the shoulders, and its skirt below the sash over the
        // hip joints to mid-thigh. Narrower than the poncho at every height, so the poncho stays the broad
        // shape and the cloth has room to swing.
        { name: 'body', shape: { cylinder: [.2, .28, .46, 8] }, material: 'pale', at: [0, .17, 0] },
        { name: 'tunic-skirt', shape: { cylinder: [.29, .32, .24, 8] }, material: 'pale', at: [0, -.18, 0], rot: [0, Math.PI / 8, 0] },
        // The sword arm's upper sleeve, hanging at his right side under the arm slit: the sword pivot carries
        // only the glove and the forearm, and the slit would otherwise show the tunic between his shoulder
        // and his fist.
        { name: 'sleeve-r', shape: { box: [.15, .27, .16] }, material: 'pale', at: [.34, .17, .02] },
        {
          // Everything the cloth deform moves (plan 027 Stage B), kept out of the torso's bake so each mesh
          // keeps its own vertices: the poncho (its shape set by PONCHO and HEM above, the back's point now
          // its own 0-degree column), the trim a band a hair outside the hem in its own paler cream so it
          // reads as an edge and not as more tunic, the satchel's strap (see `strap` above) and the cowl.
          name: 'cloak', parts: [
            { name: 'poncho', shape: { geometry: ponchoLathe(PONCHO, HEM) }, material: 'ochre' },
            { name: 'poncho-trim', shape: { geometry: ponchoLathe([[.392, .022], [.39, .07]], HEM) }, material: 'trim' },
            { name: 'strap', shape: { geometry: strap() }, material: 'leather' },
            { name: 'cowl', shape: { geometry: cowl() }, material: 'ochre' },
          ],
        },
        {
          // Bare: a warm face under short, tousled hair. The hair sits back on the skull so the face shows
          // from the front facings, and the tufts are short - no spikes standing up off the crown.
          name: 'head', at: [0, .6, 0], parts: [
            { name: 'neck', shape: { cylinder: [.085, .1, .16, 6] }, material: 'skin', at: [0, -.08, 0] },
            { name: 'face', shape: { geometry: unitBall() }, material: 'skin', at: [0, .12, -.01], scale: [.165, .2, .18] },
            { name: 'nose', shape: { geometry: unitSpike() }, material: 'skin', at: [0, .1, -.19], rot: [-1.35, 0, 0], scale: [.03, .06, .03] },
            { name: 'ear-l', shape: { geometry: unitBall() }, material: 'skin', at: [-.165, .1, .02], scale: [.03, .05, .04] },
            { name: 'ear-r', shape: { geometry: unitBall() }, material: 'skin', at: [.165, .1, .02], scale: [.03, .05, .04] },
            { name: 'eye-l', shape: { box: [.04, .024, .02] }, material: 'hair', at: [-.065, .13, -.17] },
            { name: 'eye-r', shape: { box: [.04, .024, .02] }, material: 'hair', at: [.065, .13, -.17] },
            { name: 'hair', shape: { geometry: unitBall() }, material: 'hair', at: [0, .19, .025], scale: [.185, .16, .2] },
            { name: 'hair-back', shape: { geometry: unitBall() }, material: 'hair', at: [0, .1, .07], scale: [.17, .14, .15] },
            { name: 'fringe-l', shape: { geometry: unitSpike() }, material: 'hair', at: [-.07, .24, -.14], rot: [-2.3, 0, .35], scale: [.07, .14, .05] },
            { name: 'fringe-r', shape: { geometry: unitSpike() }, material: 'hair', at: [.06, .25, -.14], rot: [-2.2, 0, -.25], scale: [.07, .15, .05] },
            { name: 'tuft-0', shape: { geometry: unitSpike() }, material: 'hair', at: [0, .33, -.02], rot: [-.5, 0, .1], scale: [.07, .12, .07] },
            { name: 'tuft-1', shape: { geometry: unitSpike() }, material: 'hair', at: [-.09, .3, .06], rot: [.6, 0, .7], scale: [.06, .12, .06] },
            { name: 'tuft-2', shape: { geometry: unitSpike() }, material: 'hair', at: [.09, .31, .05], rot: [.5, 0, -.7], scale: [.06, .12, .06] },
            { name: 'tuft-3', shape: { geometry: unitSpike() }, material: 'hair', at: [0, .26, .17], rot: [1.5, 0, 0], scale: [.07, .12, .06] },
          ],
        },
        // The sash, wound twice round the waist, and its knot on his left where the relic hangs from it.
        { name: 'sash', shape: { torus: [.285, .055, 4, 8] }, material: 'red', at: [0, -.04, 0], rot: [Math.PI / 2, 0, 0] },
        { name: 'sash-knot', shape: { dodeca: [.065] }, material: 'red', at: [-.24, -.04, -.18] },
        // The relic, the one cool and the one bright thing on him: a turquoise bead on a short leather
        // cord, hanging off the knot at his left front, away from the bag - and outside the tunic flap's
        // edge (x .21), which would cover it from the front and swing over it with every stride.
        { name: 'relic-cord', shape: { box: [.016, .07, .016] }, material: 'leather', at: [-.28, -.09, -.2] },
        { name: 'relic', shape: { dodeca: [.08] }, material: 'relic', at: [-.29, -.17, -.21] },
        // The satchel on his right hip: a big bag at the side of the hip rather than under the sword hand,
        // which the camera sees as often as his front. Flap and buckle in the bag's own frame.
        {
          name: 'satchel', at: [.36, -.1, -.05], rot: [0, -.2, .06], parts: [
            { name: 'satchel-bag', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [0, 0, 0], scale: [.2, .3, .34] },
            { name: 'satchel-flap', shape: { geometry: roundedUnitBox() }, material: 'leather', at: [.012, .09, 0], scale: [.22, .14, .36] },
            { name: 'satchel-buckle', shape: { box: [.03, .08, .07] }, material: 'brass', at: [.115, .03, 0] },
          ],
        },
      ],
    },
    // Charcoal trousers bloused over pale wraps from shin to ankle, and broad brown boots with a turned-down
    // cuff. Three materials a knee, as the knight's were. A long thigh (.36 to the knee) and a long shin (.33
    // to the sole), set a little closer than the knight's stance, which read squat.
    {
      name: 'hip-l', at: [-.18, .75, 0], parts: [
        { name: 'leg-l', shape: { box: [.19, .38, .2] }, material: 'trousers', at: [0, -.19, 0] },
        {
          name: 'knee-l', at: [0, -.36, 0], parts: [
            { name: 'shin-l', shape: { box: [.2, .14, .21] }, material: 'trousers', at: [0, -.03, 0] },
            { name: 'wrap-l', shape: { box: [.14, .16, .15] }, material: 'pale', at: [0, -.16, 0] },
            { name: 'boot-shape-l', shape: { box: [.21, .13, .33] }, material: 'boot', at: [0, -.265, -.06] },
            { name: 'boot-cuff-l', shape: { box: [.2, .07, .2] }, material: 'boot', at: [0, -.2, 0] },
          ],
        },
      ],
    },
    {
      name: 'hip-r', at: [.18, .75, 0], parts: [
        { name: 'leg-r', shape: { box: [.19, .38, .2] }, material: 'trousers', at: [0, -.19, 0] },
        {
          name: 'knee-r', at: [0, -.36, 0], parts: [
            { name: 'shin-r', shape: { box: [.2, .14, .21] }, material: 'trousers', at: [0, -.03, 0] },
            { name: 'wrap-r', shape: { box: [.14, .16, .15] }, material: 'pale', at: [0, -.16, 0] },
            { name: 'boot-shape-r', shape: { box: [.21, .13, .33] }, material: 'boot', at: [0, -.265, -.06] },
            { name: 'boot-cuff-r', shape: { box: [.2, .07, .2] }, material: 'boot', at: [0, -.2, 0] },
          ],
        },
      ],
    },
  ],
};

/** The free arm, kept as its own spec so `arm`'s bakeStatic call (below) sees the same part order: the
 *  tunic's sleeve, a leather bracer and a bare hand. Its pivot is the left shoulder, under the yoke's break
 *  and inside the arm slit. */
const ARM_SPEC: Node = {
  name: 'arm', at: [-.34, .33, 0], parts: [
    { name: 'sleeve', shape: { box: [.16, .28, .17] }, material: 'pale', at: [0, -.14, 0] },
    { name: 'forearm', shape: { box: [.14, .15, .26] }, material: 'leather', at: [0, -.28, -.09] },
    { name: 'fist', shape: { dodeca: [.1] }, material: 'skin', at: [0, -.28, -.24] },
  ],
};

/** Where the sword hand rests, torso-local: one constant, read here and by dungeon-game.tsx's posePlayer,
 *  which sets the pivot back to it (less the swing's reach) every frame. World 1.06 standing: every arm's
 *  screen read is tuned against the hand at 1.02-1.10, so the shoulders rose round it rather than it with them. */
export const SWORD_PIVOT = { x: .44, y: .13, z: -.02 } as const;
/** The sword pivot's own trim; `armed.group` (the equipped weapon) is spliced in by makeKnight() below. */
const SWORD_PIVOT_SPEC: Node = {
  name: 'sword-pivot', at: [SWORD_PIVOT.x, SWORD_PIVOT.y, SWORD_PIVOT.z], parts: [
    { name: 'glove', shape: { dodeca: [.12] }, material: 'skin', at: [0, -.02, .03] },
    { name: 'sword-sleeve', shape: { cylinder: [.1, .08, .26, 6] }, material: 'leather', at: [-.035, -.03, .13], rot: [-.85, 0, 0] },
  ],
};

/** The tunic's front flap and the sash's hanging tail, on the knight's old tabard joint at the belt: the
 *  game swings it forward with whichever leg leads, which is what keeps a running thigh from coming
 *  through it. The tail hangs on his left, on the relic's side, as the sheet ties it. */
const TABARD_SPEC: Node = {
  name: 'tabard', at: [0, -.075, -.315], parts: [
    { name: 'tunic-flap', shape: { plate: { outline: [[-.2, .02], [.2, .02], [.21, -.26], [.06, -.3], [-.08, -.28], [-.21, -.25]], depth: .018 } }, material: 'pale', at: [0, 0, 0] },
    { name: 'sash-tail', shape: { plate: { outline: [[-.04, .02], [.04, .02], [.05, -.3], [0, -.26], [-.05, -.32]], depth: .016 } }, material: 'red', at: [-.1, 0, -.02] },
  ],
};

export function makeKnight() {
  // Cloth, skin and leather are all rough and matte; only the relic and the buckle catch a highlight.
  // Colours start from the sheet's swatches and were judged on the figure bench under the game's light.
  const pale = new THREE.MeshStandardMaterial({ color: 0xe5d5be, roughness: .92, side: THREE.DoubleSide });
  const ochre = new THREE.MeshStandardMaterial({ color: 0xc88b39, roughness: .9, emissive: 0x1a0f04, side: THREE.DoubleSide, flatShading: true });
  // Plan 027: skin a touch lighter and the hair a warmer, lighter brown with a little glow of its own, so the
  // head stands apart from the dark floors and from the cowl (both went to one dark mass at the game camera).
  const skin = new THREE.MeshStandardMaterial({ color: 0xd29a74, roughness: .8, emissive: 0x1c0d06 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x6e4a33, roughness: .9, emissive: 0x140b06 });
  const red = new THREE.MeshStandardMaterial({ color: 0x963f32, roughness: .88, emissive: 0x1a0604, side: THREE.DoubleSide });
  // Lighter than the swatch's #624335 would suggest is needed: under the game's key it is what keeps the strap
  // and the bag apart from the hair, the trousers and the sword hand, which all went to one dark mass.
  const leather = new THREE.MeshStandardMaterial({ color: 0x6a4a38, roughness: .95, emissive: 0x120a06, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: .9, emissive: 0x16130e, side: THREE.DoubleSide });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x45474a, roughness: .95 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x7a4e32, roughness: .9 });
  const relic = new THREE.MeshStandardMaterial({ color: 0x2f929b, roughness: .3, metalness: .2, emissive: 0x1f7a84 });
  // The armoury's materials. He wears none of them now except the buckle's brass, but every arm he can be
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
  const palette = { pale, ochre, trim, skin, hair, red, leather, trousers, boot, relic, brass };

  const { root: g, byName } = buildSpec(KNIGHT_SPEC, palette);
  const torso = byName['torso'] as THREE.Group;

  const { root: tabard } = buildSpec(TABARD_SPEC, palette);
  const armoryPalette: ArmoryPalette = { steel: blade, iron, brass, leather: grip, dark, shadow };
  const armed = makeWeapon(STARTING_WEAPON, armoryPalette, plate);
  const { root: swordPivot } = buildSpec(SWORD_PIVOT_SPEC, palette);
  swordPivot.add(armed.group);
  const { root: arm } = buildSpec(ARM_SPEC, palette);
  // Order matters here only relative to `cloak` and `head` (already built, so already before these) and to
  // each other: bakeStatic always skips a kept subtree wherever it sits among torso's other children, but the
  // kept subtrees themselves end up in the tree in the order they were added, and anything that walks
  // the tree by index follows that order.
  torso.add(tabard); torso.add(swordPivot); torso.add(arm);
  const cloak = byName['cloak'] as THREE.Group, poncho = byName['poncho'] as THREE.Mesh, head = byName['head'] as THREE.Group;
  // The chin, as a bare node at the face's lowest point (face centre .12 less its .2 radius), so a test reads
  // it off the built tree instead of restating the spec. Added before the head's bake, like the boots' soles.
  const chin = new THREE.Object3D(); chin.name = 'chin'; chin.position.set(0, .12 - .2, -.01); head.add(chin);

  const legs = [byName['hip-l'] as THREE.Group, byName['hip-r'] as THREE.Group];
  for (const hip of legs) { hip.userData.knee = byName[`knee-${hip === legs[0] ? 'l' : 'r'}`]; hip.userData.boot = byName[`boot-shape-${hip === legs[0] ? 'l' : 'r'}`]; }
  g.userData.arm = arm; g.userData.legs = legs; g.userData.cape = poncho; g.userData.cloak = cloak; g.userData.head = head; g.userData.chin = chin; g.userData.tabard = tabard; g.userData.body = torso;
  g.userData.sword = swordPivot; g.userData.torso = torso;
  g.userData.armoury = { palette: armoryPalette, plate }; g.userData.armed = armed;

  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  // The strap and the trim lie .02 off the poncho, close enough that their own shadow fringes them in black
  // under the key light. One more batch (the bake splits by castShadow), inside the budget.
  for (const name of ['strap', 'poncho-trim']) (byName[name] as THREE.Mesh).castShadow = false;
  // Plan 010: nothing between two joints moves, so every joint is folded into one mesh per material -
  // after the hidden pauldrons (which the bake removes) and after the shadow flags, which the batches
  // carry. The animated joints and the swapped arm are kept out. Footsteps read the boot's world matrix,
  // and the boot is about to be merged into its knee, so the reference moves first to a bare node
  // standing exactly where the boot stood.
  for (const hip of legs) {
    const boot = hip.userData.boot as THREE.Mesh, knee = hip.userData.knee as THREE.Group, sole = new THREE.Object3D();
    sole.name = 'boot'; sole.position.copy(boot.position); sole.quaternion.copy(boot.quaternion); knee.add(sole); hip.userData.boot = sole;
  }
  // Plan 027: the cloak is not baked at all (the cloth deform rewrites each of its meshes' vertices) and the
  // head is baked on its own (skin and hair, two meshes) so it can turn on the neck. Both leave the torso's
  // batches, so its batch order moved: skin and hair no longer land there at all.
  bakeStatic(torso, { keep: [cloak, head, tabard, swordPivot, arm], cacheKey: 'knight:torso' });
  bakeStatic(head, { cacheKey: 'knight:head' });
  bakeStatic(tabard, { cacheKey: 'knight:tabard' });
  bakeStatic(swordPivot, { keep: [armed.group], cacheKey: 'knight:pivot' });
  bakeStatic(arm, { cacheKey: 'knight:arm' });
  for (const hip of legs) { bakeStatic(hip, { keep: [hip.userData.knee as THREE.Group], cacheKey: 'knight:hip' }); bakeStatic(hip.userData.knee as THREE.Group, { cacheKey: 'knight:knee' }); }
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.62, .74));
  return g;
}
