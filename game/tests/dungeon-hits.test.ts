import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMITTED_WINDUP, HIT_COOLDOWN, RECOVERY } from '../app/dungeon-enemy.ts';
import { canStand, cellKey, TILE } from '../app/dungeon-floor.ts';
import { awayFrom, burn, HIT_FLASH, landBlow, type Blow, type Struck } from '../app/dungeon-hits.ts';
import { TIDEBLADE, weaponById } from '../app/dungeon-weapon.ts';

// What steel, a bolt and fire each do to the body they land on - the sequence the frame loop used to
// write out inline three times.

/** An open floor of `w` by `h` tiles from the origin. */
const floor = (w: number, h: number) => {
  const cells = new Set<string>();
  for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) cells.add(cellKey(x, z));
  return cells;
};
const body = (kind: Struck['kind'], over: Partial<Struck> = {}): Struck => ({ kind, hp: 10, windup: 0, cooldown: 0, hitFlash: 0, ...over });
const blow = (over: Partial<Blow> = {}): Blow => ({ damage: 3, stagger: false, knockback: 0.4, wardenKnockback: 0.1, ...over });

test('a blow takes its damage, flashes the body, and reports a kill only at zero', () => {
  const cells = floor(5, 5), guard = body('guard', { hp: 4 }), at = { x: 2 * TILE, z: 2 * TILE };
  assert.deepEqual(landBlow(cells, guard, at, blow(), { x: 1, z: 0 }), { broke: false, killed: false });
  assert.equal(guard.hp, 1);
  assert.equal(guard.hitFlash, HIT_FLASH);
  assert.equal(landBlow(cells, guard, at, blow(), { x: 1, z: 0 }).killed, true);
});

test('a blow breaks a committed windup on a guard, and never a warden\'s without stagger', () => {
  const cells = floor(5, 5), wound = COMMITTED_WINDUP + 0.1;
  const guard = body('guard', { windup: wound });
  assert.equal(landBlow(cells, guard, { x: 2 * TILE, z: 2 * TILE }, blow(), { x: 1, z: 0 }).broke, true);
  assert.equal(guard.windup, 0);
  assert.equal(guard.cooldown, HIT_COOLDOWN, 'plain steel buys only the ordinary cooldown');

  const warden = body('warden', { windup: wound });
  assert.equal(landBlow(cells, warden, { x: 2 * TILE, z: 2 * TILE }, blow(), { x: 1, z: 0 }).broke, false);
  assert.equal(warden.windup, wound, 'the committed swing goes on');

  const staggered = body('warden', { windup: wound });
  assert.equal(landBlow(cells, staggered, { x: 2 * TILE, z: 2 * TILE }, blow({ stagger: true }), { x: 1, z: 0 }).broke, true);
  assert.equal(staggered.cooldown, RECOVERY.warden, 'a stagger arm that broke the swing keeps it down');
});

test('an early tell is not broken, and a blow never shortens a cooldown already running', () => {
  const guard = body('guard', { windup: COMMITTED_WINDUP - 0.05, cooldown: 2 });
  assert.equal(landBlow(floor(5, 5), guard, { x: 2 * TILE, z: 2 * TILE }, blow({ stagger: true }), { x: 1, z: 0 }).broke, false);
  assert.equal(guard.windup, COMMITTED_WINDUP - 0.05);
  assert.equal(guard.cooldown, 2);
});

test('a blow shoves along its heading, a warden less, and a wall stops it', () => {
  const cells = floor(5, 5), from = { x: 2 * TILE, z: 2 * TILE };
  const guardAt = { ...from }, wardenAt = { ...from };
  landBlow(cells, body('guard'), guardAt, blow(), { x: 0, z: 1 });
  landBlow(cells, body('warden'), wardenAt, blow(), { x: 0, z: 1 });
  assert.equal(guardAt.x, from.x);
  assert.ok(Math.abs(guardAt.z - from.z - 0.4) < 1e-9);
  assert.ok(Math.abs(wardenAt.z - from.z - 0.1) < 1e-9);

  const pinned = { x: 2 * TILE, z: 4 * TILE };
  landBlow(cells, body('guard'), pinned, blow({ knockback: 5 }), { x: 0, z: 1 });
  assert.ok(canStand(cells, pinned.x, pinned.z), 'the body is still on the floor');
  assert.ok(pinned.z - 4 * TILE < TILE / 2, 'the edge of the floor stopped a shove meant to carry it five units');
});

test('a blade drives a body straight away from the knight, as THREE.Vector3.normalize would', () => {
  const push = awayFrom({ x: 1, z: 1 }, { x: 4, z: -3 });
  const scale = 1 / Math.sqrt(3 * 3 + 0 + -4 * -4);
  assert.deepEqual(push, { x: 3 * scale, z: -4 * scale });
  assert.deepEqual(awayFrom({ x: 2, z: 2 }, { x: 2, z: 2 }), { x: 0, z: 0 }, 'a body on top of the knight is not shoved');
});

test('the real arms carry what a blow reads', () => {
  const maul = weaponById('maul');
  for (const arm of [TIDEBLADE, maul]) {
    const guard = body('guard', { hp: 100 });
    landBlow(floor(5, 5), guard, { x: 2 * TILE, z: 2 * TILE }, { ...arm, damage: arm.damage + 1 }, { x: 1, z: 0 });
    assert.equal(guard.hp, 100 - arm.damage - 1);
  }
  assert.equal(maul.stagger, true, 'the fixture wants a stagger arm');
});

test('fire bites for its damage and flashes, with no stagger and no shove', () => {
  const guard = body('guard', { hp: 2, windup: COMMITTED_WINDUP + 0.2, cooldown: 0.1 });
  assert.equal(burn(guard, 1), false);
  assert.deepEqual(guard, body('guard', { hp: 1, windup: COMMITTED_WINDUP + 0.2, cooldown: 0.1, hitFlash: HIT_FLASH }));
  assert.equal(burn(guard, 1), true);
});
