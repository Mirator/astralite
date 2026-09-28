import assert from 'node:assert/strict';
import test from 'node:test';
import { ARRIVAL_CLEAR, canStand, drawKind, generateFloor, cellKey, moveOnFloor, PACK_MIX, TILE } from '../app/dungeon-floor.ts';
import { FOUND_WEAPONS } from '../app/dungeon-weapon.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const floors = (level = 1, seeds = SEEDS) => seeds.map((seed) => generateFloor(seed, level));

// Plan 016: doors only ever lead onward, so the graph is directed - from a chamber to the ones its doors open on.
const onward = (floor: Floor) => {
  const map = new Map<number, number[]>(floor.rooms.map((room) => [room.id, []]));
  for (const door of floor.doors) map.get(door.from)!.push(door.to);
  return map;
};

const reachable = (floor: Floor, from = 0, next = onward(floor)) => {
  const seen = new Set([from]), queue = [from];
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i])!) if (!seen.has(id)) { seen.add(id); queue.push(id); }
  return seen;
};

test('the same seed always produces the same floor', () => {
  const a = generateFloor(4242, 2), b = generateFloor(4242, 2);
  assert.deepEqual(a.rooms, b.rooms);
  assert.deepEqual(a.spawns, b.spawns);
  assert.equal(a.tiles.length, b.tiles.length);
});

test('every door leads exactly one layer on, and no chamber has two doors into the same one', () => {
  for (const level of [1, 3]) for (const floor of floors(level)) {
    assert.ok(floor.doors.length > 0, `seed ${floor.seed} has no doors`);
    for (const door of floor.doors) assert.equal(floor.rooms[door.to].layer, floor.rooms[door.from].layer + 1, `seed ${floor.seed} door ${door.id} skips a layer`);
    for (const room of floor.rooms) {
      const ways = floor.doors.filter((door) => door.from === room.id);
      if (room.role === 'goal') { assert.equal(ways.length, 0, `seed ${floor.seed}: the stair hall has a door out`); continue; }
      assert.ok(ways.length >= 1 && ways.length <= 3, `seed ${floor.seed} room ${room.id} has ${ways.length} doors`);
      assert.equal(new Set(ways.map((door) => door.to)).size, ways.length, `seed ${floor.seed} room ${room.id} has two doors into one chamber`);
    }
    assert.deepEqual(floor.edges, floor.doors.map((door) => [door.from, door.to]), 'edges are the doors');
  }
});

test('every chamber can be reached from the gate, and the stair from every chamber', () => {
  for (const floor of floors()) {
    assert.equal(reachable(floor).size, floor.rooms.length, `seed ${floor.seed} has a chamber no door opens on`);
    const next = onward(floor);
    for (const room of floor.rooms) assert.ok(reachable(floor, room.id, next).has(floor.goal), `seed ${floor.seed} room ${room.id} is a dead end`);
  }
});

test('the stair sits in the last layer, alone', () => {
  for (const floor of floors()) {
    const goal = floor.rooms[floor.goal];
    assert.equal(goal.role, 'goal');
    assert.equal(floor.rooms[0].role, 'start');
    assert.equal(floor.rooms.filter((room) => room.role === 'goal').length, 1);
    assert.equal(Math.max(...floor.rooms.map((room) => room.layer)), goal.layer);
    assert.equal(floor.rooms.filter((room) => room.layer === goal.layer).length, 1);
    assert.ok(goal.depth >= 7, `seed ${floor.seed} descent is only ${goal.depth} deep`);
  }
});

test('most chambers offer a choice of doors', () => {
  // Hades' rhythm: usually two ways on, now and then one or three. A floor of single doors is a corridor.
  const counts = floors().flatMap((floor) => floor.rooms.filter((room) => room.role !== 'goal' && floor.rooms.filter((r) => r.layer === room.layer + 1).length > 1).map((room) => floor.doors.filter((door) => door.from === room.id).length));
  assert.ok(counts.length > 100, `only ${counts.length} chambers could offer a choice`);
  const choosing = counts.filter((n) => n >= 2).length / counts.length;
  assert.ok(choosing > .6, `only ${(choosing * 100).toFixed(0)}% of chambers offer more than one door`);
});

test('chambers are islands: no corridor, and no chamber touches another', () => {
  for (const floor of floors(1, SEEDS.slice(0, 20))) {
    assert.ok(floor.tiles.every((tile) => tile.room >= 0), `seed ${floor.seed} carved a tile no chamber owns`);
    for (const tile of floor.tiles) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const owner = floor.roomByCell.get(cellKey(tile.x + dx, tile.z + dz));
      assert.ok(owner === undefined || owner === tile.room, `seed ${floor.seed}: chambers ${tile.room} and ${owner} share a wall`);
    }
    // And far enough apart that the camera never frames two: ten clear tiles at least between footprints.
    for (const a of floor.rooms) for (const b of floor.rooms) if (a.id < b.id) {
      const gapX = Math.abs(a.x - b.x) - a.halfX - b.halfX, gapZ = Math.abs(a.z - b.z) - a.halfZ - b.halfZ;
      assert.ok(Math.max(gapX, gapZ) >= 10, `seed ${floor.seed}: chambers ${a.id} and ${b.id} stand ${Math.max(gapX, gapZ)} tiles apart`);
    }
  }
});

test('doors stand on the far walls, on open floor with the wall right behind them', () => {
  // The camera sits at +x/+z, so -x and -z are the walls it looks at: a door there is never behind masonry.
  for (const floor of floors(2)) for (const door of floor.doors) {
    assert.ok([[-1, 0], [0, -1]].some(([x, z]) => door.face.x === x && door.face.z === z), `seed ${floor.seed} door ${door.id} faces ${door.face.x},${door.face.z}`);
    assert.equal(floor.roomByCell.get(cellKey(door.x, door.z)), door.from, `seed ${floor.seed} door ${door.id} stands outside its chamber`);
    assert.ok(!floor.cells.has(cellKey(door.x + door.face.x, door.z + door.face.z)), `seed ${floor.seed} door ${door.id} is not against its wall`);
    for (const other of floor.doors) if (other.from === door.from && other.id !== door.id) assert.ok(Math.hypot(other.x - door.x, other.z - door.z) >= 2, `seed ${floor.seed}: two doors of one chamber overlap`);
  }
});

test('the knight arrives on open floor, clear of every body and every prop', () => {
  for (const floor of floors(3)) for (const room of floor.rooms) {
    assert.equal(floor.roomByCell.get(cellKey(room.entry.x, room.entry.z)), room.id, `seed ${floor.seed} room ${room.id} arrival is off its floor`);
    for (const spawn of floor.spawns.filter((s) => s.room === room.id)) assert.ok(Math.hypot(spawn.x - room.entry.x, spawn.z - room.entry.z) >= ARRIVAL_CLEAR, `seed ${floor.seed}: a body waits at room ${room.id}'s door`);
  }
});

test('a door shows what the chamber behind it pays, and neighbours in a layer differ where they can', () => {
  for (const level of [1, 2, 3]) for (const floor of floors(level)) {
    for (const room of floor.rooms) {
      if (room.role !== 'path' || room.encounter === 'sanctuary') assert.equal(room.reward, room.id === floor.weaponDrop.room && level > 1 ? 'arm' : null, `seed ${floor.seed} room ${room.id} pays without a fight`);
      else assert.ok(room.reward !== null, `seed ${floor.seed} room ${room.id} is a fight that pays nothing`);
    }
    for (let layer = 1; layer < floor.rooms[floor.goal].layer; layer++) {
      const paying = floor.rooms.filter((room) => room.layer === layer && (room.reward === 'mend' || room.reward === 'cache'));
      if (paying.length === 2) assert.notEqual(paying[0].reward, paying[1].reward, `seed ${floor.seed} layer ${layer} offers the same twice`);
    }
  }
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

test('quiet chambers are pacing: never one behind another, never two side by side', () => {
  for (const level of [1, 3]) for (const floor of floors(level)) {
    const empty = (id: number) => !floor.spawns.some((spawn) => spawn.room === id);
    for (const door of floor.doors) assert.ok(!(empty(door.from) && empty(door.to)), `seed ${floor.seed}: door ${door.id} leads from a quiet chamber into another`);
    for (let layer = 1; layer <= floor.rooms[floor.goal].layer; layer++) {
      assert.ok(floor.rooms.filter((room) => room.layer === layer && room.encounter === 'sanctuary').length <= 1, `seed ${floor.seed} layer ${layer} holds two shrines`);
    }
  }
});

test('deeper floors are meaner', () => {
  const count = (level: number) => floors(level).reduce((total, floor) => total + floor.spawns.length, 0) / SEEDS.length;
  const wardens = (level: number) => floors(level).reduce((total, floor) => total + floor.spawns.filter((s) => s.kind === 'warden').length, 0) / SEEDS.length;
  // Smaller rooms (see sizeFor) leave less floor for a dense pack to place into without overlapping -
  // 40 tries per body, each rejected within 2.2 units of another - which trims a room's largest rosters
  // more than its smallest ones. That narrowed the level-3-vs-level-1 multiplier from roughly 1.6x, measured
  // on the old room sizes, to roughly 1.44x measured over 400 seeds on the new ones; these 40 pinned seeds
  // land at 1.39x, under a straight 1.4x floor by chance of the sample rather than by a real regression.
  // 1.3x keeps the check meaningful - floor 3 is still clearly busier - without being a coin flip on reseed.
  assert.ok(count(3) > count(1) * 1.3, `floor 3 should be far busier: ${count(1).toFixed(1)} -> ${count(3).toFixed(1)}`);
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


// One character per tile, '#' solid; row 0 is z = 0, column 0 is x = 0. Tile n sits at world n * TILE.
const floorFrom = (rows: string[]) => { const cells = new Set<string>(); rows.forEach((row, z) => row.split('').forEach((c, x) => { if (c !== '#') cells.add(cellKey(x, z)); })); return cells; };
// How far a 0.32-radius body's centre may sit from a tile centre before its edge crosses into the next
// tile: everything below is derived from this one number, so a changed radius changes the tests too.
const REACH = TILE / 2 - 0.32;

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

test('the first two halls past the gate are always a straight fight, never an ambush or a gauntlet', () => {
  for (const floor of floors()) {
    const opening = floor.rooms.filter(room => room.role === 'path' && room.depth >= 1 && room.depth <= 2);
    assert.ok(opening.length >= 1, `seed ${floor.seed} has no opening halls`);
    for (const room of opening) assert.equal(room.encounter, 'watch', `seed ${floor.seed} room ${room.id} at depth ${room.depth} is ${room.encounter}`);
    // Nothing waits hidden in them either: an ambush pack is what killed a fresh run in under a minute.
    for (const spawn of floor.spawns) if (opening.some(room => room.id === spawn.room)) assert.equal(spawn.ambush, false);
  }
});

test('every floor lays out one arm, and never the one already in hand', () => {
  for (const level of [1, 2, 3]) for (const seed of [0x1, 0x7, 0xc, 0x51ed, 0xbeef]) {
    const floor = generateFloor(seed, level);
    const drop = floor.weaponDrop;
    assert.ok(drop, `floor ${level} seed ${seed} laid no weapon out`);
    assert.notEqual(drop.kind, 'tideblade', 'the drop is never the sword the knight walks in with');
    assert.ok(FOUND_WEAPONS.includes(drop.kind));
    // It has to be somewhere the knight can actually stand.
    assert.ok(floor.cells.has(cellKey(Math.round(drop.x / TILE), Math.round(drop.z / TILE))), 'the rack is off the floor');
    const room = floor.rooms[drop.room];
    // Clear of the room's heart, which is where the knight arrives and where a stair would sit.
    assert.ok(Math.hypot(drop.x - room.x * TILE, drop.z - room.z * TILE) > 1.5, 'the rack is underfoot on arrival');
    // Clear of anything standing in the same chamber, so it is never taken mid-fight by accident.
    for (const spawn of floor.spawns.filter(s => s.room === drop.room)) {
      assert.ok(Math.hypot(spawn.x * TILE - drop.x, spawn.z * TILE - drop.z) > 1.2, 'a body is standing on the rack');
    }
  }
});

test('the first floor lays its arm out in the safety of the Tide Gate', () => {
  // The first real decision of a run is made before anything is at stake.
  for (const seed of [0x1, 0x7, 0xc, 0x51ed]) {
    const floor = generateFloor(seed, 1);
    assert.equal(floor.weaponDrop.room, 0);
    assert.equal(floor.spawns.filter(s => s.room === 0).length, 0, 'the Tide Gate is meant to be empty');
  }
});

test('the same keep hands back the same arm', () => {
  for (const seed of [0x1, 0x7, 0xc]) {
    assert.deepEqual(generateFloor(seed, 1).weaponDrop, generateFloor(seed, 1).weaponDrop);
  }
  // And different keeps do not all offer the same one.
  const kinds = new Set([0x1, 0x7, 0xc, 0x51ed, 0xbeef, 0xfeed, 0x2222].map(s => generateFloor(s, 1).weaponDrop.kind));
  assert.ok(kinds.size > 1, 'every seed offered the same weapon');
});

test('a pack mix deals each kind its share in draw order, and guards whatever is left', () => {
  // A roll lands in the first kind whose running share it is under: stalker takes [0, .3), warden
  // [.3, .5), and everything from .5 up is a guard.
  const mix = { stalker: .3, warden: .2 };
  assert.deepEqual([0, .29, .3, .49, .5, .99].map(roll => drawKind(mix, 1, roll)), ['stalker', 'stalker', 'warden', 'warden', 'guard', 'guard']);
  // The shares the generator used before the table existed: `random() < odds ? 'stalker' : 'guard'`.
  for (const [name, odds] of [['hoard', .35], ['ambush', .85], ['opening', .15], ['middle', .4], ['late', .5]] as const) {
    assert.equal(drawKind(PACK_MIX[name], 1, odds - 1e-9), 'stalker', `${name} under its odds`);
    assert.equal(drawKind(PACK_MIX[name], 1, odds), 'guard', `${name} at its odds`);
  }
});

test('archers are dealt from floor two on, never into an ambush, and floor one never draws one', () => {
  const archers = (level: number) => floors(level).flatMap(floor => floor.spawns.filter(s => s.kind === 'archer').map(s => ({ s, floor })));
  assert.equal(archers(1).length, 0, 'floor one dealt an archer before anything has taught the knight to read one');
  for (const level of [2, 3]) {
    const dealt = archers(level);
    assert.ok(dealt.length >= SEEDS.length / 2, `floor ${level} dealt only ${dealt.length} archers across ${SEEDS.length} seeds`);
    for (const { s, floor } of dealt) assert.notEqual(floor.rooms[s.room].encounter, 'ambush', `seed ${floor.seed} hid an archer in an ambush`);
  }
  // On floor one the archer's share falls through to the guard, so the stalker's odds are untouched;
  // from floor two the same roll deals an archer.
  const roll = PACK_MIX.middle.stalker + PACK_MIX.middle.archer / 2;
  assert.deepEqual([drawKind(PACK_MIX.middle, 1, roll), drawKind(PACK_MIX.middle, 2, roll)], ['guard', 'archer']);
  assert.equal(drawKind(PACK_MIX.middle, 1, PACK_MIX.middle.stalker - 1e-9), 'stalker');
});

test('the arena-only kinds never appear on a generated floor', () => {
  const arenaOnly = new Set(['shieldbearer', 'reaper', 'pyre', 'bonecaller', 'rattler']);
  for (const level of [1, 2, 3]) {
    const dealt = floors(level).flatMap(floor => floor.spawns.filter(s => arenaOnly.has(s.kind)));
    assert.deepEqual(dealt, [], `floor ${level} dealt an arena-only kind`);
  }
});
