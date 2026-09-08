import * as THREE from 'three';

// World-space currents stay the same size across differently sized generated floors.
export function tidalMaterial() {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: 0x237f84, roughness: 0.3, metalness: 0.3 });
  material.onBeforeCompile = shader => {
    shader.uniforms.tideTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tideWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntideWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float tideTime;\nvarying vec3 tideWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = tideWorld.xz;
        float swell = sin(p.x * 1.7 + p.y * 1.1 + tideTime * 0.85);
        float crosswave = sin(p.y * 3.7 - p.x * 0.6 - tideTime * 1.2 + swell);
        float ribbons = smoothstep(0.94, 0.995, sin(p.x * 5.8 + p.y * 4.0 + crosswave * 1.4 + tideTime));
        ribbons *= smoothstep(0.0, 0.7, sin(p.y * 2.3 - p.x * 1.4 + tideTime * 0.4));
        diffuseColor.rgb *= 0.78 + swell * 0.12 + crosswave * 0.08;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.72, 0.69), ribbons * 0.24);
      `);
  };
  material.customProgramCacheKey = () => 'tidal-currents-v1';
  return { material, time };
}

export function weatherStone(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 stonePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          stonePosition = instanceMatrix * stonePosition;
        #endif
        stoneWorld = (modelMatrix * stonePosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = stoneWorld.xz;
        float patches = sin(p.x * 0.72 + sin(p.y * 1.2)) * sin(p.y * 0.84 - p.x * 0.35);
        float grain = sin(p.x * 13.0 + sin(p.y * 9.0)) * sin(p.y * 17.0);
        float moss = smoothstep(0.25, 0.8, patches + grain * 0.18);
        diffuseColor.rgb *= 0.94 + patches * 0.12;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.83, 0.57), moss * 0.65);
      `);
  };
  material.customProgramCacheKey = () => 'weathered-stone-v1';
}

// Keep the shoulder edge pinned; movement travels progressively toward the hem.
export function animateCloth(mesh: THREE.Mesh, time: number, strength: number) {
  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let rest = mesh.geometry.userData.rest as Float32Array | undefined;
  if (!rest) { rest = new Float32Array(positions.array); mesh.geometry.userData.rest = rest; }
  const height = mesh.geometry.boundingBox?.max.y ?? 0.6;
  for (let i = 0; i < positions.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    const free = THREE.MathUtils.clamp((height - y) / (height * 2), 0, 1);
    positions.setZ(i, rest[i * 3 + 2] + free * free * strength * (Math.sin(time * 5 - free * 3 + x * 4) + 0.35 * Math.sin(time * 8 + x * 8)));
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

export function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, '#fff6dcff'); glow.addColorStop(0.12, '#ffce8acc');
  glow.addColorStop(0.4, '#ff872e44'); glow.addColorStop(1, '#ff600000');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
