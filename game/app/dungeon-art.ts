import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TILE, type generateFloor } from './dungeon-floor';
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
export const headroom = (a: number, b: number) => {
  const base = screenUp(a, b);
  return base >= 0 ? Infinity : (-1.05 - base) / RISE;
};
/**
 * Past this much headroom the offset is so far down-frame that the top of the tallest thing allowed there
 * still falls below the bottom edge, so nothing built on it can ever be seen from the middle of the room.
 * The widest halls run a long way past it, and building their near perimeter was the single largest line
 * in the triangle count for geometry with no frame to appear in.
 */
export const OFF_FRAME = 9.6;

// Broad reflected light makes metal read as metal without another live light or render pass.
export function vaultEnvironment() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#b9d8e1'); sky.addColorStop(.38, '#557a8b');
  sky.addColorStop(.52, '#152d39'); sky.addColorStop(1, '#111a20');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 256);
  const opening = ctx.createRadialGradient(145, 68, 2, 145, 68, 100);
  opening.addColorStop(0, '#fff5da'); opening.addColorStop(.25, '#dbe8e8cc'); opening.addColorStop(1, '#dbe8e800');
  ctx.fillStyle = opening; ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

// These are surface details and silhouettes on existing walls, never new obstacles.
export function addCarvedArchitecture(world: THREE.Group, floor: ReturnType<typeof generateFloor>) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x82908b, roughness: .82 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x9ba797, roughness: .7 });
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
        const tx = (tile.x + dx * .54) * TILE, tz = (tile.z + dz * .54) * TILE;
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
          put(tx, .2, tz, dz ? 1.38 : 1.16, .34, dx ? 1.38 : 1.16, pale);
          put(tx, nh / 2, tz, .92, nh, .92);
          put(tx - dx * .16, nh / 2, tz - dz * .16, dz ? .3 : .96, nh - .55, dx ? .3 : .96, pale);
          put(tx, nh - .1, tz, 1.14, .26, 1.14, pale);
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
  // Spatial batches keep invisible wings out of both the view and shadow pass.
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), at = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const material of [stone, pale, bronze]) {
    const regions = new Map<string, typeof blocks>();
    for (const b of blocks.filter(b => b.material === material)) { const key = `${Math.floor(b.x / 18)},${Math.floor(b.z / 18)}`; const region = regions.get(key); if (region) region.push(b); else regions.set(key, [b]); }
    for (const local of regions.values()) {
      const batch = new THREE.InstancedMesh(box, material, local.length);
      local.forEach((b, i) => { matrix.compose(at.set(b.x, b.y, b.z), rotation, scale.set(b.sx, b.sy, b.sz)); batch.setMatrixAt(i, matrix); });
      batch.castShadow = batch.receiveShadow = true; world.add(batch);
    }
  }
}
