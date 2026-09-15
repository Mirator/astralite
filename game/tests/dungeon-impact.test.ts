import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { impactEffects } from '../app/dungeon-impact.ts';

test('hit accents stay bounded, freeze on redraw, expire, and clear across floors', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(.6, .4, 0));
  const meshes = [...effects.group.children], geometries = meshes.map(mesh => (mesh as THREE.Mesh).geometry);
  for (let i = 0; i < 20; i++) effects.emit({ x: i, y: 0, z: 2 }, 0xffedbb, i % 2 === 0);
  assert.equal(effects.active, 3); assert.equal(effects.group.children.length, 6);
  effects.update(.1, camera);
  const frozen = meshes.map(mesh => ({ position: mesh.position.toArray(), scale: mesh.scale.toArray(), visible: mesh.visible }));
  effects.update(0, camera);
  assert.deepEqual(meshes.map(mesh => ({ position: mesh.position.toArray(), scale: mesh.scale.toArray(), visible: mesh.visible })), frozen);
  effects.update(.2, camera); assert.equal(effects.active, 0); assert.ok(meshes.every(mesh => !mesh.visible));
  effects.emit({ x: 4, y: 0, z: 5 }); effects.clear(); assert.equal(effects.active, 0);
  assert.ok(meshes.every((mesh, i) => (mesh as THREE.Mesh).geometry === geometries[i]));
  effects.dispose();
});
