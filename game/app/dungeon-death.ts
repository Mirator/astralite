import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BESTIARY, byKind, type EnemyKind } from './dungeon-bestiary.ts';

export type FallenKind = EnemyKind;
export const DEATH_DURATION = byKind(a => a.look.death.duration);
type Joint = { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; endPosition: THREE.Vector3; endRotation: THREE.Quaternion };
export type DeathAnimation = { age: number; duration: number; settled: boolean; joints: Joint[]; group: THREE.Group };

// Capture the interrupted pose, then fall into a fixed, full-size corpse. No scene
// objects are created during playback, and damage/collision remain in the combat rules.
export function startDeath(group: THREE.Group, kind: FallenKind): DeathAnimation {
  const rig = group.userData.rig as THREE.Group, limbs = group.userData.limbs as THREE.Group[], weapon = group.userData.weapon as THREE.Group;
  const nodes = [group, rig, ...limbs, weapon, group.userData.shield as THREE.Mesh];
  const joints = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.quaternion.clone(), endPosition: new THREE.Vector3(), endRotation: new THREE.Quaternion() }));
  const { prone, weaponX } = BESTIARY[kind].look.death;
  // Keep the facing, falling forwards for the low stalker and backwards for armored enemies.
  rig.position.set(0, 0, 0); rig.rotation.set(prone ? -Math.PI / 2 : Math.PI / 2, 0, 0);
  limbs.forEach((limb, i) => {
    const side = i % 2 ? 1 : -1;
    limb.rotation.set(0, 0, i < 2 ? side * (prone ? .75 : .62) : side * .17);
  });
  weapon.rotation.set(-rig.rotation.x, .65, 0); weapon.position.set(weaponX, .73, .08);
  (group.userData.shield as THREE.Mesh).rotation.set(-Math.PI / 2, 0, 0);
  group.updateWorldMatrix(true, true);
  // Ground the visible geometry (including shield and hammer), irrespective of actor scale.
  const bounds = new THREE.Box3();
  group.traverseVisible(node => {
    if (node instanceof THREE.Mesh) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      bounds.union(node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    }
  });
  group.position.y += .035 - bounds.min.y;
  joints.forEach(joint => { joint.endPosition.copy(joint.node.position); joint.endRotation.copy(joint.node.quaternion); joint.node.position.copy(joint.position); joint.node.quaternion.copy(joint.rotation); });
  // A corpse must not retain its windup glow or glowing eyes.
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial) material.emissive.setHex(0);
    }
  });
  for (const eye of (group.userData.eyes ?? []) as THREE.Mesh[]) eye.visible = false;
  return { age: 0, duration: DEATH_DURATION[kind], settled: false, joints, group };
}

export function advanceDeath(death: DeathAnimation, dt: number) {
  if (death.settled || !(dt > 0) || !Number.isFinite(dt)) return;
  death.age = Math.min(death.duration, death.age + dt);
  const t = death.age / death.duration;
  // Hesitation gives way to an accelerating fall, then a short, soft landing.
  const fall = t < .78 ? (t / .78) ** 2 * .96 : .96 + .04 * (1 - (1 - (t - .78) / .22) ** 2);
  for (const joint of death.joints) {
    joint.node.position.lerpVectors(joint.position, joint.endPosition, fall);
    joint.node.quaternion.slerpQuaternions(joint.rotation, joint.endRotation, fall);
  }
  death.settled = t === 1;
  if (death.settled) bakeCorpse(death.group);
}

/**
 * A settled corpse never moves a joint again, yet it went on drawing every part on its own - a main and a shadow draw
 * call each, about 35 a body - for the life of the floor. Its parts are merged here into one mesh per material (and
 * per shadow, draw order and set of attributes), placed in the body's own frame so a sink still carries them, and the
 * rig is hidden: the same triangles in the same materials, in about half the calls. Returns the merged meshes, or
 * none - leaving the body as it was - when a part is something it cannot merge (a sprite, a line, a mirrored
 * transform, a material array, morph targets, or attributes that do not line up).
 */
export function bakeCorpse(group: THREE.Group): THREE.Mesh[] {
  const rig = group.userData.rig as THREE.Group;
  group.updateWorldMatrix(true, true);
  const toBody = group.matrixWorld.clone().invert();
  const batches = new Map<string, { from: THREE.Mesh; parts: THREE.BufferGeometry[] }>();
  let mergeable = true;
  rig.traverseVisible(node => {
    if (node instanceof THREE.Sprite || node instanceof THREE.Line || node instanceof THREE.Points) { mergeable = false; return; }
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry as THREE.BufferGeometry, material = node.material as THREE.Material | THREE.Material[];
    if (node.constructor !== THREE.Mesh || Array.isArray(material) || Object.keys(geometry.morphAttributes).length || node.matrixWorld.determinant() < 0) { mergeable = false; return; }
    const key = `${material.uuid}|${Object.keys(geometry.attributes).sort().join()}|${node.castShadow}|${node.receiveShadow}|${node.renderOrder}|${node.frustumCulled}`;
    let batch = batches.get(key); if (!batch) batches.set(key, batch = { from: node, parts: [] });
    batch.parts.push(geometry.clone().applyMatrix4(toBody.clone().multiply(node.matrixWorld)));
  });
  // A batch that mixes indexed and unindexed parts is merged unindexed: the same triangles, a few more vertices.
  const merged = mergeable ? [...batches.values()].map(({ parts }) => mergeGeometries(parts.every(part => part.index) ? parts : parts.map(part => part.index ? part.toNonIndexed() : part))) : [];
  for (const { parts } of batches.values()) parts.forEach(part => part.dispose());
  if (!mergeable || !merged.length || merged.some(geometry => !geometry)) { merged.forEach(geometry => geometry?.dispose()); return []; }
  const meshes = [...batches.values()].map(({ from }, i) => {
    const mesh = new THREE.Mesh(merged[i]!, from.material);
    mesh.name = 'corpse'; mesh.castShadow = from.castShadow; mesh.receiveShadow = from.receiveShadow; mesh.renderOrder = from.renderOrder; mesh.frustumCulled = from.frustumCulled;
    return mesh;
  });
  rig.visible = false; group.add(...meshes);
  return meshes;
}
