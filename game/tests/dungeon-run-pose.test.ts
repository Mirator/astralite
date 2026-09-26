import assert from 'node:assert/strict';
import test from 'node:test';
import { playerRunPose, strideRate } from '../app/dungeon-run-pose.ts';

// The knight walks at 8.5 unthreatened (dungeon-weapon.ts), which is the top of the sprint blend: the
// speed sprint.spec.ts reads the rig at after holding a direction.
const TOP = 8.5, WALK = 5.8;
const cycle = (speed: number, samples = 64) => Array.from({ length: samples }, (_, i) => playerRunPose(i * 2 * Math.PI / samples, speed));

test('at the knight\'s walking speed the rig is a sprint: leaning in, knees folding, a thigh always forward', () => {
  // What sprint.spec.ts holds on the live rig, held here at every phase rather than the one frame it samples.
  for (const pose of cycle(TOP)) {
    assert.ok(pose.sprint > .8, `sprint ${pose.sprint}`);
    assert.ok(pose.pitch < -.2, `pitch ${pose.pitch}`);
    // The game swings the rigid tabard out ahead of whichever thigh leads, by .85 of its angle. At a
    // sprint one leg is always at least .14 forward, so the tabard always clears .1.
    const lead = Math.max(...pose.legs.map(leg => leg.hip));
    assert.ok(lead >= .14 - 1e-9, `the leading thigh is only ${lead} forward`);
    assert.ok(lead * .85 > .1);
  }
  // Each knee folds past -0.2 once a stride, on its own recovery.
  for (const leg of [0, 1]) assert.ok(Math.min(...cycle(TOP).map(pose => pose.legs[leg].knee)) < -.2, `leg ${leg} never folds`);
});

test('sprint lengthens the stride and folds the recovering knee instead of speeding up a straight leg pendulum', () => {
  const walk = playerRunPose(0, WALK), run = playerRunPose(0, TOP);
  assert.ok(run.legs[0].knee < -1);
  assert.ok(Math.abs(run.legs[1].knee) < .1, 'opposite leg extends for support');
  assert.ok(run.legs[0].knee < walk.legs[0].knee - .8);
  assert.ok(run.pitch < walk.pitch);
  const flight = playerRunPose(Math.PI / 2, TOP);
  assert.ok(flight.height > .08);
  assert.ok(flight.legs[0].hip > .8 && flight.legs[1].hip < -.7);
  assert.ok(flight.arm < 0, 'left arm counter-swings against the forward left leg');
});

test('the running cycle alternates legs, loops continuously and settles to neutral at rest', () => {
  for (let i = 0; i < 64; i++) {
    const phase = i * Math.PI / 32, pose = playerRunPose(phase, TOP), opposite = playerRunPose(phase + Math.PI, TOP), loop = playerRunPose(phase + 2 * Math.PI, TOP);
    assert.ok(Math.abs(pose.legs[0].hip - opposite.legs[1].hip) < 1e-12);
    assert.ok(Math.abs(pose.legs[0].knee - loop.legs[0].knee) < 1e-12);
    // Standing still is the idle pose sprint.spec.ts waits for: no lean, no fold, no swing, whatever the phase.
    const rest = playerRunPose(phase, 0);
    assert.deepEqual([rest.sprint, rest.height, rest.pitch, rest.twist, rest.arm, rest.swordPitch].map(Math.abs), [0, 0, 0, 0, 0, 0]);
    assert.ok(rest.legs.every(leg => Math.abs(leg.hip) + Math.abs(leg.knee) === 0));
  }
});

test('stride rate is positive and falls as speed rises, so a faster knight covers more ground per stride', () => {
  let last = Infinity;
  for (let speed = 0; speed <= 12; speed += .25) {
    const rate = strideRate(speed);
    assert.ok(rate > 0 && Number.isFinite(rate), `stride rate ${rate} at ${speed}`);
    assert.ok(rate <= last, `stride rate rose from ${last} to ${rate} at ${speed}`);
    last = rate;
  }
  assert.ok(strideRate(TOP) < strideRate(WALK), 'each running stride covers more ground');
  // Two footfalls a cycle: under three full strides a second at the top keeps the cadence readable.
  assert.ok(TOP * strideRate(TOP) / (2 * Math.PI) < 3, 'full stride cadence stays readable');
});
