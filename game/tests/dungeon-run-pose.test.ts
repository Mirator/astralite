import test from 'node:test';
import assert from 'node:assert/strict';
import { playerRunPose, strideRate } from '../app/dungeon-run-pose.ts';

test('sprint lengthens the stride and folds the recovering knee instead of speeding up a straight leg pendulum', () => {
  const walk=playerRunPose(0,5.8),run=playerRunPose(0,8.5);
  assert.ok(run.legs[0].knee < -1);
  assert.ok(Math.abs(run.legs[1].knee) < .1, 'opposite leg extends for support');
  assert.ok(run.legs[0].knee < walk.legs[0].knee - .8);
  assert.ok(run.pitch < -.2 && run.pitch < walk.pitch);
  assert.ok(8.5*strideRate(8.5)/(2*Math.PI) < 3, 'full stride cadence stays readable');
  assert.ok(strideRate(8.5)<strideRate(5.8), 'each running stride covers more ground');
  const flight=playerRunPose(Math.PI/2,8.5);
  assert.ok(flight.height>.08);
  assert.ok(flight.legs[0].hip>.8 && flight.legs[1].hip<-.7);
  assert.ok(flight.arm<0, 'left arm counter-swings against the forward left leg');
});

test('running cycle alternates legs, loops continuously and settles to neutral at rest', () => {
  for(let i=0;i<64;i++){
    const phase=i*Math.PI/32,pose=playerRunPose(phase,8.5),opposite=playerRunPose(phase+Math.PI,8.5),loop=playerRunPose(phase+2*Math.PI,8.5);
    assert.ok(Math.abs(pose.legs[0].hip-opposite.legs[1].hip)<1e-12);
    assert.ok(Math.abs(pose.legs[0].knee-loop.legs[0].knee)<1e-12);
    const rest=playerRunPose(phase,0);
    assert.equal(rest.height,0);assert.equal(rest.sprint,0);
    assert.ok(rest.legs.every(leg=>Math.abs(leg.hip)+Math.abs(leg.knee)===0));
  }
});
