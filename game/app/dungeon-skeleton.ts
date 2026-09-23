// The three skeleton kinds (guard, stalker, warden), as a part list (plan 012 Stage B). One spec function
// with plain conditionals per kind, since the reference builder (makeSkeleton/enemyDetails) branches by
// kind throughout rather than sharing one shape with per-kind numbers - forcing that into one static
// literal would obscure the branches more than a function does.
//
// Ordering note (see dungeon-knight.ts for the fuller version of this comment): bakeStatic merges by
// first-material-encounter in a depth-first walk, so the order parts are pushed below is load-bearing
// wherever two different materials could otherwise be met in a different sequence - reordering within one
// material's own run is free, reordering across a material boundary is not without regenerating the
// fixture.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { contactShadow } from './dungeon-characters.ts';
import { bakeStatic } from './dungeon-bake.ts';
import { buildSpec, type Node, type Part, type V3 } from './dungeon-figure-spec.ts';

export type SkeletonKind = 'guard' | 'stalker' | 'warden';

const shared = <T extends THREE.BufferGeometry>(geometry: T) => { geometry.userData.shared = true; return geometry; };

/** Geometry every kind draws from - unchanged from Stage A verbatim. `BONES.cue` and `BONES.bar` are also
 *  used directly by dungeon-game.tsx's attack telegraph, outside any figure. */
export const BONES = {
  pelvis: shared(new THREE.BoxGeometry(0.48, 0.22, 0.25)),
  spine: shared(new THREE.BoxGeometry(0.13, 0.58, 0.13)),
  ribs: shared(new THREE.TorusGeometry(0.27, 0.055, 4, 7, Math.PI * 1.55)),
  skull: shared(new THREE.DodecahedronGeometry(0.27, 0)),
  socket: shared(new THREE.SphereGeometry(0.035, 5, 4)),
  limb: shared(new THREE.CylinderGeometry(.055, .075, .65, 6)),
  shield: shared(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 8)),
  weapon: shared(new THREE.BoxGeometry(0.09, 0.09, 0.92)),
  // Plan 011: the guard's sword, flat and broad-face up, so it reads by its width from above rather than
  // as a few dark pixels. Its last quarter pinches to the point the trim's spike rides along.
  blade: shared((() => { const blade = new THREE.BoxGeometry(.16, .035, .92, 1, 1, 4), at = blade.getAttribute('position'); for (let i = 0; i < at.count; i++) if (at.getZ(i) < -.45) at.setX(i, 0); blade.computeVertexNormals(); return blade; })()),
  crown: shared(new THREE.CylinderGeometry(.29, .28, .11, 8, 1, true)),
  crownTooth: shared(new THREE.ConeGeometry(.065, .2, 4)),
  armor: shared(new THREE.DodecahedronGeometry(.32, 0)),
  plate: shared(new THREE.BoxGeometry(.72, .48, .34)),
  haft: shared(new THREE.CylinderGeometry(.055, .075, 1.3, 6)),
  hammer: shared(new THREE.BoxGeometry(.72, .36, .38)),
  claw: shared(new THREE.ConeGeometry(.065, .62, 4)),
  cue: shared(new THREE.RingGeometry(0.85, 1.5, 40, 1, -1.05, 2.1)),
  bar: shared(new THREE.PlaneGeometry(0.8, 0.07)),
};

// Unit trim primitives, scaled per instance via each part's own `scale` field (see dungeon-knight.ts's
// identical note: a fresh instance per part is fine, nothing needs the sharing dungeon-characters.ts used
// to do for its own merge cache).
const roundedUnitBox = () => new RoundedBoxGeometry(1, 1, 1, 1, .08);
const plainUnitBox = () => new THREE.BoxGeometry(1, 1, 1);
const unitJoint = () => new THREE.IcosahedronGeometry(1, 0);
function clothGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.5, .5); shape.lineTo(.5, .5); shape.lineTo(.43, -.42); shape.lineTo(.15, -.33); shape.lineTo(0, -.5); shape.lineTo(-.18, -.36); shape.lineTo(-.4, -.45); shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

type Geom = 'box' | 'joint' | 'spike' | 'rib' | 'shaft' | 'cloth';
/** One piece of trim from the old enemyDetails(): a unit primitive, scaled and posed like the reference's
 *  dressing() calls did, pushed straight onto whichever parent's part list it belongs to. A plain box
 *  bevels away to nothing under about a pixel (plan 010/011), so anything under .06 on its narrowest side
 *  stays a plain THREE.BoxGeometry instead of the rounded one. */
function trim(target: (Part | Node)[], name: string, geom: Geom, material: string, at: V3, size: V3, rot?: V3) {
  const shape: Part['shape'] =
    geom === 'box' ? { geometry: Math.min(...size) < .06 ? plainUnitBox() : roundedUnitBox() } :
    geom === 'joint' ? { geometry: unitJoint() } :
    geom === 'spike' ? { cone: [1, 1, 4] } :
    geom === 'rib' ? { torus: [1, .13, 4, 10, Math.PI * 1.65] } :
    geom === 'shaft' ? { cylinder: [.72, 1, 1, 6] } :
    { geometry: clothGeometry() };
  target.push({ name, shape, material, at, scale: size, rot });
}

/**
 * The part tree for one kind, rooted at `rig` (the same node makeSkeleton() built by hand). Base parts -
 * the kind's own armour, then pelvis/spine/ribs/skull/eyes/limbs/weapon - are listed first, in the order
 * makeSkeleton() built them; each part's own trim (the old enemyDetails()) is appended right after, in the
 * order enemyDetails() called add() for it. That match is what keeps bakeStatic's batch order identical
 * to the frozen fixture - see the file header before reordering anything.
 */
function skeletonSpec(kind: SkeletonKind): Node {
  const stalker = kind === 'stalker', warden = kind === 'warden';
  const rigParts: (Part | Node)[] = [];
  const weaponParts: (Part | Node)[] = [];
  const skullParts: (Part | Node)[] = [];
  const armParts: (Part | Node)[][] = [[], []];
  const legParts: (Part | Node)[][] = [[], []];
  const shieldParts: (Part | Node)[] = [
    { name: 'boss', shape: { geometry: BONES.armor }, material: 'brass', at: [0, .075, 0], scale: [.38, .16, .38] },
  ];

  // makeSkeleton()'s own kind armour, added to `rig` before the base skeleton.
  if (warden) {
    rigParts.push({ name: 'plate', shape: { geometry: BONES.plate }, material: 'iron', at: [0, 1.0, -.05] });
    for (const s of [-1, 1] as const) rigParts.push({ name: `shoulder-${s < 0 ? 'l' : 'r'}`, shape: { geometry: BONES.armor }, material: 'iron', at: [s * .49, 1.21, 0], scale: [1.18, .72, 1] });
    const teeth: Part[] = [];
    for (let i = 0; i < 6; i++) { const angle = i * Math.PI / 3; teeth.push({ name: `crown-tooth-${i}`, shape: { geometry: BONES.crownTooth }, material: 'brass', at: [Math.cos(angle) * .26, .1, Math.sin(angle) * .26] }); }
    rigParts.push({ name: 'crown', shape: { geometry: BONES.crown }, material: 'brass', at: [0, 1.63, 0], parts: teeth });
  } else if (!stalker) {
    rigParts.push({ name: 'helmet', shape: { geometry: BONES.armor }, material: 'iron', at: [0, 1.62, .13], scale: [.90, .42, .95] });
  }

  rigParts.push({ name: 'pelvis', shape: { geometry: BONES.pelvis }, material: 'bone', at: [0, .55, 0] });
  rigParts.push({ name: 'spine', shape: { geometry: BONES.spine }, material: 'bone', at: [0, .91, 0] });
  rigParts.push({ name: 'ribs', shape: { geometry: BONES.ribs }, material: 'bone', at: [0, 1.03, -.02], rot: [Math.PI / 2, 0, -Math.PI * 0.78], scale: stalker ? [.85, 1, 1] : undefined });

  // The skull: its own mesh, then its trim from enemyDetails (common to every kind), then stalker's own
  // pair of horns - all bakeStatic's own root later, via the `skull` group below.
  skullParts.push({ name: 'skull-shape', shape: { geometry: BONES.skull }, material: 'bone', at: [0, 0, 0] });
  for (const s of [-1, 1] as const) {
    trim(skullParts, `brow-${s < 0 ? 'l' : 'r'}`, 'joint', 'shadow', [s * .105, .045, -.223], [.1, .083, .026]);
    trim(skullParts, `jaw-${s < 0 ? 'l' : 'r'}-0`, 'box', 'bone', [s * .14, -.092, -.19], [.1, .11, .1], [0, 0, s * .24]);
    trim(skullParts, `jaw-${s < 0 ? 'l' : 'r'}-1`, 'box', 'bone', [s * .11, .13, -.22], [.16, .047, .05], [0, 0, s * -.22]);
  }
  trim(skullParts, 'chin', 'joint', 'shadow', [0, -.043, -.244], [.043, .05, .018]);
  trim(skullParts, 'muzzle', 'box', 'bone', [0, -.17, -.13], [.31, .075, .18]);
  for (let i = 0; i < 5; i++) trim(skullParts, `tooth-${i}`, 'box', 'bone', [(i - 2) * .049, -.128, -.22], [.03, .055, .045]);
  if (stalker) for (const s of [-1, 1] as const) {
    trim(skullParts, `horn-${s < 0 ? 'l' : 'r'}`, 'spike', 'bone', [s * .18, -.2, -.19], [.045, .19, .045], [Math.PI, 0, s * -.12]);
    trim(skullParts, `horn-shade-${s < 0 ? 'l' : 'r'}`, 'spike', 'shadow', [s * .2, .17, .04], [.1, .24, .1], [0, 0, s * -.25]);
  }
  rigParts.push({ name: 'skull', at: [0, 1.42, stalker ? -.16 : 0], scale: stalker ? [.85, .82, 1.15] : [.88, 1, .78], parts: skullParts });

  rigParts.push({ name: 'eye-l', shape: { geometry: BONES.socket }, material: 'eye', at: [-.085, 1.45, stalker ? -.445 : -.223], scale: 1.2 });
  rigParts.push({ name: 'eye-r', shape: { geometry: BONES.socket }, material: 'eye', at: [.085, 1.45, stalker ? -.445 : -.223], scale: 1.2 });

  // Arms and legs: each a pivot holding one limb bone. Arm-l also holds the shield (always, even when
  // invisible - shield.visible only decides whether it draws, not whether the rig carries one). Stalker's
  // arms also hold claws and warden's legs also hold a greave, both set before enemyDetails' own trim,
  // matching makeSkeleton()'s own order.
  armParts[0]!.push({ name: 'arm-shape-l', shape: { geometry: BONES.limb }, material: 'bone', at: [0, stalker ? -.4 : -.27, 0], scale: [1, stalker ? 1.35 : .85, 1] });
  armParts[1]!.push({ name: 'arm-shape-r', shape: { geometry: BONES.limb }, material: 'bone', at: [0, stalker ? -.4 : -.27, 0], scale: [1, stalker ? 1.35 : .85, 1] });
  const shieldPart: Part = { name: 'shield', shape: { geometry: BONES.shield }, material: 'iron', at: [-.02, -.36, -.16], rot: [-Math.PI / 2, 0, 0], hidden: stalker || warden, parts: shieldParts };
  armParts[0]!.push(shieldPart);
  if (stalker) for (let i = 0; i < 2; i++) {
    for (let c = 0; c < 3; c++) armParts[i]!.push({ name: `claw-${i === 0 ? 'l' : 'r'}-${c}`, shape: { geometry: BONES.claw }, material: 'bone', rot: [-Math.PI / 2, (1 - c) * .25, 0, 'YXZ'], at: [(c - 1) * .15, -.83, -.16] });
  }
  legParts[0]!.push({ name: 'leg-shape-l', shape: { geometry: BONES.limb }, material: 'bone', at: [0, -.25, 0], scale: [1, .75, 1] });
  legParts[1]!.push({ name: 'leg-shape-r', shape: { geometry: BONES.limb }, material: 'bone', at: [0, -.25, 0], scale: [1, .75, 1] });
  if (warden) {
    legParts[0]!.push({ name: 'greave-l', shape: { geometry: BONES.armor }, material: 'iron', at: [0, -.29, 0], scale: [.55, .7, .65] });
    legParts[1]!.push({ name: 'greave-r', shape: { geometry: BONES.armor }, material: 'iron', at: [0, -.29, 0], scale: [.55, .7, .65] });
  }

  // enemyDetails()'s limb loop: a joint, two shaft halves and a cap, per limb - arm caps are iron unless
  // stalker (bone, to keep the claw the only dark accent), leg caps are bone unless warden (iron, greaved).
  const limbConfig: { i: number; arm: boolean; parts: (Part | Node)[] }[] = [
    { i: 0, arm: true, parts: armParts[0]! }, { i: 1, arm: true, parts: armParts[1]! },
    { i: 2, arm: false, parts: legParts[0]! }, { i: 3, arm: false, parts: legParts[1]! },
  ];
  for (const { i, arm, parts } of limbConfig) {
    const length = arm && stalker ? .8 : arm ? .5 : .48;
    const tag = `${arm ? 'arm' : 'leg'}-${i}`;
    trim(parts, `${tag}-joint`, 'joint', 'bone', [0, -length * .48, 0], [.095, .085, .095]);
    trim(parts, `${tag}-shaft-a`, 'shaft', 'bone', [-.036, -length * .71, -.018], [.032, length * .38, .037], [0, 0, .1]);
    trim(parts, `${tag}-shaft-b`, 'shaft', 'bone', [.036, -length * .71, -.018], [.032, length * .38, .037], [0, 0, -.1]);
    if (!arm) trim(parts, `${tag}-cap`, 'box', warden ? 'iron' : 'bone', [0, -.45, -.08], [.16, .09, .29]);
    else trim(parts, `${tag}-cap`, 'box', stalker ? 'bone' : 'iron', [0, -length, -.035], [.16, .13, .14]);
  }
  rigParts.push({ name: 'arm-l', at: [-(warden ? .48 : .33), 1.14, 0], rot: [0, 0, -(stalker ? .25 : .12)], parts: armParts[0]! });
  rigParts.push({ name: 'arm-r', at: [warden ? .48 : .33, 1.14, 0], rot: [0, 0, stalker ? .25 : .12], parts: armParts[1]! });
  rigParts.push({ name: 'leg-l', at: [-(warden ? .25 : .18), .53, 0], parts: legParts[0]! });
  rigParts.push({ name: 'leg-r', at: [warden ? .25 : .18, .53, 0], parts: legParts[1]! });

  // makeSkeleton()'s own weapon, then rig.add(...weapon) below.
  if (warden) {
    weaponParts.push({ name: 'haft', shape: { geometry: BONES.haft }, material: 'brass', rot: [Math.PI / 2, 0, 0], at: [0, 0, -.42] });
    weaponParts.push({ name: 'head', shape: { geometry: BONES.hammer }, material: 'iron', at: [0, 0, -1.04], parts: [{ name: 'band', shape: { geometry: BONES.hammer }, material: 'brass', scale: [.18, 1.04, 1.04] }] });
  } else if (!stalker) {
    weaponParts.push({ name: 'blade', shape: { geometry: BONES.blade }, material: 'iron', at: [0, 0, -.4] });
  }
  rigParts.push({ name: 'weapon', at: [warden ? .5 : .42, .97, -.12], rot: [warden ? .45 : .1, 0, 0], parts: weaponParts });

  // enemyDetails()'s rig-level rib/joint loop (ribs skip when warden - the plate armour covers them).
  for (let i = 0; i < 4; i++) {
    if (!warden) trim(rigParts, `rib-${i}`, 'rib', 'bone', [0, .78 + i * .09, -.025], [.23 + i * .022, .2, .24 + i * .013], [Math.PI / 2, 0, -Math.PI * .78]);
    trim(rigParts, `rib-joint-${i}`, 'joint', 'bone', [0, .72 + i * .13, .075], [.1, .07, .075]);
  }

  // enemyDetails()'s kind branch: warden's plate armour and hammer bands, stalker's spine spikes and
  // cloak, or the guard's tabard, shield rim and sword guard.
  if (warden) {
    for (const s of [-1, 1] as const) {
      const side = s < 0 ? 'l' : 'r';
      for (let i = 0; i < 3; i++) trim(rigParts, `pauldron-${side}-${i}`, 'box', i === 0 ? 'brass' : 'iron', [s * (.49 + i * .04), 1.25 - i * .095, -.025], [.38, .1, .47], [0, 0, s * -.22]);
      for (let i = 0; i < 2; i++) trim(rigParts, `spaulder-${side}-${i}`, 'spike', 'brass', [s * (.48 + i * .16), 1.46, .04], [.08, .26 + i * .08, .08], [0, 0, s * -.3]);
      trim(rigParts, `tabard-${side}`, 'cloth', 'cloth', [s * .18, .56, -.25], [.33, .64, 1], [0, 0, s * -.12]);
      trim(rigParts, `collar-${side}`, 'box', 'brass', [s * .23, 1.04, -.23], [.042, .35, .032], [0, 0, s * -.25]);
      trim(weaponParts, `weapon-plate-${side}`, 'box', 'brass', [s * .3, 0, -1.04], [.07, .41, .42]);
      trim(weaponParts, `weapon-spike-${side}`, 'spike', 'iron', [s * .46, 0, -1.04], [.13, .23, .13], [0, 0, s * -Math.PI / 2]);
    }
    trim(rigParts, 'gorget', 'joint', 'brass', [0, 1.12, -.255], [.1, .13, .035]);
    trim(rigParts, 'chest-rim', 'box', 'brass', [0, 1.235, -.2], [.7, .03, .06]);
    trim(rigParts, 'chest-rib', 'box', 'iron', [0, 1.0, -.235], [.05, .4, .03]);
    for (let i = 0; i < 3; i++) trim(rigParts, `fauld-${i}`, 'box', 'iron', [0, .71 - i * .08, 0], [.5 + i * .02, .1, .3 + i * .02]);
    trim(weaponParts, 'weapon-band-h', 'box', 'brass', [0, .19, -1.04], [.32, .025, .1]);
    trim(weaponParts, 'weapon-band-v', 'box', 'brass', [0, .19, -1.04], [.07, .025, .32]);
  } else if (stalker) {
    for (let i = 0; i < 5; i++) trim(rigParts, `spine-spike-${i}`, 'spike', 'bone', [0, .8 + i * .135, .13], [.065, (.23 + i * .04) * 1.25, .065], [.8, 0, 0]);
    for (const s of [-1, 1] as const) trim(rigParts, `cloak-${s < 0 ? 'l' : 'r'}`, 'cloth', 'cloth', [s * .2, .67, .12], [.32, .69, 1], [-.3, s * .5, s * -.25]);
  } else {
    trim(rigParts, 'tabard', 'cloth', 'cloth', [0, .53, -.17], [.52, .53, 1]);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; trim(shieldParts, `rivet-${i}`, 'joint', 'brass', [Math.sin(a) * .31, .069, Math.cos(a) * .31], [.031, .025, .031]); }
    trim(shieldParts, 'cross-h', 'box', 'brass', [0, .065, 0], [.055, .026, .64]);
    trim(shieldParts, 'cross-v', 'box', 'brass', [0, .065, 0], [.64, .026, .055]);
    // shieldRim in the reference was a torus pre-rotated into its own geometry; a part-level rotation ends
    // up the same, since bakeStatic applies each mesh's own local matrix to its geometry when it flattens.
    shieldParts.push({ name: 'rim', shape: { torus: [.36, .025, 4, 16] }, material: 'brass', at: [0, .055, 0], rot: [Math.PI / 2, 0, 0] });
    trim(weaponParts, 'weapon-guard', 'box', 'brass', [0, 0, .025], [.32, .07, .08]);
    trim(weaponParts, 'weapon-tip', 'spike', 'iron', [0, 0, -.69], [.095, .34, .035], [-Math.PI / 2, 0, 0]);
    trim(rigParts, 'baldric', 'box', 'iron', [.32, 1.17, 0], [.3, .16, .34], [0, 0, -.2]);
  }

  return { name: 'rig', at: [0, stalker ? -.18 : 0, 0], rot: [stalker ? -.38 : 0, 0, 0], parts: rigParts };
}

export function makeSkeleton(kind: SkeletonKind) {
  const stalker = kind === 'stalker', warden = kind === 'warden';
  // Bone used to sit at the knight's own value, which is why four figures in one hall read as four of the
  // same thing. It comes down and goes cold, and the three kinds part company: the guard a flat grey, the
  // stalker greener and dimmer for something that waits. No gold on any of them outshines the knight's.
  //
  // The warden is the exception this round rebuilt. He was pale bone at L69 over near-black navy at L16,
  // which is the knight's own value structure - his brightest quarter and his darkest quarter - worn by a
  // figure a third larger. A blind review comparing the keep to the reference found every pair readable
  // but this one: knight and both wardens in a single dark-navy/white cluster on a dark teal floor,
  // reading as one blob with the cloak the only separator. So the bone comes down twenty-two points of L,
  // to L47. That is the whole of the change: the white end of the cluster goes, and the warden is a mid
  // mass inside a figure whose own range still runs L4 to L88.
  //
  // What it does NOT do is flatten him, and that was measured rather than assumed. A first pass took the
  // warden to a near-neutral cool grey on the theory that low chroma separates against all three room
  // families at once. It lost three and a half points of separation: at the torso the knight reads as his
  // own plate, cool violet at b=-8.5, and the warden's warm bone at b=+9 was carrying most of the distance
  // between them. Neutralising the warden spent the hue axis to buy value, and the two do not trade at
  // par. The warm-tan bone stays and only its value moves, which is the axis the reviewer named.
  const bone = new THREE.MeshStandardMaterial({ color: warden ? 0x776e5d : stalker ? 0x6f9084 : 0x9ca39a, roughness: 0.84 });
  // The other half of the cluster. The warden's plate was a dark navy three units of Lab from the knight's
  // own iron, and in the stair chamber that plate is most of the warden's torso and the breastplate is most
  // of the knight's - two figures carrying the same dark mass in the same hue. It leaves navy for the
  // drowned green the rest of the keep's dead already wear, and comes up three points of L on the way out
  // so the warden is not simply a hole.
  const iron = new THREE.MeshStandardMaterial({ color: warden ? 0x27302d : 0x3f4a53, roughness: 0.5, metalness: 0.5 });
  // The warden's gold was the warmest thing on any skeleton and the nearest any of them came to the
  // knight's own accent. Six points of value off it: still a crown, no longer a second brass figure.
  const brass = new THREE.MeshStandardMaterial({ color: warden ? 0x7a6c43 : 0x6f6244, roughness: .52, metalness: .55 });
  // Eye colour is the cheapest rank badge there is: one unlit speck already being drawn, and it names the
  // kind from across the room before the silhouette has resolved. Fog stays on, unlike the tell.
  const eye = new THREE.MeshBasicMaterial({ color: warden ? 0xffd23a : stalker ? 0xd6ff5e : 0xff8a2a, toneMapped: false });
  const shadow = new THREE.MeshStandardMaterial({ color: 0x101b1c, roughness: 1 });
  // The guard's tabard and the stalker's cloak: everything the enemies wear is cold, so the warm half of
  // the wheel belongs to the knight alone; the warden's tabard is the same drowned green at the same value.
  const cloth = new THREE.MeshStandardMaterial({ color: warden ? 0x2a3a33 : stalker ? 0x334b43 : 0x3d4a48, roughness: 1, side: THREE.DoubleSide });

  const { root: rig, byName } = buildSpec(skeletonSpec(kind), { bone, iron, brass, eye, shadow, cloth });
  const g = new THREE.Group(); g.add(rig);

  const skull = byName['skull'] as THREE.Group;
  const eyes = [byName['eye-l'] as THREE.Mesh, byName['eye-r'] as THREE.Mesh];
  const weapon = byName['weapon'] as THREE.Group;
  const limbs = [byName['arm-l'] as THREE.Group, byName['arm-r'] as THREE.Group, byName['leg-l'] as THREE.Group, byName['leg-r'] as THREE.Group];
  const shield = byName['shield'] as THREE.Mesh;

  g.userData.rig = rig;
  g.userData.eyes = eyes;
  g.userData.weapon = weapon;
  g.userData.limbs = limbs; g.userData.skull = skull; g.userData.shield = shield;

  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Plan 011: nothing below a joint moves on its own, so each joint draws one mesh per material. The rig
  // keeps every animated joint and the eyes (Basic, never merged); each joint keeps the shield, which
  // hangs off the shield arm and is a joint death poses, and the shield bakes its own brass. Keyed per
  // kind, so a floor of guards merges once; geometry is shared, every body binds its own materials.
  const joints: THREE.Object3D[] = [skull, ...limbs, weapon];
  bakeStatic(rig, { keep: [...joints, ...eyes], cacheKey: `${kind}:rig` });
  joints.forEach((joint, i) => bakeStatic(joint, { keep: [shield], cacheKey: `${kind}:joint${i}` }));
  bakeStatic(shield, { cacheKey: `${kind}:shield` });
  // Weaker than the knight's, and sized to the actor: the reference grounds the enemies too, but the
  // player's own pool has to stay the darkest thing at his feet.
  g.add(contactShadow(warden ? .68 : stalker ? .56 : .52, .44));
  return g;
}
