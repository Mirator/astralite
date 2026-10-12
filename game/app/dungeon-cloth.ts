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
// The spring: 8 rad/s at a damping ratio of .6 - it reaches a step in about a quarter second and overshoots it
// by a tenth, and a hem thrown to the clamp by a hard stop is back within a centimetre of rest in 700 ms
// (sprint.spec.ts reads it there; .5 left it at .0095).
const OMEGA = 8, ZETA = .6, SUBSTEP = 1 / 120;

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

// Gains from the plan's starting values, judged in gameplay frames: metres of trail per m/s² of the body's
// acceleration, and per rad/s of its turn.
const ACCEL_GAIN = .02, TURN_GAIN = .03;
/** Where the hem is pulled to, torso-local: away from the body's acceleration (so a start leaves it behind
 *  and a stop throws it forward), out against a turn, and back by `lift` (the run pose's `cape`, or
 *  DASH_CAPE in a dash: metres of trail). */
export function hemDrive(input: { accel: { x: number; z: number }; yawRate: number; lift: number }): { x: number; z: number } {
  return { x: -input.accel.x * ACCEL_GAIN - input.yawRate * TURN_GAIN, z: -input.accel.z * ACCEL_GAIN + input.lift };
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
