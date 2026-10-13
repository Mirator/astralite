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
    // Plan 030: the shoulders counter-rotate against the hips, about 15 degrees each way at a sprint (the critic read
    // plan 027's 5 as a torso carried rigid on the legs): the sword shoulder comes forward with the left leg.
    twist: Math.sin(phase) * (.1 + .16 * sprint) * weight,
    // The free arm counter-swings against the left leg, harder at a sprint. Plan 030: less far forward than plan 027's
    // .88, which put the upper arm through the poncho's front now the arm hangs under it. (Round 2 tried more each way:
    // forward it comes through the front, back through the tails behind the arm.)
    // Round 3: centred a little forward (the fuller sleeve and the tails behind the arm meet it .018 deep at the old
    // back swing): .44 back and .56 forward at a sprint, 25 and 32 degrees.
    arm: (.06 - Math.sin(phase) * (.4 + .1 * sprint)) * weight,
    // Plan 030: the free elbow flexes forward from straight (positive), a runner's bend that pumps with the arm.
    // Exactly 0 standing, when the arm hangs straight as the sheet draws it.
    elbow: ((.5 + .5 * sprint) + Math.sin(phase) * .15) * weight,
    swordPitch: (.48 + Math.sin(phase) * .12) * sprint * weight,
    // Plan 030: the head nods down a little on each footfall, twice a cycle, so the bob reads on the head as well.
    nod: Math.pow(Math.sin(phase), 2) * .05 * weight,
    // Plan 030: metres the poncho's hem is driven to his side and back, with the stride: the hips rock it across and the
    // spring (dungeon-cloth.ts) swings it a beat behind them.
    sway: Math.sin(phase) * (.08 + .08 * sprint) * weight,
    cape: (.02 + .03 * sprint + Math.sin(2 * phase) * .005) * weight,
    // Plan 030 round 3: how far the sword is carried low and trailing at his side rather than held out across him in the
    // ready pose (0 to 1; the game blends the pivot towards the knight's SWORD_CARRY), and how far the sword forearm
    // swings about the elbow with the stride, against the free arm (radians, forward positive). Visual only: a swing
    // takes the sword straight back to its own pose.
    carry: weight,
    carrySwing: Math.sin(phase) * (.25 + .1 * sprint) * weight,
    // Plan 030 round 3: the cloth's own flutter, metres added to the hem's offset outside the spring (the spring is about
    // 1.6 cycles a second, too slow to follow a stride of 2.6, so the stride reached the drawn hem at a quarter of its size
    // and the critic saw it rigid): across with the hips' rock a quarter cycle behind it, back and up and down twice a
    // stride a quarter cycle behind the body's bob (the bob is sin^2, rising fastest at phase pi / 4).
    flutter: {
      x: -Math.cos(phase) * (.02 + .02 * sprint) * weight,
      z: -Math.cos(2 * phase) * (.012 + .012 * sprint) * weight,
      y: -Math.sin(2 * phase) * (.01 + .015 * sprint) * weight,
    },
  };
}

/** Plan 030 round 3: radians he leans into a turn (his whole figure rolled about its own forward axis, positive towards
 *  his left), from the body follower's yaw rate (rad/s, positive turning left, dungeon-cloth.ts bodyLag) and his ground
 *  speed: .02 per rad/s at a run, nothing standing, held to BANK_MAX (8 degrees). */
export const BANK_MAX = .14;
export function bankInto(yawRate: number, speed: number) {
  return clamp(yawRate * .02 * Math.min(1, Math.max(0, speed / 5.8)), BANK_MAX);
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
