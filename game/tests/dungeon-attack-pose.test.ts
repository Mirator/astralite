import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_ATTACK_ANTICIPATION,
  PLAYER_ATTACK_CONTACT_END,
  PLAYER_ATTACK_DURATION,
  playerAttackPose,
} from '../app/dungeon-attack-pose.ts';

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

  const anticipation = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const justBeforeContact = playerAttackPose(PLAYER_ATTACK_ANTICIPATION - 0.000001);
  const justAfterContact = playerAttackPose(PLAYER_ATTACK_ANTICIPATION + 0.000001);
  assert.ok(anticipation.swordYaw < start.swordYaw);
  assert.ok(Math.abs(anticipation.swordYaw + 1.1) < 0.000001);
  assert.ok(Math.abs(anticipation.bodyYaw + 0.12) < 0.000001);
  assert.ok(Math.abs(justBeforeContact.swordYaw - anticipation.swordYaw) < 0.001);
  assert.ok(Math.abs(justAfterContact.swordYaw - anticipation.swordYaw) < 0.001);

  const contactEnd = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  const justAfterContactEnd = playerAttackPose(PLAYER_ATTACK_CONTACT_END + 0.000001);
  assert.ok(Math.abs(justAfterContactEnd.swordYaw - contactEnd.swordYaw) < 0.001);
  assert.ok(Math.abs(playerAttackPose(PLAYER_ATTACK_DURATION - 0.000001).swordYaw) < 0.001);
  assert.deepEqual(playerAttackPose(PLAYER_ATTACK_DURATION), start);
});

test('damage and trail windows cover the real fast cut only', () => {
  const before = playerAttackPose(PLAYER_ATTACK_ANTICIPATION - 0.000001);
  const firstContact = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const lastContact = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  const after = playerAttackPose(PLAYER_ATTACK_CONTACT_END + 0.000001);
  assert.equal(before.active, false);
  assert.equal(before.trail, false);
  assert.equal(firstContact.active, true);
  assert.equal(firstContact.trail, true);
  assert.equal(lastContact.active, true);
  assert.equal(lastContact.trail, true);
  assert.equal(after.active, false);
  assert.equal(after.trail, false);
});

test('the cut travels broadly from the backswing into the strike direction', () => {
  const backswing = playerAttackPose(0.04);
  const windup = playerAttackPose(PLAYER_ATTACK_ANTICIPATION);
  const middle = playerAttackPose(0.12);
  const finish = playerAttackPose(PLAYER_ATTACK_CONTACT_END);
  assert.ok(backswing.swordYaw < 0);
  assert.ok(windup.swordYaw < 0);
  assert.ok(middle.swordYaw > windup.swordYaw);
  assert.ok(finish.swordYaw > middle.swordYaw);
  assert.ok(finish.swordYaw > 1.2);
  assert.ok(Math.abs(finish.bodyYaw - 0.16) < 0.000001);
  assert.ok(Math.abs(finish.bodyRoll) < 0.1);
  assert.ok(finish.armReach > 0);
});
