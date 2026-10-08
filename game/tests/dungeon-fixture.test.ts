import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTICE_TIME } from '../app/dungeon-enemy.ts';
import { applyCombatFixture, type FixtureWorld } from '../app/dungeon-fixture.ts';

const world = (): FixtureWorld => ({
  started: true,
  held: true,
  run: { hp: 80, maxHp: 100 },
  enemies: [
    { dead: false, hp: 30, maxHp: 30, windup: 0, tell: 0.5, cooldown: 0, notice: 0, group: { position: { x: 0, y: 0.03, z: 0 } }, aim: { x: 1, y: 0, z: 0 } },
    { dead: true, hp: 0, maxHp: 30, windup: 0, tell: 0.5, cooldown: 0, notice: 0, group: { position: { x: 1, y: 0.03, z: 1 } }, aim: { x: 1, y: 0, z: 0 } },
  ],
  canStand: (x) => x < 10,
});

test('a fixture only lands on a started run with the clock held', () => {
  assert.throws(() => applyCombatFixture({}, { ...world(), started: false }), /start the run/);
  assert.throws(() => applyCombatFixture({}, { ...world(), held: false }), /pause or take manual time/);
});

test('health is rounded, bounded and reported the moment it is written', () => {
  const w = world();
  let told = -1;
  w.healthSet = (hp) => { told = hp; };
  applyCombatFixture({ health: 12.4 }, w);
  assert.equal(w.run.hp, 12);
  assert.equal(told, 12);
  assert.throws(() => applyCombatFixture({ health: 0 }, w), /between 1 and 100/);
  assert.throws(() => applyCombatFixture({ health: Number.NaN }, w), /finite/);
});

test('an enemy change is refused for a missing, dead or unstandable body', () => {
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 5 }] }, world()), /no enemy at spawn index 5/);
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 1, hp: 3 }] }, world()), /already dead/);
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 0, x: 20 }] }, world()), /cannot stand at 20, 0/);
});

test('a staged windup clears the notice beat, and aim is normalised like a THREE vector', () => {
  const w = world();
  applyCombatFixture({ enemies: [{ index: 0, x: 2, z: 3, hp: 5, windup: 0.25, cooldown: 1, aim: { x: 3, z: 4 } }] }, w);
  const e = w.enemies[0];
  assert.deepEqual(e.group.position, { x: 2, y: 0.03, z: 3 });
  assert.equal(e.hp, 5);
  assert.equal(e.windup, 0.25);
  assert.equal(e.notice, NOTICE_TIME);
  assert.equal(e.cooldown, 1);
  const scale = 1 / Math.sqrt(3 * 3 + 0 + 4 * 4);
  assert.deepEqual(e.aim, { x: 3 * scale, y: 0, z: 4 * scale });
});

test('out-of-range values name the field and its bounds', () => {
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 0, hp: 31 }] }, world()), /hp must be 1\.\.30/);
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 0, windup: 0.6 }] }, world()), /windup must be 0\.\.0\.5/);
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 0, cooldown: -1 }] }, world()), /cooldown cannot be negative/);
  assert.throws(() => applyCombatFixture({ enemies: [{ index: 0, aim: { x: 0, z: 0 } }] }, world()), /aim cannot be zero/);
});

test('a body the fixture moves forgets the spot it was walking to (plan 025 D3), and one it does not move keeps it', () => {
  const w = world(), walking = { still: 0, to: { x: 4, z: 4 }, walked: 1 };
  w.enemies[0].roam = { ...walking };
  applyCombatFixture({ enemies: [{ index: 0, hp: 5 }] }, w);
  assert.deepEqual(w.enemies[0].roam, walking, 'a change that did not move the body cleared its walk');
  applyCombatFixture({ enemies: [{ index: 0, x: 2, z: 3 }] }, w);
  assert.deepEqual(w.enemies[0].roam, { still: 0, to: null, walked: 0 }, 'a body placed somewhere else still walks to a spot picked from where it stood');
});
