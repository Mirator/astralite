import assert from 'node:assert/strict';
import test from 'node:test';
import { cellKey } from '../app/dungeon-floor.ts';
import { BOLT_RADIUS, flyShot, poolCatches, poolStep, reloadStep, type Mark, type Pool, type Shot } from '../app/dungeon-projectile.ts';

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
