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
// Three things do NOT fit the spec's narrow shape model and stay imperative: the cape (here the poncho's
// back point; its trim is per-vertex colour, not a material), the sword pivot's weapon (built by
// makeWeapon() from the equipped WeaponId, not fixed data) and the tabard (here the tunic's front flap and
// the sash's tail), which is spec data but has to be spliced in as a kept subtree so it can turn with the
// legs. All three are spliced into the tree after buildSpec runs.
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

/** The poncho is a lathe: one profile turned eight times, so it stays as faceted as the sheet draws it.
 *  `profile` runs hem to collar as [radius, height]. The hem is then cut uneven by `drops`, one per corner
 *  (see HEM), and each drop fades out up the cloth over HEM_FADE, so a corner pulls the panel above it
 *  down (or up) with it instead of folding the hem over the next ring. That is the pointed hem without a
 *  single extra vertex. The trim is a lathe of its own through the same fade, so it follows the hem. */
const HEM_FADE = .2, HEM_TOP = .26;
const hemDrop = (column: number, y: number, drops: number[]) => drops[column % 8]! * THREE.MathUtils.clamp(1 - (y - HEM_TOP) / HEM_FADE, 0, 1);
// The cowl's rings get drops of their own, faded in from the neck (.55) up, so a strap ending there is untouched:
// higher at the back and lower at the front, so it reads as a loose fallen hood and not a turtleneck ring.
const COWL = [-.05, -.03, 0, .015, .03, .015, 0, -.03];
const cowlDrop = (column: number, y: number) => COWL[column % 8]! * THREE.MathUtils.clamp((y - .55) / .06, 0, 1);
function ponchoLathe(profile: [number, number][], drops: number[]) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 8), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) { const column = Math.floor(i / profile.length), y = positions.getY(i); positions.setY(i, y - hemDrop(column, y, drops) - cowlDrop(column, y)); }
  geometry.computeVertexNormals();
  return geometry;
}
// Column i of the lathe stands at i * 45 degrees from his back towards +x, which is his right (the satchel
// and the sword): back, back-right, right, front-right, front, front-left, left, back-left. The front point
// reaches the sash, as the sheet draws it. The sides ride up over the arms, so the sword hand and the free
// arm come out under the hem rather than through it. The back corner stays short: the cape is the back's
// point, and a long corner there would come through it.
const HEM = [.04, .02, -.1, .02, .26, .02, -.1, .02];
// The poncho's profile, hem to the top of the cowl: a broad hem, a break at the shoulder, straight slopes
// up to the neck and a cowl standing up round it, its top a hair under the chin so the head stays clear.
// A shade narrower front to back than across, as cloth over shoulders falls.
const PONCHO: [number, number][] = [[.46, .26], [.44, .34], [.38, .44], [.3, .5], [.22, .55], [.23, .6], [.24, .645], [.17, .625]];
const PONCHO_DEPTH = .86;

/** A point on the poncho's outside at [x, height], on its front (`side` -1) or its back (1), and the outward
 *  direction there. It reads the lathe as built - the profile, the faded hem drops either side, and the
 *  flat facet between two columns - so a strap laid through these points lies on the cloth. Below the
 *  cowl only: the profile is searched while it still climbs. Approximate where it is cheap to be: the facet
 *  correction is applied to a radius lerped between two columns, and `out` ignores PONCHO_DEPTH (up to 4
 *  degrees off the true normal); both are under .01 at a .02 lift. */
function ponchoSurface(x: number, y: number, side: 1 | -1) {
  const facet = Math.PI / 4, climb = PONCHO.findIndex(([, h], i) => i > 0 && h < PONCHO[i - 1]![1]);
  const rings = climb < 0 ? PONCHO : PONCHO.slice(0, climb);
  const radiusOn = (column: number) => {
    const ys = rings.map(([, h]) => h - hemDrop(column, h, HEM));
    for (let i = 1; i < rings.length; i++) if (y <= ys[i]! || i === rings.length - 1) return rings[i - 1]![0] + (rings[i]![0] - rings[i - 1]![0]) * THREE.MathUtils.clamp((y - ys[i - 1]!) / (ys[i]! - ys[i - 1]!), 0, 1);
    return rings[0]![0];
  };
  let around = side < 0 ? Math.PI : 0;
  for (let pass = 0; pass < 3; pass++) {
    const column = Math.floor(around / facet + 8) % 8, t = around / facet - Math.floor(around / facet);
    const r = THREE.MathUtils.lerp(radiusOn(column), radiusOn(column + 1), t) * Math.cos(facet / 2) / Math.cos((t - .5) * facet);
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
const STRAP_FROM: [number, number] = [-.26, .54], STRAP_TO: [number, number] = [.26, .22], STRAP_BAG = new THREE.Vector3(.36, .06, -.12);
function strap() {
  const steps = 16, run = (side: 1 | -1) => Array.from({ length: steps + 1 }, (_, k) => ponchoSurface(THREE.MathUtils.lerp(STRAP_FROM[0], STRAP_TO[0], k / steps), THREE.MathUtils.lerp(STRAP_FROM[1], STRAP_TO[1], k / steps), side));
  const samples = [...run(1).reverse(), ...run(-1).slice(1)], points = samples.map(s => s.point), outs = samples.map(s => s.out);
  const end = points[points.length - 1]!, drop = new THREE.Vector3().subVectors(STRAP_BAG, end), out = outs[outs.length - 1]!;
  for (let k = 1; k <= 4; k++) { points.push(end.clone().addScaledVector(drop, k / 4)); outs.push(out.clone()); }
  return ribbon(points, outs);
}

/**
 * The explorer's part tree. `cape`, `tabard`, `sword-pivot` and `arm` are deliberately NOT here: they are
 * spliced onto `torso` after buildSpec runs (see makeKnight below), because bakeStatic always skips a kept
 * subtree regardless of where it sits among its siblings, so their position among the parts below cannot
 * affect the merge - only their position relative to EACH OTHER and to `head` (after) does.
 */
const KNIGHT_SPEC: Node = {
  name: 'knight',
  parts: [
    {
      // The torso's height, the sword pivot, the cape anchor and the arm are the knight's numbers, unchanged:
      // the game sets the pivot back every frame and the run pose is tuned against them.
      name: 'torso', at: [0, .76, 0], parts: [
        // The tunic, loose and pale, and its skirt below the sash to mid-thigh. Narrower than the poncho
        // at every height, so the poncho stays the broad shape.
        { name: 'body', shape: { cylinder: [.23, .28, .62, 8] }, material: 'pale', at: [0, .1, 0] },
        { name: 'tunic-skirt', shape: { cylinder: [.29, .33, .22, 8] }, material: 'pale', at: [0, -.17, 0], rot: [0, Math.PI / 8, 0] },
        // The poncho, its shape set by PONCHO and HEM above; the back's point carries on below as the cape.
        // The trim is a band a hair outside the hem, in its own paler cream, so it reads as an edge and not
        // as more tunic.
        { name: 'poncho', shape: { geometry: ponchoLathe(PONCHO, HEM) }, material: 'ochre', at: [0, 0, 0], scale: [1, 1, PONCHO_DEPTH] },
        { name: 'poncho-trim', shape: { geometry: ponchoLathe([[.47, .245], [.458, .28]], HEM) }, material: 'trim', at: [0, 0, 0], scale: [1, 1, PONCHO_DEPTH] },
        {
          // Bare: a warm face under short, tousled dark hair. The hair sits back on the skull so the face
          // shows from the front facings, and the tufts are short - no spikes standing up off the crown.
          name: 'head', at: [0, .74, 0], parts: [
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
        // The satchel's strap (see `strap` above), and the satchel on his right hip: a big bag at the side of
        // the hip rather than under the sword hand, which the camera sees as often as his front. Flap and
        // buckle in the bag's own frame.
        { name: 'strap', shape: { geometry: strap() }, material: 'leather' },
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
    // cuff. Three materials a knee, as the knight's were.
    {
      name: 'hip-l', at: [-.2, .54, 0], parts: [
        { name: 'leg-l', shape: { box: [.2, .27, .21] }, material: 'trousers', at: [0, -.12, 0] },
        {
          name: 'knee-l', at: [0, -.25, 0], parts: [
            { name: 'shin-l', shape: { box: [.21, .11, .22] }, material: 'trousers', at: [0, -.01, 0] },
            { name: 'wrap-l', shape: { box: [.15, .1, .16] }, material: 'pale', at: [0, -.09, 0] },
            { name: 'boot-shape-l', shape: { box: [.21, .13, .33] }, material: 'boot', at: [0, -.165, -.06] },
            { name: 'boot-cuff-l', shape: { box: [.2, .07, .2] }, material: 'boot', at: [0, -.1, 0] },
          ],
        },
      ],
    },
    {
      name: 'hip-r', at: [.2, .54, 0], parts: [
        { name: 'leg-r', shape: { box: [.2, .27, .21] }, material: 'trousers', at: [0, -.12, 0] },
        {
          name: 'knee-r', at: [0, -.25, 0], parts: [
            { name: 'shin-r', shape: { box: [.21, .11, .22] }, material: 'trousers', at: [0, -.01, 0] },
            { name: 'wrap-r', shape: { box: [.15, .1, .16] }, material: 'pale', at: [0, -.09, 0] },
            { name: 'boot-shape-r', shape: { box: [.21, .13, .33] }, material: 'boot', at: [0, -.165, -.06] },
            { name: 'boot-cuff-r', shape: { box: [.2, .07, .2] }, material: 'boot', at: [0, -.1, 0] },
          ],
        },
      ],
    },
  ],
};

/** The free arm, kept as its own spec so `arm`'s bakeStatic call (below) sees the same part order: the
 *  tunic's sleeve, a leather bracer and a bare hand. */
const ARM_SPEC: Node = {
  name: 'arm', at: [-.4, .34, 0], parts: [
    { name: 'sleeve', shape: { box: [.16, .28, .17] }, material: 'pale', at: [0, -.14, 0] },
    { name: 'forearm', shape: { box: [.14, .15, .26] }, material: 'leather', at: [0, -.28, -.09] },
    { name: 'fist', shape: { dodeca: [.1] }, material: 'skin', at: [0, -.28, -.24] },
  ],
};

/** The sword pivot's own trim; `armed.group` (the equipped weapon) is spliced in by makeKnight() below.
 *  dungeon-game.tsx sets this position back every frame (`sword.position.set(.44,.3,...)`): keep the two in step. */
const SWORD_PIVOT_SPEC: Node = {
  name: 'sword-pivot', at: [.44, .3, -.02], parts: [
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

/** The poncho's back point. Its trim is per-vertex colour (a pale edge), not a material choice, so it
 *  stays outside the spec format; animateCloth sways it and the game pitches it with the run. */
function buildCape() {
  // Ten by twelve, as the knight's cape was, but cut to one broad point: as wide where it is pinned as the
  // poncho's back allows (the seam's corners stay just inside it, r about .4 there), tapering to the hem,
  // where the middle hangs lowest. Below the poncho's hem it is pushed out to the hem's line, so it hangs
  // from the hem rather than from inside it. Faceted like the poncho, so it reads as the
  // same cloth coming out below the hem rather than a smoother flap hung off it.
  const geometry = new THREE.PlaneGeometry(1, 1, 10, 12), positions = geometry.getAttribute('position');
  const width = (free: number) => .3 * (1 - free * .85);
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * 2, free = .5 - positions.getY(i);
    positions.setXYZ(i, u * width(free), -free * .5 - (free > .99 ? .12 * (1 - Math.abs(u)) : 0),
      .02 * (1 - u * u) + free * .15 + (free > .36 ? (free - .36) * .2 : 0) + Math.sin(u * 9) * .02 * free);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  const colours: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const u = (i % 11) / 5 - 1, row = Math.floor(i / 11);
    const border = (Math.abs(u) > .9 && row > 5) || row === 12;
    const color = new THREE.Color(border ? 0xf0e6d2 : 0xc88b39); colours.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const cape = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, emissive: 0x1a0f04, side: THREE.DoubleSide, flatShading: true }));
  // Torso-local, like every part above: the torso group's own height is added by the tree.
  cape.position.set(0, .4, .22); cape.rotation.x = -.1;
  return cape;
}

export function makeKnight() {
  // Cloth, skin and leather are all rough and matte; only the relic and the buckle catch a highlight.
  // Colours start from the sheet's swatches and were judged on the figure bench under the game's light.
  const pale = new THREE.MeshStandardMaterial({ color: 0xe5d5be, roughness: .92, side: THREE.DoubleSide });
  const ochre = new THREE.MeshStandardMaterial({ color: 0xc88b39, roughness: .9, emissive: 0x1a0f04, side: THREE.DoubleSide, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98e6a, roughness: .8, emissive: 0x1c0d06 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x5a3f30, roughness: .9 });
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

  const cape = buildCape();
  const { root: tabard } = buildSpec(TABARD_SPEC, palette);
  const armoryPalette: ArmoryPalette = { steel: blade, iron, brass, leather: grip, dark, shadow };
  const armed = makeWeapon(STARTING_WEAPON, armoryPalette, plate);
  const { root: swordPivot } = buildSpec(SWORD_PIVOT_SPEC, palette);
  swordPivot.add(armed.group);
  const { root: arm } = buildSpec(ARM_SPEC, palette);
  // Order matters here only relative to `head` (already built, so already before these) and to each
  // other: bakeStatic always skips a kept subtree wherever it sits among torso's other children, but the
  // kept subtrees themselves end up in the tree in the order they were added, and anything that walks
  // the tree by index follows that order.
  torso.add(cape); torso.add(tabard); torso.add(swordPivot); torso.add(arm);

  const legs = [byName['hip-l'] as THREE.Group, byName['hip-r'] as THREE.Group];
  for (const hip of legs) { hip.userData.knee = byName[`knee-${hip === legs[0] ? 'l' : 'r'}`]; hip.userData.boot = byName[`boot-shape-${hip === legs[0] ? 'l' : 'r'}`]; }
  g.userData.arm = arm; g.userData.legs = legs; g.userData.cape = cape; g.userData.tabard = tabard; g.userData.body = torso;
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
  bakeStatic(torso, { keep: [cape, tabard, swordPivot, arm], cacheKey: 'knight:torso' });
  bakeStatic(tabard, { cacheKey: 'knight:tabard' });
  bakeStatic(swordPivot, { keep: [armed.group], cacheKey: 'knight:pivot' });
  bakeStatic(arm, { cacheKey: 'knight:arm' });
  for (const hip of legs) { bakeStatic(hip, { keep: [hip.userData.knee as THREE.Group], cacheKey: 'knight:hip' }); bakeStatic(hip.userData.knee as THREE.Group, { cacheKey: 'knight:knee' }); }
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.62, .74));
  return g;
}
