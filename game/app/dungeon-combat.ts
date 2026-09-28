// The two rules that decide whether a blow connects and how much of it lands.
// Kept free of React, the DOM and three.js so node can execute them directly,
// and imported by the running game so tests exercise production rules rather
// than a copy of them.

import { canStand, hasClearPath } from './dungeon-floor.ts';
import { TIDEBLADE, type Special, type Weapon } from './dungeon-weapon.ts';

export type Spot = { x: number; z: number };

/**
 * Whether one sword swing reaches a body: inside the arc's radius, inside its
 * angle, and with nothing in between. `facing` must be a normalised horizontal
 * vector; `reach` is the Long Guard bonus, 0 without it. The radius and the
 * angle both come from the weapon, and Long Guard moves both from there.
 */
export function swordContacts(
  cells: Set<string>,
  from: Spot,
  facing: Spot,
  target: Spot,
  reach: number,
  weapon: Weapon = TIDEBLADE,
) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (!(distance < weapon.reach + reach)) return false;
  // Three.js normalises a zero-length vector to zero rather than dividing by
  // zero, which is what keeps a body standing exactly on the knight out of arc.
  const scale = distance || 1;
  if ((dx / scale) * facing.x + (dz / scale) * facing.z <= weapon.arc - reach * 0.12) {
    return false;
  }
  // Last, because it is the expensive one: the same lane check a skeleton has
  // to pass to swing at the knight. A wall stops steel in both directions.
  return hasClearPath(cells, from, target);
}

/**
 * Whether a body is on the line a lunge cut (plan 016): within `width` of the segment from where the
 * knight started to where he is now, and with nothing in between him and it. The segment is the whole
 * path so far rather than this frame's step, so a body he passed during a frame the caller skipped is
 * still on it; one-hit-per-swing tracking is the caller's, as it is for a swing.
 */
export function lineContacts(cells: Set<string>, from: Spot, to: Spot, target: Spot, width: number) {
  const travelX = to.x - from.x, travelZ = to.z - from.z;
  const span = travelX * travelX + travelZ * travelZ;
  const along = span > 1e-8 ? Math.min(1, Math.max(0, ((target.x - from.x) * travelX + (target.z - from.z) * travelZ) / span)) : 0;
  const nearX = from.x + travelX * along, nearZ = from.z + travelZ * along;
  if (!(Math.hypot(target.x - nearX, target.z - nearZ) < width)) return false;
  return hasClearPath(cells, to, target);
}

/**
 * How far a harpooned body is hauled towards the knight: `drag` units along the line between them, but never
 * closer than `keep`, so it lands in front of him rather than inside him. The caller moves it through
 * `moveOnFloor`, so a wall still stops it.
 */
export const dragToward = (body: Spot, knight: Spot, drag: number, keep = 1) => {
  const dx = knight.x - body.x, dz = knight.z - body.z, distance = Math.hypot(dx, dz);
  const pull = Math.max(0, Math.min(drag, distance - keep));
  return distance > 1e-6 ? { x: dx / distance * pull, z: dz / distance * pull } : { x: 0, z: 0 };
};

/**
 * The body a vault goes over (plan 016 Stage C): the nearest of `bodies` within `range` of the knight whose
 * bearing beats `cone` against the aim, with nothing between him and it. -1 when there is none, and the
 * vault is then a plain hop along the aim.
 */
export function vaultTarget(cells: Set<string>, from: Spot, aim: Spot, bodies: readonly Spot[], range: number, cone: number) {
  let best = -1, nearest = Infinity;
  bodies.forEach((body, index) => {
    const dx = body.x - from.x, dz = body.z - from.z, distance = Math.hypot(dx, dz);
    if (!(distance < range) || distance >= nearest) return;
    if (distance > 1e-6 && (dx * aim.x + dz * aim.z) / distance < cone) return;
    if (!hasClearPath(cells, from, body)) return;
    best = index; nearest = distance;
  });
  return best;
}

/** Steps a hop path is walked in: under half a body radius, so no corner fits between two samples. */
const HOP_STEP = 0.1;

/**
 * Where a vault comes down, and how far that is. It aims `over` units past the body along the line from the
 * knight through it, or `hop` units down the aim with no body. The path is walked the way the dash's own
 * movement is checked - `canStand`, the knight's footprint - and stops at the last sample before stone or a
 * prop, so a hop at a wall lands against it and never inside it. `dir` is the way the path runs.
 */
export function vaultLanding(cells: Set<string>, from: Spot, aim: Spot, target: Spot | null, over: number, hop: number) {
  let dx = aim.x, dz = aim.z, want = hop;
  if (target) {
    const tx = target.x - from.x, tz = target.z - from.z, distance = Math.hypot(tx, tz);
    if (distance > 1e-6) { dx = tx / distance; dz = tz / distance; }
    want = distance + over;
  }
  const length = Math.hypot(dx, dz) || 1; dx /= length; dz /= length;
  const steps = Math.max(1, Math.ceil(want / HOP_STEP));
  let reach = 0;
  for (let i = 1; i <= steps; i++) {
    const along = Math.min(want, i * HOP_STEP);
    if (!canStand(cells, from.x + dx * along, from.z + dz * along)) break;
    reach = along;
  }
  return { x: from.x + dx * reach, z: from.z + dz * reach, distance: reach, dir: { x: dx, z: dz } };
}

/**
 * Whether the held arm's special can be used at all right now, before the timing gate: cooled, for every
 * kind but the draw, which the quiver gates instead (plan 016 Stage C: a dry crossbow cannot draw). Nothing
 * is ready while the arm itself is out of the hand.
 */
export const specialAvailable = (special: Special | undefined, state: { cooled: boolean; quiver: number; out: boolean }) =>
  !!special && !state.out && (special.draw ? state.quiver > 0 : state.cooled);

/**
 * Whether a dash may abort the current swing. `attackTime` is the seconds of swing left, 0 when idle.
 * The blade is live from the end of the anticipation to the end of contact, and that window is a
 * commitment: a dash pressed inside it waits for contact to end. Anticipation and recovery both give
 * way at once. Before this a dash cancelled any swing at any point for free, so committing to an attack
 * never cost anything; then for one release the whole 0.38s swing was locked, which with a held strike
 * key meant a dodge fired up to 0.3s late and a guard's 0.5s tell landed more often than not. Locking
 * only the 0.11s of contact keeps the cost of swinging into a tell without punishing holding the key.
 */
export const canAbortSwing = (attackTime: number, weapon: Weapon = TIDEBLADE) => {
  if (attackTime <= 0) return true;
  const age = weapon.duration - attackTime;
  return age < weapon.anticipation || age >= weapon.contactEnd;
};

/**
 * Whether a special pressed now starts, waits, or is refused (plan 016). It is a swing on the strike's own
 * clock, so it is held to the same commitment a dodge is: it cancels a strike's wind-up or recovery, and
 * waits out a live blade or a dodge in progress (the caller buffers it). It is refused outright while it is
 * cooling down, while it is already live or being charged, while the arm is out of the hand, and for an
 * arm that has none. A detonation with no burning pool to set off is refused too: it would cost a cooldown
 * for nothing, and the Flashpoint promises to cost nothing then.
 */
export const specialGate = (state: { weapon: Weapon; ready: boolean; attackTime: number; swing: Weapon; dashTime: number; specialLive: boolean; busy: boolean; pools?: number }): 'start' | 'wait' | 'refuse' => {
  if (!state.weapon.special || !state.ready || state.busy || state.specialLive) return 'refuse';
  if (state.weapon.special.kind === 'detonate' && !((state.pools ?? 0) > 0)) return 'refuse';
  if (state.dashTime > 0 || !canAbortSwing(state.attackTime, state.swing)) return 'wait';
  return 'start';
};

/**
 * How long a dash pressed into a live blade waits for contact to end. Longer than the contact window,
 * so a press at the first live frame is never dropped.
 */
export const DASH_BUFFER = 0.4;

// How the knight moves, in one place. These lived as literals in two files — the game loop and
// `scripts/balance/sim.ts` — which meant the instrument used to measure a tuning change was tuned
// separately from the thing it measured. A batch that disagrees with the game is worse than no batch.

/** Seconds the dash lasts. */
export const DASH_TIME = 0.24;
/** Units a second while it runs, against WALK_SPEED on open floor. */
export const DASH_SPEED = 19.5;
/**
 * Seconds of immunity from the dash's first frame. Shorter than the dash, so its tail is a
 * commitment: a dash spent early ends inside the blow it was meant to leave.
 *
 * The dash used to be 0.18s at 12 with immunity across all of it — 2.16 units, against 1.04 for
 * walking the same window at the old threatened speed. A net 1.12 against a guard's 1.55 reach and a
 * warden's 2.55, which is to say it turned blows aside without ever leaving them: an invulnerability
 * blink rather than a way to be somewhere else, and the reason every fight was fought standing still.
 *
 * What sets these numbers is one rule — a dash should take the knight out of the attack he dodged.
 * DASH_TIME * (DASH_SPEED - WALK_SPEED) is 2.64, just past a warden's 2.55. The first pass at this
 * was 19, which nets 2.52 and fails the rule by three hundredths — caught by the test that asserts
 * it, which is why the rule is written down as an assertion rather than as a comment.
 * The first cut of this was 0.14s against a 0.6s cooldown, and the batch said what decision 3 warned
 * it might: a warden went from taking 44% of the damage the knight suffered to 7%, which is to say it
 * stopped being the thing in the keep that kills people. 0.1s against 0.8s is 12.5% immunity uptime
 * against the 13% the old dash had — the same defensive value as before, bought with a dash that
 * covers two and a half times the ground. The distance was never one of the levers; it is the fix.
 */
export const DASH_IFRAMES = 0.1;
/** Units a second on open floor, threatened or not. */
export const WALK_SPEED = 8.5;

/** Whether a dash at this point in its run still turns a blow aside. */
export const dashImmune = (dashTime: number) => dashTime > DASH_TIME - DASH_IFRAMES;

/**
 * How fast the knight travels this frame. Committing to a swing costs mobility and always has —
 * `weapon.moveSpeed` is most of what separates a maul from a pair of knives.
 *
 * What is no longer here is a second tax on merely standing near something awake, which used to drop
 * him to 5.8 with no input of his own. It cost mobility exactly when responsiveness mattered, it was
 * most of why the dash barely outran a walk, and the pressure it reached for is already on the table:
 * the two heaviest arms crawl at 1.4 and 1.8 mid-swing.
 */
export const playerSpeed = (
  { dashing, attacking, weapon }: { dashing: boolean; attacking: boolean; weapon: Weapon },
) => dashing ? DASH_SPEED : attacking ? weapon.moveSpeed : WALK_SPEED;

/** What a hit actually costs once the knight's wards are applied. */
export const incomingDamage = (amount: number, guardAgainst: number) =>
  Math.round(amount * guardAgainst);
