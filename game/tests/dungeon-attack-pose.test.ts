import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_ATTACK_ANTICIPATION,
  PLAYER_ATTACK_CONTACT_END,
  PLAYER_ATTACK_DURATION,
  PLAYER_ATTACK_LAUNCH,
  playerAttackPose,
} from '../app/dungeon-attack-pose.ts';
import { TIDEBLADE } from '../app/dungeon-weapon.ts';

const numericFields = ['swordYaw', 'swordPitch', 'swordRoll', 'bodyYaw', 'bodyRoll', 'armReach'] as const;

test('attack pose is finite, clamps idle time, and returns to exact rest', () => {
  const rest = playerAttackPose(0);
  for (const age of [-1, 0, PLAYER_ATTACK_DURATION, PLAYER_ATTACK_DURATION + 1, Number.NaN]) {
    assert.deepEqual(playerAttackPose(age), rest);
  }
  for (let frame = 0; frame <= 60; frame++) {
    const pose = playerAttackPose(frame / 60);
    for (const field of numericFields) assert.ok(Number.isFinite(pose[field]), `${field} at frame ${frame}`);
    assert.equal(typeof pose.active, 'boolean');
    assert.equal(typeof pose.trail, 'boolean');
  }
});

test('backswing and recovery meet the cut continuously with no initial snap', () => {
  const start = playerAttackPose(0);
  const justAfterStart = playerAttackPose(0.001);
  assert.ok(justAfterStart.swordYaw > -0.05, 'the sword should ease away from rest');
  assert.ok(justAfterStart.bodyYaw > -0.01, 'the torso should ease away from rest');

  // The deepest backswing is at the launch, not at the end of the anticipation:
  // the arm commits inside the last fifth of the wind-up so that the blade is
  // already travelling on the frame combat opens contact.
  const deepest = playerAttackPose(PLAYER_ATTACK_LAUNCH);
  assert.ok(deepest.swordYaw < start.swordYaw);
  assert.ok(Math.abs(deepest.swordYaw + 1.2) < 0.000001);
  assert.ok(Math.abs(deepest.bodyYaw + 0.2) < 0.000001);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_LAUNCH - 0.000001).swordYaw - deepest.swordYaw) < 0.001);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_LAUNCH + 0.000001).swordYaw - deepest.swordYaw) < 0.001);

  // By the first live frame the cut is a third of the way round, which is the
  // whole point of launching early: the frame a blow lands on has to look unlike
  // the frame before it.
  const anticipation = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const swept = (anticipation.swordYaw - deepest.swordYaw)
    / (playerAttackPose(PLAYER_ATTACK_CONTACT_END).swordYaw - deepest.swordYaw);
  assert.ok(swept > 0.25, `the blade had only swept ${swept} of the arc when it went live`);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_ANTICIPATION - 0.000001).swordYaw - anticipation.swordYaw) < 0.001);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_ANTICIPATION + 0.000001).swordYaw - anticipation.swordYaw) < 0.001);

  const contactEnd = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  const justAfterContactEnd = playerAttackPose(PLAYER_ATTACK_CONTACT_END + 0.000001);
  assert.ok(Math.abs(justAfterContactEnd.swordYaw - contactEnd.swordYaw) < 0.001);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_DURATION - 0.000001).swordYaw) < 0.001);
  assert.deepEqual(playerAttackPose(PLAYER_ATTACK_DURATION), start);
});

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

test('the cut travels broadly from the backswing into the strike direction', () => {
  const backswing = playerAttackPose(0.03);
  const windup = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const middle = playerAttackPose(0.12);
  const finish = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  assert.ok(backswing.swordYaw < 0);
  assert.ok(windup.swordYaw < 0);
  assert.ok(middle.swordYaw > windup.swordYaw);
  assert.ok(finish.swordYaw > middle.swordYaw);
  assert.ok(finish.swordYaw > 1.5);
  assert.ok(Math.abs(finish.bodyYaw - 0.34) < 0.000001);
  assert.ok(Math.abs(finish.bodyRoll) < 0.1);
  assert.ok(finish.armReach > 0);
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

test('a mirrored beat still sweeps through a real arc', () => {
  // Mirroring must not collapse the cut: the blade has to travel as far on the back-cut as on the
  // forehand, or the second beat would read as a twitch.
  const sweep = (beat: number) => {
    const early = playerAttackPose(TIDEBLADE.anticipation * 0.9, TIDEBLADE, beat).swordYaw;
    const late = playerAttackPose(TIDEBLADE.contactEnd, TIDEBLADE, beat).swordYaw;
    return Math.abs(late - early);
  };
  assert.ok(sweep(0) > 1, 'the forehand sweeps through more than a radian');
  assert.equal(sweep(1).toFixed(9), sweep(0).toFixed(9));
});
