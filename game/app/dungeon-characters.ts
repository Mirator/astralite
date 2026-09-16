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

export function knightDetails(rig: { torso: THREE.Group; head: THREE.Group; sword: THREE.Group; arm: THREE.Group; legs: THREE.Group[]; cape: THREE.Mesh }, m: Palette) {
  const { add, finish } = dressing('knight');
  // Warm metal edges, a deep visor, and a red split surcoat keep the hero distinct from bone.
  for (const side of [-1, 1]) {
    add(rig.head, box, m.brass, [side * .22, -.025, -.263], [.023, .19, .027], [0, 0, side * -.16]);
    for (let i = 0; i < 3; i++) add(rig.head, joint, m.shadow, [side * (.085 + i * .046), -.095, -.257], [.017, .022, .012]);
    add(rig.torso, cloth, m.red, [side * .13, -.19, -.235], [.24, .57, 1], [0, 0, side * -.06]);
    for (let i = 0; i < 3; i++) {
      add(rig.torso, box, i === 0 ? m.steel : m.iron, [side * (.4 + i * .02), .5 - i * .08, -.01], [.4 - i * .025, .1, .43], [0, 0, side * -.16]);
      add(rig.torso, joint, m.brass, [side * (.39 + i * .022), .505 - i * .08, -.24], [.028, .028, .016]);
    }
    add(rig.torso, box, m.brass, [side * .19, .3, -.329], [.17, .024, .018], [0, 0, side * -.42]);
    add(rig.torso, box, m.leather, [side * .22, .18, -.337], [.048, .31, .022], [0, 0, side * .22]);
  }
  // A small sun clasp repeats the keep's heraldry without turning the whole chest into a light.
  add(rig.torso, joint, m.brass, [0, .28, -.355], [.066, .08, .025]);
  add(rig.head, box, m.brass, [0, .19, .015], [.045, .21, .36], [.16, 0, 0]);
  for(let i=0;i<3;i++)add(rig.head,spike,m.red,[0,.36-i*.025,.09+i*.09],[.065,.3-i*.045,.08],[.8+i*.18,0,0]);
  add(rig.sword, box, m.steel, [0, .039, -.59], [.025, .012, .86]);
  for (let i = 0; i < 4; i++) add(rig.sword, box, m.brass, [0, .045, -.27 - i * .1], [.065, .012, .023], [0, Math.PI / 4, 0]);
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
    const free=-y/.98,border=Math.abs(x)>(.3+free*.12)*.88||free>.94;
    const sigil=free>.2&&free<.58&&(Math.abs(x)<.04||Math.abs(free-.34)<.055&&Math.abs(x)<.16);
    const color = new THREE.Color(border || sigil ? 0xe2b571 : 0xa52c34); colours.push(color.r, color.g, color.b);
  }
  rig.cape.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  rig.cape.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, side: THREE.DoubleSide });
  finish();
}

export function enemyDetails(kind: 'guard' | 'stalker' | 'warden', rig: THREE.Group, skull: THREE.Mesh, limbs: THREE.Group[], weapon: THREE.Group, shield: THREE.Mesh, bone: THREE.Material, iron: THREE.Material, brass: THREE.Material) {
  const { add, finish } = dressing(kind), stalker = kind === 'stalker', warden = kind === 'warden';
  const shadow = new THREE.MeshStandardMaterial({ color: 0x101b1c, roughness: 1 });
  const clothMaterial = new THREE.MeshStandardMaterial({ color: warden ? 0x562f42 : stalker ? 0x334b43 : 0x61402d, roughness: 1, side: THREE.DoubleSide });
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
    for (let i = 0; i < 5; i++) add(rig, spike, bone, [0, .8 + i * .135, .13], [.065, .23 + i * .04, .065], [.8, 0, 0]);
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
    add(weapon, box, brass, [0, 0, .025], [.32, .07, .08]);
    add(weapon, spike, iron, [0, 0, -.69], [.095, .34, .035], [-Math.PI / 2, 0, 0]);
    add(rig, box, iron, [.32, 1.17, 0], [.3, .16, .34], [0, 0, -.2]);
  }
  finish();
}
