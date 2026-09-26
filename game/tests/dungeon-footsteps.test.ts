import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FOOTSTEP_CAPACITY, footstepEffects, REDUCED_FOOTSTEP } from '../app/dungeon-footsteps.ts';
import type { FootstepKind } from '../app/dungeon-footstep-rules.ts';

// The game's own fixed isometric view: camera at (+9.2, +12.5, +11.5) from its focus.
const cameraAt = () => {
  const camera = new THREE.OrthographicCamera();
  camera.position.set(9.2, 12.5, 11.5); camera.lookAt(0, 0, 0);
  return camera.quaternion.clone();
};
const KINDS: FootstepKind[] = ['keep', 'ruins', 'flooded'];
const EPS = 1e-6;

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

test('zero time and a paused frame change nothing, including the written buffers', () => {
  // Pause and hit-stop hand the pool a zero step; a footfall is part of the world and holds with it.
  const steps = footstepEffects(), camera = cameraAt();
  steps.emit({ x: 0, y: 0, z: 0 }, 'flooded', { heading: { x: 0, z: 1 } });
  steps.update(0.05, camera);
  const before = { parts: steps.particles(), positions: Array.from(steps.mesh.geometry.getAttribute('position').array), colors: Array.from(steps.mesh.geometry.getAttribute('color').array) };
  for (let i = 0; i < 5; i++) steps.update(0, camera);
  assert.deepEqual(steps.particles(), before.parts);
  assert.deepEqual(Array.from(steps.mesh.geometry.getAttribute('position').array), before.positions);
  assert.deepEqual(Array.from(steps.mesh.geometry.getAttribute('color').array), before.colors);
  steps.dispose();
});

test('reduced motion keeps one small fleck or drop, short-lived and nearly still', () => {
  const camera = cameraAt();
  for (const kind of KINDS) {
    const steps = footstepEffects(), at = { x: -2, y: 0.02, z: 5 };
    assert.equal(steps.emit(at, kind, { heading: { x: 1, z: 1 }, reduced: true }), REDUCED_FOOTSTEP.count);
    assert.equal(steps.active, 1);
    const [start] = steps.particles();
    assert.ok(start.life <= REDUCED_FOOTSTEP.life + EPS, `${kind}: reduced life ${start.life}`);
    while (steps.active) {
      steps.update(1 / 240, camera);
      for (const p of steps.particles()) assert.ok(Math.hypot(p.x - p.ox, p.y - p.oy, p.z - p.oz) <= REDUCED_FOOTSTEP.travel + EPS, `${kind}: reduced particle travelled too far`);
    }
    steps.dispose();
  }
});

test('the scatter is deterministic: reset replays the same particles; clear empties without resetting', () => {
  const camera = cameraAt();
  const run = (steps: ReturnType<typeof footstepEffects>) => {
    for (let i = 0; i < 5; i++) steps.emit({ x: i, y: 0.02, z: 0 }, KINDS[i % 3], { heading: { x: 1, z: 0 } });
    steps.update(0.03, camera);
    return steps.particles();
  };
  const a = footstepEffects(), b = footstepEffects();
  const first = run(a);
  assert.deepEqual(run(b), first, 'two fresh pools disagreed on the same emissions');
  a.clear();
  assert.equal(a.active, 0); assert.equal(a.mesh.visible, false); assert.equal(a.emitted, 5, 'clear reset the serial');
  // A cleared pool carries on its serial, so the next emissions scatter differently from the first run.
  assert.notDeepEqual(run(a), first, 'clear replayed the first run, so it reset the scatter');
  a.clear(); a.reset(); assert.equal(a.emitted, 0);
  assert.deepEqual(run(a), first, 'a reset pool did not replay the first run');
  a.dispose(); b.dispose();
});
