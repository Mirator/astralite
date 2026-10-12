import assert from 'node:assert/strict';
import test from 'node:test';
import { HEM_MAX, HEM_REST, PENDULUM_REST, SWING_MAX, stepHem, stepPendulum, type Hem, type Pendulum } from '../app/dungeon-cloth.ts';

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
