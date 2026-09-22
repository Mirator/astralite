import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FOOTSTEP_CAPACITY, FOOTSTEP_LIFT, footstepEffects, REDUCED_FOOTSTEP } from '../app/dungeon-footsteps.ts';
import type { FootstepKind } from '../app/dungeon-footstep-rules.ts';

// The game's own fixed isometric view: camera at (+9.2, +12.5, +11.5) from its focus.
const cameraAt = () => {
  const camera = new THREE.OrthographicCamera();
  camera.position.set(9.2, 12.5, 11.5); camera.lookAt(0, 0, 0);
  return camera.quaternion.clone();
};
const KINDS: FootstepKind[] = ['keep', 'ruins', 'flooded'];
/** Plan 008's visual table, restated here rather than read off FOOTSTEP_LOOK, so a tuning pass that
 * drifts outside the plan's ranges fails instead of quietly moving both sides of the comparison. */
const SPEC: Record<FootstepKind, { count: [number, number]; size: [number, number]; length?: [number, number]; life: [number, number]; height: number; alpha: [number, number] }> = {
  keep: { count: [1, 2], size: [0.035, 0.08], life: [0.18, 0.25], height: 0.1, alpha: [0.12, 0.22] },
  ruins: { count: [2, 3], size: [0.05, 0.12], life: [0.22, 0.32], height: 0.16, alpha: [0.12, 0.22] },
  flooded: { count: [2, 3], size: [0.02, 0.035], length: [0.04, 0.075], life: [0.16, 0.24], height: 0.15, alpha: [0.2, 0.3] },
};
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

test('an empty pool is invisible and draws nothing; a live one draws exactly its quads with a real bound', () => {
  const steps = footstepEffects(), camera = cameraAt();
  steps.update(1 / 60, camera);
  assert.equal(steps.mesh.visible, false); assert.equal(steps.mesh.geometry.drawRange.count, 0);
  const n = steps.emit({ x: 4, y: 0.05, z: -3 }, 'keep', { heading: { x: 1, z: 0 } });
  steps.update(1 / 60, camera);
  assert.equal(steps.mesh.visible, true);
  assert.equal(steps.active, n);
  assert.equal(steps.mesh.geometry.drawRange.count, n * 6, 'the draw range is not the live quads');
  const sphere = steps.mesh.geometry.boundingSphere!;
  assert.ok(sphere.radius > 0, 'a zero-sized bound would let the frustum cull a live batch');
  const positions = steps.mesh.geometry.getAttribute('position');
  for (let v = 0; v < n * 4; v++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, v);
    assert.ok(p.distanceTo(sphere.center) <= sphere.radius + EPS, 'a live vertex sits outside the bounding sphere');
  }
  steps.update(1, camera);
  assert.equal(steps.active, 0); assert.equal(steps.mesh.visible, false); assert.equal(steps.mesh.geometry.drawRange.count, 0);
  steps.dispose();
});

test('every quad of every kind faces the lens with front-face winding, so back-face culling keeps it', () => {
  const camera = cameraAt(), toViewer = new THREE.Vector3(0, 0, 1).applyQuaternion(camera);
  for (const kind of KINDS) {
    const steps = footstepEffects();
    for (let i = 0; i < 6; i++) steps.emit({ x: i * 0.5, y: 0.02, z: -i * 0.3 }, kind, { heading: { x: Math.cos(i * 1.1), z: Math.sin(i * 1.1) } });
    for (let t = 0; t < 4; t++) {
      steps.update(0.04, camera);
      const positions = steps.mesh.geometry.getAttribute('position'), index = steps.mesh.geometry.getIndex()!;
      for (let tri = 0; tri < steps.mesh.geometry.drawRange.count / 3; tri++) {
        const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, index.getX(tri * 3 + k)));
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        assert.ok(normal.length() > 0, `${kind}: degenerate triangle`);
        // Counter-clockwise seen from the camera is what THREE.FrontSide draws.
        assert.ok(normal.normalize().dot(toViewer) > 0.999, `${kind}: triangle ${tri} winds away from the camera and would be culled`);
      }
    }
    steps.dispose();
  }
});

test('zero time and a paused frame change nothing, including the written buffers', () => {
  const steps = footstepEffects(), camera = cameraAt();
  steps.emit({ x: 0, y: 0, z: 0 }, 'flooded', { heading: { x: 0, z: 1 } });
  steps.update(0.05, camera);
  const before = { parts: steps.particles(), positions: Array.from(steps.mesh.geometry.getAttribute('position').array), colors: Array.from(steps.mesh.geometry.getAttribute('color').array) };
  for (let i = 0; i < 5; i++) { steps.update(0, camera); steps.update(Number.NaN, camera); steps.update(-1, camera); }
  assert.deepEqual(steps.particles(), before.parts);
  assert.deepEqual(Array.from(steps.mesh.geometry.getAttribute('position').array), before.positions);
  assert.deepEqual(Array.from(steps.mesh.geometry.getAttribute('color').array), before.colors);
  steps.dispose();
});

test('every kind stays inside its size, height, radius, alpha and lifetime spec, and expires', () => {
  const camera = cameraAt();
  for (const kind of KINDS) {
    const look = SPEC[kind];
    for (let contact = 0; contact < 30; contact++) {
      const steps = footstepEffects(), at = { x: 1.3, y: 0.04, z: -2.2 };
      for (let k = 0; k < contact; k++) steps.emit({ x: 50, y: 0, z: 50 }, kind);
      steps.clear();
      const n = steps.emit(at, kind, { heading: { x: Math.cos(contact), z: Math.sin(contact) } });
      assert.ok(n >= look.count[0] && n <= look.count[1], `${kind}: ${n} particles for one contact`);
      const first = steps.particles();
      first.forEach(p => {
        assert.ok(p.life >= look.life[0] - EPS && p.life <= look.life[1] + EPS, `${kind}: life ${p.life}`);
        assert.ok(p.alpha >= look.alpha[0] - EPS && p.alpha <= look.alpha[1] + EPS, `${kind}: start alpha ${p.alpha}`);
        assert.ok(Math.abs(p.oy - (at.y + FOOTSTEP_LIFT)) < EPS, `${kind}: did not start at support + lift`);
      });
      let alive = true, t = 0;
      while (alive) {
        steps.update(1 / 120, camera); t += 1 / 120;
        for (const p of steps.particles()) {
          assert.equal(p.droplet, kind === 'flooded');
          assert.ok(p.width <= look.size[1] + EPS && p.width >= look.size[0] - EPS, `${kind}: size ${p.width}`);
          if (p.droplet) assert.ok(p.length >= look.length![0] - EPS && p.length <= look.length![1] + EPS, `${kind}: length ${p.length}`);
          else assert.equal(p.length, p.width, 'dust is a round fleck, not a streak');
          assert.ok(p.y - p.oy <= look.height + EPS, `${kind}: rose ${p.y - p.oy} above its contact`);
          assert.ok(p.y >= p.oy - EPS, `${kind}: fell below its own support plane (${p.y} < ${p.oy})`);
          assert.ok(Math.hypot(p.x - at.x, p.z - at.z) <= 0.35, `${kind}: strayed ${Math.hypot(p.x - at.x, p.z - at.z)} from its contact`);
          assert.ok(p.alpha >= 0 && p.alpha <= look.alpha[1] + EPS);
          assert.ok([p.x, p.y, p.z].every(Number.isFinite));
        }
        alive = steps.active > 0;
        assert.ok(t < look.life[1] + 0.01, `${kind}: outlived its own maximum life`);
      }
      assert.equal(steps.mesh.visible, false);
      steps.dispose();
    }
  }
});

test('dust fades smoothly and monotonically to nothing; drops land back on their support and vanish', () => {
  const camera = cameraAt();
  const dust = footstepEffects();
  dust.emit({ x: 0, y: 0, z: 0 }, 'ruins', { heading: { x: 1, z: 0 } });
  let last = Infinity;
  for (let i = 0; i < 40 && dust.active; i++) {
    dust.update(0.01, camera);
    const alpha = Math.max(0, ...dust.particles().map(p => p.alpha));
    assert.ok(alpha <= last + EPS, 'dust brightened as it aged'); last = alpha;
  }
  const drops = footstepEffects();
  drops.emit({ x: 0, y: 0.03, z: 0 }, 'flooded', { heading: { x: 0, z: -1 } });
  let peak = 0;
  for (let i = 0; i < 60 && drops.active; i++) {
    drops.update(0.005, camera);
    for (const p of drops.particles()) {
      peak = Math.max(peak, p.y - p.oy);
      // Closing on the end of its life, a drop is on (not under) the plane it started from.
      if (p.life - p.age < 0.006) assert.ok(p.y - p.oy < 0.02, 'a drop was still in the air at the end of its life');
    }
  }
  assert.ok(peak > 0.03 && peak <= 0.15 + EPS, `drop apex ${peak}`);
  assert.equal(drops.active, 0);
  dust.dispose(); drops.dispose();
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
  a.reset(); assert.equal(a.emitted, 0);
  assert.deepEqual(run(a), first, 'a reset pool did not replay the first run');
  a.dispose(); b.dispose();
});

test('the development A/B toggle hides the batch without touching a particle, and dispose detaches it', () => {
  const steps = footstepEffects(), camera = cameraAt(), world = new THREE.Group();
  world.add(steps.group);
  steps.emit({ x: 0, y: 0, z: 0 }, 'keep'); steps.update(0.02, camera);
  const held = steps.particles();
  steps.setEnabled(false); assert.equal(steps.mesh.visible, false);
  steps.setEnabled(true); assert.equal(steps.mesh.visible, true);
  assert.deepEqual(steps.particles(), held);
  steps.dispose();
  assert.equal(steps.group.parent, null, 'dispose left the batch in the scene for a second generic dispose');
});
