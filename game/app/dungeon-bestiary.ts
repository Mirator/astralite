// Every kind of body the keep can field, and everything that tells one kind from another, in one table.
// Before this, a kind was a string compared against in a dozen files - `kind === 'warden'` for the shove,
// the blood, the bar height, the swing, the fall - so a fourth kind meant finding all of them and a missed
// one failed silently. Each entry here is a `Record<EnemyKind, ...>` row, so a new kind that forgets a
// field does not compile, and every file that used to branch on a name reads the property instead.
//
// Pure data: no imports, so the rules, the floor generator, the balance sim and the renderer can all read
// it. `dungeon-enemy.ts` owns what the numbers mean; this owns only which numbers each kind has.
//
// Adding a kind, in the order the archer went in. The compiler finds the first three for you: a row here;
// its figure (`skeletonSpec` and `PALETTE` in dungeon-skeleton.ts); its cutaway ellipse
// (dungeon-occlusion.ts). It does not find the rest: a share in `PACK_MIX` (dungeon-floor.ts) or it is
// never dealt; a branch in `decideEnemy` and `enemyPose` if its attack or pose style is new; the balance
// sim's dodge policy for that attack (scripts/balance/sim.ts); node tests for the rule, and a browser test
// that the running game is wired to it; then `npm run figures` to look at it, `?arena=<kind>:3` to fight it
// (tests/README.md, The arena), and `npm run balance:check`.

export const ENEMY_KINDS = ['guard', 'stalker', 'warden', 'archer'] as const;
export type EnemyKind = typeof ENEMY_KINDS[number];

/** Vitality, damage per blow, seconds of tell, and walking speed - the floor-one values. */
export type EnemyStats = { hp: number; damage: number; tell: number; speed: number };

/**
 * How a tell resolves. `swing` tests the knight against the blow's reach on the frame the tell runs out;
 * `pounce` turns the tell into a lunge that connects on contact; `volley` looses a bolt along the aim,
 * which then has to fly to him (dungeon-projectile.ts) and can be stepped out of or dashed through.
 */
export type Attack = 'swing' | 'pounce' | 'volley';

/** Which body the pose drives: a cut across the body, a hammer over the crown, a crouch and leap, or a bow drawn. */
export type PoseStyle = 'cut' | 'overhead' | 'pounce' | 'draw';

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
  /** The first floor it can be drawn into a pack on. Before that, its share of a pack goes to guards. */
  firstFloor: number;
  /** It backs away from the knight while inside this and recovering; 0 for a body that never gives ground. */
  keepAway: number;
  /** What a `volley` looses: units a second and seconds of flight. Absent for every other attack. */
  bolt?: { speed: number; flight: number };
  /** What the renderer needs to draw it - plain numbers, so this file stays free of three.js. */
  look: {
    pose: PoseStyle;
    /** The body's scale, which the corpse keeps. */
    scale: [number, number, number];
    /** The telegraph on the floor: an arc that closes on the body, or a lane (length, width) along the line it attacks down. */
    cue: { shape: 'arc' } | { shape: 'lane'; length: number; width: number };
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
    attack: 'swing', steadfast: false, advanceBelow: Infinity, firstFloor: 1, keepAway: 0,
    look: {
      pose: 'cut', scale: [1, 1, 1], cue: { shape: 'arc' }, cueScale: 1, barLift: 2.05, alertLift: 2.55, barColor: 0xe89a79, gait: .48, blood: 1, heavy: false,
      trail: { from: 'weapon', color: 0xffd39b, width: .095, inner: [0, 0, -.24], tip: [0, 0, -.86] },
      death: { duration: .7, prone: false, weaponX: .53 }, shieldArm: true,
    },
  },
  stalker: {
    stats: { hp: 2 * 4, damage: 8, tell: 0.58, speed: 3.2 },
    strikeRange: 1.55, attackRange: 4.2, holdRange: 1.15, recovery: 1.7,
    // Late in its recovery a stalker stands still rather than trotting in with a pounce it cannot throw.
    attack: 'pounce', steadfast: false, advanceBelow: 0.9, firstFloor: 1, keepAway: 0,
    look: {
      pose: 'pounce', scale: [.94, 1, .94], cue: { shape: 'lane', length: 5, width: 1.7 }, cueScale: 1, barLift: 2.05, alertLift: 2.55, barColor: 0xe89a79, gait: .48, blood: 1, heavy: false,
      trail: { from: 'claws', color: 0xffcc90, width: .095, inner: [0, -.72, -.12], tip: [0, -.87, -.5] },
      death: { duration: .55, prone: true, weaponX: .53 }, shieldArm: false,
    },
  },
  warden: {
    stats: { hp: 4 * 4, damage: 20, tell: 0.72, speed: 1.65 },
    strikeRange: 2.55, attackRange: 2.2, holdRange: 2.0, recovery: 1.6,
    attack: 'swing', steadfast: true, advanceBelow: Infinity, firstFloor: 1, keepAway: 0,
    look: {
      pose: 'overhead', scale: [1.3, 1.3, 1.3], cue: { shape: 'arc' }, cueScale: 1.7, barLift: 2.65, alertLift: 3.15, barColor: 0xffb65f, gait: .28, blood: 1.4, heavy: true,
      trail: { from: 'weapon', color: 0xffa15c, width: .13, inner: [0, 0, -.24], tip: [0, 0, -1.2] },
      death: { duration: .95, prone: false, weaponX: .72 }, shieldArm: false,
    },
  },
  // The one body that answers a knight who stands still. Every other kind has to reach him; this one
  // holds off at range and punishes a swing that roots him - the two heaviest arms crawl at 1.4 and 1.8
  // mid-swing - while a knight who keeps moving walks out of every bolt. Frail, so reaching it is the
  // answer, and it gives ground while it recovers so reaching it takes a decision rather than a walk.
  // Its lane follows the knight for most of the tell and locks for the last AIM_LOCK of it
  // (dungeon-enemy.ts), which is what makes the dodge a read rather than a coin flip.
  // Floor two onward: floor one teaches the melee kinds before anything shoots.
  archer: {
    stats: { hp: 1.5 * 4, damage: 10, tell: 0.75, speed: 2.3 },
    // strikeRange is the bolt's own reach (speed x flight), which is what a threatened knight measures.
    strikeRange: 13 * 0.7, attackRange: 7, holdRange: 7, recovery: 1.6,
    attack: 'volley', steadfast: false, advanceBelow: Infinity, firstFloor: 2, keepAway: 3.5,
    bolt: { speed: 13, flight: 0.7 },
    look: {
      pose: 'draw', scale: [.96, 1, .96], cue: { shape: 'lane', length: 7, width: 1.1 }, cueScale: 1, barLift: 2.05, alertLift: 2.55, barColor: 0xe89a79, gait: .48, blood: .9, heavy: false,
      trail: { from: 'weapon', color: 0xffd39b, width: .07, inner: [0, 0, 0], tip: [0, 0, -.5] },
      death: { duration: .65, prone: false, weaponX: .53 }, shieldArm: false,
    },
  },
};

/** One field of every archetype, keyed by kind - how the per-quantity tables in dungeon-enemy.ts are read. */
export const byKind = <T>(read: (archetype: Archetype) => T) =>
  Object.fromEntries(ENEMY_KINDS.map(kind => [kind, read(BESTIARY[kind])])) as Record<EnemyKind, T>;
