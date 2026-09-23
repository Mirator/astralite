// The geometry half of the weapon table. dungeon-weapon.ts says what an arm does; this says what it
// looks like, and the two are kept apart for the reason dungeon-floor and dungeon-game are kept apart:
// the numbers have to run in node, and three.js does not.
//
// Every arm is built from the primitives the knight is already built from, with the same palette, so a
// swapped weapon reads as part of the same figure rather than as a pasted-on asset. Each also declares
// where its blade starts and ends, because the slash ribbon samples the weapon's world-space path
// between those two points and a spear sampled at a sword's tip would trail from the middle of the haft.
import * as THREE from 'three';
import { bakeStatic } from './dungeon-bake.ts';
import { type WeaponId } from './dungeon-weapon.ts';

/** The knight's own materials, passed in rather than rebuilt so a weapon shares his palette exactly. */
export type ArmoryPalette = {
  steel: THREE.Material; iron: THREE.Material; brass: THREE.Material;
  leather: THREE.Material; dark: THREE.Material; shadow: THREE.Material;
};

/** The extruded-outline helper the knight is built with. */
export type Plate = (outline: number[][], depth: number, material: THREE.Material) => THREE.Mesh;

export type ArmedWeapon = {
  /** The weapon's own meshes. Hung off the sword pivot, which also carries the hand and the sleeve. */
  group: THREE.Group;
  /** Where the trail ribbon starts and ends, in the pivot's local space. */
  inner: THREE.Vector3;
  tip: THREE.Vector3;
};

/**
 * Build one arm. `plate` comes from the knight so both use the same bevel.
 *
 * Written part by part and then baked to one mesh per material (plan 009): every part was its own draw
 * call, twice over once it cast a shadow, and none of them moves on its own. No cache: a swap is rare,
 * and the merged geometry is the knight's to release through `disposeWeapon`. The flask's ember is
 * unlit and translucent, so it stays a mesh of its own.
 */
export function makeWeapon(id: WeaponId, m: ArmoryPalette, plate: Plate): ArmedWeapon {
  const arm = shapeWeapon(id, m, plate);
  bakeStatic(arm.group);
  return arm;
}

function shapeWeapon(id: WeaponId, m: ArmoryPalette, plate: Plate): ArmedWeapon {
  const group = new THREE.Group();
  const add = (mesh: THREE.Mesh, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) => {
    mesh.position.set(...position); mesh.rotation.set(...rotation); group.add(mesh); return mesh;
  };

  if (id === 'fangs') {
    // Two short blades, one to each side of the fist. Nothing here reaches: the whole arm is built to
    // be used from inside a guard's own swing, and it looks like it.
    // From above, two 0.10-wide blades with nothing between them read as two slivers rather than one
    // weapon (plan 009): the blades are a third wider on their broad face, and a brass knuckle bar runs
    // across both guards so the pair reads as one paired arm.
    for (const side of [-1, 1]) {
      const fang = plate([[-.065, 0], [.065, 0], [.07, .42], [0, .6], [-.07, .42]], .034, m.steel);
      add(fang, [side * .085, .036, 0], [-Math.PI / 2, 0, side * .07]);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(.13, .035, .05), m.brass);
      add(guard, [side * .085, .036, .06]);
    }
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(.2, .035, .05), m.brass);
    add(knuckle, [0, .036, .06]);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .17, 6), m.leather);
    add(wrap, [0, .03, .13], [Math.PI / 2, 0, 0]);
    return { group, inner: new THREE.Vector3(0, 0, -.16), tip: new THREE.Vector3(0, 0, -.66) };
  }

  if (id === 'spear') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(.036, .04, 2.1, 6), m.leather);
    add(haft, [0, .036, -.72], [Math.PI / 2, 0, 0]);
    // A 0.17-wide head was a few pixels at gameplay scale (plan 009): a quarter wider, with a brass lug
    // either side of the socket so the head has a base the eye can find.
    const head = plate([[-.09, 0], [.09, 0], [.11, .3], [0, .62], [-.11, .3]], .03, m.steel);
    add(head, [0, .036, -1.35], [-Math.PI / 2, 0, 0]);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(.055, .045, .2, 6), m.brass);
    add(socket, [0, .036, -1.29], [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(.18, .03, .05), m.brass);
      add(lug, [side * .12, .036, -1.22]);
    }
    // Three bindings up the haft, so the length reads at a glance from an isometric camera. Brass rather
    // than iron: iron on dark leather vanished, and the bindings are what says how long the haft is.
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .05, 6), m.brass);
      add(band, [0, .036, -.5 - i * .32], [Math.PI / 2, 0, 0]);
    }
    const butt = new THREE.Mesh(new THREE.DodecahedronGeometry(.055, 0), m.brass);
    add(butt, [0, .036, .3]);
    return { group, inner: new THREE.Vector3(0, 0, -1.05), tip: new THREE.Vector3(0, 0, -1.98) };
  }

  if (id === 'cleaver') {
    // A slab. The silhouette is the point: it should read as too much weapon from across a hall.
    const slab = plate([[-.07, 0], [.07, 0], [.34, .42], [.36, 1.02], [.18, 1.24], [-.2, 1.1], [-.24, .4]], .06, m.steel);
    add(slab, [0, .04, 0], [-Math.PI / 2, 0, 0]);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(.05, .02, 1.12), m.iron);
    add(spine, [-.13, .062, -.62]);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(.3, .07, .11), m.brass);
    add(collar, [.02, .04, .04]);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .28, 6), m.leather);
    add(grip, [0, .04, .18], [Math.PI / 2, 0, 0]);
    const pommel = new THREE.Mesh(new THREE.DodecahedronGeometry(.08, 0), m.iron);
    add(pommel, [0, .04, .34]);
    return { group, inner: new THREE.Vector3(0, 0, -.36), tip: new THREE.Vector3(.1, 0, -1.32) };
  }

  if (id === 'maul') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(.05, .055, 1.36, 6), m.leather);
    add(haft, [0, .04, -.5], [Math.PI / 2, 0, 0]);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.34, .3, .46), m.iron);
    add(head, [0, .04, -1.16]);
    // Banded like a bell, which is where the name comes from and what separates it from the cleaver.
    for (const z of [-1.3, -1.16, -1.02]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(.38, .07, .05), m.brass);
      add(band, [0, .04, z]);
    }
    for (const side of [-1, 1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.075, .19, 4), m.steel);
      add(spike, [side * .21, .04, -1.16], [0, 0, side * Math.PI / 2]);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.07, .06, .12, 6), m.brass);
    add(cap, [0, .04, .2], [Math.PI / 2, 0, 0]);
    return { group, inner: new THREE.Vector3(0, 0, -.95), tip: new THREE.Vector3(0, 0, -1.42) };
  }

  if (id === 'flask') {
    // Carried, not wielded: a satchel on the hip and one flask in the hand, so the silhouette says
    // "throwing" rather than "swinging" from across a hall.
    const body = new THREE.Mesh(new THREE.SphereGeometry(.17, 8, 6), m.brass);
    add(body, [0, .05, -.28]);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.055, .08, .16, 6), m.iron);
    add(neck, [0, .05, -.42], [Math.PI / 2, 0, 0]);
    const stopper = new THREE.Mesh(new THREE.DodecahedronGeometry(.055, 0), m.leather);
    add(stopper, [0, .05, -.5]);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(.17, .022, 4, 8), m.iron);
      add(band, [0, .05, -.28 + side * .06], [Math.PI / 2, 0, 0]);
    }
    const ember = new THREE.Mesh(new THREE.SphereGeometry(.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff9a45, transparent: true, opacity: .8 }));
    add(ember, [0, .05, -.28]);
    const satchel = new THREE.Mesh(new THREE.BoxGeometry(.24, .22, .16), m.leather);
    add(satchel, [0, -.06, .16]);
    return { group, inner: new THREE.Vector3(0, .05, -.28), tip: new THREE.Vector3(0, .05, -.52) };
  }

  if (id === 'crossbow') {
    // Read as a machine rather than a blade: a stock along the forearm, a bow across it, and a bolt in
    // the groove that is there whether or not the quiver is dry, because the silhouette should not
    // change under the player mid-fight.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(.13, .1, .92), m.leather);
    add(stock, [0, .04, -.3]);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, .78), m.dark);
    add(rail, [0, .1, -.36]);
    // The prod is the T that says "crossbow" from above, and in iron, the darkest material, it was lost
    // against the floor (plan 009). Pale steel, like the limbs it carries.
    const bow = new THREE.Mesh(new THREE.BoxGeometry(.96, .06, .09), m.steel);
    add(bow, [0, .06, -.66]);
    for (const side of [-1, 1]) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(.3, .05, .07), m.steel);
      add(limb, [side * .5, .06, -.62], [0, side * .32, 0]);
    }
    const string = new THREE.Mesh(new THREE.BoxGeometry(.9, .015, .015), m.steel);
    add(string, [0, .07, -.3]);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .5, 5), m.brass);
    add(bolt, [0, .13, -.5], [Math.PI / 2, 0, 0]);
    const head = new THREE.Mesh(new THREE.ConeGeometry(.045, .12, 4), m.steel);
    add(head, [0, .13, -.78], [-Math.PI / 2, 0, 0]);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(.16, .12, .14), m.brass);
    add(lock, [0, .03, -.02]);
    const butt = new THREE.Mesh(new THREE.BoxGeometry(.12, .16, .2), m.leather);
    add(butt, [0, -.01, .2], [.22, 0, 0]);
    // The ribbon is the bolt leaving the groove, not a swept edge, so both ends sit on the rail.
    return { group, inner: new THREE.Vector3(0, .13, -.5), tip: new THREE.Vector3(0, .13, -.84) };
  }

  // The Tideblade, exactly as the knight has always carried it.
  const blade = plate([[-.065, 0], [.065, 0], [.075, .87], [0, 1.158], [-.075, .87]], .045, m.steel);
  add(blade, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(.022, .006, .66), m.iron);
  add(fuller, [0, .038, -.45]);
  const hilt = plate([[-.23, -.035], [-.24, .045], [-.08, .075], [.08, .075], [.24, .045], [.23, -.035], [.07, .015], [-.07, .015]], .08, m.brass);
  add(hilt, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .2, 6), m.leather);
  add(grip, [0, 0, .12], [Math.PI / 2, 0, 0]);
  const pommel = new THREE.Mesh(new THREE.DodecahedronGeometry(.072, 0), m.brass);
  add(pommel, [0, 0, .24]);
  // The four brass rivets knightDetails used to add straight onto the pivot.
  for (let i = 0; i < 4; i++) {
    const rivet = new THREE.Mesh(new THREE.BoxGeometry(.065, .012, .023), m.brass);
    add(rivet, [0, .045, -.27 - i * .1], [0, Math.PI / 4, 0]);
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(.025, .012, .86), m.steel);
  add(edge, [0, .039, -.59]);
  return { group, inner: new THREE.Vector3(0, 0, -.32), tip: new THREE.Vector3(0, 0, -1.17) };
}

/** Release a weapon's geometry. Materials belong to the knight and outlive every swap. */
export function disposeWeapon(weapon: ArmedWeapon) {
  weapon.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  weapon.group.removeFromParent();
}

/**
 * What lies on the ground before it is picked up: the arm planted point-down in a stone block, leaning,
 * over a ring that marks it from across a room. Laid flat it read as a thin line from an isometric
 * camera — a spear in particular vanished into the floor — so the silhouette is stood upright, which is
 * the only orientation that says "weapon" from this angle without a label.
 */
export function makeWeaponDrop(id: WeaponId, m: ArmoryPalette, plate: Plate) {
  const group = new THREE.Group();
  const arm = makeWeapon(id, m, plate);
  // Local -Z is the blade; -90 degrees about X turns that into -Y, so the point goes into the stone.
  // Each arm is a different length, so how far it is lifted comes off its own tip rather than a constant.
  const blade = Math.abs(arm.tip.z);
  // Half again as large as the arm in hand. The camera sits far enough back that a life-sized weapon on
  // the floor is a few dark pixels; this is a marker the player has to be able to name from a doorway.
  arm.group.scale.setScalar(1.45);
  arm.group.rotation.set(-Math.PI / 2 + .3, 0, .18);
  arm.group.position.set(0, .52 + blade * 1.16, 0);
  group.add(arm.group);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.36, .46, .52, 6), m.iron);
  plinth.position.y = .26; group.add(plinth);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(.26, .06, 4, 8), m.brass);
  collar.rotation.x = Math.PI / 2; collar.position.y = .53; group.add(collar);
  // A warm glow off the plinth so the marker carries in the keep's dark halls without a HUD element.
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9ae, transparent: true, opacity: .55 }));
  glow.position.y = .6; group.add(glow);
  const ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.3, 40), new THREE.MeshBasicMaterial({ color: 0xfbc956, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .05; group.add(ring);
  group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = object !== ring; object.receiveShadow = object !== ring; } });
  // Once, after the arm is scaled and posed and every part has its shadow flags: the plinth and collar
  // fold into the arm's own iron and brass. The glow and the ring are translucent and stay as they are.
  // `blade.group` is still the arm's group, now empty; nothing reads its children.
  bakeStatic(group);
  return { group, ring, blade: arm };
}

/** A bolt in flight, pooled. Firing must never allocate: the suite asserts on GPU allocations per floor. */
export function makeBolt(m: ArmoryPalette) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .56, 5), m.brass);
  shaft.rotation.x = Math.PI / 2; group.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.055, .15, 4), m.steel);
  head.rotation.x = -Math.PI / 2; head.position.z = -.35; group.add(head);
  for (const side of [-1, 1]) {
    const fletch = new THREE.Mesh(new THREE.BoxGeometry(.01, .11, .16), m.dark);
    fletch.position.set(side * .03, 0, .24); group.add(fletch);
  }
  // Brass shaft, steel head, one batch for both fletches. Eight bolts are pooled per knight, so the
  // merged geometry is cached and shared; each bolt still draws with its own knight's materials. Baked
  // before it is hidden, since the bake leaves an invisible root alone.
  bakeStatic(group, { cacheKey: 'armory:bolt' });
  group.position.y = .95; group.visible = false;
  return group;
}

/** A flask in the air, pooled beside the bolts. */
export function makeFlask(m: ArmoryPalette) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), m.brass);
  group.add(body);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffb056, transparent: true, opacity: .85 }));
  group.add(ember);
  group.position.y = .95; group.visible = false;
  return group;
}

/**
 * Burning silt on the floor. Reuses the ember hazard's own colours, because it is the same thing the
 * keep does to the knight and should read as such when he does it back.
 */
export function makePoolMesh() {
  const mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> = new THREE.Mesh(
    new THREE.RingGeometry(.2, 1, 36),
    new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = .07; mesh.visible = false;
  return mesh;
}
