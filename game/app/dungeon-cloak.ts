import * as THREE from 'three';

export function playerCloakGeometry() {
  // Ten by twelve rather than eight by ten, and the standing ripple is more than doubled. At rest the
  // cape is a sliver and the old numbers were enough; in the dash and strike strips it swings out flat
  // to the camera and covered more of the frame than the knight did, as one unbroken red plane with a
  // single value. Folds deep enough to shade give that plane a light side and a dark side, which is the
  // difference between cloth and a kite — and they cost eighty triangles on one mesh.
  const geometry = new THREE.PlaneGeometry(1, 1, 10, 12), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * 2, free = .5 - positions.getY(i);
    positions.setXYZ(i, u * (.37 + free * .15), -free * .98 + (free > .99 ? .035 * Math.abs(u) : 0),
      // The fold runs out towards the hem rather than growing with it: cloth pinned at the shoulders
      // creases hardest where it is held and hangs loose at the bottom.
      .07 * (1 - u * u) + free * .15 + Math.sin(u * 9) * .046 * free * (1 - free * .3));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}
