import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeWeapon, disposeWeaponDrop, makeWeapon, makeWeaponDrop, type ArmoryPalette, type Plate } from '../app/dungeon-armory.ts';
import { makeKnight } from '../app/dungeon-knight.ts';
import { type WeaponId } from '../app/dungeon-weapon.ts';

// The knight's own palette and bevel, off a knight built here: every arm he is handed is made from the
// materials he wears and the plate helper he is built with, and makeKnight hangs both on userData.
const armoury = () => makeKnight().userData.armoury as { palette: ArmoryPalette; plate: Plate };
const ARMS: WeaponId[] = ['tideblade', 'fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask'];
const meshesOf = (root: THREE.Object3D) => { const found: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh && o.visible) found.push(o); }); return found; };
const trianglesOf = (root: THREE.Object3D) => meshesOf(root).reduce((sum, m) => sum + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
// In-hand triangles before plan 009, plus the 30 it allowed the arms it reshaped. A budget, not a
// snapshot: an arm may get cheaper, but one that unbakes or doubles its bevels pays for it here.
const TRIANGLES: Record<WeaponId, number> = { tideblade: 228, fangs: 120, spear: 192, cleaver: 136, maul: 112, crossbow: 124, flask: 328 };

test('an arm in hand is one mesh per material it uses; the flask adds only its ember', () => {
  const { palette: m, plate } = armoury();
  for (const id of ARMS) {
    const arm = makeWeapon(id, m, plate), meshes = meshesOf(arm.group);
    const lit = meshes.filter(mesh => mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(new Set(lit.map(mesh => mesh.material)).size, lit.length, `${id} draws one material twice`);
    assert.ok(lit.length <= 4, `${id} is ${lit.length} lit meshes in hand`);
    assert.ok(meshes.length <= (id === 'flask' ? 5 : 4), `${id} is ${meshes.length} meshes in hand`);
    // Only the flask carries anything that is not the knight's own lit palette.
    assert.equal(meshes.length - lit.length, id === 'flask' ? 1 : 0, `${id} carries an unlit part`);
    const triangles = trianglesOf(arm.group);
    assert.ok(triangles <= TRIANGLES[id] + 30, `${id} is ${triangles} triangles against ${TRIANGLES[id]}`);
    disposeWeapon(arm, m);
  }
});

test('a rack is at most eight meshes, keeps its return shape, and stays inside its ring from above', () => {
  const { palette: m, plate } = armoury();
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
    disposeWeaponDrop(drop, m);
  }
});

test('every arm casts and takes shadow as built, not only the one the knight starts with', () => {
  // makeKnight flags the figure once; an arm built for a later swap gets nothing from that.
  const { palette: m, plate } = armoury();
  for (const id of ARMS) {
    const arm = makeWeapon(id, m, plate);
    for (const mesh of meshesOf(arm.group)) assert.ok(mesh.castShadow && mesh.receiveShadow, `${id} has a part out of the shadow map`);
    disposeWeapon(arm, m);
  }
});

test('releasing an arm or a rack disposes what it made and never the knight palette', () => {
  const { palette: m, plate } = armoury(), shared = new Set<THREE.Material>(Object.values(m));
  let spent = 0;
  for (const material of shared) material.addEventListener('dispose', () => { spent++; });
  for (const id of ARMS) {
    for (const built of [makeWeapon(id, m, plate), makeWeaponDrop(id, m, plate)]) {
      const own = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
      built.group.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        geometries.add(o.geometry);
        if (!shared.has(o.material as THREE.Material)) own.add(o.material as THREE.Material);
      });
      let released = 0, freed = 0;
      for (const material of own) material.addEventListener('dispose', () => { released++; });
      for (const geometry of geometries) geometry.addEventListener('dispose', () => { freed++; });
      const parent = new THREE.Group(); parent.add(built.group);
      if ('ring' in built) disposeWeaponDrop(built, m); else disposeWeapon(built, m);
      assert.equal(released, own.size, `${id} left a material of its own undisposed`);
      assert.equal(freed, geometries.size, `${id} left geometry undisposed`);
      assert.equal(built.group.parent, null);
    }
  }
  assert.equal(spent, 0, 'a release disposed the knight palette');
});
