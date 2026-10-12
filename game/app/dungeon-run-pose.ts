// Presentation only. Phase follows distance actually travelled, so pushing a wall
// cannot keep the knight running on the spot. One cycle contains two footfalls.
export const strideRate = (speed: number) => 2 * Math.PI / (2.1 + 1.15 * Math.min(1, Math.max(0, (speed - 5.8) / 2.7)));

// Plan 027: `cape` and DASH_CAPE are metres the poncho's hem is lifted back behind him (the cloth's hem
// state, dungeon-cloth.ts), no longer a pitch for a separate back flap: a few centimetres across the sprint
// blend, nine in a dash. The cloth clamps every offset at HEM_MAX (.12), and dungeon-cloak.test.ts holds the
// back point under the sash at that clamp, which is what keeps a dash from throwing it out like a wing.
export const DASH_CAPE = .09;

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

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
    // The free arm counter-swings against the left leg, harder at a sprint.
    arm: (.18 - Math.sin(phase) * (.5 + .2 * sprint)) * weight,
    // Plan 027: the free arm's elbow, opened down from the rest pose's square bend as he runs (more at a
    // sprint), with a little swing in phase with the arm. Exactly 0 standing.
    elbow: (-(.25 + .35 * sprint) - Math.sin(phase) * .1) * weight,
    swordPitch: (.48 + Math.sin(phase) * .12) * sprint * weight,
    cape: (.02 + .03 * sprint + Math.sin(2 * phase) * .005) * weight,
  };
}

/** Plan 027: the head's own turn on the neck, counter to the torso's, so it keeps looking along the aim
 *  while a swing winds the body round: 80% of the torso's yaw (wrapped, so a whirl's full turn ends where it
 *  began) up to .6 either way, and 60% of its pitch up to .2. Zero at rest. */
export function headLook(torsoYaw: number, pitch: number) {
  return { yaw: clamp(-wrap(torsoYaw) * .8, .6), pitch: clamp(-pitch * .6, .2) };
}

/** Plan 027: a slow breath while he stands, a 4 s cycle: `lift` (metres, at most .006) raises the cloak and
 *  the head, `nod` (radians, at most .03) tips the head. Both scale with `still`, 0 moving and 1 once he has
 *  stood about half a second, and both average zero over a cycle. Torso pitch and the tabard are not touched. */
export const BREATH_PERIOD = 4;
export function idleBreath(t: number, still: number) {
  const s = Math.min(1, Math.max(0, still)), a = 2 * Math.PI * t / BREATH_PERIOD;
  return { lift: .006 * Math.sin(a) * s, nod: .03 * Math.sin(a - .6) * s };
}
