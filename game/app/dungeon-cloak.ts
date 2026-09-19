import * as THREE from 'three';

export function playerCloakGeometry() {
  const geometry = new THREE.PlaneGeometry(1, 1, 8, 10), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * 2, free = .5 - positions.getY(i);
    positions.setXYZ(i, u * (.37 + free * .15), -free * .98 + (free > .99 ? .035 * Math.abs(u) : 0),
      .07 * (1 - u * u) + free * .14 + Math.sin(u * 12) * .02 * free);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}
