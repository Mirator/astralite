// The knight, as a part list (plan 012 Stage B). Every plate, joint and strap the reference code built by
// hand is a named entry here, findable and editable without reading a builder function.
//
// Two things do NOT fit the spec's narrow shape model and stay imperative, same as before: the cape (its
// cloth pattern is per-vertex colour, not a material) and the sword pivot's weapon (built by makeWeapon()
// from the equipped WeaponId, not fixed data). Both are built here exactly as the reference code built
// them and spliced into the tree after buildSpec runs.
//
// Ordering note for anyone editing this file: bakeStatic merges every plain, opaque, visible mesh under a
// bake root into one mesh per material, in the order that material is FIRST met walking the tree
// depth-first. Which part contributes which vertices to a merged mesh never depends on order - a sum and
// a bounding box do not care - but WHICH material lands at baked:0 vs baked:1 does, and the fingerprint
// records that. So: reordering parts that already share a material with something earlier in the walk is
// free; introducing a part in a NEW material earlier than before will shift every batch after it. If you
// need to reorder for real, regenerate the fixture (UPDATE_FIGURE_FINGERPRINTS=1 npm test) and say why in
// the commit, per Stage B's rule that this file may not silently drift from what ships.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { contactShadow } from './dungeon-characters.ts';
import { bakeStatic } from './dungeon-bake.ts';
import { makeWeapon, type ArmoryPalette, type Plate } from './dungeon-armory.ts';
import { STARTING_WEAPON } from './dungeon-weapon.ts';
import { buildSpec, type Node } from './dungeon-figure-spec.ts';

// Unit primitives the trim is built from, each scaled per instance via the part's own `scale` - the same
// thing dressing() used to do by baking a pose matrix into a merged geometry. A plain THREE.BoxGeometry
// bevels to nothing under about a pixel and costs nine times the triangles of the box it rounds (plan
// 010/011), so the thinnest trim stays plain and the broad plates keep the rounded edge.
const roundedUnitBox = () => new RoundedBoxGeometry(1, 1, 1, 1, .08);
const plainUnitBox = () => new THREE.BoxGeometry(1, 1, 1);
const unitJoint = () => new THREE.IcosahedronGeometry(1, 0);
const unitSpike = () => new THREE.ConeGeometry(1, 1, 4);
// The torso's cloth trim (plan 010's red bib under the pauldrons): the same outline as the reference code,
// rebuilt fresh per figure rather than shared, since nothing here needs the sharing dungeon-characters.ts
// used to do for its own cache.
function clothGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.5, .5); shape.lineTo(.5, .5); shape.lineTo(.43, -.42); shape.lineTo(.15, -.33); shape.lineTo(0, -.5); shape.lineTo(-.18, -.36); shape.lineTo(-.4, -.45); shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * The knight's part tree. Base parts (breastplate, pauldrons, body, head, belt, collar, buckle, skirts,
 * clasps, pouch) are listed first, in the order makeKnight() built them; each part's own trim (from the
 * old knightDetails()) is listed right after it, in the order knightDetails() called add() for it - this
 * is what keeps bakeStatic's batch order identical to the frozen fixture. `cape`, `sword-pivot` and `arm`
 * are deliberately NOT here: they are spliced onto `torso` after buildSpec runs (see makeKnight below),
 * because bakeStatic always skips a kept subtree regardless of where it sits among its siblings, so their
 * position among the parts below cannot affect the merge - only their position relative to EACH OTHER
 * (cape before sword-pivot before arm) and to `head` (after) does, and splicing preserves that.
 */
const KNIGHT_SPEC: Node = {
  name: 'knight',
  parts: [
    {
      name: 'torso', at: [0, .7, 0], parts: [
        {
          name: 'breastplate', shape: { plate: { outline: [[-.27, .22], [.27, .22], [.3, .08], [.22, -.22], [0, -.27], [-.22, -.22], [-.3, .08]], depth: .13 } }, material: 'iron', at: [0, .22, -.25],
          parts: [{ name: 'chest-ridge', shape: { plate: { outline: [[-.025, .18], [.025, .18], [.035, -.19], [0, -.23], [-.035, -.19]], depth: .02 } }, material: 'steel', at: [0, 0, -.085] }],
        },
        {
          name: 'pauldron-l', shape: { dodeca: [.23] }, material: 'iron', at: [-.37, .4, 0], scale: [1, .66, 1.12], hidden: true,
          parts: [{ name: 'pauldron-rim-l', shape: { dodeca: [.23] }, material: 'steel', at: [0, -.06, 0], scale: [1.08, .3, 1.04] }],
        },
        {
          name: 'pauldron-r', shape: { dodeca: [.23] }, material: 'iron', at: [.37, .4, 0], scale: [1, .66, 1.12], hidden: true,
          parts: [{ name: 'pauldron-rim-r', shape: { dodeca: [.23] }, material: 'steel', at: [0, -.06, 0], scale: [1.08, .3, 1.04] }],
        },
        { name: 'body', shape: { cylinder: [.32, .28, .63, 8] }, material: 'dark', at: [0, .11, 0] },
        {
          name: 'head', at: [0, .67, 0], scale: 1.15, parts: [
            { name: 'helmet', shape: { cylinder: [.16, .28, .39, 6] }, material: 'steel', at: [0, .045, 0], rot: [0, Math.PI / 6, 0] },
            { name: 'crown', shape: { plate: { outline: [[-.23, .16], [-.1, .29], [.035, .34], [.23, .16], [.22, .06], [-.22, .06]], depth: .23 } }, material: 'steel', at: [0, 0, .005] },
            {
              // Plan 010: the whole face tips back about the mask's own origin, so `onFace` in the old
              // knightDetails() re-based trim positions into mask-local space by subtracting the mask's
              // position. That subtraction is done once here, in the numbers below, instead of at
              // runtime: the mask sits at z=-.215, so a world z of -.263 becomes -.048 (-.263 - (-.215)).
              name: 'mask', at: [0, 0, -.215], rot: [.2, 0, 0], parts: [
                { name: 'face', shape: { plate: { outline: [[-.24, .14], [.24, .14], [.22, -.16], [.09, -.23], [-.09, -.23], [-.22, -.16]], depth: .065 } }, material: 'steel', at: [0, 0, 0] },
                {
                  name: 'visor', at: [0, 0, -.049], parts: [
                    { name: 'slit-l', shape: { box: [.175, .052, .018] }, material: 'shadow', at: [-.116, .02, 0], rot: [0, 0, -.08] },
                    { name: 'slit-r', shape: { box: [.175, .052, .018] }, material: 'shadow', at: [.116, .02, 0], rot: [0, 0, .08] },
                  ],
                },
                { name: 'nose', shape: { plate: { outline: [[-.025, .11], [.025, .11], [.035, -.18], [0, -.215], [-.035, -.18]], depth: .045 } }, material: 'steel', at: [0, 0, -.06] },
                { name: 'mouth', shape: { box: [.035, .1, .018] }, material: 'shadow', at: [0, -.13, -.042] },
                // Mask trim from knightDetails(): one brass hinge and three shadow rivets per side, added
                // side=-1 then side=1 - the exact order the dressing() Map used to register them in.
                { name: 'mask-hinge-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [-.22, -.025, -.048], rot: [0, 0, .16], scale: [.023, .19, .027] },
                { name: 'mask-rivet-l0', shape: { geometry: unitJoint() }, material: 'shadow', at: [-.085, -.095, -.042], scale: [.017, .022, .012] },
                { name: 'mask-rivet-l1', shape: { geometry: unitJoint() }, material: 'shadow', at: [-.131, -.095, -.042], scale: [.017, .022, .012] },
                { name: 'mask-rivet-l2', shape: { geometry: unitJoint() }, material: 'shadow', at: [-.177, -.095, -.042], scale: [.017, .022, .012] },
                { name: 'mask-hinge-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [.22, -.025, -.048], rot: [0, 0, -.16], scale: [.023, .19, .027] },
                { name: 'mask-rivet-r0', shape: { geometry: unitJoint() }, material: 'shadow', at: [.085, -.095, -.042], scale: [.017, .022, .012] },
                { name: 'mask-rivet-r1', shape: { geometry: unitJoint() }, material: 'shadow', at: [.131, -.095, -.042], scale: [.017, .022, .012] },
                { name: 'mask-rivet-r2', shape: { geometry: unitJoint() }, material: 'shadow', at: [.177, -.095, -.042], scale: [.017, .022, .012] },
              ],
            },
            // Head's own trim: a brass browband, then the three-cone crest (plan 010: scaled up rather
            // than multiplied, since an isometric camera spends most of its pixels on the top of the head).
            { name: 'browband', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .19, .015], rot: [.16, 0, 0], scale: [.045, .21, .36] },
            { name: 'crest-0', shape: { geometry: unitSpike() }, material: 'red', at: [0, .375, .09], rot: [.8, 0, 0], scale: [.088, .40, .105] },
            { name: 'crest-1', shape: { geometry: unitSpike() }, material: 'red', at: [0, .35, .19], rot: [.98, 0, 0], scale: [.088, .345, .105] },
            { name: 'crest-2', shape: { geometry: unitSpike() }, material: 'red', at: [0, .325, .29], rot: [1.16, 0, 0], scale: [.088, .29, .105] },
          ],
        },
        { name: 'belt', shape: { torus: [.285, .047, 4, 8] }, material: 'leather', at: [0, -.04, 0], rot: [Math.PI / 2, 0, 0] },
        { name: 'collar', shape: { torus: [.24, .075, 4, 8] }, material: 'red', at: [0, .51, 0], rot: [Math.PI / 2, 0, 0] },
        { name: 'buckle', shape: { plate: { outline: [[-.065, .055], [.065, .055], [.065, -.055], [-.065, -.055]], depth: .045 } }, material: 'brass', at: [0, -.035, -.32] },
        { name: 'skirt-l', shape: { plate: { outline: [[-.12, .12], [.12, .12], [.14, -.17], [-.1, -.2]], depth: .055 } }, material: 'leather', at: [-.19, -.17, -.14], rot: [0, 0, -.13] },
        { name: 'clasp-l', shape: { dodeca: [.048] }, material: 'brass', at: [-.2, .44, -.23] },
        { name: 'skirt-r', shape: { plate: { outline: [[-.12, .12], [.12, .12], [.14, -.17], [-.1, -.2]], depth: .055 } }, material: 'leather', at: [.19, -.17, -.14], rot: [0, 0, .13] },
        { name: 'clasp-r', shape: { dodeca: [.048] }, material: 'brass', at: [.2, .44, -.23] },
        { name: 'pouch', shape: { box: [.17, .2, .13] }, material: 'leather', at: [.3, -.09, .1] },
        // Torso's own trim from knightDetails(): a cloth bib, three iron/brass plate pairs, a gold rim, a
        // second brass strip and a leather strap, per side (side=-1 then side=1), then one brass sun clasp.
        { name: 'bib-l', shape: { geometry: clothGeometry() }, material: 'red', at: [-.145, -.2, -.235], rot: [0, 0, .06], scale: [.31, .64, 1] },
        { name: 'plate-l0', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [-.4, .5, -.01], rot: [0, 0, .16], scale: [.4, .1, .43] },
        { name: 'rivet-l0', shape: { geometry: unitJoint() }, material: 'brass', at: [-.39, .505, -.24], scale: [.028, .028, .016] },
        { name: 'plate-l1', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [-.42, .42, -.01], rot: [0, 0, .16], scale: [.375, .1, .43] },
        { name: 'rivet-l1', shape: { geometry: unitJoint() }, material: 'brass', at: [-.412, .425, -.24], scale: [.028, .028, .016] },
        { name: 'plate-l2', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [-.44, .34, -.01], rot: [0, 0, .16], scale: [.35, .1, .43] },
        { name: 'rivet-l2', shape: { geometry: unitJoint() }, material: 'brass', at: [-.434, .345, -.24], scale: [.028, .028, .016] },
        { name: 'gold-rim-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [-.405, .552, -.196], rot: [0, 0, .16], scale: [.39, .036, .075] },
        { name: 'gold-strip-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [-.19, .3, -.329], rot: [0, 0, .42], scale: [.17, .024, .018] },
        { name: 'strap-l', shape: { geometry: plainUnitBox() }, material: 'leather', at: [-.22, .18, -.337], rot: [0, 0, -.22], scale: [.048, .31, .022] },
        { name: 'bib-r', shape: { geometry: clothGeometry() }, material: 'red', at: [.145, -.2, -.235], rot: [0, 0, -.06], scale: [.31, .64, 1] },
        { name: 'plate-r0', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [.4, .5, -.01], rot: [0, 0, -.16], scale: [.4, .1, .43] },
        { name: 'rivet-r0', shape: { geometry: unitJoint() }, material: 'brass', at: [.39, .505, -.24], scale: [.028, .028, .016] },
        { name: 'plate-r1', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [.42, .42, -.01], rot: [0, 0, -.16], scale: [.375, .1, .43] },
        { name: 'rivet-r1', shape: { geometry: unitJoint() }, material: 'brass', at: [.412, .425, -.24], scale: [.028, .028, .016] },
        { name: 'plate-r2', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [.44, .34, -.01], rot: [0, 0, -.16], scale: [.35, .1, .43] },
        { name: 'rivet-r2', shape: { geometry: unitJoint() }, material: 'brass', at: [.434, .345, -.24], scale: [.028, .028, .016] },
        { name: 'gold-rim-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [.405, .552, -.196], rot: [0, 0, -.16], scale: [.39, .036, .075] },
        { name: 'gold-strip-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [.19, .3, -.329], rot: [0, 0, -.42], scale: [.17, .024, .018] },
        { name: 'strap-r', shape: { geometry: plainUnitBox() }, material: 'leather', at: [.22, .18, -.337], rot: [0, 0, .22], scale: [.048, .31, .022] },
        { name: 'sun-clasp', shape: { geometry: unitJoint() }, material: 'brass', at: [0, .28, -.355], scale: [.066, .08, .025] },
      ],
    },
    {
      name: 'hip-l', at: [-.2, .48, 0], parts: [
        { name: 'leg-l', shape: { box: [.19, .23, .2] }, material: 'dark', at: [0, -.1, 0] },
        {
          name: 'knee-l', at: [0, -.22, 0], parts: [
            { name: 'shin-l', shape: { box: [.17, .16, .18] }, material: 'dark', at: [0, -.06, 0] },
            { name: 'boot-shape-l', shape: { box: [.22, .16, .34] }, material: 'leather', at: [0, -.12, -.06] },
            { name: 'greave-l', shape: { plate: { outline: [[-.095, .08], [.095, .08], [.08, -.11], [0, -.14], [-.08, -.11]], depth: .05 } }, material: 'iron', at: [0, -.025, -.105] },
            { name: 'kneecap-l', shape: { dodeca: [.115] }, material: 'steel', at: [0, 0, -.11], scale: [.95, .8, .6] },
            { name: 'knee-plate-l', shape: { geometry: roundedUnitBox() }, material: 'steel', at: [0, -.11, -.16], scale: [.2, .075, .18] },
            { name: 'knee-rivet-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .012, -.14], scale: [.13, .024, .025] },
          ],
        },
      ],
    },
    {
      name: 'hip-r', at: [.2, .48, 0], parts: [
        { name: 'leg-r', shape: { box: [.19, .23, .2] }, material: 'dark', at: [0, -.1, 0] },
        {
          name: 'knee-r', at: [0, -.22, 0], parts: [
            { name: 'shin-r', shape: { box: [.17, .16, .18] }, material: 'dark', at: [0, -.06, 0] },
            { name: 'boot-shape-r', shape: { box: [.22, .16, .34] }, material: 'leather', at: [0, -.12, -.06] },
            { name: 'greave-r', shape: { plate: { outline: [[-.095, .08], [.095, .08], [.08, -.11], [0, -.14], [-.08, -.11]], depth: .05 } }, material: 'iron', at: [0, -.025, -.105] },
            { name: 'kneecap-r', shape: { dodeca: [.115] }, material: 'steel', at: [0, 0, -.11], scale: [.95, .8, .6] },
            { name: 'knee-plate-r', shape: { geometry: roundedUnitBox() }, material: 'steel', at: [0, -.11, -.16], scale: [.2, .075, .18] },
            { name: 'knee-rivet-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .012, -.14], scale: [.13, .024, .025] },
          ],
        },
      ],
    },
  ],
};

/** The sword arm, kept as its own spec so `arm`'s bakeStatic call (below) sees the same part order. */
const ARM_SPEC: Node = {
  name: 'arm', at: [-.4, .34, 0], parts: [
    { name: 'sleeve', shape: { box: [.17, .28, .18] }, material: 'dark', at: [0, -.14, 0] },
    { name: 'forearm', shape: { box: [.16, .17, .28] }, material: 'steel', at: [0, -.28, -.09] },
    { name: 'fist', shape: { dodeca: [.12] }, material: 'leather', at: [0, -.28, -.24] },
    { name: 'arm-plate', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [0, -.26, -.12], rot: [.12, 0, 0], scale: [.23, .2, .28] },
    { name: 'arm-rivet', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, -.19, -.22], scale: [.235, .025, .025] },
  ],
};

/** The sword pivot's own trim; `armed.group` (the equipped weapon) is spliced in by makeKnight() below.
 *  Position is the reference's [0.44, 1.0, -0.02] with the same -.7 torso-loop shift cape needs (above). */
const SWORD_PIVOT_SPEC: Node = {
  name: 'sword-pivot', at: [.44, .3, -.02], parts: [
    { name: 'glove', shape: { dodeca: [.14] }, material: 'leather', at: [0, -.02, .03] },
    { name: 'sword-sleeve', shape: { cylinder: [.12, .09, .26, 6] }, material: 'dark', at: [-.035, -.03, .13], rot: [-.85, 0, 0] },
  ],
};

/** The cape's cloth pattern is per-vertex colour (a sewn gold seam and border), not a material choice, so
 *  it stays outside the spec format and is built exactly as the reference code built it. */
function buildCape() {
  // Ten by twelve, folded towards the hem (plan 009): see dungeon-cloak.ts's own comment for why.
  const geometry = new THREE.PlaneGeometry(1, 1, 10, 12), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * 2, free = .5 - positions.getY(i);
    positions.setXYZ(i, u * (.37 + free * .15), -free * .98 + (free > .99 ? .035 * Math.abs(u) : 0),
      .07 * (1 - u * u) + free * .15 + Math.sin(u * 9) * .046 * free * (1 - free * .3));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  const colours: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    const free = -y / .98, border = Math.abs(x) > (.37 + free * .15) * .9 || free > .94;
    const seam = Math.abs(x) < (.37 + free * .15) * .12 && free > .14 && free < .9;
    const color = new THREE.Color(border || seam ? 0xf3c46d : 0xcb2130); colours.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const cape = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, emissive: 0x330c09, side: THREE.DoubleSide }));
  // makeKnight()'s torso-relative parts all shift up .7 to compensate for the torso group's own +.7 (see
  // KNIGHT_SPEC's `torso` node); cape and sword-pivot are spliced in after buildSpec, so that shift is
  // applied here by hand instead of by the loop the reference code used.
  cape.position.set(0, 1.2 - .7, .22); cape.rotation.x = -.1;
  return cape;
}

export function makeKnight() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0e15, roughness: 0.82 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x64668c, roughness: 0.4, metalness: 0.5, flatShading: true });
  const iron = new THREE.MeshStandardMaterial({ color: 0x212436, roughness: .5, metalness: .56, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xffc86a, roughness: .38, metalness: .55, emissive: 0x4a2c07 });
  const shadow = new THREE.MeshStandardMaterial({ color: 0x05090c, roughness: 1 });
  const red = new THREE.MeshStandardMaterial({ color: 0x9e1f33, roughness: 0.85, emissive: 0x430610, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x2c1a14, roughness: 1 });
  // The one pale thing left on the knight: a long bright blade, since no skeleton carries one. Bound to
  // the armoury's "steel" slot so the weapon keeps the old plate value while the body drops away under it.
  const blade = new THREE.MeshStandardMaterial({ color: 0xdcded9, roughness: 0.32, metalness: 0.5, flatShading: true });
  const plate: Plate = (outline, depth, material) => {
    const shape = new THREE.Shape(); outline.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2); return new THREE.Mesh(geometry, material);
  };

  const { root: g, byName } = buildSpec(KNIGHT_SPEC, { dark, steel, iron, brass, shadow, red, leather });
  const torso = byName['torso'] as THREE.Group;

  const cape = buildCape();
  const armoryPalette: ArmoryPalette = { steel: blade, iron, brass, leather, dark, shadow };
  const armed = makeWeapon(STARTING_WEAPON, armoryPalette, plate);
  const { root: swordPivot } = buildSpec(SWORD_PIVOT_SPEC, { dark, steel, iron, brass, shadow, red, leather });
  swordPivot.add(armed.group);
  const { root: arm } = buildSpec(ARM_SPEC, { dark, steel, iron, brass, shadow, red, leather });
  // Order matters here only relative to `head` (already built, so already before these three) and to each
  // other: bakeStatic always skips a kept subtree wherever it sits among torso's other children, but the
  // three kept subtrees themselves end up in the tree in the order they were added, and the fingerprint's
  // paths follow that order.
  torso.add(cape); torso.add(swordPivot); torso.add(arm);

  const legs = [byName['hip-l'] as THREE.Group, byName['hip-r'] as THREE.Group];
  for (const hip of legs) { hip.userData.knee = byName[`knee-${hip === legs[0] ? 'l' : 'r'}`]; hip.userData.boot = byName[`boot-shape-${hip === legs[0] ? 'l' : 'r'}`]; }
  g.userData.arm = arm; g.userData.legs = legs; g.userData.cape = cape; g.userData.body = torso;
  g.userData.sword = swordPivot; g.userData.torso = torso;
  g.userData.armoury = { palette: armoryPalette, plate }; g.userData.armed = armed;

  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Plan 010: nothing between two joints moves, so every joint is folded into one mesh per material -
  // after the hidden pauldrons (which the bake removes) and after the shadow flags, which the batches
  // carry. The animated joints and the swapped arm are kept out. Footsteps read the boot's world matrix,
  // and the boot is about to be merged into its knee, so the reference moves first to a bare node
  // standing exactly where the boot stood.
  for (const hip of legs) {
    const boot = hip.userData.boot as THREE.Mesh, knee = hip.userData.knee as THREE.Group, sole = new THREE.Object3D();
    sole.name = 'boot'; sole.position.copy(boot.position); sole.quaternion.copy(boot.quaternion); knee.add(sole); hip.userData.boot = sole;
  }
  bakeStatic(torso, { keep: [cape, swordPivot, arm], cacheKey: 'knight:torso' });
  bakeStatic(swordPivot, { keep: [armed.group], cacheKey: 'knight:pivot' });
  bakeStatic(arm, { cacheKey: 'knight:arm' });
  for (const hip of legs) { bakeStatic(hip, { keep: [hip.userData.knee as THREE.Group], cacheKey: 'knight:hip' }); bakeStatic(hip.userData.knee as THREE.Group, { cacheKey: 'knight:knee' }); }
  // The body cylinder is in the torso's batches now; nothing reads this, but it names the node that owns it.
  g.userData.body = torso;
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.54, .58));
  return g;
}
