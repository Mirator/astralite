// Presentation-only player attack curve. Combat owns the clock and hit rules;
// this module only turns the elapsed time into stable rig transforms.
export const PLAYER_ATTACK_DURATION = 0.38;
export const PLAYER_ATTACK_ANTICIPATION = 0.065;
export const PLAYER_ATTACK_CONTACT_END = 0.175;

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
export function playerAttackPose(ageSeconds: number): PlayerAttackPose {
  const age = finiteAge(ageSeconds);
  if (age <= 0 || age >= PLAYER_ATTACK_DURATION) return { ...REST };

  if (age < PLAYER_ATTACK_ANTICIPATION) {
    const t = smoothstep(age / PLAYER_ATTACK_ANTICIPATION);
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

  if (age <= PLAYER_ATTACK_CONTACT_END) {
    const t = easeInOutCubic((age - PLAYER_ATTACK_ANTICIPATION) / (PLAYER_ATTACK_CONTACT_END - PLAYER_ATTACK_ANTICIPATION));
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

  const t = smoothstep((age - PLAYER_ATTACK_CONTACT_END) / (PLAYER_ATTACK_DURATION - PLAYER_ATTACK_CONTACT_END));
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
