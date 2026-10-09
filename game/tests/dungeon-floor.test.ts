import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { altarHall, HALL_SHRINES, hallShrines, ARRIVAL_CLEAR, buryReserves, canStand, carves, dealBosses, drawKind, parseBoss, GATE_ARMS, GATE_SPACING, gateRacks, generateFloor, HALL_SEED, HEART_CLEAR, cellKey, moveOnFloor, oneCaller, PACK_MIX, TILE, type Spawn } from '../app/dungeon-floor.ts';
import { arenaFloor } from '../app/dungeon-arena.ts';
import { BESTIARY, BOSS_POOL, type EnemyKind } from '../app/dungeon-bestiary.ts';
import { HOSTILE_POOL_RINGS } from '../app/dungeon-projectile.ts';
import { PICKUP_RADIUS } from '../app/dungeon-sim.ts';
import { FOUND_WEAPONS, STARTING_WEAPON } from '../app/dungeon-weapon.ts';
import { UPGRADES } from '../app/dungeon-meta.ts';
import { sweepSeeds, takeCensus } from '../scripts/balance/census.ts';

type Floor = ReturnType<typeof generateFloor>;

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const floors = (level = 1, seeds = SEEDS) => seeds.map((seed) => generateFloor(seed, level));

// Plan 017: doors only ever lead onward, so the graph is directed - from a chamber to the ones its doors open on.
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
    // It stands in an alcove cut into that wall, so the masonry frames an opening on both sides of it.
    const across = door.face.x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
    for (const side of [-1, 1]) assert.ok(!floor.cells.has(cellKey(door.x + across.x * side, door.z + across.z * side)), `seed ${floor.seed} door ${door.id} is not set into its wall`);
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
      // Plan 019 (D7): the former arm chamber pays a mend or a purse like its neighbours, so only the quiet rooms pay nothing.
      if (room.role !== 'path' || room.encounter === 'sanctuary') assert.equal(room.reward, null, `seed ${floor.seed} room ${room.id} pays without a fight`);
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

// Plan 021 (D5): the stair hall holds its boss and nobody else - no wardens - on every floor, whatever the level.
test('the gate is safe and the stair is guarded by its boss alone', () => {
  for (const level of [1, 2, 3]) for (const floor of floors(level)) {
    assert.equal(floor.spawns.filter((spawn) => spawn.room === 0).length, 0, `seed ${floor.seed} spawns in the gate`);
    const stair = floor.spawns.filter((spawn) => spawn.room === floor.goal && !spawn.buried);
    assert.equal(stair.length, 1, `seed ${floor.seed} level ${level} stair pack: ${stair.map(s => s.kind).join(',')}`);
    assert.ok(BESTIARY[stair[0].kind].boss && !stair[0].ambush && !stair[0].buried, `seed ${floor.seed} the stair holds a ${stair[0].kind}, which is not a standing boss`);
    assert.equal(floor.spawns.filter(spawn => spawn.kind === 'warden' && spawn.room === floor.goal).length, 0, `seed ${floor.seed} a warden still stands on the stair`);
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
  // CPU time, not wall-clock: node runs the test files side by side, and the balance tests starve this one of a
  // core. Measured on 4 cores, 2026-10-07: about 10 ms CPU and 6 ms wall alone; with 8 copies at once, wall rose
  // to about 28 ms (over the old wall-clock 25) while CPU stayed at about 14. A floor that really is 2.5x dearer
  // still fails.
  const started = process.cpuUsage(), runs = 40;
  for (let i = 0; i < runs; i++) generateFloor(i * 7919, 3);
  const used = process.cpuUsage(started), each = (used.user + used.system) / 1000 / runs;
  assert.ok(each < 25, `generateFloor took ${each.toFixed(1)} ms of CPU per floor`);
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

// Plan 019 (D7): `weaponDrop` is a reserved spot now, not an arm anyone is offered. The campaign never places a rack on it
// (the Tide Gate's armoury is `gateRacks`; the dev arena keeps this spot for its own rack), but the generator still draws the
// pick, the kind and the spot, so these hold exactly as they did and the floors, spawns and props stay where they were.
test('every floor still reserves a spot for one arm, never the one already in hand', () => {
  for (const level of [1, 2, 3]) for (const seed of [0x1, 0x7, 0xc, 0x51ed, 0xbeef]) {
    const floor = generateFloor(seed, level);
    const drop = floor.weaponDrop;
    assert.ok(drop, `floor ${level} seed ${seed} reserved no spot`);
    assert.notEqual(drop.kind, 'tideblade', 'the drop is never the sword the knight walks in with');
    assert.ok(FOUND_WEAPONS.includes(drop.kind));
    // It has to be somewhere the knight can actually stand.
    assert.ok(floor.cells.has(cellKey(Math.round(drop.x / TILE), Math.round(drop.z / TILE))), 'the reserved spot is off the floor');
    const room = floor.rooms[drop.room];
    // Clear of the room's heart, which is where the knight arrives and where a stair would sit.
    assert.ok(Math.hypot(drop.x - room.x * TILE, drop.z - room.z * TILE) > 1.5, 'the reserved spot is underfoot on arrival');
    // Clear of anything standing in the same chamber, so the dev arena's rack is never taken mid-fight by accident.
    for (const spawn of floor.spawns.filter(s => s.room === drop.room)) {
      assert.ok(Math.hypot(spawn.x * TILE - drop.x, spawn.z * TILE - drop.z) > 1.2, 'a body is standing on the reserved spot');
    }
  }
});

test('the first floor reserves its spot in the safety of the Tide Gate, which holds nobody', () => {
  for (const seed of [0x1, 0x7, 0xc, 0x51ed]) {
    const floor = generateFloor(seed, 1);
    assert.equal(floor.weaponDrop.room, 0);
    assert.equal(floor.spawns.filter(s => s.room === 0).length, 0, 'the Tide Gate is meant to be empty');
  }
});

test('the same keep reserves the same spot', () => {
  for (const seed of [0x1, 0x7, 0xc]) {
    assert.deepEqual(generateFloor(seed, 1).weaponDrop, generateFloor(seed, 1).weaponDrop);
  }
  // And different keeps do not all reserve the same kind.
  const kinds = new Set([0x1, 0x7, 0xc, 0x51ed, 0xbeef, 0xfeed, 0x2222].map(s => generateFloor(s, 1).weaponDrop.kind));
  assert.ok(kinds.size > 1, 'every seed reserved the same weapon');
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

test('the reaper never appears on a generated floor, and a rattler only as a buried reserve', () => {
  for (const level of [1, 2, 3]) {
    const spawns = floors(level).flatMap(floor => floor.spawns);
    assert.deepEqual(spawns.filter(s => s.kind === 'reaper'), [], `floor ${level} dealt a reaper`);
    assert.deepEqual(spawns.filter(s => s.kind === 'rattler' && !s.buried), [], `floor ${level} dealt a rattler standing`);
  }
});

// --- Plan 018: the shieldbearer, the pyre and the bonecaller join the descent -------------------------------------

type Recorded = { level: number; seed: number; spawns: { kind: EnemyKind; x: number; z: number; room: number; ambush: boolean }[]; layout: string };
const recorded = JSON.parse(readFileSync(new URL('./fixtures/spawns-017.json', import.meta.url), 'utf8')).floors as Recorded[];
// Plan 019 (D7): the campaign no longer places `weaponDrop`, but the generator still draws it, so it stays in the hash. Keeping it
// compared is the stronger check: a draw removed anywhere between the props and the drop moves it, whatever the game does with it.
const layoutHash = (floor: Floor) => createHash('sha256').update(JSON.stringify({ props: floor.props, weaponDrop: floor.weaponDrop })).digest('hex').slice(0, 16);
/** The fixture was laid from `362db84`, before plan 018. Rolls are unchanged, so any difference is the promoted kinds and nothing else. */
test('dealing the new kinds moves no room, prop, weapon or body: floor one is identical and deeper floors change only guards', () => {
  assert.equal(recorded.length, 90, 'the recorded sweep is 30 floors on each of three levels');
  let changed = 0, boss = 0;
  for (const rec of recorded) {
    const floor = generateFloor(rec.seed, rec.level), standing = floor.spawns.filter(s => !s.buried);
    assert.equal(layoutHash(floor), rec.layout, `level ${rec.level} seed ${rec.seed}: a prop or the weapon drop moved, so a random draw was added or removed`);
    // Plan 021 (D5): the recorded stair hall held two or three wardens and now holds the boss alone, on the first warden's spot. Every other body is exactly where it was.
    const was = rec.spawns.filter(s => s.room !== floor.goal), now = standing.filter(s => s.room !== floor.goal), stair = rec.spawns.filter(s => s.room === floor.goal);
    assert.ok(stair.length >= 2, `level ${rec.level} seed ${rec.seed}: the recording lost its stair wardens`);
    assert.equal(now.length, was.length, `level ${rec.level} seed ${rec.seed}: the number of bodies outside the stair hall changed`);
    now.forEach((s, i) => {
      assert.deepEqual([s.x, s.z, s.room, s.ambush], [was[i].x, was[i].z, was[i].room, was[i].ambush], `level ${rec.level} seed ${rec.seed} body ${i} moved`);
      if (rec.level === 1) assert.equal(s.kind, was[i].kind, `floor one seed ${rec.seed} body ${i} changed kind`);
      else if (s.kind !== was[i].kind) { assert.equal(was[i].kind, 'guard', `level ${rec.level} seed ${rec.seed} body ${i}: a ${was[i].kind} became a ${s.kind}; only guards may be replaced`); changed++; }
    });
    const hall = standing.filter(s => s.room === floor.goal);
    assert.equal(hall.length, 1, `level ${rec.level} seed ${rec.seed}: the stair hall holds ${hall.length} bodies, not its boss alone`);
    assert.deepEqual([hall[0].x, hall[0].z], [stair[0].x, stair[0].z], `level ${rec.level} seed ${rec.seed}: the boss is not on the first warden's spot`);
    boss++;
  }
  assert.equal(boss, 90, 'every recorded floor was checked for its boss');
  assert.ok(changed > 50, `only ${changed} guards changed kind across the recorded floors, so the promoted kinds were barely dealt`);
});

// --- Plan 021 Stage B: the boss option and the deal ---------------------------------------------------------------

test('the stair hall holds exactly the boss it is given, and the Captain on floors one and two and the King on floor three when it is given none', () => {
  const stairOf = (floor: Floor) => floor.spawns.filter(s => s.room === floor.goal && !s.buried).map(s => s.kind);
  for (const level of [1, 2, 3]) for (const seed of sweepSeeds(level).slice(0, 12)) {
    assert.deepEqual(stairOf(generateFloor(seed, level)), [level >= 3 ? 'king' : 'captain'], `seed ${seed} level ${level}: the default is not the floor's boss alone`);
    assert.deepEqual(stairOf(generateFloor(seed, level, { boss: 'bonecaller' })), ['bonecaller'], `seed ${seed} level ${level}: the boss option was not honoured (a stand-in kind proves the option reaches the room)`);
  }
});

test('dealBosses is a pure hash of the run seed, the same on every call, and the boss a floor is given moves nothing else it lays', () => {
  const wide = ['captain', 'guard', 'stalker', 'archer'] as const, seed = 0x51ed;
  const deals = (runSeed: number) => JSON.stringify([dealBosses(runSeed, wide), dealBosses(runSeed)]);
  const first = Array.from({ length: 30 }, (_, n) => deals(seed + n * 977));
  // Generate floors in between, and call the deal in another order: a deal that kept state, or shared the generator's stream, would not repeat.
  for (let n = 0; n < 5; n++) generateFloor(seed + n, 1 + n % 3);
  const again = Array.from({ length: 30 }, (_, n) => deals(seed + (29 - n) * 977)).reverse();
  assert.deepEqual(again, first, 'the deal changed with what was called before it');
  assert.ok(new Set(first.map(deal => JSON.parse(deal)[0].join())).size >= 3, 'precondition: the wide pool is dealt varied pairs, so equal deals mean something');
  assert.equal(dealBosses(seed)[0] === dealBosses(seed)[1], false, 'the live pool dealt one boss to both floors');
  // The boss a floor is given reaches only the stair hall: every prop, door, drop and other body is the same whichever boss it is.
  for (const level of [1, 3]) for (const runSeed of sweepSeeds(level).slice(0, 10)) {
    const a = generateFloor(runSeed, level, { boss: 'captain' }), b = generateFloor(runSeed, level, { boss: 'archer' });
    const lay = (f: Floor) => JSON.stringify({ ...f, cells: [...f.cells], roomByCell: [...f.roomByCell], spawns: f.spawns.filter(sp => sp.room !== f.goal) });
    assert.equal(lay(a), lay(b), `seed ${runSeed} level ${level}: the boss option changed something outside the stair hall, so it drew from the generator's stream`);
    assert.deepEqual([a.spawns.find(sp => sp.room === a.goal)?.kind, b.spawns.find(sp => sp.room === b.goal)?.kind], ['captain', 'archer'], `seed ${runSeed}: the stair hall did not take the boss (precondition)`);
  }
});

test('a run never meets the same pool boss on floors one and two, and a wider pool is dealt from every kind', () => {
  const pool = ['captain', 'guard', 'stalker', 'archer'] as const, firsts = new Set<string>(), seconds = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    const [a, b] = dealBosses(seed * 7919, pool);
    assert.notEqual(a, b, `seed ${seed * 7919} dealt ${a} to both floors`);
    firsts.add(a); seconds.add(b);
  }
  assert.equal(firsts.size, pool.length, 'precondition: floor one dealt every kind in the pool');
  assert.equal(seconds.size, pool.length, 'precondition: floor two dealt every kind in the pool');
});

// Plan 021 Stage C: the live pool, not a stand-in. Floor one's boss and floor two's are never the same, every pool boss turns up on each floor, and (Stage D, four of them) each is dealt about
// as often as the others: a share between 60% and 140% of an even one, which is 15% to 35% of the floors for a pool of four.
test('over a thousand run seeds the deal never repeats a boss on floors one and two, and deals every pool boss on each floor about as often as the others', () => {
  const floors: Record<EnemyKind, number>[] = [0, 1].map(() => Object.fromEntries(BOSS_POOL.map(kind => [kind, 0])) as Record<EnemyKind, number>);
  for (let n = 1; n <= 1000; n++) {
    const [a, b] = dealBosses(n * 7919 + 13);
    assert.notEqual(a, b, `run seed ${n * 7919 + 13} dealt ${a} to both floors`);
    assert.ok(BOSS_POOL.includes(a) && BOSS_POOL.includes(b), `run seed ${n} dealt a boss outside the pool: ${a}, ${b}`);
    floors[0][a]++; floors[1][b]++;
  }
  const even = 1000 / BOSS_POOL.length;
  floors.forEach((counts, floor) => {
    for (const kind of BOSS_POOL) {
      assert.ok(counts[kind] > 0, `precondition: floor ${floor + 1} was never dealt ${kind}, so a share of it means nothing`);
      assert.ok(counts[kind] >= even * 0.6 && counts[kind] <= even * 1.4, `${kind} was dealt to ${(counts[kind] / 10).toFixed(1)}% of floor ${floor + 1}s, not within 60% to 140% of an even ${(100 / BOSS_POOL.length).toFixed(1)}%`);
    }
  });
});

test('the dev boss link names a pool boss and nothing else', () => {
  for (const kind of BOSS_POOL) assert.equal(parseBoss(kind), kind, `${kind} is in the pool and the link refuses it`);
  for (const text of [null, '', 'warden', 'guard', 'Captain', 'captain,captain', 'ghost']) assert.equal(parseBoss(text), null, `${text} was taken for a boss`);
});

test('each promoted kind is dealt from its first floor on, and never before it', () => {
  const dealt = (level: number, kind: EnemyKind) => sweepSeeds(level).flatMap(seed => generateFloor(seed, level).spawns).filter(s => s.kind === kind).length;
  for (const [kind, first] of [['shieldbearer', 2], ['pyre', 2], ['bonecaller', 3]] as const) {
    assert.equal(BESTIARY[kind].firstFloor, first, `${kind} first floor`);
    for (let level = 1; level < first; level++) assert.equal(dealt(level, kind), 0, `${kind} was dealt on floor ${level}, before its first floor`);
    assert.ok(dealt(first, kind) > 0, `${kind} was never dealt on floor ${first} across the sweep: pick another sweep`);
  }
  assert.equal(BESTIARY.reaper.firstFloor, Infinity);
  assert.equal(BESTIARY.rattler.firstFloor, Infinity);
});

test('a second bonecaller in one pack is dealt as a guard, and no chamber holds two', () => {
  assert.deepEqual(oneCaller(['bonecaller', 'pyre', 'bonecaller', 'bonecaller']), ['bonecaller', 'pyre', 'guard', 'guard']);
  assert.deepEqual(oneCaller(['pyre', 'guard']), ['pyre', 'guard'], 'a pack with no caller changed');
  // 300 keeps: an eight percent share in a pack of two or three rolls a pair in a few chambers of a hundred.
  let callers = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const floor = generateFloor(seed * 104729, 3), byRoom = new Map<number, number>();
    for (const s of floor.spawns) if (s.kind === 'bonecaller') { byRoom.set(s.room, (byRoom.get(s.room) ?? 0) + 1); callers++; }
    for (const [room, n] of byRoom) assert.equal(n, 1, `seed ${floor.seed}: chamber ${room} holds ${n} bonecallers`);
  }
  assert.ok(callers > 100, `only ${callers} callers across 300 keeps, so this measured nothing`);
});

test('every dealt bonecaller carries its own reserve, buried under it and listed after everything standing', () => {
  let seen = 0;
  for (const seed of sweepSeeds(3)) {
    const floor = generateFloor(seed, 3), standing = floor.spawns.filter(s => !s.buried).length;
    // Buried bodies come last, in one block, so every standing index is the one the draws gave it.
    floor.spawns.forEach((s, i) => assert.equal(!!s.buried, i >= standing, `seed ${seed}: spawn ${i} is ${s.buried ? 'buried' : 'standing'} in the wrong block`));
    floor.spawns.forEach((caller, index) => {
      if (caller.kind !== 'bonecaller') return;
      seen++;
      const reserve = floor.spawns.filter(s => s.summoner === index);
      assert.equal(reserve.length, BESTIARY.bonecaller.summons!.count, `seed ${seed}: caller ${index} has ${reserve.length} in reserve`);
      for (const s of reserve) {
        assert.ok(s.buried && s.kind === BESTIARY.bonecaller.summons!.kind && s.room === caller.room, `seed ${seed}: a reserve body is not a buried rattler in its caller's chamber`);
        assert.deepEqual([s.x, s.z], [caller.x, caller.z], `seed ${seed}: a reserve body is not on its caller's tile`);
        assert.ok(floor.spawns.indexOf(s) >= standing, `seed ${seed}: a reserve body is listed among the standing`);
      }
    });
  }
  assert.ok(seen >= 20, `only ${seen} callers on floor three across the sweep`);
});

test('guardCount is the number of standing spawns, buried bodies left out', () => {
  const floor = generateFloor(sweepSeeds(3).find(seed => generateFloor(seed, 3).spawns.some(s => s.buried))!, 3);
  assert.ok(floor.spawns.some(s => s.buried), 'precondition: this keep buries a reserve');
  assert.equal(floor.guardCount, floor.spawns.filter(s => !s.buried).length);
  assert.ok(floor.guardCount < floor.spawns.length);
});

test('the arena buries a reserve exactly as it did before the generator shared the rule', () => {
  // Recorded from dungeon-arena.ts at 362db84: seed 7, floor 1, guard + bonecaller + archer.
  const arena = arenaFloor(7, 1, ['guard', 'bonecaller', 'archer']);
  assert.deepEqual(arena.spawns.map(s => [s.kind, s.x, s.z, s.room, s.buried ?? null, s.summoner ?? null]), [
    ['guard', 4, 0, 0, null, null], ['bonecaller', -2, 3, 0, null, null], ['archer', -2, -3, 0, null, null],
    ['rattler', -2, 3, 0, true, 1], ['rattler', -2, 3, 0, true, 1], ['rattler', -2, 3, 0, true, 1], ['rattler', -2, 3, 0, true, 1],
  ]);
  assert.equal(arena.guardCount, 3);
  // The helper itself: no draw, standing order kept, the reserve after all of it.
  const pack: Spawn[] = [{ x: 1, z: 2, kind: 'bonecaller', room: 4, ambush: false }, { x: 3, z: 4, kind: 'guard', room: 4, ambush: false }];
  assert.deepEqual(buryReserves(pack).slice(0, 2), pack);
  assert.equal(buryReserves(pack).length, 2 + BESTIARY.bonecaller.summons!.count);
});

test('stalker and archer keep their odds in the middle and late packs, and the new kinds take only from the guard', () => {
  // Draw order is the odds: the stalker under its share, the archer in the next slice, on the floor that deals both.
  for (const [name, stalker, archer] of [['middle', .4, .2], ['late', .5, .2]] as const) {
    const mix = PACK_MIX[name];
    assert.equal(drawKind(mix, 3, stalker - 1e-9), 'stalker', `${name}: stalker under its odds`);
    assert.equal(drawKind(mix, 3, stalker + archer / 2), 'archer', `${name}: archer inside its slice`);
    assert.equal(drawKind(mix, 3, stalker + archer - 1e-9), 'archer', `${name}: archer at the end of its slice`);
    assert.notEqual(drawKind(mix, 3, stalker + archer), 'archer', `${name}: archer past its slice`);
    assert.equal(drawKind(mix, 1, 0.99), 'guard', `${name}: the new kinds are not dealt on floor one`);
  }
});

test('the census over the sweep stays inside the targets the shares were set against', () => {
  // Plan 018 D5, over the chambers whose pack is drawn from the middle or late mix. Measured 2026-09-29 on this sweep
  // with middle .07/.07 and late .07/.07/.08 (shieldbearer / pyre / bonecaller): floor 2 34.6%, floor 3 48.1%,
  // bonecaller chambers on floor 3 21.4%.
  const two = takeCensus(2), three = takeCensus(3);
  assert.ok(two.eligible > 100 && three.eligible > 100, `too few eligible chambers to judge: ${two.eligible}, ${three.eligible}`);
  const share = (part: number, whole: number) => part / whole * 100;
  const f2 = share(two.eligibleHoldingAny, two.eligible), f3 = share(three.eligibleHoldingAny, three.eligible), caller = share(three.eligibleHolding.bonecaller, three.eligible);
  assert.ok(f2 >= 25 && f2 <= 40, `floor 2: ${f2.toFixed(1)}% of eligible chambers hold a new kind, target 25-40`);
  assert.ok(f3 >= 40 && f3 <= 60, `floor 3: ${f3.toFixed(1)}% of eligible chambers hold a new kind, target 40-60`);
  assert.ok(caller >= 15 && caller <= 30, `floor 3: ${caller.toFixed(1)}% of eligible chambers hold a bonecaller, target 15-30`);
});

test('no chamber stands more pyres than the game has fire rings to draw', () => {
  const most = Math.max(...[2, 3].map(level => takeCensus(level).maxPyres));
  assert.ok(most >= 1, 'precondition: the sweep deals a pyre');
  assert.ok(most <= HOSTILE_POOL_RINGS, `${most} pyres in one chamber, ${HOSTILE_POOL_RINGS} rings: a fire beyond the last is neither drawn nor biting`);
});

// --- Plan 019 Stage C: no arm in the keep, an armoury in the Tide Gate ------------------------------------------------

type Rewards = { level: number; seed: number; rewards: (string | null)[]; armRoom: number };
const dealtBefore = JSON.parse(readFileSync(new URL('./fixtures/rewards-019.json', import.meta.url), 'utf8')).floors as Rewards[];

test('no chamber pays an arm: the former arm chamber keeps its mend or purse and every other reward is where it was', () => {
  assert.equal(dealtBefore.length, 90);
  // Precondition: the fixture holds the arm chambers this is about, one on each recorded floor below the first.
  const formerArm = dealtBefore.filter(rec => rec.rewards.includes('arm'));
  assert.equal(formerArm.length, 60, 'the recording lost its arm chambers');
  for (const rec of dealtBefore) {
    const floor = generateFloor(rec.seed, rec.level);
    assert.equal(floor.weaponDrop.room, rec.armRoom, `level ${rec.level} seed ${rec.seed}: the arm chamber's pick moved, so its draw was removed`);
    floor.rooms.forEach((room, id) => {
      if (rec.rewards[id] === 'arm') assert.ok(room.reward === 'mend' || room.reward === 'cache', `level ${rec.level} seed ${rec.seed}: the former arm chamber pays ${room.reward}`);
      else assert.equal(room.reward, rec.rewards[id], `level ${rec.level} seed ${rec.seed}: room ${id} pays something else than it was dealt`);
    });
  }
});

test('no room on any sweep floor has the reward arm', () => {
  let paying = 0;
  for (const level of [1, 2, 3]) for (const floor of floors(level)) for (const room of floor.rooms) {
    assert.ok(room.reward === null || room.reward === 'mend' || room.reward === 'cache', `level ${level} seed ${floor.seed} room ${room.id} pays ${room.reward}`);
    if (room.reward) paying++;
  }
  assert.ok(paying > 500, `only ${paying} paying rooms across the sweep, so this checked little`);
});

// A sweep wide enough to hold the smallest gate (a 9 x 7 crypt) many times over, plus the seeds the browser suite and the balance sim pin.
const GATE_SEEDS = [...Array.from({ length: 400 }, (_, i) => i + 1), ...sweepSeeds(1), 0x4, 0x60, 0x11, 0x8000, 0x26aad, 0x2899c, 0x36225, 158381, 166300, 221733, 15841, 4242];
const gates = GATE_SEEDS.map(seed => generateFloor(seed, 1));
/** Whether a tile is the gate's own floor: inside its rectangle and not cut away by its shape, which a door's alcove (cut after) is not. */
const ownFloor = (gate: Floor['rooms'][number], x: number, z: number) => Math.abs(x - gate.x) <= gate.halfX && Math.abs(z - gate.z) <= gate.halfZ && carves(gate, x - gate.x, z - gate.z);
/** The tile the door's alcove opens from: the first of the gate's own floor going back from the door. */
const doorMouth = (gate: Floor['rooms'][number], door: Floor['doors'][number]) => {
  let at = { x: door.x, z: door.z };
  for (let back = 0; back < 4 && !ownFloor(gate, at.x, at.z); back++) at = { x: at.x - door.face.x, z: at.z - door.face.z };
  assert.ok(ownFloor(gate, at.x, at.z), `door ${door.id} has no mouth within three tiles`);
  return at;
};

test('gateRacks seats seven, one per arm, on the gate\'s own floor and clear of the heart, the entry, every doorway and every prop', () => {
  assert.equal(GATE_ARMS.length, 7);
  assert.deepEqual([...GATE_ARMS], [STARTING_WEAPON, ...FOUND_WEAPONS], 'one slot per arm, the Tideblade first');
  assert.ok(gates.filter(floor => floor.rooms[0].halfX === 4 && floor.rooms[0].halfZ === 3).length >= 20, 'the sweep holds too few of the smallest gate');
  for (const floor of gates) {
    const gate = floor.rooms[0], slots = gateRacks(floor), at = `seed ${floor.seed}`;
    assert.deepEqual(slots.map(slot => slot.arm), [...GATE_ARMS], `${at}: the slots are not one per arm`);
    for (const slot of slots) {
      const tile = { x: Math.round(slot.x / TILE), z: Math.round(slot.z / TILE) };
      assert.ok(Math.abs(slot.x - tile.x * TILE) < 1e-9 && Math.abs(slot.z - tile.z * TILE) < 1e-9, `${at} ${slot.arm}: the slot is not on a tile`);
      assert.equal(floor.roomByCell.get(cellKey(tile.x, tile.z)), gate.id, `${at} ${slot.arm}: the slot is off the gate's floor`);
      assert.ok(ownFloor(gate, tile.x, tile.z), `${at} ${slot.arm}: the slot stands in a door's alcove, not in the gate`);
      assert.ok(Math.hypot(slot.x - gate.x * TILE, slot.z - gate.z * TILE) > 1.9, `${at} ${slot.arm}: the slot is underfoot at the heart`);
      assert.ok(Math.hypot(tile.x - gate.entry.x, tile.z - gate.entry.z) >= 2, `${at} ${slot.arm}: the slot is at the knight's arrival`);
      for (const door of floor.doors.filter(d => d.from === gate.id)) {
        assert.ok(Math.hypot(tile.x - door.x, tile.z - door.z) >= 2, `${at} ${slot.arm}: the slot is in door ${door.id}'s way`);
        // The doorway the generator keeps clear is the gate's last tile on the way to the door, which the alcove was cut back from.
        const mouth = doorMouth(gate, door);
        assert.ok(Math.hypot(tile.x - mouth.x, tile.z - mouth.z) >= 2, `${at} ${slot.arm}: the slot stands in the mouth of door ${door.id}`);
      }
      for (const prop of floor.props.filter(p => p.room === gate.id)) assert.ok(Math.hypot(tile.x - prop.x, tile.z - prop.z) >= 1, `${at} ${slot.arm}: the slot stands in a ${prop.kind}`);
    }
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      assert.ok(Math.hypot(slots[a].x - slots[b].x, slots[a].z - slots[b].z) >= 2 * PICKUP_RADIUS - 1e-9, `${at}: ${slots[a].arm} and ${slots[b].arm} are closer than two pickup radii, so one ring could hold both`);
    }
  }
  assert.equal(GATE_SPACING, 2 * PICKUP_RADIUS);
});

test('gateRacks is the same for the same floor and draws nothing: not from the generator, and not from Math.random', () => {
  const real = Math.random;
  try {
    Math.random = () => { throw new Error('gateRacks drew a random number'); };
    for (const seed of [0x1, 0x4, 0x60, 7919]) {
      const floor = generateFloor(seed, 1), before = JSON.stringify({ rooms: floor.rooms, tiles: floor.tiles, doors: floor.doors, props: floor.props, spawns: floor.spawns, weaponDrop: floor.weaponDrop });
      const first = gateRacks(floor);
      assert.deepEqual(gateRacks(floor), first, `seed ${seed}: two calls disagree`);
      assert.deepEqual(gateRacks(generateFloor(seed, 1)), first, `seed ${seed}: a fresh floor of the same seed lays the slots elsewhere`);
      assert.equal(JSON.stringify({ rooms: floor.rooms, tiles: floor.tiles, doors: floor.doors, props: floor.props, spawns: floor.spawns, weaponDrop: floor.weaponDrop }), before, `seed ${seed}: gateRacks changed the floor it read`);
      // A floor generated after a call is the floor a fresh process would lay: the call took nothing from the stream.
      const second = generateFloor(seed + 1, 1);
      gateRacks(second);
      assert.equal(JSON.stringify(generateFloor(seed + 1, 1).spawns), JSON.stringify(second.spawns), `seed ${seed + 1}: the floor after a call differs from a fresh one`);
    }
  } finally { Math.random = real; }
});

// --- Plan 020 Stage A: the Tide Altar's hall ---------------------------------------------------------------------------


/** Every tile of `floor` the knight can walk to from `from` (tiles), four ways, across floor cells only. */
const walkable = (floor: Floor, from: { x: number; z: number }) => {
  const seen = new Set([cellKey(from.x, from.z)]), queue = [from];
  while (queue.length) {
    const at = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const key = cellKey(at.x + dx, at.z + dz); if (floor.cells.has(key) && !seen.has(key)) { seen.add(key); queue.push({ x: at.x + dx, z: at.z + dz }); } }
  }
  return seen;
};

// Plan 026 (D5): the hall is an authored chapel, not floor one's Tide Gate with its other doors walled up. These hold its plan: the shape, one way out at
// the near end, the altar at the crossing, arms down the west arm and upgrades down the east, every one of them walkable from where the knight arrives.
test('the hall is the authored sanctuary: a cross with the altar at its heart, one way out at the south arm\'s end, nobody in it, and every tile walkable', () => {
  const hall = altarHall(), gate = hall.rooms[0];
  assert.deepEqual([gate.shape, gate.halfX * 2 + 1, gate.halfZ * 2 + 1, gate.name], ['cross', 15, 15, 'The Tide Altar'], 'the hall is not the chapel plan 026 laid out');
  assert.deepEqual([hall.rooms.length, hall.spawns.length, hall.edges.length, hall.guardCount, hall.goal, hall.start], [1, 0, 0, 0, 0, 0]);
  assert.deepEqual(hall.spine, [0]);
  assert.equal(hall.doors.length, 1, `the hall keeps ${hall.doors.length} doors`);
  const door = hall.doors[0];
  // The way out is past the south arm's end (+z, the camera's side), so the knight arrives facing the altar.
  assert.deepEqual([door.x, door.z, door.face], [gate.x, gate.z + gate.halfZ + 1, { x: 0, z: 1 }], 'the way down is not at the south arm\'s end');
  assert.ok(hall.cells.has(cellKey(door.x, door.z)), 'the door\'s own tile is not floor');
  assert.ok(gate.entry.z > gate.z && gate.entry.x === gate.x, 'the knight does not arrive in the nave, south of the altar');
  // Every tile is the cross's own floor (or the door's), none is a prop's, and the bookkeeping agrees with itself.
  for (const t of hall.tiles) assert.ok((t.x === door.x && t.z === door.z) || ownFloor(gate, t.x, t.z), `tile ${t.x},${t.z} is off the cross`);
  for (const p of hall.props) assert.ok(!hall.cells.has(cellKey(p.x, p.z)), `the ${p.kind} at ${p.x},${p.z} stands on floor`);
  assert.equal(hall.cells.size, hall.tiles.length);
  assert.equal(hall.roomByCell.size, hall.tiles.length);
  assert.deepEqual([...hall.roomByCell.values()].filter(room => room !== 0), []);
  assert.ok(hall.tiles.every(t => t.x >= hall.bounds.minX && t.x <= hall.bounds.maxX && t.z >= hall.bounds.minZ && t.z <= hall.bounds.maxZ), 'a tile lies outside the bounds');
  // Braziers in the apse (north of the altar): the hall's own fire, and nothing on the camera's side of the knight.
  const braziers = hall.props.filter(prop => prop.kind === 'brazier');
  assert.ok(braziers.length >= 2, 'the hall has fewer than two braziers');
  for (const p of hall.props) assert.ok(p.z < gate.z, `the ${p.kind} at ${p.x},${p.z} stands between the camera and the altar`);
  // The whole floor is one walk from the arrival: no rack, shrine or the altar can be cut off by a column.
  const walked = walkable(hall, gate.entry);
  assert.equal(walked.size, hall.cells.size, `${hall.cells.size - walked.size} tile(s) cannot be reached from the arrival`);
  assert.equal(hall.weaponDrop.room, 0);
  assert.ok(hall.cells.has(cellKey(Math.round(hall.weaponDrop.x / TILE), Math.round(hall.weaponDrop.z / TILE))));
});

test('the hall is the same room on every call, takes nothing from any random stream, and its seed moves nothing of its plan', () => {
  const first = altarHall();
  for (let i = 0; i < 20; i++) assert.deepEqual(altarHall(), first, `call ${i + 1} disagrees with the first`);
  const real = Math.random, own = Object.getOwnPropertyDescriptor(globalThis.crypto, 'getRandomValues');
  try {
    Math.random = () => { throw new Error('altarHall drew a random number'); };
    Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: () => { throw new Error('altarHall asked the crypto for a random number'); }, configurable: true });
    assert.deepEqual(altarHall(), first);
    for (const seed of [0x1, 0x4, 0x60, 7919]) {
      const fresh = generateFloor(seed, 1);
      altarHall();
      assert.deepEqual(generateFloor(seed, 1), fresh, `seed ${seed}: the floor after a hall differs from a fresh one`);
    }
  } finally {
    Math.random = real;
    if (own) Object.defineProperty(globalThis.crypto, 'getRandomValues', own); else delete (globalThis.crypto as { getRandomValues?: unknown }).getRandomValues;
  }
  assert.equal(first.seed, HALL_SEED, 'the hall the game builds does not carry HALL_SEED');
  const other = altarHall(HALL_SEED + 1);
  assert.equal(other.seed, HALL_SEED + 1, 'precondition: the sweep\'s halls carry their own seed, which the art hashes');
  assert.deepEqual({ ...other, seed: HALL_SEED }, first, 'a different seed moved the plan');
});

test('the hall seats seven racks down its west arm and four shrines down its east arm, clear of the altar, the way in, the way down, every prop and each other', () => {
  const hall = altarHall(), gate = hall.rooms[0], heart = { x: gate.x * TILE, z: gate.z * TILE }, slots = gateRacks(hall), spots = hallShrines(hall);
  // The altar is the sanctuary shrine's mesh (dungeon-floor-scene.ts: a disc of spread 1.9, its prompt ring 1.5, its kerb 2.05); no slot may stand inside it.
  const ALTAR_RADIUS = 1.9;
  assert.ok(HEART_CLEAR >= ALTAR_RADIUS, `the heart keeps ${HEART_CLEAR} clear, less than the altar's ${ALTAR_RADIUS}`);
  assert.equal(slots.length, 7, `the hall seats ${slots.length} racks`);
  assert.deepEqual(slots.map(slot => slot.arm), [...GATE_ARMS]);
  assert.equal(HALL_SHRINES, UPGRADES.length, 'a shrine for each upgrade');
  assert.equal(spots.length, HALL_SHRINES, 'the hall seats fewer shrines than there are upgrades');
  const mouth = doorMouth(gate, hall.doors[0]), walked = walkable(hall, gate.entry);
  const check = (spot: { x: number; z: number }, what: string, side: -1 | 1, clear: number) => {
    const tile = { x: Math.round(spot.x / TILE), z: Math.round(spot.z / TILE) };
    assert.ok(hall.cells.has(cellKey(tile.x, tile.z)) && ownFloor(gate, tile.x, tile.z), `${what}: off the hall's floor`);
    assert.ok(walked.has(cellKey(tile.x, tile.z)), `${what}: cannot be walked to`);
    assert.ok(Math.sign(tile.x - gate.x) === side && Math.abs(tile.z - gate.z) <= 2, `${what}: not in the ${side < 0 ? 'west' : 'east'} arm`);
    assert.ok(Math.hypot(spot.x - heart.x, spot.z - heart.z) > clear, `${what}: inside the altar's reach`);
    assert.ok(Math.hypot(tile.x - hall.doors[0].x, tile.z - hall.doors[0].z) >= 2 && Math.hypot(tile.x - mouth.x, tile.z - mouth.z) >= 2, `${what}: in the way down`);
    assert.ok(Math.hypot(tile.x - gate.entry.x, tile.z - gate.entry.z) >= 2, `${what}: at the knight's arrival`);
    for (const prop of hall.props) assert.ok(Math.hypot(tile.x - prop.x, tile.z - prop.z) >= 1.5, `${what}: in a ${prop.kind}`);
  };
  for (const slot of slots) check(slot, `the ${slot.arm} rack`, -1, ALTAR_RADIUS);
  spots.forEach((spot, i) => check(spot, `the ${UPGRADES[i].id} shrine`, 1, HEART_CLEAR + PICKUP_RADIUS));
  // No one ring can hold two things.
  const all = [...slots, ...spots];
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) assert.ok(Math.hypot(all[a].x - all[b].x, all[a].z - all[b].z) >= GATE_SPACING - 1e-9, `two rings overlap at ${all[a].x.toFixed(2)},${all[a].z.toFixed(2)} and ${all[b].x.toFixed(2)},${all[b].z.toFixed(2)}`);
});

test('only the hall carries the hall marker: no generated floor has the key at all, so the generator\'s output (and every recorded fixture of it) is what it was', () => {
  // Plan 020: `decorReservations` and the scene tell the hall from floor one (both `level: 1`) by this field, and by nothing else.
  assert.equal(altarHall().hall, true, 'the hall does not say it is the hall');
  for (const seed of [0x1, 0x4, 0x60, 7919, HALL_SEED]) for (const level of [1, 2, 3]) {
    const floor = generateFloor(seed, level);
    assert.equal('hall' in floor, false, `seed ${seed} level ${level}: a generated floor carries a hall key (even a false one is a change to the generator's output)`);
  }
  // And the hall is not floor one of its own seed: the same seed's generated floor is a keep of many rooms, the hall a single one.
  assert.ok(generateFloor(HALL_SEED, 1).rooms.length > 1 && altarHall().rooms.length === 1, 'HALL_SEED\'s generated floor is as small as the hall, so the marker is not what tells them apart');
});

// --- Plan 025 Stage C: the hall's upgrade shrines (where they stand is held with the racks above, plan 026) -------------------------------

test('hallShrines is the same for the same hall and draws nothing', () => {
  const real = Math.random;
  try {
    Math.random = () => { throw new Error('hallShrines drew a random number'); };
    const hall = altarHall(), first = hallShrines(hall);
    assert.deepEqual(hallShrines(altarHall()), first, 'two halls seat their shrines differently');
    assert.deepEqual(altarHall(), hall, 'seating the shrines changed the hall');
  } finally { Math.random = real; }
});
