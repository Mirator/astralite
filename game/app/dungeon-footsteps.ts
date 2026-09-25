import * as THREE from 'three';
import type { FootstepKind } from './dungeon-footstep-rules.ts';

// Plan 008: restrained surface feedback where a boot actually lands. Dry stone gives a couple of faint
// flecks of dust that spread low and sideways; the drowned levels give two or three tiny drops shed
// off a wet boot, which flick a short ballistic hop and vanish where they land. Wood gives nothing.
//
// One batch for the whole mounted game: a single BufferGeometry of up to `capacity` camera-facing quads
// and one material, allocated once. An emission writes numbers into preallocated arrays; nothing - no
// Mesh, Material, Geometry or Texture - is created per step, which is the one thing the old `burst`
// sparks in dungeon-game.tsx could not say. Live quads are compacted to the front of the buffer each
// update and drawn through `drawRange`, and the mesh is switched off outright when nothing is alive, so
// an empty pool costs no draw call at all rather than a transparent one.

export const FOOTSTEP_CAPACITY = 32;

type Range = readonly [number, number];
type Look = {
  /** Particles per contact, inclusive. */
  count: Range;
  /** Dust: diameter. Drops: width across the streak. World units. */
  size: Range;
  /** Drops only: length along the streak. */
  length: Range | null;
  life: Range;
  /** Start alpha; every particle fades smoothly to zero. */
  alpha: Range;
  /** Dust: the highest a fleck rises above its contact. Drops: the apex of the hop. */
  height: Range;
  /** Horizontal distance covered over the particle's whole life. */
  travel: Range;
  /** sRGB, close to the stone it rises off - a little lighter so it reads at all, never a flash. */
  color: number;
  droplet: boolean;
};

/**
 * The plan's visual table, as numbers. Every emitted particle draws its parameters from inside these
 * ranges and `dungeon-footsteps.test.ts` holds the live particles to them.
 */
export const FOOTSTEP_LOOK: Record<FootstepKind, Look> = {
  // Cold, dry, high: one or two faint cool-gray flecks, barely off the ground.
  keep: { count: [1, 2], size: [0.07, 0.08], length: null, life: [0.2, 0.25], alpha: [0.19, 0.22], height: [0.035, 0.1], travel: [0.07, 0.13], color: 0xb4bfd0, droplet: false },
  // Warm and dusty: a brief low puff of muted ochre-gray, never a cloud.
  ruins: { count: [2, 3], size: [0.1, 0.12], life: [0.24, 0.32], length: null, alpha: [0.19, 0.22], height: [0.05, 0.16], travel: [0.08, 0.16], color: 0xc4b18f, droplet: false },
  // Wet boots: desaturated gray-cyan drops, flicked short and gone on landing.
  flooded: { count: [2, 3], size: [0.032, 0.035], length: [0.07, 0.075], life: [0.18, 0.24], alpha: [0.26, 0.3], height: [0.06, 0.15], travel: [0.08, 0.16], color: 0xbcd8db, droplet: true },
};

/** Reduced motion keeps the feedback, but as a single short, nearly still fleck or drop. */
export const REDUCED_FOOTSTEP = { count: 1, life: 0.12, travel: 0.03 } as const;

/** The planted boot's sole, as the rig builds it (0.22 x 0.34): where flecks are born around it. */
const SOLE_HALF_WIDTH = 0.1, SOLE_LENGTH = 0.14, SOLE_TOE = 0.16, HEEL = 0.15;
/** How far past the sole's side edge a fleck may start. */
const FOOTPRINT = 0.04;
/** How far above the sampled support top a contact starts - just enough to clear the stone's own depth. */
export const FOOTSTEP_LIFT = 0.015;
/** Dust decelerates: most of its spread happens in the first third of its life. */
const DRAG = 7;

/**
 * Deterministic scatter. A private serial - never Math.random, never gameplay RNG, never the clock - so
 * the same run replays the same flecks, and a paused or redrawn frame cannot reshuffle them.
 */
const hash = (a: number, b: number) => {
  let h = Math.imul((a + 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const pick = (range: Range, t: number) => range[0] + (range[1] - range[0]) * t;

/** Installs the per-vertex corner the soft round mask reads. Normal blending; no texture, no emission. */
const softMask = (shader: { vertexShader: string; fragmentShader: string }) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 footCorner;\nvarying vec2 vFootCorner;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFootCorner = footCorner;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFootCorner;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.62, 1.0, length(vFootCorner));');
};

type Particle = {
  alive: boolean; birth: number; droplet: boolean;
  ox: number; oy: number; oz: number; dx: number; dz: number;
  age: number; life: number; travel: number; height: number;
  size: number; length: number; alpha: number; r: number; g: number; b: number;
};

export type FootstepParticle = { x: number; y: number; z: number; ox: number; oy: number; oz: number; width: number; length: number; alpha: number; age: number; life: number; droplet: boolean };

export function footstepEffects(capacity = FOOTSTEP_CAPACITY) {
  const group = new THREE.Group();
  const positions = new Float32Array(capacity * 12), colors = new Float32Array(capacity * 16), corners = new Float32Array(capacity * 8);
  const indices = new Uint16Array(capacity * 6);
  for (let q = 0; q < capacity; q++) {
    corners.set([-1, -1, 1, -1, 1, 1, -1, 1], q * 8);
    const v = q * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  // Four components: three.js reads a vec4 colour attribute as per-vertex alpha on its own.
  const color = new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  geometry.setAttribute('footCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  // Kept correct every update from the live particles, never left as the zero-sized initial bound a
  // frustum test would cull the whole batch against.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: true });
  material.onBeforeCompile = softMask;
  material.customProgramCacheKey = () => 'footstep-v1';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'footsteps'; mesh.visible = false; mesh.castShadow = mesh.receiveShadow = false;
  // Positions are written in the world group's own frame, which is the identity.
  mesh.matrixAutoUpdate = false;
  group.add(mesh);

  const particles: Particle[] = Array.from({ length: capacity }, () => ({ alive: false, birth: 0, droplet: false, ox: 0, oy: 0, oz: 0, dx: 0, dz: 0, age: 0, life: 1, travel: 0, height: 0, size: 0, length: 0, alpha: 0, r: 0, g: 0, b: 0 }));
  const tint = new THREE.Color(), right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, 1, 0);
  const along = new THREE.Vector3(), across = new THREE.Vector3(), centre = new THREE.Vector3();
  // Toward the lens, from the last update's camera; the game's fixed offset until the first one.
  const DEFAULT_VIEW = new THREE.Vector3(9.2, 12.5, 11.5).normalize(), toViewer = DEFAULT_VIEW.clone();
  let serial = 0, births = 0, live = 0, dirty = false, enabled = true;

  /** Where a particle is at its current age, and its drawn width/length/alpha. Pure in its fields. */
  const sample = (p: Particle, out: { x: number; y: number; z: number; width: number; length: number; alpha: number; vy: number }) => {
    const u = Math.min(1, p.age / p.life);
    if (p.droplet) {
      // A fixed ballistic hop from the boot that returns to the contact height exactly at end of life:
      // apex `height` at half-life, so it lands on its own support plane and is gone - never below it.
      const t = p.age, g = 8 * p.height / (p.life * p.life), vy0 = 4 * p.height / p.life;
      const d = p.travel * u;
      out.x = p.ox + p.dx * d; out.z = p.oz + p.dz * d;
      out.y = p.oy + Math.max(0, vy0 * t - 0.5 * g * t * t);
      out.vy = (vy0 - g * t) / Math.max(1e-6, p.travel / p.life);
      out.width = p.size; out.length = p.length;
      out.alpha = p.alpha * Math.pow(1 - u, 0.8);
    } else {
      // Dust decelerates as it spreads and settles upward toward its own ceiling, growing a little.
      const d = p.travel * (1 - Math.exp(-DRAG * p.age)) / (1 - Math.exp(-DRAG * p.life));
      out.x = p.ox + p.dx * d; out.z = p.oz + p.dz * d;
      out.y = p.oy + p.height * (1 - (1 - u) * (1 - u));
      out.vy = 0;
      out.width = out.length = p.size;
      out.alpha = p.alpha * Math.pow(1 - u, 1.2);
    }
    return out;
  };
  const scratch = { x: 0, y: 0, z: 0, width: 0, length: 0, alpha: 0, vy: 0 };

  /** Rewrites the live quads to the front of the buffer, the draw range and the bound. */
  const write = () => {
    let n = 0;
    centre.set(0, 0, 0);
    for (const p of particles) if (p.alive) { sample(p, scratch); centre.x += scratch.x; centre.y += scratch.y; centre.z += scratch.z; n++; }
    live = n;
    if (n) centre.multiplyScalar(1 / n);
    let radius = 0, q = 0;
    for (const p of particles) {
      if (!p.alive) continue;
      const s = sample(p, scratch);
      const halfW = s.width / 2, halfL = s.length / 2;
      if (p.droplet) {
        // The streak's long axis follows the drop's own screen-space path: horizontal travel plus its
        // rising or falling vertical, projected onto the camera plane.
        along.set(p.dx, s.vy, p.dz);
        const ax = along.dot(right), ay = along.dot(up), m = Math.hypot(ax, ay) || 1;
        along.copy(right).multiplyScalar(ax / m).addScaledVector(up, ay / m);
        // (across, along) must keep the (right, up) handedness, or the quad winds away from the lens
        // and back-face culling silently drops every drop.
        across.copy(right).multiplyScalar(ay / m).addScaledVector(up, -ax / m);
      } else { along.copy(up); across.copy(right); }
      const base = q * 12;
      const put = (k: number, cx: number, cy: number) => {
        positions[base + k * 3] = s.x + across.x * cx * halfW + along.x * cy * halfL;
        positions[base + k * 3 + 1] = s.y + across.y * cx * halfW + along.y * cy * halfL;
        positions[base + k * 3 + 2] = s.z + across.z * cx * halfW + along.z * cy * halfL;
      };
      put(0, -1, -1); put(1, 1, -1); put(2, 1, 1); put(3, -1, 1);
      for (let k = 0, c = q * 16; k < 4; k++, c += 4) { colors[c] = p.r; colors[c + 1] = p.g; colors[c + 2] = p.b; colors[c + 3] = s.alpha; }
      radius = Math.max(radius, Math.hypot(s.x - centre.x, s.y - centre.y, s.z - centre.z) + Math.hypot(halfW, halfL));
      q++;
    }
    geometry.setDrawRange(0, n * 6);
    geometry.boundingSphere!.center.copy(centre); geometry.boundingSphere!.radius = radius;
    position.needsUpdate = color.needsUpdate = true;
    mesh.visible = enabled && n > 0;
    dirty = false;
  };

  const clear = () => {
    for (const p of particles) p.alive = false;
    live = 0; geometry.setDrawRange(0, 0); geometry.boundingSphere!.radius = 0; mesh.visible = false; dirty = false;
  };

  return {
    group, mesh, clear,
    /** Live particles right now. */
    get active() { let n = 0; for (const p of particles) if (p.alive) n++; return n; },
    /** Contacts emitted since the last `reset`: the private scatter serial. */
    get emitted() { return serial; },
    /**
     * One planted boot on `kind` stone. `at` is the sole's world x/z and the SAMPLED support top y;
     * `heading` is the knight's travel direction, which dust spreads across and drops flick back from.
     * Overflow evicts the oldest particles. Returns how many were spawned.
     */
    emit(at: { x: number; y: number; z: number }, kind: FootstepKind, options: { heading?: { x: number; z: number }; reduced?: boolean } = {}) {
      if (![at.x, at.y, at.z].every(Number.isFinite)) return 0;
      const look = FOOTSTEP_LOOK[kind], event = ++serial, reduced = !!options.reduced;
      // Biased to the top of the range: at this camera a fleck is a few pixels, and one alone rarely reads.
      const count = reduced ? REDUCED_FOOTSTEP.count : hash(event, 0) < 0.25 ? look.count[0] : look.count[1];
      const heading = options.heading && Math.hypot(options.heading.x, options.heading.z) > 1e-6 ? Math.atan2(options.heading.z, options.heading.x) : hash(event, 1) * Math.PI * 2;
      tint.setHex(look.color);
      const lensSide = -Math.sin(heading) * toViewer.x + Math.cos(heading) * toViewer.z >= 0 ? 1 : -1;
      for (let i = 0; i < count; i++) {
        let slot = particles.find(p => !p.alive);
        if (!slot) slot = particles.reduce((oldest, p) => (p.birth < oldest.birth ? p : oldest));
        const r = (k: number) => hash(event, 16 + i * 8 + k);
        // Dust fans out to either side of the stride; drops are flicked back and outward off the boot's sides.
        // The first particle takes the side of the boot facing the lens: the far side is behind the boot
        // itself, and a single (or reduced-motion) fleck born there would be depth-hidden for its life.
        const side = i % 2 === 0 ? lensSide : -lensSide;
        const angle = look.droplet ? heading + side * (Math.PI * 0.7) + (r(0) - 0.5) * 0.9 : heading + side * (Math.PI / 2) + (r(0) - 0.5) * 1.3;
        // Born at the rim of the sole rather than its centre: the centre is inside the boot's own mesh,
        // which hides a fleck spawned there for most of its short life. Dust squeezes out from under a
        // side of the boot; a drop comes off a side, between toe and heel.
        const hx = Math.cos(heading), hz = Math.sin(heading);
        let along = look.droplet ? -HEEL * r(1) : (r(1) - 0.4) * SOLE_LENGTH;
        let lateral = side * (SOLE_HALF_WIDTH + r(2) * FOOTPRINT);
        if (i === 0) {
          // The first one is born on the rim point squarely facing the lens - in front of the boot as
          // the camera sees it - since that is the one spot around a planted sole nothing else covers.
          const va = hx * toViewer.x + hz * toViewer.z, vl = -hz * toViewer.x + hx * toViewer.z, vm = Math.hypot(va, vl) || 1;
          const rim = Math.min(SOLE_HALF_WIDTH / Math.max(1e-6, Math.abs(vl / vm)), SOLE_TOE / Math.max(1e-6, Math.abs(va / vm))) + r(2) * FOOTPRINT;
          along = va / vm * rim; lateral = vl / vm * rim;
        }
        const life = reduced ? Math.min(REDUCED_FOOTSTEP.life, look.life[0]) : pick(look.life, r(3));
        // Reduced motion: total displacement (spread plus rise) stays inside REDUCED_FOOTSTEP.travel.
        const travel = reduced ? REDUCED_FOOTSTEP.travel * 0.6 : pick(look.travel, r(4));
        const height = reduced ? REDUCED_FOOTSTEP.travel * 0.45 : pick(look.height, r(5));
        const shade = 0.94 + r(6) * 0.12;
        // A reduced fleck barely rises, so born at the ground it sat under the boot's edge and drew almost
        // nothing once the camera eased out. It starts where an ordinary fleck's lowest rise would take it;
        // the start is not travel, so it moves no further than before.
        const lift = reduced && !look.droplet ? look.height[0] : 0;
        Object.assign(slot, {
          alive: true, birth: ++births, droplet: look.droplet,
          ox: at.x + hx * along - hz * lateral, oy: at.y + FOOTSTEP_LIFT + lift, oz: at.z + hz * along + hx * lateral,
          dx: Math.cos(angle), dz: Math.sin(angle), age: 0, life, travel, height,
          size: pick(look.size, r(7)),
          length: look.droplet && look.length ? pick(look.length, r(7)) : 0,
          alpha: pick(look.alpha, hash(event, 200 + i)),
          r: tint.r * shade, g: tint.g * shade, b: tint.b * shade,
        });
      }
      dirty = true;
      return count;
    },
    /**
     * Ages on SIMULATION time: hit-stop and pause pass zero and everything holds exactly where it was,
     * which is the opposite of `impactEffects` on purpose - a footfall is part of the world, not an
     * accent on a blow. A zero step is a no-op unless an emission is waiting to be written.
     */
    update(dt: number, camera: THREE.Quaternion) {
      const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
      if (step === 0 && !dirty) return;
      right.set(1, 0, 0).applyQuaternion(camera); up.set(0, 1, 0).applyQuaternion(camera); toViewer.set(0, 0, 1).applyQuaternion(camera);
      if (step > 0) for (const p of particles) { if (!p.alive) continue; p.age += step; if (p.age >= p.life) p.alive = false; }
      write();
    },
    /** Development A/B: draw the identical instant with and without the batch. Never touches a particle. */
    setEnabled(next: boolean) { enabled = next; mesh.visible = enabled && live > 0; },
    /** `clear` plus the scatter serial, for a restart: the next run replays the first one's flecks. */
    reset() { clear(); serial = 0; births = 0; enabled = true; toViewer.copy(DEFAULT_VIEW); },
    /** Every live particle's current state, for tests and diagnostics. */
    particles(): FootstepParticle[] {
      return particles.filter(p => p.alive).map(p => { const s = sample(p, { ...scratch }); return { x: s.x, y: s.y, z: s.z, ox: p.ox, oy: p.oy, oz: p.oz, width: s.width, length: s.length, alpha: s.alpha, age: p.age, life: p.life, droplet: p.droplet }; });
    },
    /** Owns exactly one geometry and one material; takes itself out of the scene first so a generic
     * traversal never disposes them a second time. */
    dispose() { group.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
