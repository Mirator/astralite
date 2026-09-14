// The two rules that decide whether a blow connects and how much of it lands.
// Kept free of React, the DOM and three.js so node can execute them directly,
// and imported by the running game so tests exercise production rules rather
// than a copy of them.

import { hasClearPath } from './dungeon-floor.ts';

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

/** What a hit actually costs once the knight's wards are applied. */
export const incomingDamage = (amount: number, guardAgainst: number) =>
  Math.round(amount * guardAgainst);
