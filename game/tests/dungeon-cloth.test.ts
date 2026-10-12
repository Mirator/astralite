import assert from 'node:assert/strict';
import test from 'node:test';
import { HEM_MAX, HEM_REST, INERTIA_REST, PENDULUM_REST, SWING_MAX, hemDrive, smoothInertia, stepHem, stepPendulum, type Hem, type Inertia, type Pendulum } from '../app/dungeon-cloth.ts';

// Plan 027 Stage B: the poncho's hem state and the satchel's swing (dungeon-cloth.ts), the springs the game
// steps every update on its simulated dt. dungeon-cloak.test.ts holds what they do to the real cloth.
const run = (hem: Hem, drive: { x: number; z: number }, seconds: number, dt = 1 / 60) => {
  const trace: Hem[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) { hem = stepHem(hem, drive, dt); trace.push(hem); }
  return { hem, trace };
};

test('the hem lags a step in the drive, overshoots it a little and settles on it', () => {
  const drive = { x: 0, z: .06 }, dt = 1 / 60, { trace } = run(HEM_REST, drive, 1, dt), at = (s: number) => trace[Math.round(s / dt) - 1]!.z;
  // Measured 2026-10-12 (node, 60 Hz): 8% of the step at .05 s, 106% at .6 s, a peak of 109% at .48 s.
  assert.ok(at(.05) < .5 * drive.z, `the hem has already reached ${(at(.05) / drive.z * 100).toFixed(0)}% of the step at .05 s`);
  assert.ok(at(.6) >= .9 * drive.z, `the hem has reached only ${(at(.6) / drive.z * 100).toFixed(0)}% of the step at .6 s`);
  const peak = Math.max(...trace.map(h => h.z));
  assert.ok(peak <= 1.25 * drive.z, `the hem overshoots the step by ${((peak / drive.z - 1) * 100).toFixed(0)}%`);
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

test('a start trails the hem over a quarter second instead of flicking it to the clamp in one frame (plan 028)', () => {
  // What the game hands the rule: his velocity goes from 0 to a sprint's 8.5 m/s in one 60 Hz frame (it does: plan 027's
  // hem read .12 on the first frame of every start in SwiftShader frames, 2026-10-12), so the raw acceleration is
  // 510 m/s² for one tick and nothing after, plus a sprint's lift of .05.
  let inertia: Inertia = INERTIA_REST, hem: Hem = HEM_REST, peak = 0, peakAt = 0, first = 0;
  for (let frame = 0; frame < 60; frame++) {
    const accel = { x: 0, z: frame === 0 ? -510 : 0 }; // forward is -z, his front
    inertia = smoothInertia(inertia, { accel, yawRate: 0 }, 1 / 60);
    hem = stepHem(hem, hemDrive({ accel: inertia, yawRate: inertia.yaw, lift: .05 }), 1 / 60);
    const out = Math.hypot(hem.x, hem.z);
    if (frame === 0) first = out;
    if (out > peak) { peak = out; peakAt = frame; }
  }
  // It does trail: the start pulls the hem well past the lift's own .05 (precondition, or the cap below holds by doing nothing).
  assert.ok(peak > .07, `the start moved the hem only ${peak.toFixed(3)}`);
  assert.ok(peak < HEM_MAX - .01, `a start throws the hem to ${peak.toFixed(3)}, at the clamp`);
  assert.ok(first < .03, `the hem is already ${first.toFixed(3)} out on the frame he starts`);
  assert.ok(peakAt >= 8, `the hem peaks on frame ${peakAt}, a flick rather than a trail`);
});

test('the smoothing lands in the same place at 30 and at 144 frames a second (plan 028)', () => {
  const run = (hz: number) => { let state: Inertia = INERTIA_REST; for (let i = 0; i < Math.round(hz / 3); i++) state = smoothInertia(state, { accel: { x: 40, z: -20 }, yawRate: 3 }, 1 / hz); return state; };
  const a = run(30), b = run(144);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.yaw - b.yaw) < 1e-6, `30 Hz ends at ${a.x.toFixed(4)}, 144 Hz at ${b.x.toFixed(4)}`);
  assert.ok(a.x > 30, `precondition: the smoothing moved (${a.x.toFixed(2)} of 40 after a third of a second)`);
});
