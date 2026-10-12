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
// the critic saw no cloth move; at 10 and .5 it arrives at .42 of its size and about a quarter cycle late.
const OMEGA = 10, ZETA = .5, SUBSTEP = 1 / 120;

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
// hit the cap and the gains did nothing).
const ACCEL_GAIN = .0012, TURN_GAIN = .004;
/** The most the body's acceleration and turn together pull the hem, in metres, before any lift (plan 028). */
export const INERTIA_MAX = .04;
/** Where the hem is pulled to, torso-local: away from the body's acceleration (so a start leaves it behind
 *  and a stop throws it forward), out against a turn, back by `lift` (the run pose's `cape`, or
 *  DASH_CAPE in a dash: metres of trail) and across by `sway` (the run pose's stride sway, plan 030). The
 *  acceleration and turn part is capped at INERTIA_MAX. */
export function hemDrive(input: { accel: { x: number; z: number }; yawRate: number; lift: number; sway?: number }): { x: number; z: number } {
  let x = -input.accel.x * ACCEL_GAIN - input.yawRate * TURN_GAIN, z = -input.accel.z * ACCEL_GAIN;
  const pull = Math.hypot(x, z);
  if (pull > INERTIA_MAX) { x *= INERTIA_MAX / pull; z *= INERTIA_MAX / pull; }
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
 *  break, where the cloth lies on him), all of it at `bottom` (the lowest point), smoothstepped between. */
export function hemWeight(y: number, top: number, bottom: number): number {
  const t = Math.min(1, Math.max(0, (top - y) / Math.max(1e-6, top - bottom)));
  return t * t * (3 - 2 * t);
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
 * strap stays on the cloth.
 */
export function swayCloth(rest: ArrayLike<number>, out: { [index: number]: number; length: number }, hem: Hem, top: number, bottom: number, tunic: Tunic = [], pinnedFrom = Infinity): void {
  const droop = DROOP * (hem.x * hem.x + hem.z * hem.z);
  for (let i = 0, v = 0; i + 2 < rest.length; i += 3, v++) {
    const rx = rest[i]!, ry = rest[i + 1]!, rz = rest[i + 2]!, w = v >= pinnedFrom ? 0 : hemWeight(ry, top, bottom);
    if (w === 0) { out[i] = rx; out[i + 1] = ry; out[i + 2] = rz; continue; }
    let x = rx + w * hem.x, z = rz + w * hem.z;
    const y = ry - w * droop, clear = Math.min(Math.hypot(rx, rz), tunicRadius(tunic, y) + BODY_CLEAR), r = Math.hypot(x, z);
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
