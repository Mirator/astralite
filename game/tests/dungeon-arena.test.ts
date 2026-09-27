import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENA_CLEAR, ARENA_MAX, arenaFloor, parseArena, rosterOf } from '../app/dungeon-arena.ts';
import { cellKey, generateFloor, TILE } from '../app/dungeon-floor.ts';

const SEEDS = [0x1, 0x7, 0xc, 0x51ed, 0xbeef];

test('an arena link names its roster strictly, and anything it cannot read is no arena at all', () => {
  assert.deepEqual(parseArena('guard:2,archer:1', null, 3), { roster: ['guard', 'guard', 'archer'], level: 1 });
  // A bare kind is one of it; repeats add up; the roster comes back in bestiary order whatever the link's.
  assert.deepEqual(parseArena('archer,warden,archer:2', '3', 3), { roster: ['warden', 'archer', 'archer', 'archer'], level: 3 });
  for (const [spec, level] of [['goblin:2', null], ['guard:1,goblin:2', null], ['guard:two', null], ['guard:1', '4'], ['guard:1', '0'], ['guard:1', '1.5'], ['guard:0', null], ['', null]] as const)
    assert.equal(parseArena(spec, level, 3), null, `${JSON.stringify(spec)} at level ${level} should be refused`);
  assert.equal(parseArena(null, '2', 3), null);
  assert.equal(parseArena(`guard:${ARENA_MAX + 5}`, null, 3)?.roster.length, ARENA_MAX, 'a roster is capped, not refused');
  assert.deepEqual(rosterOf({ archer: 1, guard: 1 }), ['guard', 'archer']);
});

test('an arena is the generated floor with only its spawns replaced, the roster awake in the gate', () => {
  const roster = ['guard', 'stalker', 'warden', 'archer', 'archer'] as const;
  for (const seed of SEEDS) for (const level of [1, 2, 3]) {
    const plain = generateFloor(seed, level), arena = arenaFloor(seed, level, roster);
    assert.ok(plain.spawns.some(s => s.room !== plain.start), 'the generated floor had nothing outside the gate to clear');
    const { spawns, guardCount, ...layout } = arena, { spawns: _s, guardCount: _g, ...plainLayout } = plain;
    assert.deepEqual(layout, plainLayout, `seed ${seed} floor ${level}: the arena changed more than the spawns`);
    assert.deepEqual(spawns.map(s => s.kind), [...roster], `seed ${seed} floor ${level}: the roster did not all stand`);
    assert.equal(guardCount, roster.length);
    for (const s of spawns) {
      assert.equal(s.room, arena.start, 'a body stands outside the gate');
      assert.equal(s.ambush, false, 'an arena body is hidden');
      assert.ok(arena.cells.has(cellKey(s.x, s.z)), `a body stands in stone at ${s.x},${s.z}`);
      const gate = arena.rooms[arena.start];
      assert.ok(Math.hypot(s.x - gate.x, s.z - gate.z) >= ARENA_CLEAR, 'a body stands inside the knight\'s arrival');
      assert.ok(Math.hypot(s.x * TILE - arena.weaponDrop.x, s.z * TILE - arena.weaponDrop.z) >= 1.5 * TILE, 'a body stands on the rack');
    }
    for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++)
      assert.ok(Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z) >= 1, `seed ${seed}: two bodies share a tile`);
  }
});

test('a full arena roster fits the gate without stacking, and the same seed deals the same arena', () => {
  const roster = Array.from({ length: ARENA_MAX }, (_, i) => (['guard', 'archer', 'stalker'] as const)[i % 3]);
  for (const seed of SEEDS) {
    const arena = arenaFloor(seed, 1, roster);
    assert.ok(arena.spawns.length >= 8, `seed ${seed}: the gate took only ${arena.spawns.length} of ${ARENA_MAX}`);
    const tiles = new Set(arena.spawns.map(s => cellKey(s.x, s.z)));
    assert.equal(tiles.size, arena.spawns.length, `seed ${seed}: bodies stacked on one tile`);
    // Crowded is where spacing is decided: rounding twelve ring slots to tiles puts neighbours diagonal to
    // each other (1.41) unless the spacing rule moves them. Measured 2.0 at the tightest with it.
    let closest = Infinity;
    for (let i = 0; i < arena.spawns.length; i++) for (let j = i + 1; j < arena.spawns.length; j++) closest = Math.min(closest, Math.hypot(arena.spawns[i].x - arena.spawns[j].x, arena.spawns[i].z - arena.spawns[j].z));
    assert.ok(closest >= 1.5, `seed ${seed}: two bodies stand ${closest.toFixed(2)} tiles apart`);
    assert.deepEqual(arenaFloor(seed, 1, roster).spawns, arena.spawns);
  }
  assert.deepEqual(arenaFloor(0x7, 2, []).spawns, [], 'an empty roster clears the floor');
});

test('a bonecaller arrives with its reserve buried under it, outside every count, after everything standing', () => {
  const arena = arenaFloor(0x7, 1, ['guard', 'bonecaller']);
  const standing = arena.spawns.filter(s => !s.buried), buried = arena.spawns.filter(s => s.buried);
  assert.deepEqual(standing.map(s => s.kind), ['guard', 'bonecaller'], 'the reserve displaced a standing body');
  assert.equal(arena.guardCount, 2, 'the reserve counts as standing');
  assert.deepEqual(buried.map(s => s.kind), ['rattler', 'rattler', 'rattler']);
  const caller = arena.spawns.indexOf(standing[1]);
  for (const s of buried) {
    assert.equal(s.summoner, caller, 'a buried body answers to the wrong caller');
    assert.deepEqual([s.x, s.z], [standing[1].x, standing[1].z], 'a buried body is not under its caller');
  }
  assert.ok(arena.spawns.indexOf(buried[0]) > arena.spawns.indexOf(standing[1]), 'the reserve came before a standing body');
  assert.equal(arenaFloor(0x7, 1, ['guard', 'archer']).spawns.some(s => s.buried), false, 'a roster with no caller buried something');
});
