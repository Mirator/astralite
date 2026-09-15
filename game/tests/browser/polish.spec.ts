import { canStand, expect, hasClearPath, test, trackEnemy } from './helpers.ts';
import { generateFloor, TILE } from '../../app/dungeon-floor.ts';

// Real encounters drive poses; no visual clock or fake attack fixture can mask a timing regression.
for(const kind of ['guard','stalker','warden'] as const){
  test(`${kind} silhouette animates through anticipation and contact`,async({game})=>{
    await game.enter();
    const initial=await game.state(),floor=generateFloor(initial.floor.seed,initial.floor.level);
    const distance=kind==='stalker'?3:kind==='warden'?1.8:1;
    const candidates=initial.enemies.filter(e=>e.kind===kind).flatMap(enemy=>Array.from({length:16},(_,i)=>{
      const angle=i*Math.PI/8,spot={x:enemy.x+Math.cos(angle)*distance,z:enemy.z+Math.sin(angle)*distance};
      return {enemy,spot};
    })).filter(({enemy,spot})=>canStand(floor.cells,spot.x,spot.z)&&hasClearPath(floor.cells,enemy,spot));
    expect(candidates.length).toBeGreaterThan(0);
    const {enemy,spot}=candidates[0];
    await game.teleport(spot.x,spot.z);
    let current=enemy;
    for(let i=0;i<90;i++){
      await game.step(16);
      current=trackEnemy(await game.state(),kind,current);
      if(current.windup>0&&current.windup<.18)break;
    }
    expect(current.windup).toBeGreaterThan(0);
    expect(current.windup).toBeLessThan(.18);
    const readPose=async()=>{
      const state=await game.state();
      return trackEnemy(state,kind,current) as typeof current & {pose:{pitch:number;height:number;weapon:number}};
    };
    const tell=await readPose();
    if(kind==='stalker')expect(tell.pose.pitch).toBeLessThan(-.5);
    else expect(tell.pose.weapon).toBeGreaterThan(1);
    await game.capture(`${kind}-anticipation`);
    await game.step(current.windup*1000+18);
    const contact=await readPose();
    expect(contact.windup).toBe(0);
    if(kind==='stalker')expect(contact.lunge).toBeGreaterThan(0);
    else expect(contact.pose.weapon).toBeLessThan(0);
    await game.capture(`${kind}-contact`);
  });
}

test('wet masonry and water render across floor rebuilds without growing texture allocations',async({game})=>{
  await game.enter();
  await game.buildFloor(3);
  await game.step(0,true);
  const first=await game.state();
  const waterfalls=(first.floor as typeof first.floor & {waterfalls:{x:number;z:number}[]}).waterfalls;
  expect(waterfalls.length).toBeGreaterThan(0);
  const floor=generateFloor(first.floor.seed,first.floor.level),fall=waterfalls[0];
  const edge=floor.tiles.filter(tile=>canStand(floor.cells,tile.x*TILE,tile.z*TILE)).sort((a,b)=>Math.hypot(a.x*TILE-fall.x,a.z*TILE-fall.z)-Math.hypot(b.x*TILE-fall.x,b.z*TILE-fall.z))[0];
  await game.teleport(edge.x*TILE,edge.z*TILE);
  await game.step(1000,true);
  await game.capture('wet-stone-water');
  await game.buildFloor(3);
  await game.step(0,true);
  const rebuilt=await game.state();
  expect(rebuilt.render.textures).toBeLessThanOrEqual(first.render.textures);
  // Pinned seed repeats the same room geometry: carved niches, foliage, and shared paving
  // must release their GPU buffers when a floor is replaced.
  await game.buildFloor(3);
  await game.step(0,true);
  const repeated=await game.state();
  expect(repeated.render.geometries).toBe(rebuilt.render.geometries);
  expect(repeated.render.textures).toBe(rebuilt.render.textures);
});

test('carved chambers keep distant architecture out of the rendered frame',async({game})=>{
  await game.enter();
  await game.buildFloor(3);
  await game.step(0,true);
  const gate=await game.state();
  // Covers the accidental all-floor instancing that submitted nearly a million triangles
  // at the gate. This leaves room for art detail while bounding invisible geometry.
  expect(gate.render.triangles).toBeLessThan(400_000);
  for(const theme of ['keep','ruins','flooded']){
    const floor=await game.floor(),room=floor.rooms.find(r=>r.theme===theme)!;
    expect(room).toBeDefined();
    const spot=floor.tiles.find(t=>t.room===room.id&&canStand(floor.cells,t.x*TILE,t.z*TILE))!;
    await game.teleport(spot.x*TILE,spot.z*TILE);
    await game.step(500,true);
    await game.capture(`carved-${theme}`);
    expect((await game.state()).render.triangles).toBeGreaterThan(1000);
  }
});

test.describe('polish on a phone',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('materials remain readable while the thumbstick and held strike work',async({game})=>{
    await game.enter();
    const before=await game.state(),stick=await game.centreOf('.touch-stick');
    await game.touch('touchStart',[{...stick,id:1}]);
    await game.touch('touchMove',[{x:stick.x+30,y:stick.y,id:1}]);
    await game.step(180);
    await game.touch('touchEnd',[]);
    await game.step(16);
    const moved=await game.state();
    expect(Math.hypot(moved.player.x-before.player.x,moved.player.z-before.player.z)).toBeGreaterThan(.3);
    const strike=await game.centreOf('.touch-actions .strike');
    await game.touch('touchStart',[{...strike,id:2}]);
    await game.step(120);
    expect((await game.state()).player.attackTime).toBeGreaterThan(0);
    await game.capture('mobile-materials-and-strike');
    await game.touch('touchEnd',[]);
    await game.step(500);
    expect((await game.state()).player.attackTime).toBe(0);
  });
});
