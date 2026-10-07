import assert from 'node:assert/strict';
import test from 'node:test';
import { decorReservations, planRoomMotif } from '../app/dungeon-decor-layout.ts';
import { altarHall, gateRacks, generateFloor, TILE } from '../app/dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 50 }, (_, i) => (i + 1) * 6151);
const floorsAt = (level: number) => SEEDS.map((seed) => generateFloor(seed, level));
const allFloors = () => [1, 2, 3].flatMap((level) => floorsAt(level));

/** Independent of `dungeon-decor-layout`'s own `fits`: recomputed here so the test is not tautological. */
const ownerCells = (floor: Floor, roomId: number) =>
  new Set(floor.tiles.filter((t) => t.room === roomId).map((t) => `${t.x},${t.z}`));

const coversOwnedGround = (floor: Floor, roomId: number, cx: number, cz: number, radius: number) => {
  const owner = ownerCells(floor, roomId);
  const reach = Math.ceil(radius / TILE);
  const roomTileX = Math.round(cx / TILE), roomTileZ = Math.round(cz / TILE);
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      if (Math.hypot(dx * TILE, dz * TILE) > radius * 0.72) continue;
      if (!owner.has(`${roomTileX + dx},${roomTileZ + dz}`)) return false;
    }
  }
  return true;
};

test('planRoomMotif is repeatable: the same seed and room always plans the same layout', () => {
  for (const floor of floorsAt(1).slice(0, 10)) {
    for (const room of floor.rooms) {
      const a = planRoomMotif(floor, room), b = planRoomMotif(generateFloor(floor.seed, floor.level), room);
      assert.deepEqual(a, b, `seed ${floor.seed} room ${room.id} drifted between two identical floors`);
    }
  }
});

test('neither planner mutates the floor it was handed', () => {
  for (const floor of floorsAt(1).slice(0, 8)) {
    const before = JSON.stringify({
      cells: [...floor.cells].sort(), tiles: floor.tiles, props: floor.props, weaponDrop: floor.weaponDrop,
    });
    decorReservations(floor);
    for (const room of floor.rooms) planRoomMotif(floor, room);
    const after = JSON.stringify({
      cells: [...floor.cells].sort(), tiles: floor.tiles, props: floor.props, weaponDrop: floor.weaponDrop,
    });
    assert.equal(after, before, `seed ${floor.seed} floor state changed after planning its motifs`);
  }
});

test('every room shape is covered without a motif bridging a hole in its own floor', () => {
  const shapes = new Set<string>();
  for (const floor of allFloors()) {
    for (const room of floor.rooms) {
      const layout = planRoomMotif(floor, room);
      if (!layout) continue;
      shapes.add(room.shape);
      assert.ok(
        coversOwnedGround(floor, room.id, layout.x, layout.z, layout.radius),
        `seed ${floor.seed} room ${room.id} (${room.shape}) plans a motif that reaches off its own floor`,
      );
    }
  }
  // Every shape the generator can produce got at least one motif-bearing room in this sample -
  // narrow halls, crosses and courts included, not just the round rooms this is easiest for. Measured
  // 2026-10-07 over these seeds: 367-386 motifs per shape, out of 491-685 rooms.
  for (const shape of ['hall', 'round', 'cross', 'court', 'gallery', 'crypt']) {
    assert.ok(shapes.has(shape), `no ${shape} room got a motif, so nothing above checked one`);
  }
});

test('a sanctuary either holds its centre clear or has no motif at all', () => {
  let planned = 0;
  for (const floor of allFloors()) {
    for (const room of floor.rooms) {
      if (room.encounter !== 'sanctuary') continue;
      const layout = planRoomMotif(floor, room);
      if (!layout) continue;
      planned++;
      if (layout.theme === 'keep') assert.fail(`seed ${floor.seed} room ${room.id} is a keep sanctuary but got a solid bed`);
      assert.equal(layout.clearRadius, 1.6, `seed ${floor.seed} room ${room.id} sanctuary motif has no clear centre`);
      assert.ok(layout.radius > layout.clearRadius, 'the bed does not extend past its own clear centre');
    }
  }
  // Measured 2026-10-07: 501 of the sample's 664 sanctuaries carry a motif.
  assert.ok(planned > 100, `only ${planned} sanctuaries got a motif, so the clear centre was barely checked`);
});

test('a motif never overlaps the weapon drop it shares a room with', () => {
  // A generated floor sets its drop about two units from its room's centre, too close for any motif, so the planner
  // gives that room none (0 of 150 floors, measured 2026-10-07) and a sweep of real floors checks nothing. Instead
  // the drop is moved into rooms that do carry a motif, at distances that force the planner to shrink it or give up.
  let shrunk = 0, dropped = 0;
  for (const floor of floorsAt(2).slice(0, 20)) {
    for (const room of floor.rooms) {
      const free = planRoomMotif(floor, room);
      if (!free) continue;
      for (const offset of [free.radius + 0.5, free.radius + 1, 2.4, 3.2]) {
        const moved = { ...floor, weaponDrop: { ...floor.weaponDrop, room: room.id, x: room.x * TILE + offset, z: room.z * TILE } };
        const layout = planRoomMotif(moved, room);
        if (!layout) { dropped++; continue; }
        if (layout.radius < free.radius) shrunk++;
        const drop = moved.weaponDrop;
        const distance = Math.max(Math.abs(drop.x - layout.x), Math.abs(drop.z - layout.z));
        assert.ok(
          distance >= layout.radius + 1.5 - 1e-9,
          `seed ${floor.seed} room ${room.id} motif (radius ${layout.radius}) sits ${distance.toFixed(2)} from a drop at ${offset}`,
        );
      }
    }
  }
  assert.ok(shrunk > 0, 'no motif was shrunk to clear the drop, so the clearance was never tested');
  assert.ok(dropped > 0, 'no room gave its motif up for a drop at its heart, so the fallback was never tested');
});

// --- Plan 019 Stage C: the Tide Gate's armoury --------------------------------------------------------------------

/** The rect `decorReservations` keeps round a point, if one is centred exactly there. */
const reservedAt = (floor: Floor, x: number, z: number, half = 1.5) =>
  decorReservations(floor).some((r) => Math.abs((r.minX + r.maxX) / 2 - x) < 1e-9 && Math.abs((r.minZ + r.maxZ) / 2 - z) < 1e-9 && Math.abs(r.maxX - r.minX - 2 * half) < 1e-9 && Math.abs(r.maxZ - r.minZ - 2 * half) < 1e-9);

test('every rack slot of the Tide Altar\'s hall is reserved, and neither floor one\'s Tide Gate nor any deeper floor reserves one', () => {
  // Plan 020 (D7): the armoury moved from floor one's Tide Gate to the hall. Both are `level: 1`, so the floor's `hall` marker is what tells them apart; a rule keyed
  // on the level would reserve the gate's slots again (the Tide Gate has none now) and would be the one a hall built from any other level missed.
  let slots = 0;
  for (const seed of SEEDS) {
    const hall = altarHall(seed);
    assert.equal(hall.level, 1, 'precondition: the hall is level 1, as floor one is');
    for (const slot of gateRacks(hall)) { slots++; assert.ok(reservedAt(hall, slot.x, slot.z), `hall ${seed}: the ${slot.arm} slot is not reserved, so decor could land on its rack`); }
  }
  assert.equal(slots, 7 * SEEDS.length, 'the sweep did not seat seven slots on every hall');
  let gateSlots = 0;
  for (const level of [1, 2, 3]) for (const floor of floorsAt(level)) {
    for (const slot of gateRacks(floor)) { gateSlots++; assert.ok(!reservedAt(floor, slot.x, slot.z), `level ${level} seed ${floor.seed}: a generated floor reserved a slot that nothing stands on`); }
  }
  assert.ok(gateSlots >= 7 * SEEDS.length * 3, 'the generated floors seated too few slots, so this checked little');
});

test('no floor-one motif reaches a rack slot (the gate is a keep sanctuary, which has none)', () => {
  for (const floor of floorsAt(1)) {
    const gate = floor.rooms[0], layout = planRoomMotif(floor, gate);
    // Both halves of the claim: today the gate has no motif at all, and should that change, it must clear every slot by the rack's own reservation.
    if (!layout) { assert.equal(gate.theme, 'keep', `seed ${floor.seed}: the gate lost its motif but is not a keep`); continue; }
    for (const slot of gateRacks(floor)) assert.ok(Math.max(Math.abs(slot.x - layout.x), Math.abs(slot.z - layout.z)) >= layout.radius + 1.5 - 1e-9, `seed ${floor.seed}: the gate's motif reaches the ${slot.arm} slot`);
  }
});
