import * as THREE from 'three';

// A short history of the blade in world space. Fixed buffers are shared across
// every swing of this weapon; neither a swing nor a frame allocates geometry.
//
// `fan` scales the sampled blade radially about the hand before the ribbon is
// built: the knight's own cut is drawn from well inside the grip out to the
// reach the arc actually covers, which is a crescent rather than a streak and
// costs nothing — the index buffer, the capacity and the draw call are the same
// whatever the fan is set to. Enemies leave it at 1 and trail their own steel.
export function weaponTrail(color: number, lifetime = .1, fan: { inner: number; outer: number } = { inner: 1, outer: 1 }) {
  const capacity = 24, samples = new Float32Array(capacity * 7);
  const positions = new Float32Array(capacity * 6), colors = new Float32Array(capacity * 8);
  const indices: number[] = [];
  for (let i = 0; i < capacity - 1; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  const uvs=new Float32Array(capacity*4);for(let i=0;i<capacity;i++){uvs[i*4]=0;uvs[i*4+2]=1;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geometry.setIndex(indices); geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  // A luminous cutting edge over a translucent fan, sampled from the same blade history.
  mesh.material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float bladeEdge;').replace('#include <begin_vertex>','#include <begin_vertex>\nbladeEdge = uv.x;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float bladeEdge;').replace('#include <color_fragment>',`#include <color_fragment>
      float edge = smoothstep(.78, .98, bladeEdge);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.7, 1.74, 1.62), edge * .9);
      diffuseColor.a *= smoothstep(0.0, .34, bladeEdge) * (.26 + edge * .8);
    `);
  };
  mesh.material.customProgramCacheKey=()=> 'blade-edge-v3';
  mesh.frustumCulled = false; mesh.visible = false;
  const root = new THREE.Vector3(), tip = new THREE.Vector3();
  let count = 0, wasEmitting = false;
  const clear = () => { count = 0; wasEmitting = false; mesh.visible = false; geometry.setDrawRange(0, 0); };
  return {
    mesh,
    clear,
    update(dt: number, emitting: boolean, weapon: THREE.Object3D, inner: THREE.Vector3, outer: THREE.Vector3) {
      // Redrawing a paused/manual frame must not add a second sample or age it.
      if (!(dt > 0)) return;
      if (emitting && !wasEmitting) count = 0;
      wasEmitting = emitting;
      for (let i = 0; i < count; i++) samples[i * 7 + 6] += dt;
      let expired = 0;
      while (expired < count && samples[expired * 7 + 6] >= lifetime) expired++;
      if (expired) { samples.copyWithin(0, expired * 7, count * 7); count -= expired; }
      if (emitting) {
        weapon.updateWorldMatrix(true, false);
        root.copy(inner).multiplyScalar(fan.inner).applyMatrix4(weapon.matrixWorld);
        tip.copy(outer).multiplyScalar(fan.outer).applyMatrix4(weapon.matrixWorld);
        if (count === capacity) { samples.copyWithin(0, 7); count--; }
        const offset = count++ * 7;
        samples[offset] = root.x; samples[offset + 1] = root.y; samples[offset + 2] = root.z;
        samples[offset + 3] = tip.x; samples[offset + 4] = tip.y; samples[offset + 5] = tip.z; samples[offset + 6] = 0;
      }
      for (let i = 0; i < count; i++) {
        const offset = i * 7, fade = Math.max(0, 1 - samples[offset + 6] / lifetime);
        // An ageing sample keeps most of its width. Collapsing it to the tip, as
        // this used to, thinned the whole arc to a wire two frames after the cut.
        const width = i === 0 ? 0 : .42 + fade * .58;
        for (let axis = 0; axis < 3; axis++) {
          const end = samples[offset + 3 + axis];
          positions[i * 6 + axis] = end + (samples[offset + axis] - end) * width;
          positions[i * 6 + 3 + axis] = end;
        }
        for (let vertex = 0; vertex < 2; vertex++) {
          const c = i * 8 + vertex * 4;
          colors[c] = colors[c + 1] = colors[c + 2] = 1;
          colors[c + 3] = i === 0 ? 0 : fade * (.4 + fade * .6) * (vertex ? 1 : .18);
        }
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
      geometry.setDrawRange(0, Math.max(0, count - 1) * 6); mesh.visible = count > 1;
    },
  };
}
