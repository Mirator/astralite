import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFloor, TILE } from '../app/dungeon-floor.ts';
import { assignSlots, chamberLights, fadeSlot, glanceWeight, GLANCE_SPAN, LIGHT_FADE, LIGHT_POOL, type LightSource, type PoolSlot } from '../app/dungeon-lights.ts';

// Plan 025 D6 (amended): the pool's eight real lights go to the chamber the knight is in, braziers first, then
// its open doors, then its sconces nearest its heart, and never to another chamber.

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

/**
 * Every chamber's sources as the world builds them: the braziers and the doors off the generator, and a
 * ring of sconces round each chamber's walls standing in for the atmosphere's (whose placement only the scene
 * knows), enough of them that most chambers carry more than eight, as Stage B's count found.
 */
const sourcesOf = (floor: ReturnType<typeof generateFloor>): LightSource[] => {
  const out: LightSource[] = [];
  floor.props.forEach((p, i) => { if (p.kind === 'brazier') out.push({ id: `brazier:${i}`, kind: 'brazier', room: p.room, x: p.x * TILE, y: 2, z: p.z * TILE, color: 0xff9440, intensity: 34, distance: 0 }); });
  for (const door of floor.doors) out.push({ id: `door:${door.id}`, kind: 'door', room: door.from, x: door.x * TILE, y: 1.6, z: door.z * TILE, color: 0xff8a8a, intensity: 9, distance: 7 });
  for (const room of floor.rooms) for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2;
    out.push({ id: `sconce:${room.id}:${k}`, kind: 'sconce', room: room.id, x: (room.x + Math.cos(a) * room.halfX) * TILE, y: 1.7, z: (room.z + Math.sin(a) * room.halfZ) * TILE, color: 0xff9c52, intensity: 16, distance: 7.5 });
  }
  return out;
};
const heart = (room: { x: number; z: number }) => ({ x: room.x * TILE, z: room.z * TILE });

test('a chamber is lit by its own sources only, at most eight, braziers first, then its open doors, then the sconces nearest its heart', () => {
  let crowded = 0, withDoors = 0, ranked = 0;
  for (const level of [1, 2, 3]) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), sources = sourcesOf(floor);
    for (const room of floor.rooms) {
      const mine = sources.filter(s => s.room === room.id);
      if (mine.length > LIGHT_POOL) crowded++;
      for (const open of [false, true]) {
        const lit = chamberLights({ id: room.id, ...heart(room), sources, open });
        const where = `seed ${seed} floor ${level} chamber ${room.id} (${open ? 'open' : 'sealed'})`;
        assert.ok(lit.length <= LIGHT_POOL, `${where}: ${lit.length} lights from a pool of ${LIGHT_POOL}`);
        for (const s of lit) assert.equal(s.room, room.id, `${where}: ${s.id} belongs to chamber ${s.room}`);
        const doors = mine.filter(s => s.kind === 'door'), braziers = mine.filter(s => s.kind === 'brazier');
        for (const b of braziers) assert.ok(lit.includes(b), `${where}: brazier ${b.id} is dark`);
        if (open) { for (const d of doors) assert.ok(lit.includes(d), `${where}: open door ${d.id} has no light`); if (doors.length) withDoors++; }
        else assert.ok(!lit.some(s => s.kind === 'door'), `${where}: a sealed door is lit`);
        const kinds = lit.map(s => ['brazier', 'door', 'sconce', 'bounce'].indexOf(s.kind));
        assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b), `${where}: out of priority order: ${lit.map(s => s.kind).join(',')}`);
        // The sconces kept are the nearest the heart: none left out is nearer than one taken.
        const d2 = (s: LightSource) => (s.x - room.x * TILE) ** 2 + (s.z - room.z * TILE) ** 2;
        const kept = lit.filter(s => s.kind === 'sconce'), left = mine.filter(s => s.kind === 'sconce' && !lit.includes(s));
        if (kept.length && left.length) ranked++;
        assert.ok(!kept.length || !left.length || Math.max(...kept.map(d2)) <= Math.min(...left.map(d2)), `${where}: a sconce nearer the heart was left dark`);
        assert.equal(lit.length, Math.min(LIGHT_POOL, mine.filter(s => s.kind !== 'door' || open).length), `${where}: a slot went unused while a source of the chamber was dark`);
      }
    }
  }
  // Precondition: the corpus has chambers that cannot all be lit, and open chambers with doors to light.
  assert.ok(crowded > 100, `only ${crowded} chambers carry more sources than the pool`);
  assert.ok(withDoors > 100, `only ${withDoors} open chambers have doors`);
  assert.ok(ranked > 100, `only ${ranked} chambers had to choose between sconces`);
});

test('a source already lit keeps its slot when the chamber opens, and the doors take the slots the sconces gave up', () => {
  const s = (id: string, kind: LightSource['kind']): LightSource => ({ id, kind, room: 0, x: 0, y: 0, z: 0, color: 0, intensity: 1, distance: 0 });
  const sealed = [s('b0', 'brazier'), s('b1', 'brazier'), ...Array.from({ length: 6 }, (_, i) => s(`s${i}`, 'sconce'))];
  const before = assignSlots(Array(LIGHT_POOL).fill(null), sealed);
  assert.deepEqual(before.map(x => x?.id), ['b0', 'b1', 's0', 's1', 's2', 's3', 's4', 's5'], 'an empty pool did not fill its slots in priority order');
  const open = [sealed[0], sealed[1], s('d0', 'door'), s('d1', 'door'), sealed[2], sealed[3], sealed[4], sealed[5]];
  const after = assignSlots(before.map(x => x?.id ?? null), open);
  assert.deepEqual(after.map(x => x?.id), ['b0', 'b1', 's0', 's1', 's2', 's3', 'd0', 'd1'], 'a light that stayed wanted moved slot');
});

test('a swap fades the old light out and the new one in over 0.3 s, and an idle slot only fades in', () => {
  const s = (id: string): LightSource => ({ id, kind: 'sconce', room: 0, x: 0, y: 0, z: 0, color: 0, intensity: 1, distance: 0 });
  const dt = 1 / 600;
  let slot: PoolSlot = { shown: s('a'), level: 1 }, t = 0, sawOld = false;
  while (!(slot.shown?.id === 'b' && slot.level === 1)) { slot = fadeSlot(slot, s('b'), dt); t += dt; if (slot.shown?.id === 'a') sawOld = true; assert.ok(t < 1, 'the swap never finished'); }
  assert.ok(sawOld, 'the old light was dropped without fading out');
  assert.ok(Math.abs(t - LIGHT_FADE) < 3 * dt, `the swap took ${t.toFixed(3)} s`);
  let idle: PoolSlot = { shown: null, level: 0 }; t = 0;
  idle = fadeSlot(idle, s('c'), dt); assert.equal(idle.shown?.id, 'c', 'an idle slot waited before taking its light');
  while (idle.level < 1) { idle = fadeSlot(idle, s('c'), dt); t += dt; }
  assert.ok(Math.abs(t - LIGHT_FADE / 2) < 3 * dt, `an idle slot took ${t.toFixed(3)} s to come up`);
});

test('the camera\'s glance at the doors eases out and back inside its span', () => {
  assert.equal(glanceWeight(0), 0); assert.equal(glanceWeight(GLANCE_SPAN), 0); assert.equal(glanceWeight(-1), 0); assert.equal(glanceWeight(5), 0);
  assert.ok(Math.abs(glanceWeight(GLANCE_SPAN / 2) - 1) < 1e-9, 'the glance never reached the doors');
  assert.ok(glanceWeight(GLANCE_SPAN * .1) < .1 && glanceWeight(GLANCE_SPAN * .9) < .1, 'the glance starts or ends with a jump');
});
