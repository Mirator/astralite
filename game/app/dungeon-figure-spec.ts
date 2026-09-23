// A narrow declarative format for a figure's part tree (plan 012), so a part can be found by name and
// edited without reading the whole builder. Three.js only, no baking or game logic: a spec becomes a
// THREE.Group tree with names set, nothing more. What happens to that tree afterwards (bakeStatic,
// userData wiring, contactShadow, ...) is the builder's job, not this module's.
import * as THREE from 'three';

export type V3 = [number, number, number];
export type Shape =
  | { box: V3 }
  | { cylinder: [rTop: number, rBottom: number, height: number, segments: number] }
  | { cone: [r: number, height: number, segments: number] }
  | { dodeca: [r: number, detail?: number] }
  | { sphere: [r: number, w: number, h: number] }
  | { torus: [R: number, r: number, radial: number, tubular: number, arc?: number] }
  | { plate: { outline: [number, number][]; depth: number } }
  | { geometry: THREE.BufferGeometry }; // escape hatch: BONES entries, the cloak, anything already shared
export type Part = { name: string; shape: Shape; material: string; at?: V3; rot?: V3 | [...V3, THREE.EulerOrder]; scale?: number | V3; hidden?: boolean; parts?: (Part | Node)[] };
export type Node = { name: string; at?: V3; rot?: V3 | [...V3, THREE.EulerOrder]; scale?: number | V3; parts: (Part | Node)[] };

const isPart = (entry: Part | Node): entry is Part => 'shape' in entry;

/** The extruded-outline helper the knight (and its weapons) are built with, restated so a plate spec entry produces exactly the mesh makeKnight() built by hand. */
function plateGeometry(outline: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  outline.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .015, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function shapeGeometry(shape: Shape): THREE.BufferGeometry {
  if ('box' in shape) return new THREE.BoxGeometry(...shape.box);
  if ('cylinder' in shape) return new THREE.CylinderGeometry(...shape.cylinder);
  if ('cone' in shape) return new THREE.ConeGeometry(...shape.cone);
  if ('dodeca' in shape) return new THREE.DodecahedronGeometry(shape.dodeca[0], shape.dodeca[1] ?? 0);
  if ('sphere' in shape) return new THREE.SphereGeometry(...shape.sphere);
  if ('torus' in shape) return new THREE.TorusGeometry(...shape.torus);
  if ('plate' in shape) return plateGeometry(shape.plate.outline, shape.plate.depth);
  return shape.geometry;
}

const applyPose = (object: THREE.Object3D, at?: V3, rot?: V3 | [...V3, THREE.EulerOrder], scale?: number | V3) => {
  if (at) object.position.set(...at);
  if (rot) object.rotation.set(rot[0], rot[1], rot[2], rot[3]);
  if (scale !== undefined) { if (typeof scale === 'number') object.scale.setScalar(scale); else object.scale.set(...scale); }
};

/**
 * Turns a spec tree into live THREE objects: a Node per THREE.Group, a Part per THREE.Mesh, both named.
 * `byName` is every named node in the figure, for the imperative code that runs after this (bakeStatic,
 * userData wiring, ...) to find a joint without a local variable. A duplicate name is almost always a
 * copy-paste slip carrying a stale name, so it throws rather than silently shadowing the first part.
 */
export function buildSpec(spec: Node, palette: Record<string, THREE.Material>): { root: THREE.Group; byName: Record<string, THREE.Object3D> } {
  const byName: Record<string, THREE.Object3D> = {};
  const register = (name: string, object: THREE.Object3D) => {
    if (Object.prototype.hasOwnProperty.call(byName, name)) throw new Error(`buildSpec: duplicate part name '${name}'`);
    byName[name] = object;
  };
  const buildChildren = (into: THREE.Object3D, entries: (Part | Node)[]) => {
    for (const entry of entries) into.add(isPart(entry) ? buildPart(entry) : buildNode(entry));
  };
  const buildNode = (node: Node): THREE.Group => {
    const group = new THREE.Group();
    group.name = node.name;
    applyPose(group, node.at, node.rot, node.scale);
    register(node.name, group);
    buildChildren(group, node.parts);
    return group;
  };
  const buildPart = (part: Part): THREE.Mesh => {
    const material = palette[part.material];
    if (!material) throw new Error(`buildSpec: unknown material '${part.material}' for part '${part.name}'`);
    const mesh = new THREE.Mesh(shapeGeometry(part.shape), material);
    mesh.name = part.name;
    applyPose(mesh, part.at, part.rot, part.scale);
    if (part.hidden) mesh.visible = false;
    register(part.name, mesh);
    if (part.parts) buildChildren(mesh, part.parts);
    return mesh;
  };
  return { root: buildNode(spec), byName };
}
