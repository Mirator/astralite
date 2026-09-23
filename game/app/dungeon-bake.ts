// One static bake for every figure in the keep (plan 009 arms, 010 knight, 011 enemies).
//
// A figure is built out of dozens of small parts because that is how it is easiest to write, and every
// part that stays a `THREE.Mesh` is its own draw call, twice over when it casts a shadow. Nothing about
// the parts that do not move needs them to stay separate, so this folds every such part under a joint
// into one mesh per material, in the joint's own space, and leaves the joints that animate alone.
//
// It imports three and nothing else, so it runs in node and `tests/dungeon-bake.test.ts` holds it to
// its rules directly.
import * as THREE from 'three';

export type BakeOptions = {
  /** Subtrees left exactly as they are: animated joints, anything swapped at runtime, pooled effects. */
  keep?: Iterable<THREE.Object3D>;
  /**
   * Reuse the merged geometry across instances built the same way (twelve guards bake once). The
   * cached geometry is marked `userData.shared`, so floor teardown leaves it alone. Only geometry is
   * cached: every call builds fresh meshes bound to its own materials, so per-instance materials (an
   * enemy's hit flash) survive.
   */
  cacheKey?: string;
};

type Batch = { material: THREE.MeshStandardMaterial; cast: boolean; receive: boolean; order: number; parts: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] };
type Cached = { signature: string[]; geometries: THREE.BufferGeometry[] };
const cache = new Map<string, Cached>();

/** A part the bake may fold away: a plain mesh, one opaque lit material, nothing drawn per object. */
const mergeable = (object: THREE.Object3D): object is THREE.Mesh =>
  object instanceof THREE.Mesh && !(object as THREE.InstancedMesh).isInstancedMesh && !(object as THREE.SkinnedMesh).isSkinnedMesh &&
  !Array.isArray(object.material) && object.material instanceof THREE.MeshStandardMaterial && !object.material.transparent &&
  object.onBeforeRender === THREE.Object3D.prototype.onBeforeRender && !Object.keys(object.geometry.morphAttributes).length;

const vertexCount = (geometry: THREE.BufferGeometry) => geometry.index ? geometry.index.count : geometry.getAttribute('position').count;

/** One part, flattened into the joint's space: non-indexed, position and normal (plus uv or colour only if the material reads them). */
function flatten(part: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }, uv: boolean, color: boolean) {
  const source = part.mesh.geometry;
  const flat = source.index ? source.toNonIndexed() : source.clone();
  if (!flat.getAttribute('normal')) flat.computeVertexNormals();
  flat.applyMatrix4(part.matrix);
  const count = flat.getAttribute('position').count;
  const read = (name: string, size: number, fill: number) => {
    const attribute = flat.getAttribute(name), out = new Float32Array(count * size).fill(fill);
    if (attribute) for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) out[i * size + k] = k < attribute.itemSize ? attribute.getComponent(i, k) : fill;
    return out;
  };
  const arrays = { position: read('position', 3, 0), normal: read('normal', 3, 0), uv: uv ? read('uv', 2, 0) : null, color: color ? read('color', 3, 1) : null };
  flat.dispose();
  // A mirrored part (negative scale) is drawn with its faces flipped by the renderer, which reads the
  // sign off the object's own matrix. Once merged that sign is gone, so the winding is flipped here.
  if (part.matrix.determinant() < 0) for (const [name, array] of Object.entries(arrays)) {
    if (!array) continue;
    const size = name === 'uv' ? 2 : 3;
    for (let t = 0; t < count; t += 3) for (let k = 0; k < size; k++) {
      const a = (t + 1) * size + k, b = (t + 2) * size + k, swap = array[a];
      array[a] = array[b]; array[b] = swap;
    }
  }
  return { count, ...arrays };
}

function mergeBatch(batch: Batch) {
  const uv = !!batch.material.map, color = !!batch.material.vertexColors;
  const pieces = batch.parts.map(part => flatten(part, uv, color));
  const total = pieces.reduce((sum, piece) => sum + piece.count, 0);
  const geometry = new THREE.BufferGeometry();
  const join = (name: 'position' | 'normal' | 'uv' | 'color', size: number) => {
    const out = new Float32Array(total * size);
    let offset = 0;
    for (const piece of pieces) { out.set(piece[name]!, offset); offset += piece.count * size; }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  join('position', 3); join('normal', 3);
  if (uv) join('uv', 2);
  if (color) join('color', 3);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Stands in for a folded-away part whose children stay: same place in the tree, same transform. */
function placeholder(mesh: THREE.Mesh) {
  const stand = new THREE.Object3D();
  stand.name = mesh.name; stand.visible = mesh.visible; stand.userData = mesh.userData;
  stand.position.copy(mesh.position); stand.quaternion.copy(mesh.quaternion); stand.scale.copy(mesh.scale);
  stand.matrixAutoUpdate = mesh.matrixAutoUpdate; stand.matrix.copy(mesh.matrix);
  const parent = mesh.parent!, at = parent.children.indexOf(mesh);
  parent.children[at] = stand; stand.parent = parent; mesh.parent = null;
  // A copy: `add` takes each child out of the list being walked.
  for (const child of mesh.children.slice()) stand.add(child);
  return stand;
}

/**
 * Merge every opaque Mesh under `root` into one Mesh per material (and shadow flags and render order),
 * in root-local space, appended to `root`. Returns how many meshes it built and how many it folded in.
 *
 * - Only plain meshes with a single, opaque `MeshStandardMaterial` merge. Basic, transparent,
 *   multi-material, instanced, skinned and morphing meshes, and any with their own `onBeforeRender`,
 *   are left where they are.
 * - `root` is never removed or merged. An invisible `root` is left untouched. A `root` that is itself a
 *   Mesh keeps its own geometry and material.
 * - A mesh merges only if nothing on its path up to `root` is in `keep` and all of it is visible. An
 *   invisible mergeable mesh (or one under an invisible node) is removed, not merged.
 * - A removed part with children that stay is replaced by a bare `Object3D` in the same place carrying
 *   its name, transform and userData, so the children keep their parent. References to the old mesh
 *   itself are not rewritten: a caller holding one must re-point it.
 * - Source geometry flagged `userData.shared`, or still used by a mesh left under `root`, is never
 *   disposed; everything else the bake folds away is.
 */
export function bakeStatic(root: THREE.Object3D, options: BakeOptions = {}): { meshes: number; merged: number } {
  if (!root.visible) return { meshes: 0, merged: 0 };
  const keep = new Set(options.keep ?? []);
  const batches: Batch[] = [], removed: THREE.Mesh[] = [];
  const visit = (node: THREE.Object3D, matrix: THREE.Matrix4, hidden: boolean) => {
    for (const child of node.children) {
      if (keep.has(child)) continue;
      if (child.matrixAutoUpdate) child.updateMatrix();
      const local = new THREE.Matrix4().multiplyMatrices(matrix, child.matrix), unseen = hidden || !child.visible;
      if (mergeable(child)) {
        if (unseen) removed.push(child);
        else {
          const material = child.material as THREE.MeshStandardMaterial;
          let batch = batches.find(b => b.material === material && b.cast === child.castShadow && b.receive === child.receiveShadow && b.order === child.renderOrder);
          if (!batch) { batch = { material, cast: child.castShadow, receive: child.receiveShadow, order: child.renderOrder, parts: [] }; batches.push(batch); }
          batch.parts.push({ mesh: child, matrix: local });
        }
      }
      visit(child, local, unseen);
    }
  };
  visit(root, new THREE.Matrix4(), false);
  const folded = batches.flatMap(batch => batch.parts.map(part => part.mesh));

  // The structure a cached bake is keyed on. Two instances whose parts differ in count, size, flags or
  // what their material reads would bind a material to someone else's geometry, so that throws.
  const signature = batches.map(b => `${b.parts.length}:${b.parts.reduce((sum, part) => sum + vertexCount(part.mesh.geometry), 0)}:${+b.cast}${+b.receive}:${b.order}:${+!!b.material.map}${+!!b.material.vertexColors}`);
  const hit = options.cacheKey === undefined ? undefined : cache.get(options.cacheKey);
  if (hit && (hit.signature.length !== signature.length || hit.signature.some((entry, i) => entry !== signature[i]))) {
    throw new Error(`bakeStatic: '${options.cacheKey}' was cached as [${hit.signature.join(', ')}] and this call bakes [${signature.join(', ')}]`);
  }
  if (!folded.length && !removed.length) return { meshes: 0, merged: 0 };
  let geometries: THREE.BufferGeometry[];
  if (hit) geometries = hit.geometries;
  else {
    geometries = batches.map(mergeBatch);
    if (options.cacheKey !== undefined) { geometries.forEach(geometry => { geometry.userData.shared = true; }); cache.set(options.cacheKey, { signature, geometries }); }
  }

  // Deepest first, so a part whose children were folded away with it leaves no placeholder behind.
  const gone = new Set<THREE.Object3D>([...folded, ...removed]);
  const depth = (object: THREE.Object3D) => { let d = 0; for (let o = object.parent; o && o !== root; o = o.parent) d++; return d; };
  for (const mesh of [...gone].sort((a, b) => depth(b) - depth(a))) {
    if (mesh.children.length) placeholder(mesh as THREE.Mesh);
    else mesh.removeFromParent();
  }
  batches.forEach((batch, i) => {
    const mesh = new THREE.Mesh(geometries[i], batch.material);
    mesh.name = `baked:${i}`; mesh.castShadow = batch.cast; mesh.receiveShadow = batch.receive; mesh.renderOrder = batch.order;
    root.add(mesh);
  });
  const still = new Set<THREE.BufferGeometry>();
  root.traverse(object => { if (object instanceof THREE.Mesh) still.add(object.geometry); });
  for (const mesh of gone as Set<THREE.Mesh>) if (!mesh.geometry.userData.shared && !still.has(mesh.geometry)) mesh.geometry.dispose();
  return { meshes: batches.length, merged: folded.length };
}
