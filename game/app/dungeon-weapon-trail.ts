import * as THREE from 'three';

// Plan 014 round 9 (lever 1): this used to connect raw per-frame samples with straight quads - a
// "wide flat fan" between however many samples a swing happened to record (eight or nine at 60fps
// over a .15-.22s window), which is a faceted polygon, not a crescent. The fix the plan asked for is
// specific: track the blade tip's own recorded world positions, run a Catmull-Rom spline through
// them for real curvature independent of how many raw samples exist, and taper a ribbon width around
// that spline rather than fanning out from a hilt point. `reach` scales the ribbon's own thickness
// (the knight's cut is meant to read as a wide crescent stroke; an enemy's is a thin blade-width
// sliver), not a radial fan span - the width itself now comes from how far apart the weapon's own
// `inner`/`outer` reference points are in world space each frame, which already varies sensibly with
// the actual weapon's length.
// Plan 014 round A: `glow` scales the ribbon's colour past 1 (the material is not tone-mapped, so a
// value over 1 is what reaches the bloom pass). The knight's cut passes ~3 so it lands as a hot white
// crescent in a frame that is otherwise mostly dark; an enemy's thin blade sliver keeps the default.
export function weaponTrail(color: number, lifetime = .1, reach = 1, glow = 1) {
  const HISTORY = 20, SEGMENTS = 26;
  // Raw recorded samples: tip position (xyz), a running width hint (from live inner/outer distance)
  // and age, oldest-first once compacted.
  const history = new Float32Array(HISTORY * 5);
  let count = 0, wasEmitting = false;
  // Which way is "out" (away from the wielder) across the ribbon, from the last emitted sample - so
  // the bright cutting edge always lands on the crescent's outer rim, whichever way the swing runs.
  let outX = 0, outZ = 0;
  const tipPoint = new THREE.Vector3(), rootPoint = new THREE.Vector3();
  const curvePoints: THREE.Vector3[] = Array.from({ length: HISTORY }, () => new THREE.Vector3());
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', .5);

  const vertexCount = (SEGMENTS + 1) * 2;
  const positions = new Float32Array(vertexCount * 3), colors = new Float32Array(vertexCount * 4), uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i <= SEGMENTS; i++) { uvs[i * 4] = i / SEGMENTS; uvs[i * 4 + 1] = 0; uvs[i * 4 + 2] = i / SEGMENTS; uvs[i * 4 + 3] = 1; }
  const indices: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  mesh.material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 bladeUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nbladeUv = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 bladeUv;').replace('#include <color_fragment>', `#include <color_fragment>
      // bladeUv.x: 0 at the tail (oldest, fully faded), 1 at the head (the blade's current position).
      // bladeUv.y: 0/1 across the ribbon's own width - the outer rim (near 1) is the cutting edge
      // itself, so that is where the plan's "thin bright white leading edge" belongs, not the whole
      // ribbon. The body between the white rim and the ribbon's own centreline is a cyan-to-
      // transparent gradient, and the whole thing tapers to nothing at the tail via bladeUv.x alone
      // (the geometry itself already collapses the width there - this is the colour half of the taper).
      float rim = smoothstep(.66, .95, bladeUv.y);
      float tail = pow(clamp(bladeUv.x, 0.0, 1.0), .8);
      vec3 core = vec3(1.0, .98, .92) * ${glow.toFixed(2)};
      vec3 cyan = vec3(.3, .75, 1.0) * ${Math.max(1, glow * .45).toFixed(2)};
      diffuseColor.rgb = mix(cyan, core, rim);
      diffuseColor.a *= tail * (.16 + rim * .84);
    `);
  };
  mesh.material.customProgramCacheKey = () => `blade-edge-v5-${glow}`;
  mesh.frustumCulled = false; mesh.visible = false;
  const clear = () => { count = 0; wasEmitting = false; mesh.visible = false; geometry.setDrawRange(0, 0); };
  return {
    mesh,
    clear,
    update(dt: number, emitting: boolean, weapon: THREE.Object3D, inner: THREE.Vector3, outer: THREE.Vector3) {
      // Redrawing a paused/manual frame must not add a second sample or age it.
      if (!(dt > 0)) return;
      if (emitting && !wasEmitting) count = 0;
      wasEmitting = emitting;
      for (let i = 0; i < count; i++) history[i * 5 + 4] += dt;
      let expired = 0;
      while (expired < count && history[expired * 5 + 4] >= lifetime) expired++;
      if (expired) { history.copyWithin(0, expired * 5, count * 5); count -= expired; }
      if (emitting) {
        weapon.updateWorldMatrix(true, false);
        rootPoint.copy(inner).applyMatrix4(weapon.matrixWorld);
        tipPoint.copy(outer).applyMatrix4(weapon.matrixWorld);
        const width = rootPoint.distanceTo(tipPoint) * reach;
        outX = tipPoint.x - rootPoint.x; outZ = tipPoint.z - rootPoint.z;
        if (count === HISTORY) { history.copyWithin(0, 5); count--; }
        const offset = count++ * 5;
        history[offset] = tipPoint.x; history[offset + 1] = tipPoint.y; history[offset + 2] = tipPoint.z;
        history[offset + 3] = width; history[offset + 4] = 0;
      }
      if (count < 2) { mesh.visible = false; geometry.setDrawRange(0, 0); return; }
      // A real Catmull-Rom spline through the recorded tip positions - smooth regardless of how
      // sparse the raw samples are, which a straight-line fan between them never was.
      for (let i = 0; i < count; i++) curvePoints[i].set(history[i * 5], history[i * 5 + 1], history[i * 5 + 2]);
      curve.points = curvePoints.slice(0, count);
      const points = curve.getPoints(SEGMENTS);
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        // Map the spline's own uniform parameter back onto the recorded samples' width and age, so a
        // long-lived tail (many samples still in the buffer) and a short one both taper correctly.
        const raw = t * (count - 1), lo = Math.min(count - 2, Math.floor(raw)), frac = raw - lo;
        const width = (history[lo * 5 + 3] * (1 - frac) + history[(lo + 1) * 5 + 3] * frac) * Math.pow(t, .6);
        const p = points[i], next = points[Math.min(SEGMENTS, i + 1)], prev = points[Math.max(0, i - 1)];
        const tangentX = next.x - prev.x, tangentZ = next.z - prev.z, tangentLen = Math.hypot(tangentX, tangentZ) || 1;
        // Perpendicular to the sweep's own horizontal direction - a sword swing is overwhelmingly a
        // yaw sweep, so this is the axis that actually needs a cross-section.
        let px = -tangentZ / tangentLen * width * .5, pz = tangentX / tangentLen * width * .5;
        // Round A: +perp (uv.y = 1, the bright rim) always points away from the wielder, so the hot
        // cutting edge is the crescent's outer rim whichever way the swing runs.
        if (px * outX + pz * outZ < 0) { px = -px; pz = -pz; }
        positions[i * 6] = p.x - px; positions[i * 6 + 1] = p.y; positions[i * 6 + 2] = p.z - pz;
        positions[i * 6 + 3] = p.x + px; positions[i * 6 + 4] = p.y; positions[i * 6 + 5] = p.z + pz;
        for (let vertex = 0; vertex < 2; vertex++) { const c = i * 8 + vertex * 4; colors[c] = colors[c + 1] = colors[c + 2] = 1; colors[c + 3] = 1; }
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
      geometry.setDrawRange(0, SEGMENTS * 6); mesh.visible = true;
    },
  };
}
