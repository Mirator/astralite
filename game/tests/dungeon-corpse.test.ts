import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { advanceDeath, startDeath } from '../app/dungeon-death.ts';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';

// A settled corpse is merged into one mesh per material (dungeon-death's `bakeCorpse`). What it draws afterwards has to
// be what it drew before - every triangle, where it lay, facing the way it faced, in the material and shadow it wore -
// in fewer draws, and nothing of the rig may still draw beside it.

type Drawn = { material: THREE.Material; cast: boolean; receive: boolean; positions: number[]; normals: number[]; triangles: number };
/** What the body draws, read off the scene: every visible mesh, its vertices in the body's own frame, grouped by material in traversal order. */
const drawn = (group: THREE.Group) => {
  group.updateWorldMatrix(true, true);
  const toBody = group.matrixWorld.clone().invert(), out = new Map<THREE.Material, Drawn>(); let meshes = 0;
  group.traverseVisible(node => {
    if (!(node instanceof THREE.Mesh) || node.parent === group && node.name !== 'corpse') return; // the body's ground mark is not part of the rig
    meshes++;
    const geometry = (node.geometry as THREE.BufferGeometry).index ? (node.geometry as THREE.BufferGeometry).toNonIndexed() : (node.geometry as THREE.BufferGeometry).clone();
    geometry.applyMatrix4(toBody.clone().multiply(node.matrixWorld));
    const material = node.material as THREE.Material, entry = out.get(material) ?? { material, cast: node.castShadow, receive: node.receiveShadow, positions: [], normals: [], triangles: 0 };
    assert.equal(entry.cast, node.castShadow); assert.equal(entry.receive, node.receiveShadow);
    entry.positions.push(...geometry.getAttribute('position').array); entry.normals.push(...(geometry.getAttribute('normal')?.array ?? []));
    entry.triangles += geometry.getAttribute('position').count / 3;
    out.set(material, entry);
  });
  return { meshes, byMaterial: [...out.values()] };
};
const close = (a: number[], b: number[], what: string) => {
  assert.equal(a.length, b.length, `${what}: a different number of values`);
  const worst = a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  assert.ok(worst < 1e-5, `${what}: off by ${worst}`);
};

for (const kind of ENEMY_KINDS) test(`a settled ${kind} draws the same triangles in the same materials, in one mesh a material`, () => {
  const group = makeSkeleton(kind), rig = group.userData.rig as THREE.Group, death = startDeath(group, kind);
  advanceDeath(death, death.duration * .99);
  assert.equal(death.settled, false, 'precondition: the fall is still running');
  const falling = drawn(group);
  assert.ok(falling.meshes > falling.byMaterial.length, `precondition: a falling ${kind} draws more meshes (${falling.meshes}) than it has materials (${falling.byMaterial.length})`);
  advanceDeath(death, death.duration);
  assert.equal(death.settled, true, 'precondition: the corpse has settled');
  const settled = drawn(group);
  let rigDraws = 0; rig.traverseVisible(node => { if (node instanceof THREE.Mesh) rigDraws++; });
  assert.equal(rig.visible && rigDraws > 0, false, `a settled ${kind}'s rig still draws beside its merged corpse`);
  // One draw a material: no two meshes it draws could have been one (the same material and the same attributes).
  const layouts: string[] = []; group.traverseVisible(node => { if (node instanceof THREE.Mesh && node.name === 'corpse') layouts.push(`${(node.material as THREE.Material).uuid} ${Object.keys((node.geometry as THREE.BufferGeometry).attributes).sort().join()}`); });
  assert.equal(new Set(layouts).size, layouts.length, `a settled ${kind} draws two meshes that could have been one`);
  assert.ok(settled.meshes <= falling.meshes / 1.5, `a settled ${kind} draws ${settled.meshes} meshes, against ${falling.meshes} falling`);
  // The fall's last step is a hair short of the pose it lands in, so the settled pose is read off a second body taken all the way down unmerged.
  const reference = makeSkeleton(kind), referenceDeath = startDeath(reference, kind);
  referenceDeath.settled = false; for (const joint of referenceDeath.joints) { joint.node.position.copy(joint.endPosition); joint.node.quaternion.copy(joint.endRotation); }
  const landed = drawn(reference);
  assert.deepEqual(settled.byMaterial.map(m => m.triangles), landed.byMaterial.map(m => m.triangles), `a settled ${kind} draws different triangle counts per material than its pose has`);
  settled.byMaterial.forEach((merged, i) => {
    const pose = landed.byMaterial[i];
    assert.equal(merged.material.type, pose.material.type);
    assert.deepEqual([merged.cast, merged.receive], [pose.cast, pose.receive], `a settled ${kind}'s ${merged.material.type} lost its shadow settings`);
    close(merged.positions, pose.positions, `a settled ${kind}'s ${merged.material.type} vertices are not where its pose put them`);
    close(merged.normals, pose.normals, `a settled ${kind}'s ${merged.material.type} normals do not face where its pose faced them`);
  });
  // Merged in the body's frame: a sink moves it with the body.
  const before = new THREE.Box3().setFromObject(group.children.find(node => node.name === 'corpse')!);
  group.position.y -= 1; group.updateMatrixWorld(true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(group.children.find(node => node.name === 'corpse')!).min.y - (before.min.y - 1)) < 1e-6, `a settled ${kind} does not sink with its body`);
});
