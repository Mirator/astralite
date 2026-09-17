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

const smoothstep = (value: number) => value * value * (3 - 2 * value);

// A zero-slope ease keeps the cut joined to both the backswing and recovery.
const easeInOutCubic = (value: number) => value < 0.5
  ? 4 * value * value * value
  : 1 - Math.pow(-2 * value + 2, 3) / 2;

const finiteAge = (ageSeconds: number) => Number.isFinite(ageSeconds) ? ageSeconds : 0;

/** Return the player rig pose for elapsed attack time, clamping outside the swing to rest. */
export function playerAttackPose(ageSeconds: number, weapon: Weapon = TIDEBLADE): PlayerAttackPose {
  const age = finiteAge(ageSeconds);
  if (age <= 0 || age >= weapon.duration) return { ...REST };

  if (age < weapon.anticipation) {
    const t = smoothstep(age / weapon.anticipation);
    return {
      // The old pose began at -0.65, which made the sword snap on attack start.
      swordYaw: -1.1 * t,
      swordPitch: -0.06 * t,
      swordRoll: 0.05 * t,
      bodyYaw: -0.12 * t,
      bodyRoll: 0.025 * t,
      armReach: -0.025 * t,
      trail: false,
      active: false,
    };
  }

  if (age <= weapon.contactEnd) {
    const t = easeInOutCubic((age - weapon.anticipation) / (weapon.contactEnd - weapon.anticipation));
    return {
      // Local +yaw rotates forward -Z toward -X. Sweep broadly from the
      // backswing through the strike while retaining the attack-facing frame.
      swordYaw: -1.1 + 2.4 * t,
      swordPitch: -0.06 + 0.14 * t,
      swordRoll: 0.05 - 0.11 * t,
      bodyYaw: -0.12 + 0.28 * t,
      bodyRoll: 0.025 - 0.065 * t,
      armReach: -0.025 + 0.19 * t,
      trail: true,
      active: true,
    };
  }

  const t = smoothstep((age - weapon.contactEnd) / (weapon.duration - weapon.contactEnd));
  return {
    swordYaw: 1.3 * (1 - t),
    swordPitch: 0.08 * (1 - t),
    swordRoll: -0.06 * (1 - t),
    bodyYaw: 0.16 * (1 - t),
    bodyRoll: -0.04 * (1 - t),
    armReach: 0.165 * (1 - t),
    trail: false,
    active: false,
  };
}
