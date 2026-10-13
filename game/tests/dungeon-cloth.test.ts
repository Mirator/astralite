import assert from 'node:assert/strict';
import test from 'node:test';
import { playerRunPose, strideRate } from '../app/dungeon-run-pose.ts';
import { HEM_MAX, HEM_REST, INERTIA_REST, PENDULUM_REST, SETTLE_MAX, SETTLE_REST, SWING_MAX, TAILS_BACK, TAILS_MAX, TAILS_REST, bodyLag, clothHem, followBody, hemDrive, settleDrive, stepHem, stepPendulum, stepSettle, stepTails, swingDrive, tailsTarget, type Hem, type Inertia, type Pendulum, type Settle, type Tails } from '../app/dungeon-cloth.ts';

// Plan 027 Stage B: the poncho's hem state and the satchel's swing (dungeon-cloth.ts), the springs the game
// steps every update on its simulated dt. dungeon-cloak.test.ts holds what they do to the real cloth.
const run = (hem: Hem, drive: { x: number; z: number }, seconds: number, dt = 1 / 60) => {
  const trace: Hem[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) { hem = stepHem(hem, drive, dt); trace.push(hem); }
  return { hem, trace };
};

test('the hem lags a step in the drive, overshoots it a little and settles on it', () => {
  const drive = { x: 0, z: .06 }, dt = 1 / 60, { trace } = run(HEM_REST, drive, 1, dt), at = (s: number) => trace[Math.round(s / dt) - 1]!.z;
  // Measured 2026-10-12 (node, 60 Hz): 8% of the step at .05 s, 106% at .6 s, a peak of 109% at .48 s. Plan 030's
  // stiffer spring (10 rad/s at .5): 12% at .05 s, 100% at .6 s, a peak of 116% at .35 s.
  assert.ok(at(.05) < .5 * drive.z, `the hem has already reached ${(at(.05) / drive.z * 100).toFixed(0)}% of the step at .05 s`);
  assert.ok(at(.6) >= .9 * drive.z, `the hem has reached only ${(at(.6) / drive.z * 100).toFixed(0)}% of the step at .6 s`);
  const peak = Math.max(...trace.map(h => h.z));
  assert.ok(peak <= 1.25 * drive.z, `the hem overshoots the step by ${((peak / drive.z - 1) * 100).toFixed(0)}%`);
  // Plan 030 round 2: and overshoots it visibly, once - the critic saw a stop settle with no overshoot. Measured
  // 2026-10-12 (node, 60 Hz, 10 rad/s at .42): a peak of 123% at about .34 s; plan 030's .5 gave 116%.
  assert.ok(peak >= 1.19 * drive.z, `the hem overshoots the step by only ${((peak / drive.z - 1) * 100).toFixed(0)}%`);
});

test('the hem settles within a second of the drive letting go', () => {
  const held = run(HEM_REST, { x: .04, z: .06 }, 2).hem;
  assert.ok(Math.hypot(held.x, held.z) > .07, 'precondition: the hem was held out before the drive let go');
  const free = run(held, { x: 0, z: 0 }, 1).hem;
  assert.ok(Math.hypot(free.x, free.z) < .003, `the hem is still ${Math.hypot(free.x, free.z).toFixed(4)} out a second after the drive let go`);
});

test('the hem lands in the same place at 30 and at 144 frames a second', () => {
  // Exact frame counts, so both rates are read at the same instant. Compared a sixth of a second in, while the
  // hem is still moving fast, and at a second: the plan's "within .005 at one second" also passed with the
  // substeps removed (.0004 apart at 30 Hz, node 2026-10-12), so this reads the transient, where the unsubstepped
  // spring is .0074 apart and the substepped one .0004.
  const drive = { x: .03, z: .08 }, frames = (count: number, hz: number) => { let hem = HEM_REST; for (let i = 0; i < count; i++) hem = stepHem(hem, drive, 1 / hz); return hem; };
  for (const [slow, fast] of [[5, 24], [30, 144]] as const) {
    const a = frames(slow, 30), b = frames(fast, 144), gap = Math.hypot(a.x - b.x, a.z - b.z);
    assert.ok(Math.hypot(b.x, b.z) > .02, 'precondition: the hem has moved by the time it is compared');
    assert.ok(gap <= .002, `${(slow / 30).toFixed(3)} s at 30 Hz and at 144 Hz end ${gap.toFixed(4)} apart`);
  }
});

test('the hem never swings further than HEM_MAX, however hard it is driven', () => {
  let peak = 0, hem = HEM_REST;
  for (let t = 0; t < 2; t += 1 / 60) { hem = stepHem(hem, { x: .7, z: .7 }, 1 / 60); peak = Math.max(peak, Math.hypot(hem.x, hem.z)); }
  assert.ok(peak > HEM_MAX * .99, `precondition: the drive pushed the hem to the clamp (it reached ${peak.toFixed(3)})`);
  assert.ok(peak <= HEM_MAX + 1e-9, `the hem swung ${peak.toFixed(3)} out against a clamp of ${HEM_MAX}`);
});

test('the satchel swings inside its clamps for any drive and settles within a second and a half', () => {
  const drives = [{ x: 5, z: 5 }, { x: -5, z: 3 }, { x: .2, z: -.1 }, { x: -9, z: -9 }];
  for (const drive of drives) {
    let swing: Pendulum = PENDULUM_REST, peakX = 0, peakZ = 0;
    for (let t = 0; t < 1; t += 1 / 60) { swing = stepPendulum(swing, drive, 1 / 60); peakX = Math.max(peakX, Math.abs(swing.x)); peakZ = Math.max(peakZ, Math.abs(swing.z)); }
    assert.ok(peakX <= SWING_MAX.x + 1e-9 && peakZ <= SWING_MAX.z + 1e-9, `drive ${JSON.stringify(drive)} swung the bag ${peakX.toFixed(3)} / ${peakZ.toFixed(3)}`);
    assert.ok(peakX > .05, `precondition: drive ${JSON.stringify(drive)} swung the bag at all`);
    for (let t = 0; t < 1.5; t += 1 / 60) swing = stepPendulum(swing, { x: 0, z: 0 }, 1 / 60);
    assert.ok(Math.abs(swing.x) < .01 && Math.abs(swing.z) < .01, `the bag still hangs ${swing.x.toFixed(3)} / ${swing.z.toFixed(3)} 1.5 s after drive ${JSON.stringify(drive)}`);
  }
});

// Plan 028: what the game hands the rules. His velocity steps from standing to `speed` (m/s, forward is -z) in one frame
// and stays there, as the game moves him; the hem and the satchel are driven by the lag of a follower behind it. The
// game rotates the lag into his frame; standing facing -z, world and torso axes agree. `lift` as the run pose gives it.
function start(speed: number, hz: number, lift = .05, seconds = 1) {
  let inertia: Inertia = INERTIA_REST, hem: Hem = HEM_REST, swing: Pendulum = PENDULUM_REST;
  const out: { hem: number; swing: number }[] = [];
  for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
    const velocity = { x: 0, z: frame === 0 ? 0 : -speed };
    inertia = followBody(inertia, velocity, 0, 1 / hz);
    const lag = bodyLag(inertia, velocity, 0);
    hem = stepHem(hem, hemDrive({ accel: lag.accel, yawRate: lag.yawRate, lift: frame === 0 ? 0 : lift }), 1 / hz);
    swing = stepPendulum(swing, swingDrive(lag.accel, 0), 1 / hz);
    out.push({ hem: Math.hypot(hem.x, hem.z), swing: Math.hypot(swing.x, swing.z) });
  }
  return out;
}
const peakOf = (values: number[]) => values.reduce((best, v, i) => (v > best.value ? { value: v, at: i } : best), { value: -Infinity, at: -1 });

test('a sprint\'s start trails the hem over a quarter second instead of flicking it to the clamp (plan 028)', () => {
  // Plan 027 differentiated the velocity: 510 m/s² for one tick, and the hem was at .12 on the frame he started.
  const run = start(8.5, 60), peak = peakOf(run.map(f => f.hem));
  assert.ok(peak.value > .07, `precondition: the start moved the hem only ${peak.value.toFixed(3)}, no further than the lift`);
  assert.ok(peak.value < HEM_MAX - .01, `a start throws the hem to ${peak.value.toFixed(3)}, at the clamp`);
  assert.ok(run[1]!.hem < .03, `the hem is already ${run[1]!.hem.toFixed(3)} out on the frame he starts`);
  assert.ok(peak.at >= 8, `the hem peaks on frame ${peak.at}, a flick rather than a trail`);
});

test('a start trails the hem the same at 30, 60 and 144 frames a second (plan 028)', () => {
  // A one-frame step is the case a per-frame derivative gets wrong: its size scales with the frame rate.
  const peaks = [30, 60, 144].map(hz => peakOf(start(8.5, hz, 0).map(f => f.hem)).value);
  assert.ok(Math.min(...peaks) > .01, `precondition: the start moved the hem (${peaks.map(p => p.toFixed(4)).join(', ')})`);
  assert.ok(Math.max(...peaks) / Math.min(...peaks) < 1.1, `a start's trail is ${peaks.map(p => p.toFixed(4)).join(', ')} at 30, 60 and 144 Hz`);
});

test('a walk\'s start trails the hem less than a sprint\'s, so the gains still mean something (plan 028)', () => {
  const walk = peakOf(start(3, 60, 0).map(f => f.hem)).value, sprint = peakOf(start(8.5, 60, 0).map(f => f.hem)).value;
  assert.ok(walk > .005, `precondition: a walk's start moved the hem ${walk.toFixed(4)}`);
  assert.ok(walk < sprint * .7, `a walk's start trails the hem ${walk.toFixed(4)} against a sprint's ${sprint.toFixed(4)}: both at the cap`);
});

test('a sprint\'s start swings the satchel without slamming it to its clamp (plan 028)', () => {
  const swing = peakOf(start(8.5, 60).map(f => f.swing)).value;
  assert.ok(swing > .05, `precondition: the start swung the bag only ${swing.toFixed(3)} rad`);
  assert.ok(swing < SWING_MAX.x * .9, `a start swings the bag ${swing.toFixed(3)} rad, at its clamp`);
});

test('a sprint swings the hem across him a few frames behind the stride, without reaching the clamp (plan 030)', () => {
  // The run pose's sway and lift through the spring, at 60 Hz, after two seconds of sprinting. The critic saw plan 028's
  // poncho stay rigid running: its spring (8 rad/s at .6) and no stride drive moved the hem .005 across.
  let hem: Hem = HEM_REST, phase = 0, peak = 0;
  const drive: number[] = [], across: number[] = [], dt = 1 / 60;
  for (let frame = 0; frame < 240; frame++) {
    phase += 8.5 * dt * strideRate(8.5);
    const pose = playerRunPose(phase, 8.5);
    hem = stepHem(hem, hemDrive({ accel: { x: 0, z: 0 }, yawRate: 0, lift: pose.cape, sway: pose.sway }), dt);
    if (frame >= 120) { drive.push(pose.sway); across.push(hem.x); peak = Math.max(peak, Math.hypot(hem.x, hem.z)); }
  }
  assert.ok(Math.max(...drive) > .1, 'precondition: the stride drives the hem across');
  // Measured 2026-10-12 (node): .070 either way, .086 at its farthest, 8 frames behind.
  assert.ok(Math.max(...across) >= .05 && Math.min(...across) <= -.05, `the hem swings only ${Math.min(...across).toFixed(3)} to ${Math.max(...across).toFixed(3)} across`);
  assert.ok(peak < HEM_MAX - .01, `the swing reaches ${peak.toFixed(3)}, at the clamp`);
  // How far behind the stride: the shift (in frames) that best lines the hem up with its drive.
  let lag = 0, best = -Infinity;
  for (let shift = 0; shift < 20; shift++) { let sum = 0; for (let i = shift; i < across.length; i++) sum += across[i]! * drive[i - shift]!; if (sum > best) { best = sum; lag = shift; } }
  assert.ok(lag >= 3 && lag <= 10, `the hem follows the stride ${lag} frames behind`);
});

// Plan 030 round 3: his velocity (forward is -z) through a sprint's start and, a second later, its stop, at 60 Hz: the
// settle's lean frame by frame, the stop at frame 60.
function startAndStop(speed: number) {
  let inertia: Inertia = INERTIA_REST, settle: Settle = SETTLE_REST;
  const lean: number[] = [];
  for (let frame = 0; frame < 120; frame++) {
    const velocity = { x: 0, z: frame > 0 && frame < 60 ? -speed : 0 };
    inertia = followBody(inertia, velocity, 0, 1 / 60);
    settle = stepSettle(settle, settleDrive(bodyLag(inertia, velocity, 0).accel.z), 1 / 60);
    lean.push(settle.lean);
  }
  return lean;
}

test('a stop leans the upper body on over the hips and back past upright, and lets him stand within 700 ms (plan 030 round 3)', () => {
  // The critic saw round 2's stop snap from a stride to a stand and hold it: ten identical frames. Measured 2026-10-13
  // (node, 60 Hz): .178 forward 150 ms after the stop, -.019 back at half a second, .004 at 700 ms; the start leans him
  // .057, a third of the stop.
  const lean = startAndStop(8.5), stop = lean.slice(60), peak = peakOf(stop), start = peakOf(lean.slice(0, 60));
  assert.ok(peak.value >= .15 && peak.value <= SETTLE_MAX, `a sprint's stop leans him ${peak.value.toFixed(3)} forward`);
  assert.ok(peak.at >= 5 && peak.at <= 18, `the lean peaks ${peak.at} frames after the stop, not a beat behind it`);
  const back = Math.min(...stop.slice(peak.at));
  assert.ok(back <= -.01, `after the stop the lean comes back only to ${back.toFixed(3)}, no further than upright`);
  assert.ok(Math.abs(stop[42]!) < .01, `700 ms after the stop he still leans ${stop[42]!.toFixed(3)}`);
  assert.ok(start.value > .02 && start.value < .5 * peak.value, `the start leans him ${start.value.toFixed(3)} against the stop's ${peak.value.toFixed(3)}`);
  // A walk's stop leans him less than a sprint's: the gain is not just the clamp.
  assert.ok(peakOf(startAndStop(3).slice(60)).value < .7 * peak.value, 'a walk\'s stop leans him as far as a sprint\'s');
  assert.equal(settleDrive(0), 0, 'the settle leans him standing still');
});

test('the drawn hem swings across with the stride, a quarter cycle behind it, inside the clamp, and not at all standing (plan 030 round 3)', () => {
  // The spring alone (above) carries the stride's sway to the hem at .07 either way, which the critic still read as rigid
  // cloth; the stride's own flutter, outside the spring, takes the drawn hem to about .11. Measured 2026-10-13 (node).
  let hem: Hem = HEM_REST, phase = 0;
  const across: number[] = [], legs: number[] = [], dt = 1 / 60;
  for (let frame = 0; frame < 240; frame++) {
    phase += 8.5 * dt * strideRate(8.5);
    const pose = playerRunPose(phase, 8.5);
    hem = stepHem(hem, hemDrive({ accel: { x: 0, z: 0 }, yawRate: 0, lift: pose.cape, sway: pose.sway }), dt);
    const drawn = clothHem(hem, pose.flutter);
    assert.ok(Math.hypot(drawn.x, drawn.z) <= HEM_MAX + 1e-9, `the drawn hem reaches ${Math.hypot(drawn.x, drawn.z).toFixed(3)}, past the clamp`);
    if (frame >= 120) { across.push(drawn.x); legs.push(pose.sway); }
  }
  assert.ok(Math.max(...across) >= .09 && Math.min(...across) <= -.09, `the drawn hem swings only ${Math.min(...across).toFixed(3)} to ${Math.max(...across).toFixed(3)} across`);
  let lag = 0, best = -Infinity;
  for (let shift = 0; shift < 20; shift++) { let sum = 0; for (let i = shift; i < across.length; i++) sum += across[i]! * legs[i - shift]!; if (sum > best) { best = sum; lag = shift; } }
  assert.ok(lag >= 3 && lag <= 10, `the drawn hem follows the stride ${lag} frames behind`);
  const still = playerRunPose(1, 0).flutter;
  assert.deepEqual([still.x, still.y, still.z].map(v => v + 0), [0, 0, 0], 'the cloth flutters standing');
});

// Plan 030 round 4: a sprint, then a stop, as the game steps it: the follower, the spring, the stride's flutter (zero once
// he stands) and the sash's tails behind the drawn hem. Frames 0-89 run, 90 on stand still.
function sprintThenStop(hz = 60) {
  let inertia: Inertia = INERTIA_REST, hem: Hem = HEM_REST, tails: Tails = TAILS_REST, phase = 0;
  const out: { hem: Hem; drawn: Hem; tails: Tails; target: Tails }[] = [], dt = 1 / hz;
  for (let frame = 0; frame < 2.5 * hz; frame++) {
    const speed = frame === 0 || frame >= 1.5 * hz ? 0 : 8.5, velocity = { x: 0, z: -speed };
    if (speed) phase += speed * dt * strideRate(speed);
    const pose = playerRunPose(phase, speed);
    inertia = followBody(inertia, velocity, 0, dt);
    const lag = bodyLag(inertia, velocity, 0);
    hem = stepHem(hem, hemDrive({ accel: lag.accel, yawRate: lag.yawRate, lift: pose.cape, sway: pose.sway }), dt);
    const drawn = clothHem(hem, pose.flutter), target = tailsTarget(drawn, pose.sprint);
    tails = stepTails(tails, target, dt);
    out.push({ hem, drawn, tails, target });
  }
  return out;
}

test('a sprint\'s stop throws the hem clearly forward and it settles within 700 ms (plan 030 round 4)', () => {
  // The critic: "on the stop nothing overshoots". The forward throw takes 1.4 times the gain a start's backward pull
  // does (dungeon-cloth.ts THROW). Measured 2026-10-13 (node, 60 Hz): .066 forward at its furthest, .008 off rest 700 ms
  // after the stop.
  const frames = sprintThenStop(), stop = frames.slice(90), forward = -Math.min(...stop.map(f => f.drawn.z));
  assert.ok(Math.max(...frames.slice(30, 90).map(f => f.drawn.z)) > .03, 'precondition: the run lifted the hem back');
  assert.ok(forward >= .06, `a sprint's stop throws the hem only ${forward.toFixed(3)} forward`);
  const late = stop[42]!.drawn;
  assert.ok(Math.hypot(late.x, late.z) < .01, `700 ms after the stop the hem is still ${Math.hypot(late.x, late.z).toFixed(3)} off rest`);
});

test('the sash\'s tails follow the drawn hem a beat behind, blown out by the run and thrown forward by a stop (plan 030 round 4)', () => {
  // The critic saw the tails locked to the body. Measured 2026-10-13 (node, 60 Hz): running, blown .06 to .38 out to his
  // left; a stop throws them .25 forward.
  const frames = sprintThenStop(), run = frames.slice(45, 90), stop = frames.slice(90);
  // Running they stream out to his left (negative z: they hang on his left) and swing with the stride.
  const out = run.map(f => f.tails.z), across = Math.max(...out) - Math.min(...out);
  assert.ok(Math.max(...out) < -.05, `running, the tails are blown only ${(-Math.max(...out)).toFixed(3)} out to his left at the least`);
  assert.ok(across >= .15, `running, the tails swing only ${across.toFixed(3)} across`);
  // A beat behind: the tails' swing best matches their target some frames earlier.
  let lag = 0, best = -Infinity;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length, t = run.map(f => f.target.z - mean(run.map(g => g.target.z))), z = run.map(f => f.tails.z - mean(out));
  for (let shift = 0; shift < 15; shift++) { let sum = 0; for (let i = shift; i < z.length; i++) sum += z[i]! * t[i - shift]!; if (sum > best) { best = sum; lag = shift; } }
  assert.ok(lag >= 3 && lag <= 9, `the tails follow their target ${lag} frames behind`);
  // The stop throws them forward, more than the flap's 3 times the hem, and they come back.
  const flick = Math.max(...stop.map(f => f.tails.x));
  assert.ok(flick >= .2, `a sprint's stop throws the tails only ${flick.toFixed(3)} forward`);
  assert.ok(Math.abs(stop[stop.length - 1]!.tails.x) < .02 && Math.abs(stop[stop.length - 1]!.tails.z) < .02, 'a second after the stop the tails still swing');
  // Never back into the thigh behind them, never past the clamp.
  for (const f of frames) assert.ok(f.tails.x >= -TAILS_BACK - 1e-9 && Math.abs(f.tails.z) <= TAILS_MAX + 1e-9 && f.tails.x <= TAILS_MAX + 1e-9, `the tails swing to ${f.tails.x.toFixed(3)} / ${f.tails.z.toFixed(3)}`);
  assert.deepEqual(stepTails(TAILS_REST, tailsTarget({ x: 0, z: 0 }, 0), 1 / 60), { x: 0, z: 0 }, 'the tails swing standing');
});
