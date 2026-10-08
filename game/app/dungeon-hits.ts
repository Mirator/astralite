// What a landed blow does to the body it lands on: the damage, the flash, whether it broke a windup, how
// long the body is kept off its feet, how far it is shoved, and whether it died. Steel, bolts and fire
// used to each write that sequence out inline in the frame loop in dungeon-game.tsx, the sword and the
// bolt line for line the same, so a rule change had to be made twice and could only be checked by
// booting WebGL. It lives here now, free of three.js, React and the DOM so node's type stripping can run
// it; what a kill pays, and every spark, sound and shake around a blow, stays with the game.

import { BESTIARY, BOSS_PUSH_MARGIN, bossReach, HIT_COOLDOWN, hitCooldown, interruptsWindup, type EnemyKind } from './dungeon-enemy.ts';
import { bodyRadius, moveOnFloor } from './dungeon-floor.ts';
import { normalise, type Heading } from './dungeon-player.ts';
import { swordContacts, type Spot } from './dungeon-combat.ts';
import type { Furnishing, PropKind } from './dungeon-furnish.ts';
import type { Weapon } from './dungeon-weapon.ts';

/**
 * The part of a live enemy a blow writes to. The game's `Enemy` satisfies it. `change` is the seconds of a boss's phase change
 * still to run (`EnemyView.change`): while it does, nothing writes to the body at all. Absent for a body that has none. `bossPhase` is the phase
 * it is in (`EnemyView.phase`), which a boss's shield reads: absent for a body that has none, which is phase zero.
 */
export type Struck = { kind: EnemyKind; hp: number; windup: number; cooldown: number; hitFlash: number; change?: number; bossPhase?: number };

/** Whether a boss is standing in a phase change, which nothing damages (plan 021 D3). */
export const unhittable = (target: Pick<Struck, 'change'>) => (target.change ?? 0) > 0;

/**
 * What the blow carries: a swing's beat, or the arm that loosed a bolt, with the knight's strike added in. `bolt` (plan 023) marks a blow a crossbow bolt lands (the arm's `bolt` flag, dungeon-weapon.ts: the Keep Crossbow's bolt and its Heavy Bolt)
 * which `landBlow` multiplies by `BOSS_BOLT` on a boss; absent is a blow of steel, a flask or a thrown spear.
 */
export type Blow = { damage: number; stagger: boolean; knockback: number; wardenKnockback: number; bolt?: boolean };

/**
 * Plan 023 (D3): a crossbow bolt deals this many times its damage to a boss. The crossbow works in the chambers, where a body has a few quarter-hits of vitality, and fails only where vitality is in the hundreds: a quiver of four with one bolt
 * back every 1.8 s is about five damage a second, against a boss's 150 to 630. A boss multiplier is the narrowest fix and leaves the arm's room play, where it is balanced, alone. The Heavy Bolt is multiplied too.
 * A dial from 2 to 4 (the range set while tuning): D3's target is that the crossbow special escapes at least half as often as the default knight, and 4 is the lowest that meets it at the shipped state (30 and 60 runs: x2 18.3%, x3 33.3%, x4 48.3% of 60,
 * against the default knight's 90 to 93; progress.md, plan 023 Stage D).
 */
export const BOSS_BOLT = 4;

/** How long a struck body shows white. */
export const HIT_FLASH = 0.2;

/** The way a blade drives a body: from the knight to it, flat on the floor, as `Vector3.normalize` gives it. */
export const awayFrom = (from: Heading, to: Heading) => normalise({ x: to.x - from.x, z: to.z - from.z });

/**
 * Whether a blow is turned aside by a shield. Only a kind that carries one (`shield` in the bestiary), only
 * from the front - the blow's heading `push` runs from the knight to the body, so a body facing him meets
 * it head on - and only while the shield is up: not while the body winds up, and not while it recovers
 * from its own swing, which leaves more than a plain blow's HIT_COOLDOWN on the clock. A stagger arm
 * breaks the guard outright, and a boss's shield (`until`) is gone from the phase it breaks in (plan 021, the Bastion's second phase).
 * `facing` is the unit heading the body looks along.
 */
export const blocks = (target: Pick<Struck, 'kind' | 'windup' | 'cooldown' | 'bossPhase'>, facing: Heading, push: Heading, stagger: boolean) => {
  const shield = BESTIARY[target.kind].shield;
  if (!shield || stagger || target.windup > 0 || target.cooldown > HIT_COOLDOWN) return false;
  if (shield.until !== undefined && (target.bossPhase ?? 0) >= shield.until) return false;
  return facing.x * push.x + facing.z * push.z < -shield.arc;
};

/**
 * Steel or a bolt landing. `at` is the body's position and is moved in place, stopped by walls the same
 * way a step is; `push` is the unit heading it is driven along. A steadfast body (the warden) takes its
 * own, smaller shove.
 * `broke` says the blow cut a windup short, which the game answers by dropping the swing's trails.
 */
export const landBlow = (cells: Set<string>, target: Struck, at: Heading, blow: Blow, push: Heading, facing?: Heading) => {
  // A boss changing phase takes nothing: no wound, no flinch and no shove, so a blow that would have carried it over its next
  // threshold cannot skip a phase, and the knight cannot burst through the change.
  if (unhittable(target)) return { broke: false, killed: false, blocked: false, immune: true as const };
  // Turned aside: no wound, no flinch, the tell untouched and only a third of the shove.
  if (facing && blocks(target, facing, push, blow.stagger)) {
    moveOnFloor(cells, at, push.x * blow.knockback / 3, push.z * blow.knockback / 3, bodyRadius(target.kind));
    return { broke: false, killed: false, blocked: true };
  }
  target.hp -= blow.bolt && BESTIARY[target.kind].boss ? blow.damage * BOSS_BOLT : blow.damage; target.hitFlash = HIT_FLASH;
  const broke = interruptsWindup(target.kind, target.windup, blow.stagger);
  if (broke) target.windup = 0;
  target.cooldown = Math.max(target.cooldown, hitCooldown(target.kind, broke, blow.stagger));
  const shove = BESTIARY[target.kind].steadfast ? blow.wardenKnockback : blow.knockback;
  moveOnFloor(cells, at, push.x * shove, push.z * shove, bodyRadius(target.kind));
  return { broke, killed: target.hp <= 0, blocked: false };
};

/** Fire on the ground biting: damage and a flash, no stagger and no shove. Returns whether it killed. */
export const burn = (target: Struck, damage: number) => {
  if (unhittable(target)) return false;
  target.hp -= damage; target.hitFlash = HIT_FLASH;
  return target.hp <= 0;
};

/**
 * The knock that opens a phase change (plan 021 D3): the displacement, from the boss's feet straight away through the knight,
 * that leaves him `BOSS_PUSH_MARGIN` beyond the boss's farthest melee reach (`bossReach`), or nothing when he already stands
 * beyond it. The first time an enemy moves the knight, so it is a displacement for the caller to walk with `moveOnFloor`, which
 * stops at walls as every step does; a knight with his back to one is left where the wall stops him.
 */
export const bossPush = (boss: { kind: EnemyKind; x: number; z: number }, knight: Heading): Heading => {
  const gap = Math.hypot(knight.x - boss.x, knight.z - boss.z), away = gap > 1e-6 ? awayFrom(boss, knight) : { x: 1, z: 0 }, travel = Math.max(0, bossReach(boss.kind) + BOSS_PUSH_MARGIN - gap);
  return { x: away.x * travel, z: away.z * travel };
};

// --- Plan 025 Stage F (D12 a): props that do something --------------------------------------------------------------------------------------------
// What stands where is dungeon-furnish.ts; what a prop does when steel finds it, when it goes up, or when something stands on it is here, so the game and
// the balance sim ask the same rules. Steel and fire break a prop; a bolt flies over it (only cover stops a bolt, by being out of `cells`).

/** Vitality a sip from a broken urn or crate gives back, and the pearls a chest always holds (a pearl from an urn or a crate is one). */
export const SIP = 8;
export const CHEST_PEARLS = 3;
/**
 * A powder keg, struck, burns its fuse for `KEG_FUSE` seconds (the telegraph: it smokes and flashes) and then goes up: everything within `KEG_RADIUS`
 * world units takes it, the knight `KEG_HURT` (not warded, as the keep's own embers are not; a dash's immunity turns it aside) and every body
 * `KEG_DAMAGE`, which fells a floor-one guard. A keg caught in another's blast lights on `KEG_CHAIN`, a breakable caught in one breaks and pays.
 */
export const KEG_FUSE = 0.9;
export const KEG_CHAIN = 0.25;
export const KEG_RADIUS = 2.4;
export const KEG_HURT = 15;
export const KEG_DAMAGE = 8;
/**
 * A spike plate runs a `SPIKE_CYCLE`-second cycle from its own `phase`: down, then `SPIKE_TELL` seconds of telegraph (the spikes show at the slots), then
 * `SPIKE_UP` seconds up, biting the knight `SPIKE_HURT` and a body `SPIKE_DAMAGE`, each once a rise, if it stands within `PLATE_REACH` of the plate's
 * centre on both axes (the plate is a tile's square, a little inside its edges).
 */
export const SPIKE_CYCLE = 3.2;
export const SPIKE_TELL = 0.7;
export const SPIKE_UP = 0.45;
export const SPIKE_HURT = 8;
export const SPIKE_DAMAGE = 4;
export const PLATE_REACH = 0.62;

/** A prop as a fight holds it: its furnishing, where it stands in world units, and its state. `fuse` is the seconds a lit keg has left, -1 when unlit; `rise` and `bitten` keep a plate to one bite a rise. */
export type LiveProp = Furnishing & { at: Heading; broken: boolean; fuse: number; rise: number; bitten: Set<number> };
export const liveProps = (furniture: readonly Furnishing[], tile: number): LiveProp[] => furniture.map(p => ({ ...p, at: { x: p.x * tile, z: p.z * tile }, broken: false, fuse: -1, rise: -1, bitten: new Set<number>() }));
/** Whether a blow breaks it (an urn, a crate, a chest) rather than lights it (a keg) or passes it by (cover, a plate). */
export const breakable = (kind: PropKind) => kind === 'urn' || kind === 'crate' || kind === 'chest';
/** Whether steel can find it at all: standing, and a kind a blow does something to. */
export const strikable = (prop: LiveProp) => !prop.broken && (breakable(prop.kind) || (prop.kind === 'keg' && prop.fuse < 0));

/** A blow lands on a prop: a breakable breaks (`broke`, and it is spent), an unlit keg lights its fuse (`lit`). Anything else, or a prop already spent, takes nothing. */
export const strikeProp = (prop: LiveProp, fuse = KEG_FUSE): { broke: boolean; lit: boolean } => {
  if (!strikable(prop)) return { broke: false, lit: false };
  if (prop.kind === 'keg') { prop.fuse = fuse; return { broke: false, lit: true }; }
  prop.broken = true;
  return { broke: true, lit: false };
};

/** The props one swing reaches: every strikable prop the arc finds, by the same contact rule a body is found by (`swordContacts`). Indices into `props`. */
export const swingProps = (cells: Set<string>, from: Spot, facing: Spot, reach: number, weapon: Weapon, props: readonly LiveProp[]) =>
  props.flatMap((prop, index) => strikable(prop) && swordContacts(cells, from, facing, prop.at, reach, weapon) ? [index] : []);

/** A lit keg's fuse one frame on: true on the frame it goes up, which spends it. */
export const fuseStep = (prop: LiveProp, dt: number) => {
  if (prop.broken || prop.fuse < 0) return false;
  prop.fuse -= Math.max(0, dt);
  if (prop.fuse > 0) return false;
  prop.fuse = -1; prop.broken = true;
  return true;
};

/**
 * What a keg that has gone up at `keg.at` catches: whether the knight stands in it, the bodies (indices into `bodies`) and the other props that do.
 * Pure: it says who; the caller hurts, burns, breaks and lights (`strikeProp(prop, KEG_CHAIN)`). A body or the knight exactly on the edge is outside.
 */
export const blastOf = (keg: Pick<LiveProp, 'at'>, knight: Heading, bodies: readonly Heading[], props: readonly LiveProp[]) => {
  const inside = (p: Heading) => Math.hypot(p.x - keg.at.x, p.z - keg.at.z) < KEG_RADIUS;
  return { knight: inside(knight), bodies: bodies.flatMap((body, index) => inside(body) ? [index] : []), props: props.flatMap((prop, index) => prop.at !== keg.at && strikable(prop) && inside(prop.at) ? [index] : []) };
};

/** Where a plate is in its cycle at time `t`: `down`, `tell` (the telegraph, `SPIKE_TELL` long) or `up` (`SPIKE_UP` long, at the end of the cycle). */
export const spikeState = (t: number, phase: number): 'down' | 'tell' | 'up' => {
  const at = ((t + phase * SPIKE_CYCLE) % SPIKE_CYCLE + SPIKE_CYCLE) % SPIKE_CYCLE;
  return at >= SPIKE_CYCLE - SPIKE_UP ? 'up' : at >= SPIKE_CYCLE - SPIKE_UP - SPIKE_TELL ? 'tell' : 'down';
};
/** Whether a point stands on a plate. */
export const onPlate = (plate: Pick<LiveProp, 'at'>, x: number, z: number) => Math.abs(x - plate.at.x) < PLATE_REACH && Math.abs(z - plate.at.z) < PLATE_REACH;
/**
 * Whether the plate bites `victim` (any number naming who: the game and the sim use -1 for the knight and a body's index) standing at `x`, `z` at time `t`:
 * the spikes are up, the victim is on the plate, and it has not been bitten this rise. A bite is remembered on the plate until the next rise.
 */
export const spikeBites = (plate: LiveProp, t: number, victim: number, x: number, z: number) => {
  if (plate.kind !== 'spikes' || spikeState(t, plate.phase) !== 'up' || !onPlate(plate, x, z)) return false;
  const rise = Math.floor((t + plate.phase * SPIKE_CYCLE) / SPIKE_CYCLE);
  if (rise !== plate.rise) { plate.rise = rise; plate.bitten.clear(); }
  if (plate.bitten.has(victim)) return false;
  plate.bitten.add(victim);
  return true;
};
