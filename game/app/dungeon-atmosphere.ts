import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addCarvedArchitecture, facesCamera, headroom, OFF_FRAME, ROOM_MOOD } from './dungeon-art';
import { TILE, type generateFloor } from './dungeon-floor';
import { animateCloth, contactTexture, glowTexture, shorelineMaterial, weatherStone } from './dungeon-motion';

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
  flame: keep(new THREE.OctahedronGeometry(.24)),
  barrel: keep(new THREE.CylinderGeometry(.44, .4, 1.0, 9)),
  hoop: keep(new THREE.CylinderGeometry(.46, .46, .09, 9)),
  plinth: keep(new RoundedBoxGeometry(.95, .25, .95, 1, .1)),
  column: keep(new THREE.CylinderGeometry(.3, .4, 1, 10)),
  capital: keep(new RoundedBoxGeometry(.84, .2, .84, 1, .085)),
  rock: keep(new THREE.DodecahedronGeometry(1)),
};

export function addAtmosphere(world:THREE.Group,floor:ReturnType<typeof generateFloor>) {
  // A corridor has no room of its own. Since the near-face skip was lifted its walls
  // are built like any other, so they borrow the nearest chamber's stone rather than
  // arriving as a grey ribbon laid across a room that has committed to a colour.
  const nearestRoom=(x:number,z:number)=>{let best=Infinity,found=floor.rooms[0];for(const r of floor.rooms){const d=(r.x-x)**2+(r.z-z)**2;if(d<best){best=d;found=r;}}return found;};
  const carved=addCarvedArchitecture(world,floor);
  const stone=new THREE.MeshStandardMaterial({color:0x5c6064,roughness:.95}),trim=new THREE.MeshStandardMaterial({color:0x8c7352,roughness:.72,metalness:.25});
  weatherStone(stone);
  // The bowl is a six-sided cylinder under an open fire and was reading as one flat value top to bottom.
  // Its own material, so the fire can bounce up the inside of it. Each bowl is already an individual
  // mesh, so this is a second program, not a second draw call.
  const bowlStone=new THREE.MeshStandardMaterial({color:0x4d5860,roughness:.95});weatherStone(bowlStone,true);
  // Its own material so a standing column reads against the wall behind it rather than merging into it.
  const shaftStone=new THREE.MeshStandardMaterial({color:0x7a7f82,roughness:.86});weatherStone(shaftStone);
  const wood=new THREE.MeshStandardMaterial({color:0x51382b,roughness:1}),moss=new THREE.MeshStandardMaterial({color:0x42594b,roughness:1});
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
  const warm=new THREE.MeshBasicMaterial({color:0xffba65,toneMapped:false}),foam=new THREE.MeshBasicMaterial({color:0xb4e6de,transparent:true,opacity:.7,depthWrite:false});
  const flames:THREE.Mesh[]=[],torchPositions:THREE.Vector3[]=[],banners:THREE.Mesh[]=[],seals:THREE.Mesh[]=[],sealTints:number[]=[],falls:THREE.Mesh[]=[],ripples:THREE.Mesh[]=[];
  const glowMap=glowTexture(),halos:THREE.Sprite[]=[];
  const haloMaterial=new THREE.SpriteMaterial({map:glowMap,color:0xffbc70,transparent:true,opacity:.3,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const coreMaterial=new THREE.MeshBasicMaterial({color:0xffefb9,toneMapped:false});
  let state=floor.seed^0x12345;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  function mesh(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;world.add(m);return m;}
  for(const p of floor.props){const x=p.x*TILE,z=p.z*TILE;
    mesh(PROP.base,stone,x,-.18,z);
    if(p.kind==='brazier'){
      mesh(PROP.bowl,bowlStone,x,.42,z);mesh(PROP.rim,trim,x,.95,z);
      const flame=mesh(PROP.flame,warm,x,1.33,z);flame.castShadow=false;flames.push(flame);torchPositions.push(new THREE.Vector3(x,1.7,z));
      const core=new THREE.Mesh(PROP.flame,coreMaterial);core.scale.set(.55,.8,.55);core.position.y=-.04;flame.add(core);
      const halo=new THREE.Sprite(haloMaterial);halo.position.set(x,1.48,z);halo.scale.set(2.7,3.5,1);world.add(halo);halos.push(halo);
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
  weatherStone(wallMaterial);
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
    local.forEach((b,i)=>{spin.setFromEuler(settle.set((random()-.5)*.055,(random()-.5)*.16,(random()-.5)*.055));matrix.compose(at.set(b.x,b.y,b.z),spin,size.set(b.sx,b.sy,b.sz));masonry.setMatrixAt(i,matrix);masonry.setColorAt(i,tint.setHex(b.color).multiplyScalar(.78+random()*.44).offsetHSL(random()*.03-.015,random()*.05-.02,0));});masonry.castShadow=masonry.receiveShadow=true;world.add(masonry);
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
  for(const tile of floor.tiles){
    if(!tile.wood)continue;
    for(const [dx,dz] of [[-1,0],[0,-1],[1,0],[0,1]]){
      if(solid.has(packed(tile.x+dx,tile.z+dz)))continue;
      const x=(tile.x+dx*.52)*TILE,z=(tile.z+dz*.52)*TILE,back=!facesCamera(dx,dz);
      const mast=back&&Math.abs(tile.x*5+tile.z*11)%4===0;
      piles.push({x,y:-3.05,z,w:mast?.29:.22,h:3.05+(back?(mast?2.8:1.3+Math.abs(tile.x*3+tile.z*7)%3*.2):.42)});
      if(back)rails.push({x,y:1.02,z,sx:dz?TILE:.13,sz:dx?TILE:.13});
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
  const motesGeo=new THREE.BufferGeometry(),positions=new Float32Array(100*3);for(let i=0;i<100;i++){positions[i*3]=(random()-.5)*30;positions[i*3+1]=random()*4;positions[i*3+2]=(random()-.5)*30;}
  motesGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0xb6d6c8,size:.035,transparent:true,opacity:.5,depthWrite:false}));world.add(motes);
  const emberGeo=new THREE.BufferGeometry(),emberPositions=new Float32Array(torchPositions.length*6*3);
  emberGeo.setAttribute('position',new THREE.BufferAttribute(emberPositions,3));
  const emberMaterial=new THREE.PointsMaterial({color:0xffb45b,size:.065,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const embers=new THREE.Points(emberGeo,emberMaterial);embers.frustumCulled=false;world.add(embers);
  // Scratch colours for the fire and the stone, so a frame that recolours every flame and every
  // column in the keep allocates nothing.
  const coreTint=new THREE.Color(),haloTint=new THREE.Color(),white=new THREE.Color(0xffffff);
  const paleTint=new THREE.Color(),bowlTint=new THREE.Color(),black=new THREE.Color(0x000000);
  const inlayTint=new THREE.Color(),runnerTint=new THREE.Color(),trimTint=new THREE.Color();
  const brassCast=new THREE.Color(0xb08a4e),timberCast=new THREE.Color(0x6d523a);
  return {waterfalls:falls.map(f=>({x:f.position.x,z:f.position.z})),torchPositions,update(t:number,player:THREE.Vector3,cleared:Set<number>,fire:THREE.Color,banner:THREE.Color,masonry:THREE.Color,bed:THREE.Color){
    shore.time.value=t;
    // What burns is the chamber's, not the floor's. The flame body takes the mood colour straight, the
    // core is the same hue run most of the way to white so a flame still has a hot centre, and the halo
    // and embers sit between the two. One hue, four jobs, and it crosses a threshold with the lights.
    warm.color.copy(fire);emberMaterial.color.copy(fire);
    // A core run most of the way to white desaturates the one thing the family is named for: measured,
    // four fifths of the bright pixels in the keep and the flood came out under a quarter saturation,
    // so violet and cyan survived only on the skirt while the hot middle was a white dot. Orange got
    // away with it and the two cold fires did not. A quarter of the way instead, which still reads as
    // a hotter centre because the whole flame is drawn above the tone-mapped range.
    coreMaterial.color.copy(coreTint.copy(fire).lerp(white,.18));
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
    carved.lip.color.copy(inlayTint.copy(bed).lerp(white,.2));
    carved.bronze.color.copy(trimTint.copy(masonry).lerp(brassCast,.34));carved.dark.color.copy(bed);
    runner.color.copy(runnerTint.copy(banner).lerp(black,.5));
    stone.color.copy(masonry);shaftStone.color.copy(paleTint);
    bowlStone.color.copy(bowlTint.copy(masonry).lerp(black,.3));
    motes.position.set(player.x,Math.sin(t*.2)*.2,player.z);motes.rotation.y=t*.01;
    flames.forEach((f,i)=>{f.scale.set(.9+Math.sin(t*7+i)*.1,1.65+Math.sin(t*9+i)*.3,.85);f.rotation.y=t+i;});
    banners.forEach((b,i)=>{if(b.position.distanceToSquared(player)<900)animateCloth(b,t+i,.1);});
    halos.forEach((h,i)=>{const pulse=1+Math.sin(t*9+i)*.06;h.scale.set(2.7*pulse,3.5*pulse,1);});
    torchPositions.forEach((p,i)=>{for(let j=0;j<6;j++){const phase=(t*.48+j/6+i*.17)%1,k=(i*6+j)*3;emberPositions[k]=p.x+Math.sin(t*1.4+j*5+i)*phase*.3;emberPositions[k+1]=p.y-.3+phase*1.6;emberPositions[k+2]=p.z+Math.cos(t+j*4)*phase*.25;}});
    emberGeo.attributes.position.needsUpdate=true;
    ripples.forEach((r,i)=>{const phase=(t*.65+(i%4)*.25)%1;r.scale.setScalar(.65+phase*1.7);r.position.y=-2.7+Math.sin(t*.9)*.05+(i%4)*.008;});
    falls.forEach((fall,i)=>{for(let j=0;j<16;j++){const phase=(t*.8+j/16+i*.31)%1,angle=j*2.4,k=(i*16+j)*3;const span=.12+phase*.65;sprayPositions[k]=fall.position.x+Math.cos(angle)*span;sprayPositions[k+1]=-2.7+Math.sin(phase*Math.PI)*(.2+(j%3)*.12);sprayPositions[k+2]=fall.position.z+Math.sin(angle)*span;}});sprayGeometry.attributes.position.needsUpdate=true;
    seals.forEach((seal,i)=>{const m=seal.material as THREE.MeshBasicMaterial;m.color.setHex(cleared.has(i)?0x9dcf9e:sealTints[i]);m.opacity=cleared.has(i)?.6:.16;});
    flowTexture.offset.y=t*.5;falls.forEach((f,i)=>{f.scale.x=1+Math.sin(t*4+i)*.06;});
  },dispose(){runner.dispose();clothTexture.dispose();sprayGeometry.dispose();sprayMaterial.dispose();contactMap.dispose();flowTexture.dispose();glowMap.dispose();haloMaterial.dispose();coreMaterial.dispose();emberGeo.dispose();emberMaterial.dispose();motesGeo.dispose();(motes.material as THREE.Material).dispose();}};
}
