import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addCarvedArchitecture } from './dungeon-art';
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
  addCarvedArchitecture(world,floor);
  const stone=new THREE.MeshStandardMaterial({color:0x566169,roughness:.95}),trim=new THREE.MeshStandardMaterial({color:0x8c7352,roughness:.72,metalness:.25});
  weatherStone(stone);
  // The bowl is a six-sided cylinder under an open fire and was reading as one flat value top to bottom.
  // Its own material, so the fire can bounce up the inside of it. Each bowl is already an individual
  // mesh, so this is a second program, not a second draw call.
  const bowlStone=new THREE.MeshStandardMaterial({color:0x4d5860,roughness:.95});weatherStone(bowlStone,true);
  const wood=new THREE.MeshStandardMaterial({color:0x51382b,roughness:1}),moss=new THREE.MeshStandardMaterial({color:0x42594b,roughness:1});
  const clothCanvas=document.createElement('canvas');clothCanvas.width=128;clothCanvas.height=256;const cc=clothCanvas.getContext('2d')!;
  cc.fillStyle='#792c38';cc.fillRect(0,0,128,256);cc.strokeStyle='#d7b375';cc.lineWidth=3;cc.strokeRect(9,8,110,240);
  cc.beginPath();cc.moveTo(64,54);cc.lineTo(88,104);cc.lineTo(64,158);cc.lineTo(40,104);cc.closePath();cc.stroke();cc.beginPath();cc.moveTo(64,36);cc.lineTo(64,185);cc.moveTo(28,104);cc.lineTo(100,104);cc.stroke();
  const clothTexture=new THREE.CanvasTexture(clothCanvas);clothTexture.colorSpace=THREE.SRGBColorSpace;
  const red=new THREE.MeshStandardMaterial({map:clothTexture,side:THREE.DoubleSide,roughness:1});
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
  const flames:THREE.Mesh[]=[],torchPositions:THREE.Vector3[]=[],banners:THREE.Mesh[]=[],seals:THREE.Mesh[]=[],falls:THREE.Mesh[]=[],ripples:THREE.Mesh[]=[];
  const glowMap=glowTexture(),halos:THREE.Sprite[]=[];
  const haloMaterial=new THREE.SpriteMaterial({map:glowMap,color:0xffbc70,transparent:true,opacity:.55,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
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
      mesh(PROP.plinth,trim,x,.2,z);
      const h=1.4+random()*1.1;mesh(PROP.column,stone,x,h/2+.2,z).scale.y=h;mesh(PROP.capital,stone,x,h+.3,z);
    } else {
      for(let i=0;i<4;i++){const rock=mesh(PROP.rock,i===0?moss:stone,x+(random()-.5)*.65,.22+random()*.2,z+(random()-.5)*.65),r=.3+random()*.27;rock.scale.set(r,r*(.55+random()*.4),r);rock.rotation.set(random(),random(),random());}
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
    if(tile.room<0)continue;
    const room=floor.rooms[tile.room];
    for(const [dx,dz] of [[-1,0],[0,-1]]){
      if(solid.has(packed(tile.x+dx,tile.z+dz)))continue;
      const x=(tile.x+dx*.52)*TILE,z=(tile.z+dz*.52)*TILE;
      const layers=room.theme==='ruins'?1+Math.floor(random()*4):3+Math.floor(random()*3);
      for(let layer=0;layer<layers;layer++)for(let half=0;half<2;half++){
        if(layer===layers-1&&random()<.2)continue;
        // Running bond: alternate courses slide a fifth of a block along the run. Every course stayed in
        // step before, which is what made a wall read as a grid of identical cubes rather than as masonry.
        const bond=(layer%2?.15:-.15)*.72,along=(half-.5)*.72+bond;
        blocks.push({room:tile.room,x:x+(dz?along:0),y:.42+layer*.53,z:z+(dx?along:0),sx:dz?.7:.65,sy:.5,sz:dx?.7:.65,color:room.theme==='ruins'?0x697469:room.theme==='flooded'?0x526872:0x606970});
      }
      if(!bannerRooms.has(room.id)&&layers>=4&&Math.abs(tile.x-room.x)+Math.abs(tile.z-room.z)<Math.max(room.halfX,room.halfZ)+2){
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
  // Separate chamber batches let the view and shadow frusta skip distant masonry.
  const blocksByRoom=new Map<number,typeof blocks>();
  for(const b of blocks){const list=blocksByRoom.get(b.room);if(list)list.push(b);else blocksByRoom.set(b.room,[b]);}
  // Reused scratch objects: this loop runs tens of thousands of times on a deep floor.
  const at=new THREE.Vector3(),spin=new THREE.Quaternion(),size=new THREE.Vector3(),tint=new THREE.Color();
  for(const room of floor.rooms){const local=blocksByRoom.get(room.id)??[],masonry=new THREE.InstancedMesh(geometry,wallMaterial,local.length);
    local.forEach((b,i)=>{matrix.compose(at.set(b.x,b.y,b.z),spin,size.set(b.sx,b.sy,b.sz));masonry.setMatrixAt(i,matrix);masonry.setColorAt(i,tint.setHex(b.color).multiplyScalar(.78+random()*.44).offsetHSL(random()*.03-.015,random()*.05-.02,0));});masonry.castShadow=masonry.receiveShadow=true;world.add(masonry);
  }
  // Different landmarks distinguish shrines from plain halls and ruined courts.
  for(const room of floor.rooms){const x=room.x*TILE,z=room.z*TILE;
    const material=new THREE.MeshBasicMaterial({color:0x7faeae,transparent:true,opacity:.24,depthWrite:false});
    const seal=mesh(new THREE.RingGeometry(room.shape==='round'?2.2:1.0,room.shape==='round'?2.27:1.04,room.shape==='round'?40:4),material,x,.026,z);seal.rotation.x=-Math.PI/2;seal.castShadow=false;seals.push(seal);
    if(room.shape==='gallery')for(let offset=-room.halfZ+1;offset<room.halfZ;offset+=2){const strip=mesh(new THREE.PlaneGeometry(1.1,2.8),red,x,.025,z+offset*TILE);strip.rotation.x=-Math.PI/2;strip.castShadow=false;}
  }
  const motesGeo=new THREE.BufferGeometry(),positions=new Float32Array(100*3);for(let i=0;i<100;i++){positions[i*3]=(random()-.5)*30;positions[i*3+1]=random()*4;positions[i*3+2]=(random()-.5)*30;}
  motesGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0xb6d6c8,size:.035,transparent:true,opacity:.5,depthWrite:false}));world.add(motes);
  const emberGeo=new THREE.BufferGeometry(),emberPositions=new Float32Array(torchPositions.length*6*3);
  emberGeo.setAttribute('position',new THREE.BufferAttribute(emberPositions,3));
  const emberMaterial=new THREE.PointsMaterial({color:0xffb45b,size:.065,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const embers=new THREE.Points(emberGeo,emberMaterial);embers.frustumCulled=false;world.add(embers);
  return {waterfalls:falls.map(f=>({x:f.position.x,z:f.position.z})),torchPositions,update(t:number,player:THREE.Vector3,cleared:Set<number>){
    shore.time.value=t;
    motes.position.set(player.x,Math.sin(t*.2)*.2,player.z);motes.rotation.y=t*.01;
    flames.forEach((f,i)=>{f.scale.set(.9+Math.sin(t*7+i)*.1,1.65+Math.sin(t*9+i)*.3,.85);f.rotation.y=t+i;});
    banners.forEach((b,i)=>{if(b.position.distanceToSquared(player)<900)animateCloth(b,t+i,.1);});
    halos.forEach((h,i)=>{const pulse=1+Math.sin(t*9+i)*.06;h.scale.set(2.7*pulse,3.5*pulse,1);});
    torchPositions.forEach((p,i)=>{for(let j=0;j<6;j++){const phase=(t*.48+j/6+i*.17)%1,k=(i*6+j)*3;emberPositions[k]=p.x+Math.sin(t*1.4+j*5+i)*phase*.3;emberPositions[k+1]=p.y-.3+phase*1.6;emberPositions[k+2]=p.z+Math.cos(t+j*4)*phase*.25;}});
    emberGeo.attributes.position.needsUpdate=true;
    ripples.forEach((r,i)=>{const phase=(t*.65+(i%4)*.25)%1;r.scale.setScalar(.65+phase*1.7);r.position.y=-2.7+Math.sin(t*.9)*.05+(i%4)*.008;});
    falls.forEach((fall,i)=>{for(let j=0;j<16;j++){const phase=(t*.8+j/16+i*.31)%1,angle=j*2.4,k=(i*16+j)*3;const span=.12+phase*.65;sprayPositions[k]=fall.position.x+Math.cos(angle)*span;sprayPositions[k+1]=-2.7+Math.sin(phase*Math.PI)*(.2+(j%3)*.12);sprayPositions[k+2]=fall.position.z+Math.sin(angle)*span;}});sprayGeometry.attributes.position.needsUpdate=true;
    seals.forEach((seal,i)=>{const m=seal.material as THREE.MeshBasicMaterial;m.color.setHex(cleared.has(i)?0x9dcf9e:0x7faeae);m.opacity=cleared.has(i)?.6:.16;});
    flowTexture.offset.y=t*.5;falls.forEach((f,i)=>{f.scale.x=1+Math.sin(t*4+i)*.06;});
  },dispose(){clothTexture.dispose();sprayGeometry.dispose();sprayMaterial.dispose();contactMap.dispose();flowTexture.dispose();glowMap.dispose();haloMaterial.dispose();coreMaterial.dispose();emberGeo.dispose();emberMaterial.dispose();motesGeo.dispose();(motes.material as THREE.Material).dispose();}};
}
