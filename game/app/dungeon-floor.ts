import { BESTIARY, BOSS_POOL, FINAL_BOSS, reserveSize, type EliteModifier, type EnemyKind } from './dungeon-bestiary.ts';
import { FOUND_WEAPONS, PICKUP_RADIUS, STARTING_WEAPON, type WeaponId } from './dungeon-weapon.ts';

export const TILE = 1.48;
export type Encounter = 'watch' | 'ambush' | 'gauntlet' | 'sanctuary' | 'warden';
/**
 * What a chamber pays when it is cleared, and so what the door into it shows (plan 017): a real heal
 * (`mend`) or a purse of experience (`cache`, today's dead-end XP). A shrine, the gate and the stair hall
 * pay nothing of their own. No chamber pays an arm (plan 019, D7): arms are chosen in the Tide Gate.
 */
export type Reward = 'mend' | 'cache';
export type Room = { encounter: Encounter; id: number; x: number; z: number; halfX: number; halfZ: number; shape: 'hall' | 'round' | 'cross' | 'court' | 'gallery' | 'crypt'; theme: 'keep' | 'ruins' | 'flooded'; name: string; role: 'start' | 'path' | 'goal'; depth: number; heading: number; layer: number; reward: Reward | null; entry: { x: number; z: number } };
/**
 * A way out of a chamber, on one of the two walls facing away from the camera (the camera sits at +x/+z,
 * so -x and -z are the far walls and nothing stands between the player and a door). `x`/`z` is the tile
 * the knight stands on to take it, the last one inside the wall; `face` points out through the wall.
 */
export type Door = { id: number; from: number; to: number; x: number; z: number; face: { x: number; z: number } };
// `buried` bodies are a summoner's reserve (dungeon-arena.ts): hidden, inert and outside every count until
// the spawn index `summoner` raises them. `wave` (plan 022, dungeon-waves.ts) is 2 or more on a body a chamber calls after the one before it has
// fallen; absent means the first wave, which is every spawn `generateFloor` lays. `elite` (plan 022 Stage C) is a modifier `dealElites` (dungeon-waves.ts) puts on a body; `generateFloor` never sets it.
export type Spawn = { x: number; z: number; kind: EnemyKind; room: number; ambush: boolean; buried?: boolean; summoner?: number; wave?: number; elite?: EliteModifier };

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
 * A summoner's reserve, buried at its feet (plan 018): each caller's `reserveSize` bodies (its `summons.count`, or for a boss the most its worst phase's round can raise) are appended after
 * **every** standing spawn on the floor, on the caller's tile, with `summoner` the caller's index in the list. The
 * standing spawns keep their indices and nothing here draws a random number, so the rooms, props and weapon drop a
 * seed lays do not move. The generator and the development arena both bury through this one rule.
 */
export const buryReserves = (spawns: readonly Spawn[]): Spawn[] => {
  const all = [...spawns];
  spawns.forEach((caller, index) => {
    const summons = BESTIARY[caller.kind].summons;
    for (let n = 0; n < reserveSize(caller.kind); n++) all.push({ x: caller.x, z: caller.z, kind: summons!.kind, room: caller.room, ambush: false, buried: true, summoner: index });
  });
  return all;
};

/**
 * Which pool boss floors one and two meet on a run that began on `runSeed` (plan 021 D13): a pure hash of the seed with its own mixing, so it
 * never touches the generator's stream, and the second floor is dealt from the pool without the first's pick, so a run never meets the same
 * boss twice. Every pool boss is equally likely on each floor. While the pool holds one kind (Stage B) both floors get it; the no-repeat rule
 * is exercised with a pool of two or more, which is why `pool` is a parameter.
 */
export const dealBosses = (runSeed: number, pool: readonly EnemyKind[] = BOSS_POOL): [EnemyKind, EnemyKind] => {
  const mix = (n: number) => { let h = (runSeed ^ Math.imul(n, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ h >>> 16, 0x85ebca6b) >>> 0; h = Math.imul(h ^ h >>> 13, 0xc2b2ae35) >>> 0; return (h ^ h >>> 16) >>> 0; };
  const first = pool[mix(1) % pool.length], rest = pool.filter(kind => kind !== first);
  return [first, rest.length ? rest[mix(2) % rest.length] : first];
};
/** The dev `?boss=` link (plan 021 D14): the name of a pool boss, or null for anything else - an unknown kind is ignored whole, as a bad arena link is. */
export const parseBoss = (text: string | null): EnemyKind | null => text !== null && BOSS_POOL.includes(text as EnemyKind) ? text as EnemyKind : null;
/** The boss a floor of this run holds: the dealt pair's, or the last floor's. */
export const bossOnFloor = (dealt: readonly [EnemyKind, EnemyKind], level: number): EnemyKind => level >= 3 ? FINAL_BOSS : dealt[level - 1] ?? dealt[0];

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
 * A floor as `generateFloor` deals it, plus the one marker the Tide Altar's hall (plan 020) carries. `hall` is absent from every generated floor, so the
 * generator's output is untouched; a rule that must tell the hall from floor 1 (both are `level: 1`) reads it instead of guessing from the room count.
 */
export type Floor = ReturnType<typeof generateFloor> & { hall?: true };
/** Whether a chamber's shape keeps the tile `x`,`z` away from its heart (tiles). The one rule `carveRoom` cuts by, shared so a later pass can tell a chamber's own floor from the alcove a door is cut into. */
export const carves = (r: Pick<Room, 'shape' | 'halfX' | 'halfZ'>, x: number, z: number) => {
  if (r.shape === 'round') return (x / (r.halfX + .4)) ** 2 + (z / (r.halfZ + .4)) ** 2 <= 1;
  if (r.shape === 'cross') return Math.abs(x) <= Math.max(2, r.halfX * .42) || Math.abs(z) <= Math.max(2, r.halfZ * .42);
  if (r.shape === 'court') return !(x > 2 && z < -2);
  if (r.shape === 'crypt') return !(Math.abs(x) > r.halfX - 2 && Math.abs(z) > r.halfZ - 2);
  return true;
};

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
//
// Plan 021 (D5, D13): the stair hall holds its boss and nobody else. `options.boss` names it; without one the Captain stands there, so every
// caller and fixture that never heard of bosses still lays a valid floor (floor three gets `FINAL_BOSS`, the Bone King, whose reserve is buried with the rest). The goal chamber still draws every placement it drew when it held two or three wardens - the boss takes the first body's
// spot and the others are placed and then not emitted - so no prop, weapon drop or other chamber's pack moves with it.
export type FloorOptions = { boss?: EnemyKind };
export function generateFloor(seed: number, level = 1, options: FloorOptions = {}) {
  let state = seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t=state; t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296; };
  const int = (a:number,b:number) => a+Math.floor(random()*(b-a+1));
  const rooms:Room[]=[], edges:[number,number][]=[], doors:Door[]=[], cells=new Set<string>(), ownership=new Map<string,number>(), props:FloorProp[]=[];
  const shapes:Room['shape'][]=['hall','round','cross','court','gallery','crypt'];
  const prefixes=['Ashen','Forgotten','Drowned','Silent','Broken','Saltbound','Lantern','Hollow'];
  const names={hall:'Hall',round:'Rotunda',cross:'Crossing',court:'Court',gallery:'Gallery',crypt:'Crypt'};
  const carveRoom=(r:Room)=>{
    for(let x=-r.halfX;x<=r.halfX;x++)for(let z=-r.halfZ;z<=r.halfZ;z++){
      if(carves(r,x,z)){const key=cellKey(r.x+x,r.z+z);cells.add(key);ownership.set(key,r.id);}
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
  // Plan 019 (D7): no chamber pays an arm any more - arms are chosen at the Tide Gate's racks (`gateRacks`). The
  // draws are kept all the same, so no spawn, prop or other chamber's reward moves: `armRoom` is still picked
  // by the same `int()`, and `dropKind` and the drop spot below are still drawn and laid. `weaponDrop` stays a
  // reserved spot (the decor layout and the dev arena read it); the campaign never places a rack on it. The
  // chamber keeps the mend or purse it was dealt one line above, and `roster` below still deals it as the
  // non-hoard fight it always was, or a purse chamber picked here would draw a different pack and move the stream.
  let armRoom=rooms[0];
  if(level>1){
    const candidates=layers.slice(2,goalLayer-1).flat().filter(r=>r.reward!==null);
    const doubled=candidates.filter(r=>layers[r.layer].some(o=>o!==r&&o.reward===r.reward)),pool=doubled.length?doubled:candidates;
    if(pool.length)armRoom=pool[int(0,pool.length-1)];
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
  const menace=(level-1)*.3,boss:EnemyKind=options.boss??(level>=3?FINAL_BOSS:'captain');
  const roster=(room:Room):Spawn['kind'][]=>{
    const progress=room.layer/goalLayer+menace,pick=(count:number,mix:PackMix):Spawn['kind'][]=>oneCaller(Array.from({length:count},()=>drawKind(mix,level,random())));
    // The former arm chamber is dealt as it was when its reward read `arm` (never a hoard), so its pack and every draw after it stay put.
    const source=packSource(room===armRoom?{...room,reward:null}:room,level,goalLayer);
    // The wardens that used to stand here are the placement draws the boss keeps: only the first is ever emitted (below).
    if(room.role==='goal')return [boss,...(level>=3?['warden','warden']:['warden'])] as Spawn['kind'][];
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
  // The goal chamber's other placed bodies were only there to spend their draws and to keep the first one's neighbours honest: the boss alone stands.
  // A chamber too tight to place even the first (none is, over every sweep) gets the boss on its tile farthest from the way in, which draws nothing.
  const bossAt=spawns.findIndex(s=>s.room===goal.id);
  for(let i=spawns.length-1;i>=0;i--)if(spawns[i].room===goal.id&&i!==bossAt)spawns.splice(i,1);
  if(bossAt>=0)spawns[bossAt].kind=boss;
  else{const t=(tilesByRoom.get(goal.id)??[]).filter(t=>Math.hypot(t.x-goal.x,t.z-goal.z)>=2).sort((a,b)=>Math.hypot(b.x-goal.entry.x,b.z-goal.entry.z)-Math.hypot(a.x-goal.entry.x,a.z-goal.entry.z))[0];if(t)spawns.push({x:t.x,z:t.z,kind:boss,room:goal.id,ambush:false});}
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

/** One slot of the Tide Gate's armoury (plan 019, D8): the arm that stands on it when it is owned, and where, in world units. */
export type GateRack = { arm: WeaponId; x: number; z: number };
/** The arms the Tide Gate has a slot for, in slot order: the Tideblade first, then `FOUND_WEAPONS`. */
export const GATE_ARMS: readonly WeaponId[] = [STARTING_WEAPON, ...FOUND_WEAPONS];
/** Slots stand at least this far apart, so standing in one rack's ring can never also be standing in another's. */
export const GATE_SPACING = 2 * PICKUP_RADIUS;
/** World units kept clear round a gate's heart: the weapon drop's own rule, and room for the altar the hall (plan 020) stands there. */
export const HEART_CLEAR = 1.9;

/**
 * The armoury of the floor-one Tide Gate (plan 019, D8): one slot for each arm in `GATE_ARMS`, a fixed layout
 * read off the floor alone. It makes no random draw and never sees the save, so which arms the knight owns
 * changes what stands on the slots and nothing about where they are (or the decor kept clear of them).
 *
 * Inside the gate's own floor (not a prop's hole, not the alcove a door is cut into), clear of its heart by
 * the drop's own 1.9, and two tiles clear of the way in and of every doorway, as the weapon drop is: measured
 * from the doorway the generator kept clear (the gate's last tile on the way to the door), and from the door
 * as cut back into the wall. A slot may stand against a wall (operator, 2026-10-01). Seven are laid on an
 * ellipse round the heart, each on the free tile nearest its place on it; a gate whose ellipse is too crowded
 * is searched for any seven that keep their distance, and a gate that cannot seat seven returns the ones that
 * fit - which `tests/dungeon-floor.test.ts` holds to never happening across its sweep, because the spacing is
 * not something to loosen.
 */
export function gateRacks(floor: Pick<Floor, 'rooms' | 'tiles' | 'doors'>): GateRack[] {
  const gate = floor.rooms[0], heart = { x: gate.x * TILE, z: gate.z * TILE };
  const own = (x: number, z: number) => Math.abs(x - gate.x) <= gate.halfX && Math.abs(z - gate.z) <= gate.halfZ && carves(gate, x - gate.x, z - gate.z);
  const mouth = (door: Door) => { let at = { x: door.x, z: door.z }; for (let back = 0; back < 4 && !own(at.x, at.z); back++) at = { x: at.x - door.face.x, z: at.z - door.face.z }; return at; };
  const shut = [gate.entry, ...floor.doors.filter(door => door.from === gate.id).flatMap(door => [door, mouth(door)])];
  const free = floor.tiles
    .filter(t => t.room === gate.id && own(t.x, t.z) && shut.every(way => Math.hypot(way.x - t.x, way.z - t.z) >= 2))
    .map(t => ({ x: t.x * TILE, z: t.z * TILE }))
    .filter(spot => Math.hypot(spot.x - heart.x, spot.z - heart.z) > HEART_CLEAR);
  const apart = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) >= GATE_SPACING - 1e-9;
  const away = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const reach = { x: Math.min(gate.halfX - 1, 4) * TILE, z: Math.min(gate.halfZ - 1, 3) * TILE };
  let picked: { x: number; z: number }[] = [];
  for (let i = 0; i < GATE_ARMS.length; i++) {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / GATE_ARMS.length, place = { x: heart.x + Math.cos(angle) * reach.x, z: heart.z + Math.sin(angle) * reach.z };
    const spot = free.filter(c => picked.every(p => apart(p, c))).sort((a, b) => away(a, place) - away(b, place))[0];
    if (!spot) break;
    picked.push(spot);
  }
  if (picked.length < GATE_ARMS.length) {
    const angled = [...free].sort((a, b) => Math.atan2(a.z - heart.z, a.x - heart.x) - Math.atan2(b.z - heart.z, b.x - heart.x) || away(a, heart) - away(b, heart));
    const seat = (from: number, held: { x: number; z: number }[]): { x: number; z: number }[] | null => {
      if (held.length === GATE_ARMS.length) return held;
      for (let at = from; at < angled.length; at++) if (held.every(p => apart(p, angled[at]))) { const found = seat(at + 1, [...held, angled[at]]); if (found) return found; }
      return null;
    };
    picked = seat(0, []) ?? picked;
  }
  return picked.map((spot, i) => ({ arm: GATE_ARMS[i], x: spot.x, z: spot.z }));
}

/** Plan 025 (D8): the hall's upgrade shrines, one for each of dungeon-meta's four upgrades in its order (a node test holds the two counts together). */
export const HALL_SHRINES = 4;

/**
 * Where the hall's upgrade shrines stand (plan 025, D8): one near each corner of the gate, on its own floor, read off the floor alone like `gateRacks`.
 * Clear of every rack slot and of each other by `GATE_SPACING` (so one ring never holds a rack and a shrine), of the altar by `HEART_CLEAR` and a pickup
 * ring more, of the entry and every doorway by two tiles as a slot is, and of a prop by a tile and a half, so a brazier never stands in one. Each corner
 * takes the free tile nearest it, ties to the one farther from the heart. It draws nothing; a gate too crowded seats fewer, which the node test holds the
 * hall (`HALL_SEED`) to never doing.
 */
export function hallShrines(floor: Pick<Floor, 'rooms' | 'tiles' | 'doors' | 'props'>): { x: number; z: number }[] {
  const gate = floor.rooms[0], heart = { x: gate.x * TILE, z: gate.z * TILE };
  const own = (x: number, z: number) => Math.abs(x - gate.x) <= gate.halfX && Math.abs(z - gate.z) <= gate.halfZ && carves(gate, x - gate.x, z - gate.z);
  const mouth = (door: Door) => { let at = { x: door.x, z: door.z }; for (let back = 0; back < 4 && !own(at.x, at.z); back++) at = { x: at.x - door.face.x, z: at.z - door.face.z }; return at; };
  const shut = [gate.entry, ...floor.doors.filter(door => door.from === gate.id).flatMap(door => [door, mouth(door)])];
  const slots = gateRacks(floor), away = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const free = floor.tiles
    .filter(t => t.room === gate.id && own(t.x, t.z) && shut.every(way => Math.hypot(way.x - t.x, way.z - t.z) >= 2) && floor.props.every(p => p.room !== gate.id || Math.hypot(p.x - t.x, p.z - t.z) >= 1.5))
    .map(t => ({ x: t.x * TILE, z: t.z * TILE }))
    .filter(spot => away(spot, heart) > HEART_CLEAR + PICKUP_RADIUS && slots.every(slot => away(slot, spot) >= GATE_SPACING - 1e-9));
  const picked: { x: number; z: number }[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const corner = { x: heart.x + sx * gate.halfX * TILE, z: heart.z + sz * gate.halfZ * TILE };
    const spot = free.filter(c => picked.every(p => away(p, c) >= GATE_SPACING - 1e-9)).sort((a, b) => Math.round((away(a, corner) - away(b, corner)) * 1e6) || away(b, heart) - away(a, heart) || a.x - b.x || a.z - b.z)[0];
    if (spot) picked.push(spot);
  }
  return picked;
}

/** The seed of the hall's room, fixed for good: the hall is this room on every visit. */
export const HALL_SEED = 2063;

/**
 * The Tide Altar's hall (plan 020, D4): the Tide Gate of `generateFloor(HALL_SEED, 1)` and nothing else. Room 0 with its
 * floor and props, the first door the generator cut from it (in `doors` order) and not the alcove of any other, no
 * spawns, no edges; `goal` is the room itself, so the floor is well formed, but the game builds no stair there. It carries
 * `hall: true`, and its one door keeps the generator's `to` (1), which names no room of a one-room floor: whatever draws or
 * reads a door must go through `doorSignOf` (dungeon-floor-scene.ts), which signs the hall's door "the way down", and never
 * look the room up. It
 * makes no draw of its own and the seed is a constant, so it is the same room on every call and in every process, and it
 * leaves the stream of every other seed alone. `seed` exists for the test sweep; the game never passes it.
 */
export function altarHall(seed = HALL_SEED): Floor {
  const floor = generateFloor(seed, 1), gate = floor.rooms[0];
  const own = (x: number, z: number) => Math.abs(x - gate.x) <= gate.halfX && Math.abs(z - gate.z) <= gate.halfZ && carves(gate, x - gate.x, z - gate.z);
  const doors = floor.doors.filter(door => door.from === gate.id), kept = doors[0];
  // A door was cut back into the wall, a tile at a time, until masonry stood on both sides: those tiles are the ones going back from the door that the gate's own floor does not hold.
  const alcoves = new Set<string>();
  for (const door of doors.slice(1)) for (let at = { x: door.x, z: door.z }, back = 0; back < 4 && !own(at.x, at.z); back++, at = { x: at.x - door.face.x, z: at.z - door.face.z }) alcoves.add(cellKey(at.x, at.z));
  const tiles = floor.tiles.filter(t => t.room === gate.id && !alcoves.has(cellKey(t.x, t.z)));
  const cells = new Set(tiles.map(t => cellKey(t.x, t.z)));
  const bounds = { minX: Math.min(...tiles.map(t => t.x)), maxX: Math.max(...tiles.map(t => t.x)), minZ: Math.min(...tiles.map(t => t.z)), maxZ: Math.max(...tiles.map(t => t.z)) };
  return { seed, level: 1, rooms: [gate], edges: [], doors: [kept], cells, tiles, roomByCell: new Map(tiles.map(t => [cellKey(t.x, t.z), t.room])), bounds, props: floor.props.filter(p => p.room === gate.id), spawns: [], weaponDrop: floor.weaponDrop, start: 0, goal: gate.id, spine: [gate.id], guardCount: 0, hall: true };
}

/** The footprint of a body at scale 1, the knight's. Plan 025 D4: a bigger body's grows with its `look.scale` (`bodyRadius`). */
export const BODY_RADIUS = 0.32;
// Never smaller than the knight's: a lane is sampled at his radius (`hasClearPath`), so a stalker or an archer let within 0.32 of a wall stood where no
// blow could reach it, and the balance sim's knight stood on one forever (2026-10-07, seed 126707 floor 3, before the floor was put in).
export const bodyRadius = (kind: EnemyKind) => BODY_RADIUS * Math.max(1, BESTIARY[kind].look.scale[0], BESTIARY[kind].look.scale[2]);

export function canStand(cells: Set<string>, x: number, z: number, radius = BODY_RADIUS) {
  for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) if (!cells.has(cellKey(Math.round((x + dx) / TILE), Math.round((z + dz) / TILE)))) return false;
  return true;
}

// A body already overlapping stone at its own radius (staged there, or grown since) walks as a scale-1 body until it is clear, rather than freezing where it stands.
export function moveOnFloor(cells: Set<string>, position: { x: number; z: number }, dx: number, dz: number, radius = BODY_RADIUS) {
  const r = radius > BODY_RADIUS && !canStand(cells, position.x, position.z, radius) ? BODY_RADIUS : radius;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.15));
  for (let i = 0; i < steps; i++) {
    if (canStand(cells, position.x + dx / steps, position.z, r)) position.x += dx / steps;
    if (canStand(cells, position.x, position.z + dz / steps, r)) position.z += dz / steps;
  }
}

/** A fallen body's extent on the floor in its own frame (forward is -z), in world units with its scale applied: what `deathFall` has to find floor for. */
export type Fallen = { minX: number; maxX: number; minZ: number; maxZ: number };
/** The turns a fall tries, off the body's own way down: its own, the opposite, then either side. */
export const FALL_TURNS = [0, Math.PI, Math.PI / 2, -Math.PI / 2] as const;

/** Whether every point of `fallen`, turned to `yaw` (a group's `rotation.y`) at `at`, lies on floor; sampled at a quarter unit, edges included. */
export function liesOnFloor(cells: Set<string>, at: { x: number; z: number }, yaw: number, fallen: Fallen) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw), nx = Math.max(1, Math.ceil((fallen.maxX - fallen.minX) / .25)), nz = Math.max(1, Math.ceil((fallen.maxZ - fallen.minZ) / .25));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = fallen.minX + (fallen.maxX - fallen.minX) * i / nx, z = fallen.minZ + (fallen.maxZ - fallen.minZ) * j / nz;
    if (!cells.has(cellKey(Math.round((at.x + x * cos + z * sin) / TILE), Math.round((at.z - x * sin + z * cos) / TILE)))) return false;
  }
  return true;
}

/**
 * Plan 025 D4: which way a body goes down so that all of it lands on floor. Its own way first (backwards for the armoured, forwards for the
 * low), then the opposite, then either side; when none fits where it stands, the same four from the nearest point it can slide to, a
 * quarter unit at a time out to three. `turn` is added to its facing; `shift` moves its feet. Nothing fitting anywhere leaves it as it was.
 */
export function deathFall(position: { x: number; z: number }, facing: number, fallen: Fallen, cells: Set<string>): { turn: number; shift: { x: number; z: number } } {
  const fits = (dx: number, dz: number) => FALL_TURNS.find(turn => liesOnFloor(cells, { x: position.x + dx, z: position.z + dz }, facing + turn, fallen));
  const here = fits(0, 0);
  if (here !== undefined) return { turn: here, shift: { x: 0, z: 0 } };
  for (let ring = .25; ring <= 3; ring += .25) for (let k = 0; k < 16; k++) {
    const dx = Math.cos(k * Math.PI / 8) * ring, dz = Math.sin(k * Math.PI / 8) * ring, turn = fits(dx, dz);
    if (turn !== undefined) return { turn, shift: { x: dx, z: dz } };
  }
  return { turn: 0, shift: { x: 0, z: 0 } };
}

// Sample at less than a tile width, including body radius, so corners and props block attack lanes.
export function hasClearPath(cells:Set<string>, from:{x:number;z:number}, to:{x:number;z:number}) {
  const dx=to.x-from.x,dz=to.z-from.z,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.25));
  for(let i=0;i<=steps;i++)if(!canStand(cells,from.x+dx*i/steps,from.z+dz*i/steps))return false;
  return true;
}
