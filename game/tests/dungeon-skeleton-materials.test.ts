import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';

// Plan 014 round B: the guard's blade took the dark armour iron and read as an unshaded black plane
// through its own torso. It has to be its own bright, fairly smooth, metallic steel.
test("the guard's sword is bright polished steel, not the dark armour iron", () => {
  const guard = makeSkeleton('guard');
  const materials = new Set<THREE.MeshStandardMaterial>();
  guard.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) materials.add(o.material); });
  const steel = [...materials].find((m) => m.metalness >= .5 && m.roughness <= .4 && m.color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l > .5);
  assert.ok(steel, `no bright steel on the guard: ${[...materials].map((m) => `#${m.color.getHexString()} r${m.roughness} m${m.metalness}`).join(', ')}`);
});

// Plan 014 round B: the helmet sat low and behind the skull and its lower faces cut into the cranium.
// Whatever it looks like, the guard's head has to be taller than the bare skull by a cap's worth: the
// helmet stands on top of the skull rather than sinking into it.
test("the guard's helmet caps the skull rather than sinking into it", () => {
  const guard = makeSkeleton('guard');
  const top = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).max.y;
  guard.updateMatrixWorld(true);
  assert.ok(top(guard) > 1.78, `guard's head tops out at ${top(guard).toFixed(3)}, expected the helmet to sit above the skull (>1.78)`);
});
