import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ENEMY_KINDS } from '../app/dungeon-bestiary.ts';
import { buildSkeleton, makeSkeleton } from '../app/dungeon-skeleton.ts';

// `makeSkeleton` builds one body a kind and copies it after that (dungeon-skeleton.ts). A copy has to be the body a
// fresh build would have made - the same tree, the same geometry, materials that say the same and run the same shader
// - and it has to be its own: materials no other body shares, and `userData` that points into itself.

const nodes = (root: THREE.Object3D) => { const all: THREE.Object3D[] = []; root.traverse(o => all.push(o)); return all; };
const materialsOf = (root: THREE.Object3D) => nodes(root).flatMap(o => o instanceof THREE.Mesh ? [o.material as THREE.Material] : []);
/** What a material says, as far as drawing goes: its type, its parameters and the shader hook its program is keyed on. */
const reads = (material: THREE.Material) => {
  const json = material.toJSON() as unknown as Record<string, unknown>;
  delete json.uuid; delete json.metadata;
  if (typeof json.map === 'string') json.map = (material as THREE.MeshBasicMaterial).map?.uuid;
  // Both: `weatherBone` sets a constant program key beside its hook, so the key alone does not show the hook was lost.
  return { json, program: material.customProgramCacheKey(), hook: material.onBeforeCompile.toString() };
};
const shape = (node: THREE.Object3D) => ({
  type: node.type, name: node.name, visible: node.visible, cast: node.castShadow, receive: node.receiveShadow, order: node.renderOrder,
  auto: node.matrixAutoUpdate, culled: node.frustumCulled, at: node.position.toArray(), turn: node.quaternion.toArray(), scale: node.scale.toArray(),
  children: node.children.length,
  geometry: node instanceof THREE.Mesh ? Array.from((node.geometry as THREE.BufferGeometry).getAttribute('position').array) : null,
});

for (const kind of ENEMY_KINDS) test(`a ${kind} copied from its template is the body a fresh build makes, and its own`, () => {
  const fresh = buildSkeleton(kind), first = makeSkeleton(kind), second = makeSkeleton(kind);
  const freshNodes = nodes(fresh), copyNodes = nodes(second);
  assert.ok(freshNodes.length > 5, `precondition: a ${kind} has a tree to compare`);
  assert.deepEqual(copyNodes.map(shape), freshNodes.map(shape), `a copied ${kind} differs from a fresh one in its tree, a transform or its geometry`);
  const freshMaterials = materialsOf(fresh), copyMaterials = materialsOf(second);
  assert.deepEqual(copyMaterials.map(reads), freshMaterials.map(reads), `a copied ${kind}'s materials do not say what a fresh one's do, or lost their shader hook`);
  // Its own materials: none shared with another copy, and the same sharing within the body as a fresh build has.
  const firstMaterials = new Set(materialsOf(first));
  assert.ok(firstMaterials.size > 3, `precondition: a ${kind} wears several materials`);
  assert.equal(copyMaterials.filter(m => firstMaterials.has(m)).length, 0, `two ${kind}s share a material, so one's hit flash lights the other`);
  assert.deepEqual(copyMaterials.map(m => copyMaterials.indexOf(m)), freshMaterials.map(m => freshMaterials.indexOf(m)), `a copied ${kind} shares materials between its parts differently from a fresh one`);
  // `userData` points into the copy, at the nodes a fresh build points at.
  const inside = new Set(copyNodes);
  for (const key of ['rig', 'weapon', 'skull', 'shield'] as const) {
    assert.ok(inside.has(second.userData[key]), `a copied ${kind}'s ${key} is not one of its own nodes`);
    assert.equal(copyNodes.indexOf(second.userData[key]), freshNodes.indexOf(fresh.userData[key]), `a copied ${kind}'s ${key} is not the node a fresh build names`);
  }
  for (const key of ['eyes', 'limbs'] as const) {
    assert.equal(second.userData[key].length, fresh.userData[key].length);
    assert.deepEqual(second.userData[key].map((n: THREE.Object3D) => copyNodes.indexOf(n)), fresh.userData[key].map((n: THREE.Object3D) => freshNodes.indexOf(n)), `a copied ${kind}'s ${key} are not its own, or not the right ones`);
  }
  // And a write to one copy's material - a hit flash - shows on that body alone.
  const glow = materialsOf(second).find(m => m instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial;
  glow.emissive.setHex(0xff0000);
  assert.ok(materialsOf(first).every(m => !(m instanceof THREE.MeshStandardMaterial) || m.emissive.getHex() !== 0xff0000), `a flash on one ${kind} reached another`);
});
