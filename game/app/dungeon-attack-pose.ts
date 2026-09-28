// Presentation-only player attack curve. Combat owns the clock and hit rules;
// this module only turns the elapsed time into stable rig transforms.
//
// The three phase boundaries now come from the weapon, because they are what a
// weapon mostly is. The curve's own shape — how far the sword travels through
// each phase — is mostly shared, but it is no longer shared blindly: a swing
// that is twice as long is not the same swing played at half speed, and an arm
// that throws something is not swinging at all. The exported constants stay, as
// the Tideblade's values, so a caller with no weapon in hand still reads the
// sword it used to.
import { TIDEBLADE, type Special, type Weapon } from './dungeon-weapon.ts';

export const PLAYER_ATTACK_DURATION = TIDEBLADE.duration;
export const PLAYER_ATTACK_ANTICIPATION = TIDEBLADE.anticipation;
export const PLAYER_ATTACK_CONTACT_END = TIDEBLADE.contactEnd;
/**
 * When the arm stops winding back and starts cutting, as the Tideblade's own
 * clock. It sits inside the anticipation, so the cut window the eye sees is
 * wider than the damage window combat scores on — see LAUNCH.
 */
export const PLAYER_ATTACK_LAUNCH = TIDEBLADE.anticipation * 0.8;

export type PlayerAttackPose = {
  swordYaw: number;
  swordPitch: number;
  swordRoll: number;
  bodyYaw: number;
  bodyRoll: number;
  armReach: number;
  trail: boolean;
  active: boolean;
};

const REST: PlayerAttackPose = {
  swordYaw: 0,
  swordPitch: 0,
  swordRoll: 0,
  bodyYaw: 0,
  bodyRoll: 0,
  armReach: 0,
  trail: false,
  active: false,
};

/**
 * How much of the wind-up is spent winding back. The rest is the launch.
 *
 * This exists because combat opens contact on a cone test rather than on where
 * the blade has got to, so a body already inside the arc is struck on the very
 * first live frame. Under the old curve that frame showed the sword parked
 * behind the shoulder at its deepest backswing, which is exactly why the frame
 * a blow lands on did not look different from the frame before it. Beginning
 * the cut inside the last fifth of the wind-up puts the blade a third of the
 * way round by the time the blow is scored, so the hit-stop that follows
 * freezes a cut in progress instead of a pose at rest.
 */
const LAUNCH = PLAYER_ATTACK_LAUNCH / TIDEBLADE.anticipation;

/** Where the sword sits at the deepest point of the wind-back, in radians. */
const BACK = -1.2;
/**
 * Where the cut finishes, in radians, whatever it started from. It used to be a
 * fixed sweep added to a fixed backswing, which meant an arm that wound back
 * further would also finish further round — a cleaver ending its swing pointing
 * over the knight's own shoulder. Pinning the finish instead makes a deeper
 * wind-back buy a *wider* arc, which is what a heavier weapon should read as.
 * The Tideblade's -1.2 to 1.6 is the 2.8 radians it always swung.
 */
const FINISH = 1.6;
/**
 * Seconds the arm takes to reach the deepest point of the wind-back, however
 * long the wind-up itself is.
 *
 * Watched frame by frame, the cleaver's 0.14s wind-up was seven frames of a
 * slab creeping backwards: a smoothstep spread over that long spends its first
 * third barely moving, and on the largest silhouette in the game that reads as
 * a freeze rather than as a tell. The Tideblade's launch is inside this, so its
 * wind-back is unchanged; a slower arm now snaps back and *holds* the wound
 * pose, which is both readable at a glance and the thing a player is supposed
 * to be reacting to.
 */
const WIND_BACK = 0.075;
/**
 * How much further than the Tideblade a slow arm winds back. Measured off the
 * wind-up, because that is what "heavy" means here: the cleaver reaches -1.56
 * and the maul -1.61 against the sword's -1.2, and with FINISH pinned that is a
 * 181-degree arc for the cleaver against 160 for the sword.
 */
const backswing = (weapon: Weapon) =>
  BACK * (1 + Math.min(0.45, Math.max(0, weapon.anticipation - TIDEBLADE.anticipation) * 4));

const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * The cut is fastest the instant it commits and decelerates into the
 * follow-through. The zero-slope ease this replaced spent the first quarter of
 * the live window barely moving — and that is the quarter the blow lands in.
 */
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const finiteAge = (ageSeconds: number) => Number.isFinite(ageSeconds) ? ageSeconds : 0;

/** swordYaw, swordPitch, swordRoll, bodyYaw, bodyRoll, armReach — at a fraction of the phase. */
type Key = readonly [at: number, number, number, number, number, number, number];

/**
 * Read a keyframe track at `t`, easing between the two keys that bracket it.
 * Six numbers rather than six tracks because every channel of this rig turns at
 * the same moments: they are one pose, not six curves that happen to coincide.
 */
const sample = (keys: readonly Key[], t: number): Omit<PlayerAttackPose, 'trail' | 'active'> => {
  let index = 0;
  while (index < keys.length - 2 && t >= keys[index + 1][0]) index++;
  const from = keys[index], to = keys[index + 1];
  const span = to[0] - from[0];
  const blend = smoothstep(span > 0 ? Math.min(1, Math.max(0, (t - from[0]) / span)) : 1);
  const at = (channel: number) => from[channel] + (to[channel] - from[channel]) * blend;
  return { swordYaw: at(1), swordPitch: at(2), swordRoll: at(3), bodyYaw: at(4), bodyRoll: at(5), armReach: at(6) };
};

/**
 * The recovery, as poses rather than as a fade.
 *
 * What was here before was one smoothstep pulling every channel back to zero,
 * and on the strip that is twelve frames of a sword rotating home behind the
 * body it has just cut — more than a third of the swing with nothing in it. The
 * reference does something specific in the same window: the blade carries past
 * the finish, is drawn *up and across the chest* where the whole edge is
 * visible against the background, and only then drops into guard while the body
 * settles back through neutral. Three poses, so three keys plus the two ends.
 *
 * The first key has to be the pose the cut ends on, or the two phases tear.
 */
const RECOVERY: readonly Key[] = [
  // The follow-through, exactly as the cut left it.
  [0, FINISH, 0.16, -0.14, 0.34, -0.085, 0.24],
  // Carried past the finish by its own weight, arm still extended, tip already
  // coming up. The lift has to start here rather than on the next key: at this
  // yaw the blade is on the far side of whatever was struck, and flat it simply
  // vanishes behind it for three frames.
  [0.14, FINISH + 0.14, 0.52, -0.24, 0.3, -0.05, 0.34],
  // Up across the chest, and deliberately *not* drawn back inside the shoulder:
  // the hand sits off the knight's right, so an arm pulled in puts the blade
  // behind him, away from the camera, where a lifted tip is four pixels. Held
  // out and lifted past a right angle it stands between the body and the
  // camera, which is the one place a pale edge reads over a dark mass.
  [0.44, 0.86, 0.98, 0.55, 0.1, 0.04, 0.3],
  // Coming down, with the torso swung through neutral and a little past it —
  // the counter-rotation that makes a body look like it stopped itself.
  [0.74, 0.2, 0.32, 0.14, -0.09, 0.02, 0.02],
  // Guard.
  [1, 0, 0, 0, 0, 0, 0],
];

/**
 * And the same window for an arm that throws something, which has no
 * follow-through to carry because nothing was swung. The crossbow's recovery is
 * half a second — thirty frames — so it gets the beats a shooter actually has:
 * the kick, the weapon dropped off the line, and the re-shoulder.
 */
const RANGED_RECOVERY: readonly Key[] = [
  // The kick, as the shot left it.
  [0, -0.1, 0.34, -0.12, 0.16, -0.05, -0.16],
  // Dropped off the line and turned out, which is where a hand goes to reload.
  [0.34, -0.34, -0.42, -0.3, 0.06, 0.05, -0.26],
  // Back up onto the carry, torso swinging through neutral.
  [0.74, 0.08, 0.1, 0.06, -0.05, 0.01, 0.06],
  [1, 0, 0, 0, 0, 0, 0],
];

/** Raising the arm onto the line, for an arm that is aimed rather than swung. */
const AIM: readonly Key[] = [
  [0, 0, 0, 0, 0, 0, 0],
  // The stock comes up and the shoulder turns into it.
  [0.45, -0.16, 0.2, -0.1, -0.14, 0.03, 0.1],
  // Settled on the line, leaning into the shot. A crossbow is steadiest just
  // before it goes, so the last third of the wind-up barely moves — which is
  // the opposite of what a blade does, and the reason this is its own track.
  [1, -0.04, 0.05, -0.03, -0.06, 0.01, 0.24],
];

/** The shot itself: everything jumps off the line and starts coming back. */
const SHOT: readonly Key[] = [
  [0, -0.04, 0.05, -0.03, -0.06, 0.01, 0.24],
  // One frame of recoil. The weapon is driven back into the shoulder and the
  // muzzle rises, which is the only violent frame in the whole 0.86s.
  [0.22, -0.02, 0.44, -0.06, 0.13, -0.09, -0.24],
  [1, -0.1, 0.34, -0.12, 0.16, -0.05, -0.16],
];

/**
 * An arm that throws is aimed, not swung: no wind-back, no sweep, and no
 * ribbon until the thing has actually left. The crossbow used to wind 1.2
 * radians away from what it was pointing at over fourteen frames and then open
 * a blade trail 44ms before the bolt — a slash, drawn by a machine, at nothing.
 */
function rangedPose(age: number, weapon: Weapon): PlayerAttackPose {
  if (age < weapon.anticipation) {
    return { ...sample(AIM, age / weapon.anticipation), trail: false, active: false };
  }
  if (age <= weapon.contactEnd) {
    return {
      ...sample(SHOT, (age - weapon.anticipation) / (weapon.contactEnd - weapon.anticipation)),
      // The ribbon runs along the rail rather than round an edge, so it opens on
      // the frame the bolt leaves and not a frame before it.
      trail: true,
      active: true,
    };
  }
  return {
    ...sample(RANGED_RECOVERY, (age - weapon.contactEnd) / (weapon.duration - weapon.contactEnd)),
    trail: false,
    active: false,
  };
}

/** Return the player rig pose for elapsed attack time, clamping outside the swing to rest. */
/**
 * A swing, with its lateral channels flipped: the same cut coming from the other shoulder.
 *
 * This is what a second beat of a string is. Pitch and reach are untouched, because a back-cut is the
 * same arm at the same height travelling the other way — negating those as well would have the knight
 * swinging at the floor on every other beat.
 */
const mirrored = (pose: PlayerAttackPose): PlayerAttackPose => ({
  ...pose,
  swordYaw: -pose.swordYaw,
  swordRoll: -pose.swordRoll,
  bodyYaw: -pose.bodyYaw,
  bodyRoll: -pose.bodyRoll,
});

/**
 * `beat` is which swing of a string this is, counting from zero. Odd beats come from the other side.
 * Everything else about the curve is the weapon's, and a beat of a chain *is* a weapon — see `beatOf`
 * — so a longer or heavier beat needs nothing here.
 */
export function playerAttackPose(
  ageSeconds: number,
  weapon: Weapon = TIDEBLADE,
  beat = 0,
): PlayerAttackPose {
  const pose = swingPose(ageSeconds, weapon);
  return beat % 2 ? mirrored(pose) : pose;
}

function swingPose(ageSeconds: number, weapon: Weapon): PlayerAttackPose {
  const age = finiteAge(ageSeconds);
  if (age <= 0 || age >= weapon.duration) return { ...REST };
  if (weapon.ranged) return rangedPose(age, weapon);

  const launch = weapon.anticipation * LAUNCH;
  const back = backswing(weapon);
  if (age < launch) {
    // Capped in seconds, not in fractions: a long wind-up holds the wound pose
    // rather than crawling towards it. See WIND_BACK.
    const t = smoothstep(Math.min(1, age / Math.min(launch, WIND_BACK)));
    return {
      // The old pose began at -0.65, which made the sword snap on attack start.
      swordYaw: back * t,
      swordPitch: -0.1 * t,
      swordRoll: 0.07 * t,
      bodyYaw: -0.2 * t,
      bodyRoll: 0.045 * t,
      armReach: -0.05 * t,
      trail: false,
      active: false,
    };
  }

  if (age <= weapon.contactEnd) {
    const t = easeOutCubic((age - launch) / (weapon.contactEnd - launch));
    return {
      // Local +yaw rotates forward -Z toward -X. Sweep broadly from the
      // backswing through the strike while retaining the attack-facing frame.
      swordYaw: back + (FINISH - back) * t,
      swordPitch: -0.1 + 0.26 * t,
      swordRoll: 0.07 - 0.21 * t,
      bodyYaw: -0.2 + 0.54 * t,
      bodyRoll: 0.045 - 0.13 * t,
      armReach: -0.05 + 0.29 * t,
      trail: true,
      // Damage timing stays combat's, not the curve's: the blade goes live on
      // the weapon's own boundary however early the arm started moving.
      active: age >= weapon.anticipation,
    };
  }

  return {
    ...sample(RECOVERY, (age - weapon.contactEnd) / (weapon.duration - weapon.contactEnd)),
    trail: false,
    active: false,
  };
}

// --- Specials (plan 016) -----------------------------------------------------------------------------
// Each special gets three short tracks - the wind, the live window and the recovery - on the same clock and
// the same six channels as a swing, so the rig and the trail need nothing new. Positive pitch lifts the tip.

type Tracks = { wind: readonly Key[]; live: readonly Key[]; recover: readonly Key[] };
/** The same pose, moved to another point in its phase: where one phase ends is where the next begins. */
const at = (t: number, key: Key): Key => [t, key[1], key[2], key[3], key[4], key[5], key[6]];

/** Drawn back to the hip, then driven straight down the aim with the whole arm behind it. */
const THRUST_BACK: Key = [1, 0.35, -0.04, 0.05, -0.34, 0.06, -0.3];
const THRUST_OUT: Key = [1, 0.02, 0.04, 0, 0.12, -0.04, 0.58];
const LUNGE: Tracks = {
  wind: [[0, 0, 0, 0, 0, 0, 0], THRUST_BACK],
  live: [at(0, THRUST_BACK), [0.3, 0.06, 0.05, 0.01, 0.1, -0.03, 0.52], THRUST_OUT],
  recover: [at(0, THRUST_OUT), [0.5, 0.1, 0.2, 0.05, 0.06, -0.02, 0.3], [1, 0, 0, 0, 0, 0, 0]],
};

/** Raised over the shoulder, then the arm snaps forward and is left empty on the line. */
const HURL_BACK: Key = [1, -0.4, 0.9, 0.2, -0.3, 0.08, -0.3];
const HURL_OUT: Key = [1, 0.15, -0.2, -0.1, 0.25, -0.05, 0.38];
const THROW: Tracks = {
  wind: [[0, 0, 0, 0, 0, 0, 0], HURL_BACK],
  live: [at(0, HURL_BACK), [0.35, 0.1, -0.25, -0.1, 0.26, -0.06, 0.46], HURL_OUT],
  recover: [at(0, HURL_OUT), [1, 0, 0, 0, 0, 0, 0]],
};

/** The maul held high, and brought straight down into the floor. */
const RAISED: Key = [1, -0.2, 1.3, 0.1, -0.15, 0.04, -0.1];
const DOWN: Key = [1, 0, -0.62, 0, 0.08, -0.04, 0.28];
const SLAM: Tracks = {
  wind: [at(0, RAISED), [1, -0.2, 1.38, 0.1, -0.16, 0.04, -0.12]],
  live: [[0, -0.2, 1.38, 0.1, -0.16, 0.04, -0.12], [0.45, 0, -0.66, 0, 0.1, -0.05, 0.3], DOWN],
  recover: [at(0, DOWN), [0.55, 0, -0.3, 0, 0.04, -0.02, 0.14], [1, 0, 0, 0, 0, 0, 0]],
};

// Stage C. The Vault: a crouch, the blades tucked through the hop, and a reverse stab once he is down. The
// landing is at LANDING of the live window for the Fangs' numbers (0.18s of hop in 0.28s live); the ribbon
// only opens from there, since a trail drawn through the air would read as a cut that never happened.
const CROUCH: Key = [1, -0.5, -0.3, 0.1, -0.15, 0.1, -0.2];
const STABBED: Key = [1, 1.3, 0, -0.2, -0.35, -0.05, 0.42];
const LANDING = 0.64;
const VAULT: Tracks = {
  wind: [[0, 0, 0, 0, 0, 0, 0], CROUCH],
  live: [at(0, CROUCH), [0.3, -0.9, 0.5, 0.2, 0.3, 0.1, -0.1], [LANDING, -1, 0.3, 0.1, 0.5, 0.05, -0.05], [0.8, 1.2, -0.1, -0.2, -0.3, -0.05, 0.4], STABBED],
  recover: [at(0, STABBED), [1, 0, 0, 0, 0, 0, 0]],
};

// The Whirl: coiled with the blade behind him, and the spin already under way when the edge goes live, so
// the frame the ring lands on shows a blade crossing the body rather than one parked at the shoulder. The
// torso turns a whole revolution and a little over; the recovery unwinds that little to a full turn, which
// is the rest pose again, so nothing snaps back the long way round.
const COILED: Key = [1, -1.4, -0.12, 0.1, -0.7, 0.06, -0.08];
const SPUN = Math.PI * 2;
const WHIRL: Tracks = {
  wind: [[0, 0, 0, 0, 0, 0, 0], at(0.7, COILED), [1, 0.4, -0.04, -0.05, 0.3, 0, 0.18]],
  live: [[0, 0.4, -0.04, -0.05, 0.3, 0, 0.18], [0.5, 1, 0.02, -0.15, SPUN * 0.55, -0.06, 0.3], [1, 1.1, 0.05, -0.2, SPUN - 0.35, -0.08, 0.32]],
  recover: [[0, 1.1, 0.05, -0.2, SPUN - 0.35, -0.08, 0.32], [0.5, 0.5, 0.4, 0.2, SPUN - 0.08, 0, 0.15], [1, 0, 0, 0, SPUN, 0, 0]],
};

// The Heavy Bolt after the release: held drawn for the instant it takes, then a kick far harder than a bolt's.
const DRAWN: Key = [1, -0.04, 0.06, -0.03, -0.1, 0.01, -0.12];
const KICKED: Key = [1, -0.1, 0.38, -0.12, 0.18, -0.05, -0.2];
const LOOSE: Tracks = {
  wind: [at(0, DRAWN), DRAWN],
  live: [at(0, DRAWN), [0.22, -0.02, 0.5, -0.06, 0.18, -0.1, -0.3], KICKED],
  recover: [at(0, KICKED), ...RANGED_RECOVERY.slice(1)],
};

// The Flashpoint: the flask hand thrown up and open, the gesture that sets the fire off.
const LIFTED: Key = [1, -0.3, 1, 0.2, -0.2, 0.05, -0.15];
const FLUNG: Key = [1, 0.1, 1.1, 0.1, 0.1, -0.04, 0.28];
const DETONATE: Tracks = {
  wind: [[0, 0, 0, 0, 0, 0, 0], LIFTED],
  live: [at(0, LIFTED), [0.3, 0.1, 1.2, 0.1, 0.1, -0.05, 0.3], FLUNG],
  recover: [at(0, FLUNG), [1, 0, 0, 0, 0, 0, 0]],
};

const TRACKS: Record<Special['kind'], Tracks> = { lunge: LUNGE, throw: THROW, charge: SLAM, vault: VAULT, whirl: WHIRL, draw: LOOSE, detonate: DETONATE };

/** Whether the ribbon runs `t` into a special's live window: never for a thrown arm or an opened hand. */
const ribbon = (kind: Special['kind'], t: number) => kind === 'vault' ? t >= LANDING : kind !== 'throw' && kind !== 'detonate';

/**
 * The rig pose for a special, `ageSeconds` into it. `swing` is what `specialSwing` returned, so the three
 * phase boundaries are the ones combat scores against; `active` is the same live window. The thrown arm
 * draws no ribbon - it is not being swung - and the other two draw one only while they are live.
 */
export function playerSpecialPose(ageSeconds: number, swing: Weapon, kind: Special['kind']): PlayerAttackPose {
  const age = finiteAge(ageSeconds);
  if (age <= 0 || age >= swing.duration) return { ...REST };
  const tracks = TRACKS[kind];
  if (age < swing.anticipation) return { ...sample(tracks.wind, age / swing.anticipation), trail: false, active: false };
  if (age <= swing.contactEnd) {
    const t = (age - swing.anticipation) / Math.max(1e-6, swing.contactEnd - swing.anticipation);
    return { ...sample(tracks.live, t), trail: ribbon(kind, t), active: true };
  }
  return { ...sample(tracks.recover, (age - swing.contactEnd) / Math.max(1e-6, swing.duration - swing.contactEnd)), trail: false, active: false };
}

/** Winding a charge: `level` 0 is the arm at rest and 1 is the maul all the way up, where the slam starts. */
const WINDING: readonly Key[] = [[0, 0, 0, 0, 0, 0, 0], [0.6, -0.16, 1.1, 0.08, -0.12, 0.03, -0.06], RAISED];
/** Drawing the Heavy Bolt: the stock up onto the line, then the string hauled back into the shoulder. */
const DRAWING: readonly Key[] = [[0, 0, 0, 0, 0, 0, 0], [0.5, -0.16, 0.2, -0.1, -0.14, 0.03, 0.1], DRAWN];
export const chargePose = (level: number, kind: Special['kind'] = 'charge'): PlayerAttackPose =>
  ({ ...sample(kind === 'draw' ? DRAWING : WINDING, Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))), trail: false, active: false });
