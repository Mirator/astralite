// The Relic Seeker's secondary motion (plan 027 Stage B), as pure rules over numbers and arrays: no React,
// DOM or Three.js, so node runs them directly. The game feeds them its simulated dt and the body's motion
// and writes what they return into the meshes it draws (dungeon-game.tsx); the knight builds the cloth's
// rest arrays and the tunic it must clear (dungeon-knight.ts).
//
// One damped follower, the hem state, stands for where the poncho's hem has got to relative to the torso:
// it is pulled towards a drive (trailing the body's acceleration, swinging against a turn, lifted back by
// a run or a dash) by a spring that lags and overshoots a little, and every cloth vertex follows it in
// proportion to how far down the cloth it hangs.

/** Torso-local offset of the hem from rest, in metres (x his right, z his back), and its velocity. */
export type Hem = { x: number; z: number; vx: number; vz: number };
export const HEM_REST: Hem = Object.freeze({ x: 0, z: 0, vx: 0, vz: 0 });
/** The furthest the hem is ever displaced: a dash's lift and a hard start both clamp here. */
export const HEM_MAX = .12;
// The spring: 10 rad/s at a damping ratio of .5 - it reaches a step in about a fifth of a second and overshoots it
// by a sixth, and a hem thrown to the clamp by a hard stop is back within a centimetre of rest in 700 ms
// (sprint.spec.ts reads it there). Plan 030 raised it from 8 rad/s at .6 (plan 027): the stride's sway (the run pose's
// `sway`, about 2.6 cycles a second at a sprint) reached the hem at a quarter of its size through the slower spring and
// the critic saw no cloth move; at 10 and .5 it arrives at .42 of its size and about a quarter cycle late. Round 2: a
// damping ratio of .42, so a stop's throw overshoots by about a quarter and swings back once (the critic: "stop settles
// without overshoot"), still within a centimetre of rest 700 ms later.
const OMEGA = 10, ZETA = .42, SUBSTEP = 1 / 120;

/** Advances the hem towards `drive` by `dt` seconds, in substeps of at most 1/120 s so a 30 Hz frame and a
 *  144 Hz one land in the same place, and clamps it to HEM_MAX (a clamped hem stops moving outwards). */
export function stepHem(hem: Hem, drive: { x: number; z: number }, dt: number): Hem {
  let { x, z, vx, vz } = hem;
  const steps = Math.max(1, Math.ceil(Math.max(0, dt) / SUBSTEP)), h = Math.max(0, dt) / steps;
  for (let i = 0; i < steps && h > 0; i++) {
    vx += (OMEGA * OMEGA * (drive.x - x) - 2 * ZETA * OMEGA * vx) * h;
    vz += (OMEGA * OMEGA * (drive.z - z) - 2 * ZETA * OMEGA * vz) * h;
    x += vx * h; z += vz * h;
    const length = Math.hypot(x, z);
    if (length > HEM_MAX) {
      const nx = x / length, nz = z / length, out = vx * nx + vz * nz;
      x = nx * HEM_MAX; z = nz * HEM_MAX;
      if (out > 0) { vx -= out * nx; vz -= out * nz; }
    }
  }
  return { x, z, vx, vz };
}

// Metres of trail per m/s² of the body's acceleration and per rad/s of its turn, as the lag below reports them.
// Plan 028: small enough that only a sprint from a standstill or a reversal reaches INERTIA_MAX, so a walk's start, a
// slight turn and a full sprint's start each trail the hem by their own amount (at .02 and .03 every start and turn
// hit the cap and the gains did nothing). Plan 030 round 2: a third more (.0012, .004 and a cap of .04 before), so a stop
// or a turn throws the hem about 12 degrees on the long tails.
// Round 4: a third up again (.0021, the cap .068), so a sprint's stop throws the hem clearly forward past the body (the
// critic: "on the stop nothing overshoots").
// Round 4: a stop's forward throw (the pull towards his front) at 1.4 times the gain and the cap, so a sprint's stop throws
// the hem clearly forward past the body (the critic: "on the stop nothing overshoots"); a start's backward pull adds to the
// run's lift, so it stays as it was or a start would fling the hem to the clamp (dungeon-cloth.test.ts).
const ACCEL_GAIN = .0016, TURN_GAIN = .006, THROW = 1.4;
/** The most the body's acceleration and turn together pull the hem, in metres, before any lift (plan 028). */
export const INERTIA_MAX = .052;
/** Where the hem is pulled to, torso-local: away from the body's acceleration (so a start leaves it behind
 *  and a stop throws it forward), out against a turn, back by `lift` (the run pose's `cape`, or
 *  DASH_CAPE in a dash: metres of trail) and across by `sway` (the run pose's stride sway, plan 030). The
 *  acceleration and turn part is capped at INERTIA_MAX. */
export function hemDrive(input: { accel: { x: number; z: number }; yawRate: number; lift: number; sway?: number }): { x: number; z: number } {
  let x = -input.accel.x * ACCEL_GAIN - input.yawRate * TURN_GAIN, z = -input.accel.z * ACCEL_GAIN;
  const pull = Math.hypot(x, z);
  if (pull > INERTIA_MAX) { x *= INERTIA_MAX / pull; z *= INERTIA_MAX / pull; }
  if (z < 0) z *= THROW;
  return { x: x + (input.sway ?? 0), z: z + input.lift };
}

/** The body's velocity (world, m/s) and heading (radians), followed with a lag (plan 028). */
export type Inertia = { x: number; z: number; heading: number };
/** No history: the first `followBody` call starts the follower on the body itself. */
export const INERTIA_REST: Inertia = Object.freeze({ x: 0, z: 0, heading: Number.NaN });
// An eighth of a second: long enough for the spring (period about .8 s) to follow the push, short enough that a stop's
// push is gone and the hem within .001 of rest 700 ms later (sprint.spec.ts holds it under .01). .06 was too short to
// move the hem at gains low enough to keep a walk's start apart from a sprint's; .2 left it .0026 out.
const INERTIA_TAU = .12;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Follows the body's velocity and heading with a time constant of INERTIA_TAU, exactly rather than per frame.
 *  The game changes his velocity and heading within one frame, so differentiating them gives hundreds of m/s² for
 *  one tick and nothing after: plan 027's hem went to its clamp on the first frame of every start, turn and stop
 *  (SwiftShader frames, 2026-10-12), and how hard depended on the frame rate. The follower's lag behind the body
 *  is the same curve at any frame rate, a step included. */
export function followBody(state: Inertia, velocity: { x: number; z: number }, heading: number, dt: number): Inertia {
  if (Number.isNaN(state.heading)) return { x: velocity.x, z: velocity.z, heading };
  const k = 1 - Math.exp(-Math.max(0, dt) / INERTIA_TAU);
  return { x: state.x + (velocity.x - state.x) * k, z: state.z + (velocity.z - state.z) * k, heading: state.heading + wrap(heading - state.heading) * k };
}
/** The follower's own acceleration and turn rate, which is its lag over INERTIA_TAU (world axes, m/s²; rad/s): what
 *  `hemDrive` and the satchel's swing are driven by. */
export function bodyLag(state: Inertia, velocity: { x: number; z: number }, heading: number): { accel: { x: number; z: number }; yawRate: number } {
  if (Number.isNaN(state.heading)) return { accel: { x: 0, z: 0 }, yawRate: 0 };
  return { accel: { x: (velocity.x - state.x) / INERTIA_TAU, z: (velocity.z - state.z) / INERTIA_TAU }, yawRate: wrap(heading - state.heading) / INERTIA_TAU };
}

/** How much of the hem's offset a point of cloth at height `y` takes: none at or above `top` (the shoulder
 *  break, where the cloth lies on him), all of it at `bottom` (the lowest point), easing out between. Plan 030 round 2:
 *  eased out (t(2 - t)) rather than smoothstepped. The sheet's poncho ends at the elbows at the sides and high at the
 *  front, a third and a half of the way down to the tails, where a smoothstep gave those hems a third and a half of the
 *  swing (.32 and .58) and the critic saw rigid cloth; eased out they take .61 and .80, and the drape still leaves the
 *  shoulder line with no kink (the weight is 0 there and rises from it). Round 3: eased out harder (a cube, 1 - (1 - t)^3):
 *  the sheet's diamond raised the hem at the arms to .68 of his height, where t(2 - t) gave it .49 of the swing; the cube
 *  gives it .63 and the front point .96. */
export function hemWeight(y: number, top: number, bottom: number): number {
  const t = Math.min(1, Math.max(0, (top - y) / Math.max(1e-6, top - bottom)));
  return 1 - (1 - t) ** 3;
}

// How far a swung hem drops as it swings out, per square metre of offset, so the cloth does not stretch.
const DROOP = 1;
/** The tunic the cloth must stay outside of: [height, radius] pairs, ascending, torso-local. Below the first
 *  and above the last there is nothing to clear. */
export type Tunic = [number, number][];
const tunicRadius = (tunic: Tunic, y: number) => {
  if (!tunic.length || y < tunic[0]![0] || y > tunic[tunic.length - 1]![0]) return 0;
  for (let i = 1; i < tunic.length; i++) if (y <= tunic[i]![0]) { const [y0, r0] = tunic[i - 1]!, [y1, r1] = tunic[i]!; return r0 + (r1 - r0) * (y1 > y0 ? (y - y0) / (y1 - y0) : 0); }
  return 0;
};
/** The clearance kept between the cloth and the tunic. */
export const BODY_CLEAR = .02;

/**
 * Writes the swayed cloth into `out` from its rest positions (xyz triples, torso-local): every vertex moves
 * by the hem's offset times its weight, and drops a little as it swings out. A vertex that ends nearer the
 * torso's axis than both its rest radius and the tunic's radius there plus BODY_CLEAR is pushed back out
 * along its own radius. Vertices from `pinnedFrom` on stay at rest (the strap's drop onto the satchel).
 * One rule for the poncho, its trim and the strap: vertices at the same rest height move the same, so the
 * strap stays on the cloth. `rise` (plan 030 round 3) lifts the hem by that many metres, weighted the same way: the
 * stride's flutter, the hem a beat behind the body's bob.
 */
export function swayCloth(rest: ArrayLike<number>, out: { [index: number]: number; length: number }, hem: Hem, top: number, bottom: number, tunic: Tunic = [], pinnedFrom = Infinity, rise = 0): void {
  const droop = DROOP * (hem.x * hem.x + hem.z * hem.z);
  for (let i = 0, v = 0; i + 2 < rest.length; i += 3, v++) {
    const rx = rest[i]!, ry = rest[i + 1]!, rz = rest[i + 2]!, w = v >= pinnedFrom ? 0 : hemWeight(ry, top, bottom);
    if (w === 0) { out[i] = rx; out[i + 1] = ry; out[i + 2] = rz; continue; }
    let x = rx + w * hem.x, z = rz + w * hem.z;
    const y = ry - w * droop + w * rise, clear = Math.min(Math.hypot(rx, rz), tunicRadius(tunic, y) + BODY_CLEAR), r = Math.hypot(x, z);
    if (r < clear) { if (r > 1e-9) { x *= clear / r; z *= clear / r; } else { x = clear; } }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
}

/** A two-axis pendulum (radians about x and z) for the satchel: driven, damped at a ratio of .3 so it swings
 *  a couple of times and settles, substepped like the hem, and held to ±.35 about x and ±.2 about z. */
export type Pendulum = { x: number; z: number; vx: number; vz: number };
export const PENDULUM_REST: Pendulum = Object.freeze({ x: 0, z: 0, vx: 0, vz: 0 });
export const SWING_MAX = { x: .35, z: .2 } as const;
const SWING_OMEGA = 9, SWING_ZETA = .3;
/** What swings the satchel on its strap (plan 028, moved here from the game): the body's lag acceleration from
 *  `bodyLag` (torso-local, m/s²) swings it fore and aft and side to side, and the right thigh's swing (`hip`, radians)
 *  knocks it forward. .0015 rad per m/s²: a sprint's start swings it about .25 rad, inside its clamp, where plan 027's
 *  .015 on the raw derivative slammed it to SWING_MAX on every start. */
export function swingDrive(accel: { x: number; z: number }, hip: number): { x: number; z: number } {
  return { x: accel.z * SWING_GAIN + hip * .3, z: -accel.x * SWING_GAIN };
}
const SWING_GAIN = .0015;
export function stepPendulum(state: Pendulum, drive: { x: number; z: number }, dt: number): Pendulum {
  let { x, z, vx, vz } = state;
  const steps = Math.max(1, Math.ceil(Math.max(0, dt) / SUBSTEP)), h = Math.max(0, dt) / steps;
  for (let i = 0; i < steps && h > 0; i++) {
    vx += (SWING_OMEGA * SWING_OMEGA * (drive.x - x) - 2 * SWING_ZETA * SWING_OMEGA * vx) * h;
    vz += (SWING_OMEGA * SWING_OMEGA * (drive.z - z) - 2 * SWING_ZETA * SWING_OMEGA * vz) * h;
    x += vx * h; z += vz * h;
    if (Math.abs(x) > SWING_MAX.x) { x = Math.sign(x) * SWING_MAX.x; if (vx * x > 0) vx = 0; }
    if (Math.abs(z) > SWING_MAX.z) { z = Math.sign(z) * SWING_MAX.z; if (vz * z > 0) vz = 0; }
  }
  return { x, z, vx, vz };
}

/** Plan 030 round 3: the hem as the game draws it - the spring's state plus the stride's flutter (dungeon-run-pose.ts),
 *  which is too quick for the spring to carry - held to HEM_MAX together, so a flutter on top of a dash's lift never
 *  throws the back point further than the spring alone could. */
export function clothHem(hem: Hem, flutter: { x: number; z: number }): Hem {
  let x = hem.x + flutter.x, z = hem.z + flutter.z;
  const length = Math.hypot(x, z);
  if (length > HEM_MAX) { x *= HEM_MAX / length; z *= HEM_MAX / length; }
  return { x, z, vx: hem.vx, vz: hem.vz };
}

/** Plan 030 round 3: the stop's settle. The critic saw a stop snap from a stride to a stand and hold there (round 2's
 *  stop sheet: ten identical frames). His upper body carries on over the planted feet and comes back: a forward lean
 *  (radians, positive forward) driven by the body follower's braking, through a spring at 12 rad/s and a damping ratio of
 *  .42: a sprint's stop leans him .18 (10 degrees) a sixth of a second after it, swings him back past upright by .02 at
 *  half a second and leaves him within .005 of upright 700 ms after it (sprint.spec.ts reads the torso's pitch there and
 *  holds it under .01; at .35 it read .011). */
export type Settle = { lean: number; v: number };
export const SETTLE_REST: Settle = Object.freeze({ lean: 0, v: 0 });
const SETTLE_OMEGA = 12, SETTLE_ZETA = .42;
/** The most the settle leans him, and the radians per m/s² of braking (the follower's acceleration backwards along his
 *  facing): a sprint's stop brakes at about 70 m/s² at first, which reaches the clamp; pushing off leans him forward too,
 *  at a third of the gain. */
export const SETTLE_MAX = .3;
const BRAKE_GAIN = .005, PUSH_GAIN = .0016;
/** `back` is the follower's acceleration along his back (torso-local z, m/s²; positive while he brakes a forward run). */
export function settleDrive(back: number): number {
  return Math.min(SETTLE_MAX, Math.max(0, back) * BRAKE_GAIN + Math.max(0, -back) * PUSH_GAIN);
}
export function stepSettle(state: Settle, drive: number, dt: number): Settle {
  let { lean, v } = state;
  const steps = Math.max(1, Math.ceil(Math.max(0, dt) / SUBSTEP)), h = Math.max(0, dt) / steps;
  for (let i = 0; i < steps && h > 0; i++) { v += (SETTLE_OMEGA * SETTLE_OMEGA * (drive - lean) - 2 * SETTLE_ZETA * SETTLE_OMEGA * v) * h; lean += v * h; }
  return { lean: Math.min(SETTLE_MAX, Math.max(-SETTLE_MAX, lean)), v };
}
/** Metres the upper body rides forward over the hips per radian of settle lean: a sprint's stop carries it 3 cm. */
export const SETTLE_SHIFT = .17;

/** Round 4: the sash's two tails, on their own joint under the tabard (dungeon-knight.ts), swung a beat behind the drawn
 *  hem (radians about the tabard's x, forward positive, and z, positive towards his right). The critic saw the tails locked
 *  to the body. They follow a target through a first-order lag (TAILS_RATE, about seven frames at 60 Hz): blown out to his
 *  left (they hang on his left) and back a little by the run, across with the hem's sideways swing, and thrown forward by
 *  a stop's forward throw of the hem, more than the flap is. Held to TAILS_MAX either way, back to TAILS_BACK, so a tail
 *  never swings into the thigh behind it. */
export type Tails = { x: number; z: number };
export const TAILS_REST: Tails = Object.freeze({ x: 0, z: 0 });
export const TAILS_MAX = .6, TAILS_BACK = .12;
const TAILS_RATE = 8;
export function tailsTarget(drawn: { x: number; z: number }, sprint: number): Tails {
  return { x: Math.min(TAILS_MAX, Math.max(-TAILS_BACK, -drawn.z * 5.5 - .1 * sprint)), z: Math.min(TAILS_MAX, Math.max(-TAILS_MAX, drawn.x * 3 - .22 * sprint)) };
}
export function stepTails(state: Tails, target: Tails, dt: number): Tails {
  const k = 1 - Math.exp(-TAILS_RATE * Math.max(0, dt));
  return { x: state.x + (target.x - state.x) * k, z: state.z + (target.z - state.z) * k };
}
