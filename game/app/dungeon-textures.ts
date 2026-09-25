// Plan 014 round 3 (lever B5): real, generated stone textures - the critic's standing complaint
// across two rounds was that `weatherStone`'s procedural shading, however world-space and however
// tuned, never reads as an actual photographed/painted material at this zoom. This module renders
// three canvases per stone kind - albedo, a normal map (a Sobel pass over a synthetic height field,
// not a hand-waved bump), and a roughness map with real puddle patches - and `applyStoneTextures`
// below samples all three triplanar (three world-space projections blended by surface normal), so a
// floor, a wall, a parapet and a pillar cap all read the same material correctly however they are
// oriented. `weatherStone` still runs on top for the things it already does well: per-room tint,
// crack/moss placement, the wet-roughness dip and the height-based crown/tide falloff.
import * as THREE from 'three';

/** A tiny deterministic PRNG so every generated canvas is stable across a session. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Height field -> tangent-space normal map via a 3x3 Sobel pass, wrapped so the texture tiles. */
function heightToNormal(height: Float32Array, size: number, strength: number) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = at(x - 1, y), r = at(x + 1, y), u = at(x, y - 1), d = at(x, y + 1);
      const nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

type StoneSet = { albedo: THREE.CanvasTexture; normal: THREE.Texture; roughness: THREE.CanvasTexture };

/**
 * Irregular flagstone slabs: a jittered grid, dark grout between cells, per-cell tone jitter, a
 * scatter of cracks and chips near the grout, and moss finding the grout's low spots. The height
 * field that drives the normal map is the same cell layout, tilted a hair per cell, so the paving
 * key light actually breaks across the joints rather than only the paint suggesting it does.
 *
 * Plan 015 Stage C.2: a generator that yields after every 32-row band of the main pixel loop, which is
 * where this spends nearly all of its time - `flagstoneTextures` below runs it to completion
 * synchronously, so every existing caller (including `dungeonTest.buildFloor`/`reset`, which must stay
 * synchronous and deterministic) sees no change at all. The PRNG (`random`) draws in the same order
 * either way, so a sliced build's output is bit-identical to an unsliced one.
 */
export function* flagstoneTexturesSteps(size = 640, seed = 1): Generator<void, StoneSet> {
  const random = rng(seed);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rough = document.createElement('canvas'); rough.width = rough.height = size;
  const rctx = rough.getContext('2d')!;
  const height = new Float32Array(size * size);

  // Voronoi-ish cells from a jittered grid: cheap, tileable (a torus of grid cells, each with one
  // jittered point), and gives the irregular polygon slabs the reference's floor is cut from rather
  // than a clean checker. Stored as a `cells x cells` grid rather than a flat list so the search
  // below only ever has to look at the pixel's own 3x3 neighbourhood of cells - the flat-list,
  // check-every-point version of this was quadratic enough to make a 1024px canvas visibly hang.
  const cells = 8, cell = size / cells;
  const grid: { x: number; y: number; tone: number; wet: boolean }[][] = [];
  for (let gy = 0; gy < cells; gy++) {
    const row: { x: number; y: number; tone: number; wet: boolean }[] = [];
    for (let gx = 0; gx < cells; gx++) {
      row.push({
        x: (gx + 0.5 + (random() - 0.5) * 0.6) * cell,
        y: (gy + 0.5 + (random() - 0.5) * 0.6) * cell,
        tone: 0.72 + random() * 0.34, wet: random() < 0.16,
      });
    }
    grid.push(row);
  }
  const nearest = (x: number, y: number) => {
    const gx0 = Math.floor(x / cell), gy0 = Math.floor(y / cell);
    let best: { x: number; y: number; tone: number; wet: boolean } | null = null, bestGx = 0, bestGy = 0, bestD = Infinity, second = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const gy = ((gy0 + dy) % cells + cells) % cells, wrapY = Math.floor((gy0 + dy) / cells) * cells * cell;
      for (let dx = -1; dx <= 1; dx++) {
        const gx = ((gx0 + dx) % cells + cells) % cells, wrapX = Math.floor((gx0 + dx) / cells) * cells * cell;
        const p = grid[gy][gx];
        const d = (x - (p.x + wrapX)) ** 2 + (y - (p.y + wrapY)) ** 2;
        if (d < bestD) { second = bestD; bestD = d; best = p; bestGx = gx; bestGy = gy; } else if (d < second) second = d;
      }
    }
    return { cell: best!, id: bestGy * cells + bestGx, edge: Math.sqrt(second) - Math.sqrt(bestD) };
  };

  const image = ctx.createImageData(size, size);
  const roughImage = rctx.createImageData(size, size);
  const base = { r: 0x8f, g: 0x93, b: 0x8c };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { cell: p, id, edge } = nearest(x, y);
      const grout = 1 - Math.min(1, edge / (size * 0.012));
      const grit = (random() - 0.5) * 0.05;
      const speckle = Math.sin(x * 12.9 + y * 7.3 + id * 3.1) * 0.015;
      let tone = p.tone + grit + speckle;
      tone *= 1 - grout * 0.6;
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, base.r * tone));
      image.data[i + 1] = Math.max(0, Math.min(255, base.g * tone * (1 - grout * 0.12)));
      image.data[i + 2] = Math.max(0, Math.min(255, base.b * tone));
      image.data[i + 3] = 255;
      height[y * size + x] = tone - grout * 0.9;
      const puddle = p.wet ? Math.max(0, 1 - edge / (size * 0.05)) : 0;
      const roughValue = Math.max(0.08, Math.min(0.85, 0.74 - grout * 0.1 - puddle * 0.6));
      roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] = roughValue * 255;
      roughImage.data[i + 3] = 255;
    }
    if (y % 32 === 31) yield;
  }
  ctx.putImageData(image, 0, 0); rctx.putImageData(roughImage, 0, 0);

  // Cracks: short jagged strokes crossing a handful of slabs, always starting from a grout line.
  ctx.strokeStyle = 'rgba(20,18,16,0.5)'; ctx.lineWidth = size * 0.0018;
  for (let i = 0; i < 40; i++) {
    let x = random() * size, y = random() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (random() - 0.5) * size * 0.06; y += (random() - 0.5) * size * 0.06; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // Chips: small dark-and-light pairs right at a few grout lines.
  for (let i = 0; i < 60; i++) {
    const x = random() * size, y = random() * size, r = size * (0.004 + random() * 0.008);
    ctx.fillStyle = 'rgba(10,10,8,0.35)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180,175,160,0.18)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, Math.PI * 2); ctx.fill();
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace; albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(rough);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  const normal = heightToNormal(height, size, 2.2);
  return { albedo, normal, roughness };
}

/** Runs {@link flagstoneTexturesSteps} to completion synchronously - every caller before plan 015 Stage
 * C.2, and every one that still needs a texture set in one call rather than across frames. */
export function flagstoneTextures(size = 640, seed = 1): StoneSet {
  const steps = flagstoneTexturesSteps(size, seed);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Coursed masonry: rows of offset rectangular blocks (a running bond, like the hand-built wall
 * batches already do in world space) with mortar joints, per-block tone jitter, and grime pooling in
 * the mortar rather than on the faces.
 *
 * Plan 015 Stage C.2: sliced the same way as {@link flagstoneTexturesSteps} above, for the same reason.
 */
export function* masonryTexturesSteps(size = 640, seed = 2): Generator<void, StoneSet> {
  const random = rng(seed);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rough = document.createElement('canvas'); rough.width = rough.height = size;
  const rctx = rough.getContext('2d')!;
  const height = new Float32Array(size * size);
  const rows = 6, cols = 4;
  const rowH = size / rows;
  const image = ctx.createImageData(size, size);
  const roughImage = rctx.createImageData(size, size);
  const base = { r: 0x93, g: 0x90, b: 0x86 };
  const mortar = size * 0.012;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / rowH);
    const offset = (row % 2) * (size / cols / 2);
    for (let x = 0; x < size; x++) {
      const colW = size / cols;
      const lx = ((x + offset) % colW + colW) % colW;
      const ly = y % rowH;
      const edgeX = Math.min(lx, colW - lx), edgeY = Math.min(ly, rowH - ly);
      const joint = Math.max(0, 1 - Math.min(edgeX, edgeY) / mortar);
      const blockId = Math.floor((x + offset) / colW) * 97 + row * 13;
      const seedTone = Math.sin(blockId * 12.9898) * 43758.5453; const cellTone = seedTone - Math.floor(seedTone);
      const grit = (random() - 0.5) * 0.04;
      let tone = 0.7 + cellTone * 0.3 + grit;
      tone *= 1 - joint * 0.65;
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, base.r * tone));
      image.data[i + 1] = Math.max(0, Math.min(255, base.g * tone));
      image.data[i + 2] = Math.max(0, Math.min(255, base.b * tone * (1 + joint * 0.05)));
      image.data[i + 3] = 255;
      height[y * size + x] = tone - joint * 0.85;
      const roughValue = Math.max(0.35, Math.min(0.92, 0.78 - joint * 0.08));
      roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] = roughValue * 255;
      roughImage.data[i + 3] = 255;
    }
    if (y % 32 === 31) yield;
  }
  ctx.putImageData(image, 0, 0); rctx.putImageData(roughImage, 0, 0);
  // Chips along a few block edges.
  for (let i = 0; i < 50; i++) {
    const x = random() * size, y = random() * size, r = size * (0.003 + random() * 0.006);
    ctx.fillStyle = 'rgba(15,14,12,0.4)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace; albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(rough);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  const normal = heightToNormal(height, size, 2.6);
  return { albedo, normal, roughness };
}

/** Runs {@link masonryTexturesSteps} to completion synchronously - see {@link flagstoneTextures}. */
export function masonryTextures(size = 640, seed = 2): StoneSet {
  const steps = masonryTexturesSteps(size, seed);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

const TRIPLANAR_VARYING = 'varying vec3 stoneNormalWorld;';

/**
 * Wires a `StoneSet` into a `MeshStandardMaterial` as a real, sampled material rather than a plain
 * colour: three world-space projections of each map (along each axis), blended by how much the
 * surface's own normal faces that axis, so the same material reads correctly on a floor, a vertical
 * wall face and a pillar cap without needing a second material or a UV unwrap. `scale` is world units
 * per texture repeat. Call this before (or after) `weatherStone` on the same material - the two
 * `onBeforeCompile` hooks both append to the shader source and do not conflict; `weatherStone`'s own
 * per-room tint and wet/crack terms keep working on top of the sampled albedo instead of on the flat
 * `material.color` they used to multiply.
 */
export function applyStoneTextures(material: THREE.MeshStandardMaterial, set: StoneSet, scale = 1.6) {
  material.onBeforeCompile = ((previous) => (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    previous?.(shader, renderer);
    shader.uniforms.stoneAlbedoMap = { value: set.albedo };
    shader.uniforms.stoneNormalMap = { value: set.normal };
    shader.uniforms.stoneRoughMap = { value: set.roughness };
    shader.uniforms.stoneScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_VARYING}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 stoneObjectNormal = objectNormal;
        #ifdef USE_INSTANCING
          stoneObjectNormal = mat3(instanceMatrix) * stoneObjectNormal;
        #endif
        stoneNormalWorld = normalize(mat3(modelMatrix) * stoneObjectNormal);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_VARYING}
        uniform sampler2D stoneAlbedoMap;
        uniform sampler2D stoneNormalMap;
        uniform sampler2D stoneRoughMap;
        uniform float stoneScale;
      `)
      // Appended *after* the resolved chunk in every case (token first, code after): the chunk itself
      // sets `diffuseColor` from `material.color` first, and only then is there a colour for the
      // sampled albedo to multiply - prepending here would have the triplanar result overwritten the
      // instant the real chunk ran, which is exactly the bug a first version of this had.
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 stoneWeight = pow(abs(stoneNormalWorld), vec3(3.5));
        stoneWeight /= max(1e-5, stoneWeight.x + stoneWeight.y + stoneWeight.z);
        vec2 stoneUvX = stoneWorld.zy * stoneScale;
        vec2 stoneUvY = stoneWorld.xz * stoneScale;
        vec2 stoneUvZ = stoneWorld.xy * stoneScale;
        vec3 stoneAlbedo =
          texture2D(stoneAlbedoMap, stoneUvX).rgb * stoneWeight.x +
          texture2D(stoneAlbedoMap, stoneUvY).rgb * stoneWeight.y +
          texture2D(stoneAlbedoMap, stoneUvZ).rgb * stoneWeight.z;
        float stoneRough =
          texture2D(stoneRoughMap, stoneUvX).r * stoneWeight.x +
          texture2D(stoneRoughMap, stoneUvY).r * stoneWeight.y +
          texture2D(stoneRoughMap, stoneUvZ).r * stoneWeight.z;
        diffuseColor.rgb *= stoneAlbedo * 1.35;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 0.55 + stoneRough * 0.7;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 stoneN =
          texture2D(stoneNormalMap, stoneUvX).xyz * stoneWeight.x +
          texture2D(stoneNormalMap, stoneUvY).xyz * stoneWeight.y +
          texture2D(stoneNormalMap, stoneUvZ).xyz * stoneWeight.z;
        vec2 stoneSlope = (stoneN.xy * 2.0 - 1.0) * 0.6;
        normal = normalize(normal + mat3(viewMatrix) * vec3(stoneSlope, 0.0));
      `);
  // oxlint-disable-next-line typescript/unbound-method
  })(material.onBeforeCompile as ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | undefined);
  // Captured before it is overwritten below, or a lazy read through the closure would call the *new*
  // function and recurse forever. `customProgramCacheKey` is never called as a method with a
  // meaningful `this` (three.js invokes it as `material.customProgramCacheKey()`, and the version
  // this captures already closes over `material` itself where it needs to), so oxlint's
  // unbound-method warning here is the false positive its own message allows for.
  // oxlint-disable-next-line typescript/unbound-method
  const previousKey = material.customProgramCacheKey;
  // Never the texture's uuid: the maps are uniforms, bound per material (three.js runs `onBeforeCompile`
  // for every material, cached program or not), so they do not change the shader. A uuid did, because
  // every floor build makes new textures - a fresh key, and a full recompile of this, the heaviest
  // program in the keep, on every rebuild: seconds of first frame under software GL.
  // oxlint-disable-next-line typescript/unbound-method
  material.customProgramCacheKey = () => `stone-textures-v2-${previousKey ? previousKey() : ''}`;
  material.needsUpdate = true;
}

// Generating a 1024px triplanar set is not free, and every floor in the run wants the same two
// kinds - flagstone underfoot, coursed masonry in the walls - so each is built once, on first use,
// and handed back by reference from then on rather than once per floor build.
let sharedFlagstone: StoneSet | null = null;
let sharedMasonry: StoneSet | null = null;
export const getFlagstoneTextures = () => (sharedFlagstone ??= flagstoneTextures());
export const getMasonryTextures = () => (sharedMasonry ??= masonryTextures());
/**
 * Plan 015 Stage C.2: the sliceable pair `dungeon-game.tsx`'s boot/restart path drives incrementally
 * instead of calling the getters above. A no-op once each set is cached - which is every floor after
 * the first, since both are shared for the run - so a rebuild's "cut the stone" stage costs nothing
 * whether it goes through this path or the synchronous getters.
 */
export function* getFlagstoneTexturesSteps(): Generator<void> {
  if (sharedFlagstone) return;
  sharedFlagstone = yield* flagstoneTexturesSteps();
}
export function* getMasonryTexturesSteps(): Generator<void> {
  if (sharedMasonry) return;
  sharedMasonry = yield* masonryTexturesSteps();
}

/**
 * Plan 014 round B: what makes a floor read as a lived-in wet dungeon rather than clean repeated slabs.
 * Layered on top of `weatherStone` + `applyStoneTextures` on the paving material, and needs the floor's
 * own footprint (world-space tile centres, `size` wide) so it knows where the walls are:
 *
 * - grime: a blurred footprint of the walkable cells, so the stone darkens and stays damp in a band
 *   along every wall base and around every prop, the way dirt and water collect there;
 * - puddles: a low-frequency world-space noise mask of near-mirror patches (roughness ~.06, slightly
 *   darker albedo) - big enough to pick up a torch's specular highlight as a streak;
 * - per-tile variation: each slab gets its own roughness and a slight warm/cool shift, hashed off its
 *   grid cell, so no two neighbouring slabs catch the light identically.
 */
export function applyFloorDetail(material: THREE.MeshStandardMaterial, cells: readonly { x: number; z: number }[], size: number) {
  if (typeof document === 'undefined' || !cells.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of cells) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z); }
  const margin = 3, ox = minX - margin, oz = minZ - margin, w = maxX - minX + margin * 2, h = maxZ - minZ + margin * 2;
  const cw = Math.min(2048, Math.ceil(w * 8)), ch = Math.min(2048, Math.ceil(h * 8)), px = cw / w;
  const sharp = document.createElement('canvas'); sharp.width = cw; sharp.height = ch;
  const sctx = sharp.getContext('2d')!;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, cw, ch); sctx.fillStyle = '#fff';
  for (const c of cells) sctx.fillRect((c.x - size / 2 - ox) * px, (c.z - size / 2 - oz) * px, size * px + 1, size * px + 1);
  const soft = document.createElement('canvas'); soft.width = cw; soft.height = ch;
  const ctx = soft.getContext('2d')!;
  ctx.filter = `blur(${Math.max(1, Math.round(px * .55))}px)`; ctx.drawImage(sharp, 0, 0);
  const mask = new THREE.CanvasTexture(soft);
  mask.colorSpace = THREE.NoColorSpace; mask.generateMipmaps = false; mask.minFilter = mask.magFilter = THREE.LinearFilter;
  const rect = new THREE.Vector4(ox, oz, w, h);
  material.onBeforeCompile = ((previous) => (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    previous?.(shader, renderer);
    shader.uniforms.floorMask = { value: mask };
    shader.uniforms.floorRect = { value: rect };
    shader.uniforms.floorTile = { value: size };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 floorWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 floorAt = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          floorAt = instanceMatrix * floorAt;
        #endif
        floorWorld = (modelMatrix * floorAt).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 floorWorld;
        uniform sampler2D floorMask; uniform vec4 floorRect; uniform float floorTile;
        float floorHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float floorNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(floorHash(i), floorHash(i + vec2(1.0, 0.0)), f.x), mix(floorHash(i + vec2(0.0, 1.0)), floorHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float floorGrime = 0.0, floorPuddle = 0.0, floorTileRough = 1.0, floorJoint = 0.0;
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float inside = texture2D(floorMask, (floorWorld.xz - floorRect.xy) / floorRect.zw).r;
          // Only the top of the paving: the slab's skirt and the joint are already shaded.
          float up = step(0.03, floorWorld.y);
          floorGrime = (1.0 - smoothstep(.55, .97, inside)) * up;
          vec2 cell = floor(floorWorld.xz / floorTile + .5);
          float h1 = floorHash(cell), h2 = floorHash(cell + 17.3);
          floorTileRough = .78 + .44 * h1;
          float n = floorNoise(floorWorld.xz * .32 + 3.7) * .65 + floorNoise(floorWorld.xz * .9 - 1.3) * .35;
          floorPuddle = smoothstep(.6, .67, n) * up * (1.0 - floorGrime * .5);
          diffuseColor.rgb *= vec3(1.0 + (h2 - .5) * .09, 1.0, 1.0 - (h2 - .5) * .09) * (.93 + .14 * h1);
          diffuseColor.rgb *= (1.0 - floorGrime * .7) * (1.0 - floorPuddle * .22);
          // The slab's chamfered rim and skirt (any facet not facing straight up) are the joint: dark,
          // matte grout. Glossy, they mirrored the bright environment cards and read as white strips.
          floorJoint = 1.0 - smoothstep(.86, .97, abs(stoneNormalWorld.y));
          diffuseColor.rgb *= 1.0 - floorJoint * .35;
        }
      `)
      // After metalness, not after roughness: weatherStone's own wet-roughness dip and the stone
      // map's multiplier both hook the roughness chunk, and this has to have the last word.
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor * floorTileRough * (1.0 - floorGrime * .35), .06, floorPuddle), 1.0, floorJoint);
      `);
  // oxlint-disable-next-line typescript/unbound-method
  })(material.onBeforeCompile as ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | undefined);
  // oxlint-disable-next-line typescript/unbound-method
  const previousKey = material.customProgramCacheKey;
  // oxlint-disable-next-line typescript/unbound-method
  material.customProgramCacheKey = () => `floor-detail-v2-${previousKey ? previousKey() : ''}`;
  material.needsUpdate = true;
  return mask;
}
