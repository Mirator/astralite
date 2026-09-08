export const TILE = 1.48;
export type Room = { id: number; x: number; z: number; halfX: number; halfZ: number; shape: 'hall' | 'round' | 'cross' | 'court' | 'gallery' | 'crypt'; theme: 'keep' | 'ruins' | 'flooded'; name: string };
export type FloorProp = { x: number; z: number; kind: 'brazier' | 'pillar' | 'rubble' | 'barrel'; room: number };
export const cellKey = (x: number, z: number) => `${x},${z}`;

export function generateFloor(seed: number) {
  let state = seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t=state; t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296; };
  const int = (a:number,b:number) => a+Math.floor(random()*(b-a+1));
  const rooms:Room[]=[], edges:[number,number][]=[], cells=new Set<string>(), ownership=new Map<string,number>(), wood=new Set<string>(), props:FloorProp[]=[];
  const shapes:Room['shape'][]=['hall','round','cross','court','gallery','crypt'];
  const themes:Room['theme'][]=['keep','ruins','flooded'];
  const prefixes=['Ashen','Forgotten','Drowned','Silent','Broken','Saltbound','Lantern','Hollow'];
  const names={hall:'Hall',round:'Rotunda',cross:'Crossing',court:'Court',gallery:'Gallery',crypt:'Crypt'};
  const carveRoom=(r:Room)=>{
    for(let x=-r.halfX;x<=r.halfX;x++)for(let z=-r.halfZ;z<=r.halfZ;z++){
      let keep=true;
      if(r.shape==='round')keep=(x/(r.halfX+.4))**2+(z/(r.halfZ+.4))**2<=1;
      if(r.shape==='cross')keep=Math.abs(x)<=Math.max(2,r.halfX*.42)||Math.abs(z)<=Math.max(2,r.halfZ*.42);
      if(r.shape==='court')keep=!(x>2&&z < -2);
      if(r.shape==='crypt')keep=!(Math.abs(x)>r.halfX-2&&Math.abs(z)>r.halfZ-2);
      if(keep){const key=cellKey(r.x+x,r.z+z);cells.add(key);ownership.set(key,r.id);}
    }
  };
  const connect=(a:number,b:number)=>{
    edges.push([a,b]);const from=rooms[a],to=rooms[b];let x=from.x,z=from.z;
    const wooden=random()<.5, width=random()<.3?2:1;
    const carve=()=>{for(let dx=-width;dx<=width;dx++)for(let dz=-width;dz<=width;dz++){const key=cellKey(x+dx,z+dz);cells.add(key);if(wooden&&!ownership.has(key))wood.add(key);}};
    const bend={x:Math.round((from.x+to.x)/2)+int(-3,3),z:Math.round((from.z+to.z)/2)+int(-3,3)};
    carve();for(const goal of [bend,to])for(const axis of random()<.5?['x','z']:['z','x'])while(axis==='x'?x!==goal.x:z!==goal.z){if(axis==='x')x+=Math.sign(goal.x-x);else z+=Math.sign(goal.z-z);carve();}
  };
  const target=int(16,23);
  for(let id=0;id<target;id++){
    const shape=id===0?'crypt':shapes[int(0,shapes.length-1)];
    let halfX=int(5,9),halfZ=int(4,8);if(shape==='gallery'){halfX=int(9,13);halfZ=int(3,4);if(random()<.5)[halfX,halfZ]=[halfZ,halfX];}
    if(shape==='court'){halfX=int(8,11);halfZ=int(7,10);}
    let x=0,z=0,parent=0;
    if(id)for(let attempt=0;attempt<400;attempt++){
      parent=int(0,id-1);const r=rooms[parent],angle=random()*Math.PI*2,distance=Math.max(r.halfX,r.halfZ)+Math.max(halfX,halfZ)+int(5,13);
      x=Math.round(r.x+Math.cos(angle)*distance);z=Math.round(r.z+Math.sin(angle)*distance);
      if(rooms.every(other=>Math.abs(x-other.x)>halfX+other.halfX+3||Math.abs(z-other.z)>halfZ+other.halfZ+3))break;
      if(attempt===399){x=Math.max(...rooms.map(r=>r.x+r.halfX))+halfX+9;z=rooms[parent].z;}
    }
    const r:Room={id,x,z,halfX,halfZ,shape,theme:id===0?'keep':themes[int(0,2)],name:id===0?'The Tide Gate':`${prefixes[int(0,7)]} ${names[shape]}`};rooms.push(r);carveRoom(r);if(id)connect(parent,id);
  }
  // Nearby shortcuts introduce loops without imposing a lattice on the layout.
  rooms.forEach(r=>{const nearby=rooms.filter(other=>other.id!==r.id&&!edges.some(([a,b])=>a===r.id&&b===other.id||b===r.id&&a===other.id)).sort((a,b)=>Math.hypot(a.x-r.x,a.z-r.z)-Math.hypot(b.x-r.x,b.z-r.z));if(nearby[0]&&random()<.25)connect(r.id,nearby[0].id);});
  // Guarantee the requested area even when the roll favors narrow galleries.
  while(cells.size<1950){const id=rooms.length,previous=rooms[id-1];const r:Room={id,x:Math.max(...rooms.map(r=>r.x+r.halfX))+18,z:previous.z,halfX:8,halfZ:8,shape:'hall',theme:'ruins',name:'The Outer Ward'};rooms.push(r);carveRoom(r);connect(previous.id,id);}
  rooms.forEach(r=>{
    let placed=0;const count=int(3,7);
    for(let tries=0;tries<100&&placed<count;tries++){
      const x=r.x+int(-r.halfX+1,r.halfX-1),z=r.z+int(-r.halfZ+1,r.halfZ-1);
      if(Math.hypot(x-r.x,z-r.z)<3||props.some(p=>Math.hypot(p.x-x,p.z-z)<3))continue;
      // Removing a cell surrounded on all eight sides cannot split the floor.
      if(![-1,0,1].every(dx=>[-1,0,1].every(dz=>cells.has(cellKey(x+dx,z+dz)))))continue;
      const kind=placed<2?'brazier':r.theme==='ruins'?'rubble':placed%2?'barrel':'pillar';
      props.push({x,z,kind,room:r.id});cells.delete(cellKey(x,z));ownership.delete(cellKey(x,z));wood.delete(cellKey(x,z));placed++;
    }
  });
  const tiles=[...cells].map(key=>{const [x,z]=key.split(',').map(Number);return {x,z,room:ownership.get(key)??-1,wood:wood.has(key)};});
  const bounds={minX:Math.min(...tiles.map(t=>t.x)),maxX:Math.max(...tiles.map(t=>t.x)),minZ:Math.min(...tiles.map(t=>t.z)),maxZ:Math.max(...tiles.map(t=>t.z))};
  return {seed,rooms,edges,cells,tiles,bounds,props,guardCount:(rooms.length-1)*2};
}

export function canStand(cells: Set<string>, x: number, z: number, radius = 0.32) {
  for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) if (!cells.has(cellKey(Math.round((x + dx) / TILE), Math.round((z + dz) / TILE)))) return false;
  return true;
}

export function moveOnFloor(cells: Set<string>, position: { x: number; z: number }, dx: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.15));
  for (let i = 0; i < steps; i++) {
    if (canStand(cells, position.x + dx / steps, position.z)) position.x += dx / steps;
    if (canStand(cells, position.x, position.z + dz / steps)) position.z += dz / steps;
  }
}
