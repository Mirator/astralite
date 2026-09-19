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
import { TIDEBLADE, type Weapon } from './dungeon-weapon.ts';

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
export function playerAttackPose(ageSeconds: number, weapon: Weapon = TIDEBLADE): PlayerAttackPose {
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
