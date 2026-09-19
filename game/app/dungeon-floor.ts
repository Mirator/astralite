import { FOUND_WEAPONS, type WeaponId } from './dungeon-weapon.ts';

export const TILE = 1.48;
export type Encounter = 'watch' | 'ambush' | 'gauntlet' | 'sanctuary' | 'warden';
export type Room = { encounter: Encounter; id: number; x: number; z: number; halfX: number; halfZ: number; shape: 'hall' | 'round' | 'cross' | 'court' | 'gallery' | 'crypt'; theme: 'keep' | 'ruins' | 'flooded'; name: string; role: 'start' | 'path' | 'branch' | 'goal'; depth: number; heading: number };
export type Spawn = { x: number; z: number; kind: 'guard' | 'stalker' | 'warden'; room: number; ambush: boolean };
export type FloorProp = { x: number; z: number; kind: 'brazier' | 'pillar' | 'rubble' | 'barrel'; room: number };
export type WeaponDrop = { x: number; z: number; kind: WeaponId; room: number };
export const cellKey = (x: number, z: number) => `${x},${z}`;

// `level` is how deep in the keep this floor sits: it lengthens the trunk and drags the whole
// encounter curve forward, so floor 3 opens with what floor 1 kept for its last halls.
export function generateFloor(seed: number, level = 1) {
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
  // Cell lookups during placement used to build a string key every time, which made rejected placements
  // by far the most expensive part of generation; corridors are tracked by a packed numeric key instead.
  const numKey=(x:number,z:number)=>(x+4096)*8192+(z+4096);
  const corridorCells=new Set<number>();
  const planPath=(from:{x:number;z:number},to:{x:number;z:number})=>{
    let x=from.x,z=from.z;const wooden=random()<.5,width=random()<.3?2:1,path:string[]=[],centre:[number,number][]=[];
    const step=()=>{centre.push([x,z]);for(let dx=-width;dx<=width;dx++)for(let dz=-width;dz<=width;dz++)path.push(cellKey(x+dx,z+dz));};
    const bend={x:Math.round((from.x+to.x)/2)+int(-1,1),z:Math.round((from.z+to.z)/2)+int(-1,1)};
    step();for(const goal of [bend,to])for(const axis of random()<.5?['x','z']:['z','x'])while(axis==='x'?x!==goal.x:z!==goal.z){if(axis==='x')x+=Math.sign(goal.x-x);else z+=Math.sign(goal.z-z);step();}
    return {wooden,path,centre,width};
  };
  // A corridor that clips a third room, or merges with a corridor already carved, would hand the player a
  // shortcut the room graph never granted - and would quietly give every dead end a second mouth.
  const crossesExistingFloor=(plan:ReturnType<typeof planPath>,parent:Room)=>{
    const pad=plan.width+1;
    for(const [x,z] of plan.centre){
      for(const other of rooms)if(other.id!==parent.id&&Math.abs(x-other.x)<=other.halfX+pad&&Math.abs(z-other.z)<=other.halfZ+pad)return true;
      // Mouths crowd together right outside the room they leave from; that overlap is expected.
      if(Math.abs(x-parent.x)<=parent.halfX+5&&Math.abs(z-parent.z)<=parent.halfZ+5)continue;
      for(let dx=-pad;dx<=pad;dx++)for(let dz=-pad;dz<=pad;dz++)if(corridorCells.has(numKey(x+dx,z+dz)))return true;
    }
    return false;
  };
  const connect=(a:number,b:number,plan:ReturnType<typeof planPath>)=>{
    edges.push([a,b]);
    for(const key of plan.path){cells.add(key);if(plan.wooden&&!ownership.has(key))wood.add(key);}
    for(const [x,z] of plan.centre)for(let dx=-plan.width;dx<=plan.width;dx++)for(let dz=-plan.width;dz<=plan.width;dz++)if(!ownership.has(cellKey(x+dx,z+dz)))corridorCells.add(numKey(x+dx,z+dz));
  };
  // Halved from the original 5-9/4-8 (default), 9-13/3-4 (gallery) and 8-11/7-10 (court): a court used to
  // be twenty-two tiles across, which made clearing it and then walking back over it dead time
  // proportional to its width. The shapes keep their relative sizing - gallery still long and narrow,
  // court still the biggest footprint - just at a scale where crossing one is no longer a commute.
  const sizeFor=(shape:Room['shape'])=>{
    let halfX=int(4,6),halfZ=int(3,5);
    if(shape==='gallery'){halfX=int(6,9);halfZ=int(2,3);if(random()<.5)[halfX,halfZ]=[halfZ,halfX];}
    if(shape==='court'){halfX=int(6,8);halfZ=int(5,7);}
    return {halfX,halfZ};
  };
  // The buffer here used to be a small fraction of the gap `distance` (below) put between two rooms; now
  // that rooms are smaller, `distance` shrinks with them and the old +3 started eating most of that gap,
  // which starved `addRoom`'s 120 attempts and cost floors both trunk depth and dead ends. Trimmed to +2 -
  // still enough to keep a corridor between any two rooms, never a shared wall.
  const fits=(x:number,z:number,halfX:number,halfZ:number)=>rooms.every(o=>Math.abs(x-o.x)>halfX+o.halfX+2||Math.abs(z-o.z)>halfZ+o.halfZ+2);
  const spineTarget=int(8,10)+level-1;
  // Every room hangs off exactly one predecessor and nothing ever links back, so the floor is a tree:
  // one long trunk from the gate to the stair, plus a few short stubs that visibly die out.
  const addRoom=(parentId:number,heading:number,spread:number,role:Room['role'])=>{
    const parent=rooms[parentId],shape=shapes[int(0,shapes.length-1)],{halfX,halfZ}=sizeFor(shape);
    for(let attempt=0;attempt<120;attempt++){
      const angle=heading+(random()*2-1)*spread*(1+attempt/40);
      // The old int(2,4) padded a doorway-to-doorway trudge onto every link on top of the rooms' own
      // half-sizes; trimmed to int(1,3) so the gap between two rooms reads as a threshold, not a passage.
      const distance=Math.max(parent.halfX,parent.halfZ)+Math.max(halfX,halfZ)+int(1,3);
      const x=Math.round(parent.x+Math.cos(angle)*distance),z=Math.round(parent.z+Math.sin(angle)*distance);
      if(!fits(x,z,halfX,halfZ))continue;
      const plan=planPath(parent,{x,z});
      // A doorway-to-doorway trudge is dead time; keep the open stretch between rooms short.
      if(plan.centre.filter(([cx,cz])=>!ownership.has(cellKey(cx,cz))&&(Math.abs(cx-x)>halfX||Math.abs(cz-z)>halfZ)).length>8)continue;
      if(crossesExistingFloor(plan,parent))continue;
      const depth=parent.depth+1,progress=depth/spineTarget;
      const theme:Room['theme']=role==='branch'?themes[int(0,2)]:progress<.3?'keep':progress<.66?'ruins':'flooded';
      const r:Room={encounter:'watch',id:rooms.length,x,z,halfX,halfZ,shape,theme,name:`${prefixes[int(0,7)]} ${names[shape]}`,role,depth,heading:angle};
      rooms.push(r);carveRoom(r);connect(parentId,r.id,plan);return r;
    }
    return null;
  };
  const gateSize=sizeFor('crypt');
  const start:Room={encounter:'sanctuary',id:0,x:0,z:0,...gateSize,shape:'crypt',theme:'keep',name:'The Tide Gate',role:'start',depth:0,heading:0};
  rooms.push(start);carveRoom(start);
  // The trunk keeps one general bearing and only drifts, so "onward" always reads the same way to the player.
  const bearing=random()*Math.PI*2;let heading=bearing,tip=start;const spine=[start];
  for(let step=0;step<spineTarget+14&&(spine.length<spineTarget||cells.size<1100);step++){
    heading=bearing+Math.max(-1,Math.min(1,heading-bearing+(random()*2-1)*.5));
    const next=addRoom(tip.id,heading,.3,'path');
    if(next){tip=next;spine.push(next);}
  }
  const goal=spine[spine.length-1];goal.role='goal';goal.theme='flooded';goal.name='The Sunken Stair';
  // Dead ends leave the trunk sideways: at the junction the detour never looks like the way forward.
  const junctions=spine.slice(1,-1);
  for(const room of junctions)if(random()<.4){
    const side=room.heading+(random()<.5?-1:1)*Math.PI/2;
    const stub=addRoom(room.id,side,.45,'branch');
    if(stub&&random()<.3)addRoom(stub.id,side,.6,'branch');
  }
  // A floor with nothing optional on it is just a corridor with a boss at the end.
  for(let tries=0;tries<24&&junctions.length&&rooms.filter(r=>r.role==='branch').length<2;tries++){
    const room=junctions[int(0,junctions.length-1)];
    addRoom(room.id,room.heading+(random()<.5?-1:1)*Math.PI/2,.6,'branch');
  }
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
  // Every hall reading the same - two guards, always awake, always visible - is what makes a floor feel flat.
  // The roster is drawn per room instead: some halls are empty on purpose, some spring, dead ends are packed.
  const spawns:Spawn[]=[];
  // A shuffled bag preserves encounter variety without announcing each beat by depth.
  let encounterBag:Encounter[]=[];
  let previous:Encounter='watch';
  for (const room of rooms) {
    if(room.role==='goal')room.encounter='warden';
    else if(room.id===0)room.encounter='sanctuary';
    else if(room.role==='branch')room.encounter='ambush';
    // The first two halls are always a straight fight: an ambush of three stalkers before the first boon
    // (eight kills away) killed a fresh run in under a minute, and nothing had been taught yet.
    else if(room.depth<=2)room.encounter='watch';
    else {
      if(!encounterBag.length){
        encounterBag=['watch','ambush','gauntlet','sanctuary'];
        for(let i=encounterBag.length-1;i>0;i--){const j=int(0,i);[encounterBag[i],encounterBag[j]]=[encounterBag[j],encounterBag[i]];}
      }
      if(previous==='sanctuary'&&encounterBag[0]==='sanctuary') [encounterBag[0],encounterBag[1]]=[encounterBag[1],encounterBag[0]];
      room.encounter=encounterBag.shift()!;
    }
    if(room.role==='path')previous=room.encounter;
    if (room.role !== 'goal' && room.id !== 0) room.name = room.encounter === 'sanctuary' ? 'The Stillwater Shrine' : room.encounter === 'gauntlet' ? 'The Ember Crossing' : room.encounter === 'ambush' ? 'The Bone Crypt' : room.name;
  }
  const menace=(level-1)*.3;
  const roster=(room:Room):Spawn['kind'][]=>{
    const progress=room.depth/goal.depth+menace,pick=(count:number,odds:number):Spawn['kind'][]=>Array.from({length:count},()=>random()<odds?'stalker':'guard');
    if(room.role==='goal')return (level>=3?['warden','warden','warden']:['warden','warden']) as Spawn['kind'][];
    if(room.role==='branch'){const pack=pick(int(2,4+Math.min(2,level-1)),.35);if(progress>.55&&random()<.35)pack.push('warden');return pack;}
    if(room.encounter==='sanctuary')return [];
    if(room.encounter==='gauntlet')return ['stalker','stalker'];
    if(room.encounter==='ambush')return pick(int(3,4),.85);
    if(progress<.35)return pick(int(1,2),.15);
    if(progress<.7)return pick(int(2,3),.4);
    return [...pick(int(2,3),.5),'warden' as const];
  };
  const tilesByRoom=new Map<number,typeof tiles>();
  for(const t of tiles)if(t.room>=0){const list=tilesByRoom.get(t.room);if(list)list.push(t);else tilesByRoom.set(t.room,[t]);}
  for(const room of rooms){
    if(room.id===0)continue;
    const open=tilesByRoom.get(room.id);if(!open?.length)continue;
    const pack=roster(room),ambush=room.encounter==='ambush';
    for(const kind of pack)for(let tries=0;tries<40;tries++){
      const t=open[int(0,open.length-1)];
      if(spawns.some(other=>other.room===room.id&&Math.hypot(other.x-t.x,other.z-t.z)<2.2))continue;
      spawns.push({x:t.x,z:t.z,kind,room:room.id,ambush});break;
    }
  }
  // One arm lies on the floor of every descent. Floor one leaves it in the Tide Gate, which has no
  // bodies in it, so the first real decision of a run is made in safety and before anything is at
  // stake; deeper floors hide it down a branch, which is what makes a detour worth the walk. The kind
  // is drawn from the seed like everything else, so the same keep hands back the same arm.
  const dropRoom = level === 1 ? rooms[0] : (rooms.filter(r => r.role === 'branch')[int(0, Math.max(0, rooms.filter(r => r.role === 'branch').length - 1))] ?? rooms[0]);
  const dropKind = FOUND_WEAPONS[int(0, FOUND_WEAPONS.length - 1)];
  const centre = {x: dropRoom.x * TILE, z: dropRoom.z * TILE};
  // Clear of the room's heart, which is where the knight stands on arrival and where a stair sits, and
  // clear of anything already spawned there.
  const dropSpot = (tilesByRoom.get(dropRoom.id) ?? [])
    .map(t => ({x: t.x * TILE, z: t.z * TILE}))
    .filter(spot => Math.hypot(spot.x - centre.x, spot.z - centre.z) > 1.9 && spawns.every(other => other.room !== dropRoom.id || Math.hypot(other.x * TILE - spot.x, other.z * TILE - spot.z) > 1.6))
    .sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))[0] ?? centre;
  const weaponDrop: WeaponDrop = {x: dropSpot.x, z: dropSpot.z, kind: dropKind, room: dropRoom.id};
  return {seed,level,rooms,edges,cells,tiles,roomByCell:new Map(tiles.filter(t=>t.room>=0).map(t=>[cellKey(t.x,t.z),t.room])),bounds,props,spawns,weaponDrop,start:0,goal:goal.id,spine:spine.map(r=>r.id),guardCount:spawns.length};
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

// Sample at less than a tile width, including body radius, so corners and props block attack lanes.
export function hasClearPath(cells:Set<string>, from:{x:number;z:number}, to:{x:number;z:number}) {
  const dx=to.x-from.x,dz=to.z-from.z,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.25));
  for(let i=0;i<=steps;i++)if(!canStand(cells,from.x+dx*i/steps,from.z+dz*i/steps))return false;
  return true;
}
