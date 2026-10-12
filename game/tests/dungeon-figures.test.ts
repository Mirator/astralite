import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';
import { playerRunPose } from '../app/dungeon-run-pose.ts';

// A figure-by-figure fingerprint of the built THREE tree: every node's path, type, transform and mesh
// content. It is compared build against build rather than against a frozen fixture - the fixture it was
// first written for (plan 012) was rewritten by nearly every art change and caught nothing an intended
// change did not also trip. Neither builder draws from Math.random, so nothing needs stubbing.

const round = (n: number, decimals: number) => { const r = Number(n.toFixed(decimals)); return r === 0 ? 0 : r; }; // -0 -> 0
const V3 = (v: { x: number; y: number; z: number }, decimals = 4) => [round(v.x, decimals), round(v.y, decimals), round(v.z, decimals)];

type NodeRecord = {
  path: string;
  type: string;
  position: number[];
  quaternion: number[];
  scale: number[];
  visible: boolean;
  userDataKeys: string[];
  mesh?: {
    material: { type: string; color: number | null; emissive: number | null; side: number; flatShading: boolean };
    vertexCount: number;
    indexCount: number | null;
    boundingBox: { min: number[]; max: number[] };
    positionSum: number[];
  };
};

/** Walks a built figure in child order and reduces it to the fields plan 012 defines as the fingerprint. */
function fingerprint(root: THREE.Object3D): NodeRecord[] {
  const records: NodeRecord[] = [];
  const visit = (node: THREE.Object3D, path: string) => {
    const record: NodeRecord = {
      path,
      type: node.type,
      position: V3(node.position),
      quaternion: [round(node.quaternion.x, 4), round(node.quaternion.y, 4), round(node.quaternion.z, 4), round(node.quaternion.w, 4)],
      scale: V3(node.scale),
      visible: node.visible,
      userDataKeys: Object.keys(node.userData).sort(),
    };
    if (node instanceof THREE.Mesh) {
      const geometry = node.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const position = geometry.getAttribute('position');
      let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < position.count; i++) { sx += position.getX(i); sy += position.getY(i); sz += position.getZ(i); }
      const material = (Array.isArray(node.material) ? node.material[0] : node.material) as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; side: number; flatShading?: boolean };
      record.mesh = {
        material: {
          type: material.type,
          color: material.color ? material.color.getHex() : null,
          emissive: material.emissive ? material.emissive.getHex() : null,
          side: material.side,
          flatShading: !!material.flatShading,
        },
        vertexCount: position.count,
        indexCount: geometry.index ? geometry.index.count : null,
        boundingBox: { min: V3(box.min), max: V3(box.max) },
        positionSum: [round(sx, 3), round(sy, 3), round(sz, 3)],
      };
    }
    records.push(record);
    // A name in the path is only diagnostic where Stage A's code itself ever produced one: bakeStatic's
    // "baked:N" batches and the boot-to-sole swap's "boot" placeholder. Stage B's buildSpec (plan 012)
    // names every part and group on purpose - an agent can find "the knee", "the visor" or "the eye" by
    // name, which is the whole point of the part-list format - and that is true whether the named node
    // gets baked away, survives as a kept joint, or (like the eye sockets) survives unbaked as a plain
    // mesh. None of that is a change bakeStatic's own output ever goes through, so folding every one of
    // Stage B's new names into the comparison would fail the comparison on nearly every node without catching
    // anything a position/scale/type/mesh-content mismatch at the same index wouldn't already catch. Only
    // the two name shapes Stage A's own pipeline produces are compared; a real reordering still shows up
    // as a position, type or mesh-content difference at the same index regardless.
    const diagnosticName = (name: string) => /^baked:\d+$/.test(name) || name === 'boot';
    node.children.forEach((child, index) => visit(child, `${path}/${index}${diagnosticName(child.name) ? `:${child.name}` : ''}`));
  };
  visit(root, 'root');
  return records;
}

/** Compares two fingerprints and reports the figure and the exact path that first differs, not just "not equal". */
function assertSameFingerprint(figure: string, expected: NodeRecord[], actual: NodeRecord[]) {
  if (expected.length !== actual.length) {
    const expectedPaths = new Set(expected.map(r => r.path)), actualPaths = new Set(actual.map(r => r.path));
    const missing = expected.filter(r => !actualPaths.has(r.path)).map(r => r.path);
    const extra = actual.filter(r => !expectedPaths.has(r.path)).map(r => r.path);
    assert.fail(`figure '${figure}': node count differs (expected ${expected.length}, got ${actual.length}).\n  missing: ${missing.join(', ') || '(none)'}\n  extra: ${extra.join(', ') || '(none)'}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!, a = actual[i]!;
    assert.equal(a.path, e.path, `figure '${figure}': path at index ${i} differs (expected '${e.path}', got '${a.path}')`);
    assert.deepEqual(a, e, `figure '${figure}', path '${e.path}': fingerprint differs\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`);
  }
}

const FIGURES: Record<string, () => THREE.Object3D> = {
  knight: () => makeKnight(),
  guard: () => makeSkeleton('guard'),
  stalker: () => makeSkeleton('stalker'),
  warden: () => makeSkeleton('warden'),
  archer: () => makeSkeleton('archer'),
};

// dungeon-bake.ts caches baked geometry per cacheKey at module scope; a second build of the same figure
// hits that cache instead of remerging. The first build in this file is a fresh one, so this holds the
// cached path to exactly what a fresh bake produces - a bake that mutates shared source geometry in place,
// or a cache that hands back the wrong batch, shows up here and nowhere end to end.
for (const [name, build] of Object.entries(FIGURES)) {
  test(`${name} fingerprint is identical when built a second time (cached bake path)`, () => {
    const first = fingerprint(build());
    const second = fingerprint(build());
    assertSameFingerprint(`${name} (second build)`, first, second);
  });
}

// What `dungeonTest.actorStats()` reads off the live knight (dungeon-test-hooks.ts, which node cannot
// import): visible meshes walking visible nodes, triangles per draw range, and the height of everything
// but the multiply-blended contact pool, which lies on the floor. Restated so the budget holds without a
// browser. models.spec.ts, which held the same numbers off the running game, was deleted in 73ba0ad: this test
// is now the only place the knight's draw cost is held, and `dungeonTest.actorStats()` still reports the same
// numbers off the live knight for anyone checking by hand.
function drawCost(root: THREE.Object3D) {
  let meshes = 0, triangles = 0;
  const box = new THREE.Box3(), part = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  const walk = (o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry, n = g.index ? g.index.count : g.getAttribute('position').count;
      meshes++; triangles += Math.floor(Math.min(n, g.drawRange.count) / 3);
      if ((o.material as THREE.Material).blending !== THREE.MultiplyBlending) { if (!g.boundingBox) g.computeBoundingBox(); box.union(part.copy(g.boundingBox!).applyMatrix4(o.matrixWorld)); }
    }
    for (const child of o.children) if (child.visible) walk(child);
  };
  walk(root);
  return { meshes, triangles, height: box.max.y - box.min.y };
}

test('the knight is baked within his budgets and stands where he did', () => {
  // Plan 010's "before" (once also held by models.spec.ts, deleted in 73ba0ad).
  const BEFORE = { meshes: 53, triangles: 3990, height: 1.8243 };
  const knight = drawCost(makeKnight());
  // The Relic Seeker after plan 027 (2026-10-12, node): torso 4 batches (pale 76, red 100, the relic's leather
  // cord 12, relic 36 triangles), cloak 4 kept unbaked (poncho 128, trim 32, strap 72, cowl 128), head 2 (skin 224,
  // hair 200), satchel 2 (leather 216, brass 12), tabard 2, pivot 2, Tideblade 4, arm 1 and elbow 2, hips 2, knees 6,
  // pool 1 = 32 meshes, 1,808 triangles (before plan 027: 31 / 1,876). Floors on both: the triangle floor is what
  // catches a poncho that is not drawn (its 128 triangles take him to 1,680); the mesh floor catches a bake that
  // loses more than two batches.
  // Owner decision 2026-10-12: the player's budget doubled, 2 x 4,987 triangles and 2 x 32 meshes. A ceiling, not
  // a target: plan 027 spends it on motion (a kept poncho, head, satchel and elbow) and shape, not on added parts.
  assert.ok(knight.meshes <= 64, `the knight is drawn as ${knight.meshes} meshes`);
  assert.ok(knight.meshes >= 30, `the knight is drawn as only ${knight.meshes} meshes`);
  assert.ok(knight.triangles >= 1681, `the knight costs only ${knight.triangles} triangles`);
  // Owner decision for the model round: a figure's triangles may rise by at most a quarter (4,987); doubled for the
  // player alone on 2026-10-12 (plan 027).
  assert.ok(knight.triangles <= 2 * Math.floor(BEFORE.triangles * 1.25), `the knight costs ${knight.triangles} triangles against ${BEFORE.triangles}`);
  // The explorer stands where the knight did, within 0.08.
  assert.ok(Math.abs(knight.height - BEFORE.height) <= 0.08, `the knight stands ${knight.height.toFixed(4)} tall against ${BEFORE.height}`);
});

// Plan 027 Stage A: the Relic Seeker's proportions and his poncho, measured off the built tree. Everything
// these read is what the scene draws: the cloak's meshes are kept out of the bake by name, the head is its
// own baked group, the chin is a bare node at the face's lowest point, and the sash is the torso's red batch.
const relic = () => {
  const knight = makeKnight(); knight.position.y = .03; knight.updateWorldMatrix(true, true);
  const cloak = knight.userData.cloak as THREE.Group, torso = knight.userData.torso as THREE.Group;
  const named = (name: string) => cloak.children.find(child => child.name === name) as THREE.Mesh | undefined;
  const sash = torso.children.find(child => child instanceof THREE.Mesh && ((child.material as THREE.MeshStandardMaterial).color?.getHex() === 0x963f32)) as THREE.Mesh | undefined;
  return { knight, cloak, torso, poncho: named('poncho'), trim: named('poncho-trim'), cowl: named('cowl'), sash };
};
// The lathe's vertices column by column (seventeen columns: the last closes the seam on the first), each
// column's lowest world y. Grouped by index, not by angle: the baked front-to-back depth moves the angles.
const COLUMNS = 16;
function hemByColumn(poncho: THREE.Mesh) {
  const positions = poncho.geometry.getAttribute('position'), rings = positions.count / (COLUMNS + 1), low = Array<number>(COLUMNS).fill(Infinity), v = new THREE.Vector3();
  assert.ok(Number.isInteger(rings) && rings >= 3, `precondition: the poncho is a ${COLUMNS}-column lathe (${positions.count} vertices)`);
  for (let i = 0; i < positions.count; i++) { const column = Math.floor(i / rings) % COLUMNS; low[column] = Math.min(low[column]!, v.fromBufferAttribute(positions, i).applyMatrix4(poncho.matrixWorld).y); }
  return low;
}

test('the Relic Seeker stands on long legs under a poncho narrow enough for his head to lead (plan 027)', () => {
  const { knight, poncho, trim } = relic();
  assert.ok(poncho && trim, 'precondition: the poncho and its trim are found by name under userData.cloak');
  assert.ok(poncho.geometry.getAttribute('position').count >= 16 * 5, `precondition: the poncho has ${poncho.geometry.getAttribute('position').count} vertices, too few for a 16-column lathe`);
  const box = new THREE.Box3();
  knight.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && (o.material as THREE.Material).blending !== THREE.MultiplyBlending) box.union(new THREE.Box3().setFromObject(o, true)); });
  const height = box.max.y - box.min.y, hip = (knight.userData.legs[0] as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y;
  // Measured 2026-10-12 (node): hip pivot .78, sole .09, height 1.822, leg share .379; before plan 027 .263.
  assert.ok((hip - box.min.y) / height >= .36, `the legs are only ${((hip - box.min.y) / height).toFixed(3)} of his height`);
  // Poncho and trim reach x .392 (before: .47). The head's width (ears in) over the hem's: .494 (before: .412).
  const half = Math.max(...[poncho, trim].map(m => { const b = new THREE.Box3().setFromObject(m, true); return Math.max(b.max.x, -b.min.x); }));
  assert.ok(half <= .4, `the poncho spreads ${half.toFixed(3)} either side`);
  const head = new THREE.Box3().setFromObject(knight.userData.head as THREE.Object3D, true), ratio = (head.max.x - head.min.x) / (2 * half);
  assert.ok(ratio >= .47, `the head is only ${ratio.toFixed(3)} of the poncho's width`);
});

test('the poncho hangs one long point at the front and one at the back below the sash, its corners at the elbow (plan 027)', () => {
  const { poncho, sash } = relic();
  assert.ok(poncho && sash, 'precondition: the poncho and the sash batch are found');
  const low = hemByColumn(poncho), sashBottom = new THREE.Box3().setFromObject(sash, true).min.y;
  // Measured 2026-10-12 (node, standing at .03): front .78, back .80, diagonals .97, the sash's batch from .825.
  const within = (column: number, name: string, from: number, to: number) => assert.ok(low[column]! >= from && low[column]! <= to, `the ${name} (column ${column}) hangs to ${low[column]!.toFixed(3)}, outside ${from}-${to}`);
  within(8, 'front point', .74, .82); within(0, 'back point', .74, .84);
  for (const column of [2, 6, 10, 14]) within(column, 'diagonal corner', .92, 1);
  for (const column of [0, 8]) assert.ok(low[column]! < sashBottom, `column ${column}'s point ends at ${low[column]!.toFixed(3)}, not below the sash (${sashBottom.toFixed(3)})`);
});

test('the cowl sits low enough at the front for the chin and the throat to show (plan 027)', () => {
  const { knight, cowl } = relic(), chin = knight.userData.chin as THREE.Object3D | undefined;
  assert.ok(cowl && chin, 'precondition: the cowl mesh and the chin node are found');
  const positions = cowl.geometry.getAttribute('position'), v = new THREE.Vector3();
  let top = -Infinity, front = 0;
  for (let i = 0; i < positions.count; i++) { v.fromBufferAttribute(positions, i); if (v.z < 0) { front++; top = Math.max(top, v.applyMatrix4(cowl.matrixWorld).y); } }
  assert.ok(front > 0, 'precondition: the cowl has vertices in front of the neck');
  // Measured 2026-10-12: the cowl's front top 1.390 against the chin at 1.450 (before: .015 under).
  const gap = chin.getWorldPosition(new THREE.Vector3()).y - top;
  assert.ok(gap >= .05, `the cowl's front rises to ${gap.toFixed(3)} under the chin`);
});

// Plan 027 Stage B: the poncho's radius at a point's angle and height, read off the built lathe (torso-local,
// rest): the two columns either side of the angle, each ring to ring at that height. A column whose cloth does
// not reach that height (an arm slit, or below its hem) has no radius there; with neither, there is no cloth.
function ponchoRadiusAt(poncho: THREE.Mesh, point: THREE.Vector3): number | null {
  const positions = poncho.geometry.getAttribute('position'), rings = positions.count / (COLUMNS + 1);
  const columnAngle = (c: number) => { const a = Math.atan2(positions.getX(c * rings), positions.getZ(c * rings)); return c === COLUMNS ? 2 * Math.PI : (a + 2 * Math.PI) % (2 * Math.PI); };
  const at = (c: number) => {
    for (let k = 1; k < rings; k++) {
      const i = c * rings + k, y0 = positions.getY(i - 1), y1 = positions.getY(i), r0 = Math.hypot(positions.getX(i - 1), positions.getZ(i - 1)), r1 = Math.hypot(positions.getX(i), positions.getZ(i));
      if (point.y >= Math.min(y0, y1) && point.y <= Math.max(y0, y1)) return y1 === y0 ? Math.max(r0, r1) : r0 + (r1 - r0) * (point.y - y0) / (y1 - y0);
    }
    return null;
  };
  const angle = (Math.atan2(point.x, point.z) + 2 * Math.PI) % (2 * Math.PI);
  let c = 0; while (c < COLUMNS - 1 && columnAngle(c + 1) <= angle) c++;
  const a = at(c), b = at(c + 1);
  if (a === null && b === null) return null;
  if (a === null || b === null) return a ?? b;
  return a + (b - a) * (angle - columnAngle(c)) / (columnAngle(c + 1) - columnAngle(c));
}

test('both hands stay outside the poncho at rest, through the run and in a swing, and the sleeve leaves it through the slit (plan 027)', () => {
  const { knight, poncho, torso } = relic();
  assert.ok(poncho, 'precondition: the poncho is found');
  const arm = knight.userData.arm as THREE.Group, elbow = arm.userData.elbow as THREE.Group, sword = knight.userData.sword as THREE.Group;
  // The hands are the skin batches of the sword pivot (the glove) and of the elbow (the fist): their centres are drawn ones.
  const skin = (group: THREE.Object3D) => group.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.MeshStandardMaterial).color?.getHex() === 0xd29a74) as THREE.Mesh | undefined;
  const glove = skin(sword), fist = skin(elbow);
  assert.ok(glove && fist && elbow, 'precondition: the glove, the fist and the elbow joint are found');
  const poses: [string, number, number][] = [['rest', 0, 0], ['a swing', -.35, -.2]];
  for (let i = 0; i < 64; i++) { const pose = playerRunPose(i * Math.PI / 32, 8.5); poses.push([`the run at phase ${i}/64`, pose.arm, pose.elbow]); }
  assert.ok(poses.some(([, a]) => a > .5) && poses.some(([, a]) => a < -.3) && poses.some(([, , e]) => e < -.6), 'precondition: the run swings the arm both ways and opens the elbow');
  let closest = Infinity;
  for (const [name, armX, elbowX] of poses) {
    arm.rotation.x = armX; elbow.rotation.x = elbowX; knight.updateWorldMatrix(true, true);
    // The elbow joint at rest stands in the arm slit, which is what lets the sleeve out of the cloth; swinging
    // forward through the run it passes under the diagonal's edge (.009 outside at phase 12, node 2026-10-12),
    // which is the arm moving under the cloth, so it is held at rest only.
    const points: [string, THREE.Vector3][] = [['sword hand', new THREE.Box3().setFromObject(glove, true).getCenter(new THREE.Vector3())], ['free hand', new THREE.Box3().setFromObject(fist, true).getCenter(new THREE.Vector3())]];
    if (name === 'rest') points.push(['free elbow', elbow.getWorldPosition(new THREE.Vector3())]);
    for (const [part, point] of points) {
      const local = torso.worldToLocal(point.clone()), cloth = ponchoRadiusAt(poncho, local);
      if (cloth === null) continue;
      const margin = Math.hypot(local.x, local.z) - cloth; closest = Math.min(closest, margin);
      assert.ok(margin >= .03, `in ${name} the ${part} is ${margin.toFixed(3)} outside the poncho`);
    }
  }
  assert.ok(Number.isFinite(closest), 'precondition: some hand stood where the poncho hangs, or nothing was checked');
});
