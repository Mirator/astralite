import assert from 'node:assert/strict';
import test from 'node:test';
import { BANK_MAX, BREATH_PERIOD, DASH_CAPE, bankInto, headLook, idleBreath, legRate, playerRunPose, stopCrouch, strideRate } from '../app/dungeon-run-pose.ts';
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
  // Round 6 (the critic: the free forearm held bent forward through the run, "like a T-rex"; swing it from the shoulder):
  // a runner's bend, .4 to .9 at every phase of a sprint (sprint.spec.ts reads over .3 on the live rig), light as the arm
  // comes forward and deep as it goes back, where the hand would otherwise swing into the poncho's tail behind the arm
  // (dungeon-figures.test.ts). Whenever the upper arm is well forward (over .5) the bend is under .5. Measured 2026-10-13
  // (node): .44 to .85, .44 to .5 with the arm forward; round 5's .88 to 1.12 fails both.
  const poses = cycle(TOP);
  for (const [i, pose] of poses.entries()) assert.ok(pose.elbow >= .4 && pose.elbow <= .9, `at phase ${i}/64 the elbow bends ${pose.elbow.toFixed(3)}`);
  const forward = poses.filter(p => p.arm > .5);
  assert.ok(forward.length >= 10, `precondition: only ${forward.length} phases swing the arm well forward`);
  for (const pose of forward) assert.ok(pose.elbow < .5, `with the arm forward at ${pose.arm.toFixed(3)} the elbow bends ${pose.elbow.toFixed(3)}`);
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

test('he banks into a turn at a run, by up to 10 degrees, and not standing (plan 030 round 3)', () => {
  // Positive yaw rate is a turn to his left; positive bank leans him to his left, into it.
  assert.ok(bankInto(4, TOP) > .05, `a run's turn at 4 rad/s banks him only ${bankInto(4, TOP).toFixed(3)}`);
  assert.ok(bankInto(-4, TOP) < -.05, 'a right turn banks him left');
  assert.equal(bankInto(40, TOP), BANK_MAX, 'a hard turn banks past the clamp');
  // Round 5 (the critic: lean 8 to 12 degrees into a turn; round 3 held 8): the clamp 10 degrees, and a run's turn at 4 rad/s
  // banks him .12 (round 4: .08).
  assert.ok(bankInto(4, TOP) >= .1, `a run's turn at 4 rad/s banks him only ${bankInto(4, TOP).toFixed(3)}, under the critic's 8 degrees`);
  assert.ok(BANK_MAX >= .14 && BANK_MAX <= .21, `the bank's clamp is ${BANK_MAX}, outside 8 to 12 degrees`);
  assert.equal(bankInto(4, 0) + 0, 0, 'he banks standing');
});

test('running, the sword is carried trailing and its forearm swings against the free arm; standing it is not (plan 030 round 3)', () => {
  // The critic read round 2's run as both arms locked holding the sword level across him.
  const poses = cycle(TOP);
  for (const pose of poses) assert.equal(pose.carry, 1, 'a sprint does not carry the sword trailing');
  assert.equal(playerRunPose(1, 0).carry, 0, 'standing, the sword is carried trailing');
  // Round 4 (the orchestrator: at the forward end of round 3's .35 swing the blade came back up to the level, a lance): a
  // small follow-through, .15 forward and .075 back at a sprint, measured 2026-10-13; dungeon-figures.test.ts holds the
  // blade under 20 degrees through it. Round 3's .35 fails the ceiling here and that test both.
  const most = Math.max(...poses.map(p => Math.abs(p.carrySwing)));
  assert.ok(Math.max(...poses.map(p => p.carrySwing)) >= .12 && Math.min(...poses.map(p => p.carrySwing)) <= -.06, 'the sword forearm hardly swings');
  assert.ok(most <= .2, `the sword forearm swings ${most.toFixed(3)}, enough to bring the blade up level`);
  // Against the free arm: whenever the free arm is well forward, the sword forearm is back, and the other way round.
  let checked = 0;
  for (const pose of poses) if (Math.abs(pose.arm - .06) > .2) { checked++; assert.ok(Math.sign(pose.carrySwing) === -Math.sign(pose.arm - .06), `the sword forearm swings ${pose.carrySwing.toFixed(3)} with the free arm at ${pose.arm.toFixed(3)}`); }
  assert.ok(checked >= 20, `precondition: only ${checked} phases swing the free arm far`);
});

test('the free forearm and hand swing well over a radian end to end at a sprint, against the legs (plan 030 round 4)', () => {
  // The critic saw the free arm barely swing. The upper arm's swing is held by the poncho's room (dungeon-figures.test.ts),
  // so the elbow pumps with it, deeper forward: the forearm's angle (shoulder plus elbow, forward positive) is what shows
  // under the cloth. Round 3's bend (deeper going back) left the forearm .7 end to end; measured 2026-10-13: 1.2.
  // Round 6 (the critic: the forearm held up in front like a T-rex; the swing should be the shoulder's): round 5's 1.2 came
  // from a forearm thrown up 1.74 rad (100 degrees, past the level) at the front. Now the bend is deep only going back (where
  // it keeps the hand out of the poncho's tail), so the forearm swings less end to end and never comes up past 1.1 rad
  // forward. Measured 2026-10-13 (node): .71 end to end, 1.06 at the front; round 5's 1.2 and 1.74 fail the ceiling.
  const poses = cycle(TOP), forearm = poses.map(p => p.arm + p.elbow), span = Math.max(...forearm) - Math.min(...forearm);
  assert.ok(span >= .65, `the free forearm swings only ${span.toFixed(3)} end to end`);
  assert.ok(Math.max(...forearm) <= 1.1, `the free forearm comes up ${Math.max(...forearm).toFixed(3)} forward, a T-rex's arm`);
  // Forward with the right leg (legs[1]), back with the left.
  let checked = 0;
  for (const [i, pose] of poses.entries()) if (Math.abs(pose.legs[0].hip - pose.legs[1].hip) > .5) { checked++; assert.ok(Math.sign(forearm[i]! - (Math.max(...forearm) + Math.min(...forearm)) / 2) === Math.sign(pose.legs[1].hip - pose.legs[0].hip), `at phase ${i}/64 the forearm swings with the left leg`); }
  assert.ok(checked >= 20, `precondition: only ${checked} phases stride far`);
  // The shoulders roll with the stride, and not standing.
  assert.ok(Math.max(...poses.map(p => Math.abs(p.roll))) >= .05, 'the shoulders do not roll with the stride');
  assert.equal(playerRunPose(1, 0).roll, 0, 'the shoulders roll standing');
});

test('the upper free arm swings about 30 degrees each way at a sprint (plan 030 round 5)', () => {
  // The critic: the free arm barely swings; it asks for about 35 degrees at the shoulder. The poncho's room for it is held
  // in dungeon-figures.test.ts (the upper arm stays under the cloth); round 5's wider poncho gave it .56 each way about
  // its .06 rest. Measured 2026-10-13: -.500 to .620 (round 4: -.440 to .560).
  const arms = cycle(TOP).map(p => p.arm);
  assert.ok(Math.min(...arms) <= -.48 && Math.max(...arms) >= .6, `the free arm swings only ${Math.min(...arms).toFixed(3)} to ${Math.max(...arms).toFixed(3)}`);
});

test('running, the head is carried forward and counter-bobs, rather than tipped back; standing it is level (plan 030 round 5)', () => {
  // The critic: the head tipped back, chin up, and locked through the run. `nod` adds to the head's pitch (positive tips it
  // back): held down against the torso through a sprint and bobbing 3 degrees either way, twice a stride. Measured
  // 2026-10-13: a mean of -.070, .100 end to end (round 4: +.025, .050 - a nod that tipped the chin up on every footfall).
  const nods = cycle(TOP).map(p => p.nod), mean = nods.reduce((a, b) => a + b) / nods.length, span = Math.max(...nods) - Math.min(...nods);
  assert.ok(mean <= -.05, `the head is carried ${mean.toFixed(3)} on the torso through a sprint, not forward`);
  assert.ok(span >= .08, `the head bobs only ${span.toFixed(3)} through a stride`);
  // Twice a stride: the nod's turns (where it changes direction) number four in a cycle.
  let turns = 0; for (let i = 0; i < nods.length; i++) { const a = nods[(i + nods.length - 1) % nods.length]!, b = nods[i]!, c = nods[(i + 1) % nods.length]!; if ((b - a) * (c - b) < 0) turns++; }
  assert.equal(turns, 4, `the head bobs with ${turns} turns a stride`);
  assert.equal(playerRunPose(1, 0).nod + 0, 0, 'the head nods standing');
});

test('the head turns into a turn ahead of the body, and not when he runs straight (plan 030 round 5)', () => {
  // The critic: the head locked through turns. headLook's third argument is the body follower's turn rate (positive to his
  // left, as bankInto reads it). Measured 2026-10-13: .24 at 4 rad/s (round 4 took no turn rate: 0).
  assert.ok(headLook(0, 0, 4).yaw >= .2, `turning left at 4 rad/s the head looks only ${headLook(0, 0, 4).yaw.toFixed(3)} into it`);
  assert.ok(headLook(0, 0, -4).yaw <= -.2, `turning right at 4 rad/s the head looks ${headLook(0, 0, -4).yaw.toFixed(3)}`);
  assert.ok(Math.abs(headLook(0, 0, 40).yaw) <= .3 + 1e-9, 'a hard turn throws the head past its clamp');
  assert.equal(headLook(0, 0, 0).yaw + 0, 0, 'the head turns running straight');
  // It still keeps looking along the aim against a wound torso, inside the neck's .6.
  assert.ok(Math.abs(headLook(1, 0, 40).yaw) <= .6 + 1e-9, 'the head turns past the neck\'s .6');
});

test('a stop eases the legs home over a quarter of a second and bends the knees into the dip (plan 030 round 6)', () => {
  // The critic and the orchestrator: the stop snapped from mid-stride to standing between two sampled frames. The legs damp
  // at 28 while the stride drives them, but once the feet stop (no ground speed) they come home at 9 even while the gait is
  // still winding down - round 5 used 28 until the gait fell under 1 m/s, about 140 ms into a sprint's stop. Stepped at
  // 60 Hz the way THREE.MathUtils.damp does, a thigh 1 rad forward is still over .1 rad out 200 ms after the stop at 9,
  // and home inside 400 ms; at 28 it was home (.004) in 200 ms.
  assert.equal(legRate(8.5, 8.5, 0), 28, 'running, the legs follow the stride');
  assert.equal(legRate(.5, .5, 1), 28, 'a strike\'s plant steps at once');
  assert.equal(legRate(6, 0, 0), 9, 'his feet have stopped, yet the legs snap home with the gait still winding down');
  const after = (ms: number, rate: number) => { let x = 1; for (let i = 0; i < ms / (1000 / 60); i++) x += (0 - x) * (1 - Math.exp(-rate / 60)); return x; };
  assert.ok(after(200, legRate(6, 0, 0)) > .1 && after(400, legRate(6, 0, 0)) < .05, `the legs are ${after(200, 9).toFixed(3)} out at 200 ms and ${after(400, 9).toFixed(3)} at 400 ms`);
  // The crouch: thighs forward and knees folded with the settle's lean, nothing standing or leaning back.
  const deep = stopCrouch(.3);
  assert.ok(deep.hip >= .15 && deep.knee <= -.3, `a sprint's stop crouches only ${deep.hip.toFixed(3)} at the hip and ${deep.knee.toFixed(3)} at the knee`);
  assert.deepEqual([stopCrouch(0), stopCrouch(-.2)].map(c => [c.hip, c.knee].map(Math.abs)), [[0, 0], [0, 0]], 'he crouches without a stop');
});
