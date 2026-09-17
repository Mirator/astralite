// What the knight is holding, as numbers.
//
// A weapon in this engine is exactly the set of constants the swing used to hardcode: how long the
// blade takes, when it is live, how far and how wide it reaches, what it costs the body it lands on,
// how fast the knight may walk while swinging, and how hard the blow shoves. Collecting them here is
// what lets a second weapon exist at all — before this they were module constants in three files and
// two literals in the game loop.
//
// Kept free of React, the DOM and three.js so node can execute it directly: dungeon-combat and
// dungeon-attack-pose both read from it, and both are on the pure side of the line.

export type WeaponId = 'tideblade';

export type Weapon = {
  id: WeaponId;
  /** Shown on the pickup notice and in the pause card. */
  name: string;
  /** One line of trade-off, in the game's voice. */
  detail: string;
  /** Seconds from the first frame of the swing to the knight's guard. */
  duration: number;
  /** Seconds of wind-back before the blade is live. A dash may still abort inside this. */
  anticipation: number;
  /** Seconds from the swing's start to the last live frame. Between the two the swing is committed. */
  contactEnd: number;
  /** How far the blade reaches, before Long Guard adds to it. */
  reach: number;
  /**
   * How wide the arc is, as the cosine the body must beat: 1 is straight ahead and 0 is a half-circle.
   * Lower is wider. Long Guard widens it further, and a swing already hits every body inside the arc,
   * so this — not target count — is what separates a sweeping weapon from a thrusting one.
   */
  arc: number;
  /** Vitality a clean hit takes, before Whetted Edge adds to it. */
  damage: number;
  /** How fast the knight may walk while the swing runs, against 8.5 unthreatened. */
  moveSpeed: number;
  /** How far a landed blow shoves an ordinary body, and a warden, which plants itself. */
  knockback: number;
  wardenKnockback: number;
};

/**
 * The knight's own sword, and the shape every other arm is measured against. These are the values the
 * swing carried as constants before weapons existed, unchanged: a run holding the Tideblade plays
 * exactly as it did.
 */
export const TIDEBLADE: Weapon = {
  id: 'tideblade',
  name: 'Tideblade',
  detail: 'The blade you came in with. Even in every way.',
  duration: 0.38,
  anticipation: 0.065,
  contactEnd: 0.175,
  reach: 1.8,
  arc: 0.35,
  damage: 1,
  moveSpeed: 3.2,
  knockback: 0.38,
  wardenKnockback: 0.1,
};

export const WEAPONS: Record<WeaponId, Weapon> = { tideblade: TIDEBLADE };

/** What the knight starts a descent holding. */
export const STARTING_WEAPON: WeaponId = 'tideblade';

/** Falls back to the Tideblade, so a stale saved id or a bad test fixture cannot leave the knight unarmed. */
export const weaponById = (id: string): Weapon => WEAPONS[id as WeaponId] ?? TIDEBLADE;
