import assert from 'node:assert/strict';
import test from 'node:test';
import { canAbortSwing, swordContacts } from '../app/dungeon-combat.ts';
import { PLAYER_ATTACK_ANTICIPATION, PLAYER_ATTACK_CONTACT_END, PLAYER_ATTACK_DURATION, playerAttackPose } from '../app/dungeon-attack-pose.ts';
import { cellKey } from '../app/dungeon-floor.ts';
import { STARTING_WEAPON, TIDEBLADE, WEAPONS, weaponById, type Weapon } from '../app/dungeon-weapon.ts';

const openFloor = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
const cells = openFloor();
const north = { x: 0, z: -1 };

// A weapon the game does not ship, built only to prove the parameter is read rather than ignored. If
// these numbers stopped mattering, every assertion below that compares it to the Tideblade would pass
// by accident, so each one is written as a difference.
const cleaverish: Weapon = { ...TIDEBLADE, id: 'tideblade', duration: 0.62, anticipation: 0.14, contactEnd: 0.3, reach: 2.6, arc: 0.05, damage: 3, moveSpeed: 1.6, knockback: 0.9, wardenKnockback: 0.4 };

test('the Tideblade is the sword the constants used to name', () => {
  // The exported constants are what dungeon-game and the browser suite still read. If the table and
  // the constants drift, the running game and the node suite stop describing the same swing.
  assert.equal(PLAYER_ATTACK_DURATION, TIDEBLADE.duration);
  assert.equal(PLAYER_ATTACK_ANTICIPATION, TIDEBLADE.anticipation);
  assert.equal(PLAYER_ATTACK_CONTACT_END, TIDEBLADE.contactEnd);
  assert.equal(WEAPONS[STARTING_WEAPON], TIDEBLADE);
});

test('an unknown id arms the knight rather than leaving him empty-handed', () => {
  assert.equal(weaponById('a-weapon-that-does-not-exist'), TIDEBLADE);
  assert.equal(weaponById('tideblade'), TIDEBLADE);
});

test('omitting the weapon is the same swing as passing the Tideblade', () => {
  for (const age of [0, 0.03, 0.065, 0.1, 0.175, 0.25, 0.38, 0.5]) {
    assert.deepEqual(playerAttackPose(age), playerAttackPose(age, TIDEBLADE), `age ${age}`);
  }
  for (const left of [0, 0.05, 0.2, 0.31, 0.38]) {
    assert.equal(canAbortSwing(left), canAbortSwing(left, TIDEBLADE), `attackTime ${left}`);
  }
  const target = { x: 0, z: -1.5 };
  assert.equal(swordContacts(cells, { x: 0, z: 0 }, north, target, 0), swordContacts(cells, { x: 0, z: 0 }, north, target, 0, TIDEBLADE));
});

test('the live window moves with the weapon, not with the old constants', () => {
  // Mid-contact for both, but each measured against its own duration: the commitment is the weapon's.
  assert.equal(canAbortSwing(TIDEBLADE.duration - 0.12, TIDEBLADE), false);
  assert.equal(canAbortSwing(cleaverish.duration - 0.2, cleaverish), false);
  // The cleaver is still winding back where the Tideblade is already committed.
  assert.equal(canAbortSwing(cleaverish.duration - 0.1, cleaverish), true);
  assert.equal(canAbortSwing(TIDEBLADE.duration - 0.1, TIDEBLADE), false);
  // Recovery gives way for both.
  assert.equal(canAbortSwing(TIDEBLADE.duration - 0.3, TIDEBLADE), true);
  assert.equal(canAbortSwing(cleaverish.duration - 0.5, cleaverish), true);
});

test('reach and arc come off the weapon', () => {
  const from = { x: 0, z: 0 };
  const far = { x: 0, z: -2.3 };
  assert.equal(swordContacts(cells, from, north, far, 0, TIDEBLADE), false, 'outside the sword');
  assert.equal(swordContacts(cells, from, north, far, 0, cleaverish), true, 'inside the cleaver');
  // Well off to the side: the narrow weapon misses where the wide one connects.
  const wide = { x: -1.3, z: -0.7 };
  assert.equal(swordContacts(cells, from, north, wide, 0, cleaverish), true, 'a near-half-circle takes it');
  assert.equal(swordContacts(cells, from, north, wide, 0, { ...cleaverish, arc: 0.8 }), false, 'a thrust does not');
});

test('a wall still stops steel whatever the weapon is', () => {
  // The lane check runs last and is not a weapon property; a longer blade must not reach through stone.
  const walled = new Set(cells); walled.delete(cellKey(0, -1));
  assert.equal(swordContacts(walled, { x: 0, z: 0 }, north, { x: 0, z: -2.3 }, 0, cleaverish), false);
});

test('the pose still rests outside the swing and goes live inside contact', () => {
  assert.equal(playerAttackPose(cleaverish.duration + 0.01, cleaverish).active, false);
  assert.equal(playerAttackPose(cleaverish.anticipation - 0.01, cleaverish).active, false, 'anticipation is not live');
  assert.equal(playerAttackPose((cleaverish.anticipation + cleaverish.contactEnd) / 2, cleaverish).active, true);
  assert.equal(playerAttackPose(cleaverish.contactEnd + 0.01, cleaverish).active, false, 'recovery is not live');
});
