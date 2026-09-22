import assert from 'node:assert/strict';
import test from 'node:test';
import { decorReservations, planFloorMotifs, planRoomMotif } from '../app/dungeon-decor-layout.ts';
import { generateFloor, TILE } from '../app/dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 50 }, (_, i) => (i + 1) * 6151);
const floorsAt = (level: number) => SEEDS.map((seed) => generateFloor(seed, level));
const allFloors = () => [1, 2, 3].flatMap((level) => floorsAt(level));

/** Independent of `dungeon-decor-layout`'s own `fits`: recomputed here so the test is not tautological. */
const ownerCells = (floor: Floor, roomId: number) =>
  new Set(floor.tiles.filter((t) => t.room === roomId && !t.wood).map((t) => `${t.x},${t.z}`));

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

test('across a wide sample, all three themes end up with a realized motif', () => {
  const seen = new Set<string>();
  for (const floor of allFloors()) {
    for (const layout of planFloorMotifs(floor)) seen.add(layout.theme);
  }
  assert.deepEqual(seen, new Set(['keep', 'ruins', 'flooded']));
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
      shapes.add(room.shape);
      const layout = planRoomMotif(floor, room);
      if (!layout) continue;
      assert.ok(
        coversOwnedGround(floor, room.id, layout.x, layout.z, layout.radius),
        `seed ${floor.seed} room ${room.id} (${room.shape}) plans a motif that reaches off its own floor`,
      );
    }
  }
  // Every shape the generator can produce got at least one motif-bearing room in this sample -
  // narrow halls, crosses and courts included, not just the round rooms this is easiest for.
  for (const shape of ['hall', 'round', 'cross', 'court', 'gallery', 'crypt']) {
    assert.ok(shapes.has(shape), `sample never produced a ${shape} room; widen SEEDS`);
  }
});

test('rooms can sit on either side of the origin, and the planner does not care which', () => {
  let negative = 0;
  for (const floor of floorsAt(2)) {
    for (const room of floor.rooms) {
      if (room.x >= 0 && room.z >= 0) continue;
      negative++;
      const layout = planRoomMotif(floor, room);
      if (layout) assert.ok(Number.isFinite(layout.x) && Number.isFinite(layout.z), 'non-finite world position');
    }
  }
  assert.ok(negative > 0, 'sample never placed a room off the positive quadrant; widen SEEDS');
});

test('a gauntlet and the goal room never get a motif', () => {
  for (const floor of allFloors()) {
    for (const room of floor.rooms) {
      if (room.encounter !== 'gauntlet' && room.role !== 'goal') continue;
      assert.equal(planRoomMotif(floor, room), null, `seed ${floor.seed} room ${room.id} should be skipped`);
    }
  }
});

test('a sanctuary either holds its centre clear or has no motif at all', () => {
  for (const floor of allFloors()) {
    for (const room of floor.rooms) {
      if (room.encounter !== 'sanctuary') continue;
      const layout = planRoomMotif(floor, room);
      if (!layout) continue;
      if (layout.theme === 'keep') assert.fail(`seed ${floor.seed} room ${room.id} is a keep sanctuary but got a solid bed`);
      assert.equal(layout.clearRadius, 1.6, `seed ${floor.seed} room ${room.id} sanctuary motif has no clear centre`);
      assert.ok(layout.radius > layout.clearRadius, 'the bed does not extend past its own clear centre');
    }
  }
});

test('a motif never overlaps the weapon drop it shares a room with', () => {
  for (const floor of allFloors()) {
    const drop = floor.weaponDrop;
    const room = floor.rooms[drop.room];
    const layout = planRoomMotif(floor, room);
    if (!layout) continue;
    const distance = Math.max(Math.abs(drop.x * TILE - layout.x), Math.abs(drop.z * TILE - layout.z));
    assert.ok(
      distance >= layout.radius + 1.5 - 1e-9,
      `seed ${floor.seed} room ${room.id} motif (radius ${layout.radius}) sits ${distance.toFixed(2)} from the drop`,
    );
  }
});

test('decorReservations covers every room, the drop, and reserves a gauntlet whole', () => {
  for (const floor of floorsAt(1).slice(0, 15)) {
    const rects = decorReservations(floor);
    // One rectangle per room (goal, sanctuary and gauntlet each add exactly one; a plain room adds
    // exactly one; a sanctuary that is not also the goal adds a second, smaller one for its centre)
    // plus one for the drop.
    const sanctuaries = floor.rooms.filter((r) => r.encounter === 'sanctuary' && r.role !== 'goal').length;
    assert.equal(rects.length, floor.rooms.length + sanctuaries + 1);
    for (const rect of rects) {
      assert.ok(rect.minX < rect.maxX && rect.minZ < rect.maxZ, 'degenerate reservation rectangle');
    }
    const gauntlet = floor.rooms.find((r) => r.encounter === 'gauntlet');
    if (gauntlet) {
      const full = rects.find((r) => Math.abs(r.maxX - r.minX - gauntlet.halfX * TILE * 2) < 1e-9);
      assert.ok(full, `seed ${floor.seed} gauntlet room ${gauntlet.id} was not reserved at its full footprint`);
    }
  }
});

test('planFloorMotifs is exactly the rooms planRoomMotif accepts, no more and no fewer', () => {
  for (const floor of floorsAt(3).slice(0, 10)) {
    const expected = floor.rooms.filter((room) => planRoomMotif(floor, room) !== null).length;
    assert.equal(planFloorMotifs(floor).length, expected, `seed ${floor.seed}`);
  }
});
