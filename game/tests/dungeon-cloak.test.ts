import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';
import { BODY_CLEAR, HEM_MAX, hemWeight, swayCloth, type Tunic } from '../app/dungeon-cloth.ts';

// Rewritten for plan 027 Stage B. This file used to hold the cape - a separate flat plane hung off the poncho's
// back, swayed by animateCloth and pitched by the game - to a pinned seam, a clear ground and a tip under the
// sash. Stage A deleted the plane (the back point is now the poncho lathe's own back column) and Stage B moved
// the cloth onto one hem state (dungeon-cloth.ts). These read the real cloth meshes off makeKnight() and run
// the rule the game runs on them; dungeon-cloth.test.ts holds the spring itself.
type ClothMesh = { mesh: THREE.Mesh; rest: Float32Array; pinnedFrom: number };
const knightCloth = () => {
  const knight = makeKnight(); knight.position.y = .03; knight.updateWorldMatrix(true, true);
  const cloak = knight.userData.cloak as THREE.Group, data = cloak.userData as { meshes: ClothMesh[]; top: number; bottom: number; tunic: Tunic; tip: number };
  return { knight, cloak, data, torso: knight.userData.torso as THREE.Group };
};
const tunicAt = (tunic: Tunic, y: number) => {
  if (y < tunic[0]![0] || y > tunic[tunic.length - 1]![0]) return 0;
  for (let i = 1; i < tunic.length; i++) if (y <= tunic[i]![0]) { const [y0, r0] = tunic[i - 1]!, [y1, r1] = tunic[i]!; return y1 > y0 ? r0 + (r1 - r0) * (y - y0) / (y1 - y0) : r1; }
  return 0;
};

test('the poncho is one garment: no separate cape plane, and userData.cape is the poncho itself', () => {
  const { knight, torso, cloak } = knightCloth(), poncho = cloak.children.find(child => child.name === 'poncho');
  assert.ok(poncho instanceof THREE.Mesh, 'precondition: the poncho is found by name under userData.cloak');
  const planes: string[] = [];
  torso.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) planes.push(o.name || o.uuid); });
  assert.deepEqual(planes, [], 'a flat plane hangs off the torso: the cape is back');
  assert.ok(knight.userData.cape === poncho, `userData.cape is ${(knight.userData.cape as THREE.Object3D)?.name || 'missing'}, not the poncho mesh`);
});

test('a swung hem moves the drape, never the yoke, never into the tunic, and never lifts the back point to a wing', () => {
  const { cloak, data, torso } = knightCloth(), names = data.meshes.map(m => m.mesh.name);
  assert.deepEqual(names.sort(), ['poncho', 'poncho-trim', 'strap'], 'the cloth the game sways is the poncho, its trim and the strap');
  // The sash's lowest point behind him, off the torso's red batch: the back point must hang below it whatever the hem
  // does. Plan 030 round 2: behind him (torso-local z over .1), since the sheet's back point (.50 of his height) ends
  // above the relic's tassel at his front, which this used to read (the batch's lowest point, .880).
  // By the material's name (plan 030 round 3 moved the sash's colour, which this used to match).
  const sash = torso.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === 'red') as THREE.Mesh;
  assert.ok(sash, 'precondition: the sash batch is found');
  const sashAt = sash.geometry.getAttribute('position'), world = new THREE.Vector3();
  let sashBottom = Infinity, behind = 0;
  for (let i = 0; i < sashAt.count; i++) if (sashAt.getZ(i) > .1) { behind++; sashBottom = Math.min(sashBottom, world.fromBufferAttribute(sashAt, i).applyMatrix4(sash.matrixWorld).y); }
  assert.ok(behind >= 8, `precondition: the sash has ${behind} vertices behind him`);
  const poncho = data.meshes.find(m => m.mesh.name === 'poncho')!, neckY = Math.max(...Array.from({ length: poncho.rest.length / 3 }, (_, v) => poncho.rest[v * 3 + 1]!));
  let moved = 0;
  const grid = [-HEM_MAX, -HEM_MAX / 2, 0, HEM_MAX / 2, HEM_MAX];
  for (const x of grid) for (const z of grid) {
    for (const { mesh, rest, pinnedFrom } of data.meshes) {
      const out = new Float32Array(rest.length);
      swayCloth(rest, out, { x, z, vx: 0, vz: 0 }, data.top, data.bottom, data.tunic, pinnedFrom);
      for (let i = 0, v = 0; i < rest.length; i += 3, v++) {
        const ry = rest[i + 1]!;
        // The neck ring, everything at or above the shoulder break and the strap's drop onto the bag do not move at all.
        if (ry >= neckY - 1e-6 || hemWeight(ry, data.top, data.bottom) === 0 || v >= pinnedFrom) {
          assert.ok(out[i] === rest[i] && out[i + 1] === ry && out[i + 2] === rest[i + 2], `${mesh.name} vertex ${v} at rest height ${ry.toFixed(3)} moved with the hem at ${x}, ${z}`);
          continue;
        }
        moved = Math.max(moved, Math.hypot(out[i]! - rest[i]!, out[i + 1]! - ry, out[i + 2]! - rest[i + 2]!));
        const tunic = tunicAt(data.tunic, out[i + 1]!), r = Math.hypot(out[i]!, out[i + 2]!), restR = Math.hypot(rest[i]!, rest[i + 2]!);
        // Outside the tunic by .015 (the rule keeps BODY_CLEAR), or no nearer it than it hung at rest.
        if (tunic > 0) assert.ok(r >= Math.min(restR, tunic + BODY_CLEAR) - 1e-6 && r - tunic >= Math.min(.015, restR - tunic) - 1e-6, `${mesh.name} vertex ${v} is ${(r - tunic).toFixed(3)} from the tunic with the hem at ${x}, ${z}`);
        world.set(out[i]!, out[i + 1]!, out[i + 2]!).applyMatrix4(cloak.matrixWorld);
        assert.ok(world.y > .1, `${mesh.name} vertex ${v} reaches the ground (${world.y.toFixed(3)}) with the hem at ${x}, ${z}`);
      }
      if (mesh.name === 'poncho') {
        world.set(out[data.tip * 3]!, out[data.tip * 3 + 1]!, out[data.tip * 3 + 2]!).applyMatrix4(cloak.matrixWorld);
        assert.ok(world.y < sashBottom, `with the hem at ${x}, ${z} the back point's tip rose to ${world.y.toFixed(3)}, above the sash (${sashBottom.toFixed(3)})`);
      }
    }
  }
  // Measured 2026-10-12 (node): a cloth vertex moves up to .172 at the grid's corner (HEM_MAX on both axes).
  assert.ok(moved >= .05, `precondition: the largest move on the grid was only ${moved.toFixed(3)}, so "stays outside" checked nothing`);
});

test('the satchel swings on the strap\'s end: the joint is the same point of the torso at every angle, and the strap ends on it', () => {
  const { knight, torso, data } = knightCloth(), satchel = knight.userData.satchel as THREE.Group;
  assert.ok(satchel, 'precondition: the satchel is kept as its own joint');
  const strap = data.meshes.find(m => m.mesh.name === 'strap')!, n = strap.rest.length / 3;
  // The ribbon's last pair of vertices straddle its end point, lifted .02 off it.
  const end = new THREE.Vector3((strap.rest[(n - 2) * 3]! + strap.rest[(n - 1) * 3]!) / 2, (strap.rest[(n - 2) * 3 + 1]! + strap.rest[(n - 1) * 3 + 1]!) / 2, (strap.rest[(n - 2) * 3 + 2]! + strap.rest[(n - 1) * 3 + 2]!) / 2);
  const bag = new THREE.Box3(), anchors: THREE.Vector3[] = [], centres: THREE.Vector3[] = [];
  for (const [x, z] of [[0, 0], [.35, 0], [-.35, .2], [.2, -.2]]) {
    satchel.rotation.set(x!, 0, z!); knight.updateWorldMatrix(true, true);
    anchors.push(torso.worldToLocal(satchel.getWorldPosition(new THREE.Vector3())));
    centres.push(torso.worldToLocal(bag.setFromObject(satchel, true).getCenter(new THREE.Vector3())));
  }
  assert.ok(anchors[0]!.distanceTo(end) <= .03, `the strap ends ${anchors[0]!.distanceTo(end).toFixed(3)} from the satchel's joint`);
  assert.ok(centres[0]!.distanceTo(centres[1]!) > .03, 'precondition: swinging the joint moves the bag');
  for (const anchor of anchors) assert.ok(anchor.distanceTo(anchors[0]!) < 1e-6, `the satchel's joint moved to ${anchor.toArray().map(v => v.toFixed(3)).join(', ')} as it swung`);
});

test('the short hems at his front and sides take most of the hem\'s swing, not a sliver of it (plan 030 round 2)', () => {
  const { cloak, data } = knightCloth(), poncho = data.meshes.find(m => m.mesh.name === 'poncho');
  assert.ok(poncho, 'precondition: the poncho is swayed');
  // Torso-local hem heights off the rest grid, by column (the poncho is column-major, 33 columns): the front point is
  // column 16's lowest vertex and the arm notches columns 8 and 24's.
  const rings = poncho.rest.length / 3 / 33, low = (c: number) => Math.min(...Array.from({ length: rings }, (_, k) => poncho.rest[(c * rings + k) * 3 + 1]!));
  assert.ok(Number.isInteger(rings), `precondition: the poncho is a 33-column grid (${poncho.rest.length / 3} vertices)`);
  const front = hemWeight(low(16), data.top, data.bottom), sides = Math.min(hemWeight(low(8), data.top, data.bottom), hemWeight(low(24), data.top, data.bottom));
  assert.ok(data.top - low(8) < .5 * (data.top - data.bottom), 'precondition: the sides end in the upper half of the drape');
  // The sheet's poncho ends at the elbows at the sides and high at the front, so most of its hem is short. Measured
  // 2026-10-12 (node): the front point takes .80 of the swing and the arm notches .61; plan 030's smoothstep gave them
  // .58 and .32, and the critic read the cloth as rigid.
  assert.ok(front >= .7, `the front point takes only ${front.toFixed(2)} of the hem's swing`);
  assert.ok(sides >= .5, `the hem at the arms takes only ${sides.toFixed(2)} of the hem's swing`);
  assert.ok(cloak.userData.top === data.top && hemWeight(data.top, data.top, data.bottom) === 0, 'the shoulder line moves with the hem');
});
