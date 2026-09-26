import * as THREE from 'three';

// Read-only diagnostics behind the development-only test hooks. Nothing in the game calls any of this.

/**
 * A structural fingerprint of everything under `root`, for a trace that has to notice a floor built
 * differently: every mesh in traversal order - its kind, visibility, geometry size, material and colour,
 * and its transform - with an instanced mesh's matrices and colours folded in. Sums rather than a hash,
 * so a comparison can allow for arithmetic reordered in the last bit and still catch a real change.
 */
export const sceneDigest = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true);
  let meshes = 0, instances = 0, vertices = 0, visible = 0, matrixSum = 0, weightedSum = 0, colourSum = 0;
  const kinds: string[] = [];
  const scratch = new THREE.Matrix4(), colour = new THREE.Color();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Sprite) && !(o instanceof THREE.Points)) return;
    meshes++; if (o.visible) visible++;
    const geometry = o.geometry as THREE.BufferGeometry;
    vertices += geometry.getAttribute('position')?.count ?? 0;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    kinds.push(`${o.type}:${materials.map((m) => `${m.type}${(m as THREE.MeshBasicMaterial).color ? '#' + (m as THREE.MeshBasicMaterial).color.getHexString() : ''}`).join('+')}`);
    const fold = (m: THREE.Matrix4, weight: number) => m.elements.forEach((e, i) => { matrixSum += e; weightedSum += e * ((i % 5) + 1) * weight; });
    fold(o.matrixWorld, meshes);
    if (o instanceof THREE.InstancedMesh) {
      instances += o.count;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, scratch); fold(scratch, i + 1);
        if (o.instanceColor) { o.getColorAt(i, colour); colourSum += colour.r + 2 * colour.g + 3 * colour.b; }
      }
    }
  });
  // The kinds list is long; its shape is what matters, so it is reduced to a count per kind.
  const byKind: Record<string, number> = {};
  for (const kind of kinds) byKind[kind] = (byKind[kind] ?? 0) + 1;
  return { meshes, visible, instances, vertices, matrixSum, weightedSum, colourSum, byKind };
};
