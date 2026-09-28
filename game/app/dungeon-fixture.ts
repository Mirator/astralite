// The development-only combat fixture: which existing actors a browser test may move, and to what.
// Deliberately narrow - no code, no arbitrary paths, no new combat rules - and validated here, away from
// the world closure, so the refusals are plain functions a node test can hold to their messages. The
// game installs `configureCombatFixture` only outside production and hands this its live actors.

import { NOTICE_TIME } from './dungeon-enemy.ts';

export type CombatFixture = {
  health?: number;
  enemies?: { index: number; x?: number; z?: number; hp?: number; windup?: number; cooldown?: number; aim?: { x: number; z: number } }[];
};

/** The slice of a live enemy the fixture may read and write. `group.position` and `aim` are the live vectors. */
export type FixtureEnemy = {
  dead: boolean; hp: number; maxHp: number; windup: number; tell: number; cooldown: number; notice: number;
  group: { position: { x: number; y: number; z: number } };
  aim: { x: number; y: number; z: number };
};

export type FixtureWorld = {
  started: boolean;
  /** Paused, or the driver owns the clock: nothing moves between the fixture and the next step. */
  held: boolean;
  run: { hp: number; maxHp: number };
  enemies: FixtureEnemy[];
  canStand: (x: number, z: number) => boolean;
  /** Told the new vitality the moment it is written, before anything later in the fixture can refuse. */
  healthSet?: (hp: number) => void;
};

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
};

/**
 * Applies a fixture to the live actors, or throws naming the first thing it refuses. Every change to
 * one enemy is checked before it is written, in the order the fields are listed, so a refused field
 * leaves the ones before it written - which is what the closure this came from did.
 */
export const applyCombatFixture = (fixture: CombatFixture, world: FixtureWorld) => {
  if (!world.started) throw new Error('start the run before staging a combat fixture');
  if (!world.held) throw new Error('pause or take manual time before staging a combat fixture');
  if (fixture.health !== undefined) {
    const value = Math.round(finite(fixture.health, 'health'));
    if (value < 1 || value > world.run.maxHp) throw new Error(`health must be between 1 and ${world.run.maxHp}`);
    world.run.hp = value; world.healthSet?.(value);
  }
  for (const change of fixture.enemies ?? []) {
    const enemy = world.enemies[change.index];
    if (!enemy) throw new Error(`no enemy at spawn index ${change.index}`);
    if (enemy.dead) throw new Error(`enemy ${change.index} is already dead`);
    if (change.x !== undefined || change.z !== undefined) {
      const x = finite(change.x ?? enemy.group.position.x, 'x');
      const z = finite(change.z ?? enemy.group.position.z, 'z');
      if (!world.canStand(x, z)) throw new Error(`enemy ${change.index} cannot stand at ${x}, ${z}`);
      enemy.group.position.x = x; enemy.group.position.z = z;
    }
    if (change.hp !== undefined) {
      const value = Math.round(finite(change.hp, 'hp'));
      if (value < 1 || value > enemy.maxHp) throw new Error(`enemy ${change.index} hp must be 1..${enemy.maxHp}`);
      enemy.hp = value;
    }
    if (change.windup !== undefined) {
      const value = finite(change.windup, 'windup');
      if (value < 0 || value > enemy.tell) throw new Error(`enemy ${change.index} windup must be 0..${enemy.tell}`);
      enemy.windup = value;
      // A windup only ever exists on a body that has already cleared its notice beat - decideEnemy
      // holds windup untouched until `notice` reaches NOTICE_TIME. Staging one on a still-dozing
      // spawn (notice 0) would otherwise stage an impossible state: a swing frozen behind a beat it
      // can never finish inside a fixture's short window.
      enemy.notice = NOTICE_TIME;
    }
    if (change.cooldown !== undefined) {
      const value = finite(change.cooldown, 'cooldown');
      if (value < 0) throw new Error(`enemy ${change.index} cooldown cannot be negative`);
      enemy.cooldown = value;
    }
    if (change.aim !== undefined) {
      const x = finite(change.aim.x, 'aim.x'), z = finite(change.aim.z, 'aim.z');
      if (!Math.hypot(x, z)) throw new Error(`enemy ${change.index} aim cannot be zero`);
      // `THREE.Vector3.set(x, 0, z).normalize()`, spelled out: divided by its length through a reciprocal.
      const scale = 1 / (Math.sqrt(x * x + 0 + z * z) || 1);
      enemy.aim.x = x * scale; enemy.aim.y = 0; enemy.aim.z = z * scale;
    }
  }
};
