// Presentation only. Phase follows distance actually travelled, so pushing a wall
// cannot keep the knight running on the spot. One cycle contains two footfalls.
export const strideRate = (speed: number) => 2 * Math.PI / (2.1 + 1.15 * Math.min(1, Math.max(0, (speed - 5.8) / 2.7)));

export function playerRunPose(phase: number, speed: number) {
  const weight = Math.min(1, Math.max(0, speed / 5.8));
  const sprint = Math.min(1, Math.max(0, (speed - 5.8) / 2.7));
  const legs = [phase, phase + Math.PI].map(p => ({
    hip: (Math.sin(p) * (.48 + sprint * .42) + sprint * .14) * weight,
    // The heel folds up during recovery, then extends before the next plant.
    knee: -(.06 + Math.pow(Math.max(0, Math.cos(p)), 2) * (.3 + sprint * .95)) * weight,
  }));
  return {
    sprint,
    legs,
    height: (.025 + sprint * .075) * Math.pow(Math.sin(phase), 2) * weight,
    pitch: -(.04 + sprint * .23) * weight,
    twist: Math.sin(phase) * .08 * sprint * weight,
    arm: (.18 - Math.sin(phase) * .5) * weight,
    swordPitch: (.48 + Math.sin(phase) * .12) * sprint * weight,
    cape: .1 + (.22 + sprint * .28 + Math.sin(phase) * .05) * weight,
  };
}
