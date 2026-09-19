// Presentation-only player attack curve. Combat owns the clock and hit rules;
// this module only turns the elapsed time into stable rig transforms.
//
// The three phase boundaries now come from the weapon, because they are what a
// weapon mostly is. The curve's own shape — how far the sword travels through
// each phase — is shared: a slower arm swings the same arc over a longer span
// rather than a different arc. The exported constants stay, as the Tideblade's
// values, so a caller with no weapon in hand still reads the sword it used to.
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
/** How far the cut carries it: 2.8 radians, or 160 degrees, against 137 before. */
const SWEEP = 2.8;
/** The share of the recovery spent holding the follow-through before returning. */
const HOLD = 0.22;

const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * The cut is fastest the instant it commits and decelerates into the
 * follow-through. The zero-slope ease this replaced spent the first quarter of
 * the live window barely moving — and that is the quarter the blow lands in.
 */
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const finiteAge = (ageSeconds: number) => Number.isFinite(ageSeconds) ? ageSeconds : 0;

/** Return the player rig pose for elapsed attack time, clamping outside the swing to rest. */
export function playerAttackPose(ageSeconds: number, weapon: Weapon = TIDEBLADE): PlayerAttackPose {
  const age = finiteAge(ageSeconds);
  if (age <= 0 || age >= weapon.duration) return { ...REST };

  const launch = weapon.anticipation * LAUNCH;
  if (age < launch) {
    const t = smoothstep(age / launch);
    return {
      // The old pose began at -0.65, which made the sword snap on attack start.
      swordYaw: BACK * t,
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
      swordYaw: BACK + SWEEP * t,
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

  // A held follow-through and then the return. Without the hold the recovery
  // reads as the cut simply carrying on, and the swing has two phases, not three.
  const elapsed = (age - weapon.contactEnd) / (weapon.duration - weapon.contactEnd);
  const t = smoothstep(Math.max(0, (elapsed - HOLD) / (1 - HOLD)));
  return {
    swordYaw: (BACK + SWEEP) * (1 - t),
    swordPitch: 0.16 * (1 - t),
    swordRoll: -0.14 * (1 - t),
    bodyYaw: 0.34 * (1 - t),
    bodyRoll: -0.085 * (1 - t),
    armReach: 0.24 * (1 - t),
    trail: false,
    active: false,
  };
}
