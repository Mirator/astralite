import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight, SWORD_CARRY } from '../app/dungeon-knight.ts';
import { makeWeapon } from '../app/dungeon-armory.ts';
import { WEAPONS, type WeaponId } from '../app/dungeon-weapon.ts';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';
import { playerRunPose } from '../app/dungeon-run-pose.ts';
import { CAMERA_OFFSET } from '../app/dungeon-aim.ts';

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
  // The Relic Seeker after plan 030 (2026-10-12, node): torso 5 batches (pale, red, leather, brass, relic), cloak 4 kept
  // unbaked (poncho 512 triangles, trim 400, strap 62, cowl and hood 384), head 4 (skin, wrap, hair, hairtip), satchel 2,
  // tabard 3 (pale, red, the rope's boot), pivot 3 (skin, wrap, teal) and the Tideblade 4, arm 1 and elbow 3, hips 2,
  // knees 8, pool 1: 40 meshes, 4,360 triangles (plan 027: 32 / 1,808). Round 2 (2026-10-12): the knees take the boots'
  // darker leather (the ankle strap and the sole), 10 batches, and the hood is a closed bag: 42 meshes, 4,708 triangles.
  // Floors on both: the triangle floor is what catches
  // a poncho that is not drawn (its 512 triangles take him to 4,196 in round 2, so the floor rose from 3,900 to 4,400); the mesh floor catches a bake that loses more than
  // two batches.
  // Owner decision 2026-10-12: x5. The player's budget is five times the owner's model-round figure (a figure's triangles
  // may rise by a quarter, 4,987): 320 meshes and 49,875 triangles. A ceiling, not a target: every mesh is two draw calls
  // in every scene (frame-budget.spec.ts and hall.spec.ts hold those), so plan 030 spent triangles on shape and kept the
  // meshes near fifty.
  assert.ok(knight.meshes <= 320, `the knight is drawn as ${knight.meshes} meshes`);
  assert.ok(knight.meshes >= 40, `the knight is drawn as only ${knight.meshes} meshes`);
  // Round 3 (2026-10-13, node): 42 meshes, 5,036 triangles - the same batches; a finer cowl (32 columns), a ragged skirt and
  // flap, fuller sleeves and diagonal wraps. A hidden poncho takes him to 4,524, so the floor rose from 4,400 to 4,700.
  // Round 4 (2026-10-13, node): 42 meshes (the sash's tails on their own joint take the tabard's red batch with them),
  // 5,118 triangles - a smooth cowl of 24 columns with two folds across the chest, a finer face. A hidden poncho takes
  // him to 4,606, still under the floor.
  // Round 5 (2026-10-13, node): 43 meshes (the face's shaded planes, a new 'shade' batch on the head), 5,210 triangles - a
  // cowl and hood of 24 columns by 9, a mop of 34 locks, turned-over boot cuffs. A hidden poncho takes him to 4,698, so the
  // floor rises from 4,700 to 4,900.
  assert.ok(knight.triangles >= 4900, `the knight costs only ${knight.triangles} triangles`);
  assert.ok(knight.triangles <= 5 * Math.floor(BEFORE.triangles * 1.25), `the knight costs ${knight.triangles} triangles against ${BEFORE.triangles}`);
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
  const sash = torso.children.find(child => child instanceof THREE.Mesh && (child.material as THREE.Material).name === 'red') as THREE.Mesh | undefined;
  return { knight, cloak, torso, poncho: named('poncho'), trim: named('poncho-trim'), cowl: named('cowl'), strap: named('strap'), sash };
};
// The lathe's vertices column by column (seventeen columns: the last closes the seam on the first), each
// column's lowest world y. Grouped by index, not by angle: the baked front-to-back depth moves the angles.
// Plan 030: 32 columns (16 before), so each point and notch is one column's V.
const COLUMNS = 32;
function hemByColumn(poncho: THREE.Mesh, leastRings = 3) {
  const positions = poncho.geometry.getAttribute('position'), rings = positions.count / (COLUMNS + 1), low = Array<number>(COLUMNS).fill(Infinity), v = new THREE.Vector3();
  assert.ok(Number.isInteger(rings) && rings >= leastRings, `precondition: ${poncho.name} is a ${COLUMNS}-column lathe (${positions.count} vertices)`);
  for (let i = 0; i < positions.count; i++) { const column = Math.floor(i / rings) % COLUMNS; low[column] = Math.min(low[column]!, v.fromBufferAttribute(positions, i).applyMatrix4(poncho.matrixWorld).y); }
  return low;
}

test('the Relic Seeker is drawn to the sheet\'s proportions: a small head, legs half his height, a poncho wider than both (plan 030)', () => {
  const { knight, poncho, trim } = relic(), chin = knight.userData.chin as THREE.Object3D | undefined, arm = knight.userData.arm as THREE.Object3D | undefined;
  assert.ok(poncho && trim && chin && arm, 'precondition: the poncho, its trim, the chin and the free arm are found');
  const box = new THREE.Box3();
  knight.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && (o.material as THREE.Material).blending !== THREE.MultiplyBlending) box.union(new THREE.Box3().setFromObject(o, true)); });
  const height = box.max.y - box.min.y, up = (o: THREE.Object3D) => (o.getWorldPosition(new THREE.Vector3()).y - box.min.y) / height;
  // Owner directive (plan 030): match the sheet. Its front view, sole to the top of the hair 655 px: the hip joint .47 of
  // his height up, the shoulders .75, the head (chin to hair) .145 of it - seven heads. Measured 2026-10-12 (node): hip
  // joints .472, shoulders .730, head .159 (height 1.822). Plan 027 held only a floor of .36 under the legs, and
  // its head was .25 of his height: the critic's "stubby child".
  const legs = up(knight.userData.legs[0] as THREE.Object3D), shoulders = up(arm), head = 1 - up(chin);
  assert.ok(legs >= .44 && legs <= .52, `the hip joints stand ${legs.toFixed(3)} of his height up, against the sheet's .47`);
  assert.ok(shoulders >= .7 && shoulders <= .79, `the shoulders stand ${shoulders.toFixed(3)} of his height up, against the sheet's .75`);
  // Round 4 (the critic counted five and a half heads; owner directive: match the sheet): the head and its hair .92 of
  // round 3's on a neck .02 longer, the thigh .015 longer. Measured 2026-10-13 (node, height 1.811): hip joints .488,
  // shoulders .750, head .151 (round 3: .472, .730, .159). The head's ceiling comes down from .19 to .16: round 3's head fails it.
  assert.ok(head >= .13 && head <= .16, `the head is ${head.toFixed(3)} of his height, against the sheet's .145`);
  // The poncho is the broad shape, about .43 of his height across on the sheet; the head (hair and ears in) about .3 of
  // its width. Measured: half-width half-width .389, head over poncho .298 (plan 027 held the head at .47 or more).
  const half = Math.max(...[poncho, trim].map(m => { const b = new THREE.Box3().setFromObject(m, true); return Math.max(b.max.x, -b.min.x); }));
  assert.ok(half >= .36 && half <= .43, `the poncho spreads ${half.toFixed(3)} either side`);
  const skull = new THREE.Box3().setFromObject(knight.userData.head as THREE.Object3D, true), ratio = (skull.max.x - skull.min.x) / (2 * half);
  // Plan 030 round 2 (owner directive: match the sheet): the sheet's tousled hair stands out past the face, about .14 to
  // .16 of his height across against a poncho .40 to .43 across, so the head is .35 to .38 of the poncho's width, not .3.
  // Round 1's helmet of hair measured .298; round 2's .370 (node, 2026-10-12).
  assert.ok(ratio >= .3 && ratio <= .42, `the head is ${ratio.toFixed(3)} of the poncho's width, against the sheet's .35-.38`);
});

// Columns from his back towards his right, 11.25 degrees apart: 0 his back, 8 his right, 16 his front, 24 his left.
// Plan 030 round 2: the side points (tails) are at 123.75 degrees from his front, columns 5 and 27.
const BACK = 0, FRONT = 16, SIDES = [5, 27], NOTCHES = [8, 24];
// The sash's lower edge behind him (torso-local z over .1): the knot, the relic and its tassel hang at his front.
const sashBackBottom = (sash: THREE.Mesh) => {
  const at = sash.geometry.getAttribute('position'), v = new THREE.Vector3(); let low = Infinity, behind = 0;
  for (let i = 0; i < at.count; i++) if (at.getZ(i) > .1) { behind++; low = Math.min(low, v.fromBufferAttribute(at, i).applyMatrix4(sash.matrixWorld).y); }
  assert.ok(behind >= 8, `precondition: the sash has ${behind} vertices behind him`);
  return low;
};
test('the poncho hangs to four points - front, back and one at each side behind the arm - with high notches where the arms come out (plan 030)', () => {
  const { poncho, sash } = relic();
  assert.ok(poncho && sash, 'precondition: the poncho and the sash batch are found');
  const low = hemByColumn(poncho), sashBottom = sashBackBottom(sash);
  // Owner directive (plan 030): match the sheet. Round 2 measured the sheet itself (front, profile and back views, as
  // shares of his height from the sole): a shallow front point at .60, the sides at the elbow .65, a long tail behind each
  // arm to .465 (the profile's back drape), a shallow back point at .50. Round 1 had the front at .52, the back at .40
  // (the critic's "deep V to the crotch") and the tails at .46. Measured 2026-10-12 (node, standing at .03, height 1.85):
  // front point 1.188, back .997, side points .942, arm notches 1.283, the sash's back edge 1.095.
  const within = (column: number, name: string, from: number, to: number) => assert.ok(low[column]! >= from && low[column]! <= to, `the ${name} (column ${column}) hangs to ${low[column]!.toFixed(3)}, outside ${from}-${to}`);
  // Round 3 (owner directive: match the sheet): the critic read round 2's hem as a flat line at the sash. Read again
  // against the sheet's front and back views, the poncho is a steep diamond: the sides high over the arms at .68, the
  // edges falling straight into a front point at .57 and a back point at .52, the tails where round 2 had them. Measured
  // 2026-10-13 (node, standing at .03, height 1.81): front 1.134, back 1.042, side points .942, arm notches 1.335.
  // Round 4 (owner directive: match the sheet; the orchestrator: settle the points off the sheet, not the critics): the
  // sheet's outer drape behind the arms measured again in its front, profile and back views hangs to .41-.44 of his height
  // (scratch ochre.py, 2026-10-13), round 2's .465 was read off the profile alone. Measured 2026-10-13 (node, standing at
  // .03, height 1.79): side points .870 (.44), front 1.134, back 1.055, notches 1.335. Round 3's tails (.942) fail here.
  within(FRONT, 'front point', 1.1, 1.17); within(BACK, 'back point', .99, 1.08);
  for (const column of SIDES) within(column, 'side point', .84, .91);
  for (const column of NOTCHES) within(column, 'arm notch', 1.3, 1.37);
  // The back point hangs below the sash; the front ends above it, as the sheet's does.
  assert.ok(low[BACK]! < sashBottom, `the back point ends at ${low[BACK]!.toFixed(3)}, not below the sash (${sashBottom.toFixed(3)})`);
  for (const [notch, side] of [[NOTCHES[0]!, SIDES[0]!], [NOTCHES[1]!, SIDES[1]!]]) assert.ok(low[notch]! - low[side]! >= .25, `the arm notch (column ${notch}) is only ${(low[notch]! - low[side]!).toFixed(3)} over the side point`);
});

test('the cowl sits low enough at the front for the chin and the throat to show (plan 027)', () => {
  const { knight, cowl } = relic(), chin = knight.userData.chin as THREE.Object3D | undefined;
  assert.ok(cowl && chin, 'precondition: the cowl mesh and the chin node are found');
  const positions = cowl.geometry.getAttribute('position'), v = new THREE.Vector3();
  let top = -Infinity, front = 0;
  // Plan 030: only the cowl in front of the chin (within .07 of the middle). The sheet's cowl rises to the jaw at the
  // sides and gathers up the back of the head, so the old reading of everything in front of the neck read the sides.
  for (let i = 0; i < positions.count; i++) { v.fromBufferAttribute(positions, i); if (v.z < 0 && Math.abs(v.x) < .07) { front++; top = Math.max(top, v.applyMatrix4(cowl.matrixWorld).y); } }
  assert.ok(front > 0, 'precondition: the cowl has vertices in front of the chin');
  // Measured 2026-10-12: plan 027's cowl front top 1.390 against the chin at 1.450; plan 030's .058 under it.
  const gap = chin.getWorldPosition(new THREE.Vector3()).y - top;
  assert.ok(gap >= .05, `the cowl's front rises to ${gap.toFixed(3)} under the chin`);
});

test('each point of the poncho ends in one point, not a blunt step three columns wide (plan 028)', () => {
  const { poncho } = relic();
  assert.ok(poncho, 'precondition: the poncho is found');
  const low = hemByColumn(poncho);
  // Plan 028 read the neighbours a column (22.5 degrees) away: plan 027's hem left the front's .09 above its point and the
  // back's .08, so each point read as a rounded step three columns wide from the game camera. Plan 030 has 32 columns,
  // so the same 22.5 degrees is two columns either side. Measured 2026-10-12 (node): the front .107 under the columns either side, the back .155, the side points .205.
  // Plan 030 round 2 (owner directive: match the sheet): the sheet's front and back points are shallow - the hem falls
  // about .02 of his height over the 22.5 degrees either side of each, where the tails behind the arms are sharp - so
  // those two are held to .035 and the tails still to .1. Measured 2026-10-12 (node): front .051, back .064, tails .164.
  for (const [point, name, least] of [[FRONT, 'front', .035], [BACK, 'back', .035], [SIDES[0]!, 'right side', .1], [SIDES[1]!, 'left side', .1]] as const) {
    const either = [(point + 2) % COLUMNS, (point + COLUMNS - 2) % COLUMNS], gap = Math.min(...either.map(c => low[c]!)) - low[point]!;
    assert.ok(gap >= least, `the ${name} point (column ${point}) hangs only ${gap.toFixed(3)} below the columns 22.5 degrees either side`);
  }
});

// The game camera looks down CAMERA_OFFSET; screen-up is world up with the view direction taken out of it.
const VIEW = new THREE.Vector3(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z).normalize();
const SCREEN_UP = new THREE.Vector3(0, 1, 0).addScaledVector(VIEW, -VIEW.y).normalize();

// The trim's two strips, as trimGeometry() in dungeon-knight.ts lays them: the edge band, 4 x COLUMNS + 1 pairs of
// vertices (its foot on the hem, its top up the cloth), then the zigzag, 2 x TEETH + 1 pairs.
const EDGE_PAIRS = 4 * COLUMNS + 1;
test('the trim is a cream edge along the hem and a zigzag band inset above it, the edge standing tall enough to read from the game camera (plan 030)', () => {
  const { knight, poncho, trim } = relic();
  assert.ok(poncho && trim, 'precondition: the poncho and the trim are found');
  const positions = trim.geometry.getAttribute('position'), pairs = positions.count / 2, v = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(trim.matrixWorld);
  assert.ok(Number.isInteger(pairs) && pairs > EDGE_PAIRS + 20, `precondition: the trim is two strips (${positions.count} vertices)`);
  // The edge: its foot on the hem, within .01 of the poncho's lowest point at that angle, all the way round.
  const hem = hemByColumn(poncho), angle = (p: THREE.Vector3) => (Math.atan2(p.x - knight.position.x, p.z - knight.position.z) + 2 * Math.PI) % (2 * Math.PI);
  const edge = Array.from({ length: EDGE_PAIRS }, (_, k) => ({ foot: v(2 * k), top: v(2 * k + 1) }));
  for (let c = 0; c < COLUMNS; c++) {
    const foot = edge[4 * c]!.foot;
    assert.ok(Math.abs(foot.y - hem[c]!) <= .01, `the edge's foot on column ${c} is ${(foot.y - hem[c]!).toFixed(3)} from the hem`);
  }
  // Seen down the game camera, the edge stands as a band where it faces the camera. Plan 028 held its one band to .069
  // (4 px at the 720 p framing, 12.38 world units tall); the sheet's edge is a thin one with the zigzag above it, two
  // pale bands rather than one, and plan 030 holds the edge alone at 2 px. Measured 2026-10-12 (node): .036 at its
  // thinnest over the 48 samples facing the camera.
  let facing = 0, thinnest = Infinity;
  for (const { foot, top } of edge) {
    if (new THREE.Vector3(foot.x - knight.position.x, 0, foot.z - knight.position.z).normalize().dot(VIEW) < .3) continue;
    facing++; thinnest = Math.min(thinnest, top.dot(SCREEN_UP) - foot.dot(SCREEN_UP));
  }
  assert.ok(facing >= 12, 'precondition: some of the edge faces the camera');
  assert.ok(thinnest >= .033, `the edge band is only ${thinnest.toFixed(3)} tall on screen where it faces the camera`);
  // The zigzag: each tooth's foot, measured up from the edge's foot at its angle, alternates low and high round him.
  const footAt = (a: number) => { let best = edge[0]!.foot, gap = Infinity; for (const { foot } of edge) { const d = Math.abs(((angle(foot) - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < gap) { gap = d; best = foot; } } return best.y; };
  const rises = Array.from({ length: pairs - EDGE_PAIRS }, (_, k) => { const p = v(2 * (EDGE_PAIRS + k)); return p.y - footAt(angle(p)); });
  let zigs = 0; for (let k = 1; k < rises.length; k++) if (Math.abs(rises[k]! - rises[k - 1]!) >= .025) zigs++;
  assert.ok(zigs >= .8 * (rises.length - 1), `only ${zigs} of the zigzag's ${rises.length - 1} runs rise or fall by .025`);
  assert.ok(Math.min(...rises) >= .045, `the zigzag comes down to ${Math.min(...rises).toFixed(3)} over the hem, onto the edge band`);
});

test('the strap crosses his front as a steep diagonal, not a belt (plan 028)', () => {
  const { strap } = relic();
  assert.ok(strap, 'precondition: the strap is found');
  // Its front run, torso-local (the strap is not posed, so its geometry is in the torso's metres): every vertex in
  // front of the chest, less the last eight, which are the drop off the hem onto the satchel.
  const positions = strap.geometry.getAttribute('position'), xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < positions.count - 8; i++) if (positions.getZ(i) < -.05) { xs.push(positions.getX(i)); ys.push(positions.getY(i)); }
  assert.ok(xs.length >= 6, `precondition: the strap has ${xs.length} vertices across his front`);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i]! - my); sxx += (x - mx) ** 2; });
  // Measured 2026-10-12 (node): plan 027's strap ran at 23.7 degrees, which the camera's pitch flattened into a belt.
  const degrees = Math.atan(Math.abs(sxy / sxx)) * 180 / Math.PI;
  assert.ok(degrees >= 40, `the strap crosses his front at only ${degrees.toFixed(1)} degrees`);
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

test('both hands and the free wrist stay clear of the poncho at rest, through the run and in a swing, and the free arm leaves it at the elbow (plan 030)', () => {
  const { knight, poncho, torso } = relic();
  assert.ok(poncho, 'precondition: the poncho is found');
  const arm = knight.userData.arm as THREE.Group, elbow = arm.userData.elbow as THREE.Group, sword = knight.userData.sword as THREE.Group;
  const batch = (group: THREE.Object3D, material: string) => group.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === material) as THREE.Mesh | undefined;
  const skin = batch(elbow, 'skin'), wrap = batch(elbow, 'wrap');
  assert.ok(skin && wrap, 'precondition: the free forearm\'s skin and wrist wrap batches are found');
  // The free hand is the skin below the wrist wrap's lowest point, off the drawn batches (elbow-local): its centre.
  const wrapBottom = new THREE.Box3().setFromBufferAttribute(wrap.geometry.getAttribute('position') as THREE.BufferAttribute).min.y;
  const skinAt = skin.geometry.getAttribute('position'), hand = new THREE.Vector3(); let count = 0;
  for (let i = 0; i < skinAt.count; i++) if (skinAt.getY(i) < wrapBottom) { hand.add(new THREE.Vector3().fromBufferAttribute(skinAt, i)); count++; }
  assert.ok(count >= 6, 'precondition: the free hand hangs below its wrist wrap');
  hand.divideScalar(count);
  const wrist = new THREE.Box3().setFromBufferAttribute(wrap.geometry.getAttribute('position') as THREE.BufferAttribute).getCenter(new THREE.Vector3());
  // Plan 030: the elbow flexes forward from straight (it was a square bend opened down); in a swing the game brings the
  // arm forward to .2 and bends the elbow to .6 (dungeon-game.tsx).
  const poses: [string, number, number][] = [['rest', 0, 0], ['a swing', .2, .6]];
  for (let i = 0; i < 64; i++) { const pose = playerRunPose(i * Math.PI / 32, 8.5); poses.push([`the run at phase ${i}/64`, pose.arm, pose.elbow]); }
  assert.ok(poses.some(([, a]) => a > .5) && poses.some(([, a]) => a < -.4) && poses.some(([, , e]) => e > .9), 'precondition: the run swings the arm both ways and bends the elbow');
  let covered = 0, below = 0;
  const hem = hemByColumn(poncho), hemAt = (local: THREE.Vector3) => { const c = Math.round(((Math.atan2(local.x, local.z) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI / COLUMNS)) % COLUMNS; return torso.worldToLocal(new THREE.Vector3(0, hem[c]!, 0)).y; };
  for (const [name, armX, elbowX] of poses) {
    arm.rotation.x = armX; elbow.rotation.x = elbowX; knight.updateWorldMatrix(true, true);
    // The sword hand is the pivot itself, the grip the hand closes on.
    const points: [string, THREE.Vector3, number][] = [['sword hand', sword.getWorldPosition(new THREE.Vector3()), .03], ['free hand', elbow.localToWorld(hand.clone()), .03], ['free wrist', elbow.localToWorld(wrist.clone()), .02]];
    for (const [part, point, room] of points) {
      const local = torso.worldToLocal(point.clone()), cloth = ponchoRadiusAt(poncho, local);
      // No cloth at its height and angle: the point hangs below the hem there (a hand is never above the neck).
      if (cloth === null) { assert.ok(local.y < hemAt(local) + .01, `in ${name} the ${part} has no cloth round it at ${local.y.toFixed(3)}, yet stands above the hem`); below++; continue; }
      covered++;
      const margin = Math.hypot(local.x, local.z) - cloth;
      assert.ok(margin >= room, `in ${name} the ${part} is ${margin.toFixed(3)} outside the poncho`);
    }
  }
  // Plan 030 round 2 (owner directive: match the sheet): the sheet's poncho ends at the elbows, so the hands and wrists
  // hang below it - round 1's 30 checks against cloth (of 198) are now none. Every point is still checked: under its hem
  // or outside its cloth. Measured 2026-10-12 (node): 198 below the hem, 0 beside cloth.
  assert.equal(covered + below, poses.length * 3, 'precondition: every hand and wrist point was checked');
  // And the arms come out from under it at the elbow, as the sheet's do: standing, the free elbow joint hangs below the
  // poncho's hem at its own column and the columns either side (11.25 degrees), so the rolled sleeve, the forearm and the
  // wrist wrap are in the open rather than behind a point of cloth. Round 1's side point fell steeply from the notch, so
  // the column behind its elbow hung .09 below the joint (the critic: "arms disappear under the cloth"). Measured
  // 2026-10-12 (node): .049 below the lowest of the three.
  arm.rotation.x = 0; elbow.rotation.x = 0; knight.updateWorldMatrix(true, true);
  const joint = torso.worldToLocal(elbow.getWorldPosition(new THREE.Vector3())), column = Math.round(((Math.atan2(joint.x, joint.z) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI / COLUMNS));
  const clear = Math.min(...[-1, 0, 1].map(d => torso.worldToLocal(new THREE.Vector3(0, hem[(column + d + COLUMNS) % COLUMNS]!, 0)).y)) - joint.y;
  assert.ok(clear >= .03, `standing, the free elbow is only ${clear.toFixed(3)} below the poncho's hem beside it`);
});

test('the free upper arm stays under the poncho through the run, rather than coming through its front (plan 030)', () => {
  const { knight, poncho, torso } = relic();
  assert.ok(poncho, 'precondition: the poncho is found');
  const arm = knight.userData.arm as THREE.Group, elbow = arm.userData.elbow as THREE.Group;
  const sleeve = arm.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === 'pale') as THREE.Mesh | undefined;
  assert.ok(sleeve, 'precondition: the sleeve batch is found');
  // The sleeve's girth, off its drawn batch, above the rolled cuff (which hangs below the cloth): arm-local, from the
  // shoulder down to the elbow's height less .06.
  const at = sleeve.geometry.getAttribute('position'), cuffTop = elbow.position.y + .06; let girth = 0;
  for (let i = 0; i < at.count; i++) if (at.getY(i) > cuffTop) girth = Math.max(girth, Math.hypot(at.getX(i), at.getZ(i)));
  assert.ok(girth > .03, `precondition: the sleeve is ${girth.toFixed(3)} thick`);
  const cloth = new THREE.Mesh(poncho.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster();
  let tightest = Infinity, checked = 0;
  for (let i = 0; i < 64; i++) {
    arm.rotation.x = playerRunPose(i * Math.PI / 32, 8.5).arm; knight.updateWorldMatrix(true, true);
    for (let s = 0; s <= 8; s++) {
      const p = torso.worldToLocal(arm.localToWorld(new THREE.Vector3(0, cuffTop * s / 8, 0)));
      ray.set(new THREE.Vector3(0, p.y, 0), new THREE.Vector3(p.x, 0, p.z).normalize());
      const hits = ray.intersectObject(cloth);
      if (!hits.length) continue;
      checked++; tightest = Math.min(tightest, hits[hits.length - 1]!.distance - Math.hypot(p.x, p.z) - girth);
    }
  }
  arm.rotation.x = 0;
  assert.ok(checked > 300, `precondition: only ${checked} points of the upper arm were under cloth`);
  // Measured 2026-10-12 (node): .024 inside the cloth at its tightest, 572 points checked (the run swings it .56 forward at most); plan 027's swing (.88 forward)
  // put the sleeve .019 through the front of plan 030's poncho. A centimetre of slack for the flat facets.
  assert.ok(tightest >= -.01, `the upper arm comes ${(-tightest).toFixed(3)} through the poncho in the run`);
});

test('the trim lies on the cloth, edge and zigzag both (plan 030)', () => {
  const { poncho, trim } = relic();
  assert.ok(poncho && trim, 'precondition: the poncho and the trim are found');
  // From the torso's axis straight out through each trim vertex (torso-local; neither mesh is posed) on to the poncho as
  // built: the vertex must stand outside the cloth it lies on, and not far off it. Plan 027's rigid ring stood .073 proud
  // of the yoke at each arm slit; a band tucked under the cloth is not seen.
  const cloth = new THREE.Mesh(poncho.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster(), positions = trim.geometry.getAttribute('position');
  let checked = 0;
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i), out = new THREE.Vector3(p.x, 0, p.z).normalize();
    ray.set(new THREE.Vector3(0, p.y, 0), out);
    const hits = ray.intersectObject(cloth);
    if (!hits.length) continue;
    checked++;
    const off = Math.hypot(p.x, p.z) - hits[hits.length - 1]!.distance;
    assert.ok(off >= 0 && off <= .03, `trim vertex ${i} stands ${off.toFixed(3)} off the cloth at height ${p.y.toFixed(3)}`);
  }
  // Measured 2026-10-12 (node): 344 of the 404 vertices over cloth, none more than .018 off it.
  assert.ok(checked >= .8 * positions.count, `precondition: only ${checked} of ${positions.count} trim vertices sit where the cloth hangs`);
});

test('the strap ends on the cloth and drops to the bag rather than running level round his waist (plan 028)', () => {
  const { strap, poncho, torso } = relic();
  assert.ok(strap && poncho, 'precondition: the strap and the poncho are found');
  const positions = strap.geometry.getAttribute('position'), at = (pair: number) => new THREE.Vector3().fromBufferAttribute(positions, 2 * pair).add(new THREE.Vector3().fromBufferAttribute(positions, 2 * pair + 1)).multiplyScalar(.5);
  // Its last four point pairs are the drop onto the bag (strap() in dungeon-knight.ts); the pair before them is where it leaves the cloth.
  const pairs = positions.count / 2, leaves = at(pairs - 5), bag = at(pairs - 1);
  const off = torso.worldToLocal(leaves.clone().applyMatrix4(strap.matrixWorld)), cloth = ponchoRadiusAt(poncho, off);
  assert.ok(cloth !== null, `the strap leaves the poncho at height ${off.y.toFixed(3)}, below its hem`);
  // Measured 2026-10-12 (node): plan 028's first cut ran the tail at 3 degrees, level round the waist beside the sash.
  const drop = Math.atan2(leaves.y - bag.y, Math.hypot(bag.x - leaves.x, bag.z - leaves.z)) * 180 / Math.PI;
  assert.ok(drop >= 20, `the strap's tail falls only ${drop.toFixed(1)} degrees from the hem to the bag`);
});

test('the satchel hangs clear of the right thigh, standing and through a run (plan 028)', () => {
  const { knight } = relic();
  const satchel = knight.userData.satchel as THREE.Group, hip = (knight.userData.legs as THREE.Group[])[1]!;
  const named = (group: THREE.Object3D, material: string) => group.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === material) as THREE.Mesh | undefined;
  const bag = named(satchel, 'leather'), thigh = named(hip, 'trousers');
  assert.ok(bag && thigh, 'precondition: the satchel\'s leather and the right thigh are found');
  bag.geometry.computeBoundingBox(); thigh.geometry.computeBoundingBox();
  const bagBox = bag.geometry.boundingBox!, thighBox = thigh.geometry.boundingBox!, p = new THREE.Vector3(), toBag = new THREE.Matrix4();
  const poses: [string, number][] = [['standing', 0]];
  for (let i = 0; i < 64; i++) poses.push([`the run at phase ${i}/64`, playerRunPose(i * Math.PI / 32, 8.5).legs[1]!.hip]);
  let nearest = Infinity;
  for (const [name, swing] of poses) {
    hip.rotation.x = swing; knight.updateWorldMatrix(true, true); toBag.copy(bag.matrixWorld).invert();
    let inside = 0;
    // The thigh's own batch, sampled through its volume on a 9 x 9 x 9 grid, in the bag's frame.
    for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) for (let c = 0; c < 9; c++) {
      p.set(THREE.MathUtils.lerp(thighBox.min.x, thighBox.max.x, a / 8), THREE.MathUtils.lerp(thighBox.min.y, thighBox.max.y, b / 8), THREE.MathUtils.lerp(thighBox.min.z, thighBox.max.z, c / 8)).applyMatrix4(thigh.matrixWorld).applyMatrix4(toBag);
      if (bagBox.containsPoint(p)) inside++;
      nearest = Math.min(nearest, bagBox.distanceToPoint(p));
    }
    // Measured 2026-10-12 (node): plan 028's first cut put 225 of the 729 samples inside the bag (main: 81).
    assert.equal(inside, 0, `${name}: ${inside} of 729 points of the right thigh are inside the satchel`);
  }
  hip.rotation.x = 0;
  assert.ok(nearest < .08, `precondition: the satchel no longer hangs at his hip (it comes within ${nearest.toFixed(3)} of the thigh)`);
});

// Plan 030 round 3: the drawn figure sliced across at a share of his height, as the sheet was measured (every triangle
// of every mesh but the weapon, the satchel and its strap, cut by the plane): its extent across (x, the sheet's back view)
// or front to back (z, its profile), as a share of his height.
function sliceWidth(knight: THREE.Object3D, share: number, axis: 'x' | 'z') {
  const skip = new Set<THREE.Object3D>(); (knight.userData.armed.group as THREE.Object3D).traverse(o => skip.add(o)); (knight.userData.satchel as THREE.Object3D).traverse(o => skip.add(o));
  const tris: THREE.Vector3[][] = [], box = new THREE.Box3();
  knight.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip.has(o) || o.name === 'strap' || (o.material as THREE.Material).blending === THREE.MultiplyBlending) return;
    const p = o.geometry.getAttribute('position'), index = o.geometry.index, at = (i: number) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < (index ? index.count : p.count); i += 3) { const t = [0, 1, 2].map(k => at(index ? index.getX(i + k) : i + k)); t.forEach(v => box.expandByPoint(v)); tris.push(t); }
  });
  const height = box.max.y - box.min.y, y = box.min.y + share * height; let lo = Infinity, hi = -Infinity;
  for (const t of tris) for (let e = 0; e < 3; e++) {
    const a = t[e]!, b = t[(e + 1) % 3]!; if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const v = a[axis] + (b[axis] - a[axis]) * (y - a.y) / (b.y - a.y); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return (hi - lo) / height;
}

test('the Relic Seeker\'s shoulders, cape and profile are cut to the sheet\'s slices (plan 030 round 3)', () => {
  const { knight } = relic();
  // Owner directive (plan 030): match the sheet. Its back view sliced the same way (scratch sheetw.py, 2026-10-13): .304
  // of his height across the shoulders at .75 up, the cape spreading over the arms to .395 at .65; its profile .173 deep
  // at .70 up. Round 2 measured .353, .375 and .227 (the critic: hunched, boxy, the cape not spreading); round 3 .322,
  // .382 and .184 (node, 2026-10-13).
  const shoulders = sliceWidth(knight, .75, 'x'), cape = sliceWidth(knight, .65, 'x'), depth = sliceWidth(knight, .7, 'z');
  assert.ok(shoulders >= .27 && shoulders <= .34, `the shoulders are ${shoulders.toFixed(3)} of his height across, against the sheet's .304`);
  assert.ok(cape >= .36 && cape <= .43, `the cape spreads ${cape.toFixed(3)} of his height across, against the sheet's .395`);
  assert.ok(cape - shoulders >= .04, `the cape spreads only ${(cape - shoulders).toFixed(3)} wider than the shoulders`);
  assert.ok(depth >= .14 && depth <= .21, `in profile he is ${depth.toFixed(3)} of his height deep at the chest, against the sheet's .173`);
});

test('the poncho spreads to corners at the elbows and falls straight below them, not into a bell (plan 030 round 5)', () => {
  // The orchestrator: the sheet's poncho spreads out over the arms past the elbows, where round 4's hugged the body like a
  // narrow shawl and kept widening below the arms into a bell. The sheet's back view sliced (scratch hood.py, 2026-10-13):
  // .29 of his height across at .75 up, .395 at the elbows' corners (.69), narrowing below them. Round 4 measured .370 at .70
  // and .403 at .55 (node, 2026-10-13); round 5 .399 and .385.
  const { knight } = relic(), corners = sliceWidth(knight, .7, 'x'), below = sliceWidth(knight, .55, 'x');
  assert.ok(corners >= .385, `the poncho is only ${corners.toFixed(3)} of his height across at the elbows, against the sheet's .395`);
  assert.ok(below <= corners + .005, `the poncho spreads on below the elbows, ${below.toFixed(3)} at .55 up against ${corners.toFixed(3)} at the corners`);
});

test('the cowl rises to the jaw at his sides and stands up behind his neck as a hood (plan 030 round 5)', () => {
  // The critic and the orchestrator: round 4's cowl was a scarf of rolls round the neck with a smooth cone behind, where the
  // sheet's is a loose hood: a deep collar rising close round the jaw at the sides, and from behind and in profile a bag of
  // cloth standing up and out behind the neck. Torso-local, off the cowl's own vertices: its top within 30 degrees of either
  // side, against the chin's height; and how far behind his axis it reaches above the shoulders (.38). Measured 2026-10-13
  // (node): the sides .493 against the chin's .449, the hood .249 behind; round 4 .467 and .214.
  const { knight, cowl, torso } = relic(), chin = knight.userData.chin as THREE.Object3D | undefined;
  assert.ok(cowl && chin, 'precondition: the cowl and the chin are found');
  const chinY = torso.worldToLocal(chin.getWorldPosition(new THREE.Vector3())).y, p = cowl.geometry.getAttribute('position');
  let sides = -Infinity, behind = -Infinity, counted = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(Math.atan2(Math.abs(x), z) - Math.PI / 2) < Math.PI / 6) { counted++; sides = Math.max(sides, y); }
    if (y > .38) behind = Math.max(behind, z);
  }
  assert.ok(counted >= 20, `precondition: only ${counted} of the cowl's vertices lie at his sides`);
  assert.ok(sides - chinY >= .03, `the cowl rises only ${(sides - chinY).toFixed(3)} over the chin at his sides`);
  assert.ok(behind >= .235, `the hood stands only ${behind.toFixed(3)} behind his neck`);
});

test('the boots\' cuffs fold over into a hem of points, the longest at the front (plan 030 round 5)', () => {
  // The critic: flat rings for cuffs, where the sheet's are floppy turnovers with a pointed flap at the front. The cuff is
  // the knee's leather flared out past the boot's shaft (.1 from the shin's axis; the ankle strap and the sole lie inside
  // that or far below): its lowest point against its highest hem notch, and where the lowest point is. Measured 2026-10-13
  // (node): the points .04 under the notches, the lowest at the front; round 4's ring, .0 and at its back.
  const { knight } = relic(), knee = (knight.userData.legs as THREE.Group[])[0]!.userData.knee as THREE.Group;
  const leather = knee.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === 'leather') as THREE.Mesh | undefined;
  assert.ok(leather, 'precondition: the knee\'s leather batch is found');
  const p = leather.geometry.getAttribute('position'), hem = new Map<number, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.hypot(x, z) < .105 || y < -.4 || y > -.2) continue;
    const column = Math.round(Math.atan2(x, z) / (Math.PI / 5));
    hem.set(column, Math.min(hem.get(column) ?? Infinity, y));
  }
  assert.ok(hem.size >= 8, `precondition: the cuff's flared hem is found round only ${hem.size} columns`);
  const lows = [...hem.values()], deepest = Math.min(...lows), front = hem.get(5) ?? hem.get(-5)!;
  assert.ok(Math.max(...lows) - deepest >= .025, `the cuff's points hang only ${(Math.max(...lows) - deepest).toFixed(3)} under its notches`);
  assert.ok(front <= deepest + 1e-6, `the cuff's longest point is not at the front (${front.toFixed(3)} against ${deepest.toFixed(3)})`);
});

test('the run\'s sword carry hangs the forearm from its elbow and trails every arm behind him, clear of the floor (plan 030 round 3)', () => {
  const knight = makeKnight(), sword = knight.userData.sword as THREE.Group, torso = knight.userData.torso as THREE.Group;
  knight.position.y = .03;
  // The forearm, off the pivot's own skin batch as drawn: its axis, from the grip (the pivot) through the middle of its
  // far ring (the vertices over .19 from the grip, where it goes up into the sleeve). Standing, the elbow is the point on
  // that axis where the upper arm's sleeve ends, .175 from the grip; in the carry the forearm's axis must pass through the
  // same point, or the forearm would come off the static upper arm.
  const axis = () => { knight.updateWorldMatrix(true, true); const skin = sword.children.find(c => c instanceof THREE.Mesh && (c.material as THREE.Material).name === 'skin') as THREE.Mesh, p = skin.geometry.getAttribute('position'), v = new THREE.Vector3(), far = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (v.length() > .19) { far.add(v); n++; } }
    assert.ok(n >= 6, `precondition: the forearm has ${n} vertices up into the sleeve`);
    const grip = torso.worldToLocal(sword.getWorldPosition(new THREE.Vector3())), end = torso.worldToLocal(far.divideScalar(n).applyMatrix4(skin.matrixWorld));
    return { grip, direction: end.sub(grip).normalize() }; };
  const ready = axis(), elbow = ready.grip.clone().addScaledVector(ready.direction, .175);
  sword.position.set(...SWORD_CARRY.at); sword.quaternion.set(...SWORD_CARRY.quaternion);
  const carried = axis(), along = elbow.clone().sub(carried.grip).dot(carried.direction), off = elbow.clone().sub(carried.grip).addScaledVector(carried.direction, -along).length();
  assert.ok(off <= .01 && Math.abs(along - .175) <= .01, `in the carry the forearm passes ${off.toFixed(3)} from the elbow, ${along.toFixed(3)} from the grip`);
  // Every arm the armoury hands him: its tip behind the hand and below it, and above the floor. Measured 2026-10-13 (node):
  // the Tideblade's blade 25 degrees under the level.
  const { palette, plate } = knight.userData.armoury;
  const hand = new THREE.Vector3(...SWORD_CARRY.at), q = new THREE.Quaternion(...SWORD_CARRY.quaternion);
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const tip = makeWeapon(id, palette, plate).tip.clone().applyQuaternion(q).add(hand);
    assert.ok(tip.z > hand.z + .1, `carried, the ${id}'s tip is ${(tip.z - hand.z).toFixed(3)} behind the hand`);
    assert.ok(tip.y < hand.y, `carried, the ${id}'s tip stands over the hand`);
    const floor = torso.position.y + .03 + tip.y;
    assert.ok(floor > .05, `carried, the ${id}'s tip is ${floor.toFixed(3)} over the floor`);
  }
});

test('the run\'s carry keeps every blade trailing at least 20 degrees under the level through the follow-through (plan 030 round 4)', () => {
  // The orchestrator, side-on: at the forward end of round 3's carry swing the blade came back up level - "held level like
  // a lance". The game turns the carry about the elbow by the run pose's carryHang (dungeon-game.tsx posePlayer), on a torso
  // pitched by its lean; here the tip of every arm, carried and swung through a sprint's cycle as the game does it, against
  // the world's level. Round 4's first cut turned it by carrySwing alone, and the sprint's 15-degree lean lifted the blade
  // to 12.5 degrees under the level (the pack's side-on run read it as level). Measured 2026-10-13 (node): the
  // Tideblade 23.3 to 35.7 degrees under the level.
  const knight = makeKnight(), { palette, plate } = knight.userData.armoury, elbow = new THREE.Vector3(...SWORD_CARRY.elbow), q = new THREE.Quaternion(...SWORD_CARRY.quaternion);
  const poses = Array.from({ length: 64 }, (_, i) => playerRunPose(i * Math.PI / 32, 8.5)), swings = poses.map(p => p.carrySwing);
  assert.ok(Math.max(...swings) > .1 && Math.min(...swings) < -.05 && Math.max(...poses.map(p => -p.pitch)) > .2, 'precondition: the carry swings both ways on a leaning body');
  let highest = -Infinity, lowest = Infinity;
  // The blades: a ranged arm is carried by its stock, its "tip" the bolt's rail, and the carry test above holds it trailing.
  const blades = (Object.keys(WEAPONS) as WeaponId[]).filter(id => !WEAPONS[id].ranged);
  assert.ok(blades.length >= 3, 'precondition: the armoury hands him blades');
  for (const id of blades) {
    const tip = makeWeapon(id, palette, plate).tip;
    for (const { carryHang, carrySwing: swing, pitch } of poses) {
      const x = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion().setFromAxisAngle(x, carryHang), lean = new THREE.Quaternion().setFromAxisAngle(x, pitch);
      const hand = new THREE.Vector3(...SWORD_CARRY.at).sub(elbow).applyQuaternion(turn).add(elbow).applyQuaternion(lean);
      const end = tip.clone().applyQuaternion(lean.clone().multiply(turn).multiply(q)).add(hand), under = Math.atan2(hand.y - end.y, Math.hypot(end.x - hand.x, end.z - hand.z)) * 180 / Math.PI;
      if (id === 'tideblade') { highest = Math.max(highest, under); lowest = Math.min(lowest, under); }
      assert.ok(under >= 20, `carried at a swing of ${swing.toFixed(3)}, the ${id}'s blade is only ${under.toFixed(1)} degrees under the level`);
      assert.ok(end.z > hand.z, `carried at a swing of ${swing.toFixed(3)}, the ${id}'s tip is in front of the hand`);
    }
  }
  assert.ok(lowest < highest - 5, `precondition: the Tideblade's carry swung only ${lowest.toFixed(1)} to ${highest.toFixed(1)} degrees`);
  console.log(`the Tideblade carried ${lowest.toFixed(1)} to ${highest.toFixed(1)} degrees under the level`);
});

test('the cowl is smooth cloth, not a lumpy collar: its roll\'s top runs round him without a step (plan 030 round 4)', () => {
  // The critic read round 3's cowl as a fur stole: paired columns pushed in and out by 5% and its top jittered a centimetre
  // either way. The roll is the cowl's first 25 x 8 vertices (cowlPoint's grid, column by column, its section's points in
  // order; dungeon-knight.ts): the top of each column's section (its highest point), against the mean of its neighbours',
  // leaving out the V at the throat (the two columns either side of his front, a notch by design). Measured 2026-10-13
  // (node): .0104 at the most, where the roll comes down from the shoulder towards the throat.
  const { cowl } = relic();
  assert.ok(cowl, 'precondition: the cowl is found');
  // Round 5: each column's section is eight points and a ninth closing it on its lip (the hood's deeper section; round 4 had
  // seven and an eighth), so the roll's first 25 x 9 vertices.
  const p = cowl.geometry.getAttribute('position'), columns = 24, section = 9;
  assert.ok(p.count > (columns + 1) * section, `precondition: the cowl has its roll (${p.count} vertices)`);
  const top = Array.from({ length: columns + 1 }, (_, c) => Math.max(...Array.from({ length: section }, (_, k) => p.getY(c * section + k))));
  assert.ok(Math.abs(top[0]! - top[columns]!) < 1e-6, 'precondition: the roll closes its seam (the grid is laid out as read)');
  let worst = 0;
  for (let c = 0; c < columns; c++) if (Math.abs(c - columns / 2) > 2) worst = Math.max(worst, Math.abs(top[c]! - (top[(c + columns - 1) % columns]! + top[(c + 1) % columns]!) / 2));
  assert.ok(worst <= .015, `the cowl's roll steps ${worst.toFixed(4)} off its neighbours`);
  // Nor pushed in and out round him: the roll's reach (its furthest point from his axis) against its neighbours'. Measured
  // 2026-10-13 (node): .0054 at the most, over the shoulders; round 3's paired folds put it at .013.
  const reach = Array.from({ length: columns + 1 }, (_, c) => Math.max(...Array.from({ length: section }, (_, k) => Math.hypot(p.getX(c * section + k), p.getZ(c * section + k)))));
  let lumpiest = 0;
  for (let c = 0; c < columns; c++) lumpiest = Math.max(lumpiest, Math.abs(reach[c]! - (reach[(c + columns - 1) % columns]! + reach[(c + 1) % columns]!) / 2));
  assert.ok(lumpiest <= .01, `the cowl's roll bulges ${lumpiest.toFixed(4)} off its neighbours`);
  // And it still lies higher behind the neck than in front of it, where the throat shows.
  assert.ok(top[0]! - top[columns / 2]! >= .1, `the roll stands only ${(top[0]! - top[columns / 2]!).toFixed(3)} higher at the back than at the throat`);
});

test('the trousers fall nearly straight to a gather under the knee, not ballooning (plan 030 round 4)', () => {
  // The critic read round 3's trousers as pumpkin pants, 1.3 times the hips across with a hard ring at the knee. The
  // sheet's back view sliced the same way (scratch sheetw.py, 2026-10-13): .285 of his height across at .25 up, .247 at
  // .30, .253 at .35. Measured 2026-10-13 (node): .284, .284, .263.
  const { knight } = relic(), at = [.25, .3, .35].map(share => sliceWidth(knight, share, 'x'));
  for (const [i, share] of [.25, .3, .35].entries()) assert.ok(at[i]! >= .22 && at[i]! <= .3, `the legs are ${at[i]!.toFixed(3)} of his height across at ${share} up`);
});
