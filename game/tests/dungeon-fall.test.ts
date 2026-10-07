// Plan 025 D4: bodies and walls. A body's footprint grows with its `look.scale` (`bodyRadius`), for every step it takes and every shove it
// is given, and a body comes down where all of it lies on floor (`deathFall`, which `startDeath` asks when handed the floor's cells). The
// playtest found the Pyre Mother (scale 1.5) standing half in the wall she had backed against, and her corpse lying through it. The running
// game's wiring is boss.spec.ts's Mother-against-a-wall scenario.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BESTIARY } from '../app/dungeon-bestiary.ts';
import { advanceDeath, startDeath } from '../app/dungeon-death.ts';
import { decideEnemy, NOTICE_TIME, type EnemyView } from '../app/dungeon-enemy.ts';
import { BODY_RADIUS, bodyRadius, cellKey, deathFall, moveOnFloor, TILE, type Fallen } from '../app/dungeon-floor.ts';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';

/** A rectangle of floor cells, x 0..w-1 and z 0..d-1, and the world coordinates of its stone edges. */
const room = (w: number, d: number) => {
  const cells = new Set<string>();
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.add(cellKey(x, z));
  return { cells, minX: -TILE / 2, maxX: (w - .5) * TILE, minZ: -TILE / 2, maxZ: (d - .5) * TILE };
};
const onFloor = (cells: Set<string>, x: number, z: number) => cells.has(cellKey(Math.round(x / TILE), Math.round(z / TILE)));

// The Pyre Mother lying down, as measured off her own figure (dungeon-skeleton's mother, the end pose of `startDeath`, x1.5), 2026-10-07:
// x -0.72..0.93 and z -0.66..2.24 at scale 1. Backwards is +z.
const MOTHER: Fallen = { minX: -1.08, maxX: 1.4, minZ: -1, maxZ: 3.36 };

/**
 * Where a fall puts the body, worked out here and not by the module's own sampler: the footprint's points, at a tenth of a unit, turned by
 * three.js the way the game turns the group, every one of which must be over a floor cell.
 */
const offFloor = (cells: Set<string>, at: { x: number; z: number }, yaw: number, fallen: Fallen) => {
  const body = new THREE.Object3D(); body.position.set(at.x, 0, at.z); body.rotation.y = yaw; body.updateMatrixWorld(true);
  const stray: string[] = [];
  for (let x = fallen.minX; x <= fallen.maxX + 1e-9; x += .1) for (let z = fallen.minZ; z <= fallen.maxZ + 1e-9; z += .1) {
    const p = body.localToWorld(new THREE.Vector3(x, 0, z));
    if (!onFloor(cells, p.x, p.z)) stray.push(`${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  }
  return stray;
};
const fallen = (cells: Set<string>, at: { x: number; z: number }, facing: number) => {
  const fall = deathFall(at, facing, MOTHER, cells);
  return { ...fall, stray: offFloor(cells, { x: at.x + fall.shift.x, z: at.z + fall.shift.z }, facing + fall.turn, MOTHER) };
};

test('a body killed with a wall behind it comes down on the floor, not through the wall', () => {
  const r = room(8, 8), at = { x: 3.5 * TILE, z: r.maxZ - .5 };
  // Facing -z, into the room: her own way down is backwards, into the wall half a unit behind her.
  assert.ok(offFloor(r.cells, at, 0, MOTHER).length > 0, 'precondition: falling backwards where she stands puts her through the wall');
  const fall = fallen(r.cells, at, 0);
  assert.deepEqual(fall.stray, [], `the corpse lies over stone at ${fall.stray.slice(0, 4).join(' ')} (turn ${fall.turn.toFixed(2)}, shift ${fall.shift.x.toFixed(2)},${fall.shift.z.toFixed(2)})`);
  assert.ok(Math.hypot(fall.shift.x, fall.shift.z) <= 3, 'it slid more than three units to find floor');
});

test('a body with a wall behind it and one in front comes down sideways, where it stands', () => {
  // Three tiles deep: 4.44 of floor across, against 4.36 of her lying down, so neither backwards nor forwards fits from the middle.
  const r = room(10, 3), at = { x: 4.5 * TILE, z: TILE };
  assert.ok(offFloor(r.cells, at, 0, MOTHER).length > 0 && offFloor(r.cells, at, Math.PI, MOTHER).length > 0, 'precondition: neither her own way down nor the opposite one fits');
  const fall = fallen(r.cells, at, 0);
  assert.deepEqual(fall.stray, [], `the corpse lies over stone at ${fall.stray.slice(0, 4).join(' ')}`);
  assert.equal(Math.abs(Math.abs(fall.turn) - Math.PI / 2) < 1e-9, true, `she fell at a turn of ${fall.turn.toFixed(2)}, not to a side`);
  assert.deepEqual(fall.shift, { x: 0, z: 0 }, 'she slid, though a side fitted where she stood');
});

test('a body killed in a corner slides out of it and comes down on the floor', () => {
  const r = room(8, 8), at = { x: r.maxX - .5, z: r.maxZ - .5 };
  // Facing out of the corner, toward the middle of the room, as a body backed into it faces the knight.
  const facing = Math.atan2(at.x - 3.5 * TILE, at.z - 3.5 * TILE);
  for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) assert.ok(offFloor(r.cells, at, facing + turn, MOTHER).length > 0, `precondition: a turn of ${turn.toFixed(2)} already fits in the corner`);
  const fall = fallen(r.cells, at, facing);
  assert.deepEqual(fall.stray, [], `the corpse lies over stone at ${fall.stray.slice(0, 4).join(' ')}`);
  assert.ok(Math.hypot(fall.shift.x, fall.shift.z) > 0, 'precondition: nothing fitted without sliding, so the slide is what was tested');
});

test('a body in the open falls its own way, where it stands', () => {
  const r = room(9, 9);
  assert.deepEqual(deathFall({ x: 4 * TILE, z: 4 * TILE }, .7, MOTHER, r.cells), { turn: 0, shift: { x: 0, z: 0 } });
});

test('a Mother-sized body walking into a wall stops 0.48 short of it, not the knight\'s 0.32', () => {
  assert.equal(bodyRadius('mother'), BODY_RADIUS * 1.5);
  assert.equal(bodyRadius('mother'), .48);
  const r = room(4, 4), at = { x: 1.5 * TILE, z: 1.5 * TILE };
  moveOnFloor(r.cells, at, 20, 0, bodyRadius('mother'));
  const gap = r.maxX - at.x;
  assert.ok(gap < .48 + .15, `precondition: she did not reach the wall (${gap.toFixed(3)} from it)`);
  assert.ok(gap >= .48 - 1e-9, `she stands ${gap.toFixed(3)} from the wall, inside it at her scale`);
});

test('a big body already overlapping stone walks out of it rather than freezing', () => {
  const r = room(4, 4), at = { x: r.maxX - .2, z: 1.5 * TILE };
  moveOnFloor(r.cells, at, -1, 0, bodyRadius('mother'));
  assert.ok(r.maxX - at.x > .9, `she moved only to ${(r.maxX - at.x).toFixed(3)} from the wall`);
});

test('the Mother backing away from a close knight is stopped by the wall at her own radius', () => {
  const r = room(6, 6), world = { cells: r.cells, activeRoom: 1, pathDistance: () => 0 };
  let enemy: EnemyView = { kind: 'mother', x: 2.5 * TILE, z: 2.5 * TILE, room: 1, cooldown: 99, hitFlash: 0, windup: 0, lunge: 0, tell: .8, speed: 2.1, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: NOTICE_TIME, hp: 50, maxHp: 50, move: 0, phase: 0, change: 0 };
  assert.ok(BESTIARY.mother.keepAway > 1.5, 'precondition: the Mother gives ground to a knight closer than her keep-away');
  for (let frame = 0; frame < 600; frame++) {
    const intent = decideEnemy(enemy, { x: enemy.x - 1.2, z: enemy.z }, world, 1 / 60);
    enemy = { ...enemy, x: intent.x, z: intent.z, cooldown: 99 };
  }
  const gap = r.maxX - enemy.x;
  assert.ok(gap < .48 + .15, `precondition: she backed all the way to the wall (${gap.toFixed(3)} from it)`);
  assert.ok(gap >= .48 - 1e-9, `she backed to ${gap.toFixed(3)} from the wall, inside it at her scale`);
});

test('startDeath, handed the floor, lays the Mother\'s real figure on floor with a wall at her back', () => {
  const r = room(8, 8), group = makeSkeleton('mother');
  group.scale.set(...BESTIARY.mother.look.scale); group.position.set(3.5 * TILE, .03, r.maxZ - .55); group.rotation.y = 0;
  const death = startDeath(group, 'mother', r.cells);
  for (const joint of death.joints) { joint.node.position.copy(joint.endPosition); joint.node.quaternion.copy(joint.endRotation); }
  group.updateWorldMatrix(true, true);
  const stray: string[] = [];
  (group.userData.rig as THREE.Group).traverseVisible(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(node);
    for (const [x, z] of [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z]]) if (!onFloor(r.cells, x, z)) stray.push(`${node.name || node.type} ${x.toFixed(2)},${z.toFixed(2)}`);
  });
  assert.deepEqual(stray, [], 'a part of her corpse lies over stone');
  // The same body without the floor falls its own way, through the wall: the cells are what moved her.
  const blind = makeSkeleton('mother'); blind.scale.copy(group.scale); blind.position.set(3.5 * TILE, .03, r.maxZ - .55);
  const blindDeath = startDeath(blind, 'mother'); advanceDeath(blindDeath, 10); blind.updateWorldMatrix(true, true);
  assert.ok(new THREE.Box3().setFromObject(blind.userData.rig).max.z > r.maxZ, 'precondition: without the floor she would have come down through the wall');
});
