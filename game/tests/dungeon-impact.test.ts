import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { impactEffects } from '../app/dungeon-impact.ts';

test('hit accents stay bounded, freeze on redraw, expire, and clear across floors', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(.6, .4, 0));
  const meshes = [...effects.group.children], geometries = meshes.map(mesh => (mesh as THREE.Mesh).geometry);
  for (let i = 0; i < 20; i++) effects.emit({ x: i, y: 0, z: 2 }, 0xffedbb, i % 2 === 0);
  // Two meshes a slot — the bloom and its shockwave — plus the two crescents,
  // which are pooled per swing rather than per body and so do not scale with it,
  // and the one slam shockwave (plan 016).
  assert.equal(effects.active, 3); assert.equal(effects.group.children.length, 9);
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
  const crescents = effects.group.children.slice(6, 8) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
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

test('the slam shockwave travels out to its radius, holds on a redrawn frame, expires, and clears', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion();
  const ring = effects.group.children[8] as THREE.Mesh;
  const count = effects.group.children.length;
  assert.deepEqual(effects.shock, { active: false, radius: 0, edge: 0 });
  effects.slam({ x: 2, z: -1 }, 2.8);
  assert.equal(effects.group.children.length, count, 'a slam allocated a mesh');
  assert.equal(ring.visible, true); assert.deepEqual([ring.position.x, ring.position.z], [2, -1]);
  const start = effects.shock;
  assert.equal(start.active, true); assert.equal(start.radius, 2.8);
  assert.ok(start.edge < 2.8 * .2, 'it starts at the knight');
  // The flash is the loudest thing alive on its first frames, so it takes the lamp.
  assert.equal(effects.lamp?.heavy, true);
  effects.update(.05, camera);
  const early = effects.shock.edge;
  effects.update(0, camera);
  assert.equal(effects.shock.edge, early, 'a redrawn frame aged it');
  assert.ok(early > start.edge);
  effects.update(.2, camera);
  assert.ok(effects.shock.edge > early && effects.shock.edge <= 2.8 + 1e-9, 'past the radius');
  assert.equal(effects.lamp, null, 'the flash outlived its clock');
  effects.update(.1, camera);
  assert.deepEqual(effects.shock, { active: false, radius: 0, edge: 0 }); assert.equal(ring.visible, false);
  // Reduced motion: at the radius from the first frame, and it stays there while it fades.
  effects.slam({ x: 0, z: 0 }, 2.4, true);
  assert.ok(Math.abs(effects.shock.edge - 2.4) < 1e-9);
  effects.update(.1, camera);
  assert.ok(Math.abs(effects.shock.edge - 2.4) < 1e-9, 'a reduced shockwave moved');
  effects.clearShock(); assert.deepEqual(effects.shock, { active: false, radius: 0, edge: 0 }); assert.equal(ring.visible, false);
  effects.slam({ x: 0, z: 0 }, 3.2); effects.clear();
  assert.deepEqual(effects.shock, { active: false, radius: 0, edge: 0 }); assert.equal(ring.visible, false);
  effects.dispose();
});

test('the Whirl ring is already at the reach on contact, pale, lights no pool, and a slam after it is gold again', () => {
  const effects = impactEffects(3), camera = new THREE.Quaternion();
  const ring = effects.group.children[8] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  const count = effects.group.children.length;
  effects.whirl({ x: 1, z: 1 }, 2.2);
  assert.equal(effects.group.children.length, count, 'the whirl shares the slam mesh');
  const start = effects.shock;
  assert.equal(start.active, true); assert.equal(start.radius, 2.2);
  // Unlike the slam, which leaves the knight, the cut line starts within a few hundredths of the reach.
  assert.ok(start.edge > 2.2 && start.edge < 2.2 * 1.06, String(start.edge));
  const whirlColour = ring.material.color.getHex();
  effects.update(.1, camera);
  assert.ok(effects.shock.edge <= start.edge && effects.shock.edge >= 2.2 - 1e-9, 'it closes onto the reach, never inside it');
  effects.update(.3, camera);
  assert.deepEqual(effects.shock, { active: false, radius: 0, edge: 0 });
  // Reduced motion holds it at the reach.
  effects.whirl({ x: 0, z: 0 }, 2.5, true);
  assert.ok(Math.abs(effects.shock.edge - 2.5) < 1e-9);
  effects.update(.1, camera);
  assert.ok(Math.abs(effects.shock.edge - 2.5) < 1e-9);
  effects.land({ x: 0, z: 0 }, 1.4);
  assert.equal(effects.shock.radius, 1.4);
  assert.notEqual(ring.material.color.getHex(), whirlColour, 'the Vault lands in its own colour');
  effects.slam({ x: 0, z: 0 }, 2.4);
  assert.notEqual(ring.material.color.getHex(), whirlColour, 'the slam takes its own colour back');
  effects.clear(); assert.equal(ring.visible, false);
  effects.dispose();
});
