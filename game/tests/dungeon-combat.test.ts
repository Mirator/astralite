import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYER_ATTACK_ANTICIPATION, PLAYER_ATTACK_CONTACT_END, PLAYER_ATTACK_DURATION } from '../app/dungeon-attack-pose.ts';
import { canAbortSwing, DASH_BUFFER, DASH_IFRAMES, DASH_SPEED, DASH_TIME, dashImmune, incomingDamage, playerSpeed, swordContacts, WALK_SPEED } from '../app/dungeon-combat.ts';
import { STRIKE_RANGE } from '../app/dungeon-enemy.ts';
import { TIDEBLADE, WEAPONS, type WeaponId } from '../app/dungeon-weapon.ts';
import { canStand, cellKey, hasClearPath, TILE } from '../app/dungeon-floor.ts';

/** A five-by-five patch of open floor centred on cell (0, 0). */
const patch = () => {
  const cells = new Set<string>();
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) cells.add(cellKey(x, z));
  }
  return cells;
};

const unit = (x: number, z: number) => {
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
};

const aimedAt = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  unit(to.x - from.x, to.z - from.z);

test('a prop between two bodies blocks the sword the same way it blocks a skeleton', () => {
  const cells = patch();
  // The exact geometry the audit reproduced: both bodies stand on real floor,
  // they are 1.16 apart, and the only thing between them is the carved cell.
  const knight = { x: -1.07, z: 0.25 };
  const skeleton = { x: -0.25, z: 1.07 };
  const facing = aimedAt(knight, skeleton);

  assert.equal(canStand(cells, knight.x, knight.z), true);
  assert.equal(canStand(cells, skeleton.x, skeleton.z), true);
  assert.ok(Math.hypot(skeleton.x - knight.x, skeleton.z - knight.z) < 1.8);
  assert.equal(
    swordContacts(cells, knight, facing, skeleton, 0),
    true,
    'the open corner is a legal strike before the prop is carved out',
  );

  cells.delete(cellKey(0, 0));
  assert.equal(canStand(cells, knight.x, knight.z), true);
  assert.equal(canStand(cells, skeleton.x, skeleton.z), true);
  assert.equal(hasClearPath(cells, knight, skeleton), false);
  assert.equal(
    swordContacts(cells, knight, facing, skeleton, 0),
    false,
    'the sword must not reach around a blocked corner an enemy cannot attack through',
  );
});

test('an identical open-floor approach still lands', () => {
  const cells = patch();
  cells.delete(cellKey(0, 0));
  // The same 1.16 separation, two columns away from the carved cell.
  const knight = { x: -2, z: 0 };
  const skeleton = { x: -2, z: 1.16 };
  const facing = aimedAt(knight, skeleton);
  assert.equal(canStand(cells, knight.x, knight.z), true);
  assert.equal(canStand(cells, skeleton.x, skeleton.z), true);
  assert.equal(hasClearPath(cells, knight, skeleton), true);
  assert.equal(swordContacts(cells, knight, facing, skeleton, 0), true);
});

test('range and arc keep their exact boundaries', () => {
  const cells = new Set<string>();
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) cells.add(cellKey(x, z));
  }
  const knight = { x: 0, z: 0 };
  const facing = { x: 1, z: 0 };

  assert.equal(
    swordContacts(cells, knight, facing, { x: 1.79, z: 0 }, 0),
    true,
    'just inside the 1.8 reach',
  );
  assert.equal(
    swordContacts(cells, knight, facing, { x: 1.8, z: 0 }, 0),
    false,
    'the reach is exclusive at 1.8',
  );

  // The arc admits anything with a facing dot above 0.35.
  const onArc = (dot: number) => ({
    x: Math.cos(Math.acos(dot)) * 1.5,
    z: Math.sin(Math.acos(dot)) * 1.5,
  });
  assert.equal(swordContacts(cells, knight, facing, onArc(0.36), 0), true);
  assert.equal(swordContacts(cells, knight, facing, onArc(0.34), 0), false);
  assert.equal(
    swordContacts(cells, knight, facing, { x: -1.5, z: 0 }, 0),
    false,
    'nothing behind the knight is ever in the arc',
  );
});

test('Long Guard lengthens and widens the same arc', () => {
  const cells = new Set<string>();
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) cells.add(cellKey(x, z));
  }
  const knight = { x: 0, z: 0 };
  const facing = { x: 1, z: 0 };
  const reach = 0.35;

  assert.equal(swordContacts(cells, knight, facing, { x: 2.1, z: 0 }, 0), false);
  assert.equal(
    swordContacts(cells, knight, facing, { x: 2.1, z: 0 }, reach),
    true,
    'reach extends the range to 2.15',
  );
  assert.equal(swordContacts(cells, knight, facing, { x: 2.15, z: 0 }, reach), false);

  // The threshold drops from 0.35 to 0.35 - 0.35 * 0.12 = 0.308.
  const wide = { x: Math.cos(Math.acos(0.32)) * 1.5, z: Math.sin(Math.acos(0.32)) * 1.5 };
  assert.equal(swordContacts(cells, knight, facing, wide, 0), false);
  assert.equal(swordContacts(cells, knight, facing, wide, reach), true);
});

test('a body standing on the knight is never a contact', () => {
  const cells = patch();
  // Three.js normalises a zero-length delta to zero, so the arc test fails.
  assert.equal(swordContacts(cells, { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }, 0), false);
});

test('every damage source shares one mitigation and one rounding rule', () => {
  // Gauntlet, at no ward, one Salt Ward, and two.
  assert.equal(incomingDamage(10, 1), 10);
  assert.equal(incomingDamage(10, 0.8), 8);
  assert.equal(incomingDamage(10, 0.64), 6);

  // Guard, stalker and warden melee.
  assert.equal(incomingDamage(12, 1), 12);
  assert.equal(incomingDamage(12, 0.8), 10);
  assert.equal(incomingDamage(12, 0.64), 8);
  assert.equal(incomingDamage(8, 1), 8);
  assert.equal(incomingDamage(8, 0.8), 6);
  assert.equal(incomingDamage(8, 0.64), 5);
  assert.equal(incomingDamage(20, 1), 20);
  assert.equal(incomingDamage(20, 0.8), 16);
  assert.equal(incomingDamage(20, 0.64), 13);

  // Half rounds up, as Math.round does, and there is no damage floor.
  assert.equal(incomingDamage(5, 0.5), 3);
  assert.equal(incomingDamage(1, 0.8), 1);
  assert.equal(incomingDamage(1, 0.4), 0);
  assert.equal(incomingDamage(0, 1), 0);
});

test('the tile size the fixtures assume has not moved', () => {
  assert.equal(TILE, 1.48);
});

test('only the live blade is a commitment: anticipation and recovery both give way to a dash', () => {
  const remaining = (age: number) => PLAYER_ATTACK_DURATION - age;
  // Idle, or a swing that has only just begun, can give way to a dash.
  assert.equal(canAbortSwing(0), true);
  assert.equal(canAbortSwing(PLAYER_ATTACK_DURATION), true);
  assert.equal(canAbortSwing(remaining(PLAYER_ATTACK_ANTICIPATION - 0.001)), true);
  // From the first live frame to the last frame of contact, it cannot.
  assert.equal(canAbortSwing(remaining(PLAYER_ATTACK_ANTICIPATION)), false);
  assert.equal(canAbortSwing(remaining(0.12)), false);
  assert.equal(canAbortSwing(remaining(PLAYER_ATTACK_CONTACT_END - 0.001)), false);
  // The recovery is free again: a dodge pressed there fires at once. This is what keeps a held strike
  // key playable - the wait is at most the 0.11s of contact, not the rest of the swing.
  assert.equal(canAbortSwing(remaining(PLAYER_ATTACK_CONTACT_END)), true);
  assert.equal(canAbortSwing(0.2), true);
  assert.equal(canAbortSwing(0.001), true);
  assert.ok(PLAYER_ATTACK_CONTACT_END - PLAYER_ATTACK_ANTICIPATION < 0.12);
  // The buffer outlasts the contact window, so a dash pressed at the first live frame is never dropped.
  assert.ok(DASH_BUFFER > PLAYER_ATTACK_CONTACT_END - PLAYER_ATTACK_ANTICIPATION);
});

// --- the dash -------------------------------------------------------------------------------------

test('a dash takes the knight out of the attack he dodged', () => {
  // The rule the dash's numbers are derived from, kept as an assertion so a later tuning pass cannot
  // quietly undo it. Net distance is what the dash buys over simply walking the same window; a dash
  // that nets less than a warden's reach is an invulnerability blink, which is what this replaced.
  const net = DASH_TIME * (DASH_SPEED - WALK_SPEED);
  assert.ok(net >= STRIKE_RANGE.warden,
    `a dash nets ${net.toFixed(2)} units against a warden's ${STRIKE_RANGE.warden} reach`);
  // And against the body the knight meets most.
  assert.ok(net >= STRIKE_RANGE.guard);
});

test('the dash is immune at the head and exposed in the tail', () => {
  // dashTime counts down, so the head of the dash is a high number and the tail a low one.
  assert.equal(dashImmune(DASH_TIME), true, 'the first frame turns a blow aside');
  assert.equal(dashImmune(DASH_TIME - DASH_IFRAMES + 1e-6), true, 'the last immune frame does too');
  assert.equal(dashImmune(DASH_TIME - DASH_IFRAMES), false, 'the tail begins exactly here');
  assert.equal(dashImmune(1e-6), false, 'the final frame is exposed');
  assert.equal(dashImmune(0), false, 'and so is standing still');
  // The tail has to be worth something or the dash costs nothing at all.
  assert.ok(DASH_IFRAMES < DASH_TIME, 'some of the dash must be punishable');
  assert.ok(DASH_TIME - DASH_IFRAMES >= 0.08, 'and by enough of a window to be hit inside');
});

test('nothing but a swing slows the knight down', () => {
  const walking = playerSpeed({ dashing: false, attacking: false, weapon: TIDEBLADE });
  assert.equal(walking, WALK_SPEED, 'proximity to a woken body is not a tax on movement');
  assert.equal(playerSpeed({ dashing: true, attacking: false, weapon: TIDEBLADE }), DASH_SPEED);
  // Committing to a swing is the one thing that costs mobility, and every arm pays it.
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const arm = WEAPONS[id];
    const swinging = playerSpeed({ dashing: false, attacking: true, weapon: arm });
    assert.equal(swinging, arm.moveSpeed);
    assert.ok(swinging < walking, `${id} must be slower mid-swing than walking`);
  }
});
