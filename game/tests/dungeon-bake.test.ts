import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { bakeStatic } from '../app/dungeon-bake.ts';

const lit = (color = 0x808080) => new THREE.MeshStandardMaterial({ color });
const meshes = (root: THREE.Object3D) => { const found: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) found.push(o); }); return found; };
const visibleMeshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => { if (!o.visible) return; if (o instanceof THREE.Mesh) found.push(o); o.children.forEach(walk); };
  walk(root); return found;
};
const triangles = (root: THREE.Object3D) => visibleMeshes(root).reduce((sum, m) => sum + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
const worldBox = (root: THREE.Object3D) => {
  root.updateWorldMatrix(true, true);
  // Vertex by vertex: a box of transformed boxes depends on how the parts are grouped, which is exactly
  // what a bake changes.
  const box = new THREE.Box3(), point = new THREE.Vector3();
  for (const mesh of visibleMeshes(root)) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  }
  return box;
};
const near = (a: THREE.Box3, b: THREE.Box3) => a.min.distanceTo(b.min) < 1e-5 && a.max.distanceTo(b.max) < 1e-5;

/** A small figure: a posed root, a joint, parts in two materials at odd transforms, one Basic glow. */
function figure(steel = lit(0xaaaaaa), iron = lit(0x222222)) {
  const root = new THREE.Group(); root.position.set(3, 1, -2); root.rotation.set(.2, .7, -.1); root.scale.setScalar(1.3);
  const joint = new THREE.Group(); joint.position.set(.4, .9, 0); joint.rotation.z = .5; root.add(joint);
  const a = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .1), steel); a.position.set(.1, .2, .3); a.rotation.set(.3, .1, 0);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, .5, 6), iron); b.position.set(-.2, 0, .1); b.scale.set(1, 1.4, .8);
  const c = new THREE.Mesh(new THREE.DodecahedronGeometry(.1, 0), steel); c.position.y = .4; b.add(c);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5 }));
  const see = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial({ transparent: true, opacity: .4 }));
  root.add(a, b, glow, see);
  const d = new THREE.Mesh(new THREE.TorusGeometry(.2, .03, 4, 8), iron); d.position.x = .3; joint.add(d);
  return { root, joint, a, b, c, d, glow, see, steel, iron };
}

test('parts fold into one mesh per material in root space, with the same world box and triangles', () => {
  const { root, joint, glow, see, steel, iron } = figure();
  const box = worldBox(root), tris = triangles(root);
  const result = bakeStatic(root, { keep: [joint] });
  assert.deepEqual(result, { meshes: 2, merged: 3 });
  assert.ok(near(worldBox(root), box), 'the baked figure moved');
  assert.equal(triangles(root), tris);
  // Basic and transparent parts are left where they were; the kept joint keeps its own part.
  assert.equal(glow.parent, root); assert.equal(see.parent, root);
  assert.equal(joint.children.length, 1);
  const baked = root.children.filter(o => o.name.startsWith('baked:')) as THREE.Mesh[];
  assert.deepEqual(baked.map(m => m.material), [steel, iron], 'batches follow first appearance in traversal order');
  for (const mesh of baked) {
    assert.equal(mesh.geometry.index, null);
    assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), ['normal', 'position']);
    assert.equal(mesh.geometry.groups.length, 0);
  }
});

test('root is never removed or merged: an invisible root is untouched and a mesh root keeps its own', () => {
  const hidden = figure(); hidden.root.visible = false;
  const before = meshes(hidden.root).length;
  assert.deepEqual(bakeStatic(hidden.root), { meshes: 0, merged: 0 });
  assert.equal(meshes(hidden.root).length, before);

  const geometry = new THREE.DodecahedronGeometry(.27, 0), bone = lit();
  const skull = new THREE.Mesh(geometry, bone), parent = new THREE.Group(); parent.add(skull);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(.03, .05, .04), bone); tooth.position.set(0, -.13, -.22); skull.add(tooth);
  bakeStatic(skull);
  assert.equal(skull.parent, parent);
  assert.equal(skull.geometry, geometry); assert.equal(skull.material, bone);
  assert.equal(skull.children.length, 1); assert.notEqual(skull.children[0], tooth);
});

test('kept and hidden subtrees: kept is left alone, hidden mergeable parts are removed rather than merged', () => {
  const root = new THREE.Group(), m = lit();
  const kept = new THREE.Group(); root.add(kept);
  const inKept = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); kept.add(inKept);
  const pauldron = new THREE.Mesh(new THREE.DodecahedronGeometry(.23, 0), m); pauldron.visible = false; root.add(pauldron);
  const rim = new THREE.Mesh(new THREE.DodecahedronGeometry(.23, 0), m); pauldron.add(rim);
  const shown = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), m); root.add(shown);
  const hiddenGroup = new THREE.Group(); hiddenGroup.visible = false; root.add(hiddenGroup);
  const underHidden = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), m); hiddenGroup.add(underHidden);
  const effect = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()); effect.visible = false; root.add(effect);
  const tris = triangles(root);
  const result = bakeStatic(root, { keep: [kept] });
  assert.deepEqual(result, { meshes: 1, merged: 1 });
  assert.equal(inKept.parent, kept, 'a kept subtree was touched');
  assert.equal(pauldron.parent, null); assert.equal(underHidden.parent, null);
  assert.equal(effect.parent, root, 'a hidden non-mergeable mesh is not the bake\'s to remove');
  assert.equal(triangles(root), tris, 'hidden parts drew nothing before and draw nothing after');
});

test('a folded part with children that stay is replaced in place, so the children keep their world transform', () => {
  const root = new THREE.Group(), m = lit();
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, .1, 8), m); shield.position.set(-.02, -.36, -.16); shield.rotation.x = -Math.PI / 2; shield.name = 'shield'; shield.userData.tag = 7;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.1), new THREE.MeshBasicMaterial()); glow.position.y = .2; shield.add(glow);
  root.add(shield); root.updateWorldMatrix(true, true);
  const at = new THREE.Vector3().setFromMatrixPosition(glow.matrixWorld);
  bakeStatic(root);
  assert.equal(shield.parent, null);
  const stand = glow.parent!;
  assert.equal(stand.parent, root); assert.equal(stand.name, 'shield'); assert.equal(stand.userData.tag, 7);
  assert.ok(!(stand instanceof THREE.Mesh));
  root.updateWorldMatrix(true, true);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(glow.matrixWorld).distanceTo(at) < 1e-6);
});

test('mixed attribute sets merge, uv survives only for a mapped material, colour only for vertex colours', () => {
  const root = new THREE.Group(), plain = lit();
  const extruded = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(.2, 0), new THREE.Vector2(.1, .3)]), { depth: .05, bevelEnabled: false });
  const bare = new THREE.BufferGeometry(); bare.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const coloured = new THREE.BoxGeometry(.1, .1, .1); coloured.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: coloured.getAttribute('position').count * 3 }, () => .5), 3));
  root.add(new THREE.Mesh(extruded, plain), new THREE.Mesh(bare, plain), new THREE.Mesh(coloured, plain));
  const mapped = new THREE.MeshStandardMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1) });
  root.add(new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), mapped), new THREE.Mesh(bare.clone(), mapped));
  const painted = new THREE.MeshStandardMaterial({ vertexColors: true });
  root.add(new THREE.Mesh(coloured.clone(), painted), new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), painted));
  assert.doesNotThrow(() => bakeStatic(root));
  const [a, b, c] = root.children as THREE.Mesh[];
  assert.deepEqual(Object.keys(a.geometry.attributes).sort(), ['normal', 'position']);
  assert.deepEqual(Object.keys(b.geometry.attributes).sort(), ['normal', 'position', 'uv']);
  assert.deepEqual(Object.keys(c.geometry.attributes).sort(), ['color', 'normal', 'position']);
});

test('shadow flags and render order are part of the batch, so a non-casting part never starts casting', () => {
  const root = new THREE.Group(), m = lit();
  const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); caster.castShadow = caster.receiveShadow = true;
  const quiet = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); quiet.position.x = 2;
  const late = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); late.renderOrder = 3; late.castShadow = late.receiveShadow = true;
  root.add(caster, quiet, late);
  assert.deepEqual(bakeStatic(root), { meshes: 3, merged: 3 });
  const baked = root.children as THREE.Mesh[];
  assert.deepEqual(baked.map(o => [o.castShadow, o.receiveShadow, o.renderOrder]), [[true, true, 0], [false, false, 0], [true, true, 3]]);
});

test('a mirrored part keeps its faces pointing outward once the mirror is baked in', () => {
  const root = new THREE.Group(), part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lit());
  part.scale.set(-1, 1, 1); part.position.x = 3; root.add(part);
  bakeStatic(root);
  const geometry = (root.children[0] as THREE.Mesh).geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const [p0, p1, p2, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < position.count; i += 3) {
    p0.fromBufferAttribute(position, i); p1.fromBufferAttribute(position, i + 1); p2.fromBufferAttribute(position, i + 2); n.fromBufferAttribute(normal, i);
    const face = p1.sub(p0).cross(p2.sub(p0));
    assert.ok(face.dot(n) > 0, `face ${i / 3} winds against its own normal`);
  }
});

test('a cached bake shares geometry across instances and binds each instance its own materials', () => {
  const first = figure(lit(0x111111), lit(0x222222)), second = figure(lit(0x333333), lit(0x444444));
  bakeStatic(first.root, { keep: [first.joint], cacheKey: 'test:figure' });
  bakeStatic(second.root, { keep: [second.joint], cacheKey: 'test:figure' });
  const bakedOf = (root: THREE.Object3D) => root.children.filter(o => o.name.startsWith('baked:')) as THREE.Mesh[];
  const [a, b] = [bakedOf(first.root), bakedOf(second.root)];
  assert.equal(a.length, 2); assert.equal(b.length, 2);
  a.forEach((mesh, i) => { assert.equal(mesh.geometry, b[i].geometry); assert.equal(mesh.geometry.userData.shared, true); });
  assert.deepEqual(a.map(m => m.material), [first.steel, first.iron]);
  assert.deepEqual(b.map(m => m.material), [second.steel, second.iron]);
  assert.ok(near(worldBox(second.root), worldBox(first.root)));

  // A figure built differently under the same key would pair a material with a stranger's geometry.
  const odd = figure(); odd.root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), odd.steel));
  const before = meshes(odd.root).length;
  assert.throws(() => bakeStatic(odd.root, { keep: [odd.joint], cacheKey: 'test:figure' }), /test:figure/);
  assert.equal(meshes(odd.root).length, before, 'a refused bake changed the figure');
  const swapped = figure(); swapped.a.material = swapped.iron;
  assert.throws(() => bakeStatic(swapped.root, { keep: [swapped.joint], cacheKey: 'test:figure' }), /test:figure/);
});

test('shared source geometry is never disposed, unshared is; uncached merged geometry belongs to the caller', () => {
  const root = new THREE.Group(), m = lit();
  const shared = new THREE.BoxGeometry(1, 1, 1); shared.userData.shared = true;
  const own = new THREE.BoxGeometry(1, 1, 1), reused = new THREE.BoxGeometry(1, 1, 1);
  const disposed = new Set<THREE.BufferGeometry>();
  for (const g of [shared, own, reused]) g.addEventListener('dispose', () => disposed.add(g));
  const kept = new THREE.Group(); kept.add(new THREE.Mesh(reused, m));
  root.add(new THREE.Mesh(shared, m), new THREE.Mesh(own, m), new THREE.Mesh(reused, m), kept);
  bakeStatic(root, { keep: [kept] });
  assert.ok(!disposed.has(shared)); assert.ok(disposed.has(own));
  assert.ok(!disposed.has(reused), 'geometry still drawn by a kept mesh was disposed');
  const baked = root.children.find(o => o.name.startsWith('baked:')) as THREE.Mesh;
  assert.notEqual(baked.geometry.userData.shared, true);
});
