import assert from 'node:assert/strict';
import test from 'node:test';
import { PATCH_HALF_WIDTH, PATCH_TOP, pavingPatchGeometry } from '../app/dungeon-paving-patches.ts';

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
