import assert from 'node:assert/strict';
import test from 'node:test';
import { decorReservations } from '../app/dungeon-decor-layout.ts';
import { generateFloor, TILE } from '../app/dungeon-floor.ts';
import { planPavingPatches } from '../app/dungeon-paving-layout.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);
const LEVELS = [1, 2, 3];
const allFloors = () => LEVELS.flatMap((level) => SEEDS.map((seed) => generateFloor(seed, level)));

/** Independent of the module's own margin constant, matching the plan's own stated value. */
const RESERVATION_MARGIN = 0.3;
const insideReservation = (floor: Floor, wx: number, wz: number) =>
  decorReservations(floor).some((r) =>
    wx >= r.minX - RESERVATION_MARGIN && wx <= r.maxX + RESERVATION_MARGIN &&
    wz >= r.minZ - RESERVATION_MARGIN && wz <= r.maxZ + RESERVATION_MARGIN);

/** A room's own stone cell count, recomputed independently of the module under test. */
const roomStoneCells = (floor: Floor, roomId: number) =>
  floor.tiles.filter((t) => t.room === roomId && !t.wood).length;

const stoneCellSet = (floor: Floor) => new Set(floor.tiles.filter((t) => !t.wood && t.room >= 0).map((t) => `${t.x},${t.z}`));

test('planPavingPatches is repeatable: the same floor plans the same patches every time', () => {
  for (const floor of allFloors().slice(0, 60)) {
    const a = planPavingPatches(floor);
    const b = planPavingPatches(generateFloor(floor.seed, floor.level));
    assert.deepEqual(
      { pairs: a.pairs, settled: a.settled, pairedCells: [...a.pairedCells].sort(), settledCells: [...a.settledCells].sort() },
      { pairs: b.pairs, settled: b.settled, pairedCells: [...b.pairedCells].sort(), settledCells: [...b.settledCells].sort() },
      `seed ${floor.seed} level ${floor.level} drifted between two identical floors`,
    );
  }
});

test('planPavingPatches never mutates the floor it was handed', () => {
  for (const floor of allFloors().slice(0, 30)) {
    const before = JSON.stringify({ cells: [...floor.cells].sort(), tiles: floor.tiles, props: floor.props });
    planPavingPatches(floor);
    const after = JSON.stringify({ cells: [...floor.cells].sort(), tiles: floor.tiles, props: floor.props });
    assert.equal(after, before, `seed ${floor.seed} floor state changed after planning its paving`);
  }
}
);

test('a pair always sits on two adjacent stone cells of the same room, never wood, a hole or a corridor', () => {
  for (const floor of allFloors()) {
    const stone = stoneCellSet(floor);
    for (const pair of planPavingPatches(floor).pairs) {
      assert.ok(stone.has(`${pair.ax},${pair.az}`), `seed ${floor.seed} pair cell a is not an owned stone cell`);
      assert.ok(stone.has(`${pair.bx},${pair.bz}`), `seed ${floor.seed} pair cell b is not an owned stone cell`);
      const dx = Math.abs(pair.ax - pair.bx), dz = Math.abs(pair.az - pair.bz);
      assert.ok((dx === 1 && dz === 0) || (dx === 0 && dz === 1), `seed ${floor.seed} pair cells do not share an edge`);
      const roomA = floor.tiles.find((t) => t.x === pair.ax && t.z === pair.az)!.room;
      const roomB = floor.tiles.find((t) => t.x === pair.bx && t.z === pair.bz)!.room;
      assert.equal(roomA, pair.room, `seed ${floor.seed} pair.room does not match cell a's own room`);
      assert.equal(roomB, pair.room, `seed ${floor.seed} pair's two cells belong to different rooms`);
    }
  }
});

test('every pair stays inside one 12-tile spatial batch', () => {
  for (const floor of allFloors()) {
    for (const pair of planPavingPatches(floor).pairs) {
      const batchA = `${Math.floor(pair.ax / 12)},${Math.floor(pair.az / 12)}`;
      const batchB = `${Math.floor(pair.bx / 12)},${Math.floor(pair.bz / 12)}`;
      assert.equal(batchA, batchB, `seed ${floor.seed} pair crosses a spatial batch boundary`);
      assert.equal(pair.batch, batchA, `seed ${floor.seed} pair.batch does not match its own cells`);
    }
  }
});

test('no cell is ever claimed twice: pairs do not overlap each other, and settled cells never overlap a pair', () => {
  for (const floor of allFloors()) {
    const plan = planPavingPatches(floor);
    assert.equal(plan.pairedCells.size, plan.pairs.length * 2, `seed ${floor.seed} a pair reused a cell another pair already claimed`);
    for (const key of plan.settledCells) {
      assert.ok(!plan.pairedCells.has(key), `seed ${floor.seed} settled cell ${key} was also claimed by a pair`);
    }
    assert.equal(plan.settled.length, plan.settledCells.size, `seed ${floor.seed} a settled single reused a cell another settled single already claimed`);
  }
});

test('no patch ever lands inside a 004 reservation, with margin', () => {
  for (const floor of allFloors()) {
    const plan = planPavingPatches(floor);
    for (const pair of plan.pairs) {
      assert.ok(!insideReservation(floor, pair.ax * TILE, pair.az * TILE), `seed ${floor.seed} pair cell a sits inside a reservation`);
      assert.ok(!insideReservation(floor, pair.bx * TILE, pair.bz * TILE), `seed ${floor.seed} pair cell b sits inside a reservation`);
    }
    for (const single of plan.settled) {
      assert.ok(!insideReservation(floor, single.x * TILE, single.z * TILE), `seed ${floor.seed} settled single sits inside a reservation`);
    }
  }
});

test('a gauntlet room, whose entire footprint is reserved, never gets a pair or a settled single', () => {
  for (const floor of allFloors()) {
    const gauntlet = floor.rooms.filter((r) => r.encounter === 'gauntlet').map((r) => r.id);
    if (!gauntlet.length) continue;
    const plan = planPavingPatches(floor);
    for (const pair of plan.pairs) assert.ok(!gauntlet.includes(pair.room), `seed ${floor.seed} a gauntlet room got a paving pair`);
    for (const single of plan.settled) assert.ok(!gauntlet.includes(single.room), `seed ${floor.seed} a gauntlet room got a settled single`);
  }
});

test('coverage stays inside the plan\'s own bound: paired cells never exceed 35% of a room\'s stone cells', () => {
  for (const floor of allFloors()) {
    const plan = planPavingPatches(floor);
    const perRoom = new Map<number, number>();
    for (const pair of plan.pairs) perRoom.set(pair.room, (perRoom.get(pair.room) ?? 0) + 2);
    for (const [room, consumed] of perRoom) {
      const total = roomStoneCells(floor, room);
      assert.ok(consumed <= 0.35 * total + 1e-9, `seed ${floor.seed} room ${room} paired ${consumed}/${total} stone cells, over the 35% bound`);
    }
  }
});

test('a floor with negative-coordinate rooms plans finite, well-formed patches the same way', () => {
  let sawNegative = false;
  for (const floor of allFloors()) {
    if (!floor.rooms.some((r) => r.x < 0 || r.z < 0)) continue;
    sawNegative = true;
    const plan = planPavingPatches(floor);
    for (const pair of plan.pairs) {
      assert.ok(Number.isFinite(pair.x) && Number.isFinite(pair.z), `seed ${floor.seed} pair has a non-finite world position`);
    }
  }
  assert.ok(sawNegative, 'sample never produced a room off the positive quadrant; widen SEEDS');
});

test('across a wide sample, every theme realizes at least one pair and one settled single', () => {
  const pairThemes = new Set<string>(), settledThemes = new Set<string>();
  for (const floor of allFloors()) {
    const plan = planPavingPatches(floor);
    for (const pair of plan.pairs) pairThemes.add(pair.theme);
    for (const single of plan.settled) settledThemes.add(floor.rooms[single.room].theme);
  }
  assert.deepEqual(pairThemes, new Set(['keep', 'ruins', 'flooded']), 'not every theme realized a pair across the sample');
  assert.deepEqual(settledThemes, new Set(['keep', 'ruins', 'flooded']), 'not every theme realized a settled single across the sample');
});
