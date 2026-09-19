import * as THREE from 'three';

// World-space currents stay the same size across differently sized generated floors. `shoal` carries the
// keep's footprint — centre in xy, half-extent in zw — so depth can be read off the distance outside it.
// That buys an open-water gradient without a second texture or a subdivided plane.
export function tidalMaterial(shallows = new THREE.Vector4(0, 0, 12, 12)) {
  const time = { value: 0 };
  const shoal = { value: shallows };
  const material = new THREE.MeshStandardMaterial({ color: 0x17454d, roughness: 0.3, metalness: 0.28 });
  material.onBeforeCompile = shader => {
    shader.uniforms.tideTime = time;
    shader.uniforms.tideShoal = shoal;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tideWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntideWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float tideTime;\nuniform vec4 tideShoal;\nvarying vec3 tideWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = tideWorld.xz;
        float swell = sin(p.x * 1.7 + p.y * 1.1 + tideTime * 0.85);
        float crosswave = sin(p.y * 3.7 - p.x * 0.6 - tideTime * 1.2 + swell);
        float ribbons = smoothstep(0.94, 0.995, sin(p.x * 5.8 + p.y * 4.0 + crosswave * 1.4 + tideTime));
        ribbons *= smoothstep(0.0, 0.7, sin(p.y * 2.3 - p.x * 1.4 + tideTime * 0.4));
        float ripples = sin(p.x * 12.0 + p.y * 9.0 + crosswave + tideTime * 1.4) * sin(p.x * 7.0 - p.y * 11.0 - tideTime);
        float caustic = pow(max(0.0, sin(p.x * 2.3 + sin(p.y * 1.7 + tideTime * .3)) * cos(p.y * 2.1 + sin(p.x * 1.6 - tideTime * .25))), 8.0);
        // How far outside the keep's footprint this fragment lies, softened by the swell so the
        // gradient never traces a rectangle.
        vec2 outside = max(abs(p - tideShoal.xy) - tideShoal.zw, vec2(0.0));
        float deep = smoothstep(0.5, 15.0, length(outside) + swell * .6);
        diffuseColor.rgb *= 0.8 + swell * 0.13 + crosswave * 0.09 + ripples * .035;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.57, 0.52), ribbons * 0.065 + caustic * .12);
        // Shallows over drowned paving stay light and green; open water falls away to near black, which
        // is what finally gives the frame somewhere dark to put the rest of its value range.
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(1.42, 1.34, 1.08), diffuseColor.rgb * vec3(.30, .43, .54), deep);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 waveSlope = vec2(
          cos(tideWorld.x * 1.7 + tideWorld.z * 1.1 + tideTime * .85) * .075,
          cos(tideWorld.z * 3.7 - tideWorld.x * .6 - tideTime * 1.2) * .055);
        normal = normalize(normal + mat3(viewMatrix) * vec3(waveSlope.x, 0.0, waveSlope.y));
      `);
  };
  material.customProgramCacheKey = () => 'tidal-currents-v4';
  return { material, time, shoal };
}

/**
 * World-space weathering for every stone surface in the keep.
 *
 * The version this replaced built its variation out of products of sines. Two things were wrong with
 * that, and a blind critic reading the frames caught both. `sin(x) * sin(z)` is separable, so it lays
 * down an axis-aligned plaid — on an axis-aligned tile grid it lands in step with the grid and deepens
 * it. And the octaves it did have sat either side of the band that matters: one wavelength longer than
 * the whole visible frame, the rest shorter than a centimetre of stone. Nothing at all between half a
 * tile and four tiles, which is exactly the range the eye reads as dirt and wear.
 *
 * So: hashed value noise, rotated between octaves so no frequency lines up with the grid or with any
 * other, over roughly 1.5 to 6 world units — under a tile to four tiles. It is continuous across tile
 * boundaries because it is a function of world position and nothing else, which is the whole point: a
 * stain has to cross a joint or the joint stays the loudest thing in the room. Pure ALU, no texture,
 * no draw call, no triangle.
 */
const STONE_NOISE = `
  float stoneHash(vec2 p){
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float stoneNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(stoneHash(i), stoneHash(i + vec2(1.0, 0.0)), f.x),
               mix(stoneHash(i + vec2(0.0, 1.0)), stoneHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float stoneFbm(vec2 p){
    const mat2 turn = mat2(0.8776, 0.4794, -0.4794, 0.8776);
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 3; i++) { sum += amp * stoneNoise(p); p = turn * p * 2.07 + 17.3; amp *= 0.5; }
    return sum / 0.875;
  }
`;

export function weatherStone(material: THREE.MeshStandardMaterial, firelit = false) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 stonePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          stonePosition = instanceMatrix * stonePosition;
        #endif
        stoneWorld = (modelMatrix * stonePosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;\n' + STONE_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = stoneWorld.xz;
        // Two independent fields so value and staining are not the same shape. The weave runs about six
        // world units down to one and a half — four tiles down to one — and carries the value. The damp
        // field is finer and offset, and carries moss, wet and the cracks.
        float weave = stoneFbm(p * .17);
        float damp = stoneFbm(p * .38 + 31.4);
        float grit = stoneNoise(p * 4.3);
        float mottle = (weave - .5) * 2.0;
        // Wear: stone that gets walked on polishes up. Broad, soft, and crossing joints freely, so a
        // lit pool has somewhere to fall across instead of a flat plane to sit on top of.
        float wear = smoothstep(.36, .82, weave + grit * .12);
        float moss = smoothstep(.54, .95, damp * .8 + (1.0 - weave) * .34);
        // A crack is a contour line of a noise field, which knows nothing about tiles and so runs across
        // them. Taken off the damp field it came out as a long smooth hose, because the contour of a
        // smooth low-frequency field is a smooth low-frequency curve. So: a higher-frequency field with a
        // second octave on it, to put a wobble in at well under a slab's width, and a separate slow field
        // gating where it shows at all, so it breaks into runs instead of snaking across the whole room.
        float vein = stoneNoise(p * 1.35 + 43.0) * .72 + stoneNoise(p * 3.1 + 7.0) * .28;
        float crack = (1.0 - smoothstep(0.0, .04, abs(vein - .5))) * smoothstep(.32, .66, stoneNoise(p * .42 + 9.0));
        float wetStone = smoothstep(.46, .86, damp);
        float tideMark = 1.0 - smoothstep(-2.35, -1.65, stoneWorld.y + mottle * .16);
        wetStone = max(wetStone * (1.0 - smoothstep(.15, 1.6, stoneWorld.y)), tideMark);
        // Value first, and inside a slab rather than between slabs.
        // The constant is set so the mean over the whole field lands where the previous version's did.
        // The point of this round is to widen the variation, not to move the room's overall value: the
        // knight is lit by the same lamps as the floor, and dropping the floor drops him with it.
        diffuseColor.rgb *= (.80 + mottle * .30 + grit * .08) * (1.0 + wear * .16) * (1.0 - wetStone * .30);
        diffuseColor.rgb *= 1.0 - crack * .30;
        // Then temperature, split about zero: dry dust warms the high ground, damp cools the hollows.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.13, 1.04, .88), max(0.0, mottle) * .42);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.82, .92, .99), max(0.0, -mottle) * .42);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.66, .82, .60), moss * .34);
        diffuseColor.rgb *= 1.0 - tideMark * .26;
        // Everything falls off toward the waterline, where no light reaches.
        diffuseColor.rgb *= .86 + .14 * smoothstep(-2.8, .5, stoneWorld.y);
        ${firelit ? `
        // A brazier bowl stands directly under a fire. It takes a warm bounce up its inside lip and
        // falls away to almost nothing at the foot, rather than being one value from base to rim.
        float heat = smoothstep(-.06, .88, stoneWorld.y);
        diffuseColor.rgb *= .48 + heat * 1.02;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.65, 1.06, .58), heat * heat * .6);
        ` : ''}
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
  // The two variants compile to different fragment shaders, so they must not share a cache entry.
  material.customProgramCacheKey = () => (firelit ? 'weathered-stone-v5-firelit' : 'weathered-stone-v5');
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
        // A shadowed skirt on the stone side of the foam. Without it a platform reads as pasted onto the
        // water rather than as standing in it.
        float skirt = smoothstep(.95, .38, shoreUv.y) * smoothstep(.04, .26, shoreUv.y);
        float crest = band * (.3 + flecks * .7);
        diffuseColor.rgb = mix(vec3(.025, .085, .115), diffuseColor.rgb, clamp(crest * 2.4, 0.0, 1.0));
        diffuseColor.a *= clamp(crest + skirt * .5, 0.0, 1.0) * smoothstep(0.0, .12, shoreUv.x) * smoothstep(0.0, .12, 1.0 - shoreUv.x);
      `);
  };
  material.customProgramCacheKey = () => 'shore-foam-v2';
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
