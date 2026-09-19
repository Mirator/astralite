import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { impactEffects } from '../app/dungeon-impact.ts';

test('hit accents stay bounded, freeze on redraw, expire, and clear across floors', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(.6, .4, 0));
  const meshes = [...effects.group.children], geometries = meshes.map(mesh => (mesh as THREE.Mesh).geometry);
  for (let i = 0; i < 20; i++) effects.emit({ x: i, y: 0, z: 2 }, 0xffedbb, i % 2 === 0);
  // Two meshes a slot — the bloom and its shockwave — plus the two crescents,
  // which are pooled per swing rather than per body and so do not scale with it.
  assert.equal(effects.active, 3); assert.equal(effects.group.children.length, 8);
  effects.update(.1, camera);
  const frozen = meshes.map(mesh => ({ position: mesh.position.toArray(), scale: mesh.scale.toArray(), visible: mesh.visible }));
  effects.update(0, camera);
  assert.deepEqual(meshes.map(mesh => ({ position: mesh.position.toArray(), scale: mesh.scale.toArray(), visible: mesh.visible })), frozen);
  effects.update(.2, camera); assert.equal(effects.active, 0); assert.ok(meshes.every(mesh => !mesh.visible));
  effects.emit({ x: 4, y: 0, z: 5 }); effects.clear(); assert.equal(effects.active, 0);
  assert.ok(meshes.every(mesh => !mesh.visible), 'clear left an accent on screen');
  assert.ok(meshes.every((mesh, i) => (mesh as THREE.Mesh).geometry === geometries[i]));
  effects.dispose();
});

test('the crescent is one per swing, freezes on a redrawn frame, and expires', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion();
  const crescents = effects.group.children.slice(6) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  assert.equal(crescents.length, 2);
  assert.ok(crescents.every(mesh => !mesh.visible));
  // Reach drives the radius, so a long arm draws a wider arc without being told.
  effects.arc({ x: 1, z: 2 }, 0.75, 1.8);
  assert.equal(crescents[0].visible, true);
  assert.deepEqual(crescents[0].position.toArray(), [1, 0.62, 2]);
  assert.equal(crescents[0].rotation.z, 0.75);
  effects.arc({ x: 0, z: 0 }, 0, 1.4);
  assert.ok(crescents[1].scale.x < crescents[0].scale.x, 'a shorter arm drew the same arc');
  // A paused or manually redrawn frame must not age it.
  effects.update(0.05, camera);
  const held = crescents[0].scale.x;
  effects.update(0, camera);
  assert.equal(crescents[0].scale.x, held);
  effects.update(0.3, camera);
  assert.ok(crescents.every(mesh => !mesh.visible), 'a crescent outlived its own life');
  effects.arc({ x: 0, z: 0 }, 0, 1.8); effects.clear();
  assert.ok(crescents.every(mesh => !mesh.visible), 'clear left a crescent on screen');
  effects.dispose();
});
