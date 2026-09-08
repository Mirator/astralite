import * as THREE from 'three';
import { TILE, type generateFloor } from './dungeon-floor';

export const ROOM_NAMES = ['The Threshold', 'Hall of Ash', 'The Sunken Choir', 'Watchers’ Crossing', 'Chapel of Salt', 'The Ossuary', 'The Stillwater Vault', 'Ember Gallery', 'The Forgotten Court', 'Hall of Tides', 'The Last Vigil', 'The Warden’s Rest'];

export function stoneTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; let seed = 7123;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#b2b8b4'; ctx.fillRect(0,0,128,128);
  for (let i=0;i<3400;i++) { const shade = Math.floor(90 + random()*110); ctx.fillStyle = `rgba(${shade},${shade},${shade},.18)`; ctx.fillRect(random()*128,random()*128,1+random()*4,1+random()*2); }
  ctx.strokeStyle='#535f6066'; ctx.lineWidth=1; ctx.beginPath();ctx.moveTo(0,38);ctx.lineTo(29,49);ctx.lineTo(42,74);ctx.lineTo(57,82);ctx.stroke();
  ctx.strokeStyle='#e7e6d666'; ctx.strokeRect(3,3,122,122);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=4; return texture;
}

export function addAtmosphere(world: THREE.Group, floor: ReturnType<typeof generateFloor>) {
  const stone = new THREE.MeshStandardMaterial({color:0x46565b,roughness:0.85});
  const trim = new THREE.MeshStandardMaterial({color:0x958266,metalness:0.5,roughness:0.5});
  const dark = new THREE.MeshStandardMaterial({color:0x152a30,roughness:0.9});
  const warm = new THREE.MeshBasicMaterial({color:0xffb862,toneMapped:false});
  const cold = new THREE.MeshBasicMaterial({color:0x74dfcf,transparent:true,opacity:0.48,depthWrite:false,toneMapped:false});
  const seals: THREE.Mesh[] = [], flames: THREE.Mesh[] = [], torchPositions: THREE.Vector3[] = [];
  function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x:number,y:number,z:number) { const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;world.add(m);return m; }
  for(const r of floor.rooms) {
    const cx=r.x*TILE,cz=r.z*TILE;
    for(const [dx,dz] of [[4,0],[-4,0],[0,4],[0,-4]]) {
      const x=cx+dx*TILE,z=cz+dz*TILE;
      mesh(new THREE.BoxGeometry(1.48,0.4,1.48),stone,x,-0.18,z);
      mesh(new THREE.BoxGeometry(1.05,0.2,1.05),trim,x,0.13,z);
      mesh(new THREE.CylinderGeometry(0.3,0.45,0.9,6),stone,x,0.65,z);
      mesh(new THREE.CylinderGeometry(0.53,0.28,0.27,8),trim,x,1.2,z);
      const flame=mesh(new THREE.OctahedronGeometry(0.25),r.id%3===2?cold:warm,x,1.56,z);flame.scale.y=1.9;flame.castShadow=false;flames.push(flame);torchPositions.push(new THREE.Vector3(x,1.8,z));
    }
    const seal=mesh(new THREE.RingGeometry(2.6,2.7,64),cold.clone(),cx,0.027,cz);seal.rotation.x=-Math.PI/2;seal.castShadow=false; seals.push(seal);
    const inner=mesh(new THREE.RingGeometry(1.8,1.83,6),trim,cx,0.03,cz);inner.rotation.x=-Math.PI/2;inner.castShadow=false;
    for(let n=0;n<12;n++) { const angle=n*Math.PI/6; const rune=mesh(new THREE.BoxGeometry(0.12,0.012,n%3===0?0.45:0.2),trim,cx+Math.cos(angle)*2.35,0.03,cz+Math.sin(angle)*2.35);rune.rotation.y=-angle; rune.castShadow=false; }
    // Exterior buttresses frame each room without adding invisible collision.
    for(const sx of [-1,1]) for(const sz of [-1,1]) {
      const x=(r.x+sx*(r.halfX+0.72))*TILE,z=(r.z+sz*(r.halfZ+0.72))*TILE;
      mesh(new THREE.BoxGeometry(1.6,0.6,1.6),stone,x,-0.25,z);
      mesh(new THREE.CylinderGeometry(0.48,0.65,3.2,6),stone,x,1.25,z);
      mesh(new THREE.BoxGeometry(1.1,0.25,1.1),trim,x,2.82,z);
      mesh(new THREE.ConeGeometry(0.65,0.8,4),dark,x,3.32,z);
      const flame=mesh(new THREE.OctahedronGeometry(0.22),warm,x,3.2,z);flame.scale.y=2;flame.castShadow=false;flames.push(flame);torchPositions.push(new THREE.Vector3(x,3.1,z));
    }
    // Shallow inlaid processional paths make crossings and chamber centers legible.
    for(const [a,b] of floor.edges.filter(([a,b])=>a===r.id||b===r.id)) {
      const other=floor.rooms[a===r.id?b:a],dx=Math.sign(other.x-r.x),dz=Math.sign(other.z-r.z);
      const horizontal=Math.abs(other.x-r.x)>Math.abs(other.z-r.z);
      for(let i=3;i<(horizontal?r.halfX:r.halfZ);i+=2) {
        const m=mesh(new THREE.BoxGeometry(horizontal?0.06:1.0,0.015,horizontal?1.0:0.06),trim,cx+(horizontal?dx*i*TILE:0),0.025,cz+(horizontal?0:dz*i*TILE));m.castShadow=false;
      }
    }
  }
  const motesGeo=new THREE.BufferGeometry(),positions=new Float32Array(90*3);
  for(let i=0;i<90;i++){positions[i*3]=Math.sin(i*13.7)*15;positions[i*3+1]=0.5+(i%17)/5;positions[i*3+2]=Math.cos(i*5.3)*15;}
  motesGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0x9edacb,size:0.035,transparent:true,opacity:0.6,depthWrite:false}));world.add(motes);
  return { seals, torchPositions, update(t:number,player:THREE.Vector3,cleared:Set<number>){
    motes.position.set(player.x,Math.sin(t*0.2)*0.2,player.z);motes.rotation.y=t*0.015;
    flames.forEach((flame,i)=>{flame.scale.y=1.8+Math.sin(t*8+i)*0.35;flame.rotation.y=t+i;});
    seals.forEach((seal,i)=>{const m=seal.material as THREE.MeshBasicMaterial;m.color.setHex(cleared.has(i)?0x8de9be:0x639fba);m.opacity=(cleared.has(i)?0.6:0.22)+Math.sin(t*1.7+i)*0.07;});
  }, dispose(){motesGeo.dispose();(motes.material as THREE.Material).dispose();} };
}
