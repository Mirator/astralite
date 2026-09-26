import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pavingGeometry, pavingKind, ROOM_MOOD, tileHash } from './dungeon-art';
import { addAtmosphere } from './dungeon-atmosphere';
import { spawnEnemy, type Enemy, type EnemyArt } from './dungeon-enemy-view';
import { cellKey, TILE, type generateFloor } from './dungeon-floor';
import { tidalMaterial, weatherStone } from './dungeon-motion';
import type { planPavingPatches } from './dungeon-paving-layout';
import { pavingPatchGeometry } from './dungeon-paving-patches';
import { litDisc, type Radiance } from './dungeon-radiance';
import { buildSurfaceIndex, type CellSurface, type SurfaceIndex, type SurfaceTriangle } from './dungeon-surface';
import { applyFloorDetail, applyStoneTextures, getFlagstoneTextures, getMasonryTextures } from './dungeon-textures';
import type { WeaponId } from './dungeon-weapon';

// Raising one floor of the keep out of its generated layout: the paving, the bridges and the flood, the
// parapets, the atmosphere pass, the walking-surface index, the hazards and shrines, the stair and every
// skeleton. This was the middle of `buildFloorSteps` in dungeon-game.tsx, unchanged but for where its
// results are kept: everything it makes that outlives the build goes into the one `FloorStage` the
// world reads, rather than a dozen loose variables in the world closure.

type Floor = ReturnType<typeof generateFloor>;

/** A gauntlet grate or a sanctuary shrine, and its state through the floor. */
export type Feature = { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; glow: Radiance; room: number; shrine: boolean; used: boolean; phase: number; burned: boolean };

/**
 * Everything a floor build leaves for the world to drive, replaced wholesale by the next one. Fields are
 * written at the same point of the build they always were, so a snapshot taken mid-build reads what it
 * used to.
 */
export type FloorStage = {
  features: Feature[];
  enemies: Enemy[];
  atmosphere: ReturnType<typeof addAtmosphere> | null;
  /** The presentation-only support-height index over this floor's walking surfaces (plan 006/008). */
  surfaceIndex: SurfaceIndex | null;
  pavingSummary: { pairs: number; settled: number; surfaceCells: number };
  water: THREE.Mesh | null;
  tide: ReturnType<typeof tidalMaterial> | null;
  parapetSkin: THREE.MeshStandardMaterial | null;
  /** The way down sits at the heart of the warden hall. The vector is the stage's own for its life. */
  stairSpot: THREE.Vector3;
  stairSeal: THREE.Mesh | null;
  stairRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null;
  stairGlow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null;
  stairLight: Radiance | null;
};

export const createFloorStage = (): FloorStage => ({
  features: [], enemies: [], atmosphere: null, surfaceIndex: null, pavingSummary: { pairs: 0, settled: 0, surfaceCells: 0 },
  water: null, tide: null, parapetSkin: null,
  stairSpot: new THREE.Vector3(), stairSeal: null, stairRing: null, stairGlow: null, stairLight: null,
});

/** What the build borrows from the world it is raised in. */
export type FloorArt = EnemyArt & {
  /** The scene root, whose matrices are brought up to date before the walking surfaces are read. */
  world: THREE.Object3D;
  /** Registers a camera occluder with the cutaway controller. */
  register: (mesh: THREE.Mesh | THREE.InstancedMesh) => void;
  /** Lays the floor's arm on its rack. The rack is drawn in the knight's own palette, so the world does it. */
  placeDrop: (kind: WeaponId, x: number, z: number) => void;
};

// One scratch matrix for every instance the build places.
const matrix = new THREE.Matrix4();

/**
 * Raises `floor` into `floorGroup`, writing what outlives the build into `stage`. Yields the name of each
 * phase as it finishes - tiles, walls, surface, atmosphere, enemies - so the caller can time it and give
 * the browser a turn before the next.
 */
export function* raiseFloor(floor: Floor, level: number, floorGroup: THREE.Group, pavingPlan: ReturnType<typeof planPavingPatches>, stage: FloorStage, art: FloorArt): Generator<string> {
  // `vertexColors` is the slab's baked joint shading, and it multiplies with the per-instance tint
  // rather than replacing it. Only the three paving geometries use this material, and all three carry
  // the attribute.
  // Plan 014 round 3 (lever B5): the old `map`/`bumpMap` pair (a 256px grain speckle, tiled by the
  // slab's own local UV so it repeated identically on every instance) is gone in favour of a real
  // generated flagstone material sampled in world space - see `dungeon-textures.ts`. `weatherStone`
  // still runs first for its per-room tint, crack/moss placement and wet-roughness dip; the
  // triplanar sample multiplies on top of that rather than replacing it.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .83, vertexColors: true });
  weatherStone(floorMaterial);
  applyStoneTextures(floorMaterial, getFlagstoneTextures(), 1.1);
  // Plan 014 round B: wall-base grime, near-mirror puddles and per-slab variation (dungeon-textures.ts).
  const floorDetail = applyFloorDetail(floorMaterial, [...floor.tiles, ...floor.props].map(({ x, z }) => ({ x: x * TILE, z: z * TILE })), TILE); floorGroup.userData.floorDetail = floorDetail;
  const stoneTiles = floor.tiles.filter(t=>!t.wood), bridgeTiles = floor.tiles.filter(t=>t.wood);
  // A corridor tile belongs to no room and used to take the keep's own grey wherever it ran, so a
  // passage through the ruin came out as a grey ribbon laid across an ochre floor. It takes the
  // nearest chamber's theme instead, which is the same rule the lighting uses to decide what to
  // put in the air above it, so the two agree about where one area ends.
  const themeOf=(x:number,z:number,room:number)=>{if(room>=0)return floor.rooms[room].theme;let best=Infinity,theme=floor.rooms[0].theme;for(const r of floor.rooms){const d=(r.x-x)**2+(r.z-z)**2;if(d<best){best=d;theme=r.theme;}}return theme;};
  // The slab itself, and the two damaged variants. Flat-shaded and built by hand rather than a
  // smooth-chamfered rounded box: the rim now holds four distinct values under the key instead of a
  // two-pixel gradient, and it costs eighteen triangles where the box cost a hundred and eight. The
  // reasoning, and the measured values of the five faces, are over `pavingGeometry`.
  const tileGeometry=pavingGeometry('plain'),grooveGeometry=pavingGeometry('groove'),dishGeometry=pavingGeometry('dish'),foundationGeometry=new THREE.BoxGeometry(1.49,2.65,1.49);
  // White, and coloured per instance instead: the submerged plinth is the tallest continuous run of
  // stone in any frame and it was one fixed teal under every theme, which made it one of the loudest
  // things holding the three areas together. Per-instance colour is a buffer, not a draw call.
  const foundationMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9});weatherStone(foundationMaterial);applyStoneTextures(foundationMaterial,getMasonryTextures(),.9);
  // One cell's worth of paving colour, shared by the plain batches and by both variant meshes so a
  // damaged slab weathers like the one beside it. The jitter this replaces was `abs(x*7+z*3)%7`, and
  // seven divides seven — the x term cancelled and the field was a function of z alone, so two rounds
  // of "per-tile" albedo have been painting rows. Same mean and same spread as before; per cell now.
  const tint=new THREE.Color();
  const slabTint=(x:number,z:number,room:number)=>{
    const mood=ROOM_MOOD[themeOf(x,z,room)];
    const border=room>=0&&(Math.abs(x-floor.rooms[room].x)===floor.rooms[room].halfX-1||Math.abs(z-floor.rooms[room].z)===floor.rooms[room].halfZ-1);
    const wear=tileHash(x,z,1),drift=tileHash(x,z,2);
    // Plan 014 round 8 (lever 6): a hard `drift<.5?A:B` branch is a coin flip per tile, and a coin
    // flip laid over a grid is exactly what reads as a checkerboard once enough tiles are on
    // screen at once - two fixed hue offsets, no continuum between them, so neighbouring tiles
    // either match or don't with nothing in between. Both terms are continuous functions of
    // `drift` now (no threshold at all) and both ranges are narrower - the triplanar stone texture
    // from `applyStoneTextures` already carries real per-tile variation; this only has to keep the
    // instanced batch from reading as one flat colour, not do all the work itself.
    tint.setHex(border?mood.border:mood.tile).multiplyScalar(.89+wear*.09).offsetHSL((drift-.5)*.012,drift*.01-.005,0);
    return {mood,wear};
  };
  const slabEuler=new THREE.Euler(),slabTurn=new THREE.Quaternion(),slabAt=new THREE.Vector3(),slabScale=new THREE.Vector3(1,1,1);
  // A settled slab is the plain slab dropped four centimetres into its bed and left crooked, and it is
  // the one damage variant that is free: an instance matrix is not a draw call. It only ever sinks —
  // the tilt is small enough that no corner comes back up proud of its neighbours.
  const seat=(x:number,z:number,settled:boolean)=>{
    const spin=(Math.abs(x*13+z*7)%4)*Math.PI/2;
    if(settled){slabEuler.set((tileHash(x,z,4)-.5)*.09,spin,(tileHash(x,z,5)-.5)*.09);matrix.compose(slabAt.set(x*TILE,-.126,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);}
    // Plan 014 round 4 (lever C7): even an ordinary, undamaged slab now sits a few millimetres off
    // true - height and tilt both hashed off its own cell, same as the settled variant but far
    // subtler, so a floor of identical flat slabs picks up the same faint unevenness real flagstone
    // never loses even where nothing has actually broken.
    else{slabEuler.set((tileHash(x,z,24)-.5)*.025,spin,(tileHash(x,z,25)-.5)*.025);matrix.compose(slabAt.set(x*TILE,-.07-tileHash(x,z,26)*.012,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);}
    return matrix;
  };
  // Macro paving (plan 006): a merged pair's two cells never get an ordinary top at all - their
  // slab is the new rectangular patch below - and a settled single is forced to plain regardless
  // of what the per-tile damage roll would have said, so the two mechanisms never stack.
  const macroSettle=(x:number,z:number)=>{
    const spin=(Math.abs(x*13+z*7)%4)*Math.PI/2;
    const drop=.025+tileHash(x,z,21)*.02, tiltX=(tileHash(x,z,22)-.5)*.06, tiltZ=(tileHash(x,z,23)-.5)*.06;
    slabEuler.set(tiltX,spin,tiltZ);matrix.compose(slabAt.set(x*TILE,-.07-drop,z*TILE),slabTurn.setFromEuler(slabEuler),slabScale);
    return matrix;
  };
  const variants:Record<'groove'|'dish',typeof stoneTiles>={groove:[],dish:[]};
  // Spatial batches let both the view and shadow camera reject distant carved paving.
  const paving=new Map<string,typeof stoneTiles>();for(const tile of stoneTiles){const key=`${Math.floor(tile.x/12)},${Math.floor(tile.z/12)}`;const batch=paving.get(key);if(batch)batch.push(tile);else paving.set(key,[tile]);}
  for(const local of paving.values()){
    const plain=local.filter(t=>{
      const key=`${t.x},${t.z}`;
      if(pavingPlan.pairedCells.has(key))return false; // top drawn by the merged pair mesh below
      if(pavingPlan.settledCells.has(key))return true; // ordinary geometry, new settle transform
      const kind=pavingKind(t.x,t.z);if(kind==='groove'||kind==='dish'){variants[kind].push(t);return false;}return true;
    });
    const tiles=new THREE.InstancedMesh(tileGeometry,floorMaterial,plain.length),foundations=new THREE.InstancedMesh(foundationGeometry,foundationMaterial,local.length);
    // Every cell keeps its plinth, including the ones whose slab is drawn by a variant mesh below.
    local.forEach(({x,z,room},i)=>{const{mood,wear}=slabTint(x,z,room);matrix.makeTranslation(x*TILE,-1.485,z*TILE);foundations.setMatrixAt(i,matrix);foundations.setColorAt(i,tint.setHex(mood.foundation).multiplyScalar(.86+wear*.24));});
    plain.forEach(({x,z,room},i)=>{
      slabTint(x,z,room);tiles.setColorAt(i,tint);
      const settledNew=pavingPlan.settledCells.has(`${x},${z}`);
      tiles.setMatrixAt(i,settledNew?macroSettle(x,z):seat(x,z,pavingKind(x,z)==='settled'));
    });
    foundations.receiveShadow=tiles.receiveShadow=true;tiles.userData.walkingSurface=true;floorGroup.add(foundations,tiles);
  }
  // One instanced draw each for the whole floor. Damage is scattered by a hash, so a variant batched
  // by region would be a batch per region and the junction has eighteen calls of headroom, not sixty.
  for(const [kind,geometry] of [['groove',grooveGeometry],['dish',dishGeometry]] as const){
    const cells=variants[kind];
    if(!cells.length){geometry.dispose();continue;}
    const damaged=new THREE.InstancedMesh(geometry,floorMaterial,cells.length);
    cells.forEach(({x,z,room},i)=>{slabTint(x,z,room);damaged.setColorAt(i,tint);damaged.setMatrixAt(i,seat(x,z,false));});
    damaged.receiveShadow=true;damaged.userData.walkingSurface=true;floorGroup.add(damaged);
  }
  // The merged long slabs: one InstancedMesh per spatial batch a pair actually falls in, so a
  // patch costs the same kind of draw call the ordinary paving already pays for rather than a new
  // one per pair. Orientation 'z' is the same geometry turned a quarter circle, never a second
  // build; the tint is the two source cells' own slabTint, blended, so a merged slab weathers as
  // the average of the two courses it replaces rather than introducing a third palette value.
  if(pavingPlan.pairs.length){
    const pairGeometry=pavingPatchGeometry();
    const pairsByBatch=new Map<string,typeof pavingPlan.pairs>();
    for(const pair of pavingPlan.pairs){const list=pairsByBatch.get(pair.batch);if(list)list.push(pair);else pairsByBatch.set(pair.batch,[pair]);}
    for(const list of pairsByBatch.values()){
      const patches=new THREE.InstancedMesh(pairGeometry,floorMaterial,list.length);
      list.forEach((pair,i)=>{
        slabTurn.setFromEuler(slabEuler.set(0,pair.orientation==='z'?Math.PI/2:0,0));
        matrix.compose(slabAt.set(pair.x,-.07,pair.z),slabTurn,slabScale);
        patches.setMatrixAt(i,matrix);
        slabTint(pair.ax,pair.az,pair.room);const a=tint.clone();
        slabTint(pair.bx,pair.bz,pair.room);const b=tint.clone();
        patches.setColorAt(i,a.lerp(b,.5));
      });
      patches.receiveShadow=true;patches.userData.walkingSurface=true;floorGroup.add(patches);
    }
  }
  yield 'tiles';
  // Plan 014 round 4 (lever C5): stone flagstone in place of the wood plank deck - the same slab
  // geometry and the same triplanar flagstone material the rest of the floor stands on, so a
  // bridge reads as a stone span rather than a wood dock. `slabTint` already resolves a theme for
  // a tile with no room of its own (a bridge always sits between two rooms), which is exactly the
  // case this needs. The timber piles and rail below stay - removing them entirely wherever a
  // stone arch now stands would leave the long stretches between arches looking unsupported, and
  // this round did not have room to also rebuild the understructure tile by tile.
  const deck = new THREE.InstancedMesh(tileGeometry, floorMaterial, bridgeTiles.length);
  bridgeTiles.forEach(({x,z,room},i)=>{slabTint(x,z,room);deck.setColorAt(i,tint);deck.setMatrixAt(i,seat(x,z,false));});
  deck.receiveShadow=true;deck.userData.walkingSurface=true;floorGroup.add(deck);
  const { minX, maxX, minZ, maxZ } = floor.bounds;
  stage.tide = tidalMaterial(new THREE.Vector4((minX + maxX) * TILE / 2, (minZ + maxZ) * TILE / 2, (maxX - minX) * TILE / 2 + 1.5, (maxZ - minZ) * TILE / 2 + 1.5), floor.tiles.map(({ x, z }) => ({ x: x * TILE, z: z * TILE })), TILE);
  stage.water = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX + 40) * TILE, (maxZ - minZ + 40) * TILE), stage.tide.material);
  stage.water.rotation.x = -Math.PI / 2; stage.water.position.set((minX + maxX) * TILE / 2, -2.8, (minZ + maxZ) * TILE / 2); floorGroup.add(stage.water);
  const borders: { x: number; z: number; horizontal: boolean }[] = [];
  floor.tiles.forEach(({ x, z }) => { for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!floor.cells.has(cellKey(x + dx,z + dz))) borders.push({ x: (x + dx * 0.5) * TILE, z: (z + dz * 0.5) * TILE, horizontal: dz !== 0 }); });
  // Low parapets keep the isometric view readable, including narrow bridges.
  // A kerb this low read as a painted line around the slab rather than as the top of a wall, and the
  // near edge of the platform is the one place in the frame where the reference always has built
  // mass. Half again as tall and near twice as thick, on the same instance count, so it catches the
  // moon on its cap, shades its own face, and lays a shadow of its own on the paving inside it.
  // Neutral rather than teal: the kerb runs the full border of every tile on the floor including the
  // corridors, so whatever hue it holds is a hue the whole keep holds. It takes the chamber's from
  // the weathering uniforms instead.
  const parapetGeometry=new RoundedBoxGeometry(1,0.58,1,1,.1),parapetMaterial=new THREE.MeshStandardMaterial({color:0x6b6f70,roughness:.8});stage.parapetSkin=parapetMaterial;weatherStone(parapetMaterial);applyStoneTextures(parapetMaterial,getMasonryTextures(),.85);
  const parapets=new Map<string,typeof borders>();for(const b of borders){const key=`${Math.floor(b.x/18)},${Math.floor(b.z/18)}`;const batch=parapets.get(key);if(batch)batch.push(b);else parapets.set(key,[b]);}
  for(const local of parapets.values()){
    const walls=new THREE.InstancedMesh(parapetGeometry,parapetMaterial,local.length);
    // Plan 014 round 4 (lever C7): a run of identical merlons reads as a fence, not a broken
    // rampart. A per-segment hash jitters height and yaw so no two blocks share an edge line, and
    // one in twelve is a missing merlon - scaled to nothing rather than skipped, since an
    // instanced mesh's count is fixed once it is created.
    local.forEach((b,i)=>{
      const roll=tileHash(Math.round(b.x*4),Math.round(b.z*4),31);
      const broken=roll<.08;
      const h=broken?0:.82+tileHash(Math.round(b.x*4),Math.round(b.z*4),32)*.4;
      const yaw=(tileHash(Math.round(b.x*4),Math.round(b.z*4),33)-.5)*.12;
      matrix.compose(new THREE.Vector3(b.x,.2+(h-1)*.29,b.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,0)),new THREE.Vector3(b.horizontal?TILE:.3,broken?.001:h,b.horizontal?.3:TILE));
      walls.setMatrixAt(i,matrix);
    });
    // Not a shadow caster. The parapet runs the full border of every tile on the floor, corridors
    // included, and putting that instance count through the shadow pass as well cost more triangles
    // than every piece of vertical structure this round adds, for a shadow half a block wide.
    walls.receiveShadow=true;floorGroup.add(walls);
  }
  yield 'walls';
  const atmosphere = stage.atmosphere = addAtmosphere(floorGroup, floor);
  // Plan 014 round 9 (lever 6): the water's own reflection streaks (dungeon-motion.ts's
  // `tidalMaterial`) need real torch world-positions, which only exist once the atmosphere pass
  // above has actually placed them - set once here, not per frame, since torches do not move.
  if (stage.tide) { const slots = stage.tide.torches.value; atmosphere.torchPositions.slice(0, slots.length).forEach((p, i) => slots[i].copy(p)); }
  // The presentation-only support-height index (plan 006/008): every mesh tagged
  // `walkingSurface=true` -- paving tops (plain, groove, dish, merged pairs), wood planks and
  // floor motifs -- is read back into world-space triangles once, here, after everything that
  // could tag one has been built. Collision keeps using `floor.cells`/`canStand`; nothing here is
  // ever consulted for whether a position is legal to stand on.
  art.world.updateMatrixWorld(true);
  {
    const triangles: SurfaceTriangle[] = [];
    const instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const collect = (geometry: THREE.BufferGeometry, transform: THREE.Matrix4) => {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!position) return;
      const index = geometry.getIndex();
      const triCount = index ? index.count / 3 : position.count / 3;
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
          corners[k].set(position.getX(vi), position.getY(vi), position.getZ(vi)).applyMatrix4(transform);
        }
        triangles.push({
          ax: corners[0].x, ay: corners[0].y, az: corners[0].z,
          bx: corners[1].x, by: corners[1].y, bz: corners[1].z,
          cx: corners[2].x, cy: corners[2].y, cz: corners[2].z,
        });
      }
    };
    floorGroup.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Plan 007: register every mesh tagged `cameraOccluder=true` at creation (dungeon-art.ts,
      // dungeon-atmosphere.ts) exactly once per floor build, never by traversing every frame.
      if (o.userData.cameraOccluder) art.register(o as THREE.Mesh | THREE.InstancedMesh);
      if (!o.userData.walkingSurface) return;
      if (o instanceof THREE.InstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, instanceMatrix);
          worldMatrix.multiplyMatrices(o.matrixWorld, instanceMatrix);
          collect(o.geometry, worldMatrix);
        }
      } else {
        collect(o.geometry, o.matrixWorld);
      }
    });
    const cellMeta = new Map<string, CellSurface>();
    for (const t of floor.tiles) cellMeta.set(cellKey(t.x, t.z), { theme: themeOf(t.x, t.z, t.room), wood: t.wood });
    stage.surfaceIndex = buildSurfaceIndex(triangles, cellMeta);
    stage.pavingSummary = { pairs: pavingPlan.pairs.length, settled: pavingPlan.settled.length, surfaceCells: stage.surfaceIndex.cells.size };
  }
  yield 'surface';
  for (const room of floor.rooms) {
    if (room.id === 0 || !['sanctuary', 'gauntlet'].includes(room.encounter)) continue;
    const shrine = room.encounter === 'sanctuary';
    for (const offset of shrine ? [0] : [-2.5, 0, 2.5]) {
      // The disc is whole now rather than an annulus, and the ring is drawn
      // inside it by the fragment shader along with the light it throws on
      // the paving: same draw call, same ninety-six triangles, and a grate
      // that is part of the floor it is burning instead of a decal over it.
      // It is additive for the same reason: a grate that can only ever darken
      // the stone under it is the "flat black ellipse" the review saw. That is
      // the opposite call from the windup arc a few lines down, and both are
      // right. This is a soft glow whose whole job is to look like heat coming
      // up through the floor, so taking the paving's colour with it is what
      // makes it part of the floor. The arc is a signal that must mean the
      // same thing in three chambers, so taking the paving's colour with it
      // was the bug.
      //
      // Dormant, it is scorched iron rather than the hot red it used to be.
      // That red sat on the telegraph's own hue to within a fifth of a degree
      // at two and a half times its chroma, so a grate sitting there doing
      // nothing wore the colour that means a blow is landing. Dead grey was
      // tried in between and went too far the other way: a hazard the player
      // cannot pick out of the paving is not a fair one.
      const spread = shrine ? 1.9 : 3.25;
      const skin = new THREE.MeshBasicMaterial({ color: shrine ? 0x71f4c4 : 0x7a5238, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      const glow = litDisc(skin, shrine ? 'shrine-disc-v1' : 'ember-disc-v1', shrine ? 4.2 : 2.0);
      glow.edge.value = (shrine ? 1.125 : 1.69) / spread; glow.width.value = (shrine ? .26 : .13) / spread;
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0, spread, 48), skin);
      // Clear of the grate bars, which top out at .10: the pool now reaches
      // across them where the old ring sat outside their radius entirely.
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(room.x * TILE + offset, shrine ? .085 : .125, room.z * TILE); mesh.renderOrder = 2;
      floorGroup.add(mesh); stage.features.push({mesh, glow, room: room.id, shrine, used: false, phase: 0, burned: false});
      if (!shrine) {
        const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.56,1.56,.035,32), new THREE.MeshStandardMaterial({color:0x241b17,metalness:.8,roughness:.65}));
        grate.position.copy(mesh.position); grate.position.y=.045; floorGroup.add(grate);
        for (let n=-3;n<=3;n++) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.sqrt(1.5**2-(n*.38)**2)*2,.04,.07),new THREE.MeshStandardMaterial({color:0x836445,metalness:.8,roughness:.5}));
          rail.position.set(mesh.position.x,.08,mesh.position.z+n*.38);floorGroup.add(rail);
        }
      }
      if (shrine) {
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.5), new THREE.MeshStandardMaterial({color:0xa8f7d8,emissive:0x48cba0,emissiveIntensity:2,metalness:.3,roughness:.2}));
        crystal.position.set(room.x*TILE,1.2,room.z*TILE); floorGroup.add(crystal); mesh.userData.crystal = crystal;
      }
    }
  }
  // The way down: a sealed grate at the heart of the warden hall, ringed in stone over a dark shaft. The seal
  // lifts when the last warden falls; the gold ring is the same mark the map uses for the stair.
  { const goal = floor.rooms[floor.goal]; stage.stairSpot.set(goal.x * TILE, 0, goal.z * TILE);
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), new THREE.MeshBasicMaterial({ color: 0x04070a })); pit.rotation.x = -Math.PI / 2; pit.position.set(stage.stairSpot.x, .07, stage.stairSpot.z); floorGroup.add(pit);
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.42, 32), new THREE.MeshStandardMaterial({ color: 0x55636a, roughness: .9 })); rim.rotation.x = -Math.PI / 2; rim.position.set(stage.stairSpot.x, .075, stage.stairSpot.z); floorGroup.add(rim);
    stage.stairSeal = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, .05, 32), new THREE.MeshStandardMaterial({ color: 0x241b17, metalness: .8, roughness: .65 })); stage.stairSeal.position.set(stage.stairSpot.x, .1, stage.stairSpot.z); floorGroup.add(stage.stairSeal);
    // Open: light from below fills the shaft and a wide amber ring sits clear of the stone rim, so the change reads
    // from across the hall on every floor's lighting, not only the darkest.
    // Wider than the shaft and soft to its rim: what comes up a stair is
    // light, and a hard-edged disc exactly the size of the hole was a lid.
    const shaftSkin = new THREE.MeshBasicMaterial({ color: 0xfbc956, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    stage.stairLight = litDisc(shaftSkin, 'stair-shaft-v1', 2.2); stage.stairLight.band.value = 0;
    stage.stairGlow = new THREE.Mesh(new THREE.CircleGeometry(2.05, 32), shaftSkin); stage.stairGlow.rotation.x = -Math.PI / 2; stage.stairGlow.position.set(stage.stairSpot.x, .08, stage.stairSpot.z); stage.stairGlow.visible = false; stage.stairGlow.renderOrder = 4; floorGroup.add(stage.stairGlow);
    stage.stairRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 48), new THREE.MeshBasicMaterial({ color: 0xfbc956, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })); stage.stairRing.rotation.x = -Math.PI / 2; stage.stairRing.position.set(stage.stairSpot.x, .09, stage.stairSpot.z); stage.stairRing.visible = false; stage.stairRing.renderOrder = 5; floorGroup.add(stage.stairRing); }
  art.placeDrop(floor.weaponDrop.kind, floor.weaponDrop.x, floor.weaponDrop.z);
  yield 'atmosphere';
  stage.enemies = floor.spawns.map((spawn, index) => spawnEnemy(spawn, index, level, floorGroup, art, TILE));
  yield 'enemies';
}
