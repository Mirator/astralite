// What a landed blow does to the body it lands on: the damage, the flash, whether it broke a windup, how
// long the body is kept off its feet, how far it is shoved, and whether it died. Steel, bolts and fire
// used to each write that sequence out inline in the frame loop in dungeon-game.tsx, the sword and the
// bolt line for line the same, so a rule change had to be made twice and could only be checked by
// booting WebGL. It lives here now, free of three.js, React and the DOM so node's type stripping can run
// it; what a kill pays, and every spark, sound and shake around a blow, stays with the game.

import { hitCooldown, interruptsWindup, type EnemyKind } from './dungeon-enemy.ts';
import { moveOnFloor } from './dungeon-floor.ts';
import { normalise, type Heading } from './dungeon-player.ts';

/** The part of a live enemy a blow writes to. The game's `Enemy` satisfies it. */
export type Struck = { kind: EnemyKind; hp: number; windup: number; cooldown: number; hitFlash: number };

/** What the blow carries: a swing's beat, or the arm that loosed a bolt, with the knight's strike added in. */
export type Blow = { damage: number; stagger: boolean; knockback: number; wardenKnockback: number };

/** How long a struck body shows white. */
export const HIT_FLASH = 0.2;

/** The way a blade drives a body: from the knight to it, flat on the floor, as `Vector3.normalize` gives it. */
export const awayFrom = (from: Heading, to: Heading) => normalise({ x: to.x - from.x, z: to.z - from.z });

/**
 * Steel or a bolt landing. `at` is the body's position and is moved in place, stopped by walls the same
 * way a step is; `push` is the unit heading it is driven along. A warden takes its own, smaller shove.
 * `broke` says the blow cut a windup short, which the game answers by dropping the swing's trails.
 */
export const landBlow = (cells: Set<string>, target: Struck, at: Heading, blow: Blow, push: Heading) => {
  target.hp -= blow.damage; target.hitFlash = HIT_FLASH;
  const broke = interruptsWindup(target.kind, target.windup, blow.stagger);
  if (broke) target.windup = 0;
  target.cooldown = Math.max(target.cooldown, hitCooldown(target.kind, broke, blow.stagger));
  const shove = target.kind === 'warden' ? blow.wardenKnockback : blow.knockback;
  moveOnFloor(cells, at, push.x * shove, push.z * shove);
  return { broke, killed: target.hp <= 0 };
};

/** Fire on the ground biting: damage and a flash, no stagger and no shove. Returns whether it killed. */
export const burn = (target: Struck, damage: number) => {
  target.hp -= damage; target.hitFlash = HIT_FLASH;
  return target.hp <= 0;
};
