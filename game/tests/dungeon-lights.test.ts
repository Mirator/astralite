import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFloor, TILE } from '../app/dungeon-floor.ts';
import { assignSlots, chamberLights, fadeSlot, glanceWeight, GLANCE_SPAN, LIGHT_FADE, LIGHT_POOL, type LightSource, type PoolSlot } from '../app/dungeon-lights.ts';

// Plan 025 D6 (amended): the pool's real lights go to the chamber the knight is in, braziers first, then its open doors, then its sconces
// nearest its heart, and never to another chamber. Plan 026 D4: the pool is as large as the most crowded chamber, so every source of the chamber the
// knight is in is lit, not just the first eight.

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

/**
 * Every chamber's sources as the world builds them: the braziers and the doors off the generator, and a ring of sconces round each chamber's
 * walls standing in for the atmosphere's (whose placement only the scene knows), 4 to 18 a chamber: the range plan 025 Stage B counted in the
 * running game (2026-10-07, d3d11, 2598 chambers: sconces 7.6 mean, 18 max; braziers, sconces and doors together 23 max).
 */
const sourcesOf = (floor: ReturnType<typeof generateFloor>): LightSource[] => {
  const out: LightSource[] = [];
  floor.props.forEach((p, i) => { if (p.kind === 'brazier') out.push({ id: `brazier:${i}`, kind: 'brazier', room: p.room, x: p.x * TILE, y: 2, z: p.z * TILE, color: 0xff9440, intensity: 34, distance: 0 }); });
  for (const door of floor.doors) out.push({ id: `door:${door.id}`, kind: 'door', room: door.from, x: door.x * TILE, y: 1.6, z: door.z * TILE, color: 0xff8a8a, intensity: 9, distance: 7 });
  for (const room of floor.rooms) { const ring = 4 + (room.id * 7 + floor.seed) % 15; for (let k = 0; k < ring; k++) {
    const a = k / ring * Math.PI * 2;
    out.push({ id: `sconce:${room.id}:${k}`, kind: 'sconce', room: room.id, x: (room.x + Math.cos(a) * room.halfX) * TILE, y: 1.7, z: (room.z + Math.sin(a) * room.halfZ) * TILE, color: 0xff9c52, intensity: 16, distance: 7.5 });
  } }
  return out;
};
const heart = (room: { x: number; z: number }) => ({ x: room.x * TILE, z: room.z * TILE });

test('plan 026 D4: every source of the chamber the knight is in is lit, sealed or open, and nothing of another chamber', () => {
  assert.ok(LIGHT_POOL >= 23, `a pool of ${LIGHT_POOL} cannot light the most crowded chamber Stage B counted (23 braziers, sconces and doors)`);
  let overEight = 0, mostSources = 0;
  for (const level of [1, 2, 3]) for (const seed of SEEDS) {
    const floor = generateFloor(seed, level), sources = sourcesOf(floor);
    for (const room of floor.rooms) {
      const mine = sources.filter(s => s.room === room.id);
      if (mine.length > 8) overEight++;
      mostSources = Math.max(mostSources, mine.length);
      for (const open of [false, true]) {
        const lit = chamberLights({ id: room.id, ...heart(room), sources, open });
        const where = `seed ${seed} floor ${level} chamber ${room.id} (${open ? 'open' : 'sealed'})`;
        const wanted = mine.filter(s => s.kind !== 'door' || open);
        for (const s of wanted) assert.ok(lit.includes(s), `${where}: ${s.id} is dark (${lit.length} lit of ${wanted.length}, pool ${LIGHT_POOL})`);
        for (const s of lit) assert.equal(s.room, room.id, `${where}: ${s.id} belongs to chamber ${s.room}`);
        if (!open) assert.ok(!lit.some(s => s.kind === 'door'), `${where}: a sealed door is lit`);
      }
    }
  }
  // Precondition: the corpus holds chambers the old pool of eight left partly dark, and one as crowded as the keep's worst.
  assert.ok(overEight > 100, `only ${overEight} chambers carry more than eight sources, so the old pool would have lit them all`);
  assert.ok(mostSources >= 20, `the most crowded chamber carries ${mostSources} sources, not the 20-odd the keep has`);
});

test('a chamber with more sources than the pool lights at most the pool, braziers first, then its open doors, then the sconces nearest its heart', () => {
  const room = { id: 3, x: 10, z: 10 };
  const at = (id: string, kind: LightSource['kind'], dx: number): LightSource => ({ id, kind, room: 3, x: (room.x + dx) * TILE, y: 1.7, z: room.z * TILE, color: 0, intensity: 1, distance: 0 });
  const sconces = Array.from({ length: LIGHT_POOL + 6 }, (_, i) => at(`s${i}`, 'sconce', LIGHT_POOL + 6 - i));
  const sources = [...sconces, at('d0', 'door', 4), at('b0', 'brazier', 9), at('b1', 'brazier', -9), at('x', 'brazier', 0)].map(s => s.id === 'x' ? { ...s, room: 4 } : s);
  const lit = chamberLights({ ...heart(room), id: room.id, sources, open: true });
  assert.equal(lit.length, LIGHT_POOL, `${lit.length} lights from a pool of ${LIGHT_POOL}`);
  assert.deepEqual(lit.slice(0, 3).map(s => s.id), ['b0', 'b1', 'd0'], 'not braziers first, then the open door');
  assert.ok(!lit.some(s => s.id === 'x'), 'another chamber\'s brazier was lit');
  const kept = lit.filter(s => s.kind === 'sconce'), left = sconces.filter(s => !lit.includes(s));
  const d2 = (s: LightSource) => (s.x - room.x * TILE) ** 2 + (s.z - room.z * TILE) ** 2;
  assert.ok(left.length > 0, 'precondition: some sconce had to be left dark');
  assert.ok(Math.max(...kept.map(d2)) <= Math.min(...left.map(d2)), 'a sconce nearer the heart was left dark');
});

test('a source already lit keeps its slot when the chamber opens, and the doors take the slots the sconces gave up', () => {
  const s = (id: string, kind: LightSource['kind']): LightSource => ({ id, kind, room: 0, x: 0, y: 0, z: 0, color: 0, intensity: 1, distance: 0 });
  const sealed = [s('b0', 'brazier'), s('b1', 'brazier'), ...Array.from({ length: 6 }, (_, i) => s(`s${i}`, 'sconce'))];
  const before = assignSlots(Array(8).fill(null), sealed);
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
