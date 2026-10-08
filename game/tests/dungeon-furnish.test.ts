import assert from 'node:assert/strict';
import test from 'node:test';
import { ARRIVAL_CLEAR, carves, cellKey, generateFloor, TILE, type Floor } from '../app/dungeon-floor.ts';
import { wavedFloor } from '../app/dungeon-waves.ts';
import { DOOR_CLEAR, doorMouth, furnishFloor, HEART_CLEAR_TILES, SPAWN_CLEAR, type PropKind } from '../app/dungeon-furnish.ts';

// Plan 025 Stage F (D12 a): the furniture pass. Swept over the generator tests' own corpus: 40 seeds, (i + 1) * 7919, on floors 1 to 3, each floor waved
// as the game and the sim lay it, so every wave's spawn tile is among the ones kept clear.
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);
const laid = (seed: number, level: number) => wavedFloor(generateFloor(seed, level), seed, level);
const corpus = [1, 2, 3].flatMap(level => SEEDS.map(seed => ({ seed, level, plain: laid(seed, level), furnished: furnishFloor(laid(seed, level), seed, level) })));

const own = (room: Floor['rooms'][number], x: number, z: number) => Math.abs(x - room.x) <= room.halfX && Math.abs(z - room.z) <= room.halfZ && carves(room, x - room.x, z - room.z);

/** The test's own flood (not the pass's): from the arrival, over walkable tiles no prop stands on or beside, does it reach `targets`? Returns the ones it misses. */
const unreached = (cells: Set<string>, props: { x: number; z: number }[], from: { x: number; z: number }, targets: { x: number; z: number; what: string }[]) => {
  const blocked = (x: number, z: number) => !cells.has(cellKey(x, z)) || props.some(p => Math.abs(p.x - x) <= 1 && Math.abs(p.z - z) <= 1);
  const seen = new Set<string>();
  if (!blocked(from.x, from.z)) { seen.add(cellKey(from.x, from.z)); }
  const queue = seen.size ? [from] : [];
  for (let i = 0; i < queue.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = { x: queue[i].x + dx, z: queue[i].z + dz }, key = cellKey(next.x, next.z);
    if (!seen.has(key) && !blocked(next.x, next.z)) { seen.add(key); queue.push(next); }
  }
  return targets.filter(t => !seen.has(cellKey(t.x, t.z)));
};

test('props never block a door or the path between doors: a lane a body wide, touching no prop, joins the arrival to every door, spawn and heart', () => {
  let rooms = 0, props = 0, doors = 0;
  for (const { seed, level, furnished } of corpus) for (const room of furnished.rooms) {
    if (room.role !== 'path') continue;
    const mine = furnished.furniture.filter(p => p.room === room.id);
    rooms++; props += mine.length;
    const targets = [
      ...furnished.doors.filter(d => d.from === room.id).map(d => ({ x: d.x, z: d.z, what: `door ${d.id}` })),
      ...furnished.spawns.filter(s => s.room === room.id).map((s, i) => ({ x: s.x, z: s.z, what: `spawn ${i} (${s.kind}, wave ${s.wave ?? 1})` })),
      ...(furnished.cells.has(cellKey(room.x, room.z)) ? [{ x: room.x, z: room.z, what: 'the heart' }] : []),
    ];
    doors += targets.filter(t => t.what.startsWith('door')).length;
    const missed = unreached(furnished.cells, mine, room.entry, targets);
    assert.deepEqual(missed.map(t => t.what), [], `level ${level} seed ${seed} room ${room.id} (${room.shape}): no clear lane from the arrival to ${missed.map(t => t.what).join(', ')}; props at ${mine.map(p => `${p.kind}@${p.x},${p.z}`).join(' ')}`);
  }
  // Preconditions: the sweep is the corpus, every path chamber was furnished with something, and the doors were there to be blocked.
  assert.equal(corpus.length, 120);
  assert.ok(rooms > 2000 && props > rooms * 3, `${props} props over ${rooms} chambers: too little was laid for the lane to be tested`);
  assert.ok(doors > rooms, `${doors} doors over ${rooms} chambers`);
});

test('the doorways, the arrival ring, every spawn tile and the heart are kept clear, and cover never walls off a pocket of floor', () => {
  let cover = 0;
  for (const { seed, level, furnished } of corpus) for (const room of furnished.rooms) {
    if (room.role !== 'path') continue;
    const at = `level ${level} seed ${seed} room ${room.id}`;
    const mine = furnished.furniture.filter(p => p.room === room.id);
    for (const p of mine) {
      assert.ok(own(room, p.x, p.z), `${at}: a ${p.kind} stands off the chamber's own floor (${p.x},${p.z})`);
      assert.ok(Math.hypot(p.x - room.entry.x, p.z - room.entry.z) >= ARRIVAL_CLEAR, `${at}: a ${p.kind} stands in the arrival ring`);
      assert.ok(Math.hypot(p.x - room.x, p.z - room.z) >= HEART_CLEAR_TILES, `${at}: a ${p.kind} stands at the heart`);
      for (const d of furnished.doors.filter(door => door.from === room.id)) for (const way of [d, doorMouth(room, d)]) assert.ok(Math.hypot(p.x - way.x, p.z - way.z) >= DOOR_CLEAR, `${at}: a ${p.kind} stands in door ${d.id}'s way`);
      for (const s of furnished.spawns.filter(sp => sp.room === room.id)) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= SPAWN_CLEAR, `${at}: a ${p.kind} stands on or beside a ${s.kind}'s spawn`);
      assert.equal(furnished.cells.has(cellKey(p.x, p.z)), p.kind !== 'cover', `${at}: a ${p.kind} is ${p.kind === 'cover' ? 'walkable' : 'solid'}`);
      if (p.kind === 'cover') cover++;
    }
    // Every walkable tile of the chamber is still one walk from the arrival: a wave ring or a raised body can never land in a pocket the knight cannot reach.
    const tiles = furnished.tiles.filter(t => t.room === room.id && furnished.cells.has(cellKey(t.x, t.z)));
    const seen = new Set([cellKey(room.entry.x, room.entry.z)]), queue = [room.entry];
    for (let i = 0; i < queue.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: queue[i].x + dx, z: queue[i].z + dz }, key = cellKey(next.x, next.z);
      if (!seen.has(key) && furnished.cells.has(key)) { seen.add(key); queue.push(next); }
    }
    assert.deepEqual(tiles.filter(t => !seen.has(cellKey(t.x, t.z))).map(t => `${t.x},${t.z}`), [], `${at}: cover cut a pocket of floor off`);
  }
  assert.ok(cover > 500, `only ${cover} cover blocks across the sweep, so the pocket check checked little`);
});

test('a chamber holds about 6 to 12 props in all, of every kind, and the furnished floor is the waved floor with only cover taken out of its cells', () => {
  const totals: number[] = [], kinds = new Map<PropKind, number>();
  for (const { seed, level, plain, furnished } of corpus) {
    // Nothing of the floor moved: the rooms, tiles, props, spawns and doors are the waved floor's, and the only cells gone are the cover tiles.
    const lay = (f: Floor) => JSON.stringify({ rooms: f.rooms, tiles: f.tiles, props: f.props, spawns: f.spawns, doors: f.doors, weaponDrop: f.weaponDrop });
    assert.equal(lay(furnished), lay(plain), `level ${level} seed ${seed}: furnishing changed the floor it was handed`);
    const gone = [...plain.cells].filter(key => !furnished.cells.has(key)).sort(), covers = furnished.furniture.filter(p => p.kind === 'cover').map(p => cellKey(p.x, p.z)).sort();
    assert.deepEqual(gone, covers, `level ${level} seed ${seed}: a cell other than a cover tile left the floor`);
    assert.equal([...furnished.cells].filter(key => !plain.cells.has(key)).length, 0, `level ${level} seed ${seed}: furnishing added walkable floor`);
    for (const room of furnished.rooms) if (room.role === 'path') totals.push(furnished.props.filter(p => p.room === room.id).length + furnished.furniture.filter(p => p.room === room.id).length);
    for (const p of furnished.furniture) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length, sorted = [...totals].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  console.log(`  props a path chamber (generator stone + furniture): mean ${mean.toFixed(2)}, median ${median}, min ${sorted[0]}, max ${sorted[sorted.length - 1]}; kinds ${JSON.stringify(Object.fromEntries(kinds))}`);
  assert.ok(mean >= 6 && mean <= 12, `a chamber holds ${mean.toFixed(2)} props on average, not about 6 to 12`);
  for (const kind of ['urn', 'crate', 'keg', 'spikes', 'cover', 'chest'] as const) assert.ok((kinds.get(kind) ?? 0) > 50, `the sweep laid only ${kinds.get(kind) ?? 0} ${kind}s`);
  assert.ok(kinds.get('chest')! < kinds.get('urn')! / 2, 'a chest is not occasional');
});

test('the furniture is dealt from its own stream: the same seed lays the same props, the generator is untouched, and the Tide Gate and the stair hall hold none', () => {
  for (const { seed, level, furnished } of corpus.slice(0, 30)) {
    const before = JSON.stringify({ ...generateFloor(seed, level), cells: [...generateFloor(seed, level).cells] });
    const again = furnishFloor(laid(seed, level), seed, level);
    assert.deepEqual(again.furniture, furnished.furniture, `level ${level} seed ${seed}: furnishing twice laid different props`);
    assert.equal(JSON.stringify({ ...generateFloor(seed, level), cells: [...generateFloor(seed, level).cells] }), before, `level ${level} seed ${seed}: furnishing moved what the generator lays`);
    for (const p of furnished.furniture) assert.equal(furnished.rooms[p.room].role, 'path', `level ${level} seed ${seed}: a ${p.kind} stands in the ${furnished.rooms[p.room].role} chamber`);
  }
  // A different floor seed lays a different chamber: the stream is the seed's, not one fixed layout.
  assert.notDeepEqual(furnishFloor(laid(7919, 1), 7919, 1).furniture, furnishFloor(laid(7919, 1), 7920, 1).furniture);
  // Positions are tiles, as the generator's props are; the world reads them times TILE.
  assert.ok(corpus[0].furnished.furniture.every(p => Number.isInteger(p.x) && Number.isInteger(p.z)) && TILE > 1);
});
