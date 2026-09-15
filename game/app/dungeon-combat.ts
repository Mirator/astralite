// The two rules that decide whether a blow connects and how much of it lands.
// Kept free of React, the DOM and three.js so node can execute them directly,
// and imported by the running game so tests exercise production rules rather
// than a copy of them.

import { hasClearPath } from './dungeon-floor.ts';
import { PLAYER_ATTACK_ANTICIPATION, PLAYER_ATTACK_CONTACT_END, PLAYER_ATTACK_DURATION } from './dungeon-attack-pose.ts';

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
 * The blade is live from the end of the anticipation to the end of contact, and that window is a
 * commitment: a dash pressed inside it waits for contact to end. Anticipation and recovery both give
 * way at once. Before this a dash cancelled any swing at any point for free, so committing to an attack
 * never cost anything; then for one release the whole 0.38s swing was locked, which with a held strike
 * key meant a dodge fired up to 0.3s late and a guard's 0.5s tell landed more often than not. Locking
 * only the 0.11s of contact keeps the cost of swinging into a tell without punishing holding the key.
 */
export const canAbortSwing = (attackTime: number) => {
  if (attackTime <= 0) return true;
  const age = PLAYER_ATTACK_DURATION - attackTime;
  return age < PLAYER_ATTACK_ANTICIPATION || age >= PLAYER_ATTACK_CONTACT_END;
};

/**
 * How long a dash pressed into a live blade waits for contact to end. Longer than the contact window,
 * so a press at the first live frame is never dropped.
 */
export const DASH_BUFFER = 0.4;

/** What a hit actually costs once the knight's wards are applied. */
export const incomingDamage = (amount: number, guardAgainst: number) =>
  Math.round(amount * guardAgainst);
