// Every kind of body the keep can field, and everything that tells one kind from another, in one table.
// Before this, a kind was a string compared against in a dozen files - `kind === 'warden'` for the shove,
// the blood, the bar height, the swing, the fall - so a fourth kind meant finding all of them and a missed
// one failed silently. Each entry here is a `Record<EnemyKind, ...>` row, so a new kind that forgets a
// field does not compile, and every file that used to branch on a name reads the property instead.
//
// Pure data: no imports, so the rules, the floor generator, the balance sim and the renderer can all read
// it. `dungeon-enemy.ts` owns what the numbers mean; this owns only which numbers each kind has.

export const ENEMY_KINDS = ['guard', 'stalker', 'warden'] as const;
export type EnemyKind = typeof ENEMY_KINDS[number];

/** Vitality, damage per blow, seconds of tell, and walking speed - the floor-one values. */
export type EnemyStats = { hp: number; damage: number; tell: number; speed: number };

/**
 * How a tell resolves. `swing` tests the knight against the blow's reach on the frame the tell runs out;
 * `pounce` turns the tell into a lunge that connects on contact.
 */
export type Attack = 'swing' | 'pounce';

/** Which body the pose drives: a cut across the body, a hammer over the crown, or a crouch and leap. */
export type PoseStyle = 'cut' | 'overhead' | 'pounce';

export type Archetype = {
  stats: EnemyStats;
  /** How far a committed blow reaches. */
  strikeRange: number;
  /** How far away it starts winding one up; the gap to `strikeRange` is the telegraph. */
  attackRange: number;
  /** Inside this it stands its ground rather than shuffling into the knight's chest. */
  holdRange: number;
  /** Seconds of recovery after a blow lands or misses. */
  recovery: number;
  attack: Attack;
  /**
   * Plants itself: ordinary steel never breaks its committed swing, and a blow shoves it by the weapon's
   * `wardenKnockback` rather than its `knockback`. Only a stagger arm breaks the tell.
   */
  steadfast: boolean;
  /** It will not walk in while its cooldown is at or above this; Infinity for a body that always closes. */
  advanceBelow: number;
  /** What the renderer needs to draw it - plain numbers, so this file stays free of three.js. */
  look: {
    pose: PoseStyle;
    /** The body's scale, which the corpse keeps. */
    scale: [number, number, number];
    /** The telegraph on the floor: an arc that closes on the body, or a lane along the line it leaps. */
    cue: 'arc' | 'lane';
    /** Multiplies the telegraph's size, so a longer reach draws a larger mark. */
    cueScale: number;
    /** Heights above the feet of the health bar and of the alert glyph. */
    barLift: number;
    alertLift: number;
    barColor: number;
    /** How far the legs swing in the walk cycle. */
    gait: number;
    /** Size of the blood a blow leaves, and whether the impact is the heavy one. */
    blood: number;
    heavy: boolean;
    /** The ribbon a blow draws: off the weapon or off both claws, in this colour and width. */
    trail: { from: 'weapon' | 'claws'; color: number; width: number; inner: [number, number, number]; tip: [number, number, number] };
    /** The fall: how long it takes, whether it goes face down, and where the dropped weapon lies. */
    death: { duration: number; prone: boolean; weaponX: number };
    /** The guard carries its shield arm tucked across the body. */
    shieldArm: boolean;
  };
};

// Vitality is quoted in quarter-hits of a starting blade (see HIT in dungeon-enemy.ts); the literal 4 is
// that HIT, spelled out so this file needs nothing from it.
export const BESTIARY: Record<EnemyKind, Archetype> = {
  guard: {
    stats: { hp: 2 * 4, damage: 12, tell: 0.5, speed: 2.2 },
    strikeRange: 1.55, attackRange: 1.5, holdRange: 1.15, recovery: 1.25,
    attack: 'swing', steadfast: false, advanceBelow: Infinity,
    look: {
      pose: 'cut', scale: [1, 1, 1], cue: 'arc', cueScale: 1, barLift: 2.05, alertLift: 2.55, barColor: 0xe89a79, gait: .48, blood: 1, heavy: false,
      trail: { from: 'weapon', color: 0xffd39b, width: .095, inner: [0, 0, -.24], tip: [0, 0, -.86] },
      death: { duration: .7, prone: false, weaponX: .53 }, shieldArm: true,
    },
  },
  stalker: {
    stats: { hp: 2 * 4, damage: 8, tell: 0.58, speed: 3.2 },
    strikeRange: 1.55, attackRange: 4.2, holdRange: 1.15, recovery: 1.7,
    // Late in its recovery a stalker stands still rather than trotting in with a pounce it cannot throw.
    attack: 'pounce', steadfast: false, advanceBelow: 0.9,
    look: {
      pose: 'pounce', scale: [.94, 1, .94], cue: 'lane', cueScale: 1, barLift: 2.05, alertLift: 2.55, barColor: 0xe89a79, gait: .48, blood: 1, heavy: false,
      trail: { from: 'claws', color: 0xffcc90, width: .095, inner: [0, -.72, -.12], tip: [0, -.87, -.5] },
      death: { duration: .55, prone: true, weaponX: .53 }, shieldArm: false,
    },
  },
  warden: {
    stats: { hp: 4 * 4, damage: 20, tell: 0.72, speed: 1.65 },
    strikeRange: 2.55, attackRange: 2.2, holdRange: 2.0, recovery: 1.6,
    attack: 'swing', steadfast: true, advanceBelow: Infinity,
    look: {
      pose: 'overhead', scale: [1.3, 1.3, 1.3], cue: 'arc', cueScale: 1.7, barLift: 2.65, alertLift: 3.15, barColor: 0xffb65f, gait: .28, blood: 1.4, heavy: true,
      trail: { from: 'weapon', color: 0xffa15c, width: .13, inner: [0, 0, -.24], tip: [0, 0, -1.2] },
      death: { duration: .95, prone: false, weaponX: .72 }, shieldArm: false,
    },
  },
};

/** One field of every archetype, keyed by kind - how the per-quantity tables in dungeon-enemy.ts are read. */
export const byKind = <T>(read: (archetype: Archetype) => T) =>
  Object.fromEntries(ENEMY_KINDS.map(kind => [kind, read(BESTIARY[kind])])) as Record<EnemyKind, T>;
