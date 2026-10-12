import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';

// Plan 027 Stage A deleted the cape (a separate flat plane for the poncho's back point, which read as a fin):
// its seam, tip and hanging-plane checks died with it. Rewritten in Stage B against the cloth deform; until
// then this holds that the poncho is one garment.
test('the poncho is one garment: no separate cape plane, and userData.cape is the poncho itself', () => {
  const knight = makeKnight(), torso = knight.userData.torso as THREE.Object3D, cloak = knight.userData.cloak as THREE.Object3D;
  const poncho = cloak.children.find(child => child.name === 'poncho');
  assert.ok(poncho instanceof THREE.Mesh, 'precondition: the poncho is found by name under userData.cloak');
  const planes: string[] = [];
  torso.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) planes.push(o.name || o.uuid); });
  assert.deepEqual(planes, [], 'a flat plane hangs off the torso: the cape is back');
  assert.ok(knight.userData.cape === poncho, `userData.cape is ${(knight.userData.cape as THREE.Object3D)?.name || 'missing'}, not the poncho mesh`);
});
