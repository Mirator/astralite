import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  combineCutStrength,
  createCutawayController,
  CUTAWAY_ELLIPSE,
  CUTAWAY_FADE_IN,
  CUTAWAY_FADE_OUT,
  CUTAWAY_INNER_RADIUS,
  CUTAWAY_MAX_GAP,
  CUTAWAY_MAX_STRENGTH,
  CUTAWAY_MIN_GAP,
  CUTAWAY_MIN_WORLD_Y,
  CUTAWAY_OUTER_RADIUS,
  cutStrengthAt,
  depthGap,
  ellipseEdge,
  installCutawayShaderHooks,
  type CutawayEnemyCandidate,
  type CutawayUniformHolders,
} from '../app/dungeon-occlusion.ts';

const flatTarget = (overrides: Partial<{ center: { x: number; y: number; z: number }; radii: [number, number]; strength: number }> = {}) => ({
  center: { x: 0, y: 0, z: -5 },
  radii: [1, 1] as [number, number],
  strength: 1,
  ...overrides,
});

// ----------------------------------------------------------------------------- view/depth math

test('ellipseEdge is 1 at the centre, 0 at and beyond the outer radius, and monotonic between', () => {
  assert.equal(ellipseEdge(0, 0, 1, 1), 1);
  assert.equal(ellipseEdge(CUTAWAY_INNER_RADIUS, 0, 1, 1), 1, 'inner radius is still full strength');
  assert.equal(ellipseEdge(CUTAWAY_OUTER_RADIUS, 0, 1, 1), 0, 'outer radius is exactly zero');
  assert.equal(ellipseEdge(1.5, 0, 1, 1), 0, 'well outside the ellipse is zero');
  const near = ellipseEdge(0.8, 0, 1, 1), far = ellipseEdge(0.95, 0, 1, 1);
  assert.ok(near > far && far > 0, 'falls off monotonically inside the smooth band');
  // The two radii scale independently: the same offset that is at the inner radius on the tall axis
  // (0.68, 1.05) is still full strength, where a shared single radius would already have fallen off.
  assert.equal(ellipseEdge(0, 1.05 * CUTAWAY_INNER_RADIUS, 0.68, 1.05), 1, 'the tall axis reaches as far as its own radius says');
});

test('depthGap is positive when the fragment is nearer the camera than the target, negative behind it', () => {
  assert.equal(depthGap(-10, -8), 2, 'fragment 2 units nearer than the target');
  assert.equal(depthGap(-8, -10), -2, 'fragment behind the target reads negative');
  assert.equal(depthGap(-5, -5), 0);
});

test('cutStrengthAt rejects a fragment behind its target', () => {
  const target = flatTarget({ center: { x: 0, y: 0, z: -5 } }); // target depth 5
  // Fragment farther from the camera than the target (depth 8 > 5, i.e. behind it): gap is negative.
  const behind = cutStrengthAt({ x: 0, y: 0, z: -8 }, 1, target);
  assert.equal(behind, 0, 'a fragment behind the target must never be cut');
});

test('cutStrengthAt honours the 0.10..6.0 front-depth gap window', () => {
  const target = flatTarget({ center: { x: 0, y: 0, z: -10 } });
  const tooClose = cutStrengthAt({ x: 0, y: 0, z: -9.95 }, 1, target); // gap 0.05
  const justInside = cutStrengthAt({ x: 0, y: 0, z: -9.8 }, 1, target); // gap 0.2
  const atFar = cutStrengthAt({ x: 0, y: 0, z: -4 }, 1, target); // gap 6.0
  const tooFar = cutStrengthAt({ x: 0, y: 0, z: -3.9 }, 1, target); // gap 6.1
  assert.equal(tooClose, 0, 'under the 0.10 minimum gap must not cut');
  assert.ok(justInside > 0, 'inside the window must cut');
  assert.ok(atFar > 0, 'exactly the 6.0 maximum still cuts');
  assert.equal(tooFar, 0, 'past the 6.0 maximum must not cut, or a long view ray would erase distant structures');
});

test('cutStrengthAt never cuts at or below world y 0.18', () => {
  const target = flatTarget();
  assert.equal(cutStrengthAt({ x: 0, y: 0, z: -3 }, CUTAWAY_MIN_WORLD_Y, target), 0, 'exactly at the floor threshold');
  assert.equal(cutStrengthAt({ x: 0, y: 0, z: -3 }, 0.1, target), 0, 'below the floor threshold');
  assert.ok(cutStrengthAt({ x: 0, y: 0, z: -3 }, 0.19, target) > 0, 'just above the floor threshold may cut');
});

test('cutStrengthAt tops out at the 90% maximum for a full-strength target at the ellipse centre', () => {
  const target = flatTarget({ center: { x: 0, y: 0, z: -3 }, strength: 1 });
  const strength = cutStrengthAt({ x: 0, y: 0, z: -1 }, 1, target);
  assert.ok(strength <= CUTAWAY_MAX_STRENGTH + 1e-9, `strength ${strength} exceeds the 90% cap`);
  assert.ok(strength > 0.85, 'a centred, full-strength target should be near the cap');
});

test('combineCutStrength takes the max of overlapping targets, never the sum, and stays under the cap', () => {
  const a = CUTAWAY_MAX_STRENGTH, b = CUTAWAY_MAX_STRENGTH * 0.6;
  const combined = combineCutStrength([a, b]);
  assert.equal(combined, a, 'max, not sum');
  assert.ok(combined <= CUTAWAY_MAX_STRENGTH, 'two overlapping full-strength targets never exceed the single-target cap');
});

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

test('teleport/restart/floor-rebuild reset: clear() drops every held target', () => {
  const controller = createCutawayController();
  const camera = stubCamera();
  controller.update(camera, { position: new THREE.Vector3(0, 0.03, 0) }, [enemyAt(1, 1, 0, true)], 1);
  assert.ok(controller.diagnostics().slots.some(s => s.owner !== null));
  controller.clear();
  assert.ok(controller.diagnostics().slots.every(s => s.owner === null && s.strength === 0));
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

test('chained onBeforeCompile preserves a prior hook that itself reused the <common> anchor (weatherStone shape)', () => {
  const controller = createCutawayController();
  const source = new THREE.MeshStandardMaterial({ color: 0x888888 });
  // Mirrors weatherStone's own pattern exactly: replace an anchor with itself plus new code.
  source.onBeforeCompile = (shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;');
  };
  source.customProgramCacheKey = () => 'weathered-stone-v6';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
  controller.register(mesh);
  const variant = mesh.material as THREE.MeshStandardMaterial;
  const fakeShader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>\n', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n' };
  (variant.onBeforeCompile as (s: typeof fakeShader, r: unknown) => void)(fakeShader, {});
  assert.ok(fakeShader.vertexShader.includes('stoneWorld'), 'the prior hook still ran');
  assert.ok(fakeShader.vertexShader.includes('cutawayViewPosition'), 'the cutaway hook ran after it, on the same anchor');
  assert.equal((fakeShader.vertexShader.match(/#include <common>/g) ?? []).length, 1, 'the anchor is never duplicated by the chain');
});

test('installCutawayShaderHooks refuses to double-wrap or to run without its anchors', () => {
  const uniforms: CutawayUniformHolders = {
    uCutawayCameraWorld: { value: new THREE.Matrix4() },
    uCutawayCenters: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uCutawayRadii: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uCutawayStrengths: { value: [0, 0, 0] },
    uCutawayEnabled: { value: 1 },
  };
  const missingAnchor = { uniforms: {}, vertexShader: '#include <common>\n', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n' };
  assert.throws(() => installCutawayShaderHooks(missingAnchor as never, uniforms));
  const alreadyWrapped = { uniforms: {}, vertexShader: '#include <common>\ncutawayViewPosition\n#include <project_vertex>\n', fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n' };
  assert.throws(() => installCutawayShaderHooks(alreadyWrapped as never, uniforms));
});

// -------------------------------------------------------------------------------------- ellipses

test('the documented starting ellipse radii are wired to the right occupant', () => {
  assert.deepEqual(CUTAWAY_ELLIPSE.player.radii, [0.68, 1.05]);
  assert.deepEqual(CUTAWAY_ELLIPSE.guard.radii, [0.65, 1.0]);
  assert.deepEqual(CUTAWAY_ELLIPSE.stalker.radii, [0.65, 1.0]);
  assert.deepEqual(CUTAWAY_ELLIPSE.warden.radii, [0.92, 1.35]);
});

test('the front-depth gap window matches the plan: 0.10 to 6.0 world units', () => {
  assert.equal(CUTAWAY_MIN_GAP, 0.10);
  assert.equal(CUTAWAY_MAX_GAP, 6.0);
});
