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
// never dealt, and for a summoner a reserve, which `buryReserves` (dungeon-floor.ts) lays under it in both
// the generator and the arena; a branch in `decideEnemy` and `enemyPose` if its attack or pose style is new; the balance
// sim's dodge policy for that attack (scripts/balance/sim.ts); node tests for the rule, and a browser test
// that the running game is wired to it; then `npm run figures` to look at it, `?arena=<kind>:3` to fight it
// (tests/README.md, The arena), and `npm run balance:check`.

export const ENEMY_KINDS = ['guard', 'stalker', 'warden', 'archer', 'shieldbearer', 'reaper', 'pyre', 'bonecaller', 'rattler', 'captain', 'mother', 'hound'] as const;
export type EnemyKind = typeof ENEMY_KINDS[number];

/** Vitality, damage per blow, seconds of tell, and walking speed - the floor-one values. */
export type EnemyStats = { hp: number; damage: number; tell: number; speed: number };

/**
 * How a tell resolves. `swing` tests the knight against the blow's reach on the frame the tell runs out;
 * `pounce` turns the tell into a lunge that connects on contact; `volley` looses a bolt along the aim,
 * which then has to fly to him (dungeon-projectile.ts) and can be stepped out of or dashed through;
 * `sweep` is a swing with no aim - everything inside its reach, all the way round; `summon` hurts no one
 * and raises from its buried reserve instead; `scatter` (plan 021, a boss's move only) hurts no one in the
 * tell either: it marks rings on the ground where the knight has been, and when the tell runs out each
 * becomes a fire pool.
 */
export type Attack = 'swing' | 'pounce' | 'volley' | 'sweep' | 'summon' | 'scatter';

/**
 * Which body the pose drives: a cut across the body, a hammer over the crown, a crouch and leap, a bow
 * drawn, a full turn with a long blade, or both arms raised to call.
 */
export type PoseStyle = 'cut' | 'overhead' | 'pounce' | 'draw' | 'spin' | 'channel';

/** The telegraph on the floor: an arc that closes on the body, or a lane (length, width) along the line it attacks down. */
export type Cue = { shape: 'arc' } | { shape: 'lane'; length: number; width: number } | { shape: 'ring'; radius: number };

/**
 * What a `volley` looses: units a second and seconds of flight, and for a boss's move optionally a `fan` - `count` bolts, `spread` radians apart, centred on the aim
 * (`fanHeadings`, dungeon-projectile.ts). One bolt when absent.
 */
export type Bolt = { speed: number; flight: number; fan?: { count: number; spread: number } };

/**
 * One thing a boss can do (plan 021). It carries what a single-attack kind keeps in its row and in `stats`: the
 * attack, the seconds of tell, the damage of a floor-one blow (`strikeDamage` in dungeon-enemy.ts scales it with
 * depth as `enemyStats` scales `stats.damage`), the reach it commits from and the reach it lands within, and the
 * telegraph it draws. `bolt` is what a `volley` looses; `scatter` is how many rings a `scatter` marks and the fire
 * each becomes; `summon` is how many of the reserve a `summon` raises.
 */
export type Move = {
  attack: Attack;
  tell: number;
  damage: number;
  strikeRange: number;
  attackRange: number;
  cue: Cue;
  cueScale: number;
  bolt?: Bolt;
  /**
   * Begins the instant the move before it is spent, with no recovery between and the tell it names here (a short one: a re-aim, not a fresh wind-up), from wherever the
   * knight stands then. The Tide Hound's second pounce. The move before has to be a pounce, so there is a leap to chain from.
   */
  chain?: true;
  scatter?: { rings: number; pool: { radius: number; life: number; damage: number; interval: number } };
  summon?: { perTell: number };
};

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
  bolt?: Bolt;
  /**
   * A shield carried square to the front: a blow whose heading meets the body's facing at worse than this
   * cosine is turned aside (dungeon-hits.ts `blocks`), unless the arm staggers. It is down while the body
   * winds up or recovers from its own swing, which is the opening. A boss's carries `until`: the phase it breaks in (the shield holds
   * while the boss's phase is below it), which is the Bastion's whole change.
   */
  shield?: { arc: number; until?: number };
  /** Fire it leaves where it falls, which bites the knight (dungeon-projectile.ts `deathPool`). */
  deathPool?: { radius: number; life: number; damage: number; interval: number };
  /**
   * Bodies it arrives with buried at its feet, `perTell` of them raised by each `summon` tell. One that
   * falls while the caller stands goes back into the reserve to be raised again; when the caller falls,
   * the reserve crumbles with it (dungeon-enemy.ts `reassembles`).
   */
  summons?: { kind: EnemyKind; count: number; perTell: number };
  /**
   * A boss (plan 021): what it does, one list per phase, in the order it does it. Absent for every ordinary kind, which
   * has the one `attack` above and takes exactly the path it always took. A list is a rotation: `decideEnemy` takes the
   * next move that fits the knight's range and comes back round to the start. Each `Move` replaces `attack`, `stats.tell`,
   * `stats.damage`, `strikeRange`, `attackRange`, `bolt`, the cue and `cueScale` for as long as it is the one being done;
   * everything else in the row (speed, recovery, holding and keeping away, the shield, the figure) is the boss's whole.
   */
  moves?: Move[][];
  /**
   * The share of its vitality below which each later phase begins, one fewer than there are lists in `moves`, falling:
   * `[.5]` is two phases and a change at half. Crossing one is a phase change (`PHASE_CHANGE` in dungeon-enemy.ts).
   */
  phases?: number[];
  /** `pool` bosses are dealt to floors one and two from a pool; the `final` one is the last floor's. Absent for everything else. */
  boss?: 'pool' | 'final';
  /** A boss's name, as the boss bar and the goal chamber's notice say it (plan 021 Stage B). Absent for everything else. */
  title?: string;
  /** What the notice says as each later phase begins, one for each of `phases`. */
  phaseNotice?: string[];
  /** What the renderer needs to draw it - plain numbers, so this file stays free of three.js. */
  look: {
    pose: PoseStyle;
    /** The body's scale, which the corpse keeps. */
    scale: [number, number, number];
    /** The telegraph on the floor: an arc that closes on the body, or a lane (length, width) along the line it attacks down. */
    cue: Cue;
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

  // Each of the five below asks for a response nothing above asks for. The shieldbearer, the pyre and the
  // bonecaller were promoted into the descent by plan 018 (a `firstFloor` and a share in PACK_MIX); the
  // reaper stays arena-only, and the rattler enters only as a bonecaller's reserve and is never dealt alone.
  // Both keep `firstFloor: Infinity`.

  // Turns ordinary steel aside from the front. The opening is its own swing: the shield is down while it
  // winds up and while it recovers, so the answer is to bait the blow, step out of it and punish - or to
  // carry one of the two arms that stagger, which break the guard outright.
  shieldbearer: {
    stats: { hp: 3 * 4, damage: 10, tell: 0.6, speed: 1.9 },
    strikeRange: 1.55, attackRange: 1.5, holdRange: 1.15, recovery: 1.5,
    attack: 'swing', steadfast: false, advanceBelow: Infinity, firstFloor: 2, keepAway: 0,
    shield: { arc: 0.3 },
    look: {
      pose: 'cut', scale: [1.05, 1.05, 1.05], cue: { shape: 'arc' }, cueScale: 1, barLift: 2.15, alertLift: 2.65, barColor: 0xe89a79, gait: .4, blood: 1, heavy: false,
      trail: { from: 'weapon', color: 0xffd39b, width: .095, inner: [0, 0, -.24], tip: [0, 0, -.86] },
      death: { duration: .8, prone: false, weaponX: .53 }, shieldArm: true,
    },
  },
  // A long tell and then everything within reach, all the way round. Circling it - the answer to every
  // other swing - is walking into it; the answer is distance, and the dash covers exactly enough.
  reaper: {
    stats: { hp: 3 * 4, damage: 18, tell: 1.0, speed: 1.9 },
    strikeRange: 2.3, attackRange: 1.9, holdRange: 1.5, recovery: 1.8,
    attack: 'sweep', steadfast: false, advanceBelow: Infinity, firstFloor: Infinity, keepAway: 0,
    look: {
      pose: 'spin', scale: [1.1, 1.1, 1.1], cue: { shape: 'ring', radius: 2.3 }, cueScale: 1, barLift: 2.3, alertLift: 2.8, barColor: 0xe89a79, gait: .36, blood: 1.1, heavy: true,
      trail: { from: 'weapon', color: 0xffc58a, width: .14, inner: [0, 0, -.6], tip: [0, 0, -1.35] },
      death: { duration: .85, prone: false, weaponX: .62 }, shieldArm: false,
    },
  },
  // Weak in its own right; the threat is where it dies. Killing one at arm's length leaves the knight
  // standing in its fire, so the answer is to kill it and step away, or kill it where he is not.
  pyre: {
    stats: { hp: 1.5 * 4, damage: 8, tell: 0.5, speed: 2.4 },
    strikeRange: 1.55, attackRange: 1.5, holdRange: 1.15, recovery: 1.3,
    attack: 'swing', steadfast: false, advanceBelow: Infinity, firstFloor: 2, keepAway: 0,
    deathPool: { radius: 1.7, life: 3.5, damage: 8, interval: 0.6 },
    look: {
      pose: 'cut', scale: [1, 1, 1], cue: { shape: 'arc' }, cueScale: 1, barLift: 2.2, alertLift: 2.7, barColor: 0xffb65f, gait: .48, blood: .9, heavy: false,
      trail: { from: 'weapon', color: 0xff9a4a, width: .1, inner: [0, 0, -.2], tip: [0, 0, -.7] },
      death: { duration: .7, prone: true, weaponX: .53 }, shieldArm: false,
    },
  },
  // Hangs back and calls up the rattlers buried at its feet, two per tell. It never strikes; it is the
  // reason a fight never shrinks. A rattler cut down while it stands goes back into the ground to be called
  // again, so cutting through them is wasted effort: the answer is to reach it, and when it falls every
  // body it called, standing or buried, crumbles with it.
  bonecaller: {
    stats: { hp: 2 * 4, damage: 0, tell: 1.2, speed: 2.2 },
    strikeRange: 0, attackRange: 9, holdRange: 9, recovery: 2.5,
    attack: 'summon', steadfast: false, advanceBelow: Infinity, firstFloor: 3, keepAway: 5,
    summons: { kind: 'rattler', count: 4, perTell: 2 },
    look: {
      pose: 'channel', scale: [1, 1.05, 1], cue: { shape: 'ring', radius: 1.1 }, cueScale: 1, barLift: 2.25, alertLift: 2.75, barColor: 0xe89a79, gait: .4, blood: 1, heavy: false,
      trail: { from: 'weapon', color: 0xbfe8ff, width: .07, inner: [0, 0, 0], tip: [0, 0, -.5] },
      death: { duration: .75, prone: false, weaponX: .53 }, shieldArm: false,
    },
  },
  // Small, quick and gone in one blow of a starting blade; dangerous only in numbers. The answer is an arm
  // with a wide arc. Also what a bonecaller raises, and then it does not stay down while its caller stands.
  rattler: {
    stats: { hp: 1 * 4, damage: 5, tell: 0.38, speed: 3.6 },
    strikeRange: 1.2, attackRange: 1.1, holdRange: .9, recovery: 1.0,
    attack: 'swing', steadfast: false, advanceBelow: Infinity, firstFloor: Infinity, keepAway: 0,
    look: {
      pose: 'cut', scale: [.72, .72, .72], cue: { shape: 'arc' }, cueScale: .8, barLift: 1.55, alertLift: 1.95, barColor: 0xe89a79, gait: .55, blood: .6, heavy: false,
      trail: { from: 'weapon', color: 0xffd39b, width: .07, inner: [0, 0, -.1], tip: [0, 0, -.5] },
      death: { duration: .5, prone: true, weaponX: .45 }, shieldArm: false,
    },
  },
  // The Drowned Captain (plan 021 D4): a huge warden, the first floor's boss until the pool grows. Phase one is two heavy
  // swings and a sweep that takes everything round it; below half it adds a pounce across the room, and then goes round
  // swing, pounce, sweep. Steadfast like the warden it is grown from: only a stagger arm breaks a tell. The numbers are
  // D7's hypothesis (60 vitality) and Stage F's to tune; the moves are the design.
  captain: {
    stats: { hp: 60, damage: 24, tell: 0.8, speed: 1.8 },
    strikeRange: 3.2, attackRange: 2.7, holdRange: 2.4, recovery: 1.5,
    attack: 'swing', steadfast: true, advanceBelow: Infinity, firstFloor: Infinity, keepAway: 0,
    boss: 'pool', title: 'The Drowned Captain', phaseNotice: ['', 'The Captain draws the tide'],
    phases: [.5],
    moves: [
      [
        { attack: 'swing', tell: 0.8, damage: 24, strikeRange: 3.2, attackRange: 2.7, cue: { shape: 'arc' }, cueScale: 2.13 },
        { attack: 'swing', tell: 0.7, damage: 24, strikeRange: 3.2, attackRange: 2.7, cue: { shape: 'arc' }, cueScale: 2.13 },
        { attack: 'sweep', tell: 1.1, damage: 20, strikeRange: 3.6, attackRange: 2.6, cue: { shape: 'ring', radius: 3.6 }, cueScale: 1 },
      ],
      [
        { attack: 'swing', tell: 0.7, damage: 24, strikeRange: 3.2, attackRange: 2.7, cue: { shape: 'arc' }, cueScale: 2.13 },
        { attack: 'pounce', tell: 0.7, damage: 20, strikeRange: 5, attackRange: 5.5, cue: { shape: 'lane', length: 5, width: 2.4 }, cueScale: 1 },
        { attack: 'sweep', tell: 1.0, damage: 20, strikeRange: 3.6, attackRange: 2.6, cue: { shape: 'ring', radius: 3.6 }, cueScale: 1 },
      ],
    ],
    look: {
      pose: 'overhead', scale: [1.7, 1.7, 1.7], cue: { shape: 'arc' }, cueScale: 2.13, barLift: 3.5, alertLift: 4.1, barColor: 0x7fe0c8, gait: .24, blood: 1.8, heavy: true,
      trail: { from: 'weapon', color: 0x9fe8d6, width: .16, inner: [0, 0, -.24], tip: [0, 0, -1.5] },
      death: { duration: 1.2, prone: false, weaponX: .9 }, shieldArm: false,
    },
  },
  // The Pyre Mother (plan 021 D4): the pool's ranged boss, a pyre grown into the thing that lights them. She holds off at range (a pyre's rows of fire are hers to lay) and
  // asks the knight to keep moving: phase one is a fan of three bolts, a fan again, and a scatter that marks two rings where he has been and lights them when the tell
  // runs out. Below half she looses five bolts to the fan, adds a close sweep for a knight who has rushed her (she gives ground while she recovers, so it is a punish and
  // not a place to stand), and scatters twice running, three rings a time. A fan has no gap to walk through: the answer is the dash, or being elsewhere. Steadfast like every
  // boss: only a stagger arm breaks her tell. The numbers are D7's hypothesis (50 vitality) and Stage F's to tune; the moves are the design.
  mother: {
    stats: { hp: 50, damage: 12, tell: 0.8, speed: 2.1 },
    strikeRange: 2.6, attackRange: 8, holdRange: 6, recovery: 1.4,
    attack: 'volley', steadfast: true, advanceBelow: Infinity, firstFloor: Infinity, keepAway: 4,
    boss: 'pool', title: 'The Pyre Mother', phaseNotice: ['', 'The Pyre Mother kindles'],
    phases: [.5],
    moves: [
      [
        { attack: 'volley', tell: 0.8, damage: 12, strikeRange: 9, attackRange: 8, cue: { shape: 'lane', length: 8, width: 4.6 }, cueScale: 1, bolt: { speed: 12, flight: 0.75, fan: { count: 3, spread: 0.2 } } },
        { attack: 'volley', tell: 0.8, damage: 12, strikeRange: 9, attackRange: 8, cue: { shape: 'lane', length: 8, width: 4.6 }, cueScale: 1, bolt: { speed: 12, flight: 0.75, fan: { count: 3, spread: 0.2 } } },
        { attack: 'scatter', tell: 0.9, damage: 0, strikeRange: 0, attackRange: 9, cue: { shape: 'ring', radius: 1.4 }, cueScale: 1, scatter: { rings: 2, pool: { radius: 1.6, life: 2.2, damage: 8, interval: 0.6 } } },
      ],
      [
        { attack: 'volley', tell: 0.7, damage: 10, strikeRange: 9, attackRange: 8, cue: { shape: 'lane', length: 8, width: 6 }, cueScale: 1, bolt: { speed: 12, flight: 0.75, fan: { count: 5, spread: 0.15 } } },
        { attack: 'sweep', tell: 0.9, damage: 16, strikeRange: 2.6, attackRange: 2.3, cue: { shape: 'ring', radius: 2.6 }, cueScale: 1 },
        { attack: 'scatter', tell: 0.9, damage: 0, strikeRange: 0, attackRange: 9, cue: { shape: 'ring', radius: 1.4 }, cueScale: 1, scatter: { rings: 3, pool: { radius: 1.6, life: 2.2, damage: 8, interval: 0.6 } } },
        { attack: 'scatter', tell: 0.9, damage: 0, strikeRange: 0, attackRange: 9, cue: { shape: 'ring', radius: 1.4 }, cueScale: 1, scatter: { rings: 3, pool: { radius: 1.6, life: 2.2, damage: 8, interval: 0.6 } } },
      ],
    ],
    look: {
      pose: 'draw', scale: [1.5, 1.5, 1.5], cue: { shape: 'lane', length: 8, width: 4.6 }, cueScale: 1, barLift: 3.45, alertLift: 3.95, barColor: 0xff9a4a, gait: .3, blood: 1.6, heavy: true,
      trail: { from: 'weapon', color: 0xff9a4a, width: .14, inner: [0, 0, -.4], tip: [0, 0, -1.4] },
      death: { duration: 1.1, prone: false, weaponX: .7 }, shieldArm: false,
    },
  },
  // The Tide Hound (plan 021 D4): a stalker grown huge and quick, the pool's lane-dodging boss. Phase one is pounce, swing, pounce, each pounce a long lane drawn on the floor and a
  // leap that bills what it runs through; below half the tells shorten and the pounces come two at a time: the second begins the instant the first leap ends, with no
  // recovery between and a short re-aim of its own, from wherever the knight stands then (`chain`, dungeon-bestiary.ts). A dash out of the first lane is not the answer to the
  // second. Steadfast like every boss. The numbers are D7's hypothesis (45 vitality) and Stage F's to tune; the moves are the design.
  hound: {
    stats: { hp: 45, damage: 18, tell: 0.7, speed: 3.0 },
    strikeRange: 2.6, attackRange: 6.5, holdRange: 1.8, recovery: 1.3,
    attack: 'pounce', steadfast: true, advanceBelow: 0.9, firstFloor: Infinity, keepAway: 0,
    boss: 'pool', title: 'The Tide Hound', phaseNotice: ['', 'The Tide Hound howls'],
    phases: [.5],
    moves: [
      [
        { attack: 'pounce', tell: 0.7, damage: 18, strikeRange: 5, attackRange: 6.5, cue: { shape: 'lane', length: 5.4, width: 2.2 }, cueScale: 1 },
        { attack: 'swing', tell: 0.5, damage: 16, strikeRange: 2.6, attackRange: 2.2, cue: { shape: 'arc' }, cueScale: 1.75 },
        { attack: 'pounce', tell: 0.7, damage: 18, strikeRange: 5, attackRange: 6.5, cue: { shape: 'lane', length: 5.4, width: 2.2 }, cueScale: 1 },
      ],
      [
        { attack: 'pounce', tell: 0.5, damage: 18, strikeRange: 5, attackRange: 6.5, cue: { shape: 'lane', length: 5.4, width: 2.2 }, cueScale: 1 },
        { attack: 'pounce', tell: 0.3, damage: 18, strikeRange: 5, attackRange: 9, cue: { shape: 'lane', length: 5.4, width: 2.2 }, cueScale: 1, chain: true },
        { attack: 'swing', tell: 0.4, damage: 16, strikeRange: 2.6, attackRange: 2.2, cue: { shape: 'arc' }, cueScale: 1.75 },
      ],
    ],
    look: {
      pose: 'pounce', scale: [1.6, 1.6, 1.6], cue: { shape: 'lane', length: 5.4, width: 2.2 }, cueScale: 1, barLift: 3.1, alertLift: 3.6, barColor: 0x8fd0ff, gait: .5, blood: 1.6, heavy: true,
      trail: { from: 'claws', color: 0xb0e8ff, width: .14, inner: [0, -.72, -.12], tip: [0, -.87, -.5] },
      death: { duration: .95, prone: true, weaponX: .53 }, shieldArm: false,
    },
  },
};

/** One field of every archetype, keyed by kind - how the per-quantity tables in dungeon-enemy.ts are read. */
export const byKind = <T>(read: (archetype: Archetype) => T) =>
  Object.fromEntries(ENEMY_KINDS.map(kind => [kind, read(BESTIARY[kind])])) as Record<EnemyKind, T>;

/**
 * The bosses a floor can deal (plan 021 D13): the pool floors one and two draw from, in the order `dealBosses`
 * (dungeon-floor.ts) indexes it. Stage B held only the Captain; Stage C adds the Pyre Mother and Stage D the Tide Hound and the Bastion.
 */
export const BOSS_POOL: readonly EnemyKind[] = ['captain', 'mother', 'hound'];
/** The last floor's boss. The Captain stands in for it until Stage E gives the Bone King his row. */
export const FINAL_BOSS: EnemyKind = 'captain';
