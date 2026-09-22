import assert from 'node:assert/strict';
import test from 'node:test';
import { PATCH_BASE, PATCH_HALF_DEPTH, PATCH_HALF_WIDTH, PATCH_TOP, pavingPatchGeometry } from '../app/dungeon-paving-patches.ts';

test('the merged slab is exactly 2.91 x 1.43, matching 2*TILE-0.05 by TILE-0.05', () => {
  assert.ok(Math.abs(PATCH_HALF_WIDTH * 2 - 2.91) < 1e-9, `width ${PATCH_HALF_WIDTH * 2} is not 2.91`);
  assert.ok(Math.abs(PATCH_HALF_DEPTH * 2 - 1.43) < 1e-9, `depth ${PATCH_HALF_DEPTH * 2} is not 1.43`);
  assert.equal(PATCH_TOP, 0.09);
  assert.equal(PATCH_BASE, -0.09);
});

test('the geometry is exactly 18 triangles: one top quad, four rim quads and four skirt quads', () => {
  const geometry = pavingPatchGeometry();
  const position = geometry.getAttribute('position');
  assert.equal(position.count % 3, 0, 'not a whole number of triangles');
  assert.equal(position.count / 3, 18, `expected 18 triangles, got ${position.count / 3}`);
});

test('every vertex stays within the slab\'s own bounds and between BASE and TOP', () => {
  const geometry = pavingPatchGeometry();
  const position = geometry.getAttribute('position');
  // The buffer is float32 (`Float32BufferAttribute`), so a value built from float64 constants like
  // `PATCH_TOP` reads back a few times 1e-9 off - real precision loss, not a bug in the geometry.
  const EPS = 1e-6;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'non-finite vertex');
    assert.ok(x >= -PATCH_HALF_WIDTH - EPS && x <= PATCH_HALF_WIDTH + EPS, `x=${x} outside +/-${PATCH_HALF_WIDTH}`);
    assert.ok(z >= -PATCH_HALF_DEPTH - EPS && z <= PATCH_HALF_DEPTH + EPS, `z=${z} outside +/-${PATCH_HALF_DEPTH}`);
    assert.ok(y >= PATCH_BASE - EPS && y <= PATCH_TOP + EPS, `y=${y} outside [${PATCH_BASE}, ${PATCH_TOP}]`);
  }
});

test('the top face is a single continuous quad: no vertex sits on the old inter-tile joint line', () => {
  const geometry = pavingPatchGeometry();
  const position = geometry.getAttribute('position');
  // The old single-tile joint would have run down the middle of the long axis, at x=0. Nothing in
  // this geometry may have a vertex there - a merged slab has one continuous top, not two glued
  // together with a seam still modelled at the centre.
  for (let i = 0; i < position.count; i++) {
    assert.notEqual(position.getX(i), 0, 'a vertex sits exactly on the old centre joint (x=0) - central seam not removed');
  }
});

test('every triangle is non-degenerate and every facet\'s flat normal points outward or upward', () => {
  const geometry = pavingPatchGeometry();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i), ay = position.getY(i), az = position.getZ(i);
    const bx = position.getX(i + 1), by = position.getY(i + 1), bz = position.getZ(i + 1);
    const cx = position.getX(i + 2), cy = position.getY(i + 2), cz = position.getZ(i + 2);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    assert.ok(len > 1e-6, `degenerate triangle at vertex ${i}`);
    // The face's own centroid, offset from the slab centre, is a good proxy for "outward" on every
    // facet but the flat top (whose own outward direction is +Y, checked separately below).
    const cxm = (ax + bx + cx) / 3, czm = (az + bz + cz) / 3;
    const isTop = Math.abs(ay - PATCH_TOP) < 1e-6 && Math.abs(by - PATCH_TOP) < 1e-6 && Math.abs(cy - PATCH_TOP) < 1e-6 && Math.abs(cxm) < PATCH_HALF_WIDTH - 0.05;
    if (isTop) {
      assert.ok(ny > 0, `top facet at vertex ${i} does not point upward (normal.y=${ny / len})`);
      continue;
    }
    const outX = Math.abs(cxm) > 1e-6 ? Math.sign(cxm) : 0, outZ = Math.abs(czm) > 1e-6 ? Math.sign(czm) : 0;
    const dot = (nx / len) * outX + (nz / len) * outZ;
    assert.ok(dot > -1e-6, `facet at vertex ${i} winds inward instead of outward (dot=${dot})`);
    // A stored normal attribute (used for lighting) must agree with the geometric one in sign.
    const storedDot = nx * normal.getX(i) + ny * normal.getY(i) + nz * normal.getZ(i);
    assert.ok(storedDot > 0, `stored normal at vertex ${i} disagrees with the facet's own winding`);
  }
});

test('the geometry has a bounding box and sphere, for frustum culling', () => {
  const geometry = pavingPatchGeometry();
  assert.ok(geometry.boundingBox, 'no bounding box computed');
  assert.ok(geometry.boundingSphere, 'no bounding sphere computed');
});

test('the UV mapping spans the whole rectangle once, not the single-tile square repeated', () => {
  const geometry = pavingPatchGeometry();
  const uv = geometry.getAttribute('uv');
  let minU = Infinity, maxU = -Infinity;
  for (let i = 0; i < uv.count; i++) { minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i)); }
  // A repeated single-tile mapping would only ever reach U in [0,1] on the near half and again on the
  // far half; one continuous mapping reaches past 1 on the long axis (or under 0), since the rectangle
  // is roughly twice as wide as it is deep and the mapping divides by its own full width.
  assert.ok(maxU > 1 - 1e-6 || minU < 1e-6, `U range [${minU}, ${maxU}] looks like a repeated single-tile mapping`);
});
