import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_ATTACK_ANTICIPATION,
  PLAYER_ATTACK_CONTACT_END,
  PLAYER_ATTACK_LAUNCH,
  playerAttackPose,
} from '../app/dungeon-attack-pose.ts';
import { TIDEBLADE } from '../app/dungeon-weapon.ts';

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
