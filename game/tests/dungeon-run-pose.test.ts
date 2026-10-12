import assert from 'node:assert/strict';
import test from 'node:test';
import { BREATH_PERIOD, DASH_CAPE, headLook, idleBreath, playerRunPose, strideRate } from '../app/dungeon-run-pose.ts';
import { playerAttackPose, playerSpecialPose } from '../app/dungeon-attack-pose.ts';
import { WEAPONS } from '../app/dungeon-weapon.ts';
import { HEM_MAX } from '../app/dungeon-cloth.ts';

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
    assert.deepEqual([rest.sprint, rest.height, rest.pitch, rest.twist, rest.arm, rest.elbow, rest.swordPitch, rest.cape, rest.nod, rest.sway].map(Math.abs), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
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

test('the poncho\'s hem is lifted back a few centimetres by a sprint and more by a dash, inside the cloth\'s clamp', () => {
  // Plan 027: `cape` and DASH_CAPE are metres of trail fed to the hem state (dungeon-cloth.ts), no longer the old
  // back flap's pitch. The wing ceiling that used to live here is dungeon-cloak.test.ts's: the back point stays
  // under the sash with the hem anywhere inside HEM_MAX.
  const lifts = cycle(TOP).map(pose => pose.cape);
  assert.ok(Math.min(...lifts) >= .04 && Math.max(...lifts) <= .06, `a sprint lifts the hem ${Math.min(...lifts).toFixed(3)}-${Math.max(...lifts).toFixed(3)}`);
  assert.ok(DASH_CAPE > Math.max(...lifts) && DASH_CAPE < HEM_MAX, `a dash lifts the hem ${DASH_CAPE}`);
});

test('the free elbow bends through the run and hangs straight at rest (plan 030)', () => {
  // Plan 030: the elbow flexes forward from a straight arm (positive), as the sheet's arms hang; plan 027's opened down
  // from a square bend (negative). A runner's bend, over half a radian at every phase of a sprint.
  for (const [i, pose] of cycle(TOP).entries()) assert.ok(pose.elbow >= .7 && pose.elbow <= 1.3, `at phase ${i}/64 the elbow bends ${pose.elbow.toFixed(3)}`);
  assert.equal(playerRunPose(1, 0).elbow, 0, 'the elbow bends at rest');
});

test('the shoulders counter-rotate against the legs, about 15 degrees each way at a sprint (plan 030)', () => {
  // The critic read plan 027's 5 degrees as a torso carried rigid on the legs. The sword shoulder comes forward (positive
  // yaw) with the left leg (legs[0], forward at a positive hip).
  const poses = cycle(TOP), peak = Math.max(...poses.map(p => Math.abs(p.twist)));
  assert.ok(peak >= .22 && peak <= .3, `the shoulders turn ${peak.toFixed(3)} at most`);
  for (const pose of poses) if (Math.abs(pose.legs[0].hip - pose.legs[1].hip) > .5) assert.ok(Math.sign(pose.twist) === Math.sign(pose.legs[0].hip - pose.legs[1].hip), `the shoulders turn ${pose.twist.toFixed(3)} with the left leg at ${pose.legs[0].hip.toFixed(3)}`);
});

test('the stride sways the poncho across him, both ways, and not at all standing (plan 030)', () => {
  const sways = cycle(TOP).map(p => p.sway);
  // A drive, not where the hem gets to: the spring takes it down to under half and a quarter cycle late, and
  // dungeon-cloth.test.ts holds what reaches the hem.
  assert.ok(Math.max(...sways) >= .15 && Math.min(...sways) <= -.15, `a sprint drives the hem ${Math.min(...sways).toFixed(3)} to ${Math.max(...sways).toFixed(3)} across`);
  assert.equal(playerRunPose(1, 0).sway, 0, 'the hem sways standing');
});

test('the head keeps looking along the aim while every arm\'s strike and special wind the body round (plan 027)', () => {
  // Sampled from the real swing poses, both beats of a chain. The whirl is left out on purpose: it turns him
  // a full circle, and the head goes round with it.
  let wound = 0;
  for (const weapon of Object.values(WEAPONS)) {
    const samples: { name: string; yaw: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const age = weapon.duration * i / 60;
      for (const beat of [0, 1]) samples.push({ name: `${weapon.id} strike beat ${beat} at ${age.toFixed(3)} s`, yaw: playerAttackPose(age, weapon, beat).bodyYaw });
      if (weapon.special && weapon.special.kind !== 'whirl') samples.push({ name: `${weapon.id} special at ${age.toFixed(3)} s`, yaw: playerSpecialPose(age, weapon, weapon.special.kind).bodyYaw });
    }
    for (const { name, yaw } of samples) {
      wound = Math.max(wound, Math.abs(yaw));
      const look = headLook(yaw, 0);
      assert.ok(Math.abs(yaw + look.yaw) <= .25, `${name}: the torso turns ${yaw.toFixed(2)} and the head looks ${(yaw + look.yaw).toFixed(2)} off the aim`);
    }
  }
  assert.ok(wound > .3, `precondition: some swing winds the torso past .3 (the most was ${wound.toFixed(2)}), or the head had nothing to hold`);
  assert.deepEqual([headLook(0, 0).yaw, headLook(0, 0).pitch].map(Math.abs), [0, 0], 'the head turns at rest');
});

test('the idle breath is a small, slow cycle that averages to nothing and stops while he moves (plan 027)', () => {
  const samples = Array.from({ length: 400 }, (_, i) => idleBreath(i * BREATH_PERIOD / 400, 1));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.max(...samples.map(s => Math.abs(s.lift))) > .005, 'precondition: a still knight breathes at all');
  assert.ok(Math.max(...samples.map(s => Math.abs(s.lift))) <= .006, 'the breath lifts more than .006');
  assert.ok(Math.max(...samples.map(s => Math.abs(s.nod))) <= .03, 'the breath nods more than .03');
  assert.ok(Math.abs(mean(samples.map(s => s.lift))) < 1e-6 && Math.abs(mean(samples.map(s => s.nod))) < 1e-6, 'the breath drifts over a cycle');
  for (let i = 0; i < 40; i++) { const moving = idleBreath(i * .37, 0); assert.ok(moving.lift === 0 && moving.nod === 0, `the breath runs at ${(i * .37).toFixed(2)} s while he moves`); }
});
