import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FOOTSTEP_CAPACITY, footstepEffects } from '../app/dungeon-footsteps.ts';
import type { FootstepKind } from '../app/dungeon-footstep-rules.ts';

// The game's own fixed isometric view: camera at (+9.2, +12.5, +11.5) from its focus.
const cameraAt = () => {
  const camera = new THREE.OrthographicCamera();
  camera.position.set(9.2, 12.5, 11.5); camera.lookAt(0, 0, 0);
  return camera.quaternion.clone();
};
const KINDS: FootstepKind[] = ['keep', 'ruins', 'flooded'];

test('one batch, bounded: overflow evicts the oldest and never grows past capacity', () => {
  const steps = footstepEffects(), camera = cameraAt();
  assert.equal(steps.group.children.length, 1, 'more than one render object in the batch');
  for (let i = 0; i < 40; i++) steps.emit({ x: i * 0.01, y: 0.02, z: 0 }, 'ruins', { heading: { x: 1, z: 0 } });
  steps.update(1 / 60, camera);
  assert.equal(steps.active, FOOTSTEP_CAPACITY);
  assert.equal(steps.mesh.geometry.drawRange.count, FOOTSTEP_CAPACITY * 6);
  // The survivors are the newest emissions: every live particle started near the last contacts.
  assert.ok(steps.particles().every(p => p.ox > 0.15), 'overflow kept an old particle over a new one');
  steps.dispose();
});

test('the same geometry, material and buffers survive a thousand emissions; nothing is allocated per step', () => {
  const steps = footstepEffects(), camera = cameraAt();
  const mesh = steps.mesh, geometry = mesh.geometry, material = mesh.material;
  const arrays = ['position', 'color', 'footCorner'].map(name => geometry.getAttribute(name).array);
  const index = geometry.getIndex()!.array;
  for (let i = 0; i < 1000; i++) {
    steps.emit({ x: Math.sin(i) * 3, y: 0.03, z: Math.cos(i) * 3 }, KINDS[i % 3], { heading: { x: 0, z: -1 } });
    steps.update(0.05, camera);
  }
  assert.equal(steps.group.children.length, 1);
  assert.equal(steps.mesh, mesh); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
  ['position', 'color', 'footCorner'].forEach((name, i) => assert.equal(geometry.getAttribute(name).array, arrays[i], `${name} buffer was replaced`));
  assert.equal(geometry.getIndex()!.array, index);
  assert.ok(steps.active <= FOOTSTEP_CAPACITY);
  steps.dispose();
});
