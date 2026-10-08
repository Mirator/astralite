import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE, type Floor } from './dungeon-floor';
import type { PropKind } from './dungeon-furnish';
import { KEG_FUSE, liveProps, spikeState, type LiveProp } from './dungeon-hits';

// Plan 025 Stage F (D12 a): the furniture as the world draws it. The rules are dungeon-hits.ts and the layout dungeon-furnish.ts; this only puts them on screen.
// Instanced: one InstancedMesh a kind a chamber, all sharing one material (per-instance colour), so a chamber costs one draw call for each kind it holds (a
// spike plate two: the plate and its spikes) and a chamber out of frame costs nothing. No prop casts a shadow, which would double its calls. Cover is drawn
// by the floor's own parapets (its tile is out of `cells`, so the wall pass rings it with a low kerb) and has no mesh here.

const COLOR: Record<Exclude<PropKind, 'cover'>, number> = { urn: 0xb0754a, crate: 0x8a6a45, keg: 0x7c3324, spikes: 0x4a4744, chest: 0xc29a3a };
const SPIKE_COLOR = 0xb9b4aa;
/** A lit keg flashes between its own red and this, faster as its fuse runs down: the telegraph. */
const FUSE_FLASH = new THREE.Color(0xffd27a);
/** How far a plate's spikes stand out of it: hidden, showing at the slots through the telegraph, and up. */
const SPIKE_RISE = { down: -.3, tell: -.12, up: .02 } as const;

const geometryOf = (kind: Exclude<PropKind, 'cover'> | 'spike'): THREE.BufferGeometry => {
  if (kind === 'urn') { const g = new THREE.LatheGeometry([[0, 0], [.2, .02], [.29, .22], [.25, .44], [.14, .55], [.17, .62], [0, .62]].map(([x, y]) => new THREE.Vector2(x, y)), 9); return g; }
  if (kind === 'crate') { const g = new THREE.BoxGeometry(.66, .62, .66); g.translate(0, .31, 0); return g; }
  if (kind === 'keg') { const g = new THREE.CylinderGeometry(.27, .3, .72, 10); g.translate(0, .36, 0); return g; }
  if (kind === 'chest') { const g = new THREE.BoxGeometry(.86, .52, .58); g.translate(0, .26, 0); return g; }
  if (kind === 'spikes') { const g = new THREE.BoxGeometry(1.24, .05, 1.24); g.translate(0, .025, 0); return g; }
  const cones: THREE.BufferGeometry[] = [];
  for (const dx of [-.36, 0, .36]) for (const dz of [-.36, 0, .36]) { const c = new THREE.ConeGeometry(.07, .32, 5); c.translate(dx, .16, dz); cones.push(c); }
  return mergeGeometries(cones)!;
};

/** One instance of one mesh: which mesh, which slot, and where it stands. */
type Slot = { mesh: THREE.InstancedMesh; index: number };
export type PropsView = {
  /** The props as the fight holds them (dungeon-hits `LiveProp`), in `floor.furniture` order. */
  live: LiveProp[];
  /** Hides a spent prop (a broken urn, a keg gone up). */
  spend: (index: number) => void;
  /** Spike plates rise and lit kegs flash, for the knight's chamber; everything else stands still. */
  animate: (t: number, room: number) => void;
  /** What the scene actually draws for a prop, read back off its instance: whether it is shown (its matrix has a scale), and a plate's spikes' height. */
  drawn: (index: number) => { shown: boolean; spikes: number | null };
};

const scratch = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

/** Raises the floor's furniture into `group`. A floor with none (the hall, an arena, `?rooms=plain`) gets an empty view and no mesh. */
export function raiseProps(floor: Floor, group: THREE.Group): PropsView {
  const live = liveProps(floor.furniture ?? [], TILE);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .78, metalness: .08 });
  const body: (Slot | null)[] = live.map(() => null), spikes: (Slot | null)[] = live.map(() => null);
  const groups = new Map<string, number[]>();
  live.forEach((prop, i) => { if (prop.kind === 'cover') return; const key = `${prop.room}:${prop.kind}`; const list = groups.get(key); if (list) list.push(i); else groups.set(key, [i]); });
  const color = new THREE.Color(), shapes = new Map<string, THREE.BufferGeometry>();
  // One geometry a kind for the whole floor, shared by every chamber's mesh of that kind.
  const shape = (kind: Exclude<PropKind, 'cover'> | 'spike') => { let g = shapes.get(kind); if (!g) { g = geometryOf(kind); shapes.set(kind, g); } return g; };
  const make = (kind: Exclude<PropKind, 'cover'> | 'spike', members: number[], tint: number, into: (Slot | null)[]) => {
    const mesh = new THREE.InstancedMesh(shape(kind), material, members.length);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = `props:${kind}`;
    members.forEach((i, n) => {
      const prop = live[i], yaw = (prop.id * 2.399) % (Math.PI * 2);
      quaternion.setFromAxisAngle(up, kind === 'spikes' || kind === 'spike' ? 0 : yaw);
      position.set(prop.at.x, kind === 'spike' ? SPIKE_RISE.down : 0, prop.at.z); scale.setScalar(1);
      mesh.setMatrixAt(n, scratch.compose(position, quaternion, scale));
      mesh.setColorAt(n, color.setHex(tint).multiplyScalar(.85 + ((prop.id * 37) % 11) / 40));
      into[i] = { mesh, index: n };
    });
    mesh.computeBoundingSphere(); mesh.boundingSphere!.radius += .5;
    group.add(mesh);
  };
  for (const members of groups.values()) {
    const kind = live[members[0]].kind as Exclude<PropKind, 'cover'>;
    make(kind, members, COLOR[kind], body);
    if (kind === 'spikes') make('spike', members, SPIKE_COLOR, spikes);
  }
  const matrixOf = (slot: Slot) => { slot.mesh.getMatrixAt(slot.index, scratch); scratch.decompose(position, quaternion, scale); };
  const hide = (slot: Slot | null) => { if (!slot) return; scratch.makeScale(0, 0, 0); slot.mesh.setMatrixAt(slot.index, scratch); slot.mesh.instanceMatrix.needsUpdate = true; };
  return {
    live,
    spend: (index) => { hide(body[index]); hide(spikes[index]); },
    animate: (t, room) => {
      live.forEach((prop, i) => {
        if (prop.room !== room || prop.broken) return;
        const spike = spikes[i];
        if (prop.kind === 'spikes' && spike) {
          const want = SPIKE_RISE[spikeState(t, prop.phase)];
          matrixOf(spike);
          if (Math.abs(position.y - want) > 1e-4) { position.y += (want - position.y) * (want > position.y ? .6 : .25); spike.mesh.setMatrixAt(spike.index, scratch.compose(position, quaternion, scale)); spike.mesh.instanceMatrix.needsUpdate = true; }
        }
        const keg = body[i];
        if (prop.kind === 'keg' && keg && prop.fuse >= 0) {
          const beat = .5 + .5 * Math.sin(t * (10 + 26 * (1 - prop.fuse / KEG_FUSE)));
          keg.mesh.setColorAt(keg.index, color.setHex(COLOR.keg).lerp(FUSE_FLASH, beat)); keg.mesh.instanceColor!.needsUpdate = true;
        }
      });
    },
    drawn: (index) => {
      const slot = body[index], spike = spikes[index];
      if (!slot) return { shown: false, spikes: null };
      // Off the matrix itself: `decompose` reads a spent (zero-scale) instance back as scale one.
      slot.mesh.getMatrixAt(slot.index, scratch); const e = scratch.elements, shown = Math.hypot(e[0], e[1], e[2]) > 1e-6;
      if (!spike) return { shown, spikes: null };
      matrixOf(spike); return { shown, spikes: +position.y.toFixed(3) };
    },
  };
}
