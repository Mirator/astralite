// Plan 014, lever 3: the post-processing chain that turns the straight render into something closer
// to the reference's painted look - bloom on whatever already burns brightest (flames, eyes, the
// THREAT/COMMIT marks, the water's own glow), a teal-shadow/orange-highlight grade,
// a vignette and a hair of grain (the tilt-shift blur was removed in round B).
//
// Plan 014 round 3: the two earlier headers here both had the tone-mapping story backwards, and the
// bug that came of it was the round's worst - a black-crushed floor everywhere the grade pass's
// contrast pivot touched. The fact, checked directly against `WebGLPrograms.js`: a material's
// `TONE_MAPPING` shader define is only ever set when `currentRenderTarget === null` - that is, when
// drawing straight to the canvas. `RenderPass` draws into `EffectComposer`'s own offscreen target, so
// every lit material in the chain skips tone mapping entirely and writes raw linear HDR radiance -
// near a torch, comfortably above 1; in shadow, 0.01-0.05. The grade `ShaderPass` used to run before
// `OutputPass`, so its contrast step, `(color - 0.5) * 1.1 + 0.5`, was operating on those linear
// values: a shadowed stone at 0.05 became (0.05-0.5)*1.1+0.5 = -0.045, and the final `clamp(0,1)`
// took it to a flat black - which is the crush, on every surface not standing in direct light. The
// order below is what fixes it: bloom stays on the linear HDR data it is meant to read (that is the
// physically correct place for it - extracting genuinely radiant pixels before anything compresses
// them), `OutputPass` then tone-maps and converts to the renderer's output colour space exactly once,
// and only after that - on ordinary 0-1 display-referred colour - does the grade pass touch contrast,
// the vignette and grain. Nothing after `OutputPass` may assume linear data again.
//
// three, not React or the DOM otherwise - this module owns GPU objects (an `EffectComposer` and its
// passes) exactly like the rest of the renderer half of the game, so it is a sibling of
// `dungeon-atmosphere.ts`, not a rule module like `dungeon-floor.ts`.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const HDR_CEILING_SHADER = {
  uniforms: { tDiffuse: { value: null }, uCeiling: { value: 3.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uCeiling; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float peak = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(c.rgb * min(1.0, uCeiling / max(peak, 1e-4)), c.a);
    }
  `,
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    // Shadow lift (teal) and highlight gain (orange) - the reference's one loud colour move.
    // setRGB, not a hex: a hex goes through sRGB->linear conversion, and this pass works on display colour.
    uLift: { value: new THREE.Color().setRGB(0.035, 0.1, 0.115) },
    uGain: { value: new THREE.Color().setRGB(1.16, 0.98, 0.78) },
    uContrast: { value: 1.12 },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.46 },
    uGrain: { value: 0.028 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

    void main() {
      // Plan 014 round B: the tilt-shift blur is gone. It was a vertical-only screen-space blur, so it
      // smeared pillar tops and anything tall near the top/right edges into streaks rather than
      // defocusing distance; the vignette carries the framing on its own.
      vec3 color = texture2D(tDiffuse, vUv).rgb;

      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      float shadowMix = 1.0 - smoothstep(0.0, 0.55, luma);
      float highMix = smoothstep(0.45, 1.0, luma);
      // Plan 014 round 4 (lever A2): stronger now that this runs on display-referred colour after
      // OutputPass (round 3's fix) rather than on raw linear HDR - the round 2 values were tuned
      // against the old, buggy order and had to stay timid or they crushed the same shadows they were
      // supposed to tint. Safe to push harder now: only display-range 0-1 colour reaches this point.
      // Plan 014 round 7 (lever 3): still not far enough - the critic read combat-bridge as "one muddy
      // warm-brown band", which is what a torch-lit scene's own midtones do when the split-tone only
      // ever reaches 30/34% of the way to either pole: nothing in the middle of the range is pulled
      // hard enough toward either teal or amber to separate from its neighbours. Both blends roughly
      // doubled.
      // Plan 014 round A: the old shadow "lift" multiplied the shadows by (lift * 1.3 + .32) - about
      // .45-.65 per channel - so it was not a lift at all but a 40% darkening of everything below
      // mid-grey, which is most of why every frame read too dark and uniformly cyan. It is a real lift
      // now: a small additive teal floor under the blacks plus a cool hue shift in the shadows, and a
      // warm, slightly brightening push in the highlights, so the split reads as warm-lit vs
      // teal-shadowed rather than as one cyan wash. Contrast pivots low (.32) so it deepens the
      // darks a little without dragging the midtones - the armour, the cape - down with them.
      color += uLift * shadowMix * 0.7;
      // Round B: a firmer teal cast in the shadows so a warm-lit room still holds cool darks.
      color = mix(color, color * vec3(0.78, 1.0, 1.12), shadowMix * 0.62);
      color = mix(color, color * uGain, highMix * 0.7);
      float midMix = smoothstep(0.12, 0.4, luma) * (1.0 - smoothstep(0.55, 0.9, luma));
      color = mix(color, color * vec3(1.06, 1.0, 0.92), midMix * 0.35);

      color = (color - 0.32) * uContrast + 0.32;
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, uSaturation);

      vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
      float vig = 1.0 - smoothstep(0.5, 1.15, length(centered)) * uVignette;
      color *= vig;

      float grain = (hash(vUv * uResolution.xy + uTime * 60.0) - 0.5) * uGrain;
      color += grain;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

/** Whether this context rasterises on the CPU - SwiftShader (CI, and Chrome when the GPU is blocklisted),
 * Mesa's llvmpipe, Windows' Basic Render Driver. */
export function softwareGL(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
}

export type PostQuality = 'full' | 'reduced';

/** `?quality=full` or `?quality=reduced` overrides the detection - reference frames are drawn at full
 * quality on SwiftShader, because the baseline in `output/shots/baseline/` was. */
export function postQuality(renderer: THREE.WebGLRenderer, search: string): PostQuality {
  const asked = new URLSearchParams(search).get('quality');
  if (asked === 'full' || asked === 'reduced') return asked;
  return softwareGL(renderer) ? 'reduced' : 'full';
}

export function createPostChain(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, quality: PostQuality = 'full') {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  const renderPass = new RenderPass(scene, camera);
  // `renderer.info.render` resets on every `renderer.render`, and the composer makes one per pass - so
  // after a frame it describes only the last full-screen quad (one triangle, one call), not the scene.
  // The frame budget, the footstep "one extra draw" check and the carved-chamber triangle count all
  // mean the scene's own cost, so it is captured right after the scene pass itself draws.
  const sceneCost = { calls: 0, triangles: 0 };
  const drawScene = renderPass.render.bind(renderPass);
  renderPass.render = (...args: Parameters<RenderPass['render']>) => {
    drawScene(...args);
    sceneCost.calls = renderer.info.render.calls; sceneCost.triangles = renderer.info.render.triangles;
  };
  composer.addPass(renderPass);
  // The moon's shadow map is drawn once a frame, by the scene pass. three.js redraws it inside every
  // `renderer.render` while `autoUpdate` is on, and GTAO's normal/depth pre-pass is a second full render
  // of the scene - so on the full chain every shadow caster in the keep went through the 1536² shadow
  // pass twice a frame, and the second copy was thrown away unread. Each frame asks for exactly one
  // (`needsUpdate`, below), and the first render of the frame - always the scene pass - spends it.
  renderer.shadowMap.autoUpdate = false;
  // How many times the last frame actually drew the shadow map, and the draw calls that cost; a driver
  // holds the first to one.
  let shadowDraws = 0, shadowCalls = 0, frameShadow = { draws: 0, calls: 0 };
  const drawShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (...args: Parameters<typeof drawShadows>) => {
    // Every `renderer.render` passes through here, the post chain's full-screen quads included; only a
    // render with a shadow-casting light in it, and permission to redraw, actually draws the map.
    const map = renderer.shadowMap, from = renderer.info.render.calls, [lights] = args;
    if (map.enabled && (map.autoUpdate || map.needsUpdate) && lights.length > 0) shadowDraws++;
    drawShadows(...args);
    shadowCalls += renderer.info.render.calls - from;
  };
  // Plan 014 round 6 (lever 2): grout lines, wall bases, pillar/floor contact and the paving under a
  // parapet were all reading one flat lit value - nothing in the render pipeline darkened a surface
  // for standing close to another one, only for standing in shadow of a light. GTAO is a genuine
  // ambient-occlusion term (screen-space, from the depth+normal buffer this pass renders for itself),
  // not a fake contact-shadow decal, so it darkens exactly the concave corners a painted scene's own
  // eye would - and nowhere else. It runs here, right after `RenderPass` and before bloom, because it is a multiplicative term on incoming radiance (occlusion attenuates light, it
  // does not tint or tone-map it) - correct on the linear HDR `RenderPass` just wrote, same reasoning
  // as bloom below.
  // Radius is in world units, not pixels: this game's orthographic camera holds roughly a 16x10 unit
  // frustum on screen (`new THREE.OrthographicCamera(-8,8,5,-5,...)`), and a tile is 1 unit - so 0.6
  // reaches a little under a tile's width, enough to shade a grout line or a wall base without the
  // whole floor going soft. `blendIntensity` below 1 keeps it a shading cue, not a grey wash.
  const gtaoPass = new GTAOPass(scene, camera, width, height);
  gtaoPass.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.2, scale: 1.6 });
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 0.9;
  // Plan 014 round A: GTAOPass's own normal/depth pre-pass hides points and lines but draws every
  // mesh, including the soft, transparent, depth-write-off ones - the crossed flame cards, the blade
  // ribbon, halos, decals, the telegraph marks. Each of those then occluded the floor behind it as if
  // it were a solid slab: a sharp dark rectangle behind every brazier flame, and a dark smear under
  // the slash arc that ate most of its brightness. Only surfaces that write depth take part now.
  const gtaoInternals = gtaoPass as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
  gtaoInternals._overrideVisibility = () => {
    scene.traverse((object) => {
      if (!object.visible) return;
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const soft = material !== undefined && !Array.isArray(material) && material.transparent && !material.depthWrite;
      const flagged = (object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite;
      if (soft || flagged) { object.visible = false; gtaoInternals._visibilityCache.push(object); }
    });
  };
  composer.addPass(gtaoPass);
  // No outline passes: the dark ink edge and the warm rim OutlinePass drew around the knight and every
  // living enemy read as a selection border, not as part of the painting, and they were removed.
  // Bloom runs here, on the raw linear HDR `RenderPass` wrote - see the header comment. The threshold
  // is a linear radiance value now, not a display-referred one: an ordinary lit stone face sits well
  // under 1 even close to a torch, and only an actual light source, an emissive (fire, eyes, the
  // THREAT/COMMIT marks, all `toneMapped:false` and already unclamped) or a true hot spot on a
  // physically-lit surface clears it.
  // Plan 014 round 9 (lever 2): confirmed by toggling, not guessed - `bloomPass.enabled=false` on an
  // otherwise unchanged torch-room capture removed the corner blobs entirely, so the sprite halos and
  // the point lights were never the cause. `UnrealBloomPass`'s mip-chain blur genuinely can spread a
  // small, very bright source (a flame billboard's own hot core, `dungeon-flame-fx.ts`, is intended to
  // sit above the bloom threshold) a long way from where it started, and round 6/7 both raised how
  // many wall sconces exist per floor - more small bright sources, more chances one lands near a frame
  // edge. Threshold up (a sconce's hot core still clears it; the merely-lit stone around it now does
  // not) and radius down (what does bloom stays close to its own source) rather than touching strength,
  // which the blade-edge shine and the eyes both still lean on to read at all.
  // The corner blobs survived the threshold change above: their source was a physically-lit hot spot,
  // not a flame - a wall sconce's point light mounted a few centimetres off its pillar drives the stone
  // beside it to linear radiance in the hundreds, and at that energy even the high threshold passes it
  // and the widest mips smear it across a frame corner. A hue-preserving ceiling right before bloom
  // caps any such spot; at 3.0 linear, ACES already maps it to near-white, so nothing visible is lost.
  const ceilingPass = new ShaderPass(HDR_CEILING_SHADER);
  composer.addPass(ceilingPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.4, 0.19, 1.32);
  composer.addPass(bloomPass);
  // Tone-maps (ACES) and converts linear -> the renderer's own output colour space (sRGB), exactly
  // once. Everything before this line is linear HDR; everything after it is ordinary 0-1 display
  // colour, which is what the grade pass below is written to expect.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);
  const gradePass = new ShaderPass(GRADE_SHADER);
  composer.addPass(gradePass);
  const uniforms = gradePass.uniforms as typeof GRADE_SHADER.uniforms;
  uniforms.uResolution.value.set(width, height);
  // On a CPU rasteriser the scene pass alone costs tens of milliseconds, and GTAO (its own normal/depth
  // pre-pass) and bloom's mip chain multiply it several times over - an unplayable frame for a player whose GPU is blocked, and most of
  // the browser suite's time on CI. The reduced chain keeps the tone map and the grade, so colour stays
  // where it was; it loses the contact shading and the glow.
  if (quality === 'reduced') for (const pass of [gtaoPass, bloomPass]) pass.enabled = false;

  // three.js destroys a shader program the moment the last material using it is disposed. A floor
  // rebuild disposes the old floor's materials before the new floor draws, so every identical program was
  // thrown away and compiled again - 24 heavy programs per rebuild, 3-6 s a time under software GL, and a
  // hitch on every descent on real hardware. Each program gets one extra reference the first time it is
  // seen, so a rebuild finds it still cached. The set is bounded by the distinct shaders the game has.
  const pinned = new WeakSet<object>();
  const pinPrograms = () => {
    const programs = (renderer.info as unknown as { programs?: { usedTimes: number }[] }).programs;
    if (programs) for (const program of programs) if (!pinned.has(program)) { pinned.add(program); program.usedTimes++; }
  };
  // Frames this chain has drawn since the mount. A test driver that owns the clock reads it to check
  // that nothing drew a frame it did not ask for - a floor build under manual time, above all.
  let frames = 0;

  return {
    composer,
    quality,
    pinPrograms,
    get frames() { return frames; },
    /** The last frame's shadow-map draws and the draw calls they cost. */
    get shadow() { return frameShadow; },
    bloomPass,
    gtaoPass,
    // Exposed for plan 015 Stage C's boot-time precompile: each pass's own material(s), which
    // `renderer.compile(scene, camera)` cannot reach since none of them are in the scene it walks.
    ceilingPass,
    outputPass,
    gradePass,
    resize(w: number, h: number) {
      composer.setSize(w, h);
      gtaoPass.setSize(w, h);
      bloomPass.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
    },
    /** Draw calls and triangles of the last frame's scene pass - what the frame actually submitted for
     * the world, without the post chain's own full-screen passes. */
    sceneCost,
    /** `t` is the world's own running clock (seconds), the same one every animated shader in the
     * keep reads, so grain and the game's other time-driven motion never drift apart. */
    render(t: number) {
      uniforms.uTime.value = t;
      renderer.shadowMap.needsUpdate = true; shadowDraws = 0; shadowCalls = 0;
      composer.render();
      pinPrograms();
      frames++; frameShadow = { draws: shadowDraws, calls: shadowCalls };
    },
    /** Plan 015 Stage C: the same frame as `render`, one pass per step, so a caller can yield between
     * passes and whatever each pass still compiles on first use lands in its own task. For a warm-up
     * frame nobody sees: nothing swaps the ping-pong buffers, so the intermediate pixels are wrong.
     * `renderToScreen` is set here because `composer.render()` normally sets it on every call, and the
     * last pass drawing offscreen would compile a program (linear output, no tone map) the real frame
     * does not use. Counts as a frame once every pass has drawn. */
    *renderSteps(t: number): Generator<void> {
      uniforms.uTime.value = t;
      renderer.shadowMap.needsUpdate = true; shadowDraws = 0; shadowCalls = 0;
      const enabled = composer.passes.filter((pass) => pass.enabled);
      for (const pass of enabled) {
        pass.renderToScreen = pass === enabled[enabled.length - 1];
        pass.render(renderer, composer.writeBuffer, composer.readBuffer, 0, false);
        pinPrograms();
        yield;
      }
      frames++; frameShadow = { draws: shadowDraws, calls: shadowCalls };
    },
    dispose() {
      gtaoPass.dispose();
      bloomPass.dispose();
      gradePass.dispose();
      composer.dispose();
    },
  };
}
