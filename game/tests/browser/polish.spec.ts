import { CAPTURING, canStand, expect, test } from './helpers.ts';
import { generateFloor, TILE } from '../../app/dungeon-floor.ts';

// The enemy silhouettes through anticipation and contact are held by slash.spec.ts's release tests, which
// stage the same real encounter per kind and read the pose at the same two moments.

// Staged for the reference frames only: the rebuild leak this used to check alongside is held, strictly, by
// floor-motifs.spec.ts on the same floor.
test('wet masonry and water are captured for review',{tag:'@capture'},async({game})=>{
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
});

test('carved chambers keep distant architecture out of the rendered frame',async({game})=>{
  await game.enter();
  await game.buildFloor(3);
  await game.step(0,true);
  const gate=await game.state();
  // Covers the accidental all-floor instancing that submitted nearly a million triangles
  // at the gate. This leaves room for art detail while bounding invisible geometry.
  expect(gate.render.triangles).toBeLessThan(400_000);
  // The three chambers are staged for the reference frames only. They used to assert more than 1000
  // triangles, which the knight alone satisfies, so outside a capture run they cost three drawn frames for
  // nothing.
  if(CAPTURING)for(const theme of ['keep','ruins','flooded']){
    const floor=await game.floor(),room=floor.rooms.find(r=>r.theme===theme)!;
    expect(room).toBeDefined();
    const spot=floor.tiles.find(t=>t.room===room.id&&canStand(floor.cells,t.x*TILE,t.z*TILE))!;
    await game.teleport(spot.x*TILE,spot.z*TILE);
    await game.step(500,true);
    await game.capture(`carved-${theme}`);
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
