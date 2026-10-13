import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_ATTACK_ANTICIPATION,
  PLAYER_ATTACK_CONTACT_END,
  PLAYER_ATTACK_LAUNCH,
  playerAttackPose,
  STRIKE_LEAN,
  strikeLean,
  strikePlant,
} from '../app/dungeon-attack-pose.ts';
import { TIDEBLADE, WEAPONS } from '../app/dungeon-weapon.ts';

// The two windows are no longer the same window. Damage is combat's and still
// runs from the anticipation to the contact end; the trail is the eye's and
// opens at the launch, because a blade that is moving and leaves no ribbon is
// the thing that made contact unreadable. Every live frame still trails.
test('damage stays combat’s window, the trail opens with the cut', () => {
  const beforeLaunch = playerAttackPose(PLAYER_ATTACK_LAUNCH - 0.000001);
  const launched = playerAttackPose(PLAYER_ATTACK_LAUNCH);
  const beforeContact = playerAttackPose(PLAYER_ATTACK_ANTICIPATION - 0.000001);
  const firstContact = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const lastContact = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  const after = playerAttackPose(PLAYER_ATTACK_CONTACT_END + 0.000001);
  assert.equal(beforeLaunch.active, false);
  assert.equal(beforeLaunch.trail, false);
  assert.equal(launched.active, false);
  assert.equal(launched.trail, true);
  assert.equal(beforeContact.active, false);
  assert.equal(beforeContact.trail, true);
  assert.equal(firstContact.active, true);
  assert.equal(firstContact.trail, true);
  assert.equal(lastContact.active, true);
  assert.equal(lastContact.trail, true);
  assert.equal(after.active, false);
  assert.equal(after.trail, false);
  for (let frame = 0; frame <= 60; frame++) {
    const pose = playerAttackPose(frame / 60);
    if (pose.active) assert.equal(pose.trail, true, `a live frame at ${frame / 60}s left no ribbon`);
  }
});

test('an odd beat is the same cut from the other shoulder', () => {
  const age = TIDEBLADE.anticipation + 0.03;
  const first = playerAttackPose(age, TIDEBLADE, 0);
  const second = playerAttackPose(age, TIDEBLADE, 1);
  const third = playerAttackPose(age, TIDEBLADE, 2);

  // The lateral channels flip and nothing else does: a back-cut is the same arm at the same height
  // travelling the other way, so negating pitch or reach would swing it at the floor.
  assert.equal(second.swordYaw, -first.swordYaw);
  assert.equal(second.swordRoll, -first.swordRoll);
  assert.equal(second.bodyYaw, -first.bodyYaw);
  assert.equal(second.bodyRoll, -first.bodyRoll);
  assert.equal(second.swordPitch, first.swordPitch);
  assert.equal(second.armReach, first.armReach);
  assert.equal(second.active, first.active);
  assert.equal(second.trail, first.trail);

  // Even beats come back to the original side, so a three-beat string reads left, right, left.
  assert.equal(third.swordYaw, first.swordYaw);
  // And the default is the unmirrored swing every arm had before strings existed.
  assert.deepEqual(playerAttackPose(age, TIDEBLADE), first);
});

// Plan 030: the critic read the strike as an arm swung on a still torso. The body winds 25 degrees back against the
// cut and whips through past the aim, so the torso turns about 48 degrees through the swing (plan 027: 31).
// Round 4 (the critic: no anticipation, a body that barely turns): 30 degrees back and 31 past the aim, 61 in all, held
// through the follow-through's first key. Round 3's -.44 and .40 fail here.
test('a strike winds the torso back about 30 degrees and whips it through past the aim (plan 030)', () => {
  const ages = Array.from({ length: 121 }, (_, i) => TIDEBLADE.duration * i / 120), yaws = ages.map(age => playerAttackPose(age).bodyYaw);
  const wound = Math.min(...yaws), through = Math.max(...yaws);
  assert.ok(wound <= -.5, `the wind-up turns the torso only ${wound.toFixed(3)}`);
  assert.ok(through >= .52, `the cut carries the torso only ${through.toFixed(3)} past the aim`);
  const held = playerAttackPose(TIDEBLADE.contactEnd + (TIDEBLADE.duration - TIDEBLADE.contactEnd) * .14).bodyYaw;
  assert.ok(held >= .5, `the follow-through lets the torso back to ${held.toFixed(3)} at once`);
  // The deepest wind is before the blade goes live and the furthest turn after it: a whip, not a drift.
  assert.ok(ages[yaws.indexOf(wound)]! < TIDEBLADE.anticipation && ages[yaws.indexOf(through)]! >= TIDEBLADE.anticipation, 'the torso winds after the blow or whips before it');
});

test('a strike plants his feet through the live window and lets them go in the recovery; a ranged arm never plants (plan 030)', () => {
  for (const weapon of Object.values(WEAPONS)) {
    const live = Array.from({ length: 11 }, (_, i) => weapon.anticipation + (weapon.contactEnd - weapon.anticipation) * i / 10).map(age => strikePlant(age, weapon));
    if (weapon.ranged) { assert.ok(live.every(p => p === 0), `${weapon.id} plants its feet to shoot`); continue; }
    // Held through the whole live window: the blow lands on a set front foot and holds there.
    assert.ok(live.every(p => p === 1), `${weapon.id} is only ${Math.min(...live).toFixed(2)} planted while the blow is live`);
    assert.ok(strikePlant(weapon.anticipation * .1, weapon) < 1, `${weapon.id} is planted on the first frame of the wind-up`);
    assert.equal(strikePlant(weapon.duration - .001, weapon), 0, `${weapon.id} is still planted at the end of its recovery`);
  }
  assert.ok(Object.values(WEAPONS).some(w => w.ranged) && Object.values(WEAPONS).some(w => !w.ranged), 'precondition: the armoury has ranged and swung arms');
  assert.deepEqual([strikePlant(0), strikePlant(-1), strikePlant(Number.NaN), strikePlant(TIDEBLADE.duration)], [0, 0, 0, 0], 'the feet plant outside a swing');
});

test('a strike rocks the torso back on the wind-up, drives it over the front foot through the cut and holds it there (plan 030 round 4)', () => {
  // The critic: the blade swept by the arms on a body that never moved, and back to idle at once. Visual only, on the
  // swing's own clock: nothing here moves a hit window.
  for (const weapon of Object.values(WEAPONS)) {
    const at = (age: number) => strikeLean(age, weapon), recovery = weapon.duration - weapon.contactEnd;
    if (weapon.ranged) { for (let i = 0; i <= 20; i++) assert.equal(at(weapon.duration * i / 20), 0, `${weapon.id} leans to shoot`); continue; }
    const launch = weapon.anticipation * PLAYER_ATTACK_LAUNCH / TIDEBLADE.anticipation;
    assert.ok(at(launch - 1e-4) <= STRIKE_LEAN.back * .9, `${weapon.id} leans only ${at(launch - 1e-4).toFixed(3)} back as the cut starts`);
    assert.ok(at(weapon.contactEnd) >= STRIKE_LEAN.forward * .99, `${weapon.id} leans only ${at(weapon.contactEnd).toFixed(3)} forward as the cut ends`);
    // Held through the follow-through (the first fifth of the recovery), upright by its end.
    assert.ok(at(weapon.contactEnd + recovery * .25) >= STRIKE_LEAN.forward * .9, `${weapon.id} straightens up at once after the cut`);
    assert.ok(Math.abs(at(weapon.duration - 1e-4)) < .005, `${weapon.id} still leans ${at(weapon.duration - 1e-4).toFixed(3)} at the end of its recovery`);
  }
  assert.ok(STRIKE_LEAN.forward >= .15 && STRIKE_LEAN.back <= -.05, `the strike leans ${STRIKE_LEAN.back} to ${STRIKE_LEAN.forward}`);
  assert.deepEqual([strikeLean(0), strikeLean(-1), strikeLean(Number.NaN), strikeLean(TIDEBLADE.duration)].map(v => v + 0), [0, 0, 0, 0], 'he leans outside a swing');
});
