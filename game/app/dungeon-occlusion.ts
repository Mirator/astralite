import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three/src/renderers/webgl/WebGLPrograms.js';

/**
 * Plan 007: a small camera-facing dithered cutaway in the actual opaque architecture around an actor
 * the fixed isometric camera cannot otherwise see behind. Everything here is one controller, held for
 * the life of the mount; only its registration table is floor-scoped (`releaseFloor`).
 *
 * The shader math lives twice on purpose. `installCutawayShaderHooks` writes the GLSL that actually
 * runs on the GPU; `ellipseEdge` / `depthGap` / `cutStrengthAt` are the same arithmetic in plain
 * TypeScript, kept in lockstep with the GLSL string by sharing the same named constants below, so the
 * node suite can pin down the view/depth math, the behind-target rejection and the overlap bound
 * without a WebGL context. Passing those unit tests is not proof the shader compiles or does anything
 * visible — see `tests/browser/occlusion.spec.ts` for the actual pixel evidence this plan requires.
 */

export type EnemyKind = 'guard' | 'stalker' | 'warden';
type SlotOwner = 'player' | EnemyKind;

/** Three fixed slots: player, then at most two nearest eligible enemies. */
export const CUTAWAY_SLOTS = 3;
export const CUTAWAY_FADE_IN = 0.10;
export const CUTAWAY_FADE_OUT = 0.16;
export const CUTAWAY_MIN_GAP = 0.10;
export const CUTAWAY_MAX_GAP = 6.0;
export const CUTAWAY_MIN_WORLD_Y = 0.18;
export const CUTAWAY_INNER_RADIUS = 0.65;
export const CUTAWAY_OUTER_RADIUS = 1.0;
export const CUTAWAY_MAX_STRENGTH = 0.9;
/** Enemies farther than this from the player in world units never open a window. */
export const CUTAWAY_ENEMY_RANGE = 4.0;
/** Fixed slot count aside, only two of the three may ever be an enemy. */
export const CUTAWAY_ENEMY_SLOTS = 2;

/** Starting ellipse radii (view-space world units) and the body-centre y offset, per occupant. */
export const CUTAWAY_ELLIPSE: Record<SlotOwner, { radii: [number, number]; yOffset: number }> = {
  player: { radii: [0.68, 1.05], yOffset: 0.9 },
  guard: { radii: [0.65, 1.0], yOffset: 1.0 },
  stalker: { radii: [0.65, 1.0], yOffset: 1.0 },
  warden: { radii: [0.92, 1.35], yOffset: 1.25 },
};

// ---------------------------------------------------------------------- pure math (unit-testable)

/**
 * The fragment shader's elliptical falloff, mirrored in TypeScript. 1 at the ellipse centre, a smooth
 * fall to 0 between normalized radius 0.65 and 1.0, 0 beyond it. `dx`/`dy` are the view-space offset
 * of the fragment from the target centre; `rx`/`ry` are the ellipse's own two radii.
 */
export function ellipseEdge(dx: number, dy: number, rx: number, ry: number): number {
  const ex = dx / rx, ey = dy / ry;
  const dist = Math.hypot(ex, ey);
  if (dist >= CUTAWAY_OUTER_RADIUS) return 0;
  if (dist <= CUTAWAY_INNER_RADIUS) return 1;
  const t = (dist - CUTAWAY_INNER_RADIUS) / (CUTAWAY_OUTER_RADIUS - CUTAWAY_INNER_RADIUS);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * View z is negative in front of the camera, so depth is `-z` and grows with distance. A positive gap
 * means the fragment sits nearer the camera than the target — an obstruction in front of it.
 */
export function depthGap(targetViewZ: number, fragmentViewZ: number): number {
  return -targetViewZ - -fragmentViewZ;
}

export type CutawayFragment = { x: number; y: number; z: number };
export type CutawayTargetView = { center: CutawayFragment; radii: [number, number]; strength: number };

/** The whole per-target cut amount, world-y guard and depth-gap guard included. Mirrors the GLSL block. */
export function cutStrengthAt(fragment: CutawayFragment, worldY: number, target: CutawayTargetView): number {
  if (worldY <= CUTAWAY_MIN_WORLD_Y) return 0;
  const edge = ellipseEdge(fragment.x - target.center.x, fragment.y - target.center.y, target.radii[0], target.radii[1]);
  if (edge <= 0) return 0;
  const gap = depthGap(target.center.z, fragment.z);
  if (gap < CUTAWAY_MIN_GAP || gap > CUTAWAY_MAX_GAP) return 0;
  return edge * target.strength * CUTAWAY_MAX_STRENGTH;
}

/** Overlapping targets combine with max, never sum, so overlap can never remove more than the single-target cap. */
export function combineCutStrength(amounts: number[]): number {
  return amounts.reduce((peak, a) => Math.max(peak, a), 0);
}

// ------------------------------------------------------------------------------- shader injection

const CUTAWAY_VERTEX_VARYINGS = `varying vec3 cutawayViewPosition;\nvarying float cutawayWorldY;\nuniform mat4 uCutawayCameraWorld;`;
const CUTAWAY_VERTEX_ASSIGN = `cutawayViewPosition = mvPosition.xyz;\ncutawayWorldY = (uCutawayCameraWorld * mvPosition).y;`;

const CUTAWAY_FRAGMENT_HEADER = `
varying vec3 cutawayViewPosition;
varying float cutawayWorldY;
uniform vec3 uCutawayCenters[3];
uniform vec2 uCutawayRadii[3];
uniform float uCutawayStrengths[3];
// Development-only same-frame A/B: zero disables every cut without touching a single target's own
// state, so a test can draw the identical instant twice and diff the two framebuffers. Always 1 in a
// production build; nothing here ever writes it outside the dev fixture in the controller below.
uniform float uCutawayEnabled;
float cutawayBayerThreshold(vec2 fragCoord) {
  float m[16];
  m[0]=0.0;m[1]=8.0;m[2]=2.0;m[3]=10.0;
  m[4]=12.0;m[5]=4.0;m[6]=14.0;m[7]=6.0;
  m[8]=3.0;m[9]=11.0;m[10]=1.0;m[11]=9.0;
  m[12]=15.0;m[13]=7.0;m[14]=13.0;m[15]=5.0;
  int px = int(mod(fragCoord.x, 4.0));
  int py = int(mod(fragCoord.y, 4.0));
  int idx = py * 4 + px;
  return (m[idx] + 0.5) / 16.0;
}`;

// Discard after clipping and before final colour: the earliest point in the fragment stage, so a
// discarded texel pays for none of the lighting math that follows it.
const CUTAWAY_FRAGMENT_DISCARD = `
{
  float cutAmount = 0.0;
  if (cutawayWorldY > 0.18) {
    for (int cutawayI = 0; cutawayI < 3; cutawayI++) {
      vec2 cutawayE = (cutawayViewPosition.xy - uCutawayCenters[cutawayI].xy) / uCutawayRadii[cutawayI];
      float cutawayDist = length(cutawayE);
      if (cutawayDist < 1.0) {
        float cutawayEdge = 1.0 - smoothstep(0.65, 1.0, cutawayDist);
        float cutawayTargetDepth = -uCutawayCenters[cutawayI].z;
        float cutawayFragDepth = -cutawayViewPosition.z;
        float cutawayGap = cutawayTargetDepth - cutawayFragDepth;
        if (cutawayGap >= 0.10 && cutawayGap <= 6.0) {
          float cutawayAmount = cutawayEdge * uCutawayStrengths[cutawayI] * 0.9;
          cutAmount = max(cutAmount, cutawayAmount);
        }
      }
    }
  }
  if (uCutawayEnabled > 0.5 && cutAmount > cutawayBayerThreshold(gl_FragCoord.xy)) discard;
}`;

export type CutawayUniformHolders = {
  uCutawayCameraWorld: { value: THREE.Matrix4 };
  uCutawayCenters: { value: THREE.Vector3[] };
  uCutawayRadii: { value: THREE.Vector2[] };
  uCutawayStrengths: { value: number[] };
  uCutawayEnabled: { value: number };
};

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * Installs the cutaway hooks on an already-compiled-by-the-prior-hook shader. Three's own chunk
 * `#include <...>` anchors survive a prior `.replace` (the replacement text still contains the literal
 * anchor), which is exactly what lets this chain after `weatherStone`'s own hook without redeclaring
 * anything of its — `stoneWorld` included, never touched here.
 */
export function installCutawayShaderHooks(shader: WebGLProgramParametersWithUniforms, uniforms: CutawayUniformHolders): void {
  Object.assign(shader.uniforms, {
    uCutawayCameraWorld: uniforms.uCutawayCameraWorld,
    uCutawayCenters: uniforms.uCutawayCenters,
    uCutawayRadii: uniforms.uCutawayRadii,
    uCutawayStrengths: uniforms.uCutawayStrengths,
    uCutawayEnabled: uniforms.uCutawayEnabled,
  });

  if (shader.vertexShader.includes('cutawayViewPosition')) throw new Error('dungeon-occlusion: vertex shader already carries cutaway varyings (double-wrapped material?)');
  if (countOccurrences(shader.vertexShader, '#include <project_vertex>') !== 1) throw new Error('dungeon-occlusion: expected exactly one <project_vertex> anchor in the vertex shader');
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CUTAWAY_VERTEX_VARYINGS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${CUTAWAY_VERTEX_ASSIGN}`);

  if (shader.fragmentShader.includes('cutawayViewPosition')) throw new Error('dungeon-occlusion: fragment shader already carries cutaway varyings (double-wrapped material?)');
  if (countOccurrences(shader.fragmentShader, '#include <clipping_planes_fragment>') !== 1) throw new Error('dungeon-occlusion: expected exactly one <clipping_planes_fragment> anchor in the fragment shader');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CUTAWAY_FRAGMENT_HEADER}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUTAWAY_FRAGMENT_DISCARD}`);
}

// ------------------------------------------------------------------------------------- controller

type OccluderMaterial = THREE.MeshStandardMaterial;
type OccluderMesh = THREE.Mesh | THREE.InstancedMesh;

type Registration = { mesh: OccluderMesh; original: OccluderMaterial | OccluderMaterial[]; variant: OccluderMaterial | OccluderMaterial[] };

type Slot = {
  owner: SlotOwner | null;
  /** Stable identity: `'player'` for the one player slot, an enemy's own index otherwise. Used to
   * keep a target attached to its actor across frames and to break ties deterministically. */
  id: number | 'player' | null;
  strength: number;
  position: THREE.Vector3;
  radii: [number, number];
};

export type CutawayEnemyCandidate = { id: number; kind: EnemyKind; position: THREE.Vector3; attacking: boolean };
export type CutawayPlayer = { position: THREE.Vector3 } | null;

export type CutawayDiagnosticSlot = { owner: SlotOwner | null; id: number | 'player' | null; strength: number; radii: [number, number]; center: { x: number; y: number; z: number } };

export function createCutawayController() {
  const uniforms: CutawayUniformHolders = {
    uCutawayCameraWorld: { value: new THREE.Matrix4() },
    uCutawayCenters: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uCutawayRadii: { value: [new THREE.Vector2(1, 1), new THREE.Vector2(1, 1), new THREE.Vector2(1, 1)] },
    uCutawayStrengths: { value: [0, 0, 0] },
    uCutawayEnabled: { value: 1 },
  };
  const slots: Slot[] = [
    { owner: null, id: null, strength: 0, position: new THREE.Vector3(), radii: [1, 1] },
    { owner: null, id: null, strength: 0, position: new THREE.Vector3(), radii: [1, 1] },
    { owner: null, id: null, strength: 0, position: new THREE.Vector3(), radii: [1, 1] },
  ];
  // One variant per source material, shared by every eligible mesh that used it, plus the mesh-level
  // table needed to restore originals and dispose each variant exactly once on `releaseFloor`.
  const variantCache = new Map<OccluderMaterial, OccluderMaterial>();
  const registrations: Registration[] = [];
  const scratchView = new THREE.Vector3();

  const variantFor = (original: OccluderMaterial): OccluderMaterial => {
    const cached = variantCache.get(original);
    if (cached) return cached;
    if (original.userData.cutawayVariant) return original; // already a variant; never double-wrap
    const variant = original.clone() as OccluderMaterial;
    variant.userData.cutawayVariant = true;
    // Captured once, before the wrapper is installed, so the wrapper always calls the ORIGINAL
    // material's own hook exactly once and never a previously-installed cutaway wrapper.
    const priorCompile = typeof original.onBeforeCompile === 'function' ? original.onBeforeCompile.bind(original) : null;
    const priorKey = typeof original.customProgramCacheKey === 'function' ? original.customProgramCacheKey.bind(original) : null;
    variant.onBeforeCompile = (shader, renderer) => {
      priorCompile?.(shader, renderer);
      installCutawayShaderHooks(shader, uniforms);
    };
    variant.customProgramCacheKey = () => `${priorKey ? priorKey() : ''}|actor-cutaway-v1`;
    variantCache.set(original, variant);
    return variant;
  };

  const register = (mesh: OccluderMesh) => {
    if (registrations.some(r => r.mesh === mesh)) return; // already registered; a floor is only built once
    const original = mesh.material as OccluderMaterial | OccluderMaterial[];
    const variant = Array.isArray(original) ? original.map(variantFor) : variantFor(original);
    mesh.material = variant;
    registrations.push({ mesh, original, variant });
  };

  /** Copies the small set of scalar properties the atmosphere pass animates from source to variant,
   * once a frame, after that pass runs — never `Material.copy`, never a new material. */
  const syncMaterials = () => {
    for (const original of variantCache.keys()) {
      const variant = variantCache.get(original)!;
      variant.color.copy(original.color);
      variant.emissive.copy(original.emissive);
      variant.emissiveIntensity = original.emissiveIntensity;
      variant.roughness = original.roughness;
      variant.metalness = original.metalness;
      variant.opacity = original.opacity;
    }
  };

  const releaseSlot = (slot: Slot) => { slot.owner = null; slot.id = null; slot.strength = 0; };

  const clear = () => { for (const slot of slots) releaseSlot(slot); };

  /** Development-only same-frame A/B toggle (see `uCutawayEnabled` above): never mutates a single
   * target's own state, so drawing once disabled and once enabled compares the identical instant. */
  const setEnabled = (enabled: boolean) => { uniforms.uCutawayEnabled.value = enabled ? 1 : 0; };

  /** Restores every registered mesh's original material, disposes each unique variant once, and drops
   * both tables — called first in `clearFloor`, before the atmosphere and floor traversal dispose. Also
   * restores the dev A/B toggle to its default (enabled), as a pooled reset requires. */
  const releaseFloor = () => {
    for (const { mesh, original } of registrations) mesh.material = original;
    for (const variant of variantCache.values()) variant.dispose();
    registrations.length = 0;
    variantCache.clear();
    clear();
    setEnabled(true);
  };

  const dispose = () => { releaseFloor(); };

  /**
   * Resolves the three fixed slots for this frame and writes the shared uniforms. `player` is the one
   * player slot at full strength while present; `enemies` is every currently-eligible candidate this
   * frame (already filtered by the caller to alive/awake/active-room/range — an id absent from this
   * list this frame is death, hidden state or a room change, and is cleared immediately rather than
   * faded). `attacking` drives the fade: true fades a held slot toward strength 1 over
   * `CUTAWAY_FADE_IN`, false fades it toward 0 over `CUTAWAY_FADE_OUT`, and a slot that reaches 0 while
   * fading out is freed for a later candidate. `dt` is simulation time, so hit-stop and pause — which
   * simply do not call `update` — freeze it exactly where it was.
   */
  const update = (camera: THREE.Camera, player: CutawayPlayer, enemies: CutawayEnemyCandidate[], dt: number) => {
    // Player slot: always slot 0, always full strength while present, cleared the instant it is not.
    const playerSlot = slots[0];
    if (player) {
      playerSlot.owner = 'player'; playerSlot.id = 'player'; playerSlot.strength = 1;
      playerSlot.position.copy(player.position); playerSlot.radii = CUTAWAY_ELLIPSE.player.radii;
    } else releaseSlot(playerSlot);

    const byId = new Map(enemies.map(e => [e.id, e]));
    const enemySlots = slots.slice(1);

    // Instant clear: an occupied slot whose id is no longer in this frame's eligible list at all is
    // dead, hidden, out of the active room or out of range — never faded, always dropped at once.
    for (const slot of enemySlots) if (slot.id !== null && slot.id !== 'player' && !byId.has(slot.id)) releaseSlot(slot);

    // Fill any free slot with the nearest still-unassigned attacking candidate, tie-broken by id so
    // two equally-distant candidates never swap slots frame to frame. Filled before the fade step
    // below runs, so a target opens its window on the very frame it is assigned rather than sitting
    // one frame at strength 0 first.
    const held = new Set(enemySlots.filter(s => s.id !== null).map(s => s.id));
    const waiting = enemies
      .filter(e => e.attacking && !held.has(e.id))
      .sort((a, b) => a.position.distanceTo(playerSlot.position) - b.position.distanceTo(playerSlot.position) || a.id - b.id);
    for (const slot of enemySlots) {
      if (slot.id !== null || waiting.length === 0) continue;
      const candidate = waiting.shift()!;
      slot.owner = candidate.kind; slot.id = candidate.id; slot.strength = 0;
      slot.position.copy(candidate.position); slot.radii = CUTAWAY_ELLIPSE[candidate.kind].radii;
    }

    // Fade every held slot toward its candidate's current attacking state, tracking its live position.
    for (const slot of enemySlots) {
      if (slot.id === null || slot.id === 'player') continue;
      const candidate = byId.get(slot.id)!;
      slot.position.copy(candidate.position);
      slot.radii = CUTAWAY_ELLIPSE[candidate.kind].radii;
      const rate = dt <= 0 ? 0 : dt / (candidate.attacking ? CUTAWAY_FADE_IN : CUTAWAY_FADE_OUT);
      slot.strength = candidate.attacking
        ? Math.min(1, slot.strength + rate)
        : Math.max(0, slot.strength - rate);
      if (!candidate.attacking && slot.strength === 0) releaseSlot(slot);
    }

    // Write the shared uniforms: camera world matrix (needed to recover world-y from a view-space
    // varying) and, per slot, its view-space centre — including the body-centre y offset, which is
    // applied here rather than by the caller so every candidate list only ever carries feet positions.
    camera.updateMatrixWorld();
    uniforms.uCutawayCameraWorld.value.copy(camera.matrixWorld);
    for (let i = 0; i < CUTAWAY_SLOTS; i++) {
      const slot = slots[i];
      const yOffset = slot.owner ? CUTAWAY_ELLIPSE[slot.owner].yOffset : 0;
      scratchView.set(slot.position.x, slot.position.y + yOffset, slot.position.z).applyMatrix4(camera.matrixWorldInverse);
      uniforms.uCutawayCenters.value[i].copy(scratchView);
      uniforms.uCutawayRadii.value[i].set(slot.radii[0], slot.radii[1]);
      uniforms.uCutawayStrengths.value[i] = slot.strength;
    }
  };

  const diagnostics = (): { slots: CutawayDiagnosticSlot[]; registeredMeshCount: number; registeredMaterialCount: number; enabled: boolean } => ({
    slots: slots.map((slot, i) => ({
      owner: slot.owner, id: slot.id, strength: slot.strength, radii: slot.radii,
      center: { x: uniforms.uCutawayCenters.value[i].x, y: uniforms.uCutawayCenters.value[i].y, z: uniforms.uCutawayCenters.value[i].z },
    })),
    registeredMeshCount: registrations.length,
    registeredMaterialCount: variantCache.size,
    enabled: uniforms.uCutawayEnabled.value > 0.5,
  });

  return { register, update, clear, dispose, releaseFloor, syncMaterials, diagnostics, setEnabled };
}

export type CutawayController = ReturnType<typeof createCutawayController>;
