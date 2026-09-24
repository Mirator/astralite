import assert from 'node:assert/strict';
import test from 'node:test';
import { DASH_IFRAMES, DASH_TIME, dashImmune, swordContacts } from '../app/dungeon-combat.ts';
import { cellKey } from '../app/dungeon-floor.ts';

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

// --- the dash -------------------------------------------------------------------------------------

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
