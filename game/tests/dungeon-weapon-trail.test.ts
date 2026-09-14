import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { weaponTrail } from '../app/dungeon-weapon-trail.ts';

test('blade trail follows the real weapon through parent rotation and translation', () => {
  const trail = weaponTrail(0xffffff), actor = new THREE.Group(), sword = new THREE.Group();
  actor.position.set(4, 1, -2); actor.rotation.y = .8; actor.add(sword); sword.position.set(.44, 1, 0);
  const inner = new THREE.Vector3(0, 0, -.4), outer = new THREE.Vector3(0, 0, -1.18);
  trail.update(.016, true, sword, inner, outer); sword.rotation.y = 1;
  trail.update(.016, true, sword, inner, outer);
  const tip = outer.clone().applyMatrix4(sword.matrixWorld), positions = trail.mesh.geometry.getAttribute('position');
  assert.ok(new THREE.Vector3().fromBufferAttribute(positions, 3).distanceTo(tip) < .00001);
  assert.equal(trail.mesh.visible, true);
  trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
});

test('trails expire on misses, freeze on redraw, clear on cancel, and reuse geometry', () => {
  const trail = weaponTrail(0xffffff), sword = new THREE.Group(), inner = new THREE.Vector3(0, 0, -.4), outer = new THREE.Vector3(0, 0, -1);
  const geometry = trail.mesh.geometry;
  for (let swing = 0; swing < 50; swing++) {
    trail.update(.016, true, sword, inner, outer); sword.rotation.y += .2;
    trail.update(.016, true, sword, inner, outer);
    const count = geometry.drawRange.count;
    trail.update(0, true, sword, inner, outer); assert.equal(geometry.drawRange.count, count);
    trail.update(.11, false, sword, inner, outer); assert.equal(trail.mesh.visible, false);
    assert.equal(trail.mesh.geometry, geometry);
  }
  trail.clear(); assert.equal(geometry.drawRange.count, 0); assert.equal(trail.mesh.visible, false);
  geometry.dispose(); trail.mesh.material.dispose();
});
