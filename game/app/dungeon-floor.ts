import { BESTIARY, type EnemyKind } from './dungeon-bestiary.ts';
import { FOUND_WEAPONS, type WeaponId } from './dungeon-weapon.ts';

export const TILE = 1.48;
export type Encounter = 'watch' | 'ambush' | 'gauntlet' | 'sanctuary' | 'warden';
/**
 * What a chamber pays when it is cleared, and so what the door into it shows (plan 017): the floor's one
 * rack (`arm`), a real heal (`mend`) or a purse of experience (`cache`, today's dead-end XP). A shrine,
 * the gate and the stair hall pay nothing of their own.
 */
export type Reward = 'arm' | 'mend' | 'cache';
export type Room = { encounter: Encounter; id: number; x: number; z: number; halfX: number; halfZ: number; shape: 'hall' | 'round' | 'cross' | 'court' | 'gallery' | 'crypt'; theme: 'keep' | 'ruins' | 'flooded'; name: string; role: 'start' | 'path' | 'goal'; depth: number; heading: number; layer: number; reward: Reward | null; entry: { x: number; z: number } };
/**
 * A way out of a chamber, on one of the two walls facing away from the camera (the camera sits at +x/+z,
 * so -x and -z are the far walls and nothing stands between the player and a door). `x`/`z` is the tile
 * the knight stands on to take it, the last one inside the wall; `face` points out through the wall.
 */
export type Door = { id: number; from: number; to: number; x: number; z: number; face: { x: number; z: number } };
// `buried` bodies are a summoner's reserve (dungeon-arena.ts): hidden, inert and outside every count until
// the spawn index `summoner` raises them.
export type Spawn = { x: number; z: number; kind: EnemyKind; room: number; ambush: boolean; buried?: boolean; summoner?: number };

/**
 * The share of a pack each kind takes, in the order they are drawn; whatever is left over is guards.
 * One roll per body, whatever the mix, so adding a kind to a mix changes which bodies a seed deals but
 * never how many numbers it draws - the rooms, the props and the weapon drop after it stay put.
 */
export type PackMix = Partial<Record<EnemyKind, number>>;
export const PACK_MIX = {
  /** A chamber that pays a purse: packed, and the reason that door is worth choosing. */
  // No archers in either of these. A hoard springs at arm's length and an ambush is bodies coming out
  // of hiding - a bow has no business in one.
  hoard: { stalker: .35 },
  ambush: { stalker: .85 },
  /** A fight by how far down the floor it sits: under .35 of the way, under .7, and past it. */
  opening: { stalker: .15, archer: .1 },
  // Plan 018: the shieldbearer, the pyre and the bonecaller are appended after the older kinds, so the stalker and
  // the archer keep their odds exactly and the new ones take only from the guard's leftover share.
  middle: { stalker: .4, archer: .2, shieldbearer: .07, pyre: .07 },
  late: { stalker: .5, archer: .2, shieldbearer: .07, pyre: .07, bonecaller: .08 },
} satisfies Record<string, PackMix>;

/** A second bonecaller in one pack is dealt as a guard: two callers is eight rattlers and two priorities. No random input. */
export const oneCaller = (pack: EnemyKind[]): EnemyKind[] => {
  let callers = 0;
  return pack.map(kind => kind === 'bonecaller' && callers++ > 0 ? 'guard' : kind);
};

/**
 * A summoner's reserve, buried at its feet (plan 018): each caller's `summons.count` bodies are appended after
 * **every** standing spawn on the floor, on the caller's tile, with `summoner` the caller's index in the list. The
 * standing spawns keep their indices and nothing here draws a random number, so the rooms, props and weapon drop a
 * seed lays do not move. The generator and the development arena both bury through this one rule.
 */
export const buryReserves = (spawns: readonly Spawn[]): Spawn[] => {
  const all = [...spawns];
  spawns.forEach((caller, index) => {
    const summons = BESTIARY[caller.kind].summons;
    for (let n = 0; n < (summons?.count ?? 0); n++) all.push({ x: caller.x, z: caller.z, kind: summons!.kind, room: caller.room, ambush: false, buried: true, summoner: index });
  });
  return all;
};

/**
 * Where a chamber's pack comes from. The rule `roster` deals by, named so the census can count the chambers that
 * can hold a promoted kind (the `middle` and `late` packs) without copying it: `none` deals nobody, `fixed` is a pack
 * that is not drawn from a mix (the wardens, the gauntlet's stalkers), and the rest name the mix in PACK_MIX.
 */
export type PackSource = 'none' | 'fixed' | 'ambush' | 'hoard' | 'opening' | 'middle' | 'late';
export const packSource = (room: Pick<Room, 'role' | 'encounter' | 'reward' | 'layer'>, level: number, goalLayer: number): PackSource => {
  if (room.role === 'goal') return 'fixed';
  if (room.encounter === 'sanctuary') return 'none';
  if (room.encounter === 'gauntlet') return 'fixed';
  if (room.encounter === 'ambush') return 'ambush';
  if (room.reward === 'cache' && room.layer > 2) return 'hoard';
  const progress = room.layer / goalLayer + (level - 1) * .3;
  return progress < .35 ? 'opening' : progress < .7 ? 'middle' : 'late';
};

/**
 * Which kind one roll deals from a mix on this floor. A kind whose `firstFloor` has not come yet is
 * skipped and its share falls through to the guard, so the kinds drawn before it keep their odds exactly.
 */
export const drawKind = (mix: PackMix, level: number, roll: number): EnemyKind => {
  let edge = 0;
  for (const [kind, share] of Object.entries(mix) as [EnemyKind, number][]) {
    if (BESTIARY[kind].firstFloor > level) continue;
    edge += share;
    if (roll < edge) return kind;
  }
  return 'guard';
};
export type FloorProp = { x: number; z: number; kind: 'brazier' | 'pillar' | 'rubble' | 'barrel'; room: number };
export type WeaponDrop = { x: number; z: number; kind: WeaponId; room: number };
export const cellKey = (x: number, z: number) => `${x},${z}`;

/**
 * Centre-to-centre spacing of the chamber islands, in tiles. The widest chamber is nineteen tiles across
 * and the camera sees about fourteen units (under ten tiles) past the knight in any direction, so from
 * anywhere inside one island the next is out of frame: the chamber really is all there is.
 */
export const ISLAND_STRIDE = 32;
const ISLAND_COLUMNS = 6;
/** Tiles kept clear between where the knight arrives and the nearest body, so a sealed fight opens at range. */
export const ARRIVAL_CLEAR = 3.5;

// `level` is how deep in the keep this floor sits: it lengthens the descent and drags the whole
// encounter curve forward, so floor 3 opens with what floor 1 kept for its last halls.
//
// Plan 017: a floor is no longer one walkable tree of rooms and corridors but a chain of sealed chambers.
// Each chamber is its own island; the only way between two is a door, taken with the swap key once the
// chamber behind it is clear. Chambers stand in layers - the gate, then two or three per layer, then the
// stair hall - and every door leads one layer on, so every path down is the same length and a choice
// between doors is a choice between what the chambers behind them pay.
export function generateFloor(seed: number, level = 1) {
  let state = seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t=state; t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296; };
  const int = (a:number,b:number) => a+Math.floor(random()*(b-a+1));
  const rooms:Room[]=[], edges:[number,number][]=[], doors:Door[]=[], cells=new Set<string>(), ownership=new Map<string,number>(), props:FloorProp[]=[];
  const shapes:Room['shape'][]=['hall','round','cross','court','gallery','crypt'];
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
  const inRoom=(id:number,x:number,z:number)=>ownership.get(cellKey(x,z))===id;
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
  // The descent is as long as the old trunk was: every path from the gate to the stair crosses this many
  // chambers, the gate and the stair hall included.
  const layerCount=int(8,10)+level-1, goalLayer=layerCount-1;
  const place=(layer:number,shape:Room['shape'],role:Room['role']):Room=>{
    const id=rooms.length,{halfX,halfZ}=sizeFor(shape);
    const x=(id%ISLAND_COLUMNS)*ISLAND_STRIDE,z=Math.floor(id/ISLAND_COLUMNS)*ISLAND_STRIDE;
    const progress=layer/goalLayer;
    const theme:Room['theme']=progress<.3?'keep':progress<.66?'ruins':'flooded';
    const r:Room={encounter:'watch',id,x,z,halfX,halfZ,shape,theme,name:`${prefixes[int(0,7)]} ${names[shape]}`,role,depth:layer,heading:0,layer,reward:null,entry:{x,z}};
    rooms.push(r);carveRoom(r);return r;
  };
  const layers:Room[][]=[];
  for(let layer=0;layer<layerCount;layer++){
    if(layer===0){const gate=place(0,'crypt','start');gate.encounter='sanctuary';gate.name='The Tide Gate';layers.push([gate]);continue;}
    if(layer===goalLayer){const goal=place(layer,shapes[int(0,shapes.length-1)],'goal');goal.theme='flooded';goal.name='The Sunken Stair';layers.push([goal]);continue;}
    const width=layer===1?2:int(2,3);
    layers.push(Array.from({length:width},()=>place(layer,shapes[int(0,shapes.length-1)],'path')));
  }
  // Where a chamber's doors can go: the middle of each far wall, then a second opening further along the
  // -x wall. Three at most, which is also as many as a layer holds.
  const doorSlots=(r:Room)=>{
    const slots:{x:number;z:number;face:{x:number;z:number}}[]=[];
    const along=(dz:number)=>{let x=r.x;if(!inRoom(r.id,x,r.z+dz))return null;while(inRoom(r.id,x-1,r.z+dz))x--;return {x,z:r.z+dz,face:{x:-1,z:0}};};
    const across=()=>{let z=r.z;while(inRoom(r.id,r.x,z-1))z--;return {x:r.x,z,face:{x:0,z:-1}};};
    const west=along(0),north=across(),offset=along(Math.abs(r.halfZ)>=4?-2:2)??along(1);
    for(const slot of [west,north,offset])if(slot&&!slots.some(s=>Math.hypot(s.x-slot.x,s.z-slot.z)<2))slots.push(slot);
    return slots;
  };
  // Every chamber of the next layer has a way in and every chamber of this one a way on; past that a
  // chamber usually offers a second door, sometimes a third, and never two doors into the same chamber.
  for(let layer=0;layer<goalLayer;layer++){
    const here=layers[layer],next=layers[layer+1],links=here.map(()=>new Set<number>());
    next.forEach((_,j)=>links[Math.min(here.length-1,Math.floor((j+.5)*here.length/next.length))].add(j));
    here.forEach((_,i)=>{if(!links[i].size)links[i].add(Math.min(next.length-1,Math.floor((i+.5)*next.length/here.length)));});
    here.forEach((room,i)=>{
      const slots=doorSlots(room).length;
      for(const odds of [.75,.3]){
        const free=next.map((_,j)=>j).filter(j=>!links[i].has(j));
        if(free.length&&links[i].size<slots&&random()<odds)links[i].add(free[int(0,free.length-1)]);
      }
    });
    here.forEach((room,i)=>{
      const slots=doorSlots(room);
      [...links[i]].sort((a,b)=>a-b).forEach((j,k)=>{
        const slot=slots[Math.min(k,slots.length-1)],to=next[j].id;
        doors.push({id:doors.length,from:room.id,to,x:slot.x,z:slot.z,face:slot.face});edges.push([room.id,to]);
      });
    });
  }
  // The knight arrives through the near wall's middle, a pace in from it, facing the far wall and its doors.
  for(const r of rooms){let z=r.z;while(inRoom(r.id,r.x,z+1))z++;r.entry={x:r.x,z:Math.max(r.z,z-1)};}
  const parents=(id:number)=>edges.filter(([,b])=>b===id).map(([a])=>rooms[a]);
  // A shuffled bag preserves encounter variety without announcing each beat by depth.
  let encounterBag:Encounter[]=[];
  const refill=()=>{encounterBag=['watch','ambush','gauntlet','sanctuary'];for(let i=encounterBag.length-1;i>0;i--){const j=int(0,i);[encounterBag[i],encounterBag[j]]=[encounterBag[j],encounterBag[i]];}};
  for(const layer of layers)for(const room of layer){
    if(room.role!=='path')continue;
    // The first two fights past the gate are always a straight fight: an ambush of three stalkers
    // before the first boon (eight kills away) killed a fresh run in under a minute.
    if(room.layer<=2){room.encounter='watch';continue;}
    if(!encounterBag.length)refill();
    // A shrine behind a shrine is two quiet chambers in a row, which is a floor holding its breath; two
    // shrines side by side leave a layer with nothing to choose between.
    if(encounterBag[0]==='sanctuary'&&(parents(room.id).some(p=>p.encounter==='sanctuary')||layers[room.layer].some(r=>r.encounter==='sanctuary'))){
      if(encounterBag.length<2)encounterBag.push((['watch','ambush','gauntlet'] as Encounter[])[int(0,2)]);
      [encounterBag[0],encounterBag[1]]=[encounterBag[1],encounterBag[0]];
    }
    room.encounter=encounterBag.shift()!;
  }
  layers[goalLayer][0].encounter='warden';
  // What each door shows. Siblings in a layer differ where they can, so a choice between two doors is a
  // choice and not a coin toss between two of the same.
  for(const layer of layers){
    let last:Reward|null=null;
    for(const room of layer){
      if(room.role!=='path'||room.encounter==='sanctuary')continue;
      room.reward=last===null?(random()<.5?'mend':'cache'):last==='mend'?'cache':'mend';last=room.reward;
    }
  }
  // One arm lies on every descent. Floor one leaves it in the Tide Gate, which has no bodies in it, so the
  // first real decision of a run is made in safety and before anything is at stake; deeper floors put it
  // behind a door partway down, which is what makes that door worth taking over its neighbour.
  let armRoom=rooms[0];
  if(level>1){
    const candidates=layers.slice(2,goalLayer-1).flat().filter(r=>r.reward!==null);
    // Taken from a chamber whose reward a neighbour already offers where there is one, so the layer it
    // lands in still offers three different things rather than an arm and the same thing twice.
    const doubled=candidates.filter(r=>layers[r.layer].some(o=>o!==r&&o.reward===r.reward)),pool=doubled.length?doubled:candidates;
    if(pool.length){armRoom=pool[int(0,pool.length-1)];armRoom.reward='arm';}
  }
  for (const room of rooms) if (room.role === 'path') room.name = room.encounter === 'sanctuary' ? 'The Stillwater Shrine' : room.encounter === 'gauntlet' ? 'The Ember Crossing' : room.encounter === 'ambush' ? 'The Bone Crypt' : room.name;
  // Nothing is set down in a doorway or where the knight arrives.
  const doorway=(id:number,x:number,z:number,clear:number)=>doors.some(d=>d.from===id&&Math.hypot(d.x-x,d.z-z)<clear)||Math.hypot(rooms[id].entry.x-x,rooms[id].entry.z-z)<clear;
  rooms.forEach(r=>{
    let placed=0;const count=int(3,7);
    for(let tries=0;tries<100&&placed<count;tries++){
      const x=r.x+int(-r.halfX+1,r.halfX-1),z=r.z+int(-r.halfZ+1,r.halfZ-1);
      if(Math.hypot(x-r.x,z-r.z)<3||props.some(p=>Math.hypot(p.x-x,p.z-z)<3)||doorway(r.id,x,z,2.5))continue;
      // Removing a cell surrounded on all eight sides cannot split the floor.
      if(![-1,0,1].every(dx=>[-1,0,1].every(dz=>cells.has(cellKey(x+dx,z+dz)))))continue;
      const kind=placed<2?'brazier':r.theme==='ruins'?'rubble':placed%2?'barrel':'pillar';
      props.push({x,z,kind,room:r.id});cells.delete(cellKey(x,z));ownership.delete(cellKey(x,z));placed++;
    }
  });
  const tiles=[...cells].map(key=>{const [x,z]=key.split(',').map(Number);return {x,z,room:ownership.get(key)??-1};});
  const goal=layers[goalLayer][0];
  const spawns:Spawn[]=[];
  const menace=(level-1)*.3;
  const roster=(room:Room):Spawn['kind'][]=>{
    const progress=room.layer/goalLayer+menace,pick=(count:number,mix:PackMix):Spawn['kind'][]=>oneCaller(Array.from({length:count},()=>drawKind(mix,level,random())));
    const source=packSource(room,level,goalLayer);
    if(room.role==='goal')return (level>=3?['warden','warden','warden']:['warden','warden']) as Spawn['kind'][];
    if(source==='none')return [];
    if(source==='fixed')return ['stalker','stalker'];
    if(source==='ambush')return pick(int(3,4),PACK_MIX.ambush);
    // A purse is paid for: the pack a dead end used to hold, and past halfway sometimes a warden in it.
    if(source==='hoard'){const pack=pick(int(2,4+Math.min(2,level-1)),PACK_MIX.hoard);if(progress>.55&&random()<.35)pack.push('warden');return pack;}
    if(source==='opening')return pick(int(1,2),PACK_MIX.opening);
    if(source==='middle')return pick(int(2,3),PACK_MIX.middle);
    return [...pick(int(2,3),PACK_MIX.late),'warden' as const];
  };
  const tilesByRoom=new Map<number,typeof tiles>();
  for(const t of tiles)if(t.room>=0){const list=tilesByRoom.get(t.room);if(list)list.push(t);else tilesByRoom.set(t.room,[t]);}
  for(const room of rooms){
    if(room.id===0)continue;
    const open=(tilesByRoom.get(room.id)??[]).filter(t=>Math.hypot(t.x-room.entry.x,t.z-room.entry.z)>=ARRIVAL_CLEAR&&!doorway(room.id,t.x,t.z,1.5)&&!(room.id===goal.id&&Math.hypot(t.x-room.x,t.z-room.z)<2));
    if(!open.length)continue;
    const pack=roster(room),ambush=room.encounter==='ambush';
    for(const kind of pack)for(let tries=0;tries<40;tries++){
      const t=open[int(0,open.length-1)];
      if(spawns.some(other=>other.room===room.id&&Math.hypot(other.x-t.x,other.z-t.z)<2.2))continue;
      spawns.push({x:t.x,z:t.z,kind,room:room.id,ambush});break;
    }
  }
  // Buried under the callers after everything standing; makes no draw, so the drop below is unaffected.
  const standing=spawns.length,everyone=buryReserves(spawns);
  const dropKind = FOUND_WEAPONS[int(0, FOUND_WEAPONS.length - 1)];
  const centre = {x: armRoom.x * TILE, z: armRoom.z * TILE};
  // Clear of the room's heart, which is where a stair sits, of the way in and the ways out, and of
  // anything already spawned there.
  const dropSpot = (tilesByRoom.get(armRoom.id) ?? [])
    .filter(t => !doorway(armRoom.id, t.x, t.z, 2))
    .map(t => ({x: t.x * TILE, z: t.z * TILE}))
    .filter(spot => Math.hypot(spot.x - centre.x, spot.z - centre.z) > 1.9 && spawns.every(other => other.room !== armRoom.id || Math.hypot(other.x * TILE - spot.x, other.z * TILE - spot.z) > 1.6))
    .sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))[0] ?? centre;
  const weaponDrop: WeaponDrop = {x: dropSpot.x, z: dropSpot.z, kind: dropKind, room: armRoom.id};
  // Last of all, so no draw or placement above sees it: each door is cut one tile back into its wall, an
  // alcove the masonry closes round on three sides. The walls then frame an opening rather than a flat
  // face with a ring in front of it, and the knight steps into the doorway to take the door.
  // Where the wall beside a door bulges further out than the door's own row (a rotunda's flank, a crypt's
  // cut corner), the cut goes deeper, a tile at a time, until masonry stands on both sides of it.
  for(const door of doors){
    const across=door.face.x!==0?{x:0,z:1}:{x:1,z:0};
    for(let depth=0;depth<3;depth++){
      door.x+=door.face.x;door.z+=door.face.z;
      const key=cellKey(door.x,door.z);
      if(!cells.has(key)){cells.add(key);ownership.set(key,door.from);tiles.push({x:door.x,z:door.z,room:door.from});}
      if(!cells.has(cellKey(door.x+across.x,door.z+across.z))&&!cells.has(cellKey(door.x-across.x,door.z-across.z)))break;
    }
  }
  const bounds={minX:Math.min(...tiles.map(t=>t.x)),maxX:Math.max(...tiles.map(t=>t.x)),minZ:Math.min(...tiles.map(t=>t.z)),maxZ:Math.max(...tiles.map(t=>t.z))};
  return {seed,level,rooms,edges,doors,cells,tiles,roomByCell:new Map(tiles.filter(t=>t.room>=0).map(t=>[cellKey(t.x,t.z),t.room])),bounds,props,spawns:everyone,weaponDrop,start:0,goal:goal.id,spine:rooms.map(r=>r.id),guardCount:standing};
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
