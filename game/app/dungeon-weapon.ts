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
   * Plan 023 (D3): this arm's shot is a bolt, which deals `BOSS_BOLT` times its damage to a boss (dungeon-hits.ts `landBlow`). Only the Keep Crossbow's bolt and its Heavy Bolt are: a thrown flask and the thrown spear are shots too, but not bolts,
   * and the multiplier is the crossbow's alone (D3: nothing else about any arm changes).
   */
  bolt?: boolean;
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
  /** The arm's own second verb (plan 016). Every arm in `WEAPONS` has one; absent leaves the input inert. */
  special?: Special;
};

export type SpecialId = 'undertow' | 'harpoon' | 'toll' | 'vault' | 'whirl' | 'heavybolt' | 'flashpoint';

/**
 * A special is a swing, on the same clock a strike runs on: `swing` overlays the arm the way a chain beat
 * does, so `canAbortSwing`, `swordContacts` and `playerSpeed` take it unchanged. What it adds is a cooldown,
 * which starts at contact rather than on the press, and one of seven shapes.
 */
export type Special = {
  id: SpecialId;
  name: string;
  /** One line, in the game's voice, for the controls card. */
  detail: string;
  kind: 'lunge' | 'throw' | 'charge' | 'vault' | 'whirl' | 'draw' | 'detonate';
  /** Seconds from contact until it can be used again. Zero for the draw, which the quiver gates instead. */
  cooldown: number;
  /** The swing it runs as. Everything left out is the arm's own. */
  swing: Partial<Weapon>;
  /** A lunge carries the knight `distance` units along the aim over `time` seconds from the end of anticipation. */
  lunge?: { distance: number; time: number; width: number };
  /**
   * A throw sends the arm itself along `swing.ranged`. The first guard or stalker it hits is dragged `drag`
   * units towards the knight, and until it is back in hand his strike is worth `bare` of its damage.
   */
  hurl?: { drag: number; bare: number };
  /**
   * A charge is held, not pressed. Released before `chargeMin` seconds it cancels at no cost; from there to
   * `chargeMax` the ring grows from `radius[0]` to `radius[1]` and the blow from `scale[0]` to `scale[1]` of
   * the arm's damage. The knight walks at `moveScale` of the arm's swing speed while he holds it.
   */
  chargeMin?: number;
  chargeMax?: number;
  radius?: [number, number];
  scale?: [number, number];
  moveScale?: number;
  /**
   * A vault hops over the nearest body within `range` of the knight and inside the `cone` (a cosine) round
   * his aim, landing `over` units past it, or `hop` units along the aim when nothing is there. The hop
   * takes `time` seconds from the end of anticipation; the backstab is scored on landing, on that body
   * alone. The path stops short at the first stone or prop, so it never ends inside either.
   */
  vault?: { range: number; cone: number; over: number; hop: number; time: number };
  /**
   * A draw is a charge that fires rather than slams: held `chargeMax` seconds it is drawn, and letting go
   * then looses one bolt down `swing.ranged` that passes through everything on its line. It spends the
   * whole quiver and is worth `swing.damage` for every bolt it spent; let go early, nothing is spent.
   */
  draw?: boolean;
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
 * A ring rather than an arc: any cosine beats this, so every direction round the knight is inside it,
 * including a body standing exactly on him. Up here rather than with the special rules below, because the
 * Whirl's own numbers read it while the arms are being defined.
 */
export const RING_ARC = -1.01;

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
  /**
   * Plan 016: a thrust that carries the knight 3.2 units along the aim and cuts everything on the line
   * once. It is an attack, not a second dash: no immunity at any point, and the 0.25s recovery at the far
   * end is spent standing in whatever he just ran through.
   */
  special: {
    id: 'undertow', name: 'Undertow Lunge', kind: 'lunge', cooldown: 4,
    detail: 'The Tideblade lunges along your aim and cuts everything on the line.',
    // 0.12s anticipation + 0.18s of travel + 0.25s recovery. The travel is the live window.
    swing: { duration: 0.55, anticipation: 0.12, contactEnd: 0.3, damage: 6, moveSpeed: 1.6, knockback: 0.5, wardenKnockback: 0.15, stagger: true },
    lunge: { distance: 3.2, time: 0.18, width: 0.9 },
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
  /**
   * Plan 016 Stage C: over the nearest body in the aim and a cut in its back on landing, twice the knives.
   * Takeoff is the commitment - the hop is inside the live window, so a dodge only cancels the crouch - and
   * like the lunge it buys no immunity: it is a way round a guard, not through its blow.
   */
  special: {
    id: 'vault', name: 'Vault', kind: 'vault', cooldown: 3,
    detail: 'The Twin Fangs vault over the nearest body in your aim and stab it in the back.',
    // 0.08s crouch, 0.18s in the air, 0.1s of backstab on landing, 0.14s recovery.
    swing: { duration: 0.5, anticipation: 0.08, contactEnd: 0.36, damage: 6, moveSpeed: 1.2, knockback: 0.3, wardenKnockback: 0.08, stagger: false },
    vault: { range: 3.2, cone: 0.5, over: 0.8, hop: 2.4, time: 0.18 },
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
  /**
   * Plan 016: the spear leaves the hand. It flies the aim, drags the first guard or stalker it takes two
   * units in, and staggers a warden it cannot move; until it is back the knight fights bare-handed.
   */
  special: {
    id: 'harpoon', name: 'Harpoon', kind: 'throw', cooldown: 5,
    detail: 'The Salt Spear is thrown and drags the first body it takes back to you.',
    swing: {
      duration: 0.5, anticipation: 0.12, contactEnd: 0.22, damage: 6, moveSpeed: 2.4, knockback: 0.15, wardenKnockback: 0, stagger: true,
      ranged: { speed: 18, flight: 0.5, pierce: 1, capacity: 1, refill: 0 },
    },
    hurl: { drag: 2, bare: 0.5 },
  },
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
  /**
   * Plan 016 Stage C: the cleaver taken all the way round, once. Half again as long as a strike and wound
   * for longer, so it is a thing to start before the ring closes rather than after; it shoves everything it
   * takes, a warden included, and still staggers nothing, for the reason above.
   */
  special: {
    id: 'whirl', name: 'Whirl', kind: 'whirl', cooldown: 5,
    detail: "The Warden's Cleaver is swung all the way round and shoves off everything it takes.",
    swing: { duration: 0.9, anticipation: 0.22, contactEnd: 0.5, damage: 7, arc: RING_ARC, moveSpeed: 1, knockback: 1.2, wardenKnockback: 0.45, stagger: false },
  },
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
  /**
   * Plan 016: held to charge and released to slam, a ring of force round the knight. Let go before half a
   * second and nothing is spent; a full second is the widest, heaviest ring. While he holds it he walks at
   * half the maul's swing speed, which is nearly standing still.
   */
  special: {
    id: 'toll', name: 'Tolling Slam', kind: 'charge', cooldown: 6,
    detail: 'Hold to wind the Bell Maul and release to slam a ring of force around you.',
    // The slam after the release. Its reach and damage come off the charge (see specialSwing).
    swing: { duration: 0.42, anticipation: 0.08, contactEnd: 0.18, moveSpeed: 0.6, knockback: 0.9, wardenKnockback: 0.35, stagger: true },
    chargeMin: 0.5, chargeMax: 1, radius: [2.4, 3.2], scale: [1.5, 2.5], moveScale: 0.5,
  },
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
  bolt: true,
  /**
   * Plan 016 Stage C: the whole quiver in one bolt. Held 0.7s it is drawn and stays drawn; let go then and
   * it goes through everything on its line to the first stone, worth a bolt for every bolt it spent. It has
   * no cooldown because the quiver is the cooldown: a dry crossbow cannot draw, and after it is dry.
   */
  special: {
    id: 'heavybolt', name: 'Heavy Bolt', kind: 'draw', cooldown: 0, draw: true,
    detail: 'Hold to draw the Keep Crossbow; release a full draw to spend the quiver on one bolt that pierces everything.',
    // After the release: the bolt leaves almost at once, and the kick is most of it.
    swing: {
      duration: 0.55, anticipation: 0.03, contactEnd: 0.14, damage: 9, moveSpeed: 1, knockback: 0.5, wardenKnockback: 0.2, stagger: true,
      ranged: { speed: 26, flight: 0.6, pierce: 64, capacity: 4, refill: 1.8 },
      bolt: true,
    },
    chargeMin: 0.7, chargeMax: 0.7, moveScale: 0.6,
  },
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
  /**
   * Plan 016 Stage C: every burning pool the knight has thrown goes up at once, a bite and a half to all
   * that stands in any of them, and the fire is spent. Nothing to detonate, nothing happens and nothing is
   * spent. The flask throws nothing while it does it (`ranged` is lifted off the swing).
   */
  special: {
    id: 'flashpoint', name: 'Flashpoint', kind: 'detonate', cooldown: 4,
    detail: 'Every burning pool of the Tideflask goes up at once and is spent.',
    swing: { duration: 0.45, anticipation: 0.12, contactEnd: 0.2, damage: 12, moveSpeed: 1.8, knockback: 0, wardenKnockback: 0, stagger: false, ranged: undefined },
  },
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

/** How close the knight stands to a rack to be offered the arm on it (see dungeon-sim.ts, which re-exports it). */
export const PICKUP_RADIUS = 1.4;

/** Falls back to the Tideblade, so a stale saved id or a bad test fixture cannot leave the knight unarmed. */
export const weaponById = (id: string): Weapon => WEAPONS[id as WeaponId] ?? TIDEBLADE;

/**
 * `?arm=maul` on a dev build starts every descent holding that arm, so a playtest of one arm's special
 * does not begin with a hunt for its rack. Own keys only: `?arm=toString` is not an arm. Null when the URL
 * names no arm, so a page without one never has its arm changed under it.
 */
export const devStartingArm = (search: string): WeaponId | null => {
  const id = new URLSearchParams(search).get('arm');
  return id && Object.hasOwn(WEAPONS, id) ? id as WeaponId : null;
};

// --- Specials (plan 016) -----------------------------------------------------------------------------

/** How far into its charge a held special is, 0 at `chargeMin` and 1 at `chargeMax`. Below the minimum is 0. */
export const chargeLevel = (special: Special, held: number) => {
  const min = special.chargeMin ?? 0, max = special.chargeMax ?? min;
  if (!(held > min) || max <= min) return held >= max ? 1 : 0;
  return Math.min(1, (held - min) / (max - min));
};

/** Whether letting go after `held` seconds slams, or cancels at no cost. */
export const chargeReleases = (special: Special, held: number) => held >= (special.chargeMin ?? 0);

/**
 * The swing a special runs as, the way `beatOf` is the swing a chain beat runs as: the arm, overlaid with
 * the special's own numbers. A charge takes its reach and damage from how long it was held. The chain is
 * dropped, because a special is never a beat of a string and must not open one.
 */
export const specialSwing = (weapon: Weapon, charge = 1): Weapon => {
  const special = weapon.special;
  if (!special) return weapon;
  const swing: Weapon = { ...weapon, ...special.swing, chain: undefined };
  if (special.kind === 'charge' && special.radius && special.scale) {
    const t = Math.min(1, Math.max(0, charge));
    swing.reach = special.radius[0] + (special.radius[1] - special.radius[0]) * t;
    swing.damage = Math.round(weapon.damage * (special.scale[0] + (special.scale[1] - special.scale[0]) * t));
    swing.arc = RING_ARC;
  }
  return swing;
};

/**
 * How far a lunge carries the knight this frame: the part of the frame (`age - dt` to `age`, seconds into
 * the special) that overlaps its travel window, at the lunge's own speed. Zero outside the window, so the
 * sum over any sequence of frames that spans it is exactly the lunge's distance.
 */
export const lungeStep = (special: Special, anticipation: number, age: number, dt: number) =>
  special.lunge ? travelStep(anticipation, special.lunge.time, special.lunge.distance, age, dt) : 0;

/** The share of `distance`, covered evenly over `time` seconds from `start`, that falls inside this frame. */
const travelStep = (start: number, time: number, distance: number, age: number, dt: number) => {
  if (!(dt > 0) || !(time > 0) || !(distance > 0)) return 0;
  const overlap = Math.max(0, Math.min(age, start + time) - Math.max(age - dt, start));
  return overlap * distance / time;
};

/**
 * How far a vault carries the knight this frame: its path is `distance` long (the caller measured it off
 * the floor when the hop started, see `vaultLanding`), covered over the hop's own time from the end of
 * anticipation. Like `lungeStep`, summed over any frames that span the hop it is exactly `distance`.
 */
export const vaultStep = (special: Special, anticipation: number, distance: number, age: number, dt: number) =>
  special.vault ? travelStep(anticipation, special.vault.time, distance, age, dt) : 0;

/** Whether a vault has come down: the backstab is scored from here on, never in the air. */
export const vaultLanded = (special: Special, anticipation: number, age: number) =>
  !!special.vault && age >= anticipation + special.vault.time - 1e-9;

/** How high the knight is off the floor `age` seconds into a vault: an arc peaking at `peak` mid-hop. */
export const vaultHeight = (special: Special, anticipation: number, age: number, peak = 0.9) => {
  if (!special.vault || !(age > anticipation)) return 0;
  const t = (age - anticipation) / special.vault.time;
  return t >= 1 ? 0 : Math.sin(Math.PI * t) * peak;
};

/** Whether a held draw is full, which is the only point at which letting go fires. */
export const drawn = (special: Special, held: number) => !!special.draw && held >= (special.chargeMax ?? 0);

/** What the Heavy Bolt is worth: a bolt's worth for every bolt in the quiver it spends. Nothing, dry. */
export const drawDamage = (weapon: Weapon, quiver: number) =>
  weapon.special?.draw ? specialSwing(weapon).damage * Math.max(0, Math.floor(Number.isFinite(quiver) ? quiver : 0)) : 0;
