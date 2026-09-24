// The knight, as a part list (plan 012 Stage B). Every plate, joint and strap is a named entry here,
// findable and editable without reading a builder function.
//
// Plan 013 redrew him from the eight-facing turnaround sheet (blackened plate, gold edging, crimson cloth):
// a bucket great helm with a gold slit frame under a swept-back plume, domed pauldrons over two lames, a
// gold-rimmed breastplate with a diamond, a mail skirt behind a gold-bordered tabard, and longer armoured
// legs. He stands the same height as before - the helm and plume shrank by what the legs gained - and is
// drawn in 31 meshes of the 32 allowed: the knees and the free arm lost a material each to pay for the
// tabard, the mail and the plume's own crimson. The helm stays the palest thing on him on purpose (models.spec.ts holds head over shoulders),
// so the shoulders are dark iron and carry their gold only as thin edges.
//
// Three things do NOT fit the spec's narrow shape model and stay imperative: the cape (its cloth pattern
// is per-vertex colour, not a material), the sword pivot's weapon (built by makeWeapon() from the equipped
// WeaponId, not fixed data) and the tabard's swing joint, which is spec data but has to be spliced in as a
// kept subtree so it can turn with the legs. All three are spliced into the tree after buildSpec runs.
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

// Unit primitives the trim is built from, each scaled per instance via the part's own `scale`. A plain
// THREE.BoxGeometry bevels to nothing under about a pixel and costs nine times the triangles of the box it
// rounds (plan 010/011), so the thinnest trim stays plain and the broad plates keep the rounded edge.
const roundedUnitBox = () => new RoundedBoxGeometry(1, 1, 1, 1, .08);
const plainUnitBox = () => new THREE.BoxGeometry(1, 1, 1);
const unitJoint = () => new THREE.IcosahedronGeometry(1, 0);
const unitSpike = () => new THREE.ConeGeometry(1, 1, 4);
// A pauldron is a dome, not a gem: eight facets round and three down read as one rounded shell from the
// isometric camera, where the old dodecahedron read as a boulder. Open underneath - nothing sees it there.
const unitDome = () => new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
// The ring that edges a dome, lying flat in the dome's own base plane.
const unitRim = () => new THREE.TorusGeometry(1, .08, 3, 8).rotateX(Math.PI / 2);
// Diamonds (the chest gem, the buckle, the tabard's point) share one outline, scaled per use.
const diamond = (w: number, h: number): [number, number][] => [[0, h], [w, 0], [0, -h], [-w, 0]];

/**
 * The knight's part tree. `cape`, `tabard`, `sword-pivot` and `arm` are deliberately NOT here: they are
 * spliced onto `torso` after buildSpec runs (see makeKnight below), because bakeStatic always skips a kept
 * subtree regardless of where it sits among its siblings, so their position among the parts below cannot
 * affect the merge - only their position relative to EACH OTHER and to `head` (after) does.
 */
const KNIGHT_SPEC: Node = {
  name: 'knight',
  parts: [
    {
      // Plan 013: up .06 on the longer legs (the hips below rise with it), so the sword pivot, cape anchor
      // and arm, all torso-local, keep the numbers the game and the rest-pose test read.
      name: 'torso', at: [0, .76, 0], parts: [
        {
          name: 'breastplate', shape: { plate: { outline: [[-.27, .22], [.27, .22], [.3, .08], [.22, -.22], [0, -.27], [-.22, -.22], [-.3, .08]], depth: .13 } }, material: 'iron', at: [0, .22, -.25],
          parts: [{ name: 'chest-ridge', shape: { plate: { outline: [[-.025, .18], [.025, .18], [.035, -.19], [0, -.23], [-.035, -.19]], depth: .02 } }, material: 'steel', at: [0, 0, -.085] }],
        },
        // The same outline a size up in brass, set just behind the iron: it shows only as a gold edge
        // around the plate, which is how the sheet draws every plate on him.
        { name: 'breastplate-trim', shape: { plate: { outline: [[-.3, .245], [.3, .245], [.335, .085], [.245, -.245], [0, -.3], [-.245, -.245], [-.335, .085]], depth: .09 } }, material: 'brass', at: [0, .22, -.235] },
        { name: 'chest-gem', shape: { plate: { outline: diamond(.06, .085), depth: .03 } }, material: 'brass', at: [0, .27, -.345] },
        // Hidden on purpose since plan 010 (the old pale shoulders): bakeStatic removes them, and the bake
        // tests lean on the knight carrying an invisible part. The domes below are what he wears.
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
          // Plan 013: a smaller helm (1.15 to 1.05) is what pays for the longer legs.
          name: 'head', at: [0, .67, 0], scale: 1.05, parts: [
            // Plan 014 round 8 (lever 1): a real taper (.26 at the collar to .205 at the crown, up from
            // a barely-there .26/.24) and twelve sides rather than eight - this is the one shape on him
            // that stood for "a great helm" on its own, and eight near-vertical panels at almost no
            // taper is what read as a flat cylinder no matter how the light hit it. Smooth shading
            // (removed above, from the material) is what turns those extra sides into a gradient
            // instead of just more facets.
            { name: 'helmet', shape: { cylinder: [.205, .26, .4, 12] }, material: 'steel', at: [0, .04, 0], rot: [0, Math.PI / 8, 0] },
            { name: 'crown', shape: { geometry: unitDome() }, material: 'steel', at: [0, .225, 0], rot: [0, Math.PI / 8, 0], scale: [.212, .11, .212] },
            {
              // The whole face tips back about the mask's own origin (plan 010); trim below is mask-local.
              name: 'mask', at: [0, 0, -.215], rot: [.2, 0, 0], parts: [
                { name: 'face', shape: { plate: { outline: [[-.24, .14], [.24, .14], [.22, -.16], [.09, -.23], [-.09, -.23], [-.22, -.16]], depth: .065 } }, material: 'steel', at: [0, 0, 0] },
                {
                  name: 'visor', at: [0, 0, -.049], parts: [
                    { name: 'slit-l', shape: { box: [.175, .052, .018] }, material: 'shadow', at: [-.116, .02, 0], rot: [0, 0, -.08] },
                    { name: 'slit-r', shape: { box: [.175, .052, .018] }, material: 'shadow', at: [.116, .02, 0], rot: [0, 0, .08] },
                    // Plan 014 round 8 (lever 1): a dark slit alone reads as an empty gap; a hairline of
                    // the same steel the rest of the helm wears, set a shade forward of the slit's own
                    // dark box and a fraction of its height, is what a real visor's lower rim catches as
                    // a cold glint. Reuses 'steel' rather than a new material - the spec's own header
                    // notes the figure sits one mesh under its 32-material ceiling.
                    { name: 'slit-glint-l', shape: { box: [.15, .01, .012] }, material: 'steel', at: [-.116, -.002, -.006], rot: [0, 0, -.08] },
                    { name: 'slit-glint-r', shape: { box: [.15, .01, .012] }, material: 'steel', at: [.116, -.002, -.006], rot: [0, 0, .08] },
                  ],
                },
                // Gold above and below the slit, and down the middle: the cross the sheet puts on the face.
                { name: 'slit-brow', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .07, -.05], scale: [.43, .028, .02] },
                { name: 'slit-cheek', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, -.026, -.05], scale: [.4, .022, .02] },
                { name: 'nose', shape: { plate: { outline: [[-.025, .11], [.025, .11], [.035, -.18], [0, -.215], [-.035, -.18]], depth: .045 } }, material: 'brass', at: [0, 0, -.06] },
                { name: 'mouth', shape: { box: [.035, .1, .018] }, material: 'shadow', at: [0, -.13, -.042] },
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
            // The plume's socket: a brass ridge over the crown, front to back.
            { name: 'browband', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .3, .03], scale: [.05, .1, .36] },
            // Plan 013: a plume, not a mohawk. Three feathers down the ridge, each laid further back than the
            // one before it, and one a side splayed outward so it has width from the front. Nothing trails
            // further back: from behind it would cover the helm's steel, which is what lifts his head off
            // the cape (models.spec.ts, facings 3 to 5). The front
            // feather's tip is the knight's highest point and sits where the old crest's did.
            { name: 'crest-0', shape: { geometry: unitSpike() }, material: 'plume', at: [0, .36, .02], rot: [.7, 0, 0], scale: [.1, .36, .11] },
            { name: 'crest-1', shape: { geometry: unitSpike() }, material: 'plume', at: [0, .36, .12], rot: [.95, 0, 0], scale: [.11, .44, .11] },
            { name: 'crest-2', shape: { geometry: unitSpike() }, material: 'plume', at: [0, .34, .21], rot: [1.1, 0, 0], scale: [.1, .44, .1] },
            { name: 'crest-side-l0', shape: { geometry: unitSpike() }, material: 'plume', at: [-.07, .33, .12], rot: [.95, 0, .55], scale: [.08, .38, .09] },
            { name: 'crest-side-r0', shape: { geometry: unitSpike() }, material: 'plume', at: [.07, .33, .12], rot: [.95, 0, -.55], scale: [.08, .38, .09] },
          ],
        },
        { name: 'belt', shape: { torus: [.285, .047, 4, 8] }, material: 'leather', at: [0, -.04, 0], rot: [Math.PI / 2, 0, 0] },
        // Blackened, not red: the sheet's gorget is dark, and a dark ring is what lifts the helm off the
        // shoulders from above.
        { name: 'collar', shape: { torus: [.24, .075, 4, 8] }, material: 'iron', at: [0, .51, 0], rot: [Math.PI / 2, 0, 0] },
        // In front of the tabard's hanging edge, so the belt reads as holding it up.
        { name: 'buckle', shape: { plate: { outline: diamond(.075, .065), depth: .04 } }, material: 'brass', at: [0, -.04, -.37] },
        // Mail from the belt to mid-thigh, flat face forward so the tabard hangs clear of it.
        { name: 'mail', shape: { cylinder: [.3, .34, .22, 8] }, material: 'mail', at: [0, -.17, 0], rot: [0, Math.PI / 8, 0] },
        { name: 'skirt-l', shape: { plate: { outline: [[-.12, .12], [.12, .12], [.14, -.17], [-.1, -.2]], depth: .055 } }, material: 'iron', at: [-.24, -.17, -.08], rot: [0, .45, -.13] },
        { name: 'clasp-l', shape: { dodeca: [.048] }, material: 'brass', at: [-.2, .44, -.23] },
        { name: 'skirt-r', shape: { plate: { outline: [[-.12, .12], [.12, .12], [.14, -.17], [-.1, -.2]], depth: .055 } }, material: 'iron', at: [.24, -.17, -.08], rot: [0, -.45, .13] },
        { name: 'clasp-r', shape: { dodeca: [.048] }, material: 'brass', at: [.2, .44, -.23] },
        { name: 'pouch', shape: { box: [.17, .2, .13] }, material: 'leather', at: [.3, -.09, .1] },
        // Shoulders, per side (side=-1 then side=1): an iron dome tipped outward, its gold rim and front
        // boss, and two plain iron lames stepping down over the upper arm. Gold
        // edges on the lames were tried and cost head-over-shoulders from the side (facing 6).
        { name: 'dome-l', shape: { geometry: unitDome() }, material: 'iron', at: [-.4, .44, 0], rot: [0, 0, .3], scale: [.195, .13, .215] },
        { name: 'dome-rim-l', shape: { geometry: unitRim() }, material: 'brass', at: [-.4, .44, 0], rot: [0, 0, .3], scale: [.2, .16, .22] },
        { name: 'boss-l', shape: { geometry: unitJoint() }, material: 'brass', at: [-.44, .51, -.14], scale: [.042, .042, .03] },
        { name: 'lame-l0', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [-.45, .38, -.01], rot: [0, 0, .32], scale: [.34, .08, .42] },
        { name: 'lame-l1', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [-.49, .3, -.01], rot: [0, 0, .38], scale: [.3, .08, .4] },
        { name: 'dome-r', shape: { geometry: unitDome() }, material: 'iron', at: [.4, .44, 0], rot: [0, 0, -.3], scale: [.195, .13, .215] },
        { name: 'dome-rim-r', shape: { geometry: unitRim() }, material: 'brass', at: [.4, .44, 0], rot: [0, 0, -.3], scale: [.2, .16, .22] },
        { name: 'boss-r', shape: { geometry: unitJoint() }, material: 'brass', at: [.44, .51, -.14], scale: [.042, .042, .03] },
        { name: 'lame-r0', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [.45, .38, -.01], rot: [0, 0, -.32], scale: [.34, .08, .42] },
        { name: 'lame-r1', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [.49, .3, -.01], rot: [0, 0, -.38], scale: [.3, .08, .4] },
      ],
    },
    // Plan 013: the legs are .06 longer (thigh .03, shin .03) and armoured to the toe - iron shin and
    // sabaton, steel knee and toe caps, gold bands - which also drops the knee from five materials to three.
    {
      name: 'hip-l', at: [-.2, .54, 0], parts: [
        { name: 'leg-l', shape: { box: [.19, .27, .2] }, material: 'dark', at: [0, -.12, 0] },
        {
          name: 'knee-l', at: [0, -.25, 0], parts: [
            { name: 'shin-l', shape: { box: [.17, .2, .18] }, material: 'iron', at: [0, -.08, 0] },
            { name: 'boot-shape-l', shape: { box: [.22, .16, .34] }, material: 'iron', at: [0, -.15, -.06] },
            { name: 'greave-l', shape: { plate: { outline: [[-.095, .08], [.095, .08], [.08, -.13], [0, -.16], [-.08, -.13]], depth: .05 } }, material: 'iron', at: [0, -.04, -.105] },
            { name: 'kneecap-l', shape: { dodeca: [.115] }, material: 'steel', at: [0, 0, -.11], scale: [.95, .8, .6] },
            { name: 'knee-plate-l', shape: { geometry: roundedUnitBox() }, material: 'steel', at: [0, -.14, -.16], scale: [.2, .075, .18] },
            { name: 'knee-rivet-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .012, -.14], scale: [.13, .024, .025] },
            { name: 'toe-trim-l', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, -.1, -.24], scale: [.2, .024, .02] },
          ],
        },
      ],
    },
    {
      name: 'hip-r', at: [.2, .54, 0], parts: [
        { name: 'leg-r', shape: { box: [.19, .27, .2] }, material: 'dark', at: [0, -.12, 0] },
        {
          name: 'knee-r', at: [0, -.25, 0], parts: [
            { name: 'shin-r', shape: { box: [.17, .2, .18] }, material: 'iron', at: [0, -.08, 0] },
            { name: 'boot-shape-r', shape: { box: [.22, .16, .34] }, material: 'iron', at: [0, -.15, -.06] },
            { name: 'greave-r', shape: { plate: { outline: [[-.095, .08], [.095, .08], [.08, -.13], [0, -.16], [-.08, -.13]], depth: .05 } }, material: 'iron', at: [0, -.04, -.105] },
            { name: 'kneecap-r', shape: { dodeca: [.115] }, material: 'steel', at: [0, 0, -.11], scale: [.95, .8, .6] },
            { name: 'knee-plate-r', shape: { geometry: roundedUnitBox() }, material: 'steel', at: [0, -.14, -.16], scale: [.2, .075, .18] },
            { name: 'knee-rivet-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, .012, -.14], scale: [.13, .024, .025] },
            { name: 'toe-trim-r', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, -.1, -.24], scale: [.2, .024, .02] },
          ],
        },
      ],
    },
  ],
};

/** The free arm, kept as its own spec so `arm`'s bakeStatic call (below) sees the same part order. Plan
 *  013: an iron gauntlet where the leather fist was - four materials, not five. */
const ARM_SPEC: Node = {
  name: 'arm', at: [-.4, .34, 0], parts: [
    { name: 'sleeve', shape: { box: [.17, .28, .18] }, material: 'dark', at: [0, -.14, 0] },
    { name: 'forearm', shape: { box: [.16, .17, .28] }, material: 'steel', at: [0, -.28, -.09] },
    { name: 'fist', shape: { dodeca: [.12] }, material: 'iron', at: [0, -.28, -.24] },
    { name: 'arm-plate', shape: { geometry: roundedUnitBox() }, material: 'iron', at: [0, -.26, -.12], rot: [.12, 0, 0], scale: [.23, .2, .28] },
    { name: 'arm-rivet', shape: { geometry: plainUnitBox() }, material: 'brass', at: [0, -.19, -.22], scale: [.235, .025, .025] },
  ],
};

/** The sword pivot's own trim; `armed.group` (the equipped weapon) is spliced in by makeKnight() below.
 *  dungeon-game.tsx sets this position back every frame (`sword.position.set(.44,.3,...)`): keep the two in step. */
const SWORD_PIVOT_SPEC: Node = {
  name: 'sword-pivot', at: [.44, .3, -.02], parts: [
    { name: 'glove', shape: { dodeca: [.14] }, material: 'leather', at: [0, -.02, .03] },
    { name: 'sword-sleeve', shape: { cylinder: [.12, .09, .26, 6] }, material: 'dark', at: [-.035, -.03, .13], rot: [-.85, 0, 0] },
  ],
};

/** Plan 013: the tabard, hung from the belt on its own joint. It is rigid plate, not cloth - gold behind,
 *  crimson in front, a gold diamond at the point - and the game swings it forward with whichever leg leads,
 *  which is what keeps a running thigh from coming through it. */
const TABARD_SPEC: Node = {
  name: 'tabard', at: [0, -.075, -.345], parts: [
    { name: 'tabard-trim', shape: { plate: { outline: [[-.185, .02], [.185, .02], [.195, -.33], [0, -.46], [-.195, -.33]], depth: .018 } }, material: 'brass', at: [0, 0, .004] },
    { name: 'tabard-cloth', shape: { plate: { outline: [[-.16, 0], [.16, 0], [.17, -.31], [0, -.43], [-.17, -.31]], depth: .018 } }, material: 'red', at: [0, 0, -.01] },
    { name: 'tabard-gem', shape: { plate: { outline: diamond(.04, .05), depth: .012 } }, material: 'brass', at: [0, -.28, -.024] },
  ],
};

/** The cape's cloth pattern is per-vertex colour (a gold border), not a
 *  material choice, so it stays outside the spec format. */
function buildCape() {
  // Ten by twelve, folded towards the hem (plan 009). Plan 013: a little longer, and cut ragged - every other hem vertex is pulled up, so the bottom edge zigzags.
  const geometry = new THREE.PlaneGeometry(1, 1, 10, 12), positions = geometry.getAttribute('position');
  const width = (free: number) => .37 + free * .15;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * 2, free = .5 - positions.getY(i), hem = free > .99;
    const rag = hem && Math.round(u * 5) % 2 !== 0 ? .07 : 0;
    positions.setXYZ(i, u * width(free), -free * 1.02 + rag + (hem ? .035 * Math.abs(u) : 0),
      .07 * (1 - u * u) + free * .15 + Math.sin(u * 9) * .046 * free * (1 - free * .3));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  const colours: number[] = [];
  // By grid index rather than position: the hem's rag has moved rows off their even spacing.
  for (let i = 0; i < positions.count; i++) {
    const u = (i % 11) / 5 - 1, row = Math.floor(i / 11);
    const border = Math.abs(u) > .9 || row === 12;
    const color = new THREE.Color(border ? 0xf3c46d : 0xcb2130); colours.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const cape = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, emissive: 0x220805, side: THREE.DoubleSide }));
  // Torso-local, like every part above: the torso group's own height is added by the tree.
  cape.position.set(0, .5, .22); cape.rotation.x = -.1;
  return cape;
}

export function makeKnight() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0e15, roughness: 0.82 });
  // Plan 014 round 4 (lever C8): the helmet and plate read as a flat purple cylinder at
  // metalness .5/roughness .4 - close enough to a dielectric that the now-useful env map
  // (`vaultEnvironment`, round 3) never got a sharp enough lobe to throw a real torch-lit specular,
  // and 0x64668c was pale and violet enough to read as painted plastic rather than darkened steel.
  // Plan 014 round 5 (lever A2): round 4 overcorrected - metalness .82 on a base that dark, lit
  // mostly by a dim environment, rendered as a near-black silhouette (a metal's own diffuse term
  // drops out almost entirely as metalness rises, so *all* of its brightness has to come from
  // specular/env reflection, and there was not enough of either). Backed off to a metalness a real
  // steel plate still reads as metal at without needing a blazing environment to be visible, a
  // lighter base, and `envMapIntensity` raised on these materials alone (not the whole scene) so the
  // knight's own metals catch a real highlight without relighting every stone in the room.
  // Plan 014 round 8 (lever 1): `flatShading` overrides a geometry's own per-vertex normals with a
  // face normal derived in the fragment shader, which is what turned every curved steel shape here -
  // the helmet, the pauldron domes, the greaves - into a set of hard, visible facets no matter how
  // many segments the geometry underneath actually had. `CylinderGeometry`/`SphereGeometry`/the
  // lathes below all already carry real smooth vertex normals; removing the override is most of what
  // "torchlight gives gradients, not facets" asks for, before a single shape below even changes.
  const steel = new THREE.MeshStandardMaterial({ color: 0x777c90, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.6 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3c4056, roughness: .38, metalness: 0.62, envMapIntensity: 1.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xffc86a, roughness: .38, metalness: .55, emissive: 0x4a2c07 });
  const shadow = new THREE.MeshStandardMaterial({ color: 0x05090c, roughness: 1 });
  const red = new THREE.MeshStandardMaterial({ color: 0x9e1f33, roughness: 0.85, emissive: 0x2c0509, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x2c1a14, roughness: 1 });
  // Plan 013: the plume in the sheet's own crimson, a step brighter than the cloth. The helm's top third is
  // half plume from most facings, and the tabard's darker red would pull the head down to the shoulders.
  const plume = new THREE.MeshStandardMaterial({ color: 0xd42a36, roughness: .8, emissive: 0x5a0a12 });
  // Plan 013: between the iron and the steel, and rougher than either, so the skirt reads as woven rings
  // rather than one more plate.
  const mail = new THREE.MeshStandardMaterial({ color: 0x484c5e, roughness: .55, metalness: .55, envMapIntensity: 1.4 });
  // The one pale thing left on the knight: a long bright blade, since no skeleton carries one. Bound to
  // the armoury's "steel" slot so the weapon keeps the old plate value while the body drops away under it.
  const blade = new THREE.MeshStandardMaterial({ color: 0xdcded9, roughness: 0.2, metalness: 0.6, envMapIntensity: 1.5 });
  const plate: Plate = (outline, depth, material) => {
    const shape = new THREE.Shape(); outline.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2); return new THREE.Mesh(geometry, material);
  };
  const palette = { dark, steel, iron, brass, shadow, red, leather, mail, plume };

  const { root: g, byName } = buildSpec(KNIGHT_SPEC, palette);
  const torso = byName['torso'] as THREE.Group;

  const cape = buildCape();
  const { root: tabard } = buildSpec(TABARD_SPEC, palette);
  const armoryPalette: ArmoryPalette = { steel: blade, iron, brass, leather, dark, shadow };
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
  // The body cylinder is in the torso's batches now; nothing reads this, but it names the node that owns it.
  g.userData.body = torso;
  // After the traverse, and deliberately: the pool must not be fed back into the shadow map it imitates.
  g.add(contactShadow(.62, .74));
  return g;
}
