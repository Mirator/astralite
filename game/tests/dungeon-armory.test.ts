import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeWeapon, disposeWeaponDrop, makeBolt, makeWeapon, makeWeaponDrop, type ArmoryPalette, type Plate } from '../app/dungeon-armory.ts';
import { type WeaponId } from '../app/dungeon-weapon.ts';

// The knight's own palette and bevel, restated: the same material kinds and the same extrude settings as
// `makeKnight` in dungeon-game.tsx, which cannot be imported into node.
const palette = (): ArmoryPalette => ({
  steel: new THREE.MeshStandardMaterial({ color: 0xdcded9, flatShading: true }),
  iron: new THREE.MeshStandardMaterial({ color: 0x212436, flatShading: true }),
  brass: new THREE.MeshStandardMaterial({ color: 0xffc86a }),
  leather: new THREE.MeshStandardMaterial({ color: 0x2c1a14 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0a0e15 }),
  shadow: new THREE.MeshStandardMaterial({ color: 0x05090c }),
});
const plate: Plate = (outline, depth, material) => {
  const shape = new THREE.Shape(); outline.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -depth / 2); return new THREE.Mesh(geometry, material);
};
const ARMS: WeaponId[] = ['tideblade', 'fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask'];
const meshesOf = (root: THREE.Object3D) => { const found: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh && o.visible) found.push(o); }); return found; };
const trianglesOf = (root: THREE.Object3D) => meshesOf(root).reduce((sum, m) => sum + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);

// The slash ribbon samples the weapon's world path between these two points (dungeon-weapon-trail.ts,
// slash.spec.ts). Recorded off the arms before plan 009 touched them; a model change must not move them.
const TRAIL: Record<WeaponId, { inner: [number, number, number]; tip: [number, number, number] }> = {
  tideblade: { inner: [0, 0, -.32], tip: [0, 0, -1.17] },
  fangs: { inner: [0, 0, -.16], tip: [0, 0, -.66] },
  spear: { inner: [0, 0, -1.05], tip: [0, 0, -1.98] },
  cleaver: { inner: [0, 0, -.36], tip: [.1, 0, -1.32] },
  maul: { inner: [0, 0, -.95], tip: [0, 0, -1.42] },
  crossbow: { inner: [0, .13, -.5], tip: [0, .13, -.84] },
  flask: { inner: [0, .05, -.28], tip: [0, .05, -.52] },
};
// In-hand triangles before plan 009. The four arms 009 only bakes keep theirs exactly; the three it
// reshapes (fangs, spear, crossbow) may spend up to 30 more.
const TRIANGLES: Record<WeaponId, number> = { tideblade: 228, fangs: 120, spear: 192, cleaver: 136, maul: 112, crossbow: 124, flask: 328 };
const RESHAPED = new Set<WeaponId>(['fangs', 'spear', 'crossbow']);

test('every arm keeps the trail points the slash ribbon samples', () => {
  const m = palette();
  for (const id of ARMS) {
    const arm = makeWeapon(id, m, plate);
    assert.deepEqual(arm.inner.toArray(), TRAIL[id].inner, `${id} inner moved`);
    assert.deepEqual(arm.tip.toArray(), TRAIL[id].tip, `${id} tip moved`);
    disposeWeapon(arm, m);
  }
});

test('an arm in hand is one mesh per material it uses; the flask adds only its ember', () => {
  const m = palette();
  for (const id of ARMS) {
    const arm = makeWeapon(id, m, plate), meshes = meshesOf(arm.group);
    const lit = meshes.filter(mesh => mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(new Set(lit.map(mesh => mesh.material)).size, lit.length, `${id} draws one material twice`);
    assert.ok(lit.length <= 4, `${id} is ${lit.length} lit meshes in hand`);
    assert.ok(meshes.length <= (id === 'flask' ? 5 : 4), `${id} is ${meshes.length} meshes in hand`);
    const triangles = trianglesOf(arm.group);
    if (RESHAPED.has(id)) assert.ok(triangles >= TRIANGLES[id] && triangles <= TRIANGLES[id] + 30, `${id} is ${triangles} triangles against ${TRIANGLES[id]}`);
    else assert.equal(triangles, TRIANGLES[id], `${id} changed its triangle count`);
    disposeWeapon(arm, m);
  }
});

test('a rack is at most eight meshes, keeps its return shape, and stays inside its ring from above', () => {
  const m = palette();
  for (const id of ARMS) {
    const drop = makeWeaponDrop(id, m, plate);
    const meshes = meshesOf(drop.group);
    assert.ok(meshes.length <= 8, `${id} rack is ${meshes.length} meshes`);
    assert.equal(drop.ring.parent, drop.group);
    assert.equal(drop.blade.group.parent, drop.group, 'blade.group is no longer the arm\'s group');
    assert.equal(drop.ring.castShadow, false);
    for (const mesh of meshes) if (mesh !== drop.ring) assert.equal(mesh.castShadow, true, `${id} rack lost a shadow`);
    // Projected onto the floor: the ring's outer edge is 1.3, and nothing the rack holds may pass it.
    drop.group.updateWorldMatrix(true, true);
    const point = new THREE.Vector3();
    let reach = 0;
    for (const mesh of meshes) {
      if (mesh === drop.ring) continue;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); reach = Math.max(reach, Math.hypot(point.x, point.z)); }
    }
    assert.ok(reach <= 1.3, `${id} rack reaches ${reach.toFixed(3)} from its centre, past the ring`);
  }
});

test('every arm casts and takes shadow as built, not only the one the knight starts with', () => {
  // makeKnight flags the figure once; an arm built for a later swap gets nothing from that.
  const m = palette();
  for (const id of ARMS) {
    const arm = makeWeapon(id, m, plate);
    for (const mesh of meshesOf(arm.group)) assert.ok(mesh.castShadow && mesh.receiveShadow, `${id} has a part out of the shadow map`);
    disposeWeapon(arm, m);
  }
});

test('releasing an arm or a rack disposes what it made and never the knight palette', () => {
  const m = palette(), shared = new Set<THREE.Material>(Object.values(m));
  let spent = 0;
  for (const material of shared) material.addEventListener('dispose', () => { spent++; });
  for (const id of ARMS) {
    for (const built of [makeWeapon(id, m, plate), makeWeaponDrop(id, m, plate)]) {
      const own = new Set<THREE.Material>();
      built.group.traverse(o => { if (o instanceof THREE.Mesh && !shared.has(o.material as THREE.Material)) own.add(o.material as THREE.Material); });
      let released = 0;
      for (const material of own) material.addEventListener('dispose', () => { released++; });
      const parent = new THREE.Group(); parent.add(built.group);
      if ('ring' in built) disposeWeaponDrop(built, m); else disposeWeapon(built, m);
      assert.equal(released, own.size, `${id} left a material of its own undisposed`);
      assert.equal(built.group.parent, null);
    }
  }
  assert.equal(spent, 0, 'a release disposed the knight palette');
});

test('a pooled bolt is three meshes and hidden until fired', () => {
  const bolt = makeBolt(palette());
  assert.equal(meshesOf(bolt).length, 3);
  assert.equal(bolt.visible, false);
});
