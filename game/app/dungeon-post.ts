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
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
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

export function createPostChain(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Plan 014 round 6 (lever 2): grout lines, wall bases, pillar/floor contact and the paving under a
  // parapet were all reading one flat lit value - nothing in the render pipeline darkened a surface
  // for standing close to another one, only for standing in shadow of a light. GTAO is a genuine
  // ambient-occlusion term (screen-space, from the depth+normal buffer this pass renders for itself),
  // not a fake contact-shadow decal, so it darkens exactly the concave corners a painted scene's own
  // eye would - and nowhere else. It runs here, right after `RenderPass` and before either outline
  // pass, because it is a multiplicative term on incoming radiance (occlusion attenuates light, it
  // does not tint or tone-map it) - correct on the linear HDR `RenderPass` just wrote, same reasoning
  // as bloom below, and safely before the outline passes read the buffer for their own edge work.
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
  // Dark, tight outlines on the knight and every living enemy - the reference's inked figures
  // against a painted field. `selectedObjects` is replaced wholesale each frame from the live actor
  // list rather than mutated, which is the array `setOutline` already hands over.
  const outlinePass = new OutlinePass(new THREE.Vector2(width, height), scene, camera);
  outlinePass.edgeStrength = 5.5;
  outlinePass.edgeGlow = 0;
  outlinePass.edgeThickness = 1.4;
  outlinePass.visibleEdgeColor.setHex(0x05070a);
  outlinePass.hiddenEdgeColor.setHex(0x05070a);
  outlinePass.pulsePeriod = 0;
  composer.addPass(outlinePass);
  // Plan 014 round 2 (lever D10): a second, thin, warm-bright rim beside the dark ink one - the
  // reference's figures carry a lit edge that separates them from the floor as well as the dark
  // outline that separates them from the background. Same selection, updated in the same call.
  const rimPass = new OutlinePass(new THREE.Vector2(width, height), scene, camera);
  // Plan 014 round 2: this ran at 2.6/0.4 in a first pass and read as a cartoon selection-highlight -
  // a bright, glowing line around every body, including ones standing in near-total dark where the
  // rim was the only thing left of them at all. Turned down hard: a faint warm accent on the lit
  // side of a figure, not a second light source of its own.
  rimPass.edgeStrength = 0.9;
  rimPass.edgeGlow = 0;
  rimPass.edgeThickness = 1;
  rimPass.visibleEdgeColor.setHex(0xffce9a);
  rimPass.hiddenEdgeColor.setHex(0x000000);
  rimPass.pulsePeriod = 0;
  composer.addPass(rimPass);
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
  composer.addPass(new ShaderPass(HDR_CEILING_SHADER));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.4, 0.19, 1.32);
  composer.addPass(bloomPass);
  // Tone-maps (ACES) and converts linear -> the renderer's own output colour space (sRGB), exactly
  // once. Everything before this line is linear HDR; everything after it is ordinary 0-1 display
  // colour, which is what the grade pass below is written to expect.
  composer.addPass(new OutputPass());
  const gradePass = new ShaderPass(GRADE_SHADER);
  composer.addPass(gradePass);
  const uniforms = gradePass.uniforms as typeof GRADE_SHADER.uniforms;
  uniforms.uResolution.value.set(width, height);

  return {
    composer,
    bloomPass,
    outlinePass,
    rimPass,
    gtaoPass,
    resize(w: number, h: number) {
      composer.setSize(w, h);
      gtaoPass.setSize(w, h);
      bloomPass.setSize(w, h);
      outlinePass.setSize(w, h);
      rimPass.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
    },
    setOutline(objects: THREE.Object3D[]) { outlinePass.selectedObjects = objects; rimPass.selectedObjects = objects; },
    /** `t` is the world's own running clock (seconds), the same one every animated shader in the
     * keep reads, so grain and the game's other time-driven motion never drift apart. */
    render(t: number) {
      uniforms.uTime.value = t;
      composer.render();
    },
    dispose() {
      gtaoPass.dispose();
      bloomPass.dispose();
      outlinePass.dispose();
      rimPass.dispose();
      gradePass.dispose();
      composer.dispose();
    },
  };
}
