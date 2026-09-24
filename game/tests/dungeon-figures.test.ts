import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeKnight } from '../app/dungeon-knight.ts';
import { makeSkeleton } from '../app/dungeon-skeleton.ts';

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
