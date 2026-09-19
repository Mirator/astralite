import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { type Room, TILE, type generateFloor } from './dungeon-floor';
import { weatherStone } from './dungeon-motion';

// The camera is fixed and orthographic — focus + (9.2, 12.5, 11.5), aimed at the focus — so its screen-up
// axis is a constant, and these three numbers are the whole of it. Vertical structure has to be placed
// against them or it is placed blind: the identical pier is a foreground occluder on the camera side of a
// room and a thing standing on the knight's head on the other, and nothing in the geometry says which.
/** Screen-up units a single world unit of height buys. */
export const RISE = .7623;
/** Where a floor offset from the frame's focus lands up the frame; negative is toward the camera. */
export const screenUp = (a: number, b: number) => -.4042 * a - .5052 * b;
/**
 * The tallest a structure at this offset may be built while its top stays clear of the knight, who is at
 * the middle of the frame with his head around +1.2. Infinity up-screen of him: that half is backdrop, and
 * mass there is what he reads against rather than what hides him.
 */
export const headroom = (a: number, b: number, clear = 1.05) => {
  const base = screenUp(a, b);
  return base >= 0 ? Infinity : (-clear - base) / RISE;
};
/**
 * Whether a tile's face on this side is one the lens can see the outside of. Down-screen is a constant of
 * the fixed camera, not a property of any room, so this needs no reference point to answer — which is what
 * makes it usable on a corridor, where there is no room heart to measure a `headroom` from. Only these two
 * faces ever show their retaining wall; on the other two the platform edge points away and is never drawn.
 */
export const facesCamera = (dx: number, dz: number) => screenUp(dx, dz) < 0;
/**
 * Past this much headroom the offset is so far down-frame that the top of the tallest thing allowed there
 * still falls below the bottom edge, so nothing built on it can ever be seen from the middle of the room.
 * The widest halls run a long way past it, and building their near perimeter was the single largest line
 * in the triangle count for geometry with no frame to appear in.
 */
export const OFF_FRAME = 9.6;

/**
 * One hue family per chamber, and a single saturated accent left to do the work.
 *
 * Every room in the keep used to be lit by the same lamps under the same fog, so a theme could only
 * differ from its neighbours by the base colour of its paving — and the moss tint in `weatherStone`
 * pulled even that back toward the same drowned green. The result was eight frames of one colour.
 *
 * What follows is the whole palette of the keep, and the lighting reads it per room rather than per
 * floor: key, sky and ground light, fog, backdrop, the tints the stone shader weathers with, and the
 * base colours of paving, foundation and masonry. The three families are far enough apart that the
 * run reads as three areas rather than one: cold steel over the standing keep, dry ochre over the
 * ruin, drowned green over the flood. Each leaves exactly one thing saturated against it — the
 * braziers in the two cold families, the knight's own cold lantern in the warm one.
 */
export type Mood = {
  key: number; keyIntensity: number; sky: number; ground: number; hemisphere: number;
  fog: number; fogDensity: number; background: number; environment: number;
  tile: number; border: number; block: number; foundation: number; seal: number;
  water: [number, number, number];
  moss: [number, number, number]; mossAmount: number;
  warm: [number, number, number]; cool: [number, number, number]; crown: [number, number, number];
};
export const ROOM_MOOD: Record<Room['theme'], Mood> = {
  keep: {
    key: 0xd2e0f4, keyIntensity: 5, sky: 0x8fa5c6, ground: 0x171d29, hemisphere: .4,
    fog: 0x0a1018, fogDensity: .024, background: 0x0d1424, environment: .26,
    tile: 0x848ea4, border: 0x495468, block: 0x596276, foundation: 0x2b3345, seal: 0x83a7cd,
    water: [.68, .78, 1],
    moss: [.7, .78, .94], mossAmount: .24,
    warm: [1.06, 1.06, 1.03], cool: [.8, .89, 1.07], crown: [1.02, 1.07, 1.18],
  },
  ruins: {
    key: 0xf2d3a6, keyIntensity: 4.8, sky: 0xb08e66, ground: 0x231a11, hemisphere: .4,
    fog: 0x150e08, fogDensity: .021, background: 0x1a1109, environment: .26,
    tile: 0x8c7d5f, border: 0x544935, block: 0x695c45, foundation: 0x332a1d, seal: 0xcaa872,
    water: [.52, .64, .7],
    moss: [.86, .78, .58], mossAmount: .3,
    warm: [1.16, 1.05, .86], cool: [.95, .89, .8], crown: [1.18, 1.07, .88],
  },
  flooded: {
    key: 0xc6e2da, keyIntensity: 5, sky: 0x83b2aa, ground: 0x122622, hemisphere: .42,
    fog: 0x071a1e, fogDensity: .027, background: 0x0a1b24, environment: .3,
    tile: 0x739690, border: 0x446661, block: 0x506a6b, foundation: 0x2d4547, seal: 0x7faeae,
    water: [1, 1, 1],
    moss: [.58, .82, .62], mossAmount: .4,
    warm: [1.13, 1.04, .88], cool: [.82, .92, .99], crown: [1.04, 1.12, 1.06],
  },
};

// Broad reflected light makes metal read as metal without another live light or render pass.
export function vaultEnvironment() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  // Value structure kept, hue taken out: what this map contributed before was a blue cast on every
  // metal and every stone in the keep, applied equally in every room, which is the opposite of what
  // this round is for. The rooms colour themselves through their own lights now.
  sky.addColorStop(0, '#ccd2d4'); sky.addColorStop(.38, '#7b8288');
  sky.addColorStop(.52, '#242a2e'); sky.addColorStop(1, '#14171a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 256);
  const opening = ctx.createRadialGradient(145, 68, 2, 145, 68, 100);
  opening.addColorStop(0, '#fff5da'); opening.addColorStop(.25, '#e3e5e2cc'); opening.addColorStop(1, '#e3e5e200');
  ctx.fillStyle = opening; ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

// These are surface details and silhouettes on existing walls, never new obstacles.
export function addCarvedArchitecture(world: THREE.Group, floor: ReturnType<typeof generateFloor>) {
  // Both of these carried a green of their own on top of the moss tint, in every room of the keep.
  // Neutral here, so the chamber's own mood is the only thing deciding which way the carving reads.
  const stone = new THREE.MeshStandardMaterial({ color: 0x878c8a, roughness: .82 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x94968f, roughness: .7 });
  // Carved work was the last flat stone in the frame: columns, cornices and footings took one value per
  // face while the paving beside them was already weathering. Same draw, same triangles, same material.
  weatherStone(stone); weatherStone(pale);
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa88951, metalness: .65, roughness: .48 });
  // The inlaid medallion is the largest single shape on a chamber floor; flat, it read as a hole cut in
  // the paving rather than as worn slate set into it. The weathering is multiplicative and reads at any
  // base value, so the base goes back down to where it was: the disc fills most of the frame right
  // around the knight in four of the eight scenes, and lifting it was spending his contrast for nothing.
  const dark = new THREE.MeshStandardMaterial({ color: 0x152c32, roughness: .86 }); weatherStone(dark);
  const foliage = new THREE.MeshStandardMaterial({ color: 0x52735b, roughness: .95, side: THREE.DoubleSide });
  const leafGeometry = new THREE.OctahedronGeometry(1);
  const box = new RoundedBoxGeometry(1, 1, 1, 1, .08);
  const blocks: { x: number; y: number; z: number; sx: number; sy: number; sz: number; material: THREE.Material }[] = [];
  const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material = stone) => blocks.push({ x, y, z, sx, sy, sz, material });
  // Props occupy holes in floor.tiles; they are interior floor, never perimeter walls.
  const cells = new Set([...floor.tiles, ...floor.props].map(t => `${t.x},${t.z}`));
  const owner = new Map<string, number>(); for (const t of floor.tiles) owner.set(`${t.x},${t.z}`, t.room);
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z); item.receiveShadow = true; world.add(item); return item;
  };
  for (const room of floor.rooms) {
    const local = floor.tiles.filter(t => t.room === room.id && !t.wood);
    // Engraved medallions are flush with the walking surface, with subdued bronze inlay.
    const x = room.x * TILE, z = room.z * TILE, radius = room.shape === 'round' ? 3.15 : 2.35;
    if (room.encounter !== 'gauntlet') {
      const disk = mesh(new THREE.CircleGeometry(radius, 64), dark, x, .028, z); disk.rotation.x = -Math.PI / 2;
      for (const r of [radius, radius - .16, radius * .65]) {
        const ring = mesh(new THREE.RingGeometry(r - .025, r, 64), bronze, x, .031, z); ring.rotation.x = -Math.PI / 2;
      }
      const star = new THREE.Shape();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? radius * .19 : radius * (i % 4 ? .43 : .59); if (i) star.lineTo(Math.sin(a) * r, Math.cos(a) * r); else star.moveTo(Math.sin(a) * r, Math.cos(a) * r); }
      star.closePath(); const compass = mesh(new THREE.ShapeGeometry(star), bronze, x, .034, z); compass.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, r = radius - .34; put(x + Math.sin(a) * r, .034, z + Math.cos(a) * r, .045, .012, i % 3 ? .10 : .22, bronze); }
    }
    for (const tile of local) {
      // All four faces, where before only the two pointing away from the camera were carved. That choice
      // is the whole of the review's finding: every tall thing in the keep stood on the far wall, so the
      // near edge of every room was bare paving running off the bottom of the frame and nothing was ever
      // between the lens and the fight. What goes on the near faces is bounded by `headroom` below.
      for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
        if (cells.has(`${tile.x + dx},${tile.z + dz}`)) continue;
        // Out to the face of the retaining wall on the camera's side, where the buttresses below now start
        // from the waterline rather than from the deck; the far faces keep the old, tighter offset.
        const out = facesCamera(dx, dz) ? .62 : .54;
        const tx = (tile.x + dx * out) * TILE, tz = (tile.z + dz * out) * TILE;
        const near = headroom(tx - room.x * TILE, tz - room.z * TILE);
        // Ivy and the blind lancet below are a mesh apiece and the two new faces would double the count
        // for detail that reads at the back of the frame, where it already is. The near faces get the
        // instanced work only — silhouette, which is what they are here for, and no extra draw call.
        if (near !== Infinity) {
          // Close in to the knight there is no room to build upward, and the kerb is already the whole of
          // this edge; a cornice there would be a course of blocks nobody can see over it.
          if (near < 2.4 || near > OFF_FRAME || (tile.x + tile.z) % 4 !== 0) continue;
          // Buttresses, not posts. At the stride and slenderness the far wall uses, the near edge came out
          // as a row of identical pickets across the bottom of the frame — which is a fence, and reads as
          // one. Wider than they are on the far wall, a course shorter, spaced four tiles instead of
          // three, and each one takes its height off its own position so no two neighbours agree.
          const step = (Math.abs(tile.x * 7 + tile.z * 13)) % 5;
          const nh = Math.min(near, (room.theme === 'ruins' ? 1.9 : 2.3) + step * .42);
          // The reference's near mass is the platform's own retaining wall and the deck is the top of it —
          // dd-ss-07 is a wall face with counterforts and a coping, not furniture standing on the floor.
          // These began at y=.2, on the paving just inside the kerb, and read as posts on a terrace. They
          // now start in the water at -2.45, run up the outside of the foundation and finish one course
          // proud of the kerb, which is the same four instances and therefore the same triangles: only the
          // part above the deck has changed at all, and that part has not moved.
          const span = nh + 2.45;
          put(tx, (nh - 2.45) / 2, tz, dz ? 1.24 : 1.0, span, dx ? 1.24 : 1.0);
          put(tx + dx * .2, (nh - 2.45) / 2, tz + dz * .2, dz ? .86 : .44, span - .6, dx ? .86 : .44, pale);
          put(tx, -.14, tz, dz ? 1.5 : 1.22, .3, dx ? 1.5 : 1.22, pale);
          put(tx, nh - .1, tz, 1.16, .26, 1.16, pale);
          continue;
        }
        // One continuous cornice and footing visually bind the separate masonry courses.
        put(tx, .15, tz, dz ? 1.48 : .8, .25, dx ? 1.48 : .8, pale);
        // Salt-tolerant ivy breaks the rigid silhouette; attached to masonry outside the walking lane.
        if ((tile.x * 7 + tile.z * 11) % 4 === 0) {
          const leaves = new THREE.InstancedMesh(leafGeometry, foliage, 18), transform = new THREE.Matrix4();
          for (let i = 0; i < 18; i++) {
            const phase = i * 2.399 + tile.x, height = i / 17 * (room.theme === 'ruins' ? 2.3 : 1.35);
            transform.compose(new THREE.Vector3(tx - dx * .38 + Math.sin(phase) * .23, height - .25, tz - dz * .38 + Math.cos(phase) * .23), new THREE.Quaternion().setFromEuler(new THREE.Euler(.4, phase, .8)), new THREE.Vector3(.12 + i % 3 * .035, .19, .045));
            leaves.setMatrixAt(i, transform);
          }
          leaves.receiveShadow = true; world.add(leaves);
        }
        if ((tile.x + tile.z) % 3 !== 0) continue;
        // Raised: this is the far wall, the one the moon rakes across on its way into the room, and at
        // 3.55 it threw a shadow shorter than the pier was wide. The extra metre is the difference
        // between a dark edge under the masonry and a bar of shadow laid over the paving.
        const h = room.theme === 'ruins' ? 3.1 : 4.6;
        put(tx, h / 2, tz, .64, h, .64);
        put(tx - dx * .14, h / 2, tz - dz * .14, dz ? .22 : .68, h - .5, dx ? .22 : .68, pale);
        put(tx, h - .14, tz, .86, .23, .86, pale);
        put(tx, .38, tz, .86, .22, .86, pale);
        if (room.theme === 'ruins') continue;
        // A narrow blind lancet, entirely inside the existing wall thickness.
        const recess = new THREE.Shape(); recess.moveTo(-.38, 0); recess.lineTo(.38, 0); recess.lineTo(.38, 1.05); recess.quadraticCurveTo(.3, 1.43, 0, 1.66); recess.quadraticCurveTo(-.3, 1.43, -.38, 1.05); recess.closePath();
        const niche = mesh(new THREE.ShapeGeometry(recess), dark, tx - dx * .46, .9, tz - dz * .46); if (dx) niche.rotation.y = Math.PI / 2;
        const points = recess.getPoints(18).map(p => new THREE.Vector3(p.x, p.y, .012));
        const frame = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 40, .055, 4, true), bronze); niche.add(frame);
        const mullion = new THREE.Mesh(box, bronze); mullion.scale.set(.045, 1.2, .045); mullion.position.set(0, .64, .03); niche.add(mullion);
      }
    }
  }
  // The edge of the platform. Every frame in the set sits on a slab whose near edge is a kerb and then
  // nothing, with the bottom corners left as open water; the reference crowds those corners with the
  // terrace's own structure, and its near mass is always the retaining wall below the deck rather than
  // anything standing on it (dd-ss-07, dd-ss-11). These are counterforts on that wall: they start in the
  // water and stop below the top of the kerb, so there is no height at which one can be in front of
  // anybody. That is why this is the one piece of vertical work a corridor or a span can have — there is
  // no room heart out there to measure a `headroom` against, and everything that rises is measured.
  // Only the two down-screen faces get them: on the other two the retaining wall points away from the lens
  // and is never drawn, so building it there was paying for geometry with no frame to appear in.
  for (const tile of floor.tiles) {
    if (tile.wood || (tile.x * 5 + tile.z * 3) % 3) continue;
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (cells.has(`${tile.x + dx},${tile.z + dz}`)) continue;
      const tx = (tile.x + dx * .62) * TILE, tz = (tile.z + dz * .62) * TILE;
      put(tx, -1.1, tz, dz ? 1.12 : .94, 2.7, dx ? 1.12 : .94);
      put(tx, .14, tz, dz ? 1.32 : 1.1, .34, dx ? 1.32 : 1.1, pale);
    }
  }
  // The way through. The review's clearest single note was that nothing here spans overhead; dd-ss-01 and
  // dd-strike-30 both set a gate across the way in and read the play space through it, and we shipped a
  // column and a wall section, neither of which crosses anything. A doorway is the one place a span can
  // cross the floor the knight walks on without standing in it, so every arch is built on the mouth of a
  // passage. Up-screen of a room's heart it is backdrop — behind him in depth as much as on screen, so it
  // cannot hide him and its only effect is to give him a lit edge to read against. On the camera's side it
  // is held to `headroom` at 2.15 rather than the 1.05 the masonry takes: twice the clearance under his
  // feet, because an arch that crossed him would lose the round whatever else improved.
  const SPRING = 2.15, SPAN = .95;
  const ringGeometry = new THREE.TorusGeometry(SPAN, .2, 5, 18, Math.PI), barGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rings: { x: number; y: number; z: number; turn: boolean }[] = [];
  const bars: { x: number; y: number; z: number; sy: number }[] = [];
  for (const room of floor.rooms) {
    const mouths: { x: number; z: number; dx: number; dz: number; near: number; door: boolean }[] = [];
    for (const tile of floor.tiles) {
      if (tile.room !== room.id) continue;
      for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
        // Only a face that looks toward the lens, and this is the whole safety argument. Beyond a mouth on
        // that side the run carries on down-screen, so anyone standing out there has the gate behind them
        // in depth and it cannot cover them at any height; anyone inside the chamber has it in front,
        // where `headroom` holds its crown two and a bit screen units under his feet. A mouth opening the
        // other way has neither guarantee — the first build of this put one at the knight's elbow in the
        // corridor shot, because the clamp was measured from a room heart he was nowhere near.
        if (!facesCamera(dx, dz)) continue;
        const next = owner.get(`${tile.x + dx},${tile.z + dz}`);
        if (next === room.id) continue;
        // A doorway is the better gate because something walks through it. But a chamber whose ways out
        // all run away from the camera would get none, which is most of them — so the near perimeter takes
        // one too, standing on the retaining wall over open water with nothing under it at all. That is
        // what dd-strike-30 actually shows: the arch is not in a doorway, it is on the wall at the near
        // edge, and the fight is read through it.
        const door = next !== undefined;
        const ax = (tile.x + dx * (door ? .5 : .52)) * TILE, az = (tile.z + dz * (door ? .5 : .52)) * TILE;
        const near = headroom(ax - room.x * TILE, az - room.z * TILE, 2.15);
        if (near < SPRING + SPAN + .45 || near > 7.4) continue;
        mouths.push({ x: ax, z: az, dx, dz, near, door });
      }
    }
    // A passage before a parapet, then whichever sits nearest the sweet spot down the frame — far enough
    // that the crown is well under him, near enough that the whole arch is still on screen. A two-wide
    // mouth yields one gate rather than a pair standing shoulder to shoulder in it.
    mouths.sort((a, b) => (a.door ? 0 : 1) - (b.door ? 0 : 1) || Math.abs(a.near - 5.2) - Math.abs(b.near - 5.2));
    const gates: typeof mouths = [];
    for (const mouth of mouths) {
      if (gates.length >= 2) break;
      if (gates.some(g => Math.hypot(g.x - mouth.x, g.z - mouth.z) < 4.2)) continue;
      gates.push(mouth);
    }
    for (const gate of gates) {
      const run: [number, number] = gate.dz ? [1, 0] : [0, 1];
      // The piers stand outside the walking lane and carry down to the waterline, so the gate is part of
      // the platform rather than a hoop set on top of it.
      for (const side of [-1, 1]) {
        const lx = gate.x + run[0] * SPAN * side, lz = gate.z + run[1] * SPAN * side;
        put(lx, (SPRING - 2.3) / 2, lz, .38, SPRING + 2.3, .38, pale);
        put(lx, SPRING - .12, lz, run[0] ? .52 : .46, .26, run[1] ? .52 : .46, pale);
      }
      rings.push({ x: gate.x, y: SPRING, z: gate.z, turn: gate.dx !== 0 });
      put(gate.x, SPRING + SPAN + .14, gate.z, run[0] ? .8 : .46, .34, run[1] ? .8 : .46, pale);
      // Three bars in the lunette and none below them: what makes it read as a gate rather than a hoop,
      // clear of the lane he walks through, and twelve triangles apiece instead of a hundred and eight.
      for (const at of [-.46, 0, .46]) bars.push({ x: gate.x + run[0] * at * SPAN, y: SPRING, z: gate.z + run[1] * at * SPAN, sy: Math.sqrt(1 - at * at) * SPAN - .1 });
    }
  }
  // Spatial batches keep invisible wings out of both the view and shadow pass.
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), at = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const material of [stone, pale, bronze]) {
    const regions = new Map<string, typeof blocks>();
    // Tightened from 18. An instanced batch is culled whole, so a region wide enough to hold a chamber and
    // its neighbour was drawn entire — and in the shadow pass as well — the moment a corner of it clipped
    // either frustum, which at a hundred and eight triangles a block is what funds this round. Seventeen is
    // where the two counters balance: finer draws fewer triangles and costs more calls than the junction,
    // which is the tightest frame for calls, has left.
    for (const b of blocks) { if (b.material !== material) continue; const key = `${Math.floor(b.x / 17)},${Math.floor(b.z / 17)}`; const region = regions.get(key); if (region) region.push(b); else regions.set(key, [b]); }
    for (const local of regions.values()) {
      const batch = new THREE.InstancedMesh(box, material, local.length);
      local.forEach((b, i) => { matrix.compose(at.set(b.x, b.y, b.z), rotation, scale.set(b.sx, b.sy, b.sz)); batch.setMatrixAt(i, matrix); });
      batch.castShadow = batch.receiveShadow = true; world.add(batch);
    }
  }
  if (rings.length) {
    const arches = new THREE.InstancedMesh(ringGeometry, pale, rings.length);
    rings.forEach((r, i) => { rotation.setFromEuler(new THREE.Euler(0, r.turn ? Math.PI / 2 : 0, 0)); matrix.compose(at.set(r.x, r.y, r.z), rotation, scale.set(1, 1, 1)); arches.setMatrixAt(i, matrix); });
    arches.receiveShadow = true; world.add(arches);
    const grille = new THREE.InstancedMesh(barGeometry, bronze, bars.length);
    rotation.identity();
    bars.forEach((b, i) => { matrix.compose(at.set(b.x, b.y + b.sy / 2, b.z), rotation, scale.set(.07, b.sy, .07)); grille.setMatrixAt(i, matrix); });
    world.add(grille);
  } else { ringGeometry.dispose(); barGeometry.dispose(); }
}
