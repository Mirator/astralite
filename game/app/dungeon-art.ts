import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { planFloorMotifs } from './dungeon-decor-layout.ts';
import { buildFloorMotifs } from './dungeon-floor-motifs.ts';
import { type Room, TILE, type generateFloor } from './dungeon-floor';
import { weatherStone } from './dungeon-motion';
import { applyStoneTextures, getMasonryTextures } from './dungeon-textures';

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
 * ruin, drowned blue-green over the flood.
 *
 * The saturated thing each family leaves against itself is its fire. That was the piece missing for
 * a long while: the four torches burned one hardcoded amber everywhere, so a theme could only be a
 * filter over the stone rather than a place, and every tell in the game was fighting the same lamps
 * for the same band of hue. The keep burns cold witchfire, the ruin burns real flame, the flood
 * glows with whatever grows down there. Two of the three are off amber, which is what leaves hot red
 * free for the one mark the player has to answer on a deadline.
 *
 * The paving sits low and saturated rather than mid and grey, so anything standing on it separates
 * without being lit specially: the key lights lost chroma in the same pass the stone gained it,
 * because an ambient that is already tinted stops a lit pool reading as a pool.
 */
export type Mood = {
  key: number; keyIntensity: number; sky: number; ground: number; hemisphere: number;
  fog: number; fogDensity: number; background: number; environment: number;
  tile: number; border: number; block: number; foundation: number; seal: number;
  /** What burns here: torch light, flame, halo and embers all take it. */
  fire: number;
  /** The one saturated accent hung on cloth, one per family. */
  banner: number;
  /**
   * Carved work: columns, cornices, archivolts, parapets, footings and the bowls fire sits in.
   *
   * It used to be one neutral grey for the whole keep on the reasoning that the chamber's light
   * would decide which way it read. Light tints; it does not darken. Neutral at that value came out
   * of every key in the game as the brightest thing in the frame after the fire, brighter than the
   * knight, so every column and arch was competing with the one figure the eye has to hold. It takes
   * the family now, a few points above `block` so a standing column still parts from the wall behind
   * it, and low enough to belong to the field rather than to the figures on it.
   *
   * It sits under the paving, not over it. Measured off the frames, carved work and coursework were
   * running twenty points of lightness above the floor they stood on, which makes a chamber a bright
   * cage around a dark pit and leaves nothing in it reading as lit by the braziers. The reference does
   * the reverse: rock is the darkest mass and the lit floor is the brightest.
   */
  masonry: number;
  water: [number, number, number];
  moss: [number, number, number]; mossAmount: number;
  warm: [number, number, number]; cool: [number, number, number]; crown: [number, number, number];
};
// Plan 014 round B: every room keeps a cool teal ambient - sky, ground bounce, key and fog - and the
// theme's warmth (ruins amber) or colour (keep violet) is left to the point-light pools alone. Before
// this the ruin's sky and fog were brown and the keep's blue-violet, so each frame was one tint.
export const ROOM_MOOD: Record<Room['theme'], Mood> = {
  keep: {
    key: 0xc8dde2, keyIntensity: 6, sky: 0x6c98a6, ground: 0x0f1a1d, hemisphere: .62,
    fog: 0x0a1519, fogDensity: .024, background: 0x0f1a29, environment: .34,
    tile: 0x485670, border: 0x344055, block: 0x3d495c, foundation: 0x1f2737, seal: 0x72a5ca,
    fire: 0xa870e6, banner: 0x3a5c88, masonry: 0x475366,
    water: [.68, .78, 1],
    moss: [.7, .78, .94], mossAmount: .24,
    warm: [1.06, 1.06, 1.03], cool: [.8, .89, 1.07], crown: [1.02, 1.07, 1.18],
  },
  ruins: {
    key: 0xc9dad9, keyIntensity: 5.2, sky: 0x6d929a, ground: 0x141c1c, hemisphere: .62,
    fog: 0x10191a, fogDensity: .021, background: 0x141d1f, environment: .34,
    tile: 0x5e4f3a, border: 0x453a2a, block: 0x5a4d3a, foundation: 0x352a1d, seal: 0xc4a164,
    fire: 0xff913d, banner: 0x345865, masonry: 0x665842,
    water: [.52, .64, .7],
    moss: [.86, .78, .58], mossAmount: .3,
    warm: [1.16, 1.05, .86], cool: [.95, .89, .8], crown: [1.18, 1.07, .88],
  },
  flooded: {
    key: 0xccdde1, keyIntensity: 6, sky: 0x69a2ab, ground: 0x0f1c1f, hemisphere: .64,
    // Plan 014 round 6 (lever 3): this used to sit at 0x081417 and .03 - dark enough, with the
    // steepest density of the three moods, that the far side of any room this theme touched read as a
    // flat black void rather than a fogged-out distance. Raised toward the same dark teal the water
    // and the moss already carry, and the density backed down to match `keep` - the fog still reads
    // as depth, not as the frame running out of scene.
    fog: 0x15353c, fogDensity: .024, background: 0x0d2126, environment: .36,
    tile: 0x3c5e62, border: 0x2b474a, block: 0x365054, foundation: 0x192b2e, seal: 0x5cb3bc,
    fire: 0x18c9dc, banner: 0x428a7b, masonry: 0x405a5e,
    water: [1, 1, 1],
    // Off the green it used to sit on. The flood is the one family a shrine has to read out of, and
    // a green cast on its stone was the thing that made the shrine agree with the room.
    moss: [.58, .78, .84], mossAmount: .34,
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
  // Plan 014 round 3 (lever A2): a dim, neutral map gives a wet surface nothing to reflect but grey -
  // measured, that is exactly why a low-roughness puddle read as "darker stone" rather than as a
  // sheen. Four bright cards, standing in for a torch and a brazier seen at reflection distance -
  // two warm, two cool - so a narrow specular lobe over a puddle actually picks up colour.
  const card = (cx: number, cy: number, w: number, h: number, colour: string) => {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w);
    glow.addColorStop(0, colour); glow.addColorStop(.55, colour.slice(0, 7) + 'aa'); glow.addColorStop(1, colour.slice(0, 7) + '00');
    ctx.fillStyle = glow; ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
  };
  card(60, 150, 70, 46, '#ffb35bff'); card(430, 170, 60, 40, '#ff9a4aff');
  card(250, 190, 65, 42, '#3fd8dcff'); card(360, 40, 55, 34, '#8f7bffff');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/**
 * Plan 014 round 2: the ground telegraph used to be a flat colour at a material opacity the code set
 * to 1 the instant a windup began, which is a solid, opaque slab of red big enough to swallow the
 * bodies standing on it - not the reference's translucent warning square with a bright rim and a
 * single arrow through it.
 *
 * Plan 014 round 3: round 2's version stacked three chevrons and tiled the whole thing 2x2, which
 * read as scribbled internal streaks rather than a mark - a ring's own UV wraps that pattern at an
 * angle no caller chose, and two overlapping copies of three lines apiece is a lot of line to read at
 * once. One chevron, one rim, `repeat` left at its default 1x1: whatever shape holds this texture
 * shows exactly this canvas, once, the way the reference's own red square does.
 *
 * Plan 014 round 4: round 3's single centred chevron and hard-edged 20% fill still read as a pasted
 * UI decal rather than a warning burned into the floor - a flat rectangle of colour with one bold
 * glyph in the middle is exactly what a UI sprite looks like. This version fills at 11%, perturbs
 * that fill with noise and fades it toward every border rather than cutting it off square, and moves
 * the arrows to a small repeated row along the *leading* edge only (high v, the direction every cue
 * in the keep already reads) instead of one glyph spanning the whole shape. The material draws this
 * additively now (see the two call sites in dungeon-game.tsx), so what shows through is genuinely the
 * stone underneath brightened, not a sprite laid over it.
 */
/**
 * Plan 014 round B: the arc telegraph (guard and warden), rebuilt as one coherent soft ground shape.
 * The previous texture was a faint noise-eaten gradient (8-25% alpha) with two small solid arrow glyphs
 * - so the only parts of the mark that actually read on screen were the glyphs, and on the stalker's
 * 5 x 1.7 lane they stretched into the loose floating red slivers the critic read as a broken mesh.
 * Now: a solid, soft-edged band that fills the ring sector (RingGeometry's UVs are planar, so the band
 * sits between radius .283 and .5 of the canvas - the geometry's .85/1.5 inner/outer), a slightly
 * stronger feathered rim at its outer edge, and one small arrow at the leading edge (+x, the aim).
 */
export function telegraphTexture() {
  const size = 128, c = size / 2;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const band = ctx.createRadialGradient(c, c, 0, c, c, c);
  band.addColorStop(0, 'rgba(255,82,52,0)'); band.addColorStop(.5, 'rgba(255,82,52,0)');
  band.addColorStop(.6, 'rgba(255,82,52,.24)'); band.addColorStop(.84, 'rgba(255,82,52,.3)');
  band.addColorStop(.93, 'rgba(255,104,72,.62)'); band.addColorStop(1, 'rgba(255,82,52,0)');
  ctx.fillStyle = band; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,140,110,.8)';
  ctx.beginPath(); ctx.moveTo(c + 57, c); ctx.lineTo(c + 45, c - 7); ctx.lineTo(c + 45, c + 7); ctx.closePath(); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Plan 014 round B: the stalker's lunge lane - a filled, soft-edged rounded rectangle along the lane
 * (u runs from the stalker, 0, to the far end, 1), a feathered rim, and one small arrow near the far
 * end. Drawn per pixel from a signed distance so every edge is feathered and nothing is a stroke.
 * The canvas has close to the lane's own 5:1.7 aspect so the arrow is not stretched into a sliver.
 */
export function laneTelegraphTexture() {
  const w = 256, h = 88, r = 34, feather = 7;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Signed distance to a rounded rectangle inset by the feather width.
    const qx = Math.abs(x + .5 - w / 2) - (w / 2 - feather - r), qy = Math.abs(y + .5 - h / 2) - (h / 2 - feather - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const inside = Math.min(1, Math.max(0, -d / feather + .5));
    const rim = Math.min(1, Math.max(0, 1 - Math.abs(d + 6) / 6));
    const start = Math.min(1, x / (w * .1));
    const a = inside * (.12 + rim * .24) * (.35 + .65 * start);
    const i = (y * w + x) * 4;
    image.data[i] = 255; image.data[i + 1] = 84; image.data[i + 2] = 56; image.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(image, 0, 0);
  ctx.fillStyle = 'rgba(255,140,110,.8)';
  ctx.beginPath(); ctx.moveTo(w - 22, h / 2); ctx.lineTo(w - 44, h / 2 - 13); ctx.lineTo(w - 44, h / 2 + 13); ctx.closePath(); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Plan 014 round 2 (lever D10): the alert glyph shown over a body that has just noticed the knight and
 * has not yet settled into its own windup - the reference marks exactly this moment with a small red
 * exclamation, which is what turns "a body somewhere started moving" into "that one has seen you."
 */
export function alertTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ff4529';
  ctx.beginPath(); ctx.moveTo(24, 4); ctx.lineTo(40, 4); ctx.lineTo(36, 38); ctx.lineTo(28, 38); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(32, 52, 7, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The ring of a gate, moulded. An arch is the most worked stone in any keep and ours was a half torus
 * with a round section — a pale tube, carrying no information at any distance, which is exactly what the
 * review said of it. This sweeps a cut profile round the same half circle instead: a flat soffit under
 * the opening, a chamfer up to the face of the inner order, a reveal stepping back, the outer order
 * proud of it, and a chamfered extrados. Every one of those is an edge the key light breaks on, and the
 * whole of it is still one geometry on one instanced mesh — the cost is triangles, which this round has,
 * and not a draw call, which it has not.
 *
 * Non-indexed on purpose: `computeVertexNormals` then gives each facet its own normal, so the steps stay
 * steps instead of being smoothed into the tube we started with.
 */
export function archivolt(span: number, segments = 20) {
  // (radial offset from the centreline, offset through the wall). Counter-clockwise, closed.
  const profile: [number, number][] = [
    [-.19, -.17], [-.19, .17], [-.12, .26], [.00, .26], [.03, .18], [.09, .18],
    [.16, .09], [.16, -.09], [.09, -.18], [.03, -.18], [.00, -.26], [-.12, -.26],
  ];
  const at = (i: number, k: number) => {
    const angle = i / segments * Math.PI, [u, v] = profile[k % profile.length];
    return [Math.cos(angle) * (span + u), Math.sin(angle) * (span + u), v];
  };
  const position: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < profile.length; k++) {
      const a = at(i, k), b = at(i, k + 1), c = at(i + 1, k + 1), d = at(i + 1, k);
      position.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
  geometry.computeVertexNormals();
  return geometry;
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
  applyStoneTextures(stone, getMasonryTextures(), .7); applyStoneTextures(pale, getMasonryTextures(), .7);
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa88951, metalness: .65, roughness: .48 });
  // The medallion's own inlay, split off from `bronze` for two reasons that turned out to be the same
  // reason. Measured off a frame, its star sat brighter than the knight standing on it, which made the
  // busiest, most detailed thing within a body's width of him something he had to be read against
  // rather than with. And it was a hard bright brass ring on the floor of every chamber — the exact
  // form and family the stair is the only thing allowed to speak in. Worn inlay, in the chamber's own
  // stone, a little above the slate it is set into and nowhere near either.
  // Sunk into the slate rather than laid on it, and the hardest of these to get right. Off brass it
  // still clipped to white under every key in the game, and the cause is not the colour: the star is
  // an unmapped horizontal face, so where the paving beside it loses light to a texture, a bump and
  // `weatherStone`, the inlay takes the moon flat and full. Nothing short of putting it under the
  // paving fixes that, and a tenth of a lift off the bed was still a lift: measured, the star ran
  // twenty-six to forty-six points of lightness over its own paving with the knight standing on it.
  //
  // So the star goes under its bed. Taking everything under the bed was the over-correction that
  // followed: rings, ticks and star all inside three points of it, which is a stain rather than an
  // engraving. A cut reads as a cut because it has both edges — a dark trough and a lit lip — so the
  // star and the ticks take the trough and the three rings take the lip. The rings are a quarter of a
  // unit wide, which is the whole reason the lip can be lifted at all: at that width it is a drawn
  // line, where the same value across the star's face was a slab catching the moon.
  const inlay = new THREE.MeshStandardMaterial({ color: 0x3a3d36, metalness: .05, roughness: .92 });
  const lip = new THREE.MeshStandardMaterial({ color: 0x55594f, metalness: .05, roughness: .9 });
  // The inlaid medallion is the largest single shape on a chamber floor; flat, it read as a hole cut in
  // the paving rather than as worn slate set into it. The weathering is multiplicative and reads at any
  // base value, so the base goes back down to where it was: the disc fills most of the frame right
  // around the knight in four of the eight scenes, and lifting it was spending his contrast for nothing.
  // Hardcoded, this was a cold navy disc punched into the ruin's warm tan floor and invisible against
  // the flood's, which is the same fault the carved work had: a value chosen once for a keep that only
  // had one palette. It takes the chamber's foundation stone now, a shade under the paving it is set
  // into, so the medallion reads as worn slate in every family rather than as a hole in two of them.
  const dark = new THREE.MeshStandardMaterial({ color: 0x152c32, roughness: .86 }); weatherStone(dark);
  const foliage = new THREE.MeshStandardMaterial({ color: 0x52735b, roughness: .95, side: THREE.DoubleSide });
  const leafGeometry = new THREE.OctahedronGeometry(1);
  const box = new RoundedBoxGeometry(1, 1, 1, 1, .08);
  const blocks: { x: number; y: number; z: number; sx: number; sy: number; sz: number; material: THREE.Material; turn: number }[] = [];
  // `turn` is the whole of the turned work in the keep and it costs nothing at all. A batch already
  // composes a quaternion per instance and was feeding it the identity; a drum rotated an eighth of a
  // circle between two square courses reads as an octagon on a lathe at this distance, which is what the
  // reference's balusters and newels actually are. The same field, at a fortieth of a radian, is what
  // stops a course of ashlar reading as one extrusion: no two blocks share an edge line any more.
  const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material = stone, turn = 0) => blocks.push({ x, y, z, sx, sy, sz, material, turn });
  /**
   * A base and a cap instead of a box. Three courses — a spreading plinth, a chamfered drum turned an
   * eighth of a circle, and a fillet the shaft stands on — read as a moulded pedestal from the only
   * angle this camera has, and cost two instances of the geometry every block here already uses. `sign`
   * points the spread away from the shaft: down for a base, up for a capital.
   */
  const moulding = (x: number, y: number, z: number, wide: number, course: number, sign: number, material = pale) => {
    put(x, y, z, wide * .72, course, wide * .72, material);
    put(x, y + sign * course * .95, z, wide * .62, course * .9, wide * .62, material, Math.PI / 4);
    put(x, y + sign * course * 1.85, z, wide, course * .8, wide, material);
  };
  // Props occupy holes in floor.tiles; they are interior floor, never perimeter walls.
  const cells = new Set([...floor.tiles, ...floor.props].map(t => `${t.x},${t.z}`));
  const owner = new Map<string, number>(); for (const t of floor.tiles) owner.set(`${t.x},${t.z}`, t.room);
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z); item.receiveShadow = true; world.add(item); return item;
  };
  // Every chamber used to carve the same 16-point compass into its own medallion bed - the same
  // decoration in almost every room, whatever the theme. `planFloorMotifs` gives each room at most
  // one of three theme-distinct constructions instead (see `dungeon-floor-motifs.ts`), skipping a
  // gauntlet or the goal room entirely and reasoning about a sanctuary's shrine centre and the
  // weapon drop's own clearance so a motif never spills onto a feature that owns its floor already.
  const motifs = buildFloorMotifs(world, floor, planFloorMotifs(floor), { dark, inlay, lip });
  for (const room of floor.rooms) {
    const local = floor.tiles.filter(t => t.room === room.id && !t.wood);
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
          // Every third counterfort carries a newel, and it is paid for by shortening the shaft rather
          // than by building higher: `crown` is set so the top of the finial lands exactly where the
          // flat cap used to, still inside `nh` and therefore still inside `headroom`. Nothing in the
          // near field has risen a millimetre; it has only been cut.
          const newel = (tile.x * 3 + tile.z * 7) % 3 === 0;
          const crown = newel ? nh - .58 : nh;
          const span = crown + 2.45;
          put(tx, (crown - 2.45) / 2, tz, dz ? 1.24 : 1.0, span, dx ? 1.24 : 1.0);
          put(tx + dx * .2, (crown - 2.45) / 2, tz + dz * .2, dz ? .86 : .44, span - .6, dx ? .86 : .44, pale);
          put(tx, -.14, tz, dz ? 1.5 : 1.22, .3, dx ? 1.5 : 1.22, pale);
          // A coping, not a lid: a chamfer course drawn in under an overhanging cap, so the top of the
          // near wall throws a shadow line along itself instead of ending on one flat plane.
          put(tx, crown - .18, tz, 1.06, .18, 1.06, pale);
          put(tx, crown, tz, 1.26, .17, 1.26, pale);
          if (newel) { put(tx, crown + .19, tz, .50, .24, .50, pale, Math.PI / 4); put(tx, crown + .38, tz, .58, .14, .58, pale); }
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
        // Was a flat slab on top and a flat slab at the bottom — the two things the review meant by
        // "flat-capped". A capital is a necking, a spreading echinus turned off square, and an abacus,
        // and it is three instances of the block this batch already draws.
        moulding(tx, h - .46, tz, .88, .15, 1);
        // The base gets two courses rather than three: it is half-buried behind the kerb in most frames
        // and the third was paying a full block for stone nobody can see.
        put(tx, .48, tz, .70, .16, .70, pale, Math.PI / 4);
        put(tx, .3, tz, .92, .2, .92, pale);
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
      // One .34 slab became a chamfer and an overhanging cap of the same total height, finishing at the
      // same .31 the old one did — so the promise that nothing out here can ever be in front of anybody
      // is untouched, and the longest continuous edge in the keep has a moulding on it instead of being
      // the top of an extrusion. One extra instance per counterfort, no extra draw.
      if ((tile.x * 5 + tile.z * 7) % 2) { put(tx, .14, tz, dz ? 1.32 : 1.1, .34, dx ? 1.32 : 1.1, pale); continue; }
      put(tx, .06, tz, dz ? 1.22 : 1.02, .2, dx ? 1.22 : 1.02, pale);
      put(tx, .22, tz, dz ? 1.4 : 1.16, .18, dx ? 1.4 : 1.16, pale);
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
  const ringGeometry = archivolt(SPAN), barGeometry = new THREE.BoxGeometry(1, 1, 1);
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
        // The impost: the band the arch springs from, and the one course in a gate that a mason always
        // moulds, because it is where the eye stops on the way up. A chamfered under-course, a drum
        // turned off square, and a projecting fillet the ring lands on — three instances of the block
        // geometry already in this batch, so it is triangles and not a call.
        moulding(lx, SPRING - .33, lz, .60, .13, 1);
        // Matching pedestal at the waterline, so the pier is not a shaft ending in air.
        moulding(lx, -1.98, lz, .70, .15, -1);
      }
      rings.push({ x: gate.x, y: SPRING, z: gate.z, turn: gate.dx !== 0 });
      // The keystone, chamfered. One flat slab across the crown was the single most box-like thing in the
      // frame; this is a neck sunk into the extrados, a wedge above it and a weathered cap wider than
      // both, which is the profile that reads as cut stone from directly above the arch.
      put(gate.x, SPRING + SPAN + .06, gate.z, run[0] ? .40 : .34, .30, run[1] ? .40 : .34, pale);
      put(gate.x, SPRING + SPAN + .26, gate.z, run[0] ? .58 : .44, .22, run[1] ? .58 : .44, pale);
      put(gate.x, SPRING + SPAN + .40, gate.z, run[0] ? .74 : .52, .12, run[1] ? .74 : .52, pale);
      // Three bars in the lunette and none below them: what makes it read as a gate rather than a hoop,
      // clear of the lane he walks through, and twelve triangles apiece instead of a hundred and eight.
      for (const at of [-.46, 0, .46]) bars.push({ x: gate.x + run[0] * at * SPAN, y: SPRING, z: gate.z + run[1] * at * SPAN, sy: Math.sqrt(1 - at * at) * SPAN - .1 });
    }
  }
  // Spatial batches keep invisible wings out of both the view and shadow pass.
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), at = new THREE.Vector3(), scale = new THREE.Vector3();
  const spin = new THREE.Euler();
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
      // Settle as well as turn: an eighth of a circle where a moulding asked for one, and otherwise a
      // deterministic hair off square taken from the block's own position, so a run of coursework has no
      // two edges in line. Free — the quaternion is composed either way.
      local.forEach((b, i) => {
        rotation.setFromEuler(spin.set(0, b.turn || Math.abs((b.x * 12.9898 + b.z * 78.233) % 1) * .05 - .025, 0));
        matrix.compose(at.set(b.x, b.y, b.z), rotation, scale.set(b.sx, b.sy, b.sz)); batch.setMatrixAt(i, matrix);
      });
      batch.castShadow = batch.receiveShadow = true;
      // Plan 007: opaque pillar shafts/caps and high wall masonry are eligible for the local actor
      // cutaway. `stone`/`pale` are exactly that here — coursework, buttresses, capitals, bases,
      // copings; `bronze` never reaches this loop (nothing in `blocks` uses it). Tagged once at
      // creation, never by colour or class, per the plan's own registration rule.
      if (material === stone || material === pale) batch.userData.cameraOccluder = true;
      world.add(batch);
    }
  }
  if (rings.length) {
    const arches = new THREE.InstancedMesh(ringGeometry, pale, rings.length);
    rings.forEach((r, i) => { rotation.setFromEuler(new THREE.Euler(0, r.turn ? Math.PI / 2 : 0, 0)); matrix.compose(at.set(r.x, r.y, r.z), rotation, scale.set(1, 1, 1)); arches.setMatrixAt(i, matrix); });
    arches.receiveShadow = true;
    // A carved gate span is eligible; the grille's bars are excluded explicitly by the plan.
    arches.userData.cameraOccluder = true;
    world.add(arches);
    const grille = new THREE.InstancedMesh(barGeometry, bronze, bars.length);
    rotation.identity();
    bars.forEach((b, i) => { matrix.compose(at.set(b.x, b.y + b.sy / 2, b.z), rotation, scale.set(.07, b.sy, .07)); grille.setMatrixAt(i, matrix); });
    world.add(grille);
  } else { ringGeometry.dispose(); barGeometry.dispose(); }
  // The two carved stones, handed back so the frame can hang the chamber's own masonry on them.
  // `stone` takes it straight and `pale` a shade up, which is the relationship the two were built
  // with and the one that keeps a column parting from the coursework behind it.
  return { stone, pale, inlay, lip, dark, bronze, motifs: motifs.realized };
}

/* -------------------------------------------------------------------- paving
 *
 * Two rounds of this floor were spent on albedo — a per-instance tint, then a
 * rotated hashed noise field — and a blind review looked at both and said the
 * plane was still flat. Two things were wrong with that, and only one of them
 * was the shader.
 *
 * The first is arithmetic. The per-tile "jitter" was `abs(x * 7 + z * 3) % 7`,
 * and seven divides seven: the x term vanishes and every tile in a row gets the
 * same value. The companion field, `abs(x * 5 - z * 11) % 5`, loses its x term
 * the same way. So the floor has never had per-tile variation at all — it has
 * had horizontal bands, which on an isometric grid read as nothing. `tileHash`
 * below is a real integer hash, and it is the whole of that fix.
 *
 * The second is that albedo was the wrong tool. A slab at this camera is lit by
 * one key at a fixed angle, so the only thing that can give a tile its own
 * light is a face pointing somewhere new — and the slab had none. It was a
 * `RoundedBoxGeometry`, whose chamfer is *smooth*-shaded: the normal sweeps
 * from up to sideways across six centimetres of stone, which resolves to a
 * two-pixel gradient and reads as a soft edge on a painted plane.
 *
 * `pavingGeometry` builds the slab by hand instead, every facet flat. Against
 * the moon at (-7, 12, 9) the five faces of the plain tile land on
 *
 *   top .73 | -x lip .81 | +z lip .90 | +x fall .21 | -z fall .13
 *
 * — a seven-fold spread inside one tile, repeated identically on every tile
 * because the instance spin is a multiple of a quarter turn. That is the bright
 * lip and the dark shadow line, and it is the same every frame because it is
 * geometry rather than noise.
 *
 * It is also cheaper: eighteen triangles against the rounded box's hundred and
 * eight, which is what pays for the damaged variants and then some.
 */

/** A stable value in [0,1) for a grid cell. Seeded from position, so it never moves. */
export const tileHash = (x: number, z: number, salt = 0) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Slab footprint. Five centimetres narrower than the 1.48 grid pitch, against
 * three before: the joint is the only part of the floor the key never reaches,
 * and widening it is the cheapest dark line available.
 */
const SLAB = 1.43;
/** Top face, underside, and the width of the lit lip around the rim. */
const TOP = .09, BASE = -.09, LIP = .075;

type Corner = [number, number, number];

/** Vertex buffers under construction. */
type Slab = { position: number[]; normal: number[]; uv: number[]; color: number[] };

/**
 * One flat-shaded facet, wound so `a b c` faces out. Three corners or four, one normal, and one
 * baked shade: the joint between two slabs is the only place on the floor no light of any kind
 * reaches, and darkening it is what turns a seam into a seam. It rides a vertex colour rather than
 * a second material, so it multiplies into the per-instance tint and costs neither a draw call nor
 * a triangle. There is no term in the lighting that would find it otherwise — the key is one
 * direction and a two-centimetre slot has no way to occlude itself against it.
 */
const facet = (slab: Slab, shade: number, a: Corner, b: Corner, c: Corner, d?: Corner) => {
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const len = Math.hypot(nx, ny, nz) || 1;
  for (const p of d ? [a, b, c, a, c, d] : [a, b, c]) {
    slab.position.push(p[0], p[1], p[2]);
    slab.normal.push(nx / len, ny / len, nz / len);
    slab.color.push(shade, shade, shade);
    // Planar from above for every face. The rim and the sides are a few centimetres
    // tall and take a stretched slice of the stone map, which is what they should:
    // the grain runs over the edge of a cut block rather than wrapping around it.
    slab.uv.push(p[0] / SLAB + .5, p[2] / SLAB + .5);
  }
};

/** Turns a +z-side facet a quarter turn at a time, so all four rims are built from one description. */
const ring = (slab: Slab, shade: number, quad: Corner[]) => {
  for (let turn = 0; turn < 4; turn++) {
    const cos = [1, 0, -1, 0][turn], sin = [0, 1, 0, -1][turn];
    const spun = quad.map(([x, y, z]) => [x * cos + z * sin, y, z * cos - x * sin] as Corner);
    facet(slab, shade, spun[0], spun[1], spun[2], spun[3]);
  }
};

/** How much light the joint and the hollows keep. */
// Plan 014 round B: .52 -> .26. The joint is wet grout, the darkest line on the floor.
const JOINT = .26, HOLLOW = .84;

/**
 * `plain` is the paving. `groove` is a slab split by a fissure and `dish` one
 * worn hollow, both at twenty-six triangles, and both are a *shape* rather than
 * a stain — the fissure puts its two walls at the brightest and the darkest
 * angle the key offers, side by side, so a cracked tile carries a hard light
 * line against a hard dark one that no amount of albedo can imitate.
 */
export const pavingGeometry = (kind: 'plain' | 'groove' | 'dish' = 'plain') => {
  const slab: Slab = { position: [], normal: [], uv: [], color: [] };
  const half = SLAB / 2, inner = half - LIP, shoulder = TOP - LIP;
  // The rim, mitred at the corners so the four trapezoids close on each other.
  // Plan 014 round 6 (lever 6): unshaded (1) here, the +z lip's own flat-shaded normal against the
  // moon landed at .90 real luminance by the doc above - close enough to full white that, repeated
  // identically across every aligned tile in a run, it reads as a straight bright stroke laid across
  // the floor rather than as one lit facet among the five this slab was built to carry. .82 keeps the
  // whole seven-fold spread this geometry earns its keep for, just short of where the brightest facet
  // clips into a line.
  // Plan 014 round B: still .82 read as bright white strips along every joint whose lip faces the
  // moon, and those strips ran straight through the knight's telegraph in torch-room. The camera sees
  // the same +z/+x lips the moon lights, so the brightest facet was always the visible one. .46 keeps
  // a visible chamfer without the lip ever out-shining the slab top it belongs to.
  ring(slab, .46, [[-inner, TOP, inner], [-half, shoulder, half], [half, shoulder, half], [inner, TOP, inner]]);
  // The skirt down into the joint. What the lens actually sees of a neighbour across the gap.
  ring(slab, JOINT, [[-half, shoulder, half], [-half, BASE, half], [half, BASE, half], [half, shoulder, half]]);
  if (kind === 'groove') {
    const gap = .072;
    for (const side of [1, -1]) facet(slab, 1,
      [-inner * side, TOP, inner * side], [inner * side, TOP, inner * side], [inner * side, TOP, gap * side], [-inner * side, TOP, gap * side]);
    // The two walls of the fissure: one turned into the key, one away from it.
    facet(slab, HOLLOW, [-inner, TOP, gap], [inner, TOP, gap], [inner, TOP - gap, 0], [-inner, TOP - gap, 0]);
    facet(slab, HOLLOW, [-inner, TOP - gap, 0], [inner, TOP - gap, 0], [inner, TOP, -gap], [-inner, TOP, -gap]);
    // Ends, where the fissure runs out into the rim.
    for (const side of [1, -1]) facet(slab, HOLLOW,
      [inner * side, TOP, gap * side], [inner * side, TOP - gap, 0], [inner * side, TOP, -gap * side]);
  } else if (kind === 'dish') {
    const sink = .085, bed = inner - sink;
    ring(slab, HOLLOW, [[-bed, TOP - sink, bed], [-inner, TOP, inner], [inner, TOP, inner], [bed, TOP - sink, bed]]);
    facet(slab, HOLLOW, [-bed, TOP - sink, bed], [bed, TOP - sink, bed], [bed, TOP - sink, -bed], [-bed, TOP - sink, -bed]);
  } else {
    facet(slab, 1, [-inner, TOP, inner], [inner, TOP, inner], [inner, TOP, -inner], [-inner, TOP, -inner]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(slab.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(slab.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(slab.uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(slab.color, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Which slab a cell gets. Roughly one in six is damaged, and the two that need
 * their own geometry cost one instanced draw each for the whole floor — the
 * third is the same plain slab set into its bed a little crooked, which costs
 * nothing at all because a matrix is not a draw call.
 */
export const pavingKind = (x: number, z: number) => {
  const roll = tileHash(x, z, 3);
  return roll < .055 ? 'groove' : roll < .105 ? 'dish' : roll < .165 ? 'settled' : 'plain';
};
