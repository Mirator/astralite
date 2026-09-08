import * as THREE from 'three';
import { TILE, cellKey, type generateFloor } from './dungeon-floor';

export function stoneTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; let seed = 7123;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#b2b8b4'; ctx.fillRect(0,0,128,128);
  for (let i=0;i<3400;i++) { const shade = Math.floor(90 + random()*110); ctx.fillStyle = `rgba(${shade},${shade},${shade},.18)`; ctx.fillRect(random()*128,random()*128,1+random()*4,1+random()*2); }
  ctx.strokeStyle='#535f6066'; ctx.lineWidth=1; ctx.beginPath();ctx.moveTo(0,38);ctx.lineTo(29,49);ctx.lineTo(42,74);ctx.lineTo(57,82);ctx.stroke();
  ctx.strokeStyle='#65706baa';ctx.lineWidth=2;
  for(let row=1;row<3;row++){ctx.beginPath();ctx.moveTo(0,row*42);ctx.lineTo(128,row*42);ctx.stroke();}
  for(let row=0;row<3;row++){const x=row%2?39:77;ctx.beginPath();ctx.moveTo(x,row*42);ctx.lineTo(x,(row+1)*42);ctx.stroke();}
  ctx.strokeStyle='#e7e6d644'; ctx.strokeRect(2,2,124,124);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=4; return texture;
}

export function addAtmosphere(world:THREE.Group,floor:ReturnType<typeof generateFloor>) {
  const stone=new THREE.MeshStandardMaterial({color:0x566169,roughness:.95}),trim=new THREE.MeshStandardMaterial({color:0x8c7352,roughness:.72,metalness:.25});
  const wood=new THREE.MeshStandardMaterial({color:0x51382b,roughness:1}),moss=new THREE.MeshStandardMaterial({color:0x42594b,roughness:1});
  const red=new THREE.MeshStandardMaterial({color:0x76292b,side:THREE.DoubleSide,roughness:1});
  const waterCanvas=document.createElement('canvas');waterCanvas.width=64;waterCanvas.height=128;const wc=waterCanvas.getContext('2d')!;wc.fillStyle='#619d9e';wc.fillRect(0,0,64,128);
  for(let i=0;i<35;i++){wc.fillStyle=i%2?'#c4eee0aa':'#83c7c4aa';wc.fillRect((i*17)%64,(i*37)%128,1+i%3,15+i%25);}
  const flowTexture=new THREE.CanvasTexture(waterCanvas);flowTexture.wrapT=THREE.RepeatWrapping;flowTexture.repeat.y=2;flowTexture.colorSpace=THREE.SRGBColorSpace;
  const flowing=new THREE.MeshBasicMaterial({map:flowTexture,color:0xc6f0e7,transparent:true,opacity:.85,side:THREE.DoubleSide});
  const warm=new THREE.MeshBasicMaterial({color:0xffba65,toneMapped:false}),foam=new THREE.MeshBasicMaterial({color:0xb4e6de,transparent:true,opacity:.7,depthWrite:false});
  const flames:THREE.Mesh[]=[],torchPositions:THREE.Vector3[]=[],banners:THREE.Mesh[]=[],seals:THREE.Mesh[]=[],falls:THREE.Mesh[]=[];
  let state=floor.seed^0x12345;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  function mesh(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;world.add(m);return m;}
  for(const p of floor.props){const x=p.x*TILE,z=p.z*TILE;
    mesh(new THREE.BoxGeometry(TILE,.42,TILE),stone,x,-.18,z);
    if(p.kind==='brazier'){
      mesh(new THREE.CylinderGeometry(.34,.5,.8,6),stone,x,.42,z);mesh(new THREE.CylinderGeometry(.5,.3,.24,8),trim,x,.95,z);
      const flame=mesh(new THREE.OctahedronGeometry(.24),warm,x,1.33,z);flame.castShadow=false;flames.push(flame);torchPositions.push(new THREE.Vector3(x,1.7,z));
    } else if(p.kind==='barrel'){
      mesh(new THREE.CylinderGeometry(.44,.4,1.0,9),wood,x,.52,z);
      for(const y of [.2,.78])mesh(new THREE.CylinderGeometry(.46,.46,.09,9),trim,x,y,z);
    } else if(p.kind==='pillar'){
      mesh(new THREE.BoxGeometry(.95,.25,.95),trim,x,.2,z);
      const h=1.4+random()*1.1;mesh(new THREE.CylinderGeometry(.35,.45,h,6),stone,x,h/2+.2,z);mesh(new THREE.BoxGeometry(.84,.2,.84),stone,x,h+.3,z);
    } else {
      for(let i=0;i<4;i++){const rock=mesh(new THREE.DodecahedronGeometry(.3+random()*.27),i===0?moss:stone,x+(random()-.5)*.65,.22+random()*.2,z+(random()-.5)*.65);rock.scale.y=.55+random()*.4;rock.rotation.set(random(),random(),random());}
    }
  }
  const blocked=new Set(floor.props.map(p=>cellKey(p.x,p.z))),blocks:{x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number;room:number}[]=[];
  const bannerRooms=new Set<number>();
  for(const tile of floor.tiles){
    if(tile.room<0)continue;
    const room=floor.rooms[tile.room];
    for(const [dx,dz] of [[-1,0],[0,-1]]){
      if(floor.cells.has(cellKey(tile.x+dx,tile.z+dz))||blocked.has(cellKey(tile.x+dx,tile.z+dz)))continue;
      const x=(tile.x+dx*.52)*TILE,z=(tile.z+dz*.52)*TILE;
      const layers=room.theme==='ruins'?1+Math.floor(random()*4):3+Math.floor(random()*3);
      for(let layer=0;layer<layers;layer++)for(let half=0;half<2;half++){
        if(layer===layers-1&&random()<.2)continue;
        blocks.push({room:tile.room,x:x+(dz?(half-.5)*.72:0),y:.42+layer*.53,z:z+(dx?(half-.5)*.72:0),sx:dz?.7:.65,sy:.5,sz:dx?.7:.65,color:room.theme==='ruins'?0x697469:room.theme==='flooded'?0x526872:0x606970});
      }
      if(!bannerRooms.has(room.id)&&layers>=4&&Math.abs(tile.x-room.x)+Math.abs(tile.z-room.z)<Math.max(room.halfX,room.halfZ)+2){
        const flag=mesh(new THREE.PlaneGeometry(.75,1.55,2,4),red,x-dx*.38,1.55,z-dz*.38);if(dx)flag.rotation.y=Math.PI/2;banners.push(flag);bannerRooms.add(room.id);
        const bar=mesh(new THREE.BoxGeometry(dx?.12:1.0,.12,dx?1.0:.12),trim,x-dx*.4,2.37,z-dz*.4);bar.castShadow=false;
      }

    }
  }
  for(const room of floor.rooms.filter(r=>r.theme==='flooded')){
    const edges=floor.tiles.filter(t=>t.room===room.id).flatMap(t=>[[1,0],[0,1]].filter(([dx,dz])=>!floor.cells.has(cellKey(t.x+dx,t.z+dz))&&!blocked.has(cellKey(t.x+dx,t.z+dz))).map(([dx,dz])=>({x:t.x,z:t.z,dx,dz})));
    if(!edges.length)continue;const e=edges[Math.floor(random()*edges.length)],x=(e.x+e.dx*.58)*TILE,z=(e.z+e.dz*.58)*TILE;
    const fall=mesh(new THREE.PlaneGeometry(1.15,2.8,3,5),flowing,x,-1.38,z);if(e.dx)fall.rotation.y=Math.PI/2;fall.castShadow=false;falls.push(fall);
    for(let i=0;i<4;i++){const ring=mesh(new THREE.RingGeometry(.22+i*.13,.25+i*.13,24),foam,x,-2.73,z);ring.rotation.x=-Math.PI/2;ring.castShadow=false;}
  }
  const chips:THREE.Vector3[]=[];for(const room of floor.rooms){const local=floor.tiles.filter(t=>t.room===room.id);for(let i=0;i<(room.theme==='ruins'?25:9);i++){const t=local[Math.floor(random()*local.length)];if(t)chips.push(new THREE.Vector3((t.x+random()-.5)*TILE,.05,(t.z+random()-.5)*TILE));}}
  const debris=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.2),stone,chips.length),chipMatrix=new THREE.Matrix4();chips.forEach((p,i)=>{chipMatrix.compose(p,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*6.28),new THREE.Vector3(.5+random(),.22,.5+random()));debris.setMatrixAt(i,chipMatrix);});debris.receiveShadow=true;world.add(debris);
  const geometry=new THREE.BoxGeometry(1,1,1),wallMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95}),matrix=new THREE.Matrix4();
  // Separate chamber batches let the view and shadow frusta skip distant masonry.
  for(const room of floor.rooms){const local=blocks.filter(b=>b.room===room.id),masonry=new THREE.InstancedMesh(geometry,wallMaterial,local.length);
    local.forEach((b,i)=>{matrix.compose(new THREE.Vector3(b.x,b.y,b.z),new THREE.Quaternion(),new THREE.Vector3(b.sx,b.sy,b.sz));masonry.setMatrixAt(i,matrix);masonry.setColorAt(i,new THREE.Color(b.color).multiplyScalar(.9+random()*.22));});masonry.castShadow=masonry.receiveShadow=true;world.add(masonry);
  }
  // Different landmarks distinguish shrines from plain halls and ruined courts.
  for(const room of floor.rooms){const x=room.x*TILE,z=room.z*TILE;
    const material=new THREE.MeshBasicMaterial({color:0x7faeae,transparent:true,opacity:.24,depthWrite:false});
    const seal=mesh(new THREE.RingGeometry(room.shape==='round'?2.2:1.0,room.shape==='round'?2.27:1.04,room.shape==='round'?40:4),material,x,.026,z);seal.rotation.x=-Math.PI/2;seal.castShadow=false;seals.push(seal);
    if(room.shape==='gallery')for(let offset=-room.halfZ+1;offset<room.halfZ;offset+=2){const strip=mesh(new THREE.PlaneGeometry(1.1,2.8),red,x,.025,z+offset*TILE);strip.rotation.x=-Math.PI/2;strip.castShadow=false;}
  }
  const motesGeo=new THREE.BufferGeometry(),positions=new Float32Array(100*3);for(let i=0;i<100;i++){positions[i*3]=(random()-.5)*30;positions[i*3+1]=random()*4;positions[i*3+2]=(random()-.5)*30;}
  motesGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0xb6d6c8,size:.035,transparent:true,opacity:.5,depthWrite:false}));world.add(motes);
  return {waterfalls:falls.map(f=>({x:f.position.x,z:f.position.z})),torchPositions,update(t:number,player:THREE.Vector3,cleared:Set<number>){
    motes.position.set(player.x,Math.sin(t*.2)*.2,player.z);motes.rotation.y=t*.01;
    flames.forEach((f,i)=>{f.scale.set(.9+Math.sin(t*7+i)*.1,1.65+Math.sin(t*9+i)*.3,.85);f.rotation.y=t+i;});
    banners.forEach((b,i)=>{b.rotation.z=Math.sin(t*1.3+i)*.035;});
    seals.forEach((seal,i)=>{const m=seal.material as THREE.MeshBasicMaterial;m.color.setHex(cleared.has(i)?0x9dcf9e:0x7faeae);m.opacity=cleared.has(i)?.6:.16;});
    flowTexture.offset.y=t*.5;falls.forEach((f,i)=>{f.scale.x=1+Math.sin(t*4+i)*.06;});
  },dispose(){flowTexture.dispose();motesGeo.dispose();(motes.material as THREE.Material).dispose();}};
}
