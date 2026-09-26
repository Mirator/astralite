// The knight's own clocks: the swing, the dash, the chain, the two input buffers and hit-stop. These
// used to be a dozen loose `let`s inside the world closure in dungeon-game.tsx, which meant the rules
// they carry - when a press buffers, when a buffered dash may cut in, when a string links, what a dodge
// cancels - could only be checked by booting WebGL. They are plain data now, and every rule that moves
// them is here, free of three.js, React and the DOM so node's type stripping can run it.
//
// Nothing in this file plays a sound, clears a trail or poses the rig. The game calls these at the same
// points it always did and does its own presentation around them, so the order of every write is the
// order the closure had.

import { canAbortSwing, DASH_BUFFER, DASH_TIME, playerSpeed } from './dungeon-combat.ts';
import { playerAttackPose } from './dungeon-attack-pose.ts';
import { beatOf, chainLength, TIDEBLADE, type Weapon } from './dungeon-weapon.ts';

/**
 * A direction on the floor. The game hands in `THREE.Vector3`s, which satisfy this, and only `x` and `z`
 * are ever written - so a vector's `y` stays the zero it was built with.
 */
export type Heading = { x: number; z: number };

export type PlayerControl = {
  /** What the knight is holding. */
  weapon: Weapon;
  /** What the live swing is resolved against: the arm itself on beat 0, an overlay on it after that. */
  swing: Weapon;
  attackTime: number;
  dashTime: number;
  dashCooldown: number;
  /** A strike pressed while the knight was busy, and how long it is kept. */
  attackBuffer: number;
  /** A dodge pressed while the blade was live, and how long it waits for the recovery. */
  dashBuffer: number;
  /** The frozen clock after a landed blow. Real time, never shortened by reduced motion. */
  hitStop: number;
  /** Which beat of the string the running swing is, counting from zero. */
  chainBeat: number;
  /** How long since the last swing ended; Infinity when no string is open. */
  chainIdle: number;
  facing: Heading;
  /** Where the running swing points, fixed when it starts. */
  attackFacing: Heading;
  /** Where the running dash goes, fixed when it starts. */
  dashFacing: Heading;
  /** Where a buffered strike will point when it fires, or null with nothing buffered. */
  bufferedFacing: Heading | null;
};

/** How long a strike pressed while busy is held for. */
export const ATTACK_BUFFER = 0.18;
/** The heading a fresh knight faces, before normalisation. */
export const START_FACING: Heading = { x: 1, z: -0.6 };

const copy = (to: Heading, from: Heading) => { to.x = from.x; to.z = from.z; };
const lengthSq = (v: Heading) => v.x * v.x + v.z * v.z;

/**
 * Normalises in place exactly as `THREE.Vector3.normalize` does for a vector with `y = 0`: divided by
 * its length through a reciprocal, with a zero vector left alone.
 */
export const normalise = (v: Heading) => {
  const scale = 1 / (Math.sqrt(v.x * v.x + 0 + v.z * v.z) || 1);
  v.x *= scale; v.z *= scale;
  return v;
};

export const createPlayerControl = (headings?: { facing: Heading; attackFacing: Heading; dashFacing: Heading }): PlayerControl => {
  const p: PlayerControl = {
    weapon: TIDEBLADE, swing: TIDEBLADE,
    attackTime: 0, dashTime: 0, dashCooldown: 0, attackBuffer: 0, dashBuffer: 0, hitStop: 0,
    chainBeat: 0, chainIdle: Infinity,
    facing: headings?.facing ?? { x: 0, z: 0 },
    attackFacing: headings?.attackFacing ?? { x: 0, z: 0 },
    dashFacing: headings?.dashFacing ?? { x: 0, z: 0 },
    bufferedFacing: null,
  };
  faceStart(p);
  return p;
};

/** Every heading back to where a fresh knight looks. */
export const faceStart = (p: PlayerControl) => {
  copy(p.facing, START_FACING); normalise(p.facing);
  copy(p.attackFacing, p.facing); copy(p.dashFacing, p.facing);
};

/** A new run: every clock stopped, nothing buffered, and the string closed on the arm in hand. */
export const resetControl = (p: PlayerControl) => {
  p.attackTime = 0; p.dashTime = 0; p.dashCooldown = 0; p.attackBuffer = 0; p.dashBuffer = 0; p.hitStop = 0;
  closeChain(p);
  p.bufferedFacing = null;
};

/** The knight on his mark on a new floor: swing and dash stopped, buffers dropped, cooldown kept. */
export const haltControl = (p: PlayerControl) => {
  p.attackTime = 0; p.dashTime = 0; p.attackBuffer = 0; p.dashBuffer = 0;
  closeChain(p);
};

/** Pressed inputs forgotten: a pause, a lost focus, a floor finished. */
export const dropBuffers = (p: PlayerControl) => {
  p.attackBuffer = 0; p.dashBuffer = 0; p.bufferedFacing = null;
};

/** The next strike opens a fresh string on the arm in hand. */
export const closeChain = (p: PlayerControl) => {
  p.chainBeat = 0; p.chainIdle = Infinity; p.swing = p.weapon;
};

/**
 * A different arm in hand. A swap mid-swing drops the swing, and a string belongs to the arm that
 * swings it: carrying a half-finished one across would open the new weapon on its heavy beat.
 */
export const armWith = (p: PlayerControl, weapon: Weapon) => {
  p.weapon = weapon;
  p.attackTime = 0;
  closeChain(p);
};

/**
 * The first thing a frame does with its time: a frame spent in hit-stop is time the world does not get.
 * Returns the delta the world should be stepped by.
 */
export const frameStep = (p: PlayerControl, frameDt: number) => {
  const dt = p.hitStop > 0 ? 0 : frameDt;
  p.hitStop = Math.max(0, p.hitStop - frameDt);
  return dt;
};

/** The knight is free to open a swing: not in one and not dashing. */
export const canSwing = (p: PlayerControl) => p.attackTime <= 0 && p.dashTime <= 0;

/**
 * Opens a swing. Continues the string if the last swing ended recently enough, else starts a new one;
 * the window is the arm's own, and an arm with no chain has one beat. `aim` is where the swing was asked
 * to point, or null to keep the facing (a buffered facing, if there is one, wins over the current one).
 */
export const startSwing = (p: PlayerControl, aim: Heading | null) => {
  const linking = p.chainIdle <= (p.weapon.chain?.window ?? 0) && p.chainBeat + 1 < chainLength(p.weapon);
  p.chainBeat = linking ? p.chainBeat + 1 : 0;
  p.chainIdle = 0;
  p.swing = beatOf(p.weapon, p.chainBeat);
  p.attackTime = p.swing.duration; p.attackBuffer = 0;
  if (aim) { p.facing.x = aim.x; p.facing.z = aim.z; }
  else if (p.bufferedFacing) copy(p.facing, p.bufferedFacing);
  p.bufferedFacing = null;
  copy(p.attackFacing, p.facing);
};

/** A strike pressed while busy: held for `ATTACK_BUFFER`, pointing where it was aimed or straight on. */
export const bufferSwing = (p: PlayerControl, aim: Heading | null) => {
  p.attackBuffer = ATTACK_BUFFER;
  p.bufferedFacing = aim ? { x: aim.x, z: aim.z } : { x: p.facing.x, z: p.facing.z };
};

/**
 * A dodge press. While the blade is live the swing is a commitment: the dash waits in its buffer for
 * contact to end instead of cutting it short. Otherwise it goes where the stick points, or straight on,
 * and a dodge is a way out of a string as well as out of a blow. Returns whether the dash started.
 */
export const startDash = (p: PlayerControl, input: Heading, dashSpan: number) => {
  if (!canAbortSwing(p.attackTime, p.swing)) { p.dashBuffer = DASH_BUFFER; return false; }
  p.dashBuffer = 0;
  copy(p.dashFacing, lengthSq(input) ? input : p.facing);
  copy(p.facing, p.dashFacing); p.dashTime = DASH_TIME; p.dashCooldown = dashSpan;
  closeChain(p);
  p.attackTime = 0; p.attackBuffer = 0; p.dashBuffer = 0; p.bufferedFacing = null; p.hitStop = 0;
  return true;
};

/** Both input buffers and the dash cooldown run down; an expired strike buffer forgets its facing. */
export const tickBuffers = (p: PlayerControl, dt: number) => {
  p.attackBuffer = Math.max(0, p.attackBuffer - dt); p.dashBuffer = Math.max(0, p.dashBuffer - dt);
  if (p.attackBuffer === 0) p.bufferedFacing = null;
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
};

/**
 * A dash that waited out the live blade goes first, the moment the recovery begins and ahead of the
 * next held swing, or holding strike would swallow every dodge pressed mid-swing.
 */
export const bufferedDashReady = (p: PlayerControl) => p.dashTime <= 0 && p.dashBuffer > 0 && canAbortSwing(p.attackTime, p.swing);

/** A buffered press or a held button opens the next swing the moment the knight is free. */
export const swingReady = (p: PlayerControl, holding: boolean) => canSwing(p) && (p.attackBuffer > 0 || holding);

/**
 * Walking turns the knight only while he is free; a swing and a dash keep the heading they started
 * with. Returns the heading the body should turn toward this frame.
 */
export const steer = (p: PlayerControl, input: Heading) => {
  if (lengthSq(input) > 0 && canSwing(p)) copy(p.facing, input);
  return p.dashTime > 0 ? p.dashFacing : p.facing;
};

/** How fast the knight travels this frame, for what he is doing and with what. */
export const travelSpeed = (p: PlayerControl) => playerSpeed({ dashing: p.dashTime > 0, attacking: p.attackTime > 0, weapon: p.swing });

/** Which way he travels: the dash's heading while dashing, the stick's otherwise. */
export const travelHeading = (p: PlayerControl, input: Heading) => p.dashTime > 0 ? p.dashFacing : input;

/** The dash's own clock, run down after the frame has read whether it is still going. */
export const dashStep = (p: PlayerControl, dt: number) => { p.dashTime = Math.max(0, p.dashTime - dt); };

/**
 * The swing's clock. Returns null between swings; during one, how far into the swing it now is and
 * whether the blade was already live before this step - the frame a ranged arm looses on is the one
 * where it goes live.
 */
export const swingStep = (p: PlayerControl, dt: number): { age: number; wasLive: boolean } | null => {
  p.chainIdle = p.attackTime > 0 ? 0 : p.chainIdle + dt;
  if (p.attackTime <= 0) return null;
  const wasLive = playerAttackPose(p.swing.duration - p.attackTime, p.swing, p.chainBeat).active;
  p.attackTime = Math.max(0, p.attackTime - dt);
  return { age: p.swing.duration - p.attackTime, wasLive };
};
