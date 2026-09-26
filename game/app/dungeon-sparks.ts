import * as THREE from 'three';

// Every spark in the keep - hit grit, blood mist, bone dust, embers, the stair and shrine flourishes - in
// one pooled, instanced draw. They used to be a fresh `THREE.Mesh` per spark, and a fresh material per
// burst for any colour but the default: one sword blow through three bodies put seventy-odd meshes in the
// scene for half a second, each its own draw call in the scene pass and again in GTAO's pre-pass, and
// each allocation its own garbage. The motion is unchanged, down to the order `Math.random` is drawn in.

/** More live sparks than any frame the game produces; a burst that would overflow it is cut short. */
export const SPARK_CAPACITY = 512;

export const createSparks = (capacity = SPARK_CAPACITY) => {
  const geometry = new THREE.TetrahedronGeometry(0.075, 0);
  // White, and coloured per instance: the colour a spark used to carry in its own material is its
  // instance colour now, converted to linear the same way `material.color` was.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  // The instances move every frame, so a bounding sphere computed once would soon cull live sparks.
  mesh.frustumCulled = false;
  mesh.count = 0; mesh.visible = false;
  const position = new Float32Array(capacity * 3), velocity = new Float32Array(capacity * 3), life = new Float32Array(capacity);
  const colour = new THREE.Color(), at = new THREE.Vector3(), size = new THREE.Vector3(), still = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  let live = 0;
  const colours = mesh.instanceColor!.array as Float32Array;
  return {
    mesh,
    get active() { return live; },
    /** `amount` sparks thrown from 0.8 above `at`, outward and up, for a third to two thirds of a second. */
    burst(from: THREE.Vector3, colourHex = 0xffb24a, amount = 12) {
      colour.setHex(colourHex);
      for (let i = 0; i < amount; i++) {
        const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
        const vy = 1.5 + Math.random() * 3, lifetime = 0.35 + Math.random() * 0.3;
        if (live >= capacity) continue;
        const k = live++;
        position[k * 3] = from.x; position[k * 3 + 1] = from.y + 0.8; position[k * 3 + 2] = from.z;
        velocity[k * 3] = Math.cos(a) * s; velocity[k * 3 + 1] = vy; velocity[k * 3 + 2] = Math.sin(a) * s;
        life[k] = lifetime;
        colours[k * 3] = colour.r; colours[k * 3 + 1] = colour.g; colours[k * 3 + 2] = colour.b;
      }
    },
    /** Falls, shrinks and expires every spark by `dt` of world time, then writes the instances. */
    update(dt: number) {
      for (let k = 0; k < live; k++) {
        life[k] -= dt; velocity[k * 3 + 1] -= dt * 7;
        position[k * 3] += velocity[k * 3] * dt; position[k * 3 + 1] += velocity[k * 3 + 1] * dt; position[k * 3 + 2] += velocity[k * 3 + 2] * dt;
      }
      // Expired sparks are replaced by the last live one; draw order means nothing for an opaque batch.
      for (let k = live - 1; k >= 0; k--) {
        if (life[k] > 0) continue;
        const last = --live;
        if (k === last) continue;
        for (let c = 0; c < 3; c++) { position[k * 3 + c] = position[last * 3 + c]; velocity[k * 3 + c] = velocity[last * 3 + c]; colours[k * 3 + c] = colours[last * 3 + c]; }
        life[k] = life[last];
      }
      for (let k = 0; k < live; k++) {
        const scale = Math.max(0, life[k] * 2);
        mesh.setMatrixAt(k, matrix.compose(at.set(position[k * 3], position[k * 3 + 1], position[k * 3 + 2]), still, size.set(scale, scale, scale)));
      }
      mesh.count = live; mesh.visible = live > 0;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
    },
    clear() { live = 0; mesh.count = 0; mesh.visible = false; },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
};
