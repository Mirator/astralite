import assert from 'node:assert/strict';
import test from 'node:test';
import { canStand, generateFloor, cellKey, hasClearPath, moveOnFloor, TILE } from '../app/dungeon-floor.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const floors = (level = 1, seeds = SEEDS) => seeds.map((seed) => generateFloor(seed, level));

const neighbours = (floor: Floor) => {
  const map = new Map<number, number[]>(floor.rooms.map((room) => [room.id, []]));
  for (const [a, b] of floor.edges) { map.get(a)!.push(b); map.get(b)!.push(a); }
  return map;
};

const reachable = (floor: Floor) => {
  const adjacent = neighbours(floor), seen = new Set([0]), queue = [0];
  for (let i = 0; i < queue.length; i++) for (const next of adjacent.get(queue[i])!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
};

// Rooms joined by walkable corridor cells, whether or not the room graph says so.
const corridorLinks = (floor: Floor) => {
  const owner = new Map<string, number>();
  for (const tile of floor.tiles) if (tile.room >= 0) owner.set(cellKey(tile.x, tile.z), tile.room);
  const walkable = new Set(floor.tiles.map((tile) => cellKey(tile.x, tile.z)));
  const seen = new Set<string>(), links: number[][] = [];
  for (const tile of floor.tiles) {
    const key = cellKey(tile.x, tile.z);
    if (owner.has(key) || seen.has(key)) continue;
    const component = [[tile.x, tile.z]], touched = new Set<number>();
    seen.add(key);
    for (let i = 0; i < component.length; i++) {
      const [x, z] = component[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = cellKey(x + dx, z + dz);
        if (!walkable.has(next)) continue;
        if (owner.has(next)) { touched.add(owner.get(next)!); continue; }
        if (!seen.has(next)) { seen.add(next); component.push([x + dx, z + dz]); }
      }
    }
    links.push([...touched]);
  }
  return links;
};

test('the same seed always produces the same floor', () => {
  const a = generateFloor(4242, 2), b = generateFloor(4242, 2);
  assert.deepEqual(a.rooms, b.rooms);
  assert.deepEqual(a.spawns, b.spawns);
  assert.equal(a.tiles.length, b.tiles.length);
});

test('the room graph is a tree - one trunk, no loops back', () => {
  for (const floor of floors()) {
    assert.equal(floor.edges.length, floor.rooms.length - 1, `seed ${floor.seed}`);
    const pairs = new Set(floor.edges.map(([a, b]) => [a, b].sort((x, y) => x - y).join('-')));
    assert.equal(pairs.size, floor.edges.length, `seed ${floor.seed} repeats an edge`);
  }
});

test('every room can be walked to from the gate', () => {
  for (const floor of floors()) assert.equal(reachable(floor).size, floor.rooms.length, `seed ${floor.seed}`);
});

test('the stair sits at the far end of the trunk', () => {
  for (const floor of floors()) {
    const spine = floor.spine, goal = floor.rooms[floor.goal];
    assert.equal(spine[spine.length - 1], floor.goal, `seed ${floor.seed}`);
    assert.equal(goal.role, 'goal');
    assert.equal(floor.rooms[0].role, 'start');
    assert.equal(floor.rooms.filter((room) => room.role === 'goal').length, 1);
    assert.ok(goal.depth >= 6, `seed ${floor.seed} trunk is only ${goal.depth} deep`);
  }
});

test('a floor always offers at least two dead ends, and they hang off the trunk', () => {
  for (const floor of floors()) {
    const branches = floor.rooms.filter((room) => room.role === 'branch');
    assert.ok(branches.length >= 2, `seed ${floor.seed} has ${branches.length} dead ends`);
    const adjacent = neighbours(floor);
    for (const branch of branches) {
      const leaf = adjacent.get(branch.id)!.length === 1;
      const stub = adjacent.get(branch.id)!.every((id) => floor.rooms[id].role === 'branch' || floor.spine.includes(id));
      assert.ok(leaf || stub, `seed ${floor.seed} branch ${branch.id} is not a stub`);
    }
  }
});

test('corridors never hand out a shortcut past the room graph', () => {
  let merges = 0;
  const sample = floors(1, SEEDS.slice(0, 20));
  for (const floor of sample) {
    const declared = new Set(floor.edges.map(([a, b]) => [a, b].sort((x, y) => x - y).join('-')));
    const adjacent = neighbours(floor);
    for (const touched of corridorLinks(floor)) {
      for (let i = 0; i < touched.length; i++) for (let j = i + 1; j < touched.length; j++) {
        const key = [touched[i], touched[j]].sort((x, y) => x - y).join('-');
        if (declared.has(key)) continue;
        // Two mouths of the same room merging just outside it is harmless - the player stands at that
        // room either way. A link between rooms with nothing in common is a genuine bypass of the trunk.
        const shares = [...adjacent.get(touched[i])!].some((id) => adjacent.get(touched[j])!.includes(id) && touched.includes(id));
        assert.ok(shares, `seed ${floor.seed}: rooms ${key} are linked but the room graph never joined them`);
        merges++;
      }
    }
  }
  // Harmless merges are a smell rather than a fault: 0.17 per floor as tuned, 0.53 once room spacing
  // grows and the corridor guard is off. The hard assertion above is what protects the linear run.
  const perFloor = merges / sample.length;
  assert.ok(perFloor < 0.45, `${perFloor.toFixed(2)} corridor merges per floor - room spacing or the corridor guard regressed`);
});

test('guards stand on walkable floor, never inside a wall or a prop', () => {
  for (const floor of floors(2)) {
    const walkable = new Set(floor.tiles.map((tile) => cellKey(tile.x, tile.z)));
    for (const spawn of floor.spawns) assert.ok(walkable.has(cellKey(spawn.x, spawn.z)), `seed ${floor.seed} spawn off floor`);
  }
});

test('the gate is safe and the stair is guarded by wardens', () => {
  for (const level of [1, 3]) for (const floor of floors(level)) {
    assert.equal(floor.spawns.filter((spawn) => spawn.room === 0).length, 0, `seed ${floor.seed} spawns in the gate`);
    const stair = floor.spawns.filter((spawn) => spawn.room === floor.goal);
    assert.equal(stair.length, level >= 3 ? 3 : 2, `seed ${floor.seed} stair pack`);
    assert.ok(stair.every((spawn) => spawn.kind === 'warden' && !spawn.ambush), `seed ${floor.seed} stair is not wardens`);
  }
});

test('quiet halls are pacing, never two in a row', () => {
  for (const floor of floors()) {
    const empty = floor.spine.slice(1).map((id) => !floor.spawns.some((spawn) => spawn.room === id));
    for (let i = 1; i < empty.length; i++) assert.ok(!(empty[i] && empty[i - 1]), `seed ${floor.seed} has two empty halls in a row`);
  }
});

test('deeper floors are meaner', () => {
  const count = (level: number) => floors(level).reduce((total, floor) => total + floor.spawns.length, 0) / SEEDS.length;
  const wardens = (level: number) => floors(level).reduce((total, floor) => total + floor.spawns.filter((s) => s.kind === 'warden').length, 0) / SEEDS.length;
  assert.ok(count(3) > count(1) * 1.4, `floor 3 should be far busier: ${count(1).toFixed(1)} -> ${count(3).toFixed(1)}`);
  assert.ok(wardens(3) > wardens(1) * 1.5, `floor 3 should hold more wardens: ${wardens(1).toFixed(1)} -> ${wardens(3).toFixed(1)}`);
});

test('generation stays cheap enough to rebuild a floor mid-run', () => {
  for (let warm = 0; warm < 20; warm++) generateFloor(warm * 13, 3);
  const started = performance.now(), runs = 40;
  for (let i = 0; i < runs; i++) generateFloor(i * 7919, 3);
  const each = (performance.now() - started) / runs;
  assert.ok(each < 25, `generateFloor took ${each.toFixed(1)} ms per floor`);
});

test('encounter roles provide safe shrines, hidden ambushes and live gauntlets', () => {
  for (const floor of floors()) {
    assert.ok(floor.rooms.some(r => r.encounter === 'gauntlet'));
    assert.ok(floor.rooms.some(r => r.id > 0 && r.encounter === 'sanctuary'));
    assert.ok(floor.rooms.some(r => r.encounter === 'ambush'));
    for (const room of floor.rooms) {
      const pack = floor.spawns.filter(s => s.room === room.id);
      if (room.encounter === 'sanctuary') assert.equal(pack.length, 0);
      if (room.encounter === 'ambush') assert.ok(pack.length >= 2 && pack.every(s => s.ambush));
      if (room.encounter === 'gauntlet') assert.ok(pack.length === 2 && pack.every(s => s.kind === 'stalker'));
    }
  }
});

test('seeded encounter bags vary the route rhythm while preserving safe breaks', () => {
  const rhythms = new Set(floors().map(floor => floor.spine.slice(1,-1).map(id => floor.rooms[id].encounter).join(',')));
  assert.ok(rhythms.size > 12, `only ${rhythms.size} encounter sequences across 40 seeds`);
});


test('attack lanes respect walls and narrow corners while permitting open approaches', () => {
  const cells=new Set<string>();for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)cells.add(cellKey(x,z));
  const left={x:-TILE,z:0},right={x:TILE,z:0};
  assert.equal(hasClearPath(cells,left,right),true);
  cells.delete(cellKey(0,0));
  assert.equal(hasClearPath(cells,left,right),false,'solid prop blocks direct pounce');
  assert.equal(hasClearPath(cells,{x:-TILE,z:-TILE},{x:TILE,z:TILE}),false,'diagonal cannot cut a blocked corner');
  assert.equal(hasClearPath(cells,{x:-TILE,z:TILE},{x:TILE,z:TILE}),true,'open lane beside prop remains usable');
});

// One character per tile, '#' solid; row 0 is z = 0, column 0 is x = 0. Tile n sits at world n * TILE.
const floorFrom = (rows: string[]) => { const cells = new Set<string>(); rows.forEach((row, z) => row.split('').forEach((c, x) => { if (c !== '#') cells.add(cellKey(x, z)); })); return cells; };
// How far a 0.32-radius body's centre may sit from a tile centre before its edge crosses into the next
// tile: everything below is derived from this one number, so a changed radius changes the tests too.
const REACH = TILE / 2 - 0.32;

test('a body cannot walk through a wall', () => {
  // Open, solid, open. Walking right from the first tile must stop short of the second.
  const cells = floorFrom(['.#.']);
  const body = { x: 0, z: 0 };
  moveOnFloor(cells, body, 2 * TILE, 0);
  assert.ok(body.x > 0, 'the body should still have covered the open ground in front of it');
  assert.ok(body.x < REACH, `stopped at ${body.x.toFixed(3)}, which puts its edge inside the wall`);
  assert.equal(canStand(cells, body.x, body.z), true);
  // The same wall stops the walk from the far side too, so this is the wall and not the floor's edge.
  const back = { x: 2 * TILE, z: 0 };
  moveOnFloor(cells, back, -2 * TILE, 0);
  assert.ok(back.x > 2 * TILE - REACH, `stopped at ${back.x.toFixed(3)}, inside the wall from the other side`);
});

test('a body slides along a wall instead of stopping dead against it', () => {
  // Open row with a solid row below: walking diagonally into it must keep all of the sideways travel.
  const cells = floorFrom(['....', '####']);
  const body = { x: 0, z: 0 };
  moveOnFloor(cells, body, 2 * TILE, 2 * TILE);
  assert.ok(body.x > 2 * TILE - 0.01, `only slid to x ${body.x.toFixed(3)}; a blocked axis must not eat the free one`);
  assert.ok(body.z < REACH, `slid to z ${body.z.toFixed(3)}, which is inside the wall`);
});

test('a body cannot squeeze through the diagonal gap between two solid cells', () => {
  // Open on one diagonal, solid on the other: visually a gap, but a body has width.
  const cells = floorFrom(['.#', '#.']);
  const body = { x: 0, z: 0 };
  moveOnFloor(cells, body, TILE, TILE);
  assert.ok(Math.hypot(body.x, body.z) < TILE / 2, `slipped to ${body.x.toFixed(3)},${body.z.toFixed(3)} - the diagonal is not a door`);
  assert.equal(canStand(cells, body.x, body.z), true);
  // The far cell is perfectly standable; it is the crossing that is refused, not the destination.
  assert.equal(canStand(cells, TILE, TILE), true);
});

test('a step too big to check in one go is subdivided, so nothing tunnels through a one-tile wall', () => {
  // 3 tiles of travel in a single call clears the wall entirely: without the steps loop the end point is
  // open floor and the body teleports past. That is the bug this pins.
  const cells = floorFrom(['.#..']);
  const body = { x: 0, z: 0 };
  moveOnFloor(cells, body, 3 * TILE, 0);
  assert.equal(canStand(cells, 3 * TILE, 0), true, 'the far side is open, so only subdivision can stop the body');
  assert.ok(body.x < REACH, `tunnelled to x ${body.x.toFixed(3)}`);
  // Same wall, same distance, delivered as sixty small frames: identical outcome, which is the point.
  const stepped = { x: 0, z: 0 };
  for (let frame = 0; frame < 60; frame++) moveOnFloor(cells, stepped, 3 * TILE / 60, 0);
  assert.ok(Math.abs(stepped.x - body.x) < 0.16, `one big step landed at ${body.x.toFixed(3)}, sixty small ones at ${stepped.x.toFixed(3)}`);
});

test('the body has width, so it cannot tuck into a corner a point would fit through', () => {
  // Three open tiles around one solid corner. The centre of the open tile is fine.
  const cells = floorFrom(['..', '.#']);
  assert.equal(canStand(cells, 0, 0), true);
  // Sliding toward the solid diagonal puts a corner of the body inside it well before the centre gets there.
  assert.equal(canStand(cells, REACH - 0.01, REACH - 0.01), true);
  assert.equal(canStand(cells, REACH + 0.01, REACH + 0.01), false);
  // It is the radius doing that, not the tile: a body with no width still fits.
  assert.equal(canStand(cells, REACH + 0.01, REACH + 0.01, 0), true);
  // Walking diagonally at that corner slides the body down the open side instead of cutting across it:
  // it ends up somewhere legal, and never with both axes past the corner into the solid tile.
  const body = { x: 0, z: 0 };
  moveOnFloor(cells, body, TILE, TILE);
  assert.equal(canStand(cells, body.x, body.z), true);
  assert.ok(!(body.x > REACH && body.z > REACH), `cut the corner to ${body.x.toFixed(3)},${body.z.toFixed(3)}`);
});
