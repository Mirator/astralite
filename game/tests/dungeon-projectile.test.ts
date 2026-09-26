import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey } from '../app/dungeon-floor.ts';
import { BOLT_RADIUS, flyShot, poolCatches, poolStep, reloadStep, type Mark, type Pool, type Shot } from '../app/dungeon-projectile.ts';
import { chainLength, WEAPONS } from '../app/dungeon-weapon.ts';

const openFloor = (half = 10) => { const cells = new Set<string>(); for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) cells.add(cellKey(x, z)); return cells; };
const cells = openFloor();
const bolt = (patch: Partial<Shot> = {}): Shot => ({ x: 0, z: 0, dx: 0, dz: -1, speed: 19, life: .62, pierce: 0, damage: 9, spent: new Set<number>(), ...patch });
const mark = (x: number, z: number, index = 0): Mark => ({ x, z, index });

test('a bolt walks its flight rather than jumping it', () => {
  // At 19 u/s a frame covers most of a tile, so a body standing anywhere along the step has to be hit.
  // Testing only where it landed is what let the stalker's pounce pass clean through the knight before
  // sweptContact existed, and a bolt is faster than a stalker.
  const shot = bolt();
  const flight = flyShot(shot, cells, [mark(0, -.4)], 1 / 60);
  assert.deepEqual(flight.hits, [0], 'a body inside the step was passed through');
  assert.ok(flight.done, 'a bolt with no pierce stops on the first body');
});

test('a wall stops a bolt, and says which kind of stop it was', () => {
  // Cell -2 begins at -1.5 tiles, so a bolt at -2.0 is one frame of flight short of the stone.
  const walled = new Set(cells); walled.delete(cellKey(0, -2));
  const flight = flyShot(bolt({ z: -2 }), walled, [], 1 / 60);
  assert.equal(flight.struck, true);
  assert.equal(flight.done, true);
  assert.deepEqual(flight.hits, []);
  // And the same shot in open air keeps going.
  assert.equal(flyShot(bolt({ z: -2 }), cells, [], 1 / 60).struck, false);
});

test('one bolt never bills the same body twice, however long it is in the air', () => {
  const shot = bolt({ pierce: 3 });
  const target = mark(0, -3);
  let hits = 0;
  for (let frame = 0; frame < 20; frame++) {
    const flight = flyShot(shot, cells, [target], 1 / 60);
    shot.x = flight.x; shot.z = flight.z; shot.life = flight.life; shot.pierce = flight.pierce;
    hits += flight.hits.length;
    if (flight.done) break;
  }
  assert.equal(hits, 1);
});

test('piercing spends itself on the nearest body first', () => {
  // Order in the caller's array must not decide who a bolt hits: the near body is struck first and the
  // far one only if the bolt had pierce left over.
  const shot = bolt({ pierce: 1, speed: 240 });
  const flight = flyShot(shot, cells, [mark(0, -3, 7), mark(0, -1, 4)], 1 / 60);
  assert.deepEqual(flight.hits, [4, 7]);
  assert.ok(flight.done, 'two bodies and one pierce is spent');

  const single = flyShot(bolt({ speed: 240 }), cells, [mark(0, -3, 7), mark(0, -1, 4)], 1 / 60);
  assert.deepEqual(single.hits, [4], 'without pierce only the near one');
});

test('two bodies brushed in one step: a spent bolt stops in the nearer, whatever the caller\'s order', () => {
  // One frame at 19 u/s is a single step of about 0.32, so both bodies sit inside the same swept segment.
  // Only the order along the path can decide between them; the caller lists the far one first.
  const far = mark(0, -.3, 7), near = mark(.2, -.05, 4);
  const shot = bolt();
  const flight = flyShot(shot, cells, [far, near], 1 / 60);
  assert.deepEqual(flight.hits, [4], 'the bolt went through the near body to bill the far one');
  assert.ok(flight.done);
  assert.deepEqual([...shot.spent], [4], 'the far body was marked as billed by a bolt that never reached it');
  // With one pierce left over it takes both, still nearest first.
  assert.deepEqual(flyShot(bolt({ pierce: 1 }), cells, [far, near], 1 / 60).hits, [4, 7]);
});

test('a body off to the side of the line is missed', () => {
  assert.deepEqual(flyShot(bolt(), cells, [mark(BOLT_RADIUS + .3, -.3)], 1 / 60).hits, []);
  assert.deepEqual(flyShot(bolt(), cells, [mark(BOLT_RADIUS - .2, -.3)], 1 / 60).hits, [0]);
});

test('a bolt falls out of the air when its flight runs out', () => {
  const flight = flyShot(bolt({ life: 1 / 120 }), cells, [], 1 / 60);
  assert.equal(flight.life, 0);
  assert.equal(flight.done, true);
  assert.equal(flight.struck, false, 'the clock is not a wall');
});

test('the quiver refills on its own clock and never past full', () => {
  // A cooldown would still let the knight back away and fire forever, since he outruns everything in
  // the keep; what limits a ranged arm is a quiver that runs dry.
  assert.deepEqual(reloadStep(0, 4, 0, 1.8, 1), { spare: 0, timer: 1 });
  const one = reloadStep(0, 4, 1, 1.8, 1);
  assert.equal(one.spare, 1);
  assert.ok(Math.abs(one.timer - 0.2) < 1e-9);
  assert.deepEqual(reloadStep(4, 4, 0, 1.8, 5), { spare: 4, timer: 0 }, 'a full quiver does not tick');
  // A tab hidden for a minute must not hand back more than the quiver holds, but must not hand back
  // only one either: whole refills are counted out.
  const long = reloadStep(0, 4, 0, 1.8, 60);
  assert.equal(long.spare, 4);
  for (const bad of [0, -1, Number.NaN]) assert.deepEqual(reloadStep(1, 4, .5, 1.8, bad), { spare: 1, timer: .5 });
});

test('held fire outpaces the refill on every ranged arm, so the quiver drains and stays drained', () => {
  // The relation ranged.spec.ts's "sustained fire" depends on. Held, the trigger restarts the swing the
  // frame the last one ends and the shot leaves at its anticipation, so one leaves every `duration`
  // seconds while one comes back every `refill`: a quiver that refilled faster than it fires would let
  // the knight back away shooting forever.
  const ranged = Object.values(WEAPONS).filter(weapon => weapon.ranged);
  assert.ok(ranged.length >= 2, 'the crossbow and the flask are both ranged');
  for (const weapon of ranged) {
    const { capacity, refill } = weapon.ranged!;
    assert.equal(chainLength(weapon), 1, `${weapon.id} is a string, so its cadence is not one duration`);
    assert.ok(weapon.duration < refill, `${weapon.id} fires every ${weapon.duration}s but refills every ${refill}s`);
    // Thirteen seconds of held fire at 60 fps, as the game's loop drives the quiver and the reload clock.
    let spare = capacity, timer = 0, swing = 0, loosed = false;
    const dt = 1 / 60;
    for (let frame = 0; frame < 13 * 60; frame++) {
      if (spare < capacity) ({ spare, timer } = reloadStep(spare, capacity, timer, refill, dt));
      swing += dt;
      if (!loosed && swing >= weapon.anticipation) { loosed = true; if (spare > 0) spare -= 1; }
      if (swing >= weapon.duration) { swing -= weapon.duration; loosed = false; }
      // After nine seconds, as the browser samples it: at the bottom, oscillating between none and one.
      if (frame >= 9 * 60) assert.ok(spare <= 1, `${weapon.id} climbed back to ${spare} under held fire`);
    }
  }
});

test('fire on the ground bites on its own clock, once a frame at most', () => {
  const pool: Pool = { x: 0, z: 0, radius: 2.2, life: 2.5, damage: 8, interval: .5, timer: 0 };
  // The first frame bills, because the timer starts spent: a flask that lands on a body should bite it.
  const first = poolStep(pool, 1 / 60);
  assert.equal(first.bites, 1);
  assert.equal(first.timer, pool.interval);

  // And then nothing until the interval has run.
  pool.timer = first.timer; pool.life = first.life;
  let bites = 0, frames = 0;
  while (pool.life > 0 && frames < 400) {
    const burn = poolStep(pool, 1 / 60);
    pool.life = burn.life; pool.timer = burn.timer; bites += burn.bites; frames++;
  }
  // 2.5s of fire at one bite every 0.5s, after the one already taken.
  assert.equal(bites, 4);
});

test('fire catches what stands in it and nothing outside it', () => {
  const pool: Pool = { x: 3, z: -2, radius: 2.2, life: 2.5, damage: 8, interval: .5, timer: 0 };
  assert.equal(poolCatches(pool, 3, -2), true);
  assert.equal(poolCatches(pool, 3 + 2.1, -2), true);
  assert.equal(poolCatches(pool, 3 + 2.3, -2), false);
});
