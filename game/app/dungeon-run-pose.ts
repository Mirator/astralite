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
  // Round 6 (the critic: the torso upright through the run; he asks for 10 to 12 degrees): 7 degrees at a run (was 2), the
  // sprint's 15 unchanged.
  const lean = (.12 + sprint * .15) * weight, carrySwing = Math.sin(phase) * (.1 + .05 * sprint) * (Math.sin(phase) < 0 ? .5 : 1) * weight;
  return {
    sprint,
    legs,
    height: (.025 + sprint * .075) * Math.pow(Math.sin(phase), 2) * weight,
    pitch: -lean,
    // Plan 030: the shoulders counter-rotate against the hips, about 15 degrees each way at a sprint (the critic read
    // plan 027's 5 as a torso carried rigid on the legs): the sword shoulder comes forward with the left leg.
    twist: Math.sin(phase) * (.1 + .16 * sprint) * weight,
    // The free arm counter-swings against the left leg, harder at a sprint. Plan 030: less far forward than plan 027's
    // .88, which put the upper arm through the poncho's front now the arm hangs under it. (Round 2 tried more each way:
    // forward it comes through the front, back through the tails behind the arm.)
    // Round 3: centred a little forward (the fuller sleeve and the tails behind the arm meet it .018 deep at the old
    // back swing): .44 back and .56 forward at a sprint, 25 and 32 degrees.
    // (Round 4 measured the room: the sleeve meets the cloth .01 deep at -.5 and +.55, so the upper arm's swing stays.)
    // Round 5 (the critic: the free arm barely swings, it wants about 35 degrees each way): the poncho now spreads out past
    // the elbows (dungeon-knight.ts FLARE), so the upper arm has the room it lacked: .56 each way at a sprint, 32 degrees (round 4: .5).
    arm: (.06 - Math.sin(phase) * (.46 + .1 * sprint)) * weight,
    // Plan 030: the free elbow flexes forward from straight (positive), a runner's bend that pumps with the arm.
    // Exactly 0 standing, when the arm hangs straight as the sheet draws it.
    // Round 4 (the critic: the free arm barely swings): the bend pumps the other way, deeper as the arm comes forward (a
    // runner's punch) and opening as it goes back, so the forearm and the hand - what shows under the poncho - swing 1.2
    // rad end to end at a sprint, where round 3's bend (deeper going back) cancelled the upper arm's swing to .7.
    // Round 6 (the critic: the free forearm held bent forward through the run like a T-rex; swing the arm from the shoulder
    // instead): the bend light as the arm comes forward (.44, 25 degrees; it was 1.12, the forearm thrown up past the level)
    // and deep as it goes back (.85), where a straighter forearm swings the hand into the poncho's tail behind the arm.
    elbow: ((.37 + .275 * sprint) + Math.sin(phase) * .205) * weight,
    // Round 4 (the critic: the upper body rigid): the shoulders roll down towards the planted foot, 4 degrees at a sprint.
    roll: Math.sin(phase) * (.03 + .04 * sprint) * weight,
    swordPitch: (.48 + Math.sin(phase) * .12) * sprint * weight,
    // Plan 030: the head nods down a little on each footfall, twice a cycle, so the bob reads on the head as well.
    // Round 5 (the critic: the head tipped back and locked through the run, chin up): positive tips the head back, so the
    // nod is now a forward carry - the head held about 4 degrees down against the torso, on top of the lean headLook leaves
    // it (8 to 10 degrees down in the world at a sprint) - and a counter-bob of 3 degrees each way, twice a stride and a
    // little behind the body's (the bob, sin^2, is lowest at phase 0 and pi): the head tips down as the body rises off a
    // footfall and comes back up as it lands.
    nod: (-.07 + Math.sin(2 * phase - .6) * .05) * weight,
    // Plan 030: metres the poncho's hem is driven to his side and back, with the stride: the hips rock it across and the
    // spring (dungeon-cloth.ts) swings it a beat behind them.
    sway: Math.sin(phase) * (.08 + .08 * sprint) * weight,
    // Round 4: a little more at a sprint (.052, was .05): a start's backward pull adds to it through the spring, and much
    // more flings the hem to the clamp as he sets off (dungeon-cloth.test.ts). The flutter below is what streams it.
    cape: (.02 + .032 * sprint + Math.sin(2 * phase) * .005) * weight,
    // Plan 030 round 3: how far the sword is carried low and trailing at his side rather than held out across him in the
    // ready pose (0 to 1; the game blends the pivot towards the knight's SWORD_CARRY), and how far the sword forearm
    // swings about the elbow with the stride, against the free arm (radians, forward positive). Visual only: a swing
    // takes the sword straight back to its own pose.
    carry: weight,
    // Round 4: the orchestrator saw the blade come back up to the level at the forward end of round 3's .35 swing. A small
    // follow-through now: .15 forward at a sprint (the hand forward, the blade dipping) and half that back (the hand back,
    // the blade rising), about a blade carried 28 degrees down (dungeon-knight.ts SWORD_CARRY), so it never rises over 20
    // degrees under the level and the spear's tip still clears the floor.
    carrySwing,
    // Round 4: what the game turns the carry by about the elbow - the swing, plus the run's forward lean taken back out,
    // so the forearm hangs plumb from a leaning body and the blade trails as far under the level as a standing carry's
    // (the pack's side-on run: leaning 15 degrees into a sprint lifted round 3's blade to the level behind him).
    carryHang: carrySwing + lean,
    // Plan 030 round 3: the cloth's own flutter, metres added to the hem's offset outside the spring (the spring is about
    // 1.6 cycles a second, too slow to follow a stride of 2.6, so the stride reached the drawn hem at a quarter of its size
    // and the critic saw it rigid): across with the hips' rock a quarter cycle behind it, back and up and down twice a
    // stride a quarter cycle behind the body's bob (the bob is sin^2, rising fastest at phase pi / 4).
    flutter: {
      // Round 4: about a third more each way (the critic still saw the hem locked to the body side-on).
      x: -Math.cos(phase) * (.025 + .03 * sprint) * weight,
      z: -Math.cos(2 * phase) * (.016 + .018 * sprint) * weight,
      // Round 5 (the critic: the hem should lift about .03 of his height on each footfall): half as much again, .048 at a sprint.
      y: -Math.sin(2 * phase) * (.018 + .03 * sprint) * weight,
    },
  };
}

/** Plan 030 round 3: radians he leans into a turn (his whole figure rolled about its own forward axis, positive towards
 *  his left), from the body follower's yaw rate (rad/s, positive turning left, dungeon-cloth.ts bodyLag) and his ground
 *  speed: .02 per rad/s at a run, nothing standing, held to BANK_MAX (8 degrees; round 5 below: .03 and 10). */
// Round 5 (the critic: lean 8 to 12 degrees into a turn): .03 per rad/s, held to 10 degrees.
export const BANK_MAX = .175;
export function bankInto(yawRate: number, speed: number) {
  return clamp(yawRate * .03 * Math.min(1, Math.max(0, speed / 5.8)), BANK_MAX);
}

/** Plan 027: the head's own turn on the neck, counter to the torso's, so it keeps looking along the aim
 *  while a swing winds the body round: 80% of the torso's yaw (wrapped, so a whirl's full turn ends where it
 *  began) up to .6 either way, and 60% of its pitch up to .2. Zero at rest. */
// Round 5 (the critic: the head locked through turns): `yawRate` (rad/s, the body follower's, positive turning left, as
// bankInto reads it) turns the head further into a turn than the body, .06 per rad/s up to .3, so he looks where he is
// going before the body has come round. Zero at rest and when he runs straight.
export function headLook(torsoYaw: number, pitch: number, yawRate = 0) {
  return { yaw: clamp(-wrap(torsoYaw) * .8 + clamp(yawRate * .06, .3), .6), pitch: clamp(-pitch * .6, .2) };
}

/** Plan 027: a slow breath while he stands, a 4 s cycle: `lift` (metres, at most .006) raises the cloak and
 *  the head, `nod` (radians, at most .03) tips the head. Both scale with `still`, 0 moving and 1 once he has
 *  stood about half a second, and both average zero over a cycle. Torso pitch and the tabard are not touched. */
export const BREATH_PERIOD = 4;
export function idleBreath(t: number, still: number) {
  const s = Math.min(1, Math.max(0, still)), a = 2 * Math.PI * t / BREATH_PERIOD;
  return { lift: .006 * Math.sin(a) * s, nod: .03 * Math.sin(a - .6) * s };
}

/** Round 6 (the critic and the orchestrator: the stop snaps from mid-stride to standing between two frames, then freezes; he
 *  asks for a knee dip on the stop and a rest over about 300 ms). How fast the legs damp towards their target (per second,
 *  THREE.MathUtils.damp's lambda): at a run or in a strike's plant they follow the stride (28); once his feet have stopped
 *  (no ground speed) they come home at 9 - a sixth of the way per frame, 90% of the way in a quarter of a second - even while
 *  the gait is still winding down, which is when round 5 still snapped them at 28. */
export function legRate(gaitSpeed: number, groundSpeed: number, plant: number) {
  return plant > 0 || (gaitSpeed > 1 && groundSpeed > .05) ? 28 : 9;
}
/** Round 6: the stop's crouch. The stop's settle (dungeon-cloth.ts stepSettle, `lean` radians, up to .3 at a sprint's stop)
 *  already dips him 12 cm per radian; the legs now bend into it - the thighs forward and the knees folded - so the dip is
 *  a knee bend under him rather than the whole figure sinking. Radians added to each hip's and knee's target. */
export function stopCrouch(lean: number) {
  const l = Math.max(0, lean);
  return { hip: .55 * l, knee: -1.1 * l };
}
