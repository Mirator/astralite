import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { planFloorMotifs } from '../app/dungeon-decor-layout.ts';
import { generateFloor } from '../app/dungeon-floor.ts';
import { buildFloorMotifs } from '../app/dungeon-floor-motifs.ts';

const materials = () => ({
  dark: new THREE.MeshStandardMaterial(),
  inlay: new THREE.MeshStandardMaterial(),
  lip: new THREE.MeshStandardMaterial(),
});

/** No point the visual specification builds here may rise past this. */
const MAX_Y = 0.045;
const SEEDS = [1, 7, 42, 999, 0x1234, 0x60, 0x150, 4242, 8080, 13];

test('every attached triangle is finite, faces up, and stays inside the height budget', () => {
  for (const seed of SEEDS) {
    for (const level of [1, 2, 3]) {
      const floor = generateFloor(seed, level);
      const world = new THREE.Group();
      const layouts = planFloorMotifs(floor);
      const { realized } = buildFloorMotifs(world, floor, layouts, materials());
      assert.deepEqual(
        realized.map((r) => `${r.room}:${r.theme}`).sort(),
        layouts.map((l) => `${l.room}:${l.theme}`).sort(),
        `seed ${seed} level ${level}: realized does not match what was planned`,
      );
      let triangles = 0;
      for (const child of world.children) {
        assert.ok(child instanceof THREE.Mesh, 'a non-mesh object was attached to the floor group');
        const position = child.geometry.getAttribute('position');
        const normal = child.geometry.getAttribute('normal');
        assert.equal(position.count % 3, 0, 'a batched geometry here is not a whole number of triangles');
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
          assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite vertex, seed ${seed}`);
          assert.ok(y >= 0 && y <= MAX_Y + 1e-9, `vertex at y=${y} is outside [0, ${MAX_Y}], seed ${seed}`);
          assert.equal(normal.getY(i), 1, `a face at seed ${seed} is not pointing straight up`);
        }
        for (let i = 0; i < position.count; i += 3) {
          const ax = position.getX(i), az = position.getZ(i);
          const bx = position.getX(i + 1), bz = position.getZ(i + 1);
          const cx = position.getX(i + 2), cz = position.getZ(i + 2);
          const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
          assert.ok(area > 1e-6, `degenerate or negative-winding triangle, seed ${seed}`);
          triangles++;
        }
      }
      if (layouts.length) assert.ok(triangles > 0, `seed ${seed} level ${level} planned motifs but attached no geometry`);
      else assert.equal(triangles, 0, `seed ${seed} level ${level} planned nothing but attached geometry anyway`);
    }
  }
});

test('every vertex stays inside some room\'s own planned bed, not spilling into a neighbour', () => {
  for (const seed of SEEDS) {
    const floor = generateFloor(seed, 2);
    const layouts = planFloorMotifs(floor);
    if (!layouts.length) continue;
    const world = new THREE.Group();
    buildFloorMotifs(world, floor, layouts, materials());
    const withinAnyBed = (x: number, z: number) =>
      layouts.some((l) => Math.hypot(x - l.x, z - l.z) <= l.radius * 1.05 + 1e-6);
    for (const child of world.children) {
      const position = (child as THREE.Mesh).geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), z = position.getZ(i);
        assert.ok(withinAnyBed(x, z), `seed ${seed}: a vertex at (${x.toFixed(2)}, ${z.toFixed(2)}) is outside every planned bed`);
      }
    }
  }
});

test('a sanctuary keeps its clear centre empty but still shows a real motif outside it', () => {
  let checked = 0, everSubstantial = false;
  for (const seed of Array.from({ length: 60 }, (_, i) => (i + 1) * 3221)) {
    for (const level of [1, 2, 3]) {
      const floor = generateFloor(seed, level);
      const layouts = planFloorMotifs(floor);
      const clear = layouts.filter((l) => l.clearRadius);
      if (!clear.length) continue;
      checked++;
      const world = new THREE.Group();
      buildFloorMotifs(world, floor, layouts, materials());
      // Total triangle area attributed to each sanctuary layout, so a fix for "nothing inside the
      // clear circle" cannot silently regress into "nothing outside it either" - the bug this test
      // was written to catch: a channel or a sector fan that runs through the centre loses far more
      // than the circle itself once whole triangles are dropped instead of the geometry being built
      // to avoid the centre in the first place.
      const areaBySanctuary = new Map(clear.map((l) => [l.room, 0]));
      for (const child of world.children) {
        const position = (child as THREE.Mesh).geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 3) {
          const ax = position.getX(i), az = position.getZ(i);
          const bx = position.getX(i + 1), bz = position.getZ(i + 1);
          const cx3 = position.getX(i + 2), cz3 = position.getZ(i + 2);
          const cx = (ax + bx + cx3) / 3, cz = (az + bz + cz3) / 3;
          for (const sanctuary of clear) {
            assert.ok(
              Math.hypot(cx - sanctuary.x, cz - sanctuary.z) >= sanctuary.clearRadius! - 1e-6,
              `seed ${seed} level ${level}: a triangle centroid sits inside sanctuary room ${sanctuary.room}'s clear radius`,
            );
            if (Math.hypot(cx - sanctuary.x, cz - sanctuary.z) > sanctuary.radius * 1.05) continue;
            const area = Math.abs((bx - ax) * (cz3 - az) - (cx3 - ax) * (bz - az)) / 2;
            areaBySanctuary.set(sanctuary.room, (areaBySanctuary.get(sanctuary.room) ?? 0) + area);
          }
        }
      }
      for (const [room, area] of areaBySanctuary) {
        if (area > 0.15) everSubstantial = true;
        assert.ok(area >= 0, `seed ${seed} level ${level}: negative area for sanctuary room ${room}`);
      }
    }
  }
  assert.ok(checked > 0, 'sample never produced a sanctuary with a realized motif; widen the seed sample');
  assert.ok(everSubstantial, 'every sanctuary motif in the sample was reduced to a sliver by the clear-centre cut');
});

test('rebuilding the same floor twice settles at the same geometry', () => {
  const floor = generateFloor(0xabc, 2);
  const layouts = planFloorMotifs(floor);
  const counts = () => {
    const world = new THREE.Group();
    buildFloorMotifs(world, floor, layouts, materials());
    return world.children.map((child) => (child as THREE.Mesh).geometry.getAttribute('position').count);
  };
  assert.deepEqual(counts(), counts(), 'two builds of the same layout produced different vertex counts');
});

test('dispose is safe to call and does not throw on an empty floor', () => {
  const floor = generateFloor(1, 1);
  const world = new THREE.Group();
  const built = buildFloorMotifs(world, floor, [], materials());
  assert.doesNotThrow(() => built.dispose());
});
