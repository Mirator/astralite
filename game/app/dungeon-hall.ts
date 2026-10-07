import * as THREE from 'three';
import type { ArmoryPalette } from './dungeon-armory.ts';
import { ARM_PRICES, UPGRADES } from './dungeon-meta.ts';

// Plan 025 (D8): what the Tide Altar's hall draws for its shop, beside the racks `makeWeaponDrop` already lays. Built once per hall build and released
// with it (`dispose`), so leaving the hall leaves nothing resident. No light is added: Stage B owns the light pool, so everything here that glows is
// unlit or emissive. The rules it shows (prices, ranks, what is affordable) are dungeon-meta's; nothing here decides anything.

/** Every price the hall can show, ascending: one row of the plaque atlas each. */
const PRICES = [...new Set([...Object.values(ARM_PRICES), ...UPGRADES.flatMap(upgrade => Array.from({ length: upgrade.ranks }, (_, held) => upgrade.price(held)))])].sort((a, b) => a - b);
const ROW = 48, WIDTH = 128;

/** Where a plaque stands from its rack or shrine, toward the camera (CAMERA_OFFSET's horizontal part), and how it is turned to face it. */
const FACING = Math.atan2(9.2, 11.5), TOWARD = { x: Math.sin(FACING), z: Math.cos(FACING) };

export type Shrine = { id: string; x: number; z: number; group: THREE.Group; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; glyph: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>; notches: THREE.Mesh[]; lit: number; held: number; ranks: number; plaque: THREE.Mesh | null; price: number | null };

export function createHallKit() {
  // A locked arm is drawn whole, in one dark stone: every slot of the knight's palette is the same material, so the bake folds the arm, its plinth and
  // collar into a single mesh, and `release` (which spares a palette's materials) never disposes it with a rack.
  const shade = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 1, metalness: 0, emissive: 0x0a1c22, emissiveIntensity: .6 });
  const silhouette: ArmoryPalette = { steel: shade, iron: shade, brass: shade, leather: shade, dark: shade, shadow: shade };
  // The plaques' prices, one row a price, drawn once.
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = ROW * PRICES.length;
  const pen = canvas.getContext('2d');
  if (pen) {
    pen.clearRect(0, 0, canvas.width, canvas.height);
    PRICES.forEach((price, row) => {
      const y = row * ROW;
      pen.fillStyle = 'rgba(14,22,26,.92)'; pen.fillRect(2, y + 2, WIDTH - 4, ROW - 4);
      pen.strokeStyle = '#d9b46a'; pen.lineWidth = 3; pen.strokeRect(3.5, y + 3.5, WIDTH - 7, ROW - 7);
      pen.fillStyle = '#fff4d8'; pen.font = 'bold 30px Georgia, serif'; pen.textAlign = 'right'; pen.textBaseline = 'middle'; pen.fillText(String(price), WIDTH - 46, y + ROW / 2 + 1);
      // The pearl.
      pen.beginPath(); pen.arc(WIDTH - 28, y + ROW / 2, 9, 0, Math.PI * 2); pen.fillStyle = '#efe6d2'; pen.fill();
      pen.beginPath(); pen.arc(WIDTH - 31, y + ROW / 2 - 3, 3, 0, Math.PI * 2); pen.fillStyle = '#ffffff'; pen.fill();
    });
  }
  const atlas = new THREE.CanvasTexture(canvas); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  // Affordable plaques burn warm; one the purse cannot cover is dimmed, so the hall says what can be bought before anything is walked to.
  const ready = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, toneMapped: false, depthWrite: false, color: 0xffffff });
  const short = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, toneMapped: false, depthWrite: false, color: 0x6c7276 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x3b4b50, roughness: .92, metalness: .05 });
  const notchLit = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
  const notchDark = new THREE.MeshStandardMaterial({ color: 0x182125, roughness: .8 });
  const plinth = new THREE.CylinderGeometry(.4, .52, .78, 8), glyphShape = new THREE.OctahedronGeometry(.24), notchShape = new THREE.BoxGeometry(.13, .09, .06);
  plinth.userData.shared = true; glyphShape.userData.shared = true; notchShape.userData.shared = true;

  /** A plaque for a price, standing in front of (x, z) and turned to the camera; its own geometry (the atlas row is in its UVs), shared materials. */
  const plaque = (price: number, affordable: boolean, x: number, z: number) => {
    const row = Math.max(0, PRICES.indexOf(price)), geometry = new THREE.PlaneGeometry(.66, .25), uv = geometry.attributes.uv as THREE.BufferAttribute;
    const top = 1 - row / PRICES.length, bottom = 1 - (row + 1) / PRICES.length;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > .5 ? top : bottom);
    const mesh = new THREE.Mesh(geometry, affordable ? ready : short);
    mesh.position.set(x + TOWARD.x * .78, .3, z + TOWARD.z * .78); mesh.rotation.set(-.5, FACING, 0, 'YXZ'); mesh.renderOrder = 3;
    mesh.userData.price = price;
    return mesh;
  };

  /** An upgrade's shrine: a stone plinth, a crystal over it that burns when the next rank is affordable, one notch for each rank (lit for each held), and a ring like a rack's. */
  const shrine = (id: string, x: number, z: number, held: number, ranks: number, price: number | null, affordable: boolean): Shrine => {
    const group = new THREE.Group(); group.position.set(x, 0, z);
    const base = new THREE.Mesh(plinth, stone); base.position.y = .39; base.castShadow = true; base.receiveShadow = true; group.add(base);
    const glyph = new THREE.Mesh(glyphShape, new THREE.MeshStandardMaterial({ color: 0xbfe9f2, emissive: price === null ? 0xd9b46a : 0x4fb8cf, emissiveIntensity: affordable || price === null ? 1.8 : .45, roughness: .25, metalness: .2 }));
    glyph.position.y = 1.08; group.add(glyph);
    // The notches sit on the face the camera sees, a row across the plinth's shoulder.
    const notches: THREE.Mesh[] = [];
    for (let rank = 0; rank < ranks; rank++) {
      const notch = new THREE.Mesh(notchShape, rank < held ? notchLit : notchDark);
      const across = (rank - (ranks - 1) / 2) * .19;
      notch.position.set(TOWARD.x * .45 + Math.cos(FACING) * across, .62, TOWARD.z * .45 - Math.sin(FACING) * across); notch.rotation.y = FACING;
      notch.userData.lit = rank < held; group.add(notch); notches.push(notch);
    }
    const ring: Shrine['ring'] = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.3, 40), new THREE.MeshBasicMaterial({ color: 0x7fd8e6, transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .05; group.add(ring);
    return { id, x, z, group, ring, glyph, notches, lit: 0, held, ranks, plaque: price === null ? null : plaque(price, affordable, x, z), price };
  };

  // The pearls a purchase sends from the altar to what was bought: one instanced draw, a fixed arc each, no random draw.
  const PEARLS = 10, pearlShape = new THREE.SphereGeometry(.09, 8, 6), pearlSkin = new THREE.MeshBasicMaterial({ color: 0xf3ecd8, toneMapped: false });
  const pearls = new THREE.InstancedMesh(pearlShape, pearlSkin, PEARLS); pearls.frustumCulled = false; pearls.count = 0; pearls.visible = false;
  const flights: { from: THREE.Vector3; to: THREE.Vector3; age: number; delay: number; lift: number }[] = [];
  const at = new THREE.Vector3(), matrix = new THREE.Matrix4(), landing = new THREE.Vector3(), FLIGHT = .45;
  const flight = {
    mesh: pearls,
    get active() { return flights.length; },
    /** Sends the burst from `from` to `to`. */
    fly(from: THREE.Vector3, to: THREE.Vector3) {
      flights.length = 0; landing.copy(to);
      for (let i = 0; i < PEARLS; i++) flights.push({ from: from.clone(), to: to.clone().add(new THREE.Vector3(Math.cos(i * 2.4) * .25, 0, Math.sin(i * 2.4) * .25)), age: 0, delay: i * .025, lift: 1.4 + (i % 3) * .35 });
    },
    /** Advances the pearls; where they land on the frame the last one does, else null. */
    step(dt: number): THREE.Vector3 | null {
      if (!flights.length) return null;
      let shown = 0;
      for (const pearl of flights) {
        pearl.age += dt;
        const k = Math.min(1, Math.max(0, (pearl.age - pearl.delay) / FLIGHT));
        at.lerpVectors(pearl.from, pearl.to, k); at.y += Math.sin(k * Math.PI) * pearl.lift;
        matrix.makeTranslation(at.x, at.y, at.z); pearls.setMatrixAt(shown++, matrix);
      }
      pearls.count = shown; pearls.visible = shown > 0; pearls.instanceMatrix.needsUpdate = true;
      const done = flights.every(pearl => pearl.age >= pearl.delay + FLIGHT);
      if (done) { flights.length = 0; pearls.count = 0; pearls.visible = false; }
      return done ? landing : null;
    },
  };

  return {
    silhouette, plaque, shrine, flight, ready, notchLit,
    /** Releases every GPU resource the kit made. The meshes that wore them are the floor's and go with it. */
    dispose() {
      for (const material of [shade, ready, short, stone, notchLit, notchDark, pearlSkin]) material.dispose();
      for (const geometry of [plinth, glyphShape, notchShape, pearlShape]) geometry.dispose();
      atlas.dispose(); pearls.dispose(); pearls.removeFromParent();
    },
  };
}
export type HallKit = ReturnType<typeof createHallKit>;
