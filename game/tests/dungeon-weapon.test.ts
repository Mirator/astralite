import assert from 'node:assert/strict';
import test from 'node:test';
import { canAbortSwing, swordContacts, WALK_SPEED } from '../app/dungeon-combat.ts';
import { playerAttackPose } from '../app/dungeon-attack-pose.ts';
import { cellKey } from '../app/dungeon-floor.ts';
import { beatOf, chainLength, FOUND_WEAPONS, STARTING_WEAPON, TIDEBLADE, WEAPONS, type Weapon, type WeaponId } from '../app/dungeon-weapon.ts';

const openFloor = (half = 8) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
const cells = openFloor();
const north = { x: 0, z: -1 };

// A weapon the game does not ship, built only to prove the parameter is read rather than ignored. If
// these numbers stopped mattering, every assertion below that compares it to the Tideblade would pass
// by accident, so each one is written as a difference.
const cleaverish: Weapon = { ...TIDEBLADE, id: 'tideblade', duration: 0.62, anticipation: 0.14, contactEnd: 0.3, reach: 2.6, arc: 0.05, damage: 3, moveSpeed: 1.6, knockback: 0.9, wardenKnockback: 0.4 };

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

test('every arm in the table is a coherent swing', () => {
  for (const [id, weapon] of Object.entries(WEAPONS)) {
    assert.equal(weapon.id, id, `${id} is filed under its own id`);
    assert.ok(weapon.anticipation > 0 && weapon.anticipation < weapon.contactEnd, `${id} winds back before it is live`);
    assert.ok(weapon.contactEnd < weapon.duration, `${id} recovers after contact ends`);
    assert.ok(weapon.reach > 0, `${id} has some reach`);
    // An arm has to hurt something somehow: on contact, or through whatever it leaves on the ground.
    // The Tideflask is the one that does nothing at all on contact, and all of it afterwards.
    assert.ok(weapon.damage > 0 || (weapon.burst && weapon.burst.damage > 0), `${id} cannot hurt anything`);
    assert.ok(weapon.arc >= 0 && weapon.arc < 1, `${id} has an arc, not a point`);
    // Swinging must never be faster than walking, or the swing stops being a commitment at all.
    assert.ok(weapon.moveSpeed > 0 && weapon.moveSpeed < 8.5, `${id} is slower mid-swing than unthreatened`);
    assert.ok(weapon.knockback >= weapon.wardenKnockback, `${id} moves a warden no further than an ordinary body`);
  }
});

test('what lies on the floor is every arm but the one the knight walks in with', () => {
  assert.ok(!FOUND_WEAPONS.includes(STARTING_WEAPON), 'the drop is never the sword already in hand');
  assert.deepEqual([...FOUND_WEAPONS].sort(), Object.keys(WEAPONS).filter(id => id !== STARTING_WEAPON).sort());
});

test('a chain overlays the arm rather than replacing it', () => {
  const chained = (Object.keys(WEAPONS) as WeaponId[]).filter(id => WEAPONS[id].chain);
  assert.deepEqual(chained.sort(), ['fangs', 'tideblade'], 'only the two light melee arms chain');

  for (const id of chained) {
    const arm = WEAPONS[id];
    assert.equal(beatOf(arm, 0), arm, 'beat zero is the arm itself, untouched');
    assert.equal(chainLength(arm), 1 + arm.chain!.beats.length);
    assert.ok(arm.chain!.window > 0 && arm.chain!.window < 0.5, `${id}'s link window is human-sized`);

    const beats = Array.from({ length: chainLength(arm) }, (_, i) => beatOf(arm, i));
    for (const [index, beat] of beats.entries()) {
      // Every beat is a complete weapon, or something downstream reads an undefined number.
      assert.equal(beat.id, arm.id);
      assert.ok(beat.duration > 0 && beat.anticipation > 0, `${id} beat ${index} has a clock`);
      assert.ok(beat.anticipation < beat.contactEnd && beat.contactEnd <= beat.duration,
        `${id} beat ${index} winds up, connects, then recovers`);
      assert.ok(beat.damage > 0 && beat.reach > 0);
      assert.ok(beat.moveSpeed > 0 && beat.moveSpeed < WALK_SPEED,
        `${id} beat ${index} is slower mid-swing than walking`);
    }

    // The point of the last beat is that it costs something and pays something. A finish that were
    // merely another copy of the opener would leave the held key exactly as shapeless as before.
    const first = beats[0], last = beats[beats.length - 1];
    assert.ok(last.damage > first.damage, `${id} finishes harder than it opens`);
    assert.ok(last.duration > first.duration, `${id} finishes slower than it opens`);
    assert.ok(last.contactEnd - last.anticipation > first.contactEnd - first.anticipation,
      `${id}'s finish is committed for longer, which is what a dash cannot cut`);
    assert.ok(last.moveSpeed <= first.moveSpeed, `${id} is rooted harder on its finish`);
  }
});
