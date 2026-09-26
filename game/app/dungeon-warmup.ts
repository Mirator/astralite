import * as THREE from 'three';
import type { createPostChain } from './dungeon-post';

// The parts of a staged floor build that keep the first visible frame from stalling on shader work:
// polling the renderer's program list across frames, driving a sliced generator on a budget, and
// precompiling the post chain's own materials against the proxies they are really drawn with. Pulled out
// of the world closure in dungeon-game.tsx unchanged; the closure keeps the staging itself.

type Post = ReturnType<typeof createPostChain>;
/** Work per slice before yielding back to the browser. */
export const SLICE_BUDGET_MS = 12;

type Program = { isReady: () => boolean; getUniforms: () => unknown; getAttributes: () => unknown };
const programsOf = (renderer: THREE.WebGLRenderer) => (renderer.info as unknown as { programs?: Program[] }).programs ?? [];
/** How many programs the renderer has linked or is linking. */
export const linkedPrograms = (renderer: THREE.WebGLRenderer) => programsOf(renderer).length;

/**
 * Submits nothing itself - `renderer.compile` already did that, and with `KHR_parallel_shader_compile`
 * that submission runs asynchronously in the GPU process. What used to force the wait was the very
 * next line, the first render, which called `getUniforms`/`getAttributes` on every program in one
 * synchronous sweep. This calls them instead, split across frames: `isReady()` (never blocks) says
 * whether a program's link has actually landed, and only a program that says yes gets its reflection
 * pulled, within a budget of about 12ms a slice, so the first real frame the player sees does none.
 * Without the extension `isReady()` reports every program ready immediately, and `getUniforms` is
 * what actually forces that one program's link - the same budget then force-links a handful of
 * programs a frame instead of all of them at once, and the worst single frame is bounded by the
 * slowest one.
 *
 * It reads `renderer.info.programs`, the renderer's own live list, which a disposed program simply
 * leaves; it never looks at a material, so a restart disposing one mid-poll cannot wedge it. `current`
 * says whether the build that asked is still the one running; `slice` is told each slice's cost.
 */
export const pollProgramsReady = async (renderer: THREE.WebGLRenderer, current: () => boolean, yielded: () => Promise<void>, slice: (ms: number) => void) => {
  while (true) {
    const programs = programsOf(renderer);
    const frameStart = performance.now();
    let allReady = true;
    for (const program of programs) {
      if (!program.isReady()) { allReady = false; continue; }
      program.getUniforms(); program.getAttributes();
      if (performance.now() - frameStart > SLICE_BUDGET_MS) { allReady = false; break; }
    }
    slice(+(performance.now() - frameStart).toFixed(1));
    if (allReady || !current()) return;
    await yielded();
  }
};

/**
 * Plan 015 Stage C.2: drives a sliced generator (the texture bands, a floor build) the way
 * `pollProgramsReady` drives three.js's program list - a budget of work per frame, yielding in between,
 * until the generator reports done or the build that asked is stopped or superseded.
 */
export const driveSliced = async (steps: Generator<void>, current: () => boolean, yielded: () => Promise<void>, slice: (ms: number) => void) => {
  while (true) {
    const frameStart = performance.now();
    let done = false;
    while (performance.now() - frameStart < SLICE_BUDGET_MS) {
      if (steps.next().done) { done = true; break; }
    }
    slice(+(performance.now() - frameStart).toFixed(1));
    if (done || !current()) return;
    await yielded();
  }
};

/**
 * Plan 015 Stage C fix round: the first bullet-5 attempt precompiled the post chain's own
 * full-screen materials against a plain quad with no targetScene and got programs the real render
 * never reused - a program's cache key folds in the render state's light/fog/shadow tally, and
 * that plain quad was never part of a scene at all, gathering none of what the *real* chain
 * renders with. Two kinds of pass need two different proxies:
 *  - the simple full-screen ones (ceiling, grade, GTAO's own and bloom's own high-pass/blur/composite/
 *    blend chain) render their own single triangle with no scene and no targetScene, exactly like
 *    `FullScreenQuad` itself (`three/addons/postprocessing/Pass.js`) - so the proxy below matches
 *    that triangle and that orthographic camera, and passes no targetScene either.
 *  - GTAO's normal-pass override (`normalMaterial`) renders the *game* scene with the *game*
 *    scene's own lights, so its proxies carry `scene` as the targetScene, one representative
 *    object per shape the real floor puts in front of it: a plain Mesh, an InstancedMesh with no
 *    per-instance colour, and one with `setColorAt` called (`USE_INSTANCING_COLOR` is a define,
 *    not a runtime branch).
 * Every render target below is the one that pass actually draws into - a canvas-bound program
 * differs from an offscreen one the same way the main scene compile does. Returns what it cost, in ms.
 */
export const precompilePost = (renderer: THREE.WebGLRenderer, post: Post, scene: THREE.Scene, camera: THREE.Camera) => {
  const postStart = performance.now();
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  triangle.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const screenProxy = new THREE.Mesh(triangle);
  const offscreen = post.composer.readBuffer;
  const drawingTo = renderer.getRenderTarget();
  // A disabled pass (both, on the reduced chain software GL gets) never draws, so its materials
  // are left alone: compiling them there is a dozen programs nobody uses, at software-GL prices.
  const bloom = post.bloomPass.enabled, gtao = post.gtaoPass.enabled;
  const screenMaterials: [THREE.Material, THREE.WebGLRenderTarget | null][] = [
    [post.ceilingPass.material, offscreen],
    ...(bloom ? [post.bloomPass.materialHighPassFilter, ...post.bloomPass.separableBlurMaterials, post.bloomPass.compositeMaterial, post.bloomPass.blendMaterial] : []).map((material): [THREE.Material, THREE.WebGLRenderTarget | null] => [material, offscreen]),
    // GTAO's own full-screen materials - everything but `normalMaterial` below, which is the one
    // override that renders the scene itself rather than a screen triangle, and `depthRenderMaterial`,
    // which only the debug depth output draws: precompiled, it was the one program of the set the
    // real frame never used (its PERSPECTIVE_CAMERA define is left at 1, since nothing draws it).
    ...(gtao ? [post.gtaoPass.gtaoMaterial, post.gtaoPass.pdMaterial, post.gtaoPass.copyMaterial, post.gtaoPass.blendMaterial] : []).map((material): [THREE.Material, THREE.WebGLRenderTarget | null] => [material, offscreen]),
    // Not OutputPass's own material: its `defines` (SRGB_TRANSFER, a tone-mapping one) are set
    // lazily inside its own `render()`, compared against the renderer's current colour space and
    // tone mapping - never here, since nothing has rendered yet - so a bare compile always finds
    // them unset and produces a program the real render (which does set them first) never reuses.
    // Its own first use is covered by the sliced first draw, which actually renders it.
    [post.gradePass.material, null],
  ];
  for (const [material, target] of screenMaterials) {
    screenProxy.material = material;
    renderer.setRenderTarget(target);
    renderer.compile(screenProxy, screenCamera);
  }
  const normalTarget = (post.gtaoPass as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }).normalRenderTarget;
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const meshProxy = new THREE.Mesh(cube, post.gtaoPass.normalMaterial);
  const instancedProxy = new THREE.InstancedMesh(cube, post.gtaoPass.normalMaterial, 1);
  instancedProxy.setMatrixAt(0, new THREE.Matrix4());
  const instancedColorProxy = new THREE.InstancedMesh(cube, post.gtaoPass.normalMaterial, 1);
  instancedColorProxy.setMatrixAt(0, new THREE.Matrix4());
  instancedColorProxy.setColorAt(0, new THREE.Color());
  renderer.setRenderTarget(normalTarget);
  if (gtao) for (const proxy of [meshProxy, instancedProxy, instancedColorProxy]) renderer.compile(proxy, camera, scene);
  renderer.setRenderTarget(drawingTo);
  triangle.dispose(); cube.dispose(); instancedProxy.dispose(); instancedColorProxy.dispose();
  post.pinPrograms();
  return +(performance.now() - postStart).toFixed(1);
};
