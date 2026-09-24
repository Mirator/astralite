import assert from 'node:assert/strict';
import test from 'node:test';
import { decorReservations, planRoomMotif } from '../app/dungeon-decor-layout.ts';
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
    // `weaponDrop` is already in world units (generateFloor builds it as tile * TILE), like the layout.
    const distance = Math.max(Math.abs(drop.x - layout.x), Math.abs(drop.z - layout.z));
    assert.ok(
      distance >= layout.radius + 1.5 - 1e-9,
      `seed ${floor.seed} room ${room.id} motif (radius ${layout.radius}) sits ${distance.toFixed(2)} from the drop`,
    );
  }
});
