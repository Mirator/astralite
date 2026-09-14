// The two rules that decide whether a blow connects and how much of it lands.
// Kept free of React, the DOM and three.js so node can execute them directly,
// and imported by the running game so tests exercise production rules rather
// than a copy of them.

import { hasClearPath } from './dungeon-floor.ts';
import { PLAYER_ATTACK_ANTICIPATION, PLAYER_ATTACK_DURATION } from './dungeon-attack-pose.ts';

export type Spot = { x: number; z: number };

/**
 * Whether one sword swing reaches a body: inside the arc's radius, inside its
 * angle, and with nothing in between. `facing` must be a normalised horizontal
 * vector; `reach` is the Long Guard bonus, 0 without it.
 */
export function swordContacts(
  cells: Set<string>,
  from: Spot,
  facing: Spot,
  target: Spot,
  reach: number,
) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (!(distance < 1.8 + reach)) return false;
  // Three.js normalises a zero-length vector to zero rather than dividing by
  // zero, which is what keeps a body standing exactly on the knight out of arc.
  const scale = distance || 1;
  if ((dx / scale) * facing.x + (dz / scale) * facing.z <= 0.35 - reach * 0.12) {
    return false;
  }
  // Last, because it is the expensive one: the same lane check a skeleton has
  // to pass to swing at the knight. A wall stops steel in both directions.
  return hasClearPath(cells, from, target);
}

/**
 * Whether a dash may abort the current swing. `attackTime` is the seconds of swing left, 0 when idle.
 * Only the anticipation can be aborted: once the blade is live the swing is a commitment, and a dash
 * pressed during it waits for the recovery to end rather than cutting it short. Before this a dash
 * cancelled any swing at any point for free, so committing to an attack never cost anything and the
 * only timing that mattered was the enemy's.
 */
export const canAbortSwing = (attackTime: number) =>
  attackTime <= 0 || attackTime > PLAYER_ATTACK_DURATION - PLAYER_ATTACK_ANTICIPATION;

/**
 * How long a dash pressed into a live blade waits for the swing to end. Longer than any swing
 * remainder, so a press at the moment of contact is never dropped.
 */
export const DASH_BUFFER = 0.4;

/** What a hit actually costs once the knight's wards are applied. */
export const incomingDamage = (amount: number, guardAgainst: number) =>
  Math.round(amount * guardAgainst);
