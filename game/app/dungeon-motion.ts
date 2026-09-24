import * as THREE from 'three';

// World-space currents stay the same size across differently sized generated floors. `shoal` carries the
// keep's footprint — centre in xy, half-extent in zw — so depth can be read off the distance outside it.
// That buys an open-water gradient without a second texture or a subdivided plane.
/**
 * How much of its own colour the water is allowed in the chamber the knight is standing in. The tide
 * runs under the whole keep, so a single luminous green plane was a second hue family arriving in
 * every frame regardless of the room's own. Full strength where the flood is the theme; pulled down
 * and toward slate everywhere else, where its job is to be the dark the rest of the frame reads
 * against. Shared with `stoneMood` in being one object every water material holds by reference.
 */
export const tideMood = { value: new THREE.Vector3(1, 1, 1) };

/**
 * Plan 014 round A: a blurred footprint of the keep's standing stone, laid over the water in world
 * space, so the shader knows how close any patch of water is to a wall foot - the reference's water is
 * bright turquoise shallows hugging every stone edge, falling off into dark open water, and a single
 * bounding box (`shoal`) cannot say that. `cells` are world-space tile centres, `size` their width.
 * Returns the texture plus the world rectangle it covers (xy origin, zw size).
 */
function shoreMask(cells: readonly { x: number; z: number }[], size: number, shallows: THREE.Vector4) {
  const margin = 7, ppu = 6;
  const ox = shallows.x - shallows.z - margin, oz = shallows.y - shallows.w - margin;
  const w = (shallows.z + margin) * 2, h = (shallows.w + margin) * 2;
  const cw = Math.min(1024, Math.ceil(w * ppu)), ch = Math.min(1024, Math.ceil(h * ppu));
  const rect = new THREE.Vector4(ox, oz, w, h);
  if (typeof document === 'undefined' || !cells.length) return { texture: null, rect };
  const sharp = document.createElement('canvas'); sharp.width = cw; sharp.height = ch;
  const sctx = sharp.getContext('2d')!;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, cw, ch); sctx.fillStyle = '#fff';
  for (const c of cells) sctx.fillRect((c.x - size / 2 - ox) / w * cw, (c.z - size / 2 - oz) / h * ch, size / w * cw + 1, size / h * ch + 1);
  const soft = document.createElement('canvas'); soft.width = cw; soft.height = ch;
  const ctx = soft.getContext('2d')!;
  // Two blurs summed: a tight one for the bright lip right at the stone, a wide one for the shelf of
  // lit shallows that fades out a few metres into the channel.
  const px = cw / w;
  ctx.filter = `blur(${Math.round(px * .9)}px)`; ctx.drawImage(sharp, 0, 0);
  ctx.globalAlpha = .6; ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${Math.round(px * 3.2)}px)`; ctx.drawImage(sharp, 0, 0);
  const texture = new THREE.CanvasTexture(soft);
  texture.colorSpace = THREE.NoColorSpace; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  return { texture, rect };
}

export function tidalMaterial(shallows = new THREE.Vector4(0, 0, 12, 12), cells: readonly { x: number; z: number }[] = [], cellSize = 1) {
  const time = { value: 0 };
  const shoal = { value: shallows };
  const mask = shoreMask(cells, cellSize, shallows);
  const shoreMap = { value: mask.texture }, shoreRect = { value: mask.rect };
  // Plan 014 round 9 (lever 6): a fixed small array of torch world-positions (padded with a point far
  // below the floor, whose streak contribution is then ~0 through the same falloff every real entry
  // uses - no separate count uniform or dynamic loop bound needed). Set once from outside after the
  // floor's own atmosphere pass has actually placed its torches (see dungeon-game.tsx) - it does not
  // change per frame, only `tideTime` does.
  const TORCH_SLOTS = 6;
  const torches = { value: Array.from({ length: TORCH_SLOTS }, () => new THREE.Vector3(0, -50, 0)) };
  // Plan 014 round 7 (lever 1c): roughness down from .3 and metalness up from .28 - real torchlight
  // is already in the scene as four physical point lights, so a tighter, hotter specular lobe is
  // "reflections of nearby torches" the honest way, through the standard PBR term this material
  // already has, rather than a second hand-rolled light-position hack layered on top of it.
  // Plan 014 round B: roughness .16 -> .3. The tight lobe on a rippled normal broke every torch into a
  // field of hard coloured specks (the purple noise in corridor); a slightly broader lobe keeps the
  // sheen without the speckle.
  const material = new THREE.MeshStandardMaterial({ color: 0x17454d, roughness: 0.42, metalness: 0.12 });
  material.onBeforeCompile = shader => {
    shader.uniforms.tideTime = time;
    shader.uniforms.tideShoal = shoal;
    shader.uniforms.tideMood = tideMood;
    shader.uniforms.tideTorches = torches;
    shader.uniforms.tideShore = shoreMap;
    shader.uniforms.tideShoreRect = shoreRect;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tideWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntideWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float tideTime;\nuniform vec4 tideShoal;\nuniform vec3 tideMood;\nuniform vec3 tideTorches[${TORCH_SLOTS}];\nuniform sampler2D tideShore;\nuniform vec4 tideShoreRect;\nvarying vec3 tideWorld;\nvec3 tideGlow = vec3(0.0);\nfloat tideReflect = 0.0;
      float tideHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float tideNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(tideHash(i), tideHash(i + vec2(1.0, 0.0)), f.x), mix(tideHash(i + vec2(0.0, 1.0)), tideHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float patchMaskEarly(vec2 p, float t) { return tideNoise(p * .6 + vec2(t * .09, t * .05)); }
      vec2 tideSite(vec2 cell, float t) {
        vec2 h = fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
        return .5 + .38 * sin(t + 6.2831 * h);
      }
      // Round A: the border width is a parameter now - a wide one is the soft, blurred light pooling
      // on the bed, a narrow one the sharp bright filaments riding over it.
      float tideCells(vec2 q, float t, float width) {
        vec2 i = floor(q), f = fract(q);
        float f1 = 8.0, f2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 o = vec2(float(x), float(y));
          float d = length(o + tideSite(i + o, t) - f);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
        return 1.0 - smoothstep(0.0, width, f2 - f1);
      }
    `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = tideWorld.xz;
        float swell = sin(p.x * 1.7 + p.y * 1.1 + tideTime * 0.85);
        float crosswave = sin(p.y * 3.7 - p.x * 0.6 - tideTime * 1.2 + swell);
        // Caustic net: rounded cells bounded by soft bright borders. The round-7 version took the
        // near-zero contour of summed sines raised to a high power, which traced sharp zig-zag
        // "lightning" rather than cells. This is an animated Voronoi edge field instead - distance to
        // the second-nearest wandering point minus the nearest (F2 - F1) is zero exactly on a cell
        // border and grows smoothly inside, so a smoothstep over it gives a rounded, soft-edged net.
        // Two layers at different scales and speeds so neither period lines up with the other.
        // Plan 014 round A: the old net was two equally sharp Voronoi layers at near-equal weight, which
        // read as a decal of lines drawn on a plane. Light through water is a soft, blurry,
        // low-frequency pooling on the bed with a finer, brighter filament net over it - and neither is
        // uniform: patches of the surface focus light and patches do not. Three layers: soft (wide
        // border, big cells), fine (narrow border, smaller cells, domain-warped so cells vary in size),
        // and a patch mask from value noise that switches the fine net on and off across the water.
        vec2 warp = vec2(tideNoise(p * .35 + tideTime * .07), tideNoise(p * .35 - 4.1 - tideTime * .05)) - .5;
        float soft = tideCells(p * .42 + warp * .6, tideTime * .35, .5) * (.6 + .4 * tideNoise(p * .5 - tideTime * .1));
        float fine = tideCells(p * (1.05 + .35 * warp.x) + 7.3 + warp * 1.3, tideTime * .75, .07 + .06 * patchMaskEarly(p, tideTime));
        float patchMask = smoothstep(.28, .78, tideNoise(p * .23 + vec2(tideTime * .04, -tideTime * .03)));
        // Filaments break up along their own length too, into bright dashes rather than unbroken wire.
        fine *= .25 + .75 * smoothstep(.3, .72, tideNoise(p * 2.6 + vec2(tideTime * .6, -tideTime * .4)));
        float causticBreak = .05 + .95 * patchMask;
        vec2 shoreUv = (p - tideShoreRect.xy) / tideShoreRect.zw;
        float shore = clamp(texture2D(tideShore, shoreUv).r, 0.0, 1.0);
        // How far outside the keep's footprint this fragment lies, softened by the swell so the
        // gradient never traces a rectangle.
        vec2 outside = max(abs(p - tideShoal.xy) - tideShoal.zw, vec2(0.0));
        float deep = smoothstep(0.5, 15.0, length(outside) + swell * .6);
        // Round A: open channel water well clear of any stone reads deeper than water hugging a wall
        // foot, even inside the keep's own footprint.
        deep = max(deep, smoothstep(.62, .04, shore));
        // Plan 014 round 2: dim sunken masonry under the open water - a coarse cell hash marks roughly
        // a third of the grid as a fallen block, and each one gets its own dark plinth-and-gap
        // silhouette rather than a flat tint, so the floor of the flood reads as broken structure
        // rather than a colour change. Plan 014 round 7 (lever 1c): used to be gated fully behind
        // \`deep\`, so the shallows - the one place the plan asked for dim sunken shapes to actually be
        // visible - never showed any. It shows everywhere now, at a third its former strength in the
        // shallows and full strength once the water is genuinely deep.
        vec2 blockCell = floor(p * .62);
        float blockPick = fract(sin(dot(blockCell, vec2(41.3, 187.7))) * 43758.5453);
        vec2 blockUv = fract(p * .62);
        float blockShape = step(.08, blockUv.x) * step(blockUv.x, .92) * step(.08, blockUv.y) * step(blockUv.y, .92);
        float sunken = blockShape * step(.62, blockPick);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .35, sunken * mix(.42, .7, deep));
        // A few fish, each a dark elongated silhouette drifting a slow, looping path. Cheap and
        // deliberately schematic - four sine terms per fish, no geometry, no draw call.
        float fishShadow = 0.0;
        for (int fi = 0; fi < 3; fi++) {
          float fseed = float(fi) * 17.0 + 3.0;
          float fa = tideTime * (.12 + float(fi) * .045) + fseed;
          vec2 fishPos = tideShoal.xy + vec2(sin(fa) * tideShoal.z * .55, cos(fa * 1.3) * tideShoal.w * .5);
          vec2 fishDir = normalize(vec2(cos(fa) * tideShoal.z * .55 * -.13, -sin(fa * 1.3) * 1.3 * tideShoal.w * .5) + 1e-4);
          vec2 rel = p - fishPos;
          vec2 along = vec2(dot(rel, fishDir), dot(rel, vec2(-fishDir.y, fishDir.x)));
          fishShadow = max(fishShadow, (1.0 - smoothstep(0.0, 1.0, abs(along.x) * 1.6)) * (1.0 - smoothstep(0.0, .16, abs(along.y))) * deep);
        }
        diffuseColor.rgb *= 1.0 - fishShadow * .55;
        diffuseColor.rgb *= 0.8 + swell * 0.13 + crosswave * 0.09;
        // Plan 014 round 7 (lever 1b): depth colour, the reference's actual read - bright turquoise
        // where the water is shallow enough to still be over lit stone, falling through the tide's own
        // mid teal, and only truly open water in the middle distance goes to a near-black teal. Three
        // stops instead of the old two-colour lerp, so the shallow-to-deep transition has a middle value
        // to pass through rather than jumping straight from pale to black.
        // Plan 014 round B: depth absorption. Bright turquoise only right over the stone shelf, falling
        // through a dark teal to near-black open water a few metres off any wall.
        vec3 shallowColour = vec3(.22, .92, .86);
        vec3 midColour = vec3(.09, .4, .42);
        vec3 deepColour = vec3(.012, .05, .06);
        float shallowMix = smoothstep(0.0, .55, deep), deepMix = smoothstep(.55, 1.0, deep);
        diffuseColor.rgb *= mix(mix(shallowColour, midColour, shallowMix), deepColour, deepMix);
        diffuseColor.rgb *= tideMood;
        // What makes the water itself a light source rather than a lit surface: the caustic network,
        // added after the lighting model runs (see the output_fragment hook below) rather than folded
        // into diffuseColor, so open water still glows under no key light at all - a moonlit corridor's
        // water is exactly where the reference leans on this hardest.
        // Round A: brightest right against the stone (bright shallows along every wall foot), soft
        // pooled light everywhere, the fine filaments dimming with depth, and a few sparkling glints
        // where the filament net and a fast twinkle coincide.
        float lip = smoothstep(.12, .6, shore);
        float glint = step(.955, tideHash(floor(p * 4.0) + floor(tideTime * 3.0))) * smoothstep(.32, .0, length(fract(p * 4.0) - .5)) * smoothstep(.3, .8, fine);
        // Plan 014 round B: caustics fade with depth - strong only on the shallow shelf along the stone,
        // almost gone over open water, so there is no web of cell outlines at a distance. The two layers
        // are blended (soft pooling dominant, filaments wide and low-contrast) rather than stacked.
        float shelf = smoothstep(.06, .7, shore);
        float caustic = soft * .6 + fine * causticBreak * .4;
        tideGlow = vec3(.24, .86, .8) * (caustic * (.05 + shelf * .6) + lip * .22 + .03)
          + vec3(1.1, 1.35, 1.3) * glint * shelf;
        // Plan 014 round 9 (lever 6): "a fake vertical reflection" for each nearby torch - an
        // elongated soft highlight offset toward the camera along the same fixed ground-plane
        // direction the camera itself sits along (SCREEN_DOWN in dungeon-aim.ts, hardcoded here since
        // this shader has no access to that module and the camera never rotates), narrow across its
        // own long axis and soft along it, exactly what a torch's own light would smear into on a
        // gently moving surface without a real reflective ray anywhere in this pipeline.
        vec2 towardCamera = vec2(0.6247, 0.7809);
        vec2 acrossCamera = vec2(-towardCamera.y, towardCamera.x);
        float reflectGlow = 0.0;
        for (int ti = 0; ti < ${TORCH_SLOTS}; ti++) {
          vec2 torchXZ = tideTorches[ti].xz;
          vec2 rel = p - (torchXZ + towardCamera * 2.4);
          float along = dot(rel, towardCamera), across = dot(rel, acrossCamera);
          // Round B: broken into ripple bands along its length, a streak rather than a soft blob.
          reflectGlow += exp(-across * across * 7.0) * exp(-along * along * 0.3) * (0.5 + 0.5 * sin(along * 9.0 - tideTime * 2.2 + swell)) * (0.6 + swell * .2);
        }
        tideReflect = min(reflectGlow, 1.4);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 waveSlope = vec2(
          cos(tideWorld.x * 1.7 + tideWorld.z * 1.1 + tideTime * .85) * .075,
          cos(tideWorld.z * 3.7 - tideWorld.x * .6 - tideTime * 1.2) * .055);
        normal = normalize(normal + mat3(viewMatrix) * vec3(waveSlope.x, 0.0, waveSlope.y));
        // A second, faster ripple layer folded into the same normal, purely for the fresnel rim below -
        // scrolling glints along the wave crests rather than one slow swell.
        vec2 rippleSlope = vec2(
          cos(tideWorld.x * 9.0 + tideTime * 2.3) * .018,
          cos(tideWorld.z * 8.2 - tideTime * 2.0) * .018);
        normal = normalize(normal + mat3(viewMatrix) * vec3(rippleSlope.x, 0.0, rippleSlope.y));
      `)
      .replace('#include <dithering_fragment>', `
        gl_FragColor.rgb += tideMood * tideGlow;
        // Fresnel: a grazing-angle rim that brightens the far edge of every ripple, which is what a
        // reflective water surface actually does and what turned this into "a dark flat blob" without
        // it - the water was reading only its own tinted diffuse colour, never the light bouncing off
        // its own surface at an angle.
        float tideFresnel = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
        // Round B: a fake sky/ambient reflection - a cool teal-grey sheen that grows toward grazing angles,
        // the one thing that makes open black water still read as a reflective surface.
        gl_FragColor.rgb += mix(vec3(.16, .3, .34), tideMood * vec3(.3, .6, .64), .5) * tideFresnel * .55;
        // Deliberately not scaled by \`tideMood\` (the room's own cool accent) - a torch's own
        // reflection stays warm regardless of which theme's water it is falling on, the same way the
        // wall sconces themselves never take the room's mood colour.
        gl_FragColor.rgb += vec3(1.5, .92, .5) * tideReflect * .8;
        #include <dithering_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'tidal-currents-v12';
  // The shore mask is sized to this floor and lives only in a shader uniform, which `material.dispose()`
  // does not reach - so every floor used to leave its mask behind on the GPU. It goes with the material.
  material.addEventListener('dispose', () => mask.texture?.dispose());
  return { material, time, shoal, torches };
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

/**
 * The keep's stone weathers the same way everywhere, but it does not have to weather the same *colour*
 * everywhere, and it was the moss tint below — one fixed green, multiplied into every slab, block,
 * kerb and column on the floor — that pulled three themes back into one. These are the four tints the
 * shader used to hold as constants, hoisted into uniforms shared by every weathered material in the
 * keep, so the lighting can hand the whole floor the mood of the chamber the knight is standing in and
 * slide it to the next one as he crosses. Shared objects, not copies: one write moves every surface.
 */
export const stoneMood = {
  moss: { value: new THREE.Vector3(.58, .82, .62) },
  mossAmount: { value: .4 },
  warm: { value: new THREE.Vector3(1.13, 1.04, .88) },
  cool: { value: new THREE.Vector3(.82, .92, .99) },
  // What the light leaves on the top of a tall thing; see the crown term in the shader below.
  crown: { value: new THREE.Vector3(1.04, 1.12, 1.06) },
};

export function weatherStone(material: THREE.MeshStandardMaterial, firelit = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.stoneMoss = stoneMood.moss;
    shader.uniforms.stoneMossAmount = stoneMood.mossAmount;
    shader.uniforms.stoneWarm = stoneMood.warm;
    shader.uniforms.stoneCool = stoneMood.cool;
    shader.uniforms.stoneCrown = stoneMood.crown;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 stonePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          stonePosition = instanceMatrix * stonePosition;
        #endif
        stoneWorld = (modelMatrix * stonePosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 stoneWorld;\nuniform vec3 stoneMoss;\nuniform float stoneMossAmount;\nuniform vec3 stoneWarm;\nuniform vec3 stoneCool;\nuniform vec3 stoneCrown;\n' + STONE_NOISE)
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
        // Plan 014 round 4 (lever C7): a real keep's moss finds the waterline before it finds
        // anything else - a block top a few units above the flood gets a patch of it whether or not
        // the general damp/weave criteria above would have granted one, fading out with height so it
        // never climbs the whole wall.
        moss = max(moss, smoothstep(.55, .2, damp) * (1.0 - smoothstep(-.5, 2.6, stoneWorld.y)) * .8);
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
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stoneWarm, max(0.0, mottle) * .42);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stoneCool, max(0.0, -mottle) * .42);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stoneMoss, moss * stoneMossAmount);
        diffuseColor.rgb *= 1.0 - tideMark * .26;
        // Everything falls off toward the waterline, where no light reaches.
        diffuseColor.rgb *= .86 + .14 * smoothstep(-2.8, .5, stoneWorld.y);
        // And keeps climbing above it. The verticality pass stood piers, buttresses and near-side
        // masonry four to six metres tall and every one came out as a single dark slab, because the
        // old gradient had already saturated by half a metre: the top of a six-metre pier was lit
        // exactly like its footing. Stone that tall does not read that way — the higher it stands the
        // less of the room is between it and the sky, and its top course is where the key breaks
        // first. So the climb continues to roof height, gaining value and taking the chamber's own
        // crown tint with it, which is what turns a slab into a lit face with a shadowed one beside
        // it without costing a triangle or a second light.
        float crown = smoothstep(.45, 5.4, stoneWorld.y);
        diffuseColor.rgb *= 1.0 + crown * .2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stoneCrown, crown);
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
        // Plan 014 round 2: was mix(..., .28, wetStone * .88), which lands a puddle around .35-.4 -
        // too soft for the reference's mirror-bright wet flagstones. .1-.2 against the dry .7-.83 the
        // rest of the floor sits at is the contrast a real puddle actually reads at.
        roughnessFactor = mix(roughnessFactor, .12, wetStone * .92);
      `)
      // Plan 014 round 3: a metalness bump used to sit here (`metalnessFactor = mix(..., .4,
      // wetStone*.7)`). Under a dim environment map that is exactly backwards - metalness replaces a
      // surface's diffuse response with a tint of the environment alone, and a dark environment tints
      // it dark, so the "reflective" puddle rendered *blacker* than the dry stone beside it. A wet
      // dielectric does not turn into metal; it stays a normal surface whose specular lobe has gone
      // narrow and bright, which the roughness dip above already delivers on its own - a real puddle's
      // sheen is a roughness story, not a metalness one. `vaultEnvironment` below now carries actual
      // bright warm and teal cards so that narrow specular lobe has something worth catching.
      // World-space relief: chips and crack edges as an actual perturbed normal rather than only a
      // colour change, so the key light throws a real (if tiny) highlight and shadow across them. Four
      // extra noise samples, not a texture - continuous across every joint, and never twice the same
      // between two tiles the way a tiling normal map would be.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float relief = .12;
          float hL = stoneFbm((p - vec2(relief, 0.0)) * .17) - stoneNoise((p - vec2(relief, 0.0)) * 1.35 + 43.0) * .05;
          float hR = stoneFbm((p + vec2(relief, 0.0)) * .17) - stoneNoise((p + vec2(relief, 0.0)) * 1.35 + 43.0) * .05;
          float hD = stoneFbm((p - vec2(0.0, relief)) * .17) - stoneNoise((p - vec2(0.0, relief)) * 1.35 + 43.0) * .05;
          float hU = stoneFbm((p + vec2(0.0, relief)) * .17) - stoneNoise((p + vec2(0.0, relief)) * 1.35 + 43.0) * .05;
          vec2 stoneSlope = vec2(hR - hL, hU - hD) / (2.0 * relief);
          normal = normalize(normal + mat3(viewMatrix) * vec3(stoneSlope.x, 0.0, stoneSlope.y) * .55);
        }
      `);
  };
  // The two variants compile to different fragment shaders, so they must not share a cache entry.
  material.customProgramCacheKey = () => (firelit ? 'weathered-stone-v6-firelit' : 'weathered-stone-v6');
}

/**
 * Plan 014 round 4 (lever C8): a skeleton's bone was one flat value and one flat roughness - cheap
 * next to a whole floor's worth of stone, since it is one small noise sample per fragment and no
 * normal perturbation at all. World-space so it holds still on a moving body instead of swimming
 * across it, and reused straight off `weatherStone`'s own noise functions rather than a second copy.
 */
export function weatherBone(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 boneWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nboneWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 boneWorld;\n' + STONE_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float boneGrit = stoneNoise(boneWorld.xz * 6.0 + boneWorld.y * 4.0);
        float boneCavity = smoothstep(.65, .15, stoneFbm(boneWorld.xz * 3.5 + boneWorld.y * 2.0 + 11.0));
        diffuseColor.rgb *= (.86 + boneGrit * .22) * (1.0 - boneCavity * .38);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (boneGrit - .5) * .3, .2, 1.0);
      `);
  };
  material.customProgramCacheKey = () => 'weathered-bone-v1';
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
  // Plan 014 round 7: a fold is a place cloth turns away from the light, not merely a place it moved -
  // real-time normals from the displacement below already give the sway *some* of that, but only where
  // the one key light happens to catch the new angle. `restColor`, cached the same way `rest` is, is
  // the baked pattern (the cape's gold border) a plain colour multiply can darken without touching its
  // hue - so a fold reads as a fold under any light, not only the lucky one.
  let restColor = mesh.geometry.userData.restColor as Float32Array | undefined;
  const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (colorAttr && !restColor) { restColor = new Float32Array(colorAttr.array); mesh.geometry.userData.restColor = restColor; }
  for (let i = 0; i < positions.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1];
    const free = THREE.MathUtils.clamp((top - y) / length, 0, 1);
    const fold = Math.sin(time * 5 - free * 3 + x * 4) + 0.35 * Math.sin(time * 8 + x * 8);
    positions.setZ(i, rest[i * 3 + 2] + free * free * strength * fold);
    if (colorAttr && restColor) {
      // Only the receding half of the wave (cloth curling back on itself) darkens - the advancing
      // half stays at its baked value, so the gradient reads as a fold's own far side rather than a
      // flat pulse breathing in and out with the sway.
      const shade = 1 - Math.max(0, -fold) * 0.22 * free;
      colorAttr.setX(i, restColor[i * 3] * shade); colorAttr.setY(i, restColor[i * 3 + 1] * shade); colorAttr.setZ(i, restColor[i * 3 + 2] * shade);
    }
  }
  positions.needsUpdate = true;
  if (colorAttr) colorAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/**
 * Plan 014 round 7 (lever 6): four gradient stops, the last of them landing exactly on the canvas
 * edge, was what read as "a hard-edged flat disc" - between .4 and 1.0 the alpha did fall smoothly,
 * but a sprite's own quad has no margin outside its texture, so that last stop's alpha (already
 * non-zero right up to `1`) *was* the sprite's boundary. A true Gaussian-shaped falloff instead,
 * sampled at enough stops that the eye reads a curve rather than bands, reaching fully transparent
 * at 70% of the radius rather than at 100% of it - the remaining 30% is real margin, so nothing the
 * sprite draws can end at a visible edge.
 */
export function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, alpha = Math.exp(-t * t * 7.2) * (1 - Math.max(0, t - 0.7) / 0.3);
    const r = Math.round(255), g = Math.round(246 - t * 90), b = Math.round(220 - t * 190);
    const a = Math.max(0, Math.min(1, alpha));
    glow.addColorStop(t, `rgba(${r},${g},${b},${a.toFixed(3)})`);
  }
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
