import * as THREE from 'three';

// World-space currents stay the same size across differently sized generated floors.
export function tidalMaterial() {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: 0x17454d, roughness: 0.3, metalness: 0.28 });
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
        float ripples = sin(p.x * 12.0 + p.y * 9.0 + crosswave + tideTime * 1.4) * sin(p.x * 7.0 - p.y * 11.0 - tideTime);
        float caustic = pow(max(0.0, sin(p.x * 2.3 + sin(p.y * 1.7 + tideTime * .3)) * cos(p.y * 2.1 + sin(p.x * 1.6 - tideTime * .25))), 8.0);
        diffuseColor.rgb *= 0.8 + swell * 0.13 + crosswave * 0.09 + ripples * .035;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.57, 0.52), ribbons * 0.065 + caustic * .12);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 waveSlope = vec2(
          cos(tideWorld.x * 1.7 + tideWorld.z * 1.1 + tideTime * .85) * .075,
          cos(tideWorld.z * 3.7 - tideWorld.x * .6 - tideTime * 1.2) * .055);
        normal = normalize(normal + mat3(viewMatrix) * vec3(waveSlope.x, 0.0, waveSlope.y));
      `);
  };
  material.customProgramCacheKey = () => 'tidal-currents-v3';
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
        float wetStone = smoothstep(.28, .7, patches + grain * .06);
        float tideMark = 1.0 - smoothstep(-2.35, -1.65, stoneWorld.y + patches * .16);
        wetStone = max(wetStone * (1.0 - smoothstep(.15, 1.6, stoneWorld.y)), tideMark);
        diffuseColor.rgb *= (.96 + patches * .10) * (1.0 - wetStone * .28);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.62, .83, .57), moss * .38);
        diffuseColor.rgb *= 1.0 - tideMark * .22;
        // Staggered submerged masonry courses keep the platform sides from reading as solid boxes.
        float course = stoneWorld.y * 1.75;
        vec2 joints = fract(vec2((stoneWorld.x + stoneWorld.z) * .68 + mod(floor(course), 2.0) * .5, course));
        float seam = 1.0 - smoothstep(.012, .035, min(min(joints.x, 1.0 - joints.x), min(joints.y, 1.0 - joints.y)));
        diffuseColor.rgb *= 1.0 - seam * .35 * (1.0 - smoothstep(-.3, -.15, stoneWorld.y));
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .28, wetStone * .88);
      `);
  };
  material.customProgramCacheKey = () => 'weathered-stone-v3';
}

// One instanced shoreline draw, with soft broken foam rather than a bright outline of the grid.
export function shorelineMaterial() {
  const time = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0x9fcac0, transparent: true, opacity: .48, depthWrite: false, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.shoreTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 shoreUv;\nvarying vec3 shoreWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        shoreUv = uv;
        vec4 shorePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          shorePosition = instanceMatrix * shorePosition;
        #endif
        shoreWorld = (modelMatrix * shorePosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float shoreTime;\nvarying vec2 shoreUv;\nvarying vec3 shoreWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float flow = sin(shoreWorld.x * 7.0 + shoreWorld.z * 5.0 + shoreTime * 1.1);
        float band = exp(-pow((shoreUv.y - .48 - flow * .13) * 9.0, 2.0));
        float flecks = smoothstep(-.15, .7, sin(shoreWorld.x * 19.0 - shoreWorld.z * 13.0 + shoreTime * .6));
        diffuseColor.a *= band * (.3 + flecks * .7) * smoothstep(0.0, .12, shoreUv.x) * smoothstep(0.0, .12, 1.0 - shoreUv.x);
      `);
  };
  material.customProgramCacheKey = () => 'shore-foam-v1';
  return { material, time };
}

// Keep the shoulder edge pinned; movement travels progressively toward the hem.
export function animateCloth(mesh: THREE.Mesh, time: number, strength: number) {
  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let rest = mesh.geometry.userData.rest as Float32Array | undefined;
  if (!rest) {
    rest = new Float32Array(positions.array); mesh.geometry.userData.rest = rest;
    let top=-Infinity,bottom=Infinity;for(let i=0;i<positions.count;i++){top=Math.max(top,rest[i*3+1]);bottom=Math.min(bottom,rest[i*3+1]);}
    mesh.geometry.userData.clothSpan={top,length:Math.max(.001,top-bottom)};
  }
  const {top,length}=mesh.geometry.userData.clothSpan as {top:number;length:number};
  for (let i = 0; i < positions.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    const free = THREE.MathUtils.clamp((top - y) / length, 0, 1);
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

export function contactTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const shade = ctx.createRadialGradient(32,32,4,32,32,32);
  shade.addColorStop(0,'rgba(3,12,16,.55)'); shade.addColorStop(.45,'rgba(3,12,16,.3)'); shade.addColorStop(1,'rgba(3,12,16,0)');
  ctx.fillStyle=shade;ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(canvas);
}
