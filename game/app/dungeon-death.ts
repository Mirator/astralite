import * as THREE from 'three';

export type FallenKind = 'guard' | 'stalker' | 'warden';
export const DEATH_DURATION = { guard: .7, stalker: .55, warden: .95 };
type Joint = { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; endPosition: THREE.Vector3; endRotation: THREE.Quaternion };
export type DeathAnimation = { age: number; duration: number; settled: boolean; joints: Joint[] };

// Capture the interrupted pose, then fall into a fixed, full-size corpse. No scene
// objects are created during playback, and damage/collision remain in the combat rules.
export function startDeath(group: THREE.Group, kind: FallenKind): DeathAnimation {
  const rig = group.userData.rig as THREE.Group, limbs = group.userData.limbs as THREE.Group[], weapon = group.userData.weapon as THREE.Group;
  const nodes = [group, rig, ...limbs, weapon, group.userData.shield as THREE.Mesh];
  const joints = nodes.map(node => ({ node, position: node.position.clone(), rotation: node.quaternion.clone(), endPosition: new THREE.Vector3(), endRotation: new THREE.Quaternion() }));
  const prone = kind === 'stalker';
  // Keep the facing, falling forwards for the low stalker and backwards for armored enemies.
  rig.position.set(0, 0, 0); rig.rotation.set(prone ? -Math.PI / 2 : Math.PI / 2, 0, 0);
  limbs.forEach((limb, i) => {
    const side = i % 2 ? 1 : -1;
    limb.rotation.set(0, 0, i < 2 ? side * (prone ? .75 : .62) : side * .17);
  });
  weapon.rotation.set(-rig.rotation.x, .65, 0); weapon.position.set(kind === 'warden' ? .72 : .53, .73, .08);
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
  return { age: 0, duration: DEATH_DURATION[kind], settled: false, joints };
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
}
