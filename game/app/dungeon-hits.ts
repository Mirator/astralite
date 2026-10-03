// What a landed blow does to the body it lands on: the damage, the flash, whether it broke a windup, how
// long the body is kept off its feet, how far it is shoved, and whether it died. Steel, bolts and fire
// used to each write that sequence out inline in the frame loop in dungeon-game.tsx, the sword and the
// bolt line for line the same, so a rule change had to be made twice and could only be checked by
// booting WebGL. It lives here now, free of three.js, React and the DOM so node's type stripping can run
// it; what a kill pays, and every spark, sound and shake around a blow, stays with the game.

import { BESTIARY, BOSS_PUSH_MARGIN, bossReach, HIT_COOLDOWN, hitCooldown, interruptsWindup, type EnemyKind } from './dungeon-enemy.ts';
import { moveOnFloor } from './dungeon-floor.ts';
import { normalise, type Heading } from './dungeon-player.ts';

/**
 * The part of a live enemy a blow writes to. The game's `Enemy` satisfies it. `change` is the seconds of a boss's phase change
 * still to run (`EnemyView.change`): while it does, nothing writes to the body at all. Absent for a body that has none. `bossPhase` is the phase
 * it is in (`EnemyView.phase`), which a boss's shield reads: absent for a body that has none, which is phase zero.
 */
export type Struck = { kind: EnemyKind; hp: number; windup: number; cooldown: number; hitFlash: number; change?: number; bossPhase?: number };

/** Whether a boss is standing in a phase change, which nothing damages (plan 021 D3). */
export const unhittable = (target: Pick<Struck, 'change'>) => (target.change ?? 0) > 0;

/** What the blow carries: a swing's beat, or the arm that loosed a bolt, with the knight's strike added in. */
export type Blow = { damage: number; stagger: boolean; knockback: number; wardenKnockback: number };

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
    moveOnFloor(cells, at, push.x * blow.knockback / 3, push.z * blow.knockback / 3);
    return { broke: false, killed: false, blocked: true };
  }
  target.hp -= blow.damage; target.hitFlash = HIT_FLASH;
  const broke = interruptsWindup(target.kind, target.windup, blow.stagger);
  if (broke) target.windup = 0;
  target.cooldown = Math.max(target.cooldown, hitCooldown(target.kind, broke, blow.stagger));
  const shove = BESTIARY[target.kind].steadfast ? blow.wardenKnockback : blow.knockback;
  moveOnFloor(cells, at, push.x * shove, push.z * shove);
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
