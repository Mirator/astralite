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

export type WeaponId = 'tideblade' | 'fangs' | 'spear' | 'cleaver' | 'maul' | 'crossbow' | 'flask';

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
  /**
   * Vitality a clean hit takes, before Whetted Edge adds to it. Quoted in the same quarter-hit grain
   * as enemy vitality (dungeon-enemy's HIT), so 4 is one blow of the starting blade.
   */
  damage: number;
  /** How fast the knight may walk while the swing runs, against 8.5 unthreatened. */
  moveSpeed: number;
  /** How far a landed blow shoves an ordinary body, and a warden, which plants itself. */
  knockback: number;
  wardenKnockback: number;
  /**
   * Whether a blow can knock a warden out of its own committed swing. Ordinary steel never can — see
   * interruptsWindup in dungeon-enemy — so this is the one thing on the table that is a rule rather
   * than a number, and it is the only answer the knight has to the body that deals most of his damage.
   */
  stagger: boolean;
  /**
   * Present only on an arm that throws something. The knight walks at 8.5 and the fastest thing in the
   * keep is a stalker at 3.2, so nothing here can reach him if he simply backs away while shooting: a
   * ranged arm that recovered on a timer would beat the whole game by walking backwards. What limits it
   * is a quiver that runs dry and comes back slowly, plus a recovery long enough that firing is a
   * commitment — `moveSpeed` and `contactEnd` are what pay for the range.
   */
  ranged?: {
    /** Units a second the shot travels. */
    speed: number;
    /** Seconds of flight before it falls. Range is speed times this. */
    flight: number;
    /** Bodies one shot passes through beyond the first. */
    pierce: number;
    /** Shots in hand at full, and how many seconds one takes to come back. */
    capacity: number;
    refill: number;
  };
  /**
   * What the shot leaves on the ground where it stops, for an arm that denies a place rather than
   * killing a body. The fire bills once every `interval` and burns for `life`, so what it is worth is
   * decided by whether anything has to walk through it — which is a question about the room, not about
   * the knight's aim.
   */
  burst?: { radius: number; life: number; damage: number; interval: number };
  /**
   * Beats after the first, for an arm that swings a string rather than the same cut over and over.
   *
   * Absent means one repeating swing, which is what every arm did and what five of the seven still do.
   * A beat is an overlay on the weapon itself rather than a new kind of object: everything downstream
   * of a swing — `swordContacts`, `canAbortSwing`, `playerAttackPose`, `playerSpeed` — already takes a
   * Weapon, so a beat that *is* a Weapon needs no new plumbing anywhere. `beatOf` applies it.
   *
   * What a chain is for: holding the strike key used to restart an identical swing forever, so holding
   * it was strictly optimal and the input carried no rhythm at all. A string gives the held key a
   * shape, and puts the cost on the last beat, which is the one that commits.
   */
  chain?: {
    /** Seconds after a swing ends within which the next strike continues the string. */
    window: number;
    beats: Partial<Weapon>[];
  };
};

/**
 * The weapon a given beat of a string swings as. Beat 0 is the arm itself; later beats overlay it.
 * An index past the end holds the last beat rather than falling off, so a caller cannot produce a
 * swing with no numbers.
 */
export const beatOf = (weapon: Weapon, beat: number): Weapon => {
  const beats = weapon.chain?.beats;
  if (!beats?.length || beat <= 0) return weapon;
  return { ...weapon, ...beats[Math.min(beat, beats.length) - 1] };
};

/** How many beats the string has, counting the arm's own swing as the first. */
export const chainLength = (weapon: Weapon) => 1 + (weapon.chain?.beats.length ?? 0);

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
  damage: 4,
  moveSpeed: 3.2,
  knockback: 0.38,
  wardenKnockback: 0.1,
  stagger: false,
  /**
   * Back-cut, then a two-handed finish. The second beat is the first one mirrored and costs nothing
   * extra — it is there so the string reads as a string rather than as one cut on repeat. The third
   * is where the cost and the payoff both are: half again as long, rooted nearly to the spot, and
   * wide enough to take a second body with it. Its contact window is the longest of the three, and
   * `canAbortSwing` already refuses a dash inside contact, so committing to it is a real decision
   * rather than a number.
   */
  chain: {
    window: 0.26,
    beats: [
      { duration: 0.36, anticipation: 0.06, contactEnd: 0.17, damage: 4, arc: 0.32 },
      {
        duration: 0.56, anticipation: 0.14, contactEnd: 0.3,
        damage: 7, arc: 0.12, reach: 1.95, moveSpeed: 1.9,
        knockback: 0.62, wardenKnockback: 0.18,
      },
    ],
  },
};

/**
 * Inside a guard's reach, and nowhere else. The shortest blade in the keep and the only one the knight
 * can nearly walk at full speed while swinging: it lives past the 1.5 a guard commits from, so every
 * exchange is taken on the guard's terms and won on rate.
 */
export const TWIN_FANGS: Weapon = {
  id: 'fangs',
  name: 'Twin Fangs',
  detail: 'Quick and short. You have to be inside their guard.',
  duration: 0.22,
  anticipation: 0.04,
  contactEnd: 0.1,
  reach: 1.4,
  arc: 0.45,
  damage: 3,
  moveSpeed: 5.2,
  knockback: 0.18,
  wardenKnockback: 0.05,
  stagger: false,
  /**
   * The same three beats as the sword, at the knives' own rate. The finish is a cross-cut rather than
   * a heave: it does less than the Tideblade's and takes less time to be caught inside, which is the
   * trade the whole arm is built on.
   */
  chain: {
    window: 0.22,
    beats: [
      { duration: 0.21, anticipation: 0.04, contactEnd: 0.1, damage: 3, arc: 0.42 },
      {
        duration: 0.36, anticipation: 0.085, contactEnd: 0.21,
        damage: 5, arc: 0.22, moveSpeed: 3.4, knockback: 0.3,
      },
    ],
  },
};

/**
 * Reaches 2.6, which is past the 2.55 a warden's hammer covers: the one arm that can work the keep's
 * heaviest body without standing in its swing. The arc is a thrust, so a second guard arriving from the
 * side is a problem the spear cannot answer.
 */
export const SALT_SPEAR: Weapon = {
  id: 'spear',
  name: 'Salt Spear',
  detail: 'Long and narrow. Reaches past a hammer; answers only what it faces.',
  duration: 0.28,
  anticipation: 0.05,
  contactEnd: 0.12,
  reach: 2.6,
  arc: 0.78,
  damage: 3,
  moveSpeed: 4.4,
  knockback: 0.15,
  wardenKnockback: 0.05,
  stagger: false,
};

/**
 * A half-circle of edge. A swing already reaches every body inside its arc, so what a wide weapon buys
 * is the whole front rank at once — and it is paid for in a swing that nearly roots the knight and a
 * live blade he cannot dash out of for 0.16s. It does not stagger: carrying the arc, the shove and a
 * warden interrupt at once measured at 10% of the knight's damage coming from wardens against 78% for
 * the starting sword, which is not a trade-off, it is simply the best arm.
 */
export const WARDENS_CLEAVER: Weapon = {
  id: 'cleaver',
  name: "Warden's Cleaver",
  detail: 'Slow and enormous. Takes the whole front rank and shoves it off you.',
  duration: 0.62,
  anticipation: 0.14,
  contactEnd: 0.3,
  reach: 2.2,
  arc: 0,
  damage: 7,
  moveSpeed: 1.6,
  knockback: 0.9,
  wardenKnockback: 0.15,
  stagger: false,
};

/**
 * The slowest arm and the only other one that staggers. Where the cleaver buys a rank, the maul buys a
 * single enormous blow: a floor-one warden falls in two, and the swing it was winding up falls with it.
 */
export const BELL_MAUL: Weapon = {
  id: 'maul',
  name: 'Bell Maul',
  detail: 'Ruinous and slow. A warden does not finish the swing you interrupt.',
  // 0.66 rather than the 0.74 this started at. A warden's tell is 0.72s and a swing only breaks it
  // while more than COMMITTED_WINDUP (0.3s) of that tell remains, so the blow has to land inside the
  // first 0.42s: at 0.74s of swing the maul could not reliably arrive in time and measured identically
  // to a plain sword against wardens, which is the one body it exists to answer.
  duration: 0.66,
  anticipation: 0.15,
  contactEnd: 0.32,
  reach: 2,
  arc: 0.05,
  damage: 9,
  moveSpeed: 1.1,
  knockback: 0.7,
  wardenKnockback: 0.35,
  stagger: true,
};

/**
 * The only arm that works at a distance, and the only one that can be left useless. Four bolts, one
 * back every 1.8s: a knight who backs away firing runs dry long before a warden runs out of patience,
 * and a dry crossbow has a 0.2 reach and nothing to swing. Firing roots him at 1.4 against 8.5 walking,
 * and the 0.36s the bolt is leaving cannot be dashed out of. Measured against the melee arms it is the
 * slowest descent in the keep at 6.6 minutes against 5.4, and the only arm that loses runs at all.
 */
export const KEEP_CROSSBOW: Weapon = {
  id: 'crossbow',
  name: 'Keep Crossbow',
  detail: 'Four bolts, slow to come back. Useless the moment the quiver is dry.',
  duration: 0.86,
  anticipation: 0.22,
  contactEnd: 0.36,
  // Not a swing. The bolt leaves from here, so the arc only has to cover the notch it leaves through.
  reach: 0.2,
  arc: 0.9,
  damage: 9,
  moveSpeed: 1.4,
  knockback: 0.25,
  wardenKnockback: 0.1,
  stagger: false,
  ranged: { speed: 19, flight: 0.62, pierce: 1, capacity: 4, refill: 1.8 },
};

/**
 * The only arm that does not point at anything. A flask arcs six units and breaks into burning silt
 * that bites once every half second for two and a half, which kills nothing outright above a guard and
 * is not meant to: what it buys is a doorway nothing wants to come through, and time to meet whatever
 * does one body at a time. Two charges, and they come back slowly enough that it cannot simply be laid
 * down in front of every fight. At two charges and a six-second refill it measured at 11.5 minutes a
 * descent against 5.5 for the starting sword, which is a slog rather than a weapon; three and three is
 * 6.2, between the melee arms and the crossbow, which is where a second ranged arm belongs.
 */
export const TIDEFLASK: Weapon = {
  id: 'flask',
  name: 'Tideflask',
  detail: 'Thrown. Breaks into burning silt that nothing wants to cross.',
  duration: 0.7,
  anticipation: 0.18,
  contactEnd: 0.3,
  reach: 0.2,
  arc: 0.9,
  // The flask itself does nothing on contact. Everything it is worth is in what it leaves behind.
  damage: 0,
  moveSpeed: 1.8,
  knockback: 0,
  wardenKnockback: 0,
  stagger: false,
  ranged: { speed: 11, flight: 0.55, pierce: 0, capacity: 3, refill: 3 },
  burst: { radius: 2.2, life: 2.5, damage: 8, interval: 0.5 },
};

export const WEAPONS: Record<WeaponId, Weapon> = {
  tideblade: TIDEBLADE,
  crossbow: KEEP_CROSSBOW,
  flask: TIDEFLASK,
  fangs: TWIN_FANGS,
  spear: SALT_SPEAR,
  cleaver: WARDENS_CLEAVER,
  maul: BELL_MAUL,
};

/** Every arm but the one the knight starts with, which is what a drop on the floor is drawn from. */
export const FOUND_WEAPONS: WeaponId[] = ['fangs', 'spear', 'cleaver', 'maul', 'crossbow', 'flask'];

/** What the knight starts a descent holding. */
export const STARTING_WEAPON: WeaponId = 'tideblade';

/** Falls back to the Tideblade, so a stale saved id or a bad test fixture cannot leave the knight unarmed. */
export const weaponById = (id: string): Weapon => WEAPONS[id as WeaponId] ?? TIDEBLADE;
