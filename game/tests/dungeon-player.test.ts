import assert from 'node:assert/strict';
import test from 'node:test';
import { DASH_BUFFER, DASH_SPEED, DASH_TIME, WALK_SPEED } from '../app/dungeon-combat.ts';
import {
  armWith, ATTACK_BUFFER, bufferedDashReady, bufferSwing, canSwing, createPlayerControl, dashStep, dropBuffers,
  frameDelta, frameStep, haltControl, MAX_FRAME_STEP, normalise, resetControl, startDash, startSwing, steer, swingReady, swingStep,
  tickBuffers, travelHeading, travelSpeed, type PlayerControl,
} from '../app/dungeon-player.ts';
import { chainLength, TIDEBLADE, weaponById } from '../app/dungeon-weapon.ts';

// The knight's clocks, driven the way the frame loop drives them: buffers first, a buffered dash ahead
// of a held swing, the dash clock after the frame has read it, the swing clock last.

const frame = (p: PlayerControl, dt: number, holding = false, input = { x: 0, z: 0 }) => {
  const step = frameStep(p, dt);
  tickBuffers(p, step);
  const events: string[] = [];
  if (bufferedDashReady(p) && startDash(p, input, 0.9)) events.push('dash');
  if (swingReady(p, holding)) { startSwing(p, null); events.push('swing'); }
  steer(p, input);
  dashStep(p, step);
  swingStep(p, step);
  return events;
};

const run = (p: PlayerControl, seconds: number, holding = false) => {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) events.push(...frame(p, 1 / 60, holding));
  return events;
};

test('a fresh knight faces the start heading, normalised, with every clock stopped', () => {
  const p = createPlayerControl();
  assert.ok(Math.abs(Math.hypot(p.facing.x, p.facing.z) - 1) < 1e-12);
  assert.ok(p.facing.x > 0 && p.facing.z < 0);
  assert.deepEqual(p.attackFacing, p.facing);
  assert.deepEqual(p.dashFacing, p.facing);
  assert.equal(canSwing(p), true);
  assert.equal(p.chainIdle, Infinity);
});

test('normalise matches THREE.Vector3.normalize bit for bit, and leaves a zero vector alone', () => {
  const v = normalise({ x: 3, z: -4 });
  const scale = 1 / Math.sqrt(3 * 3 + 0 + -4 * -4);
  assert.equal(v.x, 3 * scale);
  assert.equal(v.z, -4 * scale);
  assert.deepEqual(normalise({ x: 0, z: 0 }), { x: 0, z: 0 });
});

test('a swing points where it was aimed, else at a buffered facing, else straight on', () => {
  const p = createPlayerControl();
  startSwing(p, { x: 0, z: 1 });
  assert.deepEqual([p.facing.x, p.facing.z], [0, 1]);
  assert.deepEqual([p.attackFacing.x, p.attackFacing.z], [0, 1]);
  assert.equal(p.attackTime, TIDEBLADE.duration);

  while (p.attackTime > ATTACK_BUFFER / 2) frame(p, 1 / 60);
  bufferSwing(p, { x: -1, z: 0 });
  assert.equal(p.attackBuffer, ATTACK_BUFFER);
  run(p, ATTACK_BUFFER / 2 + 0.02);
  assert.deepEqual([p.attackFacing.x, p.attackFacing.z], [-1, 0], 'the buffered strike fired where it was aimed');
});

test('a buffered strike expires and forgets its facing', () => {
  const p = createPlayerControl();
  startSwing(p, null);
  bufferSwing(p, null);
  tickBuffers(p, ATTACK_BUFFER);
  assert.equal(p.attackBuffer, 0);
  assert.equal(p.bufferedFacing, null);
});

test('holding strike strings a chained arm through every beat, then opens it again', () => {
  const fangs = weaponById('fangs');
  assert.ok(chainLength(fangs) > 1, 'the fixture needs a chained arm');
  const p = createPlayerControl();
  armWith(p, fangs);
  const beats: number[] = [];
  startSwing(p, null); beats.push(p.chainBeat);
  for (let i = 0; i < 400 && beats.length < chainLength(fangs) + 1; i++) {
    if (frame(p, 1 / 60, true).includes('swing')) beats.push(p.chainBeat);
  }
  assert.deepEqual(beats, [...Array.from({ length: chainLength(fangs) }, (_, i) => i), 0]);
});

test('a string left idle past its window closes', () => {
  const fangs = weaponById('fangs');
  const p = createPlayerControl();
  armWith(p, fangs);
  startSwing(p, null);
  run(p, fangs.duration + (fangs.chain?.window ?? 0) + 0.1);
  startSwing(p, null);
  assert.equal(p.chainBeat, 0);
});

test('a dash pressed into a live blade waits in its buffer and cuts in when contact ends', () => {
  const p = createPlayerControl();
  startSwing(p, null);
  // Into the live window.
  run(p, TIDEBLADE.anticipation + 0.01);
  assert.equal(startDash(p, { x: 1, z: 0 }, 0.9), false);
  assert.equal(p.dashBuffer, DASH_BUFFER);
  assert.equal(p.dashTime, 0);
  const events = run(p, 0.3);
  assert.ok(events.includes('dash'), 'the buffered dash fired once the blade stopped being live');
  assert.equal(p.attackTime, 0, 'and cancelled the recovery');
});

test('a dash goes where the stick points, or straight on, and closes the string', () => {
  const p = createPlayerControl();
  const facing = { ...p.facing };
  assert.equal(startDash(p, { x: 0, z: 0 }, 0.9), true);
  assert.deepEqual({ x: p.dashFacing.x, z: p.dashFacing.z }, facing);
  assert.equal(p.dashTime, DASH_TIME);
  assert.equal(p.dashCooldown, 0.9);
  assert.equal(p.chainIdle, Infinity);

  const q = createPlayerControl();
  startDash(q, { x: 0, z: -1 }, 0.9);
  assert.deepEqual([q.dashFacing.x, q.dashFacing.z], [0, -1]);
  assert.deepEqual([q.facing.x, q.facing.z], [0, -1]);
  assert.equal(travelSpeed(q), DASH_SPEED);
  assert.equal(travelHeading(q, { x: 1, z: 0 }), q.dashFacing);
});

test('walking turns a free knight and never one committed to a swing or a dash', () => {
  const p = createPlayerControl();
  steer(p, { x: 0, z: 1 });
  assert.deepEqual([p.facing.x, p.facing.z], [0, 1]);
  assert.equal(travelSpeed(p), WALK_SPEED);
  startSwing(p, null);
  steer(p, { x: 1, z: 0 });
  assert.deepEqual([p.facing.x, p.facing.z], [0, 1]);
  assert.equal(travelSpeed(p), TIDEBLADE.moveSpeed);
});

test('hit-stop freezes the world clock for its own length in real time', () => {
  const p = createPlayerControl();
  p.hitStop = 0.04;
  assert.equal(frameStep(p, 1 / 60), 0);
  assert.equal(frameStep(p, 1 / 60), 0);
  assert.equal(frameStep(p, 1 / 60), 0);
  assert.equal(frameStep(p, 1 / 60), 1 / 60);
});

test('the swing step reports its age and whether the blade was live before it', () => {
  const p = createPlayerControl();
  assert.equal(swingStep(p, 0.1), null);
  startSwing(p, null);
  const first = swingStep(p, 0.01)!;
  assert.equal(first.wasLive, false);
  assert.ok(Math.abs(first.age - 0.01) < 1e-12);
  let live = false;
  for (let i = 0; i < 60 && p.attackTime > 0; i++) if (swingStep(p, 1 / 60)!.wasLive) live = true;
  assert.equal(live, true);
  assert.equal(p.attackTime, 0);
});

test('reset, halt, a new arm and a dropped buffer each clear exactly their own clocks', () => {
  const p = createPlayerControl();
  startSwing(p, null); p.dashCooldown = 0.5; p.hitStop = 0.1; bufferSwing(p, null); p.dashBuffer = 0.2;
  haltControl(p);
  assert.deepEqual([p.attackTime, p.dashTime, p.attackBuffer, p.dashBuffer, p.chainBeat, p.chainIdle], [0, 0, 0, 0, 0, Infinity]);
  assert.equal(p.dashCooldown, 0.5, 'a halt keeps the cooldown');
  assert.equal(p.hitStop, 0.1, 'and the hit-stop');
  resetControl(p);
  assert.deepEqual([p.dashCooldown, p.hitStop, p.bufferedFacing], [0, 0, null]);

  const spear = weaponById('spear');
  startSwing(p, null);
  armWith(p, spear);
  assert.equal(p.weapon, spear);
  assert.equal(p.swing, spear);
  assert.equal(p.attackTime, 0);

  bufferSwing(p, null); p.dashBuffer = 0.3;
  dropBuffers(p);
  assert.deepEqual([p.attackBuffer, p.dashBuffer, p.bufferedFacing], [0, 0, null]);
});

test('a prompt second strike continues the string; a late one opens a new one', () => {
  const p = createPlayerControl();
  startSwing(p, null);
  while (p.attackTime > 0) frame(p, 1 / 60);
  assert.ok(p.chainIdle <= (TIDEBLADE.chain?.window ?? 0), 'the swing has only just ended');
  startSwing(p, null);
  assert.equal(p.chainBeat, 1, 'inside the link window the string continues');
  while (p.attackTime > 0) frame(p, 1 / 60);
  run(p, (TIDEBLADE.chain?.window ?? 0) + 0.1);
  assert.ok(p.chainIdle > (TIDEBLADE.chain?.window ?? 0), 'the string has gone cold');
  startSwing(p, null);
  assert.equal(p.chainBeat, 0, 'a late strike opens a new string');
});

test('the finish of a string hits harder and commits for longer than its opener', () => {
  const p = createPlayerControl();
  const swings: { damage: number; duration: number }[] = [];
  startSwing(p, null); swings.push(p.swing);
  for (let i = 0; i < 400 && swings.length < chainLength(TIDEBLADE); i++) {
    if (frame(p, 1 / 60, true).includes('swing')) swings.push(p.swing);
  }
  const [opener, finish] = [swings[0], swings[swings.length - 1]];
  assert.ok(finish.damage > opener.damage);
  assert.ok(finish.duration > opener.duration);
});

test('an arm without a string swings the same cut every time', () => {
  const maul = weaponById('maul');
  assert.equal(chainLength(maul), 1);
  const p = createPlayerControl();
  armWith(p, maul);
  startSwing(p, null);
  for (let i = 0; i < 180; i++) { frame(p, 1 / 60, true); assert.equal(p.chainBeat, 0); }
});

test('a frame hands the world nothing first, nothing backwards and never more than one capped step', () => {
  assert.equal(frameDelta(1000, null), 0, 'the first frame only establishes the clock');
  assert.ok(Math.abs(frameDelta(1016, 1000) - 0.016) < 1e-12);
  assert.equal(frameDelta(0, 1000), 0, 'an older timestamp runs no time backwards');
  assert.equal(frameDelta(5000, 1000), MAX_FRAME_STEP, 'a stall is not replayed');
  // What the clamp protects: a negative step through frameStep would raise hit-stop by its own size.
  const p = createPlayerControl();
  frameStep(p, frameDelta(0, 1000));
  assert.equal(p.hitStop, 0);
});
