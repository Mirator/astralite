import { sampleSurface, type SurfaceIndex } from './dungeon-surface.ts';

/**
 * Pure rules for plan 008's footstep feedback: WHEN a foot lands and WHAT it lands on. No three.js,
 * no DOM - `dungeon-game.tsx` owns the rig and the particle batch and only asks these two questions.
 *
 * A footfall is not a new clock. It is the exact crossing the game already plays its step sound on,
 * `Math.floor((phase + PI/2) / PI)` changing between the previous and the current walk phase, and the
 * walk phase itself only advances with distance actually travelled on the ground (see
 * `dungeon-run-pose.ts`). So a wall that stops the body, a dash, a hit-stop freeze or a paused frame
 * cannot produce a contact, because none of them moves the phase.
 */

/** The contact count the game's own step audio keys off. */
export const contactCount = (phase: number) => Math.floor((phase + Math.PI / 2) / Math.PI);

/**
 * At most this many footfalls from a single update. An ordinary sub-step (<= 1/60 s at a sprint)
 * moves the phase by about 0.42 rad, far under one crossing per PI, so this only ever bites on an
 * abnormally long delta - and there it stops a catch-up burst rather than replaying every step.
 */
export const MAX_FOOTFALLS_PER_UPDATE = 2;

/**
 * Which leg is the landing one. `playerRunPose` drives legs[0] with `sin(phase)` and legs[1] with
 * `sin(phase + PI)`, and a positive hip angle swings the foot toward the rig's own forward -Z. Count n
 * is entered at phase `n*PI - PI/2`: odd n puts legs[0] at full forward extension (knee straight,
 * `cos(phase)=0`) - the heel strike - and even n puts legs[1] there.
 */
export const landingLeg = (count: number): 0 | 1 => (((count % 2) + 2) % 2 === 1 ? 0 : 1);

export type Footfall = { count: number; side: 0 | 1 };

/**
 * The footfalls between two walk phases, oldest first, capped. `dashing`, a frozen (`dt <= 0`) update
 * and an update that travelled nowhere never produce one, even if a caller hands in a phase change:
 * the game already holds the phase still in all three cases, and this says so explicitly rather than
 * relying on it.
 */
export function footfalls(previous: number, current: number, motion: { dashing: boolean; dt: number; travelled: number }, cap = MAX_FOOTFALLS_PER_UPDATE): Footfall[] {
  if (motion.dashing || !(motion.dt > 0) || !(motion.travelled > 0)) return [];
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return [];
  const from = contactCount(previous), to = contactCount(current);
  if (to === from) return [];
  const out: Footfall[] = [];
  // Newest crossings are the ones that belong to the pose being drawn, so a capped burst keeps those.
  for (let count = Math.max(from + 1, to - cap + 1); count <= to; count++) out.push({ count, side: landingLeg(count) });
  return out;
}

export type FootstepKind = 'keep' | 'ruins' | 'flooded';
export type FootstepSupport = { kind: FootstepKind; cell: string; y: number };

/**
 * What a planted boot at world `(x, z)` is standing on, for feedback purposes only. Null - no effect -
 * when there is no support under the sole (a seam, the floor's edge, a hole), when the support is
 * wood (no dust off a bridge, and no invented splinters), or when the cell is not one of this floor's
 * own tiles. The theme is the TILE's, per `dungeon-surface.ts`'s metadata (the room that owns the
 * cell, else the nearest chamber - the rule the paving material itself was chosen by), never the
 * global mood, which is still cross-fading while a boot stands on a threshold.
 */
export function footSupport(index: SurfaceIndex | null, x: number, z: number): FootstepSupport | null {
  if (!index || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const hit = sampleSurface(index, x, z);
  if (!hit || hit.wood || !index.meta.has(hit.cell)) return null;
  return { kind: hit.theme, cell: hit.cell, y: hit.y };
}
