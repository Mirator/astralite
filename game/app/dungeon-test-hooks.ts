import * as THREE from 'three';
import type { CombatFixture } from './dungeon-fixture';
import type { Enemy, EnemyKind } from './dungeon-enemy-view';
import type { RunEnd } from './dungeon-save';
import { getFlagstoneTextures, getMasonryTextures } from './dungeon-textures';
import type { WeaponId } from './dungeon-weapon';

// What the running game hangs on `window` for the console and for automated drivers, and the read-only
// diagnostics behind the development-only half of it. Nothing in the game calls any of this; see
// tests/README.md. The world closure in dungeon-game.tsx still decides what each hook does to the run -
// these are the parts that only read the scene.

export type ActorStat = { meshes: number; triangles: number; shadowless: number; height: number };

export type TestHooks = {
  teleport: (x: number, z: number) => void;
  equip: (id: string) => void;
  descend: () => void;
  buildFloor: (level: number, seed?: number) => void;
  grantXp: (amount: number) => void;
  reset: (seed?: number) => void;
  runLog: () => RunEnd[];
  configureCombatFixture?: (fixture: CombatFixture) => void;
  cutawayDiagnostics?: () => unknown;
  setCutawayEnabled?: (enabled: boolean) => void;
  footstepParticles?: () => unknown;
  setFootstepsEnabled?: (enabled: boolean) => void;
  setEnemyRigVisible?: (index: number, visible: boolean) => void;
  actorStats?: () => { knight: ActorStat & { disposedMaterials: number }; enemies: ({ kind: EnemyKind } & ActorStat)[]; drop: { kind: WeaponId; meshes: number; triangles: number } | null };
  lightDiagnostics?: (index: number, radius?: number) => unknown;
  drainGpu?: () => number;
  textureHash?: () => { flagstone: number; masonry: number };
};

export type HookedWindow = Window & {
  advanceTime?: (ms: number, draw?: boolean) => void;
  render_game_to_text?: () => string;
  dungeonTest?: TestHooks;
};

/** The WebMCP-style tool registry a host page may offer on `document.modelContext`. */
export type GameToolContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: { action?: string }) => { accepted: boolean; action: string };
  }, options: { signal: AbortSignal }) => void | Promise<void>;
};

// Plan 009: what one figure costs to draw and how tall it stands, off its live meshes rather than off the
// source. Visible meshes only, walking down through visible nodes; the root's own flag is ignored so an
// ambush body still reports its model. The contact pool is counted, since it draws, and left out of the
// height, since it lies on the floor and writes its own world matrix at draw time (it is the one
// multiply-blended mesh on any actor). Two scratch boxes, so a call allocates nothing but its answer.
const statBox = new THREE.Box3(), partBox = new THREE.Box3();
export const actorStat = (root: THREE.Object3D): ActorStat => {
  let meshes = 0, triangles = 0, shadowless = 0; statBox.makeEmpty(); root.updateWorldMatrix(true, true);
  const walk = (o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry, n = g.index ? g.index.count : g.getAttribute('position').count;
      meshes++; triangles += Math.floor(Math.min(n, g.drawRange.count) / 3);
      if ((o.material as THREE.Material).blending !== THREE.MultiplyBlending) { if (!g.boundingBox) g.computeBoundingBox(); statBox.union(partBox.copy(g.boundingBox!).applyMatrix4(o.matrixWorld)); if (!o.castShadow) shadowless++; }
    }
    for (const child of o.children) if (child.visible) walk(child);
  };
  walk(root);
  return { meshes, triangles, shadowless, height: statBox.isEmpty() ? 0 : +(statBox.max.y - statBox.min.y).toFixed(4) };
};

/**
 * The knight's materials are run-scoped and shared with every arm he holds and every rack he is offered,
 * so nothing short of an unmount may release one: each dispose that reaches one is counted.
 */
export const countDisposals = (root: THREE.Object3D) => {
  let disposals = 0;
  const materials = new Set<THREE.Material>();
  root.traverse(o => { if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); });
  materials.forEach(m => m.addEventListener('dispose', () => { disposals++; }));
  return () => disposals;
};

/**
 * Plan 015 Stage C.2: a cheap checksum of the shared stone textures' actual pixels, off the live
 * canvas each one draws to - not a recomputation, so a sliced band that lands its pixels in the
 * wrong place or skips one shows up here even though nothing about the material or the floor it
 * skins would otherwise reveal it.
 */
export const textureHash = () => {
  const hash = (texture: THREE.Texture) => {
    const canvas = texture.image as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0; for (let i = 0; i < data.length; i += 97) h = (h * 31 + data[i]) >>> 0;
    return h;
  };
  return { flagstone: hash(getFlagstoneTextures().albedo), masonry: hash(getMasonryTextures().albedo) };
};

/**
 * A barrier, not a measurement a test asserts on: returns once the GPU process has run everything
 * this page already handed it, and says how long that took. A driver's clock hands it work far
 * faster than frames would - a drawn step, a rebuild's uploads - and on a software rasteriser that
 * queue can run to tens of seconds that nothing waits on, until the next animation frame (which
 * every Playwright click needs two of) sits behind all of it. A 1x1 readPixels of the canvas is the
 * one WebGL call that cannot return before the queue ahead of it has drained. The default
 * framebuffer is bound for it, so a render target three.js left bound can never make it a no-op.
 */
export const drainGpu = (renderer: THREE.WebGLRenderer) => {
  const gl = renderer.getContext(), bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, started = performance.now();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
  return performance.now() - started;
};

/**
 * Plan 014 round 5 (lever A3): a real answer to "what is overbright here" instead of another
 * guess. Enumerates every material on a live enemy's own group, plus every light and every
 * additive-blended mesh/sprite anywhere in the scene within `radius` of its position, with the
 * handful of numbers that actually decide whether something blooms: emissive/emissiveIntensity,
 * opacity, and (for lights) colour/intensity/distance from the target.
 */
export const lightDiagnostics = (scene: THREE.Scene, enemy: Enemy | undefined, index: number, radius = 2) => {
  if (!enemy) throw new Error(`no enemy at spawn index ${index}`);
  const at = enemy.group.position;
  const materials: unknown[] = [];
  enemy.group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const std = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      materials.push({
        node: o.name || o.type, material: m.type,
        color: '#' + std.color?.getHexString(), emissive: std.emissive ? '#' + std.emissive.getHexString() : null,
        emissiveIntensity: std.emissiveIntensity ?? null, opacity: m.opacity, transparent: m.transparent,
        blending: m.blending, toneMapped: m.toneMapped, visible: o.visible,
      });
    }
  });
  const lights: unknown[] = [];
  const nearby: unknown[] = [];
  scene.traverse(o => {
    if (o instanceof THREE.Light) {
      const d = o.position.distanceTo(at);
      if (d <= radius) lights.push({ type: o.type, color: '#' + o.color.getHexString(), intensity: o.intensity, distance: +d.toFixed(3) });
      return;
    }
    let underEnemy = false; for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === enemy.group) { underEnemy = true; break; }
    if ((o instanceof THREE.Mesh || o instanceof THREE.Sprite) && !underEnemy) {
      const d = o.getWorldPosition(new THREE.Vector3()).distanceTo(at);
      if (d > radius) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.blending !== THREE.AdditiveBlending && m.opacity >= 1 && !(o instanceof THREE.Sprite)) continue;
        nearby.push({ node: o.name || o.type, distance: +d.toFixed(3), material: m.type, color: '#' + (m as THREE.MeshBasicMaterial).color?.getHexString(), opacity: m.opacity, blending: m.blending, toneMapped: m.toneMapped, visible: o.visible });
      }
    }
  });
  return { at: { x: at.x, y: at.y, z: at.z }, materials, lights, nearby };
};

/** How many point lights the scene holds, which is what decides whether every lit shader recompiles. */
export const pointLightCount = (scene: THREE.Scene) => { let n = 0; scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) n++; }); return n; };

