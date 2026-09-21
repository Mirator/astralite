import assert from 'node:assert/strict';
import test from 'node:test';
import { eightWay, groundAim, groundPoint, SCREEN_DOWN, SCREEN_RIGHT, SNAP_ANGLE, snapAim } from '../app/dungeon-aim.ts';

// The camera the game actually builds: focus + this offset, looking back at the focus.
const OFFSET = { x: 9.2, y: 12.5, z: 11.5 };
const SPAN = 7.2, ASPECT = 16 / 9;

// The movement basis, copied from the game loop. The whole point of deriving the aim basis from the
// camera offset is that it must come out as these; if it ever does not, a pointer and a key steer in
// different worlds and no amount of tuning will make aiming feel right.
const unit = (x: number, z: number) => { const m = Math.hypot(x, z); return { x: x / m, z: z / m }; };

const close = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, `expected ${a} to be within ${tolerance} of ${b}`);

test('the exported basis is the one the game loop writes down', () => {
  // dungeon-game.tsx builds screenRight from (11.5, 0, -9.2) and screenDown from (9.2, 0, 11.5). If
  // these ever drift apart, a pointer and a key steer in different worlds.
  const right = unit(11.5, -9.2), down = unit(9.2, 11.5);
  close(SCREEN_RIGHT.x, right.x, 1e-12); close(SCREEN_RIGHT.z, right.z, 1e-12);
  close(SCREEN_DOWN.x, down.x, 1e-12); close(SCREEN_DOWN.z, down.z, 1e-12);
});

test('the centre of the screen is the point the camera is looking at', () => {
  for (const focus of [{ x: 0, z: 0 }, { x: -13.5, z: 7.25 }]) {
    const at = groundPoint(0, 0, SPAN, ASPECT, focus, OFFSET);
    close(at.x, focus.x);
    close(at.z, focus.z);
  }
});

test('the screen axes land on the movement basis', () => {
  const focus = { x: 4, z: -2 };
  const right = groundPoint(1, 0, SPAN, ASPECT, focus, OFFSET);
  const along = unit(right.x - focus.x, right.z - focus.z);
  close(along.x, SCREEN_RIGHT.x, 1e-12);
  close(along.z, SCREEN_RIGHT.z, 1e-12);

  // Screen up is the ground's "away from the camera", which is the negative of the movement basis's
  // down. Movement and aim therefore disagree about the sign and about nothing else.
  const up = groundPoint(0, 1, SPAN, ASPECT, focus, OFFSET);
  const back = unit(up.x - focus.x, up.z - focus.z);
  close(back.x, -SCREEN_DOWN.x, 1e-12);
  close(back.z, -SCREEN_DOWN.z, 1e-12);
});

test('the map is affine: opposite corners are opposite offsets', () => {
  const focus = { x: 2, z: 3 };
  const a = groundPoint(0.7, -0.4, SPAN, ASPECT, focus, OFFSET);
  const b = groundPoint(-0.7, 0.4, SPAN, ASPECT, focus, OFFSET);
  close(a.x - focus.x, -(b.x - focus.x), 1e-12);
  close(a.z - focus.z, -(b.z - focus.z), 1e-12);
});

test('span and aspect scale the reach without rotating it', () => {
  const focus = { x: 0, z: 0 };
  const near = groundPoint(0.5, 0.5, 6.3, ASPECT, focus, OFFSET);
  const far = groundPoint(0.5, 0.5, 7.2, ASPECT, focus, OFFSET);
  // Not a uniform scale — x carries the aspect and y does not — so what must hold is that both stay
  // on the same side and grow together, which is what stops a resize from turning the knight.
  assert.ok(Math.hypot(far.x, far.z) > Math.hypot(near.x, near.z), 'a wider frustum reaches further');
  assert.ok(Math.sign(far.x) === Math.sign(near.x) && Math.sign(far.z) === Math.sign(near.z));

  const wide = groundPoint(1, 0, SPAN, 2, focus, OFFSET);
  const narrow = groundPoint(1, 0, SPAN, 1, focus, OFFSET);
  close(wide.x, narrow.x * 2, 1e-12);
  close(wide.z, narrow.z * 2, 1e-12);
});

test('a moving camera carries the map with it', () => {
  const still = groundPoint(0.3, -0.6, SPAN, ASPECT, { x: 0, z: 0 }, OFFSET);
  const moved = groundPoint(0.3, -0.6, SPAN, ASPECT, { x: 11, z: -4 }, OFFSET);
  close(moved.x - still.x, 11, 1e-12);
  close(moved.z - still.z, -4, 1e-12);
});

test('aim is a unit vector toward the cursor, and nothing at all under the knight', () => {
  const focus = { x: 0, z: 0 };
  const from = { x: 0, z: 0 };
  const aim = groundAim(0.8, 0, SPAN, ASPECT, focus, OFFSET, from);
  assert.ok(aim, 'a cursor off to one side names a direction');
  close(Math.hypot(aim.x, aim.z), 1, 1e-12);
  close(aim.x, SCREEN_RIGHT.x, 1e-12);

  assert.equal(groundAim(0, 0, SPAN, ASPECT, focus, OFFSET, from), null,
    'a cursor on the knight names no direction rather than a stale one');
});

test('the snap takes the nearest body in the cone and refuses everything else', () => {
  const from = { x: 0, z: 0 }, facing = { x: 1, z: 0 };
  const inside = { x: 1.4, z: 0.3 };      // about 12 degrees off
  const wide = { x: 1, z: 1.6 };          // about 58 degrees off, outside the cone
  const behind = { x: -1.4, z: 0 };
  const distant = { x: 6, z: 0.2 };

  const snapped = snapAim(facing, [wide, inside, behind, distant], from, 2);
  const expected = Math.hypot(inside.x, inside.z);
  close(snapped.x, inside.x / expected, 1e-12);
  close(snapped.z, inside.z / expected, 1e-12);

  assert.deepEqual(snapAim(facing, [wide, behind, distant], from, 2), facing,
    'nothing in the cone and in reach leaves the aim exactly as it was');
  assert.deepEqual(snapAim(facing, [], from, 2), facing);
});

test('the snap prefers the straightest body, not the closest one', () => {
  const from = { x: 0, z: 0 }, facing = { x: 1, z: 0 };
  // Nearer, but a long way off the line; further, but nearly straight ahead. A swing aimed at the
  // first would look like the knight ignoring what he was pointed at.
  const near = { x: 0.7, z: 0.42 };
  const straight = { x: 1.8, z: 0.05 };
  const snapped = snapAim(facing, [near, straight], from, 2.5);
  const m = Math.hypot(straight.x, straight.z);
  close(snapped.x, straight.x / m, 1e-12);
});

test('a body exactly on the knight cannot be aimed at', () => {
  const facing = { x: 0, z: 1 };
  assert.deepEqual(snapAim(facing, [{ x: 0, z: 0 }], { x: 0, z: 0 }, 2), facing);
});

test('the cone is honoured at its own edge', () => {
  const from = { x: 0, z: 0 }, facing = { x: 1, z: 0 };
  const just = SNAP_ANGLE * 0.98, past = SNAP_ANGLE * 1.02;
  const at = (angle: number) => ({ x: Math.cos(angle), z: Math.sin(angle) });
  assert.notDeepEqual(snapAim(facing, [at(just)], from, 2), facing, 'inside the cone snaps');
  assert.deepEqual(snapAim(facing, [at(past)], from, 2), facing, 'outside the cone does not');
});

test('a zero or absurd cone is refused rather than trusted', () => {
  const from = { x: 0, z: 0 }, facing = { x: 1, z: 0 };
  // Eighty degrees off: outside the real cone, inside an absurd one.
  const wide = { x: Math.cos(1.4), z: Math.sin(1.4) };
  // A negative angle must not become a cosine above 1 and swallow everything...
  assert.deepEqual(snapAim(facing, [{ x: 1, z: 0.5 }], from, 2, -1), facing);
  // ...and an angle past pi must not wrap around into refusing what it should accept.
  assert.notDeepEqual(snapAim(facing, [wide], from, 2, 99), facing);
});

test('the eight directions are the screen basis, and every angle lands on one of them', () => {
  const { SCREEN_RIGHT: R, SCREEN_DOWN: D } = { SCREEN_RIGHT, SCREEN_DOWN };
  assert.deepEqual(eightWay(R), R);
  assert.deepEqual(eightWay(D), D);

  const seen = new Set<string>();
  for (let i = 0; i < 360; i++) {
    const a = i * Math.PI / 180;
    const got = eightWay({ x: Math.cos(a), z: Math.sin(a) });
    close(Math.hypot(got.x, got.z), 1, 1e-12);
    seen.add(`${got.x.toFixed(6)},${got.z.toFixed(6)}`);
  }
  assert.equal(seen.size, 8, 'a full turn visits exactly eight directions');
});

test('quantising is never more than 22.5 degrees of error', () => {
  let worst = 0;
  for (let i = 0; i < 720; i++) {
    const a = i * Math.PI / 360;
    const to = { x: Math.cos(a), z: Math.sin(a) };
    const got = eightWay(to);
    worst = Math.max(worst, Math.acos(Math.min(1, got.x * to.x + got.z * to.z)));
  }
  // The number the whole aim change exists to remove.
  assert.ok(worst <= 22.5 * Math.PI / 180 + 1e-9, `worst error was ${(worst * 180 / Math.PI).toFixed(2)} degrees`);
});
