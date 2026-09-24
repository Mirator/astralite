import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createCutawayController,
  CUTAWAY_FADE_IN,
  CUTAWAY_FADE_OUT,
  type CutawayEnemyCandidate,
} from '../app/dungeon-occlusion.ts';

// ------------------------------------------------------------------------------------ controller

const stubCamera = () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(9.2, 12.5, 11.5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};

const enemyAt = (id: number, x: number, z: number, attacking: boolean, kind: CutawayEnemyCandidate['kind'] = 'guard'): CutawayEnemyCandidate =>
  ({ id, kind, position: new THREE.Vector3(x, 0.03, z), attacking });

test('three fixed slots: a fourth and fifth simultaneous attacker never allocate a slot', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  const enemies = [enemyAt(0, 1, 0, true), enemyAt(1, 1.1, 0, true), enemyAt(2, 1.2, 0, true), enemyAt(3, 1.3, 0, true), enemyAt(4, 1.4, 0, true)];
  controller.update(camera, { position: new THREE.Vector3(0, 0.03, 0) }, enemies, 1);
  const occupied = controller.diagnostics().slots.filter(s => s.owner !== null);
  assert.equal(occupied.length, 3, 'player slot plus at most two enemy slots');
  const enemySlotCount = occupied.filter(s => s.owner !== 'player').length;
  assert.equal(enemySlotCount, 2, 'never more than two enemy slots regardless of how many attack at once');
});

test('stable identity: equal-distance candidates keep their own slot rather than swapping', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  const player = { position: new THREE.Vector3(0, 0.03, 0) };
  // Two candidates at the identical distance from the player.
  const enemies = [enemyAt(5, 2, 0, true), enemyAt(9, -2, 0, true)];
  controller.update(camera, player, enemies, 1);
  const first = controller.diagnostics().slots.map(s => s.id);
  controller.update(camera, player, enemies, 1);
  const second = controller.diagnostics().slots.map(s => s.id);
  assert.deepEqual(second, first, 'identical input must not reassign slots between frames');
  assert.ok(first.includes(5) && first.includes(9), 'both equal-distance candidates got a slot');
});

test('a held target keeps its slot while fading, and a fresh candidate is not preferred over it', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  const player = { position: new THREE.Vector3(0, 0.03, 0) };
  controller.update(camera, player, [enemyAt(1, 1, 0, true)], 1); // fully faded in
  let slots = controller.diagnostics().slots;
  assert.equal(slots.find(s => s.id === 1)?.strength, 1);
  // id 1 stops attacking (should fade out, not vanish) while a new, nearer candidate appears attacking.
  controller.update(camera, player, [enemyAt(1, 1, 0, false), enemyAt(2, 0.5, 0, true)], CUTAWAY_FADE_OUT / 2);
  slots = controller.diagnostics().slots;
  const held = slots.find(s => s.id === 1);
  assert.ok(held && held.strength > 0 && held.strength < 1, 'a fading-out target is still tracked, not dropped at once');
});

test('fade-in and fade-out run at the documented rates', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  const player = { position: new THREE.Vector3(0, 0.03, 0) };
  controller.update(camera, player, [enemyAt(1, 1, 0, true)], CUTAWAY_FADE_IN / 2);
  let strength = controller.diagnostics().slots.find(s => s.id === 1)!.strength;
  assert.ok(Math.abs(strength - 0.5) < 1e-6, `expected ~0.5 strength halfway through fade-in, got ${strength}`);
  controller.update(camera, player, [enemyAt(1, 1, 0, true)], CUTAWAY_FADE_IN / 2);
  strength = controller.diagnostics().slots.find(s => s.id === 1)!.strength;
  assert.ok(Math.abs(strength - 1) < 1e-6, `expected full strength after CUTAWAY_FADE_IN total, got ${strength}`);
  controller.update(camera, player, [enemyAt(1, 1, 0, false)], CUTAWAY_FADE_OUT);
  const slot = controller.diagnostics().slots.find(s => s.id === 1);
  assert.equal(slot, undefined, 'a fully faded-out slot is freed (id no longer present)');
});

test('death, hidden state or room change clears a slot at once, not over the fade-out window', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  const player = { position: new THREE.Vector3(0, 0.03, 0) };
  controller.update(camera, player, [enemyAt(1, 1, 0, true)], 1);
  assert.equal(controller.diagnostics().slots.find(s => s.id === 1)?.strength, 1);
  // id 1 is simply absent this frame - dead, dormant, or out of the active room/range.
  controller.update(camera, player, [], 0.001);
  const gone = controller.diagnostics().slots.find(s => s.id === 1);
  assert.equal(gone, undefined, 'an id absent from the candidate list is cleared immediately, not faded');
});

test('the dev A/B toggle defaults enabled, can disable without touching target state, and resets on releaseFloor', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  controller.update(camera, { position: new THREE.Vector3(0, 0.03, 0) }, [enemyAt(1, 1, 0, true)], 1);
  assert.equal(controller.diagnostics().enabled, true, 'default enabled');
  const strengthBefore = controller.diagnostics().slots.find(s => s.id === 1)!.strength;
  controller.setEnabled(false);
  assert.equal(controller.diagnostics().enabled, false);
  assert.equal(controller.diagnostics().slots.find(s => s.id === 1)!.strength, strengthBefore, 'disabling never mutates a target\'s own state');
  controller.releaseFloor();
  assert.equal(controller.diagnostics().enabled, true, 'a floor release restores the default (a pooled reset must not leak "disabled" into the next test)');
});

test('no player target clears the player slot at once (e.g. while not playing)', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  controller.update(camera, { position: new THREE.Vector3(0, 0.03, 0) }, [], 1);
  assert.equal(controller.diagnostics().slots[0].owner, 'player');
  controller.update(camera, null, [], 1);
  assert.equal(controller.diagnostics().slots[0].owner, null);
});

test('registration wraps material once per source, shared by every mesh that used it, and releaseFloor restores it', () => {
  const controller = createCutawayController();
  const source = new THREE.MeshStandardMaterial({ color: 0x888888 });
  let priorCalls = 0;
  source.onBeforeCompile = () => { priorCalls++; };
  source.customProgramCacheKey = () => 'source-key';
  const meshA = new THREE.Mesh(new THREE.BoxGeometry(), source);
  const meshB = new THREE.Mesh(new THREE.BoxGeometry(), source);
  controller.register(meshA);
  controller.register(meshB);
  assert.notEqual(meshA.material, source, 'the mesh must use a variant, not the shared source material');
  assert.equal(meshA.material, meshB.material, 'one variant per source, shared by every eligible mesh using it');
  assert.equal(controller.diagnostics().registeredMaterialCount, 1);
  assert.equal(controller.diagnostics().registeredMeshCount, 2);
  const variant = meshA.material as THREE.MeshStandardMaterial;
  assert.equal((variant.customProgramCacheKey as () => string)(), 'source-key|actor-cutaway-v1');
  const fakeShader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>\n', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n' };
  (variant.onBeforeCompile as (s: typeof fakeShader, r: unknown) => void)(fakeShader, {});
  assert.equal(priorCalls, 1, 'the captured original hook is still called exactly once');
  assert.ok(fakeShader.vertexShader.includes('cutawayViewPosition'), 'the cutaway vertex assignment was installed');
  assert.ok(fakeShader.fragmentShader.includes('cutawayBayerThreshold'), 'the cutaway fragment discard was installed');
  controller.releaseFloor();
  assert.equal(meshA.material, source, 'releaseFloor restores the original material');
  assert.equal(meshB.material, source);
  assert.equal(controller.diagnostics().registeredMeshCount, 0);
  assert.equal(controller.diagnostics().registeredMaterialCount, 0);
});
