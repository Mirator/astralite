import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = new RoundedBoxGeometry(1, 1, 1, 1, .08);
const joint = new THREE.IcosahedronGeometry(1, 0);
const shaft = new THREE.CylinderGeometry(.72, 1, 1, 6);
const spike = new THREE.ConeGeometry(1, 1, 4);
const rib = new THREE.TorusGeometry(1, .13, 4, 10, Math.PI * 1.65);
const clothShape = new THREE.Shape();
clothShape.moveTo(-.5, .5); clothShape.lineTo(.5, .5); clothShape.lineTo(.43, -.42); clothShape.lineTo(.15, -.33); clothShape.lineTo(0, -.5); clothShape.lineTo(-.18, -.36); clothShape.lineTo(-.4, -.45); clothShape.closePath();
const cloth = new THREE.ShapeGeometry(clothShape);
const cache = new Map<string, THREE.BufferGeometry>();

// Every character in the reference sits in a soft pool of its own; ours sat on top of the paving with
// nothing between the boots and the stone, which is why the knight reads as a sprite pasted over the
// floor in the dash strip. The moon already casts a real shadow, but it is long, offset by most of a
// tile and regularly thrown behind the near-side structure the verticality pass put in — it says where
// the light is, not where the feet are. This is the other half: a small dark pool directly under the
// figure, one draw call each.
//
// It multiplies the frame rather than veiling it in black, so the paving keeps its hue and a torch pool
// under a figure is dimmed instead of being punched out. Multiply takes its strength from the texel and
// not from `opacity`, so each strength is its own 32px gradient; there are two of them.
const shadowTextures = new Map<number, THREE.DataTexture>();
function shadowFalloff(strength: number) {
  const key = Math.round(strength * 100);
  let texture = shadowTextures.get(key);
  if (!texture) {
    const size = 32, mid = (size - 1) / 2, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // Squared falloff twice over: solid under the boots, and nothing at the rim that reads as an edge.
      const t = Math.min(1, Math.hypot(x - mid, y - mid) / mid), k = (1 - t * t) ** 2;
      const v = Math.round(255 * (1 - strength * k)), i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
    texture = new THREE.DataTexture(data, size, size);
    // Declared sRGB so the decode on the way in and the encode on the way out cancel: the texel is the
    // multiplier, and 0.45 in the table is 0.45 on the floor.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true; shadowTextures.set(key, texture);
  }
  return texture;
}
const shadowDisc = new THREE.CircleGeometry(1, 24);
shadowDisc.rotateX(-Math.PI / 2);
shadowDisc.userData.shared = true;
// The moon sits at a fixed offset from whoever it is lighting, so its direction never changes and the
// pool can lean the same way in every room: down-light from (-7, 12, 9) puts the contact at +x, -z.
const SHADOW_LEAN = [.15, -.19];

/**
 * A grounding pool for one character. It is parented to the actor so it is culled and disposed with it,
 * but it refuses the actor's transform: the knight bobs, pitches into a dash and is thrown by hit-stop,
 * and a shadow that bobs with him is worse than none. `onBeforeRender` runs before the renderer builds
 * the model-view matrix, so writing the world matrix there pins the pool flat on the floor at the
 * actor's x and z whatever the actor is doing above it. The actor's scale is refused with the rest of
 * it — the warden is drawn at 1.3 and his pool is sized here instead — and the height is the floor's,
 * not the actor's, which holds for every room the generator can build because it lays standable cells
 * at one level only. A figure ever put on a ledge would need that y to come from under him.
 */
export function contactShadow(radius: number, strength: number) {
  const mesh = new THREE.Mesh(shadowDisc, new THREE.MeshBasicMaterial({
    // Opacity is always 1 here, so premultiplied is a formality — but three refuses MultiplyBlending
    // without it, loudly, on every program it compiles.
    map: shadowFalloff(strength), blending: THREE.MultiplyBlending, transparent: true,
    premultipliedAlpha: true, depthWrite: false, toneMapped: false,
  }));
  mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
  mesh.frustumCulled = false; mesh.renderOrder = 3;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.onBeforeRender = () => {
    const parent = mesh.parent?.matrixWorld.elements;
    if (!parent) return;
    mesh.matrixWorld.set(
      radius, 0, 0, parent[12] + SHADOW_LEAN[0],
      0, 1, 0, .028,
      0, 0, radius, parent[14] + SHADOW_LEAN[1],
      0, 0, 0, 1,
    );
  };
  return mesh;
}
type Palette = { steel: THREE.Material; iron: THREE.Material; brass: THREE.Material; red: THREE.Material; leather: THREE.Material; shadow: THREE.Material };

// Bake static trim per joint/material once per character type. The animated joints
// remain separate; dozens of rivets and bones don't each cost a draw call.
function dressing(preset: string) {
  const parts = new Map<THREE.Object3D, Map<THREE.Material, { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]>>();
  const pose = new THREE.Object3D();
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, at: number[], size: number[], rotate = [0, 0, 0]) => {
    let materials = parts.get(parent); if (!materials) { materials = new Map(); parts.set(parent, materials); }
    let items = materials.get(material); if (!items) { items = []; materials.set(material, items); }
    pose.position.set(at[0], at[1], at[2]); pose.scale.set(size[0], size[1], size[2]); pose.rotation.set(rotate[0], rotate[1], rotate[2]); pose.updateMatrix();
    items.push({ geometry, matrix: pose.matrix.clone() });
  };
  const finish = () => {
    let index = 0;
    for (const [parent, materials] of parts) for (const [material, items] of materials) {
      const key = `${preset}:${index++}`;
      let geometry = cache.get(key);
      if (!geometry) {
        const pieces = items.map(item => { const piece = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone(); piece.applyMatrix4(item.matrix); piece.deleteAttribute('uv'); return piece; });
        geometry = mergeGeometries(pieces)!; pieces.forEach(piece => piece.dispose());
        geometry.userData.shared = true; cache.set(key, geometry);
      }
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    }
  };
  return { add, finish };
}

export function knightDetails(rig: { torso: THREE.Group; head: THREE.Group; arm: THREE.Group; legs: THREE.Group[]; cape: THREE.Mesh }, m: Palette) {
  const { add, finish } = dressing('knight');
  // Warm metal edges, a deep visor, and a red split surcoat keep the hero distinct from bone.
  for (const side of [-1, 1]) {
    add(rig.head, box, m.brass, [side * .22, -.025, -.263], [.023, .19, .027], [0, 0, side * -.16]);
    for (let i = 0; i < 3; i++) add(rig.head, joint, m.shadow, [side * (.085 + i * .046), -.095, -.257], [.017, .022, .012]);
    add(rig.torso, cloth, m.red, [side * .145, -.2, -.235], [.31, .64, 1], [0, 0, side * -.06]);
    for (let i = 0; i < 3; i++) {
      add(rig.torso, box, i === 0 ? m.steel : m.iron, [side * (.4 + i * .02), .5 - i * .08, -.01], [.4 - i * .025, .1, .43], [0, 0, side * -.16]);
      add(rig.torso, joint, m.brass, [side * (.39 + i * .022), .505 - i * .08, -.24], [.028, .028, .016]);
    }
    // A gold rim along the top edge of the top pauldron. The camera is isometric and spends most of its
    // pixels on a figure's upward faces, and before this the only thing up there was grey plate and three
    // rivets: the accent was all on the back of him, where a cape is. One extra piece per side, merged
    // into the brass batch that was already being drawn, so it is free.
    add(rig.torso, box, m.brass, [side * .405, .552, -.196], [.39, .036, .075], [0, 0, side * -.16]);
    add(rig.torso, box, m.brass, [side * .19, .3, -.329], [.17, .024, .018], [0, 0, side * -.42]);
    add(rig.torso, box, m.leather, [side * .22, .18, -.337], [.048, .31, .022], [0, 0, side * .22]);
  }
  // A small sun clasp repeats the keep's heraldry without turning the whole chest into a light.
  add(rig.torso, joint, m.brass, [0, .28, -.355], [.066, .08, .025]);
  add(rig.head, box, m.brass, [0, .19, .015], [.045, .21, .36], [.16, 0, 0]);
  // An isometric camera spends most of its pixels on the top of the head, so the crest is scaled up rather
  // than multiplied: the same three cones, carrying twice the accent into the part of the silhouette the
  // player is actually looking at, and costing nothing extra to draw.
  for(let i=0;i<3;i++)add(rig.head,spike,m.red,[0,.375-i*.025,.09+i*.10],[.088,.40-i*.055,.105],[.8+i*.18,0,0]);
  for (const leg of rig.legs) {
    const knee = leg.userData.knee as THREE.Group;
    add(knee, box, m.steel, [0, -.11, -.16], [.2, .075, .18]);
    add(knee, box, m.brass, [0, .012, -.14], [.13, .024, .025]);
  }
  add(rig.arm, box, m.iron, [0, -.26, -.12], [.23, .2, .28], [.12, 0, 0]);
  add(rig.arm, box, m.brass, [0, -.19, -.22], [.235, .025, .025]);
  // Sewn edge and heraldry use vertex colours, so they travel with every cloth fold.
  const positions = rig.cape.geometry.getAttribute('position'), colours = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    const free=-y/.98,border=Math.abs(x)>(.37+free*.15)*.9||free>.94;
    // The old device was a cross bar and a stem, laid on a grid nine vertices wide. Interpolated across
    // the triangles it never resolved into anything: in the strike strip it is a cream smear in the
    // middle of the cape, and a smear is the one thing on the knight a player has to read past. A single
    // gold seam running the length of the cloth reads as a seam at every size, and keeps the same bright
    // area on the figure.
    const seam=Math.abs(x)<(.37+free*.15)*.12&&free>.14&&free<.9;
    const color = new THREE.Color(border || seam ? 0xf3c46d : 0xcb2130); colours.push(color.r, color.g, color.b);
  }
  rig.cape.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  rig.cape.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, emissive: 0x330c09, side: THREE.DoubleSide });
  finish();
}

// Plan 011: at .03-.06 units an .08 bevel is under a pixel from the game camera and costs nine times the
// triangles of the box it rounds, so the thinnest enemy trim is a plain box.
const plainBox = new THREE.BoxGeometry(1, 1, 1);
// The guard's shield rim (plan 011): iron on a dark floor read only through its studs.
const shieldRim = new THREE.TorusGeometry(.36, .025, 4, 16).rotateX(Math.PI / 2);
export function enemyDetails(kind: 'guard' | 'stalker' | 'warden', rig: THREE.Group, skull: THREE.Object3D, limbs: THREE.Group[], weapon: THREE.Group, shield: THREE.Mesh, bone: THREE.Material, iron: THREE.Material, brass: THREE.Material) {
  const { add: put, finish } = dressing(kind), stalker = kind === 'stalker', warden = kind === 'warden';
  const add: typeof put = (parent, geometry, material, at, size, rotate) => put(parent, geometry === box && Math.min(...size) < .06 ? plainBox : geometry, material, at, size, rotate);
  const shadow = new THREE.MeshStandardMaterial({ color: 0x101b1c, roughness: 1 });
  // The guard's tabard was brown and the warden's a muted wine, which put both of them in the knight's own
  // hue family. Everything the enemies wear is cold now; the warm half of the wheel belongs to him alone.
  //
  // The warden's was then a dark navy, which is the knight's iron to within six units of Lab. It turns to
  // the drowned green the guard and the stalker already wear, at the same value, so the tabard stops
  // pulling the warden's torso back into the knight's hue while he keeps his weight.
  const clothMaterial = new THREE.MeshStandardMaterial({ color: warden ? 0x2a3a33 : stalker ? 0x334b43 : 0x3d4a48, roughness: 1, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    add(skull, joint, shadow, [s * .105, .045, -.223], [.1, .083, .026]);
    add(skull, box, bone, [s * .14, -.092, -.19], [.1, .11, .1], [0, 0, s * .24]);
    add(skull, box, bone, [s * .11, .13, -.22], [.16, .047, .05], [0, 0, s * -.22]);
  }
  add(skull, joint, shadow, [0, -.043, -.244], [.043, .05, .018]);
  add(skull, box, bone, [0, -.17, -.13], [.31, .075, .18]);
  for (let i = 0; i < 5; i++) add(skull, box, bone, [(i - 2) * .049, -.128, -.22], [.03, .055, .045]);
  for (let i = 0; i < 4; i++) {
    if (!warden) add(rig, rib, bone, [0, .78 + i * .09, -.025], [.23 + i * .022, .2, .24 + i * .013], [Math.PI / 2, 0, -Math.PI * .78]);
    add(rig, joint, bone, [0, .72 + i * .13, .075], [.1, .07, .075]);
  }
  limbs.forEach((limb, i) => {
    const arm = i < 2, length = arm && stalker ? .8 : arm ? .5 : .48;
    add(limb, joint, bone, [0, -length * .48, 0], [.095, .085, .095]);
    for (const s of [-1, 1]) add(limb, shaft, bone, [s * .036, -length * .71, -.018], [.032, length * .38, .037], [0, 0, s * -.1]);
    if (!arm) add(limb, box, warden ? iron : bone, [0, -.45, -.08], [.16, .09, .29]);
    else add(limb, box, stalker ? bone : iron, [0, -length, -.035], [.16, .13, .14]);
  });
  if (warden) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) add(rig, box, i === 0 ? brass : iron, [s * (.49 + i * .04), 1.25 - i * .095, -.025], [.38, .1, .47], [0, 0, s * -.22]);
      for (let i = 0; i < 2; i++) add(rig, spike, brass, [s * (.48 + i * .16), 1.46, .04], [.08, .26 + i * .08, .08], [0, 0, s * -.3]);
      add(rig, cloth, clothMaterial, [s * .18, .56, -.25], [.33, .64, 1], [0, 0, s * -.12]);
      add(rig, box, brass, [s * .23, 1.04, -.23], [.042, .35, .032], [0, 0, s * -.25]);
      add(weapon, box, brass, [s * .3, 0, -1.04], [.07, .41, .42]);
      add(weapon, spike, iron, [s * .46, 0, -1.04], [.13, .23, .13], [0, 0, s * -Math.PI / 2]);
    }
    add(rig, joint, brass, [0, 1.12, -.255], [.1, .13, .035]);
    add(weapon, box, brass, [0, .19, -1.04], [.32, .025, .1]);
    add(weapon, box, brass, [0, .19, -1.04], [.07, .025, .32]);
  } else if (stalker) {
    for (let i = 0; i < 5; i++) add(rig, spike, bone, [0, .8 + i * .135, .13], [.065, (.23 + i * .04) * 1.25, .065], [.8, 0, 0]);
    for (const s of [-1, 1]) {
      add(rig, cloth, clothMaterial, [s * .2, .67, .12], [.32, .69, 1], [-.3, s * .5, s * -.25]);
      add(skull, spike, bone, [s * .18, -.2, -.19], [.045, .19, .045], [Math.PI, 0, s * -.12]);
      add(skull, spike, shadow, [s * .2, .17, .04], [.1, .24, .1], [0, 0, s * -.25]);
    }
  } else {
    add(rig, cloth, clothMaterial, [0, .53, -.17], [.52, .53, 1]);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; add(shield, joint, brass, [Math.sin(a) * .31, .069, Math.cos(a) * .31], [.031, .025, .031]); }
    add(shield, box, brass, [0, .065, 0], [.055, .026, .64]);
    add(shield, box, brass, [0, .065, 0], [.64, .026, .055]);
    add(shield, shieldRim, brass, [0, .055, 0], [1, 1, 1]);
    add(weapon, box, brass, [0, 0, .025], [.32, .07, .08]);
    add(weapon, spike, iron, [0, 0, -.69], [.095, .34, .035], [-Math.PI / 2, 0, 0]);
    add(rig, box, iron, [.32, 1.17, 0], [.3, .16, .34], [0, 0, -.2]);
  }
  finish();
}
