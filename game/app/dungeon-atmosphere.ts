import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addCarvedArchitecture, archivolt, facesCamera, headroom, OFF_FRAME, ROOM_MOOD } from './dungeon-art';
import { TILE, type generateFloor } from './dungeon-floor';
import {
  emberOffset,
  FLAME_HALO_SCALE,
  type FlameTheme,
} from './dungeon-flame';
import { makeFlameBillboard, type FlameHandle } from './dungeon-flame-fx';
import { animateCloth, contactTexture, glowTexture, shorelineMaterial, weatherStone } from './dungeon-motion';
import { applyStoneTextures, getMasonryTextures } from './dungeon-textures';

/**
 * Plan 014 round 6: the billboard flame (`dungeon-flame-fx.ts`) is one shape, not six vertices per
 * theme - so each theme's own silhouette proportion (keep: tall and narrow; ruins: broad-based and
 * squat; flooded: low and wide) now lives here instead, as the width/height a billboard is scaled to
 * rather than as a solid's own geometry.
 */
const FLAME_FOOTPRINT: Record<FlameTheme, { w: number; h: number }> = {
  keep: { w: .48, h: 1.05 },
  ruins: { w: .7, h: .85 },
  flooded: { w: .78, h: .55 },
};
/** Wall sconces and bridge lanterns never take the room's own mood colour - see the round 4 note
 * this replaces on `sconceWarm`/`sconceCore` below, for why that has to stay a fixed warm orange. */
const SCONCE_FLAME_COLOUR = new THREE.Color(0xff8c3f);

export function stoneTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!; let seed = 7123;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#b9bbb0'; ctx.fillRect(0,0,256,256);
  // This map lands on every slab in the keep under one of only four rotations, so whatever is painted
  // here repeats at exactly the tile pitch — the one spatial frequency the grid already supplies. Any
  // shape the eye can recognise therefore deepens the grid rather than breaking it, which is what the
  // broad stains, the diagonal ramp, the veins and the chipped corners that used to be here were doing.
  // All of that moved into `weatherStone`, which is a function of world position and crosses joints.
  // What is left is grain too fine to read as a pattern, and it is mostly here to drive the bump.
  ctx.fillStyle='#2f3d38'; for(let i=0;i<900;i++){const a=.03+random()*.10;ctx.globalAlpha=a;ctx.fillRect(random()*256,random()*256,1+random()*2.2,1+random()*1.8);}
  ctx.fillStyle='#ece7d6'; for(let i=0;i<700;i++){const a=.02+random()*.08;ctx.globalAlpha=a;ctx.fillRect(random()*256,random()*256,1+random()*2,1+random()*1.6);}
  ctx.globalAlpha=1;
  // A narrow, shallow joint: enough that a slab still reads as a cut block, not so much that the seam
  // is again the loudest thing on the floor.
  for(const [gx0,gy0,gx1,gy1] of [[0,0,13,0],[256,0,243,0],[0,0,0,13],[0,256,0,243]] as const){
    const edge=ctx.createLinearGradient(gx0,gy0,gx1,gy1);
    edge.addColorStop(0,'#1d262a5c');edge.addColorStop(.4,'#1d262a1e');edge.addColorStop(1,'#1d262a00');
    ctx.fillStyle=edge;ctx.fillRect(0,0,256,256);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=4; return texture;
}

// Prop shapes repeat on every floor, so they are built once and varied by scale rather than regenerated.
const keep = <T extends THREE.BufferGeometry>(geometry: T) => { geometry.userData.shared = true; return geometry; };
const PROP = {
  base: keep(new RoundedBoxGeometry(TILE, .32, TILE, 1, .13)),
  bowl: keep(new THREE.CylinderGeometry(.34, .5, .8, 6)),
  rim: keep(new THREE.CylinderGeometry(.5, .3, .24, 8)),
  // Plan 014 round A: the brazier rebuilt as the reference draws it - a squat dark stone plinth, an
  // open iron bowl on top of it (lathed, so it is a real hollow dish rather than a closed cylinder whose
  // flat top caught the torch and read as a glowing lid), a heavy rolled lip, and a coal bed sunk just
  // under that lip that glows the fire's own colour.
  pedestal: keep(new RoundedBoxGeometry(.8, .62, .8, 1, .06)),
  pedestalCap: keep(new RoundedBoxGeometry(.96, .12, .96, 1, .04)),
  dish: keep(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(.2, 0), new THREE.Vector2(.26, .06), new THREE.Vector2(.4, .2),
    new THREE.Vector2(.47, .34), new THREE.Vector2(.44, .35), new THREE.Vector2(.37, .23), new THREE.Vector2(.18, .1), new THREE.Vector2(0, .09),
  ], 10)),
  lip: keep(new THREE.TorusGeometry(.46, .045, 5, 12).rotateX(Math.PI / 2)),
  coals: keep(new THREE.CircleGeometry(.39, 12).rotateX(-Math.PI / 2)),
  foot: keep(new THREE.BoxGeometry(.08, .22, .08)),
  barrel: keep(new THREE.CylinderGeometry(.44, .4, 1.0, 9)),
  hoop: keep(new THREE.CylinderGeometry(.46, .46, .09, 9)),
  plinth: keep(new RoundedBoxGeometry(.95, .25, .95, 1, .1)),
  column: keep(new THREE.CylinderGeometry(.3, .4, 1, 10)),
  capital: keep(new RoundedBoxGeometry(.84, .2, .84, 1, .085)),
  rock: keep(new THREE.DodecahedronGeometry(1)),
  // Plan 014 round 2 (lever C9): one link, alternated 90 degrees between rungs so the same geometry
  // reads as a chain rather than a stack of identical rings.
  link: keep(new THREE.TorusGeometry(.11, .032, 6, 10)),
  // Plan 014 round 6 (lever 3): a corridor had no furniture of its own - every prop the floor
  // generator places (brazier, barrel, pillar, rubble) belongs to a room. A lathed clay urn, bottom-
  // pivoted like the flame quad above it for the same reason (a caller plants it, not re-offsets it),
  // gives a passage its own set dressing without touching `dungeon-floor.ts`'s pure prop placement.
  urn: keep(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(.23, 0), new THREE.Vector2(.29, .07),
    new THREE.Vector2(.26, .24), new THREE.Vector2(.15, .43), new THREE.Vector2(.2, .5),
    new THREE.Vector2(.16, .57), new THREE.Vector2(0, .6),
  ], 10)),
};

export function addAtmosphere(world:THREE.Group,floor:ReturnType<typeof generateFloor>) {
  // A corridor has no room of its own. Since the near-face skip was lifted its walls
  // are built like any other, so they borrow the nearest chamber's stone rather than
  // arriving as a grey ribbon laid across a room that has committed to a colour.
  const nearestRoom=(x:number,z:number)=>{let best=Infinity,found=floor.rooms[0];for(const r of floor.rooms){const d=(r.x-x)**2+(r.z-z)**2;if(d<best){best=d;found=r;}}return found;};
  const carved=addCarvedArchitecture(world,floor);
  const stone=new THREE.MeshStandardMaterial({color:0x5c6064,roughness:.95}),trim=new THREE.MeshStandardMaterial({color:0x8c7352,roughness:.72,metalness:.25});
  weatherStone(stone);applyStoneTextures(stone,getMasonryTextures(),.8);
  // The bowl is a six-sided cylinder under an open fire and was reading as one flat value top to bottom.
  // Its own material, so the fire can bounce up the inside of it. Each bowl is already an individual
  // mesh, so this is a second program, not a second draw call.
  const bowlStone=new THREE.MeshStandardMaterial({color:0x4d5860,roughness:.95});weatherStone(bowlStone,true);
  // The rim sits half a unit under the torch's own point light, facing straight up at it. A
  // Lambertian diffuse term scales with the light's strength times the surface's cosine to it, not
  // with roughness or how dark the base colour is asked to be - so no amount of darkening `bowlStone`
  // (which is deliberately bright here anyway, so the fire can bounce up the *inside* of the bowl)
  // stopped the rim's flat top from clipping to the light's own colour, the "glowing solid lid" the
  // critics kept hitting. The rim gets its own material with a hard ceiling on outgoing radiance built
  // into its shader, so it can sit right under the flame and still read as dark stone with a highlight,
  // never a lit disc.
  const rimStone=new THREE.MeshStandardMaterial({color:0x4d5860,roughness:.95});weatherStone(rimStone,true);
  rimStone.onBeforeCompile=((previous)=>(shader:THREE.WebGLProgramParametersWithUniforms,renderer:THREE.WebGLRenderer)=>{
    previous?.(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\n      outgoingLight = min(outgoingLight, vec3(0.42));\n');
    // oxlint-disable-next-line typescript/unbound-method
  })(rimStone.onBeforeCompile as ((shader:THREE.WebGLProgramParametersWithUniforms,renderer:THREE.WebGLRenderer)=>void)|undefined);
  rimStone.customProgramCacheKey=()=>'rim-stone-capped-v1';
  // Its own material so a standing column reads against the wall behind it rather than merging into it.
  const shaftStone=new THREE.MeshStandardMaterial({color:0x7a7f82,roughness:.86});weatherStone(shaftStone);applyStoneTextures(shaftStone,getMasonryTextures(),.7);
  const wood=new THREE.MeshStandardMaterial({color:0x51382b,roughness:1}),moss=new THREE.MeshStandardMaterial({color:0x42594b,roughness:1});
  // Plan 014 round 2 (lever C9): dark, half-rusted iron for the hanging chains a third of the keep's
  // pillars carry - not weathered like the stone, since it never came from the same quarry.
  const iron=new THREE.MeshStandardMaterial({color:0x2b2724,roughness:.62,metalness:.72});
  // Plan 014 round 6 (lever 3): two fired-clay materials for the corridor's own urn clusters - fired
  // clay, not quarried stone, so neither gets `weatherStone`. Picked per-urn rather than tinted by
  // room mood, since a cracked clay pot in a dungeon corridor is not part of any chamber's palette.
  const terracotta=new THREE.MeshStandardMaterial({color:0x8a5138,roughness:.92});
  const darkClay=new THREE.MeshStandardMaterial({color:0x3d3630,roughness:.95});
  // Plan 014 round B: floor debris - chips take the chamber's stone (recoloured in `update()`), moss is
  // a dark wet green that reads against every family's paving.
  const debrisStone=new THREE.MeshStandardMaterial({color:0x4a4843,roughness:.92,flatShading:true});
  const mossClump=new THREE.MeshStandardMaterial({color:0x26382a,roughness:1,flatShading:true});
  const clothCanvas=document.createElement('canvas');clothCanvas.width=128;clothCanvas.height=256;const cc=clothCanvas.getContext('2d')!;
  // Drawn in greys so the chamber can hang its own colour on it. A `MeshStandardMaterial` map only
  // ever multiplies, so the field has to be the darker of the two for the device to stay the lighter
  // of the two once a tint is applied; painting the wine red in here is what made every banner in the
  // keep the knight's own cape whatever room it hung in.
  cc.fillStyle='#a8a8a8';cc.fillRect(0,0,128,256);cc.strokeStyle='#ffffff';cc.lineWidth=3;cc.strokeRect(9,8,110,240);
  cc.beginPath();cc.moveTo(64,54);cc.lineTo(88,104);cc.lineTo(64,158);cc.lineTo(40,104);cc.closePath();cc.stroke();cc.beginPath();cc.moveTo(64,36);cc.lineTo(64,185);cc.moveTo(28,104);cc.lineTo(100,104);cc.stroke();
  const clothTexture=new THREE.CanvasTexture(clothCanvas);clothTexture.colorSpace=THREE.SRGBColorSpace;
  const red=new THREE.MeshStandardMaterial({map:clothTexture,side:THREE.DoubleSide,roughness:1});
  const runner=new THREE.MeshStandardMaterial({map:clothTexture,side:THREE.DoubleSide,roughness:1});
  const waterCanvas=document.createElement('canvas');waterCanvas.width=64;waterCanvas.height=128;const wc=waterCanvas.getContext('2d')!;wc.fillStyle='#619d9e';wc.fillRect(0,0,64,128);
  for(let i=0;i<35;i++){wc.fillStyle=i%2?'#c4eee0aa':'#83c7c4aa';wc.fillRect((i*17)%64,(i*37)%128,1+i%3,15+i%25);}
  const flowTexture=new THREE.CanvasTexture(waterCanvas);flowTexture.wrapT=THREE.RepeatWrapping;flowTexture.repeat.y=2;flowTexture.colorSpace=THREE.SRGBColorSpace;
  const flowing=new THREE.MeshBasicMaterial({map:flowTexture,color:0xc6f0e7,transparent:true,opacity:.85,side:THREE.DoubleSide});
  flowing.depthWrite=false;
  flowing.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    diffuseColor.a *= smoothstep(0.0,.18,vMapUv.x) * smoothstep(0.0,.18,1.0-vMapUv.x);
  `);};
  flowing.customProgramCacheKey=()=> 'soft-waterfall-v1';
  const foam=new THREE.MeshBasicMaterial({color:0xb4e6de,transparent:true,opacity:.7,depthWrite:false});
  // Plan 014 round 6: `flames` no longer holds a body/core mesh pair - each entry is a billboard
  // handle (`dungeon-flame-fx.ts`) plus enough to know which colour it follows. `staticFlames` is the
  // same handle type for wall sconces and bridge lanterns, which never take the room's own mood
  // colour (round 4's fixed-warm-orange fix, restated for the new flame kind).
  // Plan 014 round A: the coal bed under each brazier flame - basic, unlit and unclamped, so it is
  // the brightest thing inside the bowl (the fire's colour run toward white) and never lit *by* the
  // torch above it into a flat grey disc. One shared material; `update()` recolours it with the mood.
  const coalGlow=new THREE.MeshBasicMaterial({color:0xff8040,toneMapped:false});
  const plinthStone=new THREE.MeshStandardMaterial({color:0x2a2d30,roughness:.9});weatherStone(plinthStone,true);applyStoneTextures(plinthStone,getMasonryTextures(),.8);
  const bowlIron=new THREE.MeshStandardMaterial({color:0x1e1c1b,roughness:.55,metalness:.7,side:THREE.DoubleSide});
  const flames:{handle:FlameHandle;theme:FlameTheme;phase:number;y:number}[]=[],staticFlames:FlameHandle[]=[],torchPositions:THREE.Vector3[]=[],banners:THREE.Mesh[]=[],seals:THREE.Mesh[]=[],sealTints:number[]=[],falls:THREE.Mesh[]=[],ripples:THREE.Mesh[]=[];
  // Plan 014 round 6 (lever 3): a hash on the wall tile decides *where* a corridor's urn/rubble/chain
  // dressing is eligible to go, but the tile count it is eligible over grows with the floor - a big
  // floor's corridors are a lot of wall segments, and one non-instanced mesh per rock/urn/chain-link
  // added up to enough individual draw calls to crash the GPU process outright on a real run of this
  // harness (a d3d11 "Target crashed", not merely a slow frame). A flat cap, independent of floor size,
  // is what the sconce right above never needed only because a fixed-warm-light budget was already
  // being watched for a different reason - this one had no budget at all before.
  let corridorUrnBudget=18,corridorRockBudget=16,corridorChainBudget=12;
  // Plan 014 round 7 (lever 7), round 9 (lever 5): the hash gates above are dressing on top of a
  // rule, not the rule itself - "at least one urn cluster per corridor segment" has to hold regardless
  // of what a given seed's tile coordinates happen to hash to. Tracked as a running distance-since-
  // last-placed instead of a real connected-component search over corridor tiles (which
  // `dungeon-floor.ts` does not expose here): a corridor segment longer than this gap is starved and
  // forces one, budget or no budget: the guarantee bypasses the opportunistic budget on purpose, since
  // a cap that could block the one guarantee this item asks for would not be a guarantee. Round 9's
  // critic still called the corridor "nearly empty" at a 6-tile gap and asked for "an urn cluster
  // every 4 tiles" explicitly - gap down to 4, and a matching gap-based guarantee added for chains
  // (urns alone were not what made a passage read as populated).
  let lastUrnTile:{x:number;z:number}|null=null,lastChainTile:{x:number;z:number}|null=null;
  const URN_GAP=4,CHAIN_GAP=5;
  const glowMap=glowTexture(),halos:THREE.Sprite[]=[],haloBases:{x:number;y:number}[]=[];
  // Plan 014 round 2: .3 opacity, at the camera's old 7.2 span, read as a soft glow; zoomed to 4.3
  // (lever 2) the same sprite is ~1.7x larger on screen, and stacked with the post chain's bloom it
  // blew a torch near the frame edge into a shapeless orange blob. The sprite's own footprint
  // (FLAME_HALO_SCALE) stays untouched - that shape is tuned per theme - only its brightness drops.
  // Plan 014 round 8 (lever 4): `sizeAttenuation:false` only ever changes anything for a perspective
  // camera (three's own sprite shader guards the whole term behind `isPerspectiveMatrix`), and this
  // camera is orthographic - so that flag was never the lever here, and is left at its default rather
  // than added as a no-op. The real fix is below, in `update()`: each halo gets its own material clone
  // instead of sharing one, so its opacity can be pulled down individually when it sits close to the
  // knight - which, at this camera's fixed oblique angle, is exactly when a brazier's own halo is most
  // likely to be pushed toward a screen corner rather than sitting safely mid-frame.
  const haloMaterial=new THREE.SpriteMaterial({map:glowMap,color:0xffbc70,transparent:true,opacity:.07,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  let state=floor.seed^0x12345;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  function mesh(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;world.add(m);return m;}
  // Plan 014 round 7 (lever 7): a plain coordinate lookup for "is a corridor or a bridge tile right
  // next to this one" - built once, off tile grid coordinates rather than world units, so the pillar
  // loop below can guarantee its sconce instead of leaving it to a hash.
  const tileAt=new Map<string,typeof floor.tiles[number]>();for(const t of floor.tiles)tileAt.set(`${t.x},${t.z}`,t);
  const adjoinsPassage=(tx:number,tz:number)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const nt=tileAt.get(`${tx+dx},${tz+dz}`);return nt!==undefined&&(nt.room<0||nt.wood);});
  // Plan 014 round 9 (lever 5): "a banner on every second pillar" - counted across every pillar the
  // floor places, room or corridor alike, in build order.
  let pillarIndex=0;
  for(const p of floor.props){const x=p.x*TILE,z=p.z*TILE;
    mesh(PROP.base,stone,x,-.18,z);
    if(p.kind==='brazier'){
      // The theme is the owning room's, resolved once at build time - never the current chamber's
      // fire colour or the camera's own room, so a brazier keeps its shape when the player walks on.
      const theme=floor.rooms[p.room].theme;
      const phase=random()*Math.PI*2;
      // Plan 014 round A: plinth, cap, three iron feet, the open dish, its rolled lip and the coal bed.
      // The old six-sided bowl and inverted-cone rim (both closed solids, so their flat top faces sat
      // straight under the torch light and glowed like a lid) are gone from the brazier; `bowlStone`
      // and `rimStone` stay defined because the tint pass still recolours them for anything else.
      mesh(PROP.pedestal,plinthStone,x,.31,z);mesh(PROP.pedestalCap,plinthStone,x,.66,z);
      for(let k=0;k<3;k++){const a=k*Math.PI*2/3+.4;const leg=mesh(PROP.foot,bowlIron,x+Math.cos(a)*.24,.8,z+Math.sin(a)*.24);leg.rotation.z=.18*Math.cos(a);leg.rotation.x=-.18*Math.sin(a);}
      mesh(PROP.dish,bowlIron,x,.86,z);mesh(PROP.lip,bowlIron,x,1.2,z);
      const coals=mesh(PROP.coals,coalGlow,x,1.12,z);coals.castShadow=false;coals.receiveShadow=false;
      const footprint=FLAME_FOOTPRINT[theme];
      // Taller and a touch wider than the billboard footprint a wall sconce uses: the brazier is the
      // room's own fire and has to read above the rim from the far side of the chamber.
      const handle=makeFlameBillboard(Math.max(.62,footprint.w*1.1),Math.max(1.5,footprint.h*1.55),phase);
      // `FLAME_BASE_Y` names the flame's *base*, and the billboard's own quad is already pivoted at
      // its bottom edge (see `dungeon-flame-fx.ts`) precisely so a caller can plant it directly - the
      // first version of this line subtracted half the footprint's height as if positioning a
      // centre, which put the flame's wide, high-alpha foot a good way *below* the rim's top surface
      // (itself at y≈1.07) for every theme, hiding most of the flame inside the bowl geometry and
      // leaving only a faint sliver of its narrow tip poking out. Planting the base at FLAME_BASE_Y
      // directly - comfortably above the rim - is the actual fix.
      // Round A: the flame's foot sits in the coals, just under the lip, so it visibly rises out of the
      // bowl rather than hovering over it. (`FLAME_BASE_Y` was tuned for the old closed bowl.)
      const flameY=1.06;
      handle.group.position.set(x,flameY,z);world.add(handle.group);
      flames.push({handle,theme,phase,y:flameY});
      // The torch light itself moves up with it: at the old flat 1.7 it sat just .6-.8 units above the
      // rim regardless of theme, which is what blew the rim out in the first place. Tying it to the
      // flame's own centre plus a real clearance puts the light inside the flame body it is meant to
      // represent, and roughly doubles its distance to the rim - a ~4x drop in irradiance there
      // (physical inverse-square) for a light that still reaches the room the same way it always did.
      torchPositions.push(new THREE.Vector3(x,flameY+1.0,z));
      const haloScale=FLAME_HALO_SCALE[theme];
      const halo=new THREE.Sprite(haloMaterial.clone());halo.position.set(x,1.7,z);halo.scale.set(haloScale.x,haloScale.y,1);world.add(halo);halos.push(halo);haloBases.push(haloScale);
    } else if(p.kind==='barrel'){
      mesh(PROP.barrel,wood,x,.52,z);
      for(const y of [.2,.78])mesh(PROP.hoop,trim,x,y,z);
    } else if(p.kind==='pillar'){
      // The one piece of interior structure the generator already guarantees is solid: a prop cell is cut
      // out of `cells`, sits at least three tiles off the room's heart and at least three off its
      // neighbours, and something like seven rooms in ten hold one on the camera's side of the frame. At
      // knee height it was a bollard. At four-odd metres on a widened base it is the foreground occluder
      // the frames had none of, and it costs nothing: same three meshes, same shared geometry, scaled.
      // In the keep's own wall stone a column this size came out as a flat dark slab: it is a smooth
      // cylinder with one lit side, and against the paving it read as cut paper rather than as stone. It
      // takes the pale carved stone instead — which is also what keeps it off the knight, who has to stay
      // the darkest mass in the frame and was losing that to his own scenery.
      // Held to the same clamp as everything else this stream builds, which it was not before. A prop cell
      // can fall anywhere in a chamber including a stride from its heart, and a four-metre column there
      // stands on the knight: in the dash strip he spends two frames as a sliver of cloak behind one. Up
      // -screen of the heart it is backdrop and keeps its full height; on the camera's side it now stops
      // where his feet are, which for a column close in means a broken stump in its own plinth — which is
      // what a drowned keep has anyway, and still reads as mass.
      const room=floor.rooms[p.room],air=headroom(x-room.x*TILE,z-room.z*TILE);
      const h=Math.max(.5,Math.min(3.9+random()*1.7,air-.54)),base=mesh(PROP.plinth,carved.pale,x,.24,z);base.scale.set(1.5,1.4,1.5);
      const shaft=mesh(PROP.column,shaftStone,x,h/2+.34,z);shaft.scale.set(1.45,h,1.45);
      const cap=mesh(PROP.capital,carved.pale,x,h+.44,z);cap.scale.set(1.62,1.4,1.62);
      // Plan 014 round 7 (lever 7), round 9 (lever 5): "guarantee a warm sconce on any pillar
      // adjacent to a bridge or corridor tile" is a rule, not odds - so it is checked and satisfied
      // before any of the probabilistic chain/banner/sconce picks below get a turn, not blended in
      // among them. Height floor dropped from 1.8 to 0.9 - round 9's own diagnosis traced one
      // still-bare corridor pillar to exactly this: a real corridor-adjacent pillar that simply rolled
      // a short `h`, which the old floor excluded outright. A sconce mounted low still reads as a
      // sconce.
      const nearPassage=adjoinsPassage(p.x,p.z);
      if(nearPassage&&h>0.9){
        const facing=Math.floor(random()*4)*Math.PI/2,fx=Math.sin(facing)*.5,fz=Math.cos(facing)*.5,by=Math.min(h-.3,1.9);
        mesh(new THREE.BoxGeometry(.2,.13,.2),trim,x+fx*.86,by-.15,z+fz*.86).castShadow=false;
        const sconceHandle=makeFlameBillboard(.38,.5,random()*Math.PI*2);sconceHandle.group.position.set(x+fx*.86,by-.08,z+fz*.86);world.add(sconceHandle.group);staticFlames.push(sconceHandle);
        const sconceLight=new THREE.PointLight(0xff9c52,14,6.5,2);sconceLight.position.set(x+fx*1.9,by,z+fz*1.9);world.add(sconceLight);
      }
      // Plan 014 round 9 (lever 5): "a banner on every second pillar" as a density rule, not odds -
      // checked before the probabilistic chain/banner/sconce picks below, the same way the sconce
      // guarantee above already is. `pillarIndex` counts every standing pillar the floor has, in the
      // same deterministic build-order every other pass over `floor.props` already relies on.
      pillarIndex++;
      if(pillarIndex%2===0&&h>2.2){
        const facing=Math.floor(random()*4)*Math.PI/2,fx=Math.sin(facing)*.44,fz=Math.cos(facing)*.44,by=h-.15;
        const flag=mesh(new THREE.PlaneGeometry(.6,1.35,2,4),red,x+fx,by-.68,z+fz);flag.rotation.y=facing;banners.push(flag);
        const bar=mesh(new THREE.BoxGeometry(.76,.1,.1),trim,x+fx,by,z+fz);bar.rotation.y=facing;bar.castShadow=false;
      }
      // A hanging chain off roughly a third of the standing pillars: bolted under the capital, a short
      // run of alternated links, and a slightly wider anchor ring closing it off at the bottom. Cheap
      // on purpose - a handful of extra draw calls on a handful of pillars, not a batch of its own.
      else if(random()<.34&&h>1.6){
        const rungs=3+Math.floor(random()*3),off=(random()-.5)*.5,ox=x+off,oz=z+off*.6;
        for(let r=0;r<rungs;r++){
          const link=mesh(PROP.link,iron,ox,h+.1-r*.2,oz);
          link.rotation.set(r%2?Math.PI/2:0,0,r%2?0:Math.PI/2);link.castShadow=false;
        }
        const anchor=mesh(PROP.hoop,iron,ox,h+.1-rungs*.2,oz);anchor.scale.set(.42,.6,.42);anchor.castShadow=false;
      // Plan 014 round 4 (lever C6): the reference's signature red banner is not only on a room's own
      // far wall - it hangs off standing pillars too, which is what makes it read as a motif of the
      // keep rather than a decoration of any one chamber. Mutually exclusive with the chain above (one
      // hanging thing per pillar reads as considered; both would read as clutter), and the same
      // `banners` array the room-wall flag uses, so it gets the identical sway for free.
      } else if(random()<.4&&h>2.2){
        const facing=Math.floor(random()*4)*Math.PI/2,fx=Math.sin(facing)*.44,fz=Math.cos(facing)*.44,by=h-.15;
        const flag=mesh(new THREE.PlaneGeometry(.6,1.35,2,4),red,x+fx,by-.68,z+fz);flag.rotation.y=facing;banners.push(flag);
        const bar=mesh(new THREE.BoxGeometry(.76,.1,.1),trim,x+fx,by,z+fz);bar.rotation.y=facing;bar.castShadow=false;
      // Plan 014 round 6 (lever 3): the third thing a standing pillar can carry, when it rolled
      // neither a chain nor a banner - a warm sconce, the same fixed-colour billboard flame the walls
      // carry. "Bridge mooring lanterns or pillar sconces" was the plan's own wording for where a
      // corridor's warm accent could live; a pillar is the one piece of furniture a corridor and a room
      // share, so this is the fixture that reaches both.
      } else if(random()<.5&&h>1.8){
        const facing=Math.floor(random()*4)*Math.PI/2,fx=Math.sin(facing)*.5,fz=Math.cos(facing)*.5,by=Math.min(h-.3,1.9);
        mesh(new THREE.BoxGeometry(.2,.13,.2),trim,x+fx*.86,by-.15,z+fz*.86).castShadow=false;
        const sconceHandle=makeFlameBillboard(.38,.5,random()*Math.PI*2);sconceHandle.group.position.set(x+fx*.86,by-.08,z+fz*.86);world.add(sconceHandle.group);staticFlames.push(sconceHandle);
        const sconceLight=new THREE.PointLight(0xff9c52,14,6.5,2);sconceLight.position.set(x+fx*1.9,by,z+fz*1.9);world.add(sconceLight);
      }
      // Plan 007: the shaft and cap are the "pillar shafts/caps" the local actor cutaway is allowed to
      // open a window in - the low plinth is a foot, not a wall, and stays out of it.
      shaft.userData.cameraOccluder=true;cap.userData.cameraOccluder=true;
    } else {
      // A ruin heap of four pebbles was the flattest thing in the keep. The first piece is now a snapped
      // column shaft still standing in its own rubble, which is mid-height mass on the same four meshes.
      for(let i=0;i<4;i++){const tall=i===1,rock=mesh(PROP.rock,i===0?moss:tall?shaftStone:stone,x+(random()-.5)*(tall?.2:.65),tall?.95+random()*.4:.22+random()*.2,z+(random()-.5)*(tall?.2:.65)),r=.3+random()*.27;
        // Thick enough to have two faces to it. At blade proportions the stump was a black sliver against
        // the paving with no lit side at all, which is the cardboard read this round is trying to kill.
        if(tall)rock.scale.set(.66,1.35+random()*.5,.62);else rock.scale.set(r,r*(.55+random()*.4),r);
        rock.rotation.set(tall?(random()-.5)*.16:random(),random(),tall?(random()-.5)*.16:random());}
    }
  }
  const packed=(x:number,z:number)=>(x+4096)*8192+(z+4096);
  const solid=new Set<number>();for(const t of floor.tiles)solid.add(packed(t.x,t.z));
  const shore=shorelineMaterial(),shoreEdges=floor.tiles.filter(t=>!t.wood).flatMap(t=>[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dz])=>!solid.has(packed(t.x+dx,t.z+dz))).map(([dx,dz])=>({x:t.x,z:t.z,dx,dz})));
  const shoreline=new THREE.InstancedMesh(new THREE.PlaneGeometry(TILE*1.04,.7),shore.material,shoreEdges.length),shoreMatrix=new THREE.Matrix4(),shoreRotation=new THREE.Quaternion();
  shoreEdges.forEach((e,i)=>{shoreRotation.setFromEuler(new THREE.Euler(-Math.PI/2,0,e.dx?Math.PI/2:0));shoreMatrix.compose(new THREE.Vector3((e.x+e.dx*.65)*TILE,-2.71,(e.z+e.dz*.65)*TILE),shoreRotation,new THREE.Vector3(1,1,1));shoreline.setMatrixAt(i,shoreMatrix);});world.add(shoreline);
  // Plan 014 round 9 (lever 3): "characters standing next to water get no cyan bounce" - a real bounce
  // would need the water's own irradiance sampled per-pixel, which is not on offer here; a handful of
  // weak, wide-falloff cyan point lights strung along a sample of the same shoreline edges above is the
  // honest fake the plan itself suggested ("a couple of weak cyan point lights along water edges"). One
  // roughly every eight edges, capped, so a long shoreline does not turn into a light forest - a figure
  // near *any* stretch of water only ever needs to be within one of these a few units, not lit by all
  // of them at once.
  const waterBounceEvery=8,waterBounceMax=6;
  for(let i=0,n=0;i<shoreEdges.length&&n<waterBounceMax;i+=waterBounceEvery,n++){
    const e=shoreEdges[i],bounce=new THREE.PointLight(0x3fd0e8,3.2,5.5,2);
    bounce.position.set((e.x+e.dx*.4)*TILE,.55,(e.z+e.dz*.4)*TILE);world.add(bounce);
  }
  const contactMap=contactTexture(),contactMaterial=new THREE.MeshBasicMaterial({map:contactMap,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const contacts=new THREE.InstancedMesh(new THREE.PlaneGeometry(2.65,2.65),contactMaterial,floor.props.length),contactMatrix=new THREE.Matrix4();
  floor.props.forEach((p,i)=>{contactMatrix.makeRotationX(-Math.PI/2);contactMatrix.setPosition(p.x*TILE,.024,p.z*TILE);contacts.setMatrixAt(i,contactMatrix);});world.add(contacts);
  for(const p of floor.props)solid.add(packed(p.x,p.z));
  const blocks:{x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number;room:number}[]=[];
  const bannerRooms=new Set<number>();
  for(const tile of floor.tiles){
    // Boards over open water carry a trestle instead of masonry; see below.
    if(tile.wood)continue;
    const room=tile.room<0?null:floor.rooms[tile.room];
    // Corridors were skipped outright, which is why the two flattest frames in the set are the two with no
    // room in them. A run has no heart to measure a `headroom` from, so it measures from the tile the
    // knight would be standing on — and that is a stronger rule than the room one, not a weaker one:
    // wherever he is on the run, the two faces pointing away from the lens are behind him and can go as
    // tall as the wall wants, and the two pointing at it come out under a course and build nothing.
    const ox=room?room.x*TILE:tile.x*TILE,oz=room?room.z*TILE:tile.z*TILE;
    // Two faces became four for the reason set out in dungeon-art: the camera-facing edge of every room
    // carried nothing but a 0.38 kerb, so there was never anything between the lens and the fight. Every
    // block here lands in that room's one InstancedMesh, so a wall on the near side is triangles and not
    // a single extra draw call — which is the only reason the near side is affordable at all.
    for(const [dx,dz] of [[-1,0],[0,-1],[1,0],[0,1]]){
      if(solid.has(packed(tile.x+dx,tile.z+dz)))continue;
      const x=(tile.x+dx*.52)*TILE,z=(tile.z+dz*.52)*TILE;
      const near=headroom(x-ox,z-oz);
      // Up-screen of the knight this is backdrop and goes tall; on his side of the frame it may only rise
      // as far as `headroom` says it can without climbing over him. Close in, that is under a course and
      // the kerb already there is the whole of it.
      const ceiling=near===Infinity?Infinity:Math.floor((near-.67)/.53)+1;
      if(ceiling<1)continue;
      // The near side runs at half the stride and two courses at most. A solid second wall all the way
      // round doubled the block count for the whole keep, and a broken run of low masonry is the better
      // read anyway: the reference's mid-ground retaining walls step and gap rather than running true.
      if(near!==Infinity&&((tile.x+tile.z)%2||near>OFF_FRAME))continue;
      // A corridor wall is seen edge-on down its whole length, so it runs lower and in single blocks: the
      // point out there is a continuous mass breaking the water at the top of the frame, not coursework
      // nobody is close enough to read, and at a hundred and eight triangles a block the difference
      // between three courses and five over a long run is the whole of this stream's remaining budget.
      const drawn=!room?2+((Math.abs(tile.x*7+tile.z*13))%3===0?2:0):room.theme==='ruins'?1+Math.floor(random()*4):3+Math.floor(random()*3);
      const layers=Math.min(drawn,ceiling,near===Infinity?99:2);
      // Two blocks to a course on the far wall, one on the near. Nearer the camera a course reads at twice
      // the size, so a single wider block is the truer stone and not merely the cheaper one — and the far
      // wall is where the running bond earns its keep, small enough on screen that paired blocks are the
      // only thing stopping it reading as a grid.
      const halves=near===Infinity&&room?2:1;
      for(let layer=0;layer<layers;layer++)for(let half=0;half<halves;half++){
        if(layer===layers-1&&random()<.2)continue;
        // Running bond: alternate courses slide a fifth of a block along the run. Every course stayed in
        // step before, which is what made a wall read as a grid of identical cubes rather than as masonry.
        const bond=(layer%2?.15:-.15)*.72,along=halves>1?(half-.5)*.72+bond:bond*.9;
        const run=halves>1?.7:1.34,across=halves>1?.65:.72;
        // A corridor has no room of its own, and since the near-face skip was lifted it
        // reaches this line. It borrows the nearest chamber's stone so a passage does not
        // arrive as a grey ribbon laid across a room that has committed to a colour.
        blocks.push({room:tile.room,x:x+(dz?along:0),y:.42+layer*.53,z:z+(dx?along:0),sx:dz?run:across,sy:.5,sz:dx?run:across,color:ROOM_MOOD[(room??nearestRoom(tile.x,tile.z)).theme].block});
      }
      if(near===Infinity&&room&&!bannerRooms.has(room.id)&&layers>=4&&Math.abs(tile.x-room.x)+Math.abs(tile.z-room.z)<Math.max(room.halfX,room.halfZ)+2){
        const flag=mesh(new THREE.PlaneGeometry(.75,1.55,2,4),red,x-dx*.38,1.55,z-dz*.38);if(dx)flag.rotation.y=Math.PI/2;banners.push(flag);bannerRooms.add(room.id);
        const bar=mesh(new THREE.BoxGeometry(dx?.12:1.0,.12,dx?1.0:.12),trim,x-dx*.4,2.37,z-dz*.4);bar.castShadow=false;
      }
      // Plan 014 round 3 (lever C8): a wall-mounted torch every few tiles along any far wall tall
      // enough to carry one - room or corridor alike, which is the whole point: the corridor run that
      // used to be picked out specifically for having *no* brazier in reach now has its own light
      // every four or five tiles, same as the reference keeps one in view almost everywhere. A real
      // point light, not a borrowed one - the shared four-torch pool stays for the knight's own lit
      // pool, these are the keep's own fixed furniture.
      // Plan 014 round 5 (lever B6): denser than round 3's one-in-five - a corridor run is exactly
      // where a single unlucky gap left a shot with no sconce in view at all.
      if(near===Infinity&&layers>=2&&Math.abs(tile.x*13+tile.z*17)%3===0){
        const bx=x-dx*.42,bz=z-dz*.42,by=1.72;
        mesh(new THREE.BoxGeometry(.22,.14,.22),trim,bx,by-.16,bz).castShadow=false;
        // Plan 014 round 4: a fixed warm orange here regardless of theme, never the room's own mood
        // colour - a teal or violet room turned its wall sconces teal or violet too, which erased the
        // one contrast the reference always keeps: warm torchlight against a cool room. The brazier
        // stays the theme's own accent, exactly as asked. Round 6: the billboard flame in place of
        // the old geometry pair; pushed into `staticFlames` (fixed colour, no mood crossfade) rather
        // than the brazier `flames` array.
        const sconceHandle=makeFlameBillboard(.4,.55,random()*Math.PI*2);sconceHandle.group.position.set(bx,by-.1,bz);world.add(sconceHandle.group);staticFlames.push(sconceHandle);
        // A visible warm pool on the floor and the wall behind it is the whole point - not a
        // decorative flicker light lost among the room's own lamps. Bright and short-range.
        const sconceLight=new THREE.PointLight(0xff9c52,16,7.5,2);sconceLight.position.set(bx,by,bz);world.add(sconceLight);
      }
      // Plan 014 round 6 (lever 3): a corridor is bare furniture-wise even once it is lit - every prop
      // the floor generator places is a room fixture (`FloorProp['kind']` is never assigned outside
      // one), so a passage between rooms had walls and paving and nothing else. These three are hashed
      // straight off the wall tile, on different multipliers so they fall independently of the sconce
      // above and of each other rather than always stacking on the same tiles - a corridor gets some
      // mix of them every few tiles, not a repeating "sconce + urn + rubble + chain" set piece.
      const urnStarved=tile.room<0&&layers>=1&&(!lastUrnTile||Math.hypot(tile.x-lastUrnTile.x,tile.z-lastUrnTile.z)>URN_GAP);
      const urnHash=tile.room<0&&layers>=1&&corridorUrnBudget>0&&Math.abs(tile.x*19+tile.z*23)%4===0;
      if(urnStarved||urnHash){
        if(urnHash&&!urnStarved)corridorUrnBudget--;
        lastUrnTile={x:tile.x,z:tile.z};
        const ux=x-dx*.36,uz=z-dz*.36,cluster=1+Math.floor(random()*2);
        for(let i=0;i<cluster;i++){
          const along=(i-(cluster-1)/2)*.4,ax=ux+(dz?along:0),az=uz+(dx?along:0),tall=i===0;
          const s=tall?.6+random()*.2:.4+random()*.16;
          const urn=mesh(PROP.urn,random()<.6?terracotta:darkClay,ax,0,az);
          urn.scale.set(s,s*(tall?1.1:.82),s);urn.rotation.y=random()*Math.PI*2;urn.castShadow=true;
        }
      }
      if(tile.room<0&&layers>=1&&corridorRockBudget>0&&Math.abs(tile.x*29+tile.z*31)%5===0){
        corridorRockBudget--;
        const rx=x-dx*.4,rz=z-dz*.4,count=2+Math.floor(random()*2);
        for(let i=0;i<count;i++){
          const rock=mesh(PROP.rock,stone,rx+(random()-.5)*.6,.14+random()*.1,rz+(random()-.5)*.6),r=.16+random()*.14;
          rock.scale.set(r,r*(.5+random()*.35),r);rock.rotation.set(random(),random(),random());
        }
      }
      // A hanging wall chain - the pillar version of this already exists; a corridor has no pillars of
      // its own, so this is the same fixture bolted to the wall instead of the capital. Round 9 (lever
      // 5): gap-guaranteed the same way the urn cluster above is - a wall long enough to go 5 tiles
      // without one is starved, budget or no budget.
      const chainStarved=tile.room<0&&layers>=2&&(!lastChainTile||Math.hypot(tile.x-lastChainTile.x,tile.z-lastChainTile.z)>CHAIN_GAP);
      const chainHash=tile.room<0&&layers>=2&&corridorChainBudget>0&&Math.abs(tile.x*17+tile.z*11)%5===1;
      if(chainStarved||chainHash){
        if(chainHash&&!chainStarved)corridorChainBudget--;
        lastChainTile={x:tile.x,z:tile.z};
        const hx=x-dx*.46,hz=z-dz*.46,rungs=3+Math.floor(random()*3);
        for(let r=0;r<rungs;r++){
          const link=mesh(PROP.link,iron,hx,2.1-r*.2,hz);
          link.rotation.set(r%2?Math.PI/2:0,0,r%2?0:Math.PI/2);link.castShadow=false;
        }
        const anchor=mesh(PROP.hoop,iron,hx,2.1-rungs*.2,hz);anchor.scale.set(.4,.55,.4);anchor.castShadow=false;
      }
    }
  }
  const tilesByRoom=new Map<number,typeof floor.tiles>();
  for(const t of floor.tiles)if(t.room>=0){const list=tilesByRoom.get(t.room);if(list)list.push(t);else tilesByRoom.set(t.room,[t]);}
  for(const room of floor.rooms.filter(r=>r.theme==='flooded')){
    const edges=(tilesByRoom.get(room.id)??[]).flatMap(t=>[[1,0],[0,1]].filter(([dx,dz])=>!solid.has(packed(t.x+dx,t.z+dz))).map(([dx,dz])=>({x:t.x,z:t.z,dx,dz})));
    if(!edges.length)continue;const e=edges[Math.floor(random()*edges.length)],x=(e.x+e.dx*.58)*TILE,z=(e.z+e.dz*.58)*TILE;
    const fall=mesh(new THREE.PlaneGeometry(1.15,2.8,3,5),flowing,x,-1.38,z);if(e.dx)fall.rotation.y=Math.PI/2;fall.castShadow=false;falls.push(fall);
    for(let i=0;i<4;i++){const ring=mesh(new THREE.RingGeometry(.22+i*.13,.25+i*.13,24),foam,x,-2.69+i*.008,z);ring.rotation.x=-Math.PI/2;ring.castShadow=false;ripples.push(ring);}
  }
  const chips:THREE.Vector3[]=[];for(const room of floor.rooms){const local=tilesByRoom.get(room.id)??[];for(let i=0;i<(room.theme==='ruins'?25:9);i++){const t=local[Math.floor(random()*local.length)];if(t)chips.push(new THREE.Vector3((t.x+random()-.5)*TILE,.05,(t.z+random()-.5)*TILE));}}
  const sprayGeometry=new THREE.BufferGeometry(),sprayPositions=new Float32Array(falls.length*16*3);
  sprayGeometry.setAttribute('position',new THREE.BufferAttribute(sprayPositions,3));
  const sprayMaterial=new THREE.PointsMaterial({color:0xc1e3da,size:.065,transparent:true,opacity:.48,depthWrite:false});
  const spray=new THREE.Points(sprayGeometry,sprayMaterial);spray.frustumCulled=false;world.add(spray);
  const debris=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.2),stone,chips.length),chipMatrix=new THREE.Matrix4();const up=new THREE.Vector3(0,1,0),chipSpin=new THREE.Quaternion(),chipSize=new THREE.Vector3();chips.forEach((p,i)=>{chipMatrix.compose(p,chipSpin.setFromAxisAngle(up,random()*6.28),chipSize.set(.5+random(),.22,.5+random()));debris.setMatrixAt(i,chipMatrix);});debris.receiveShadow=true;world.add(debris);
  const geometry=new RoundedBoxGeometry(1,1,1,1,.105),wallMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.83}),matrix=new THREE.Matrix4();
  weatherStone(wallMaterial);applyStoneTextures(wallMaterial,getMasonryTextures(),.75);
  // Spatial batches, where these were one per chamber. An instanced mesh is culled whole, so a batch as
  // wide as a hall was drawn entire — and in the shadow pass as well — the moment a corner of it clipped
  // either frustum, which at a hundred and eight triangles a block was the largest single waste in the
  // keep and is what pays for the corridors above. Eleven units is narrower than the view.
  const blocksByRegion=new Map<string,typeof blocks>();
  for(const b of blocks){const key=`${Math.floor(b.x/15)},${Math.floor(b.z/15)}`;const list=blocksByRegion.get(key);if(list)list.push(b);else blocksByRegion.set(key,[b]);}
  // Reused scratch objects: this loop runs tens of thousands of times on a deep floor.
  const at=new THREE.Vector3(),spin=new THREE.Quaternion(),size=new THREE.Vector3(),tint=new THREE.Color(),settle=new THREE.Euler();
  for(const local of blocksByRegion.values()){const masonry=new THREE.InstancedMesh(geometry,wallMaterial,local.length);
    // Every block in the keep sat dead square, which is what made a wall read as one extrusion scored
    // with lines rather than as blocks that have been sitting in water for a century: the running bond
    // broke the grid along the course but every edge in the wall was still parallel to every other. A
    // few hundredths of a radian of yaw and a hint of roll per block puts a broken line on the top of
    // each course and a chipped corner on the skyline. It is composed into a quaternion this loop was
    // already building from the identity, so it costs nothing at all — not a triangle, not a call.
    local.forEach((b,i)=>{spin.setFromEuler(settle.set((random()-.5)*.055,(random()-.5)*.16,(random()-.5)*.055));matrix.compose(at.set(b.x,b.y,b.z),spin,size.set(b.sx,b.sy,b.sz));masonry.setMatrixAt(i,matrix);masonry.setColorAt(i,tint.setHex(b.color).multiplyScalar(.78+random()*.44).offsetHSL(random()*.03-.015,random()*.05-.02,0));});masonry.castShadow=masonry.receiveShadow=true;
    // Plan 007: high wall masonry is eligible for the local actor cutaway.
    masonry.userData.cameraOccluder=true;world.add(masonry);
  }
  // A span was the flattest thing in the keep: four boards over open water with a kerb and nothing else,
  // and both masonry passes skipped it because it belongs to no room. dd-ss-07 builds its jetty out of what
  // a jetty is made of — piles carrying down into the water, posts standing off the deck, a rail between
  // them — which is vertical mass above the boards and below them for twelve triangles a piece. The piles
  // on the faces pointing away from the lens carry on up shoulder-high, and one in four of those goes up as
  // a mooring mast to break the empty water at the top of the frame; the faces pointing at the lens stop at
  // a bollard below the knee, because whoever is on the span is standing a single tile from them.
  const timber=new THREE.MeshStandardMaterial({color:0x7e6547,roughness:.96});weatherStone(timber);
  const pileGeometry=new THREE.CylinderGeometry(.5,.5,1,6,1,true),railGeometry=new THREE.BoxGeometry(1,1,1);
  const piles:{x:number;y:number;z:number;w:number;h:number}[]=[],rails:{x:number;y:number;z:number;sx:number;sz:number}[]=[];
  // Plan 014 round 2 (lever C7): stone arches under the bridge, so a span reads as a bridge - built
  // stone standing on piers rising out of the water - rather than a plank deck floating over it. Spring
  // line near the waterline, crown well short of the deck above it, and sparse (a periodic pick on the
  // same back-facing edges the timber trestle already walks) so the underside reads as punctuated
  // stonework rather than a solid wall.
  const bridgeArches:{x:number;z:number;turn:boolean}[]=[];
  for(const tile of floor.tiles){
    if(!tile.wood)continue;
    for(const [dx,dz] of [[-1,0],[0,-1],[1,0],[0,1]]){
      if(solid.has(packed(tile.x+dx,tile.z+dz)))continue;
      const x=(tile.x+dx*.52)*TILE,z=(tile.z+dz*.52)*TILE,back=!facesCamera(dx,dz);
      const mast=back&&Math.abs(tile.x*5+tile.z*11)%4===0;
      piles.push({x,y:-3.05,z,w:mast?.29:.22,h:3.05+(back?(mast?2.8:1.3+Math.abs(tile.x*3+tile.z*7)%3*.2):.42)});
      if(back)rails.push({x,y:1.02,z,sx:dz?TILE:.13,sz:dx?TILE:.13});
      // Plan 014 round 5 (lever B6): a warm lantern on every mooring mast - "add a warm lantern on
      // bridge pillars" was the coordinator's own fallback for a corridor/bridge shot with no sconce
      // in view, and a mast is exactly the bridge's own equivalent of a standing pillar.
      if(mast){
        const ly=2.9;
        mesh(PROP.hoop,trim,x,ly,z).scale.set(.5,.4,.5);
        const lanternHandle=makeFlameBillboard(.36,.4,random()*Math.PI*2);lanternHandle.group.position.set(x,ly+.12,z);world.add(lanternHandle.group);staticFlames.push(lanternHandle);
        const lanternLight=new THREE.PointLight(0xff9c52,15,7,2);lanternLight.position.set(x,ly+.3,z);world.add(lanternLight);
      }
      if(back&&Math.abs(tile.x*11+tile.z*13)%7===0)bridgeArches.push({x,z,turn:dx!==0});
    }
  }
  if(piles.length){
    const trestle=new Map<string,typeof piles>();
    for(const p of piles){const key=`${Math.floor(p.x/11)},${Math.floor(p.z/11)}`;const list=trestle.get(key);if(list)list.push(p);else trestle.set(key,[p]);}
    for(const local of trestle.values()){const posts=new THREE.InstancedMesh(pileGeometry,timber,local.length);
      local.forEach((p,i)=>{matrix.compose(at.set(p.x,p.y+p.h/2,p.z),spin,size.set(p.w,p.h,p.w));posts.setMatrixAt(i,matrix);});
      posts.castShadow=posts.receiveShadow=true;world.add(posts);}
    const rail=new THREE.InstancedMesh(railGeometry,timber,rails.length);
    rails.forEach((r,i)=>{matrix.compose(at.set(r.x,r.y,r.z),spin,size.set(r.sx,.13,r.sz));rail.setMatrixAt(i,matrix);});
    rail.receiveShadow=true;world.add(rail);
  } else {pileGeometry.dispose();railGeometry.dispose();timber.dispose();}
  if(bridgeArches.length){
    const ARCH_SPAN=.68,ARCH_SPRING=-2.42;
    const archGeometry=archivolt(ARCH_SPAN,16);
    const arches=new THREE.InstancedMesh(archGeometry,carved.pale,bridgeArches.length);
    bridgeArches.forEach((a,i)=>{spin.setFromEuler(new THREE.Euler(0,a.turn?Math.PI/2:0,0));matrix.compose(at.set(a.x,ARCH_SPRING,a.z),spin,size.set(1,1,1));arches.setMatrixAt(i,matrix);});
    arches.castShadow=arches.receiveShadow=true;world.add(arches);
    // A pier foot under each leg of the arch, standing on the lakebed rather than the curve simply
    // stopping in mid-water.
    const footGeometry=new THREE.BoxGeometry(.4,.5,.4);
    const feet=new THREE.InstancedMesh(footGeometry,carved.pale,bridgeArches.length*2);
    let fi=0;for(const a of bridgeArches)for(const side of [-1,1]){
      const ox=a.turn?0:side*ARCH_SPAN,oz=a.turn?side*ARCH_SPAN:0;
      matrix.compose(at.set(a.x+ox,ARCH_SPRING-.25,a.z+oz),spin.identity(),size.set(1,1,1));feet.setMatrixAt(fi++,matrix);
    }
    feet.castShadow=feet.receiveShadow=true;world.add(feet);
  }
  // Plan 014 round B: scattered debris along the wall bases - small broken stone chips and dark moss
  // clumps, two instanced draws for the whole floor. Placed by a hash on each tile edge that faces a
  // wall (no neighbouring tile or prop), pushed out toward that edge, so the litter collects where a
  // real floor's does and never in the middle of a fighting space.
  {
    const propCells=new Set(floor.props.map(p=>`${p.x},${p.z}`));
    const chips:THREE.Matrix4[]=[],clumps:THREE.Matrix4[]=[];const q=new THREE.Quaternion(),e=new THREE.Euler(),v=new THREE.Vector3(),sc=new THREE.Vector3();
    const hash=(x:number,z:number,k:number)=>{let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(z|0,0x165667b1)^Math.imul(k+1,0x9e3779b1);h=Math.imul(h^(h>>>15),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);return((h^(h>>>16))>>>0)/4294967296;};
    for(const t of floor.tiles){if(t.wood)continue;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dz],side)=>{
        const key=`${t.x+dx},${t.z+dz}`;if(tileAt.has(key)||propCells.has(key))return;
        const count=Math.floor(hash(t.x,t.z,side*7+1)*4.6);
        for(let k=0;k<count&&chips.length<1600;k++){
          const along=(hash(t.x,t.z,side*31+k*3+2)-.5)*TILE*.86,out=TILE*(.3+hash(t.x,t.z,side*29+k*5+3)*.17);
          const s=.06+hash(t.x,t.z,side*13+k*7+4)*.1;
          v.set(t.x*TILE+dx*out+(dz?along:0),.095+s*.35,t.z*TILE+dz*out+(dx?along:0));
          e.set(hash(t.x,t.z,k*11+5)*6.3,hash(t.x,t.z,k*17+6)*6.3,0);q.setFromEuler(e);sc.set(s*(1+hash(t.x,t.z,k+9)*.6),s*.6,s);
          chips.push(new THREE.Matrix4().compose(v,q,sc));
        }
        if(hash(t.x,t.z,side*5+40)<.5&&clumps.length<520){
          const along=(hash(t.x,t.z,side*3+41)-.5)*TILE*.8,out=TILE*.42,s=.15+hash(t.x,t.z,side+42)*.18;
          v.set(t.x*TILE+dx*out+(dz?along:0),.1,t.z*TILE+dz*out+(dx?along:0));
          e.set(0,hash(t.x,t.z,side+43)*6.3,0);q.setFromEuler(e);sc.set(s*1.6,s*.28,s);
          clumps.push(new THREE.Matrix4().compose(v,q,sc));
        }
      });
    }
    const chipMesh=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),debrisStone,Math.max(1,chips.length));chipMesh.count=chips.length;chips.forEach((m,i)=>chipMesh.setMatrixAt(i,m));chipMesh.receiveShadow=true;world.add(chipMesh);
    const clumpMesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),mossClump,Math.max(1,clumps.length));clumpMesh.count=clumps.length;clumps.forEach((m,i)=>clumpMesh.setMatrixAt(i,m));clumpMesh.receiveShadow=true;world.add(clumpMesh);
  }
  // Different landmarks distinguish shrines from plain halls and ruined courts.
  for(const room of floor.rooms){const x=room.x*TILE,z=room.z*TILE;
    // A ring of low-chroma teal at the heart of every room, cleared or not, was a fourth thing quietly
    // agreeing with the other three. It takes the chamber's own accent now, and only the cleared state
    // is still allowed to say green, because that is the one thing it has to say.
    const material=new THREE.MeshBasicMaterial({color:ROOM_MOOD[room.theme].seal,transparent:true,opacity:.24,depthWrite:false});
    sealTints.push(ROOM_MOOD[room.theme].seal);
    const seal=mesh(new THREE.RingGeometry(room.shape==='round'?2.2:1.0,room.shape==='round'?2.27:1.04,room.shape==='round'?40:4),material,x,.026,z);seal.rotation.x=-Math.PI/2;seal.castShadow=false;seals.push(seal);
    if(room.shape==='gallery')for(let offset=-room.halfZ+1;offset<room.halfZ;offset+=2){const strip=mesh(new THREE.PlaneGeometry(1.1,2.8),runner,x,.025,z+offset*TILE);strip.rotation.x=-Math.PI/2;strip.castShadow=false;}
  }
  // Plan 014 round 7 (lever 4): "sparse dust motes... brighter near torches" - the shape already
  // existed as a flat, uniform point cloud; the per-point colour attribute and the proximity loop in
  // `update()` below are what let the same hundred points catch real torchlight instead of sitting at
  // one fixed dimness everywhere in the keep.
  const motesGeo=new THREE.BufferGeometry(),positions=new Float32Array(100*3),moteColors=new Float32Array(100*3);
  for(let i=0;i<100;i++){positions[i*3]=(random()-.5)*30;positions[i*3+1]=random()*4;positions[i*3+2]=(random()-.5)*30;moteColors[i*3]=moteColors[i*3+1]=moteColors[i*3+2]=.55;}
  motesGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));motesGeo.setAttribute('color',new THREE.BufferAttribute(moteColors,3));
  const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0xb6d6c8,size:.05,transparent:true,opacity:.6,depthWrite:false,vertexColors:true,blending:THREE.AdditiveBlending,toneMapped:false}));world.add(motes);
  const emberGeo=new THREE.BufferGeometry(),emberPositions=new Float32Array(torchPositions.length*6*3);
  emberGeo.setAttribute('position',new THREE.BufferAttribute(emberPositions,3));
  const emberMaterial=new THREE.PointsMaterial({color:0xffb45b,size:.065,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const embers=new THREE.Points(emberGeo,emberMaterial);embers.frustumCulled=false;world.add(embers);
  // Scratch colours for the fire and the stone, so a frame that recolours every flame and every
  // column in the keep allocates nothing.
  const haloTint=new THREE.Color();
  const paleTint=new THREE.Color(),bowlTint=new THREE.Color(),black=new THREE.Color(0x000000);
  const inlayTint=new THREE.Color(),runnerTint=new THREE.Color(),trimTint=new THREE.Color();
  const brassCast=new THREE.Color(0xb08a4e),timberCast=new THREE.Color(0x6d523a);
  return {waterfalls:falls.map(f=>({x:f.position.x,z:f.position.z})),torchPositions,motifs:carved.motifs,
    // Plan 014 round 6: a billboard flame has no single "body" mesh to read a bounding box off any
    // more (three quads, each its own draw). A driver that wants a brazier's footprint reads
    // `FLAME_FOOTPRINT`/`FLAME_BASE_Y` directly (both exported from their own modules) instead of
    // this diagnostic recomputing them; this just says which theme is burning where.
    flames:flames.map(f=>({theme:f.theme,y:f.y})),
    update(t:number,player:THREE.Vector3,cleared:Set<number>,fire:THREE.Color,banner:THREE.Color,masonry:THREE.Color,bed:THREE.Color){
    shore.time.value=t;
    // What burns is the chamber's, not the floor's. The flame body takes the mood colour straight, the
    // core is the same hue run most of the way to white so a flame still has a hot centre, and the halo
    // and embers sit between the two. One hue, four jobs, and it crosses a threshold with the lights.
    emberMaterial.color.copy(fire);
    coalGlow.color.copy(fire).multiplyScalar(.3);
    haloMaterial.color.copy(haloTint.copy(fire));
    red.color.copy(banner);
    // Brass and timber were the last of the shared kit: one gold hoop and one brown rail in all three
    // families, and in a chamber committed to violet the hoops were the warmest thing in the frame.
    // They keep their own character and take the chamber's cast, which is what a metal and a plank do
    // under a coloured light in any case.
    trim.color.copy(trimTint.copy(masonry).lerp(brassCast,.34));
    timber.color.copy(bowlTint.copy(masonry).lerp(timberCast,.55).lerp(black,.18));
    // Carved work belongs to its chamber. One neutral grey served the whole keep before, which put
    // every column, cornice and arch above the knight in value in all three families; these take the
    // mood, with the carving a shade up from the coursework and the bowl a shade down, because a bowl
    // with an open fire in it is lit from inside and has no business being pale before it is.
    // Under the coursework, not over it. `pale` exists so a standing column parts from the wall behind
    // it, and a lift was the lazy way to buy that: measured, it put cap stones and lit pillar faces at
    // sixty to sixty-eight lightness over paving in the low twenties, which is brighter than the knight
    // and brighter than the enemy winding up beside him — and those caps are what stands between the
    // lens and a tell. A column parts from a wall just as well by being darker than it, and darker is
    // the direction the whole field was moving anyway.
    paleTint.copy(masonry).lerp(black,.22);
    carved.stone.color.copy(masonry);carved.pale.color.copy(paleTint);
    carved.inlay.color.copy(inlayTint.copy(bed).lerp(black,.3));
    // Plan 014 round B: the motif lips (the ruin's X and chevrons, the flood's broken bars) were lifted
    // toward white and read as bright painted strokes. They are carved grooves now: under the bed.
    carved.lip.color.copy(inlayTint.copy(bed).lerp(black,.55));
    carved.bronze.color.copy(trimTint.copy(masonry).lerp(brassCast,.34));carved.dark.color.copy(bed);
    runner.color.copy(runnerTint.copy(banner).lerp(black,.5));
    stone.color.copy(masonry);shaftStone.color.copy(paleTint);debrisStone.color.copy(bowlTint.copy(masonry).lerp(black,.15));
    bowlStone.color.copy(bowlTint.copy(masonry).lerp(black,.3));rimStone.color.copy(bowlStone.color);
    plinthStone.color.copy(bowlTint.copy(masonry).lerp(black,.45));
    motes.position.set(player.x,Math.sin(t*.2)*.2,player.z);motes.rotation.y=t*.01;
    // Nearest-torch glow: cheap (a hundred points against a few dozen torch positions, once a frame),
    // and it is the whole of what makes these read as motes drifting through real light rather than a
    // flat haze - approximating each point's world position by the group's own (ignoring the slow spin
    // above, which drifts a point by well under a centimetre a frame) is close enough for a soft glow.
    for(let mi=0;mi<100;mi++){
      const wx=motes.position.x+positions[mi*3],wz=motes.position.z+positions[mi*3+2];
      let nearest=Infinity;
      for(const torch of torchPositions){const dx=torch.x-wx,dz=torch.z-wz,d2=dx*dx+dz*dz;if(d2<nearest)nearest=d2;}
      const glow=Math.max(0,1-Math.sqrt(nearest)/4.2);const b=.55+glow*glow*2.2;
      moteColors[mi*3]=b;moteColors[mi*3+1]=b;moteColors[mi*3+2]=b;
    }
    (motesGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate=true;
    // Plan 014 round 6: the billboard's own shader carries almost all of the "alive" read (scrolling
    // noise, flicker); what this drives is the small bob/breathe on top of that and, for the
    // brazier's own flames, the room's mood colour - `staticFlames` gets the fixed sconce colour
    // instead, never the mood.
    flames.forEach((f)=>{f.handle.update(t,fire);});
    staticFlames.forEach((h)=>{h.update(t,SCONCE_FLAME_COLOUR);});
    banners.forEach((b,i)=>{if(b.position.distanceToSquared(player)<900)animateCloth(b,t+i,.1);});
    // Plan 014 round 8 (lever 4): a brazier a stride or two from the knight sits close enough to this
    // camera's own fixed offset that its halo - sized to read at a normal room's remove - can cover a
    // real fraction of the frame, and often lands right at a corner rather than mid-shot. Faded by
    // proximity to the knight rather than removed outright, so it still marks the brazier up close;
    // just not at full strength.
    halos.forEach((h,i)=>{
      const pulse=1+Math.sin(t*9+i)*.06,base=haloBases[i];
      h.scale.set(base.x*pulse,base.y*pulse,1);
      const near=Math.min(1,h.position.distanceTo(player)/3.2);
      (h.material as THREE.SpriteMaterial).opacity=.1*(.35+near*.65);
    });
    // Rising embers for ruins, slow drift for keep, short local motes for flooded - the same six
    // slots and the same buffer for every theme, so nothing here adds a draw call.
    torchPositions.forEach((p,i)=>{const f=flames[i];for(let j=0;j<6;j++){const o=emberOffset(f.theme,t,f.phase,j),k=(i*6+j)*3;emberPositions[k]=p.x+o.dx;emberPositions[k+1]=p.y+o.dy;emberPositions[k+2]=p.z+o.dz;}});
    emberGeo.attributes.position.needsUpdate=true;
    ripples.forEach((r,i)=>{const phase=(t*.65+(i%4)*.25)%1;r.scale.setScalar(.65+phase*1.7);r.position.y=-2.7+Math.sin(t*.9)*.05+(i%4)*.008;});
    falls.forEach((fall,i)=>{for(let j=0;j<16;j++){const phase=(t*.8+j/16+i*.31)%1,angle=j*2.4,k=(i*16+j)*3;const span=.12+phase*.65;sprayPositions[k]=fall.position.x+Math.cos(angle)*span;sprayPositions[k+1]=-2.7+Math.sin(phase*Math.PI)*(.2+(j%3)*.12);sprayPositions[k+2]=fall.position.z+Math.sin(angle)*span;}});sprayGeometry.attributes.position.needsUpdate=true;
    seals.forEach((seal,i)=>{const m=seal.material as THREE.MeshBasicMaterial;m.color.setHex(cleared.has(i)?0x9dcf9e:sealTints[i]);m.opacity=cleared.has(i)?.6:.16;});
    flowTexture.offset.y=t*.5;falls.forEach((f,i)=>{f.scale.x=1+Math.sin(t*4+i)*.06;});
  },dispose(){runner.dispose();clothTexture.dispose();sprayGeometry.dispose();sprayMaterial.dispose();contactMap.dispose();flowTexture.dispose();glowMap.dispose();haloMaterial.dispose();coalGlow.dispose();halos.forEach(h=>(h.material as THREE.Material).dispose());flames.forEach(f=>f.handle.dispose());staticFlames.forEach(h=>h.dispose());emberGeo.dispose();emberMaterial.dispose();motesGeo.dispose();(motes.material as THREE.Material).dispose();}};
}
